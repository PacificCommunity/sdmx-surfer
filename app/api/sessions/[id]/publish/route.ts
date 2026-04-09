import { NextResponse } from "next/server";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";

// ---------------------------------------------------------------------------
// POST /api/sessions/[id]/publish — publish a session (set published_at)
// ---------------------------------------------------------------------------

export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;
  const { id } = await params;

  try {
    const rows = await db
      .select({
        id: dashboardSessions.id,
        config_history: dashboardSessions.config_history,
        config_pointer: dashboardSessions.config_pointer,
      })
      .from(dashboardSessions)
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const row = rows[0];
    const history = Array.isArray(row.config_history) ? row.config_history : [];
    const pointer =
      typeof row.config_pointer === "number" ? row.config_pointer : -1;

    if (history.length === 0 || pointer < 0) {
      return NextResponse.json(
        { error: "Cannot publish a session without a dashboard config" },
        { status: 400 },
      );
    }

    await db
      .update(dashboardSessions)
      .set({ published_at: new Date() })
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
          isNull(dashboardSessions.deleted_at),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/sessions/[id]/publish — unpublish a session (clear published_at)
// ---------------------------------------------------------------------------

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;
  const { id } = await params;

  try {
    const result = await db
      .update(dashboardSessions)
      .set({ published_at: null })
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .returning({ id: dashboardSessions.id });

    if (result.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
