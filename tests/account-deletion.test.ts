import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, type PgTable } from "drizzle-orm/pg-core";

// Records every statement deleteAccount issues, in order, with its WHERE
// rendered to SQL. The auth_users row is stateful just enough to model the
// database: the final conditional update marks it deleted, so a second run
// sees what a real re-run would.
interface Row {
  email: string;
  deletedEmail: string | null;
  deletedAt: Date | null;
}
interface Statement {
  label: string;
  where?: SQL;
  set?: Record<string, unknown>;
  values?: Record<string, unknown>;
}
const mock = vi.hoisted(() => ({
  statements: [] as Statement[],
  user: null as Row | null,
  failOn: null as string | null,
}));

vi.mock("@/lib/db", async () => {
  // vi.mock is hoisted above the static imports, so the schema loads here.
  const schema = await import("@/lib/db/schema");
  const run = async (op: string, table: PgTable, s: Omit<Statement, "label">) => {
    const name = getTableName(table);
    const label = op + " " + name + (s.set ? " set " + Object.keys(s.set).join(",") : "");
    mock.statements.push({ label, ...s });
    if (mock.failOn === label) throw new Error("boom");
    if (name === "auth_users" && op === "update" && mock.user && !mock.user.deletedAt) {
      mock.user = {
        email: s.set!.email as string,
        deletedEmail: s.set!.deleted_email as string,
        deletedAt: s.set!.deleted_at as Date,
      };
    }
    return { rowCount: 1 };
  };
  const db = {
    select: () => ({
      from: (table: PgTable) => ({
        where: (where: SQL) => ({
          limit: async () => {
            mock.statements.push({ label: "select " + getTableName(table), where });
            return mock.user ? [{ ...mock.user }] : [];
          },
        }),
      }),
    }),
    insert: (table: PgTable) => ({
      values: (values: Record<string, unknown>) => run("insert", table, { values }),
    }),
    update: (table: PgTable) => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: SQL) => run("update", table, { set, where }),
      }),
    }),
    delete: (table: PgTable) => ({
      where: (where: SQL) => run("delete", table, { where }),
    }),
  };
  return { ...schema, db };
});

const authMock = vi.hoisted(() => ({
  auth: vi.fn(),
  signOut: vi.fn(),
}));
vi.mock("@/lib/auth", () => authMock);

const forgetRecentPass = vi.hoisted(() => vi.fn());
vi.mock("@/lib/session-revalidation", () => ({ forgetRecentPass }));

import {
  adminAccountEmail,
  deleteAccount,
  deletionConfirmed,
  magicLinkRefSuffix,
  tombstoneEmail,
} from "@/lib/account-deletion";
import { DELETE } from "@/app/api/account/route";

const dialect = new PgDialect();
const render = (where: SQL | undefined) => {
  const { sql, params } = dialect.sqlToQuery(where!);
  return { sql, params };
};
const find = (label: string) => mock.statements.find((s) => s.label === label)!;

const NOW = new Date("2026-11-17T03:30:00.000Z");
const EMAIL = "ana@spc.int";
const FINAL =
  "update auth_users set email,deleted_email,deleted_at,name,image,password_hash,role," +
  "failed_attempts,locked_until";

