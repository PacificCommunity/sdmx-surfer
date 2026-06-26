import { describe, it, expect, vi, beforeEach } from "vitest";

// One stable `where` mock so we can program each query's result, including the
// two sequential queries inside checkChatAllowed.
const { whereMock } = vi.hoisted(() => ({ whereMock: vi.fn() }));

vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn(() => ({ from: vi.fn(() => ({ where: whereMock })) })),
  },
  usageLogs: {
    id: "id",
    user_id: "user_id",
    cost_usd: "cost_usd",
    created_at: "created_at",
  },
  dashboardSessions: {
    id: "id",
    user_id: "user_id",
    published_at: "published_at",
    deleted_at: "deleted_at",
  },
}));

import {
  dailyTurnCap,
  maxDashboards,
  aiBudgetCapUsd,
  checkGlobalBudget,
  checkDailyTurns,
  checkDashboardQuota,
  checkChatAllowed,
} from "@/lib/usage-caps";

const ENV_KEYS = [
  "OPEN_TIER_DAILY_TURNS",
  "OPEN_TIER_MAX_DASHBOARDS",
  "AI_BUDGET_CAP_USD",
  "AI_BUDGET_EPOCH",
];

function rows(n: number) {
  return Array.from({ length: n }, (_, i) => ({ id: String(i) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of ENV_KEYS) delete process.env[k];
});

describe("usage-caps", () => {
  describe("tunable limits from env", () => {
    it("uses defaults when env is unset", () => {
      expect(dailyTurnCap()).toBe(20);
      expect(maxDashboards()).toBe(5);
      expect(aiBudgetCapUsd()).toBe(1000);
    });

    it("reads valid overrides", () => {
      process.env.OPEN_TIER_DAILY_TURNS = "50";
      process.env.OPEN_TIER_MAX_DASHBOARDS = "3";
      process.env.AI_BUDGET_CAP_USD = "250.5";
      expect(dailyTurnCap()).toBe(50);
      expect(maxDashboards()).toBe(3);
      expect(aiBudgetCapUsd()).toBe(250.5);
    });

    it("falls back on invalid or non-positive values", () => {
      process.env.OPEN_TIER_DAILY_TURNS = "0";
      process.env.OPEN_TIER_MAX_DASHBOARDS = "-1";
      process.env.AI_BUDGET_CAP_USD = "not-a-number";
      expect(dailyTurnCap()).toBe(20);
      expect(maxDashboards()).toBe(5);
      expect(aiBudgetCapUsd()).toBe(1000);
    });
  });

  describe("checkGlobalBudget", () => {
    it("allows when spend is under the cap", async () => {
      process.env.AI_BUDGET_CAP_USD = "1000";
      whereMock.mockResolvedValueOnce([{ total: "412.50" }]);
      const r = await checkGlobalBudget();
      expect(r).toEqual({ allowed: true, spentUsd: 412.5, capUsd: 1000 });
    });

    it("blocks when spend reaches the cap", async () => {
      process.env.AI_BUDGET_CAP_USD = "1000";
      whereMock.mockResolvedValueOnce([{ total: "1000.00" }]);
      const r = await checkGlobalBudget();
      expect(r.allowed).toBe(false);
    });

    it("treats an empty sum as zero spend", async () => {
      whereMock.mockResolvedValueOnce([{ total: "0" }]);
      const r = await checkGlobalBudget();
      expect(r).toMatchObject({ allowed: true, spentUsd: 0 });
    });
  });

  describe("checkDailyTurns", () => {
    it("allows below the cap", async () => {
      whereMock.mockResolvedValueOnce(rows(19));
      const r = await checkDailyTurns("u1");
      expect(r).toEqual({ allowed: true, used: 19, cap: 20 });
    });

    it("blocks at the cap", async () => {
      whereMock.mockResolvedValueOnce(rows(20));
      const r = await checkDailyTurns("u1");
      expect(r.allowed).toBe(false);
    });
  });

  describe("checkDashboardQuota", () => {
    it("blocks at the cap", async () => {
      whereMock.mockResolvedValueOnce(rows(5));
      const r = await checkDashboardQuota("u1");
      expect(r).toEqual({ allowed: false, used: 5, cap: 5 });
    });

    it("allows below the cap (excluding the current session)", async () => {
      whereMock.mockResolvedValueOnce(rows(4));
      const r = await checkDashboardQuota("u1", "sess-current");
      expect(r.allowed).toBe(true);
    });
  });

  describe("checkChatAllowed", () => {
    it("blocks everyone (incl. admin) when the global budget is reached", async () => {
      process.env.AI_BUDGET_CAP_USD = "100";
      whereMock.mockResolvedValueOnce([{ total: "100" }]); // budget query
      const r = await checkChatAllowed("u1", "admin");
      expect(r.allowed).toBe(false);
      if (!r.allowed) expect(r.status).toBe(503);
    });

    it("blocks an open-tier user over the daily turn cap", async () => {
      whereMock
        .mockResolvedValueOnce([{ total: "10" }]) // budget OK
        .mockResolvedValueOnce(rows(20)); // turns at cap
      const r = await checkChatAllowed("u1", "user");
      expect(r.allowed).toBe(false);
      if (!r.allowed) {
        expect(r.status).toBe(429);
        expect(r.reason).toBe("daily_turns");
      }
    });

    it("exempts admins from the per-user daily cap when budget is OK", async () => {
      whereMock.mockResolvedValueOnce([{ total: "10" }]); // budget OK; turns not queried
      const r = await checkChatAllowed("admin-1", "admin");
      expect(r.allowed).toBe(true);
      expect(whereMock).toHaveBeenCalledTimes(1); // daily-turn query skipped
    });

    it("allows an open-tier user within both limits", async () => {
      whereMock
        .mockResolvedValueOnce([{ total: "10" }]) // budget OK
        .mockResolvedValueOnce(rows(3)); // turns under cap
      const r = await checkChatAllowed("u1", "user");
      expect(r.allowed).toBe(true);
    });
  });
});
