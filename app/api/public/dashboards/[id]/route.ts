import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, dashboardSessions, authUsers } from "@/lib/db";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

// ---------------------------------------------------------------------------
// GET /api/public/dashboards/[id] — load a published dashboard (no auth)
// Returns only the dashboard config + author info. Never exposes chat messages.
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const rows = await db
      .select({
        id: dashboardSessions.id,
        title: dashboardSessions.title,
        config_history: dashboardSessions.config_history,
        config_pointer: dashboardSessions.config_pointer,
        published_at: dashboardSessions.published_at,
        authorName: authUsers.name,
      })
      .from(dashboardSessions)
      .leftJoin(authUsers, eq(dashboardSessions.user_id, authUsers.id))
      .where(
        and(
          eq(dashboardSessions.id, id),
          isNotNull(dashboardSessions.published_at),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const row = rows[0];
    const history = row.config_history as unknown[];
    const pointer = typeof row.config_pointer === "number" ? row.config_pointer : -1;

    if (!history || history.length === 0 || pointer < 0) {
      return NextResponse.json(
        { error: "No dashboard config" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const config = history[Math.min(pointer, history.length - 1)];

    return NextResponse.json(
      {
        id: row.id,
        title: row.title,
        config,
        author: row.authorName || null,
        publishedAt: row.published_at?.toISOString() || null,
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
