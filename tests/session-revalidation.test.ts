import { afterEach, describe, expect, it, vi, type Mock } from "vitest";
import type { JWT } from "next-auth/jwt";
import {
  SESSION_REVALIDATE_MS,
  forgetRecentPass,
  revalidateToken,
  revalidationDue,
  type RecentPass,
  type RevalidationLookups,
  type RevalidationUser,
} from "@/lib/session-revalidation";

const NOW = 1_800_000_000_000;

interface FakeLookups extends RevalidationLookups {
  findUser: Mock<RevalidationLookups["findUser"]>;
  isAdmitted: Mock<RevalidationLookups["isAdmitted"]>;
}

function lookups(
  user: { email: string; role: string; deletedAt?: Date | null } | null,
  admitted = true,
): FakeLookups {
  const found: RevalidationUser | null = user ? { deletedAt: null, ...user } : null;
  return {
    findUser: vi.fn<RevalidationLookups["findUser"]>(async () => found),
    isAdmitted: vi.fn<RevalidationLookups["isAdmitted"]>(async () => admitted),
  };
}

function staleToken(overrides: Partial<JWT> = {}): JWT {
  return {
    userId: "u1",
    role: "user",
    email: "a@spc.int",
    checkedAt: NOW - SESSION_REVALIDATE_MS,
    ...overrides,
  };
}

describe("revalidationDue", () => {
  it("is due for a token that has never been checked", () => {
    expect(revalidationDue(undefined, NOW)).toBe(true);
  });

  it("is not due within the window", () => {
    expect(revalidationDue(NOW - SESSION_REVALIDATE_MS + 1, NOW)).toBe(false);
  });

  it("is due once the window has passed", () => {
    expect(revalidationDue(NOW - SESSION_REVALIDATE_MS, NOW)).toBe(true);
  });
});

describe("revalidateToken", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("leaves a recently checked token alone without touching the database", async () => {
    const l = lookups({ email: "a@spc.int", role: "admin" });
    const token = staleToken({ checkedAt: NOW - 1000 });
    expect(await revalidateToken(token, NOW, l, new Map())).toBe(token);
    expect(l.findUser).not.toHaveBeenCalled();
  });

  it("leaves a token without a user id alone", async () => {
    const l = lookups(null);
    const token = staleToken({ userId: undefined });
    expect(await revalidateToken(token, NOW, l, new Map())).toBe(token);
    expect(l.findUser).not.toHaveBeenCalled();
  });

  it("keeps an admitted user and stamps the check", async () => {
    const l = lookups({ email: "a@spc.int", role: "user" });
    const result = await revalidateToken(staleToken(), NOW, l, new Map());
    expect(result).toMatchObject({ userId: "u1", role: "user", checkedAt: NOW });
    expect(l.isAdmitted).toHaveBeenCalledWith("u1", "a@spc.int");
  });

  it("ends the session of a deleted user", async () => {
    const l = lookups(null);
    expect(await revalidateToken(staleToken(), NOW, l, new Map())).toBeNull();
    expect(l.isAdmitted).not.toHaveBeenCalled();
  });

  it("ends the session of a user who is no longer admitted", async () => {
    const l = lookups({ email: "a@spc.int", role: "user" }, false);
    expect(await revalidateToken(staleToken(), NOW, l, new Map())).toBeNull();
  });

  it("picks up a role change in either direction", async () => {
    const demoted = await revalidateToken(
      staleToken({ role: "admin" }),
      NOW,
      lookups({ email: "a@spc.int", role: "user" }),
      new Map(),
    );
    expect(demoted?.role).toBe("user");

    const promoted = await revalidateToken(
      staleToken(),
      NOW,
      lookups({ email: "a@spc.int", role: "admin" }),
      new Map(),
    );
    expect(promoted?.role).toBe("admin");
  });

  it("keeps the token unchanged when the database fails, so the next request retries", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const l = lookups(null);
    l.findUser.mockRejectedValueOnce(new Error("neon down"));
    const token = staleToken({ role: "admin" });
    expect(await revalidateToken(token, NOW, l, new Map())).toBe(token);
    expect(warn).toHaveBeenCalled();
  });

  it("keeps the token when the admission lookup fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const l = lookups({ email: "a@spc.int", role: "user" });
    l.isAdmitted.mockRejectedValueOnce(new Error("timeout"));
    const token = staleToken();
    expect(await revalidateToken(token, NOW, l, new Map())).toBe(token);
  });

  it("reuses a recent pass on this instance instead of querying again", async () => {
    const passes = new Map<string, RecentPass>();
    const l = lookups({ email: "a@spc.int", role: "admin" });
    await revalidateToken(staleToken(), NOW, l, passes);

    // Same stale cookie a minute later: auth() never wrote the refreshed one back.
    const later = NOW + 60_000;
    const result = await revalidateToken(staleToken(), later, l, passes);
    expect(result).toMatchObject({ role: "admin", checkedAt: NOW });
    expect(l.findUser).toHaveBeenCalledTimes(1);
  });

  it("checks again once the remembered pass has expired", async () => {
    const passes = new Map<string, RecentPass>();
    const l = lookups({ email: "a@spc.int", role: "user" });
    await revalidateToken(staleToken(), NOW, l, passes);
    l.isAdmitted.mockResolvedValueOnce(false);
    const later = NOW + SESSION_REVALIDATE_MS;
    expect(await revalidateToken(staleToken(), later, l, passes)).toBeNull();
    expect(passes.has("u1")).toBe(false);
  });

  it("ends the session of an account deleted in Settings, whose row remains", async () => {
    const l = lookups({
      email: "deleted+u1@invalid",
      role: "user",
      deletedAt: new Date(NOW - 1000),
    });
    const passes = new Map<string, RecentPass>();
    expect(await revalidateToken(staleToken(), NOW, l, passes)).toBeNull();
    // Gone whatever the admission rules would say about the address.
    expect(l.isAdmitted).not.toHaveBeenCalled();
    expect(passes.has("u1")).toBe(false);
  });

  it("checks a deleted account at once once its remembered pass is forgotten", async () => {
    const l = lookups({ email: "deleted+u1@invalid", role: "user", deletedAt: new Date(NOW) });
    const passes = new Map<string, RecentPass>([["u1", { at: NOW - 60_000, role: "user" }]]);
    // The pass from before the deletion would carry the session for minutes.
    expect(await revalidateToken(staleToken(), NOW, l, passes)).not.toBeNull();
    forgetRecentPass("u1", passes);
    expect(await revalidateToken(staleToken(), NOW, l, passes)).toBeNull();
  });
});
