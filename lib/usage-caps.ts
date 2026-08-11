// Usage caps for the public (open) tier.
//
// Three limits, all tunable without code changes (env vars now; an admin-panel
// control is the planned follow-up so they can be tuned without a redeploy):
//
//   OPEN_TIER_DAILY_TURNS   per-user agent turns per rolling 24h  (default 20)
//   OPEN_TIER_MAX_DASHBOARDS per-user published dashboards, total  (default 5)
//   AI_BUDGET_CAP_USD       global cumulative AI spend ceiling     (default 1000)
//
// The global budget is the circuit breaker for everyone; the per-user limits
// keep any single user from consuming a disproportionate share before it is
// reached. Admins (auth_users.role === "admin") are exempt from the per-user
// limits, but the global budget still applies to every request.
//
// See docs/prototype-to-production.md §6.1 / §7.2.

import { db, usageLogs, dashboardSessions } from "@/lib/db";
import { and, eq, gte, isNull, isNotNull, ne, sql } from "drizzle-orm";
import { COST_TRUSTED_FROM } from "@/lib/admin-epoch";

const DEFAULT_DAILY_TURNS = 20;
const DEFAULT_MAX_DASHBOARDS = 5;
const DEFAULT_BUDGET_USD = 1000;

function intEnv(name: string, fallback: number): number {
  const v = Number(process.env[name] ?? "");
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.floor(v);
}

function numEnv(name: string, fallback: number): number {
  const v = Number(process.env[name] ?? "");
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return v;
}

export function dailyTurnCap(): number {
  return intEnv("OPEN_TIER_DAILY_TURNS", DEFAULT_DAILY_TURNS);
}

export function maxDashboards(): number {
  return intEnv("OPEN_TIER_MAX_DASHBOARDS", DEFAULT_MAX_DASHBOARDS);
}

export function aiBudgetCapUsd(): number {
  return numEnv("AI_BUDGET_CAP_USD", DEFAULT_BUDGET_USD);
}

// Start of the budget window. Defaults to COST_TRUSTED_FROM (the point from
// which cost_usd is accurate). Set AI_BUDGET_EPOCH to an ISO date to start a
// fresh budget window, e.g. at beta launch, without disturbing the admin
// analytics epoch.
function aiBudgetEpoch(): Date {
  const raw = process.env.AI_BUDGET_EPOCH;
  if (raw) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) return d;
  }
  return COST_TRUSTED_FROM;
}

/**
 * Global budget circuit breaker. Sums authoritative `cost_usd` over the budget
 * window and compares to the cap. Applies to everyone, including admins.
 */
export async function checkGlobalBudget(): Promise<{
  allowed: boolean;
  spentUsd: number;
  capUsd: number;
}> {
  const capUsd = aiBudgetCapUsd();
  const [row] = await db
    .select({
      total: sql<string>`coalesce(sum(${usageLogs.cost_usd}), 0)`,
    })
    .from(usageLogs)
    .where(gte(usageLogs.created_at, aiBudgetEpoch()));
  const spentUsd = Number(row?.total ?? 0);
  return { allowed: spentUsd < capUsd, spentUsd, capUsd };
}

/**
 * Per-user agent turns in the last rolling 24 hours. Each completed chat turn
 * writes one usage_logs row, so the row count equals the turn count.
 */
export async function checkDailyTurns(userId: string): Promise<{
  allowed: boolean;
  used: number;
  cap: number;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: usageLogs.id })
    .from(usageLogs)
    .where(and(eq(usageLogs.user_id, userId), gte(usageLogs.created_at, since)));
  const cap = dailyTurnCap();
  return { allowed: rows.length < cap, used: rows.length, cap };
}

/**
 * Per-user published-dashboard count (live, non-deleted). Pass `excludeId` to
 * skip the session being (re)published, so re-publishing an already-published
 * dashboard does not count against the user's own quota.
 */
export async function checkDashboardQuota(
  userId: string,
  excludeId?: string,
): Promise<{ allowed: boolean; used: number; cap: number }> {
  const rows = await db
    .select({ id: dashboardSessions.id })
    .from(dashboardSessions)
    .where(
      and(
        eq(dashboardSessions.user_id, userId),
        isNotNull(dashboardSessions.published_at),
        isNull(dashboardSessions.deleted_at),
        ...(excludeId ? [ne(dashboardSessions.id, excludeId)] : []),
      ),
    );
  const cap = maxDashboards();
  return { allowed: rows.length < cap, used: rows.length, cap };
}

export type CapDecision =
  | { allowed: true }
  | { allowed: false; status: number; reason: string; message: string };

/**
 * Gate for the chat agent: global budget first (applies to all), then the
 * per-user daily turn cap (open tier only; admins exempt). Returns a typed
 * decision the route can turn into an HTTP response.
 */
export async function checkChatAllowed(
  userId: string,
  role: string | undefined,
): Promise<CapDecision> {
  const budget = await checkGlobalBudget();
  if (!budget.allowed) {
    return {
      allowed: false,
      status: 503,
      reason: "global_budget",
      message:
        "Data Surfer has reached its AI usage budget for now, so new requests are paused while it is topped up. Your saved dashboards are still available.",
    };
  }

  if (role !== "admin") {
    const turns = await checkDailyTurns(userId);
    if (!turns.allowed) {
      return {
        allowed: false,
        status: 429,
        reason: "daily_turns",
        message: `You have reached today's limit of ${turns.cap} requests. It resets within 24 hours. Your dashboards stay available in the meantime.`,
      };
    }
  }

  return { allowed: true };
}
