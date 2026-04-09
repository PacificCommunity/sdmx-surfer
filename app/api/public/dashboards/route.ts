import { NextResponse } from "next/server";
import { and, desc, isNotNull, isNull } from "drizzle-orm";
import { db, dashboardSessions } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

export async function GET() {
  try {
    const rows = await db
      .select({
        id: dashboardSessions.id,
        title: dashboardSessions.title,
        public_title: dashboardSessions.public_title,
        public_description: dashboardSessions.public_description,
        author_display_name: dashboardSessions.author_display_name,
        published_at: dashboardSessions.published_at,
      })
      .from(dashboardSessions)
      .where(
        and(
          isNotNull(dashboardSessions.published_at),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .orderBy(desc(dashboardSessions.published_at))
      .limit(50);

    return NextResponse.json(
      {
        dashboards: rows.map((row) => ({
          id: row.id,
          title: row.public_title || row.title,
          description: row.public_description || null,
          author: row.author_display_name || null,
          publishedAt: row.published_at?.toISOString() || null,
        })),
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
