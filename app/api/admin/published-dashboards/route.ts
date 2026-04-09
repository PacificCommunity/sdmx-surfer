import { NextResponse } from "next/server";
import { and, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, authUsers, dashboardSessions } from "@/lib/db";

export async function GET() {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const rows = await db
      .select({
        id: dashboardSessions.id,
        ownerUserId: dashboardSessions.user_id,
        ownerEmail: authUsers.email,
        ownerName: authUsers.name,
        title: dashboardSessions.title,
        public_title: dashboardSessions.public_title,
        public_description: dashboardSessions.public_description,
        author_display_name: dashboardSessions.author_display_name,
        published_at: dashboardSessions.published_at,
      })
      .from(dashboardSessions)
      .innerJoin(authUsers, eq(dashboardSessions.user_id, authUsers.id))
      .where(
        and(
          isNotNull(dashboardSessions.published_at),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .orderBy(desc(dashboardSessions.published_at));

    return NextResponse.json({
      dashboards: rows.map((row) => ({
        id: row.id,
        ownerUserId: row.ownerUserId,
        ownerEmail: row.ownerEmail,
        ownerName: row.ownerName,
        title: row.public_title || row.title,
        description: row.public_description || null,
        author: row.author_display_name || null,
        publishedAt: row.published_at?.toISOString() || null,
      })),
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
