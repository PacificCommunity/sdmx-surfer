import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";

// ---------------------------------------------------------------------------
// Input validation schema for PUT
// ---------------------------------------------------------------------------

const updateSessionSchema = z.object({
  title: z.string().optional(),
  messages: z.array(z.unknown()).optional(),
  configHistory: z.array(z.unknown()).optional(),
  configPointer: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/sessions/[id] — load a single session (scoped to user)
// ---------------------------------------------------------------------------

export async function GET(
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
      .select()
      .from(dashboardSessions)
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// PUT /api/sessions/[id] — update a session (scoped to user)
// ---------------------------------------------------------------------------

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
    body = {};
  }

  const parsed = updateSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { title, messages, configHistory, configPointer } = parsed.data;

  // Build partial update — only include fields that were provided
  const updates: Record<string, unknown> = {
    updated_at: new Date(),
  };
  if (title !== undefined) updates.title = title;
  if (messages !== undefined) updates.messages = messages;
  if (configHistory !== undefined) updates.config_history = configHistory;
  if (configPointer !== undefined) updates.config_pointer = configPointer;

  try {
    const result = await db
      .update(dashboardSessions)
      .set(updates)
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
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

// ---------------------------------------------------------------------------
// DELETE /api/sessions/[id] — delete a session (scoped to user)
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
    await db
      .delete(dashboardSessions)
      .where(
        and(
          eq(dashboardSessions.id, id),
          eq(dashboardSessions.user_id, userId),
        ),
      );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
