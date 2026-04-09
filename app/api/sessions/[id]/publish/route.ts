import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

const publishSchema = z.object({
  authorDisplayName: z.string().trim().min(2).max(80),
  publicTitle: z.string().trim().min(3).max(140),
  publicDescription: z.string().trim().max(500).optional().default(""),
});

// ---------------------------------------------------------------------------
// POST /api/sessions/[id]/publish — publish a session (set published_at)
// ---------------------------------------------------------------------------

export async function POST(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;
  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = publishSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const authorDisplayName = parsed.data.authorDisplayName.trim();
  const publicTitle = parsed.data.publicTitle.trim();
  const publicDescription = parsed.data.publicDescription.trim();
  const publishedAt = new Date();

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
      .set({
        published_at: publishedAt,
        public_title: publicTitle,
        public_description: publicDescription || null,
        author_display_name: authorDisplayName,
        updated_at: new Date(),
      })
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
          isNull(dashboardSessions.deleted_at),
        ),
      );

    return NextResponse.json({
      ok: true,
      publishedAt: publishedAt.toISOString(),
      publicTitle,
      publicDescription: publicDescription || null,
      authorDisplayName,
    });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// DELETE /api/sessions/[id]/publish — unpublish a session (clear published_at)
// ---------------------------------------------------------------------------

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;
  const { id } = await params;

  try {
    const result = await db
      .update(dashboardSessions)
      .set({ published_at: null, updated_at: new Date() })
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