beforeEach(() => {
  mock.statements.length = 0;
  mock.user = { email: EMAIL, deletedEmail: null, deletedAt: null };
  mock.failOn = null;
  authMock.auth.mockReset();
  authMock.signOut.mockReset();
  forgetRecentPass.mockReset();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("tombstoneEmail", () => {
  it("is unique per account and can never be a real sign-in address", () => {
    const a = tombstoneEmail("u1");
    const b = tombstoneEmail("u2");
    expect(a).not.toBe(b);
    expect(a).toBe("deleted+u1@invalid");
    // `.invalid` is reserved: no provider asserts it and no mail reaches it.
    expect(a.endsWith("@invalid")).toBe(true);
  });
});

describe("deletionConfirmed", () => {
  it("needs the account's own address, ignoring case and surrounding spaces", () => {
    expect(deletionConfirmed("  Ana@SPC.int ", EMAIL)).toBe(true);
    expect(deletionConfirmed("ana@spc.in", EMAIL)).toBe(false);
    expect(deletionConfirmed("", EMAIL)).toBe(false);
    expect(deletionConfirmed("", "")).toBe(false);
  });
});

describe("magicLinkRefSuffix", () => {
  // Built the way @auth/core send-token.js builds the emailed callback.
  const callback = (email: string) =>
    "https://sdmxsurfer.net/api/auth/callback/email?" +
    new URLSearchParams({ callbackUrl: "https://sdmxsurfer.net/builder", token: "t0k", email });

  it("matches the end of that address's callback URL and no other address's", () => {
    expect(callback("bob+x@x.org").endsWith(magicLinkRefSuffix("bob+x@x.org"))).toBe(true);
    expect(callback("jimbob@x.org").endsWith(magicLinkRefSuffix("bob@x.org"))).toBe(false);
  });
});

describe("adminAccountEmail", () => {
  it("shows the kept address marked, then the tombstone once it is cleared", () => {
    expect(adminAccountEmail(EMAIL, null)).toBe(EMAIL);
    expect(adminAccountEmail("deleted+u1@invalid", EMAIL)).toBe(EMAIL + " (deleted)");
    expect(adminAccountEmail("deleted+u1@invalid", null)).toBe("deleted+u1@invalid");
  });
});

describe("deleteAccount", () => {
  it("removes sign-in material first and marks the row deleted last", async () => {
    await expect(deleteAccount("u1", "203.0.113.9", NOW)).resolves.toEqual({
      alreadyDeleted: false,
    });
    expect(mock.statements.map((s) => s.label)).toEqual([
      "select auth_users",
      "insert auth_events",
      "update dashboard_sessions set published_at,deleted_at",
      "update dashboard_sessions set published_at",
      "delete user_api_keys",
      "delete auth_accounts",
      "delete allowed_emails",
      "delete auth_verification_tokens",
      "delete auth_magic_link_refs",
      "delete email_proofs",
      FINAL,
    ]);
    expect(forgetRecentPass).toHaveBeenCalledWith("u1");
  });

  it("records the deletion with the real address and the IP", async () => {
    await deleteAccount("u1", "203.0.113.9", NOW);
    expect(find("insert auth_events").values).toEqual({
      user_id: "u1",
      email: EMAIL,
      event_type: "account_deleted",
      actor_user_id: "u1",
      ip: "203.0.113.9",
    });
  });

  it("unpublishes and soft-deletes every dashboard without restarting earlier deletions", async () => {
    await deleteAccount("u1", null, NOW);
    const live = find("update dashboard_sessions set published_at,deleted_at");
    expect(live.set).toEqual({ published_at: null, deleted_at: NOW });
    expect(render(live.where)).toEqual({
      sql: '("dashboard_sessions"."user_id" = $1 and "dashboard_sessions"."deleted_at" is null)',
      params: ["u1"],
    });
    const published = find("update dashboard_sessions set published_at");
    expect(published.set).toEqual({ published_at: null });
    expect(render(published.where)).toEqual({
      sql:
        '("dashboard_sessions"."user_id" = $1 and ' +
        '"dashboard_sessions"."published_at" is not null)',
      params: ["u1"],
    });
  });

  it("scopes every removal to this account or this address", async () => {
    await deleteAccount("u1", null, NOW);
    expect(render(find("delete user_api_keys").where).params).toEqual(["u1"]);
    expect(render(find("delete auth_accounts").where)).toEqual({
      sql: '"auth_accounts"."userId" = $1',
      params: ["u1"],
    });
    expect(render(find("delete allowed_emails").where).params).toEqual([EMAIL]);
    expect(render(find("delete auth_verification_tokens").where)).toEqual({
      sql: '"auth_verification_tokens"."identifier" = $1',
      params: [EMAIL],
    });
    const suffix = magicLinkRefSuffix(EMAIL);
    expect(render(find("delete auth_magic_link_refs").where)).toEqual({
      sql: 'right("auth_magic_link_refs"."callback_url", $1) = $2',
      params: [suffix.length, suffix],
    });
    expect(render(find("delete email_proofs").where).params).toEqual([EMAIL]);
  });

  it("frees the address for a new account and keeps it aside for review", async () => {
    await deleteAccount("u1", null, NOW);
    const final = find(FINAL);
    expect(final.set).toEqual({
      email: "deleted+u1@invalid",
      deleted_email: EMAIL,
      deleted_at: NOW,
      name: null,
      image: null,
      password_hash: null,
      role: "user",
      failed_attempts: 0,
      locked_until: null,
    });
    // Only an account not yet deleted: a repeat cannot overwrite deleted_email.
    expect(render(final.where)).toEqual({
      sql: '("auth_users"."id" = $1 and "auth_users"."deleted_at" is null)',
      params: ["u1"],
    });
    // Usage records stay with the row for the budget.
    expect(mock.statements.some((s) => s.label.includes("usage_logs"))).toBe(false);
    expect(mock.statements.some((s) => s.label === "delete auth_users")).toBe(false);
  });

  it("is idempotent: a repeat sweeps again by the kept address and records nothing new", async () => {
    await deleteAccount("u1", null, NOW);
    mock.statements.length = 0;

    await expect(deleteAccount("u1", null, new Date(NOW.getTime() + 60_000))).resolves.toEqual({
      alreadyDeleted: true,
    });
    const labels = mock.statements.map((s) => s.label);
    expect(labels).not.toContain("insert auth_events");
    // The email-keyed sweeps use the real address, not the tombstone.
    expect(render(find("delete allowed_emails").where).params).toEqual([EMAIL]);
    // The final update runs but matches nothing, so the row keeps its first values.
    expect(labels.at(-1)).toBe(FINAL);
    expect(mock.user).toEqual({
      email: "deleted+u1@invalid",
      deletedEmail: EMAIL,
      deletedAt: NOW,
    });
  });

  it("skips the address-keyed sweeps once the review window has cleared the address", async () => {
    mock.user = { email: "deleted+u1@invalid", deletedEmail: null, deletedAt: NOW };
    await deleteAccount("u1", null, NOW);
    const labels = mock.statements.map((s) => s.label);
    expect(labels).not.toContain("delete allowed_emails");
    expect(labels).not.toContain("delete email_proofs");
  });

  it("leaves the account marked live when a step fails, so a retry completes it", async () => {
    mock.failOn = "delete auth_accounts";
    await expect(deleteAccount("u1", null, NOW)).rejects.toThrow("boom");
    expect(mock.statements.some((s) => s.label === FINAL)).toBe(false);
    expect(mock.user?.deletedAt).toBeNull();

    mock.failOn = null;
    mock.statements.length = 0;
    await expect(deleteAccount("u1", null, NOW)).resolves.toEqual({ alreadyDeleted: false });
    expect(mock.user?.email).toBe("deleted+u1@invalid");
  });

  it("still deletes when the audit event cannot be written", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.failOn = "insert auth_events";
    await deleteAccount("u1", null, NOW);
    expect(mock.user?.deletedAt).toEqual(NOW);
  });

  it("returns null for an account that does not exist", async () => {
    mock.user = null;
    await expect(deleteAccount("nope", null, NOW)).resolves.toBeNull();
    expect(mock.statements.map((s) => s.label)).toEqual(["select auth_users"]);
  });
});

describe("DELETE /api/account", () => {
  const ORIGIN = "https://sdmxsurfer.net";
  const call = (body: unknown, headers: Record<string, string> = { origin: ORIGIN }) =>
    DELETE(
      new Request(ORIGIN + "/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json", "x-forwarded-for": "203.0.113.9", ...headers },
        body: JSON.stringify(body),
      }),
    );

  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_URL", ORIGIN);
    authMock.auth.mockResolvedValue({ user: { userId: "u1", email: EMAIL, role: "user" } });
  });

  it("refuses a request without an Origin before looking at the session", async () => {
    const res = await call({ confirmEmail: EMAIL }, {});
    expect(res.status).toBe(403);
    expect(authMock.auth).not.toHaveBeenCalled();
    expect(mock.statements).toEqual([]);
  });

  it("refuses a cross-site Origin", async () => {
    const res = await call({ confirmEmail: EMAIL }, { origin: "https://evil.example" });
    expect(res.status).toBe(403);
    expect(mock.statements).toEqual([]);
  });

  it("refuses an unauthenticated caller", async () => {
    authMock.auth.mockResolvedValue(null);
    const res = await call({ confirmEmail: EMAIL });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    expect(mock.statements).toEqual([]);
  });

  it("refuses a wrong or missing confirmation without touching the database", async () => {
    for (const body of [{ confirmEmail: "someone@else.org" }, {}, { confirmEmail: 42 }]) {
      expect((await call(body)).status).toBe(400);
    }
    expect(mock.statements).toEqual([]);
    expect(authMock.signOut).not.toHaveBeenCalled();
  });

  it("deletes the account, records the IP and clears the session cookie", async () => {
    const res = await call({ confirmEmail: " ANA@spc.int" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(find("insert auth_events").values?.ip).toBe("203.0.113.9");
    expect(mock.user?.deletedAt).not.toBeNull();
    expect(authMock.signOut).toHaveBeenCalledWith({ redirect: false });
  });

  it("succeeds even if clearing the cookie fails; revalidation and the client cover it", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    authMock.signOut.mockRejectedValue(new Error("no cookies here"));
    expect((await call({ confirmEmail: EMAIL })).status).toBe(200);
  });

  it("answers a generic 500 when a step fails, leaving the account to retry", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.failOn = "delete user_api_keys";
    const res = await call({ confirmEmail: EMAIL });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: "Your account could not be deleted. Please try again.",
    });
    expect(authMock.signOut).not.toHaveBeenCalled();
  });

  it("treats a session whose account no longer exists as unauthenticated", async () => {
    mock.user = null;
    expect((await call({ confirmEmail: EMAIL })).status).toBe(401);
  });
});
