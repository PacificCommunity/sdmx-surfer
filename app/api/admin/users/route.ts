import { NextResponse } from "next/server";
import { count, sum, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, authUsers, usageLogs, dashboardSessions } from "@/lib/db";

// ---------------------------------------------------------------------------
// GET /api/admin/users — list all users enriched with usage stats
// ---------------------------------------------------------------------------

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
      })
      .from(authUsers);

    // Aggregate usage logs per user: request count, total tokens, last active
    const usageRows = await db
      .select({
        userId: usageLogs.user_id,
        requestCount: count(usageLogs.id),
        totalInputTokens: sum(usageLogs.input_tokens),
        totalOutputTokens: sum(usageLogs.output_tokens),
        lastActive: sql<string>`max(${usageLogs.created_at})`,
      })
      .from(usageLogs)
      .groupBy(usageLogs.user_id);

    // Count sessions per user
    const sessionRows = await db
      .select({
        userId: dashboardSessions.user_id,
        sessionCount: count(dashboardSessions.id),
      })
      .from(dashboardSessions)
      .groupBy(dashboardSessions.user_id);

    // Build lookup maps
    const usageMap = new Map(usageRows.map((r) => [r.userId, r]));
    const sessionMap = new Map(sessionRows.map((r) => [r.userId, r]));

    const enriched = users.map((u) => {
      const usage = usageMap.get(u.id);
      const sess = sessionMap.get(u.id);
      const inputTokens = Number(usage?.totalInputTokens ?? 0);
      const outputTokens = Number(usage?.totalOutputTokens ?? 0);
      return {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        createdAt: u.createdAt,
        requestCount: Number(usage?.requestCount ?? 0),
        totalTokens: inputTokens + outputTokens,
        sessionCount: Number(sess?.sessionCount ?? 0),
        lastActive: usage?.lastActive || null,
      };
    });

    return NextResponse.json({ users: enriched });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
