import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getTableName, type SQL } from "drizzle-orm";
import { PgDialect, QueryBuilder, type PgTable } from "drizzle-orm/pg-core";

// Records every statement runRetention issues, in order, with its WHERE
// rendered to SQL so the cutoffs and the session subquery can be checked.
// Each statement is labelled "<op> <table>", plus " set <columns>" for an
// update, since usage_logs takes two different updates.
const mock = vi.hoisted(() => ({
  statements: [] as Array<{ label: string; table: string; where: SQL; set?: object }>,
  rowCounts: {} as Record<string, number>,
  failOn: null as string | null,
}));

const REDACT = "update usage_logs set user_message,ai_response,tool_calls,errors";
const DETACH = "update usage_logs set session_id";
const UNLINK = "update auth_users set deleted_email";

vi.mock("@/lib/db", async () => {
  // vi.mock is hoisted above the static imports, so the schema loads here.
  const schema = await import("@/lib/db/schema");
  const qb = new QueryBuilder();
  const run = async (op: string, table: PgTable, where: SQL, set?: object) => {
    const name = getTableName(table);
    const label = op + " " + name + (set ? " set " + Object.keys(set).join(",") : "");
    mock.statements.push({ label, table: name, where, set });
    if (mock.failOn === label) throw new Error("boom");
    return { rowCount: mock.rowCounts[label] ?? 0 };
  };
  const db = {
    delete: vi.fn((table: PgTable) => ({
      where: (where: SQL) => run("delete", table, where),
    })),
    update: vi.fn((table: PgTable) => ({
      set: (set: object) => ({ where: (where: SQL) => run("update", table, where, set) }),
    })),
    select: (fields: Parameters<QueryBuilder["select"]>[0]) => qb.select(fields),
  };
  return { ...schema, db };
});

import { cronAuthorized, retentionCutoffs, runRetention } from "@/lib/retention";
import { GET } from "@/app/api/cron/retention/route";

const dialect = new PgDialect();
const render = (where: SQL) => {
  const { sql, params } = dialect.sqlToQuery(where);
  return { sql, params };
};

const NOW = new Date("2026-11-17T03:30:00.000Z");

