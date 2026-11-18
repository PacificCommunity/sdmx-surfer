import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const authMock = vi.fn();
const executeMock = vi.fn();
const valuesMock = vi.fn();

vi.mock("@/lib/auth", () => ({ auth: () => authMock() }));
vi.mock("@/lib/db", () => ({
  authEvents: { table: "auth_events" },
  db: {
    execute: (...args: unknown[]) => executeMock(...args),
    insert: () => ({ values: valuesMock }),
  },
}));

import { GET } from "@/app/api/admin/activity/route";

const ADMIN = {
  user: { userId: "admin-1", email: "admin@spc.int", role: "admin" },
};

function activityRequest(): Request {
  return new Request("http://localhost:3000/api/admin/activity", {
    headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.1" },
  });
}

describe("GET /api/admin/activity", () => {
  beforeEach(() => {
    authMock.mockReset();
    executeMock.mockReset();
    valuesMock.mockReset();
    executeMock.mockResolvedValue({ rows: [] });
    valuesMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refuses non-admins without recording a view", async () => {
    authMock.mockResolvedValue({ user: { userId: "u-1", role: "user" } });
    const res = await GET(activityRequest());
    expect(res.status).toBe(403);
    expect(valuesMock).not.toHaveBeenCalled();
  });

  it("records that the admin viewed the excerpts", async () => {
    authMock.mockResolvedValue(ADMIN);
    const res = await GET(activityRequest());
    expect(res.status).toBe(200);
    expect(valuesMock).toHaveBeenCalledWith({
      user_id: "admin-1",
      email: "admin@spc.int",
      event_type: "admin_viewed_excerpts",
      actor_user_id: "admin-1",
      ip: "203.0.113.7",
      metadata: { endpoint: "/api/admin/activity" },
    });
  });

  it("still serves the activity when the audit insert fails", async () => {
    authMock.mockResolvedValue(ADMIN);
    valuesMock.mockRejectedValue(new Error("db down"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const res = await GET(activityRequest());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessions).toEqual([]);
    expect(warn).toHaveBeenCalled();
  });
});
