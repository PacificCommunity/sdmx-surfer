import { NextResponse } from "next/server";
import { count, sum, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, authUsers, usageLogs, dashboardSessions, authEvents } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/admin/users — list all users enriched with usage stats
// ---------------------------------------------------------------------------

export interface CostBreakdownRow {
  model: string | null;
  provider: string | null;
  keySource: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  // null when no authoritative cost is available for this bucket (direct SDK
  // or BYOK). Rendered as a dash in the UI — never estimated.
  costUsd: number | null;
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
    // Fetch all users
    const users = await db
      .select({
        id: authUsers.id,
        email: authUsers.email,
        name: authUsers.name,
        role: authUsers.role,
        createdAt: authUsers.created_at,
        emailVerified: authUsers.emailVerified,
      })
      .from(authUsers);

    // Aggregate usage logs per user: request count, total tokens, last active
    const usageRows = await db
      .select({
        userId: usageLogs.user_id,
        requestCount: count(usageLogs.id),
        totalInputTokens: sum(usageLogs.input_tokens),
        totalOutputTokens: sum(usageLogs.output_tokens),
        totalCostUsd: sum(usageLogs.cost_usd),
        firstActive: sql<string>`min(${usageLogs.created_at})`,
        lastActive: sql<string>`max(${usageLogs.created_at})`,
      })
      .from(usageLogs)
      .groupBy(usageLogs.user_id);

    // Per-(user, model, provider, key_source) buckets — drives the drill-down.
    // cost_usd sums to null when every row in the bucket has a null cost
    // (direct-SDK or BYOK paths), which is exactly what we want to surface.
    const breakdownRows = await db
      .select({
        userId: usageLogs.user_id,
        model: usageLogs.model,
        provider: usageLogs.provider,
        keySource: usageLogs.key_source,
        requestCount: count(usageLogs.id),
        inputTokens: sum(usageLogs.input_tokens),
        outputTokens: sum(usageLogs.output_tokens),
        costUsd: sum(usageLogs.cost_usd),
      })
      .from(usageLogs)
      .groupBy(
        usageLogs.user_id,
        usageLogs.model,
        usageLogs.provider,
        usageLogs.key_source,
      );

    // Count sessions per user
    const sessionRows = await db
      .select({
        userId: dashboardSessions.user_id,
        sessionCount: count(dashboardSessions.id),
      })
      .from(dashboardSessions)
      .groupBy(dashboardSessions.user_id);

    // First successful login per user. This is a better semantic match for
    // "Joined" than auth_users.created_at, which may reflect admin-side
    // provisioning rather than the user's first completed sign-in.
    const loginRows = await db
      .select({
        userId: authEvents.user_id,
        firstLoginAt: sql<string>`min(${authEvents.created_at})`,
      })
      .from(authEvents)
      .where(sql`${authEvents.event_type} = 'login_success'`)
      .groupBy(authEvents.user_id);

    // Build lookup maps
    const usageMap = new Map(usageRows.map((r) => [r.userId, r]));
    const sessionMap = new Map(sessionRows.map((r) => [r.userId, r]));
    const loginMap = new Map(
      loginRows
        .filter((r) => r.userId)
        .map((r) => [r.userId as string, r.firstLoginAt]),
    );
    const breakdownMap = new Map<string, CostBreakdownRow[]>();
    for (const r of breakdownRows) {
      const list = breakdownMap.get(r.userId) ?? [];
      list.push({
        model: r.model,
        provider: r.provider,
        keySource: r.keySource,
        requestCount: Number(r.requestCount ?? 0),
        inputTokens: Number(r.inputTokens ?? 0),
        outputTokens: Number(r.outputTokens ?? 0),
        costUsd: r.costUsd === null ? null : Number(r.costUsd),
      });
      breakdownMap.set(r.userId, list);
    }

    const enriched = users.map((u) => {
      const usage = usageMap.get(u.id);
      const sess = sessionMap.get(u.id);
      const joinedAt = u.emailVerified || loginMap.get(u.id) || null;
      const inputTokens = Number(usage?.totalInputTokens ?? 0);
      const outputTokens = Number(usage?.totalOutputTokens ?? 0);
      const firstActiveAt = usage?.firstActive || null;
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
        joinedAt: joinedAt || firstActiveAt || u.createdAt || null,
        requestCount: Number(usage?.requestCount ?? 0),
        totalTokens: inputTokens + outputTokens,
        totalCostUsd:
          usage?.totalCostUsd === null || usage?.totalCostUsd === undefined
            ? null
            : Number(usage.totalCostUsd),
        sessionCount: Number(sess?.sessionCount ?? 0),
        lastActive: usage?.lastActive || null,
        breakdown: breakdownMap.get(u.id) ?? [],
      };
    });

    return NextResponse.json({ users: enriched });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
