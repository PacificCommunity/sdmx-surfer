import { NextResponse } from "next/server";
import { count, sum, sql, gte, isNotNull, eq, desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  db,
  authUsers,
  usageLogs,
  dashboardSessions,
  allowedEmails,
} from "@/lib/db";
import { USAGE_EPOCH } from "@/lib/admin-epoch";

// ---------------------------------------------------------------------------
// GET /api/admin/overview — lean aggregates for the admin landing page
// ---------------------------------------------------------------------------
//
// Usage analytics (tokens, spend, activity) are scoped to USAGE_EPOCH — see
// lib/admin-epoch.ts. Structural counts (users, invites, published) are
// all-time since they don't have the pre-cost-tracking skew.

interface SpendByModelRow {
  model: string | null;
  provider: string | null;
  keySource: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

interface RecentActivityRow {
  id: number;
  userEmail: string | null;
  model: string | null;
  provider: string | null;
  keySource: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  stepCount: number | null;
  durationMs: number | null;
  createdAt: string | null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    // Structural counts (all-time)
    const [usersRow] = await db
      .select({ c: count(authUsers.id) })
      .from(authUsers);
    const [sessionsRow] = await db
      .select({ c: count(dashboardSessions.id) })
      .from(dashboardSessions);
    const [publishedRow] = await db
      .select({ c: count(dashboardSessions.id) })
      .from(dashboardSessions)
      .where(isNotNull(dashboardSessions.published_at));

    // Invite funnel (all-time)
    const [inviteTotal] = await db
      .select({ c: count(allowedEmails.email) })
      .from(allowedEmails);
    const [inviteEmailed] = await db
      .select({ c: count(allowedEmails.email) })
      .from(allowedEmails)
      .where(eq(allowedEmails.invite_email_sent, true));
    // "Signed up" = an allowed email that has a corresponding auth_users row.
    const [inviteSignedUp] = await db
      .select({ c: count(authUsers.id) })
      .from(authUsers)
      .innerJoin(allowedEmails, eq(allowedEmails.email, authUsers.email));

    // Usage totals since epoch
    const [usageTotals] = await db
      .select({
        requestCount: count(usageLogs.id),
        totalInputTokens: sum(usageLogs.input_tokens),
        totalOutputTokens: sum(usageLogs.output_tokens),
        totalCostUsd: sum(usageLogs.cost_usd),
      })
      .from(usageLogs)
      .where(gte(usageLogs.created_at, USAGE_EPOCH));

    // Spend by (model, provider, key_source) — fuels the "Spend by model" table
    const spendByModelRows = await db
      .select({
        model: usageLogs.model,
        provider: usageLogs.provider,
        keySource: usageLogs.key_source,
        requestCount: count(usageLogs.id),
        inputTokens: sum(usageLogs.input_tokens),
        outputTokens: sum(usageLogs.output_tokens),
        costUsd: sum(usageLogs.cost_usd),
      })
      .from(usageLogs)
      .where(gte(usageLogs.created_at, USAGE_EPOCH))
      .groupBy(usageLogs.model, usageLogs.provider, usageLogs.key_source);

    const spendByModel: SpendByModelRow[] = spendByModelRows.map((r) => ({
      model: r.model,
      provider: r.provider,
      keySource: r.keySource,
      requestCount: Number(r.requestCount ?? 0),
      inputTokens: Number(r.inputTokens ?? 0),
      outputTokens: Number(r.outputTokens ?? 0),
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
    }));

    // Recent activity — last 10 usage_logs with the user email joined in
    const recentRows = await db
      .select({
        id: usageLogs.id,
        userEmail: authUsers.email,
        model: usageLogs.model,
        provider: usageLogs.provider,
        keySource: usageLogs.key_source,
        inputTokens: usageLogs.input_tokens,
        outputTokens: usageLogs.output_tokens,
        costUsd: usageLogs.cost_usd,
        stepCount: usageLogs.step_count,
        durationMs: usageLogs.duration_ms,
        createdAt: sql<string>`${usageLogs.created_at}`,
      })
      .from(usageLogs)
      .leftJoin(authUsers, eq(authUsers.id, usageLogs.user_id))
      .where(gte(usageLogs.created_at, USAGE_EPOCH))
      .orderBy(desc(usageLogs.id))
      .limit(10);

    const recentActivity: RecentActivityRow[] = recentRows.map((r) => ({
      id: r.id,
      userEmail: r.userEmail,
      model: r.model,
      provider: r.provider,
      keySource: r.keySource,
      inputTokens: r.inputTokens,
      outputTokens: r.outputTokens,
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      stepCount: r.stepCount,
      durationMs: r.durationMs,
      createdAt: r.createdAt,
    }));

    const totalInputTokens = Number(usageTotals?.totalInputTokens ?? 0);
    const totalOutputTokens = Number(usageTotals?.totalOutputTokens ?? 0);

    return NextResponse.json({
      epoch: USAGE_EPOCH.toISOString(),
      totals: {
        users: Number(usersRow?.c ?? 0),
        sessions: Number(sessionsRow?.c ?? 0),
        publishedDashboards: Number(publishedRow?.c ?? 0),
        requests: Number(usageTotals?.requestCount ?? 0),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        tokens: totalInputTokens + totalOutputTokens,
        costUsd:
          usageTotals?.totalCostUsd === null ||
          usageTotals?.totalCostUsd === undefined
            ? 0
            : Number(usageTotals.totalCostUsd),
      },
      invites: {
        total: Number(inviteTotal?.c ?? 0),
        emailed: Number(inviteEmailed?.c ?? 0),
        signedUp: Number(inviteSignedUp?.c ?? 0),
      },
      spendByModel,
      recentActivity,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
