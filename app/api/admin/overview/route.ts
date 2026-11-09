import { NextResponse } from "next/server";
import {
  count,
  sum,
  sql,
  gte,
  isNotNull,
  eq,
  desc,
  and,
  isNull,
  inArray,
  type SQL,
} from "drizzle-orm";
import { auth } from "@/lib/auth";
import {
  db,
  authUsers,
  usageLogs,
  dashboardSessions,
  allowedEmails,
  authEvents,
} from "@/lib/db";
import { USAGE_EPOCH, COST_TRUSTED_FROM } from "@/lib/admin-epoch";
import { hasSignedUp } from "@/lib/admin-query";
import { fetchGatewayCredits } from "@/lib/gateway-credits";

/**
 * A zoneless usage_logs timestamp as a UTC ISO string. The column is written
 * with the DB's now(), so it is read in the session's zone and converted;
 * the bare value would be parsed by the browser as local time.
 */
function utcIso(timestamp: SQL): SQL<string> {
  return sql<string>`to_char(${timestamp} at time zone current_setting('TimeZone') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')`;
}

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

interface Last24hUserRow {
  userId: string;
  userEmail: string | null;
  turns: number;
  costUsd: number | null;
  lastTurnAt: string | null;
}

export async function GET() {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // Started first so the 5 s external call overlaps the DB queries; it never
  // rejects (null on any failure).
  const gatewayCreditsPromise = fetchGatewayCredits();
  try {
    // Structural counts (all-time)
    const [usersRow] = await db
      .select({ c: count(authUsers.id) })
      .from(authUsers);
    const [sessionsRow] = await db
      .select({ c: count(dashboardSessions.id) })
      .from(dashboardSessions)
      .where(isNull(dashboardSessions.deleted_at));
    const [publishedRow] = await db
      .select({ c: count(dashboardSessions.id) })
      .from(dashboardSessions)
      .where(
        and(
          isNotNull(dashboardSessions.published_at),
          isNull(dashboardSessions.deleted_at),
        ),
      );

    // Invite funnel (all-time)
    const [inviteTotal] = await db
      .select({ c: count(allowedEmails.email) })
      .from(allowedEmails);
    const [inviteEmailed] = await db
      .select({ c: count(allowedEmails.email) })
      .from(allowedEmails)
      .where(eq(allowedEmails.invite_email_sent, true));
    const invites = await db
      .select({ email: allowedEmails.email })
      .from(allowedEmails);
    const inviteEmails = new Set(invites.map((row) => row.email));
    const allUsers = await db
      .select({
        email: authUsers.email,
        id: authUsers.id,
        createdAt: authUsers.created_at,
        emailVerified: authUsers.emailVerified,
      })
      .from(authUsers);
    const userMap = new Map(allUsers.map((u) => [u.email, u]));
    const inviteUserIds = allUsers
      .filter((u) => inviteEmails.has(u.email))
      .map((u) => u.id);
    const inviteActivityRows = inviteUserIds.length
      ? await db
          .select({
            userId: usageLogs.user_id,
            firstActive: sql<string>`min(${usageLogs.created_at})`,
            lastActive: sql<string>`max(${usageLogs.created_at})`,
          })
          .from(usageLogs)
          .where(inArray(usageLogs.user_id, inviteUserIds))
          .groupBy(usageLogs.user_id)
      : [];
    const activityMap = new Map(
      inviteActivityRows.map((row) => [
        row.userId,
        { first: row.firstActive, last: row.lastActive },
      ]),
    );
    const inviteSuccessRows = await db
      .select({
        email: authEvents.email,
        firstSuccessAt: sql<string>`min(${authEvents.created_at})`,
      })
      .from(authEvents)
      .where(eq(authEvents.event_type, "login_success"))
      .groupBy(authEvents.email);
    const successMap = new Map(
      inviteSuccessRows
        .filter((row) => inviteEmails.has(row.email))
        .map((row) => [row.email, row.firstSuccessAt]),
    );
    const signedUpCount = invites.reduce((total, invite) => {
      const user = userMap.get(invite.email);
      const activity = user ? activityMap.get(user.id) : null;
      return total + (hasSignedUp({
        emailVerified: user?.emailVerified,
        firstLoginAt: successMap.get(invite.email) || null,
        firstActiveAt: activity?.first || null,
        lastActiveAt: activity?.last || null,
        createdAt: user?.createdAt,
      }) ? 1 : 0);
    }, 0);

    // Usage totals — requestCount uses USAGE_EPOCH (full window). Tokens and
    // cost use COST_TRUSTED_FROM because pre-cutoff sums are systematically
    // undercounted by the AI SDK v6 final-step-only bug (see admin-epoch.ts).
    const [usageTotals] = await db
      .select({
        requestCount: count(usageLogs.id),
      })
      .from(usageLogs)
      .where(gte(usageLogs.created_at, USAGE_EPOCH));

    const [usageSpend] = await db
      .select({
        totalInputTokens: sum(usageLogs.input_tokens),
        totalOutputTokens: sum(usageLogs.output_tokens),
        totalCostUsd: sum(usageLogs.cost_usd),
      })
      .from(usageLogs)
      .where(gte(usageLogs.created_at, COST_TRUSTED_FROM));

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
      .where(gte(usageLogs.created_at, COST_TRUSTED_FROM))
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
        createdAt: utcIso(sql`${usageLogs.created_at}`),
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

    // Last 24 hours. usage_logs.created_at is `timestamp without time zone`
    // written with the DB's now(), so the window is computed with now() in SQL
    // too — comparing against a JS Date would drift by the TZ offset.
    const last24hWindow = gte(
      usageLogs.created_at,
      sql`now() - interval '24 hours'`,
    );
    const [last24hTotals] = await db
      .select({
        turns: count(usageLogs.id),
        costUsd: sum(usageLogs.cost_usd),
        turnsWithoutCost: sql<string>`count(*) filter (where ${usageLogs.cost_usd} is null)`,
      })
      .from(usageLogs)
      .where(last24hWindow);
    const last24hUserRows = await db
      .select({
        userId: usageLogs.user_id,
        userEmail: authUsers.email,
        turns: count(usageLogs.id),
        costUsd: sum(usageLogs.cost_usd),
        lastTurnAt: utcIso(sql`max(${usageLogs.created_at})`),
      })
      .from(usageLogs)
      .leftJoin(authUsers, eq(authUsers.id, usageLogs.user_id))
      .where(last24hWindow)
      .groupBy(usageLogs.user_id, authUsers.email)
      .orderBy(sql`coalesce(sum(${usageLogs.cost_usd}), 0) desc`)
      .limit(50);
    const last24hByUser: Last24hUserRow[] = last24hUserRows.map((r) => ({
      userId: r.userId,
      userEmail: r.userEmail,
      turns: Number(r.turns ?? 0),
      costUsd: r.costUsd === null ? null : Number(r.costUsd),
      lastTurnAt: r.lastTurnAt,
    }));

    const totalInputTokens = Number(usageSpend?.totalInputTokens ?? 0);
    const totalOutputTokens = Number(usageSpend?.totalOutputTokens ?? 0);

    return NextResponse.json({
      epoch: USAGE_EPOCH.toISOString(),
      costTrustedFrom: COST_TRUSTED_FROM.toISOString(),
      totals: {
        users: Number(usersRow?.c ?? 0),
        sessions: Number(sessionsRow?.c ?? 0),
        publishedDashboards: Number(publishedRow?.c ?? 0),
        requests: Number(usageTotals?.requestCount ?? 0),
        inputTokens: totalInputTokens,
        outputTokens: totalOutputTokens,
        tokens: totalInputTokens + totalOutputTokens,
        costUsd:
          usageSpend?.totalCostUsd === null ||
          usageSpend?.totalCostUsd === undefined
            ? 0
            : Number(usageSpend.totalCostUsd),
      },
      invites: {
        total: Number(inviteTotal?.c ?? 0),
        emailed: Number(inviteEmailed?.c ?? 0),
        signedUp: signedUpCount,
      },
      spendByModel,
      recentActivity,
      last24h: {
        costUsd: Number(last24hTotals?.costUsd ?? 0),
        turns: Number(last24hTotals?.turns ?? 0),
        turnsWithoutCost: Number(last24hTotals?.turnsWithoutCost ?? 0),
        byUser: last24hByUser,
      },
      gatewayCredits: await gatewayCreditsPromise,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