beforeEach(() => {
  mock.statements.length = 0;
  mock.rowCounts = {};
  mock.failOn = null;
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("retentionCutoffs", () => {
  it("keeps usage excerpts and deleted accounts' addresses 3 months, auth events 90 days, deleted sessions 30 days", () => {
    const c = retentionCutoffs(NOW);
    expect(c.usageLogs.toISOString()).toBe("2026-08-17T03:30:00.000Z");
    expect(c.deletedAccounts.toISOString()).toBe("2026-08-17T03:30:00.000Z");
    expect(c.authEvents.toISOString()).toBe("2026-08-19T03:30:00.000Z");
    expect(c.deletedSessions.toISOString()).toBe("2026-10-18T03:30:00.000Z");
    expect(c.emailProofs.toISOString()).toBe("2026-11-16T03:30:00.000Z");
    expect(c.expiredTokens.toISOString()).toBe(NOW.toISOString());
  });

  it("does not mutate the date it is given", () => {
    const now = new Date(NOW);
    retentionCutoffs(now);
    expect(now.toISOString()).toBe(NOW.toISOString());
  });
});

describe("runRetention", () => {
  it("issues the statements in a partial-run-safe order", async () => {
    await runRetention(NOW);
    expect(mock.statements.map((s) => s.label)).toEqual([
      "delete email_proofs",
      "delete auth_magic_link_refs",
      "delete auth_verification_tokens",
      REDACT,
      UNLINK,
      DETACH,
      "delete dashboard_sessions",
      "delete auth_events",
    ]);
  });

  it("selects rows by age against each cutoff", async () => {
    await runRetention(NOW);
    const c = retentionCutoffs(NOW);
    const where = (label: string) =>
      render(mock.statements.find((s) => s.label === label)!.where);

    expect(where("delete email_proofs")).toEqual({
      sql: '"email_proofs"."created_at" < $1',
      params: [c.emailProofs.toISOString()],
    });
    expect(where("delete auth_magic_link_refs")).toEqual({
      sql: '"auth_magic_link_refs"."expires_at" < $1',
      params: [c.expiredTokens.toISOString()],
    });
    expect(where("delete auth_verification_tokens")).toEqual({
      sql: '"auth_verification_tokens"."expires" < $1',
      params: [c.expiredTokens.toISOString()],
    });
    expect(where("delete auth_events")).toEqual({
      sql: '"auth_events"."created_at" < $1',
      params: [c.authEvents.toISOString()],
    });
  });

  it("redacts old usage content but keeps the rows and their accounting", async () => {
    await runRetention(NOW);
    const redact = mock.statements.find((s) => s.label === REDACT)!;

    // Only the free-text columns are cleared; id, user, time, model, provider,
    // tokens and cost_usd are left for the budget and the admin totals.
    expect(redact.set).toEqual({
      user_message: null,
      ai_response: null,
      tool_calls: null,
      errors: null,
    });
    expect(mock.statements.some((s) => s.label === "delete usage_logs")).toBe(false);
    // Rows already redacted do not match, so the count is newly redacted rows.
    expect(render(redact.where)).toEqual({
      sql:
        '("usage_logs"."created_at" < $1 and ("usage_logs"."user_message" is not null ' +
        'or "usage_logs"."ai_response" is not null or "usage_logs"."tool_calls" is not null ' +
        'or "usage_logs"."errors" is not null))',
      params: [retentionCutoffs(NOW).usageLogs.toISOString()],
    });
  });

  it("clears a deleted account's real address after the review window, keeping the row", async () => {
    await runRetention(NOW);
    const unlink = mock.statements.find((s) => s.label === UNLINK)!;

    // Only the address goes: the row stays as the owner its usage_logs point at.
    expect(unlink.set).toEqual({ deleted_email: null });
    expect(mock.statements.some((s) => s.label === "delete auth_users")).toBe(false);
    // Live accounts (deleted_at NULL) never match; already-cleared rows do not
    // either, so a re-run touches nothing.
    expect(render(unlink.where)).toEqual({
      sql: '("auth_users"."deleted_at" < $1 and "auth_users"."deleted_email" is not null)',
      params: [retentionCutoffs(NOW).deletedAccounts.toISOString()],
    });
  });

  it("detaches usage logs from exactly the sessions it then purges", async () => {
    await runRetention(NOW);
    const cutoff = retentionCutoffs(NOW).deletedSessions.toISOString();
    const detach = mock.statements.find((s) => s.label === DETACH)!;
    const purge = mock.statements.find((s) => s.table === "dashboard_sessions")!;

    expect(detach.set).toEqual({ session_id: null });
    expect(render(detach.where)).toEqual({
      sql:
        '"usage_logs"."session_id" in (select "id" from "dashboard_sessions" ' +
        'where "dashboard_sessions"."deleted_at" < $1)',
      params: [cutoff],
    });
    // Only soft-deleted rows can match: a NULL deleted_at (every live and
    // every published dashboard) never compares less than the cutoff.
    expect(render(purge.where)).toEqual({
      sql: '"dashboard_sessions"."deleted_at" < $1',
      params: [cutoff],
    });
  });

  it("returns the row count of every statement", async () => {
    mock.rowCounts = {
      "delete email_proofs": 1,
      "delete auth_magic_link_refs": 2,
      "delete auth_verification_tokens": 3,
      [REDACT]: 4,
      [UNLINK]: 8,
      [DETACH]: 5,
      "delete dashboard_sessions": 6,
      "delete auth_events": 7,
    };
    await expect(runRetention(NOW)).resolves.toEqual({
      emailProofs: 1,
      magicLinkRefs: 2,
      verificationTokens: 3,
      usageLogsRedacted: 4,
      deletedAccountsUnlinked: 8,
      usageLogsDetached: 5,
      dashboardSessions: 6,
      authEvents: 7,
    });
  });

  it("does not attempt the session purge when the detach fails", async () => {
    mock.failOn = DETACH;
    await expect(runRetention(NOW)).rejects.toThrow("boom");
    expect(mock.statements.some((s) => s.table === "dashboard_sessions")).toBe(false);
  });
});

describe("cronAuthorized", () => {
  it("accepts only the exact Vercel Cron bearer", () => {
    expect(cronAuthorized("Bearer s3cret", "s3cret")).toBe(true);
    expect(cronAuthorized("Bearer wrong", "s3cret")).toBe(false);
    expect(cronAuthorized("s3cret", "s3cret")).toBe(false);
    expect(cronAuthorized(null, "s3cret")).toBe(false);
  });

  it("authorises nothing when the secret is unset or empty", () => {
    expect(cronAuthorized("Bearer ", "")).toBe(false);
    expect(cronAuthorized("Bearer undefined", undefined)).toBe(false);
  });
});

describe("GET /api/cron/retention", () => {
  const call = (authorization?: string) =>
    GET(
      new Request("https://example.test/api/cron/retention", {
        headers: authorization ? { authorization } : {},
      }),
    );

  it("rejects a missing or wrong bearer without touching the database", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    for (const res of [await call(), await call("Bearer nope")]) {
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: "Unauthorized" });
    }
    expect(mock.statements).toEqual([]);
  });

  it("rejects every call while CRON_SECRET is unset", async () => {
    vi.stubEnv("CRON_SECRET", "");
    expect((await call("Bearer ")).status).toBe(401);
    expect(mock.statements).toEqual([]);
  });

  it("runs the purge and returns the counts for the right bearer", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.spyOn(console, "log").mockImplementation(() => {});
    mock.rowCounts = { "delete auth_events": 3 };
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.deleted.authEvents).toBe(3);
    expect(mock.statements).toHaveLength(8);
  });

  it("answers a generic 500 when a statement fails", async () => {
    vi.stubEnv("CRON_SECRET", "s3cret");
    vi.spyOn(console, "error").mockImplementation(() => {});
    mock.failOn = REDACT;
    const res = await call("Bearer s3cret");
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "Internal server error" });
  });
});
