import { describe, it, expect, vi, beforeEach } from "vitest";

const authMock = vi.fn();
const returningMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/db", () => ({
  dashboardSessions: {},
  db: {
    insert: () => ({ values: () => ({ returning: returningMock }) }),
  },
}));

import * as forkRoute from "@/app/api/countrysnapshots/fork/route";
import { getSnapshotCatalogue } from "@/lib/country-snapshots/catalogue";

const APP = "http://localhost:3000";
const theme = getSnapshotCatalogue().themes[0].slug;

const { POST } = forkRoute;

function forkRequest(
  fields: Record<string, string>,
  origin: string | null = APP,
): Request {
  const headers: Record<string, string> = {};
  if (origin) headers.origin = origin;
  return new Request(APP + "/api/countrysnapshots/fork", {
    method: "POST",
    headers,
    body: new URLSearchParams(fields),
  });
}

function callbackOf(res: Response): string | null {
  return new URL(res.headers.get("location") ?? "", APP).searchParams.get(
    "callbackUrl",
  );
}

describe("POST /api/countrysnapshots/fork", () => {
  beforeEach(() => {
    vi.stubEnv("NEXTAUTH_URL", APP);
    authMock.mockReset();
    returningMock.mockReset();
  });

  it("does not expose a GET handler", () => {
    expect("GET" in forkRoute).toBe(false);
  });

  it("rejects a cross-origin submission before touching the session", async () => {
    const res = await POST(
      forkRequest({ country: "TO", theme }, "https://evil.example"),
    );
    expect(res.status).toBe(403);
    expect(authMock).not.toHaveBeenCalled();
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("rejects unknown countries", async () => {
    const res = await POST(forkRequest({ country: "XX", theme }));
    expect(res.status).toBe(400);
  });

  it("sends signed-out visitors to login, returning to the snapshot page", async () => {
    authMock.mockResolvedValue(null);
    const res = await POST(
      forkRequest({
        country: "TO",
        theme,
        returnTo: "/countrysnapshots/regional/" + theme + "?scope=mfat",
      }),
    );
    expect(res.status).toBe(303);
    expect(new URL(res.headers.get("location") ?? "").pathname).toBe("/login");
    expect(callbackOf(res)).toBe(
      "/countrysnapshots/regional/" + theme + "?scope=mfat",
    );
    expect(returningMock).not.toHaveBeenCalled();
  });

  it("falls back to the snapshot index for a non-snapshot returnTo", async () => {
    authMock.mockResolvedValue(null);
    for (const returnTo of [
      "",
      "/builder",
      "/countrysnapshotsx",
      "https://evil.example/countrysnapshots",
      "//evil.example",
    ]) {
      const res = await POST(forkRequest({ country: "TO", theme, returnTo }));
      expect(callbackOf(res)).toBe("/countrysnapshots");
    }
  });

  it("creates a session and redirects into the builder", async () => {
    authMock.mockResolvedValue({ user: { userId: "u1" } });
    returningMock.mockResolvedValue([{ id: "s1" }]);
    const res = await POST(forkRequest({ country: "TO,WS", theme }));
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(APP + "/builder?session=s1");
    expect(returningMock).toHaveBeenCalledOnce();
  });
});
