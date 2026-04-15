import { NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

// ---------------------------------------------------------------------------
// Input validation schemas
// ---------------------------------------------------------------------------

const createSessionSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  messages: z.array(z.unknown()).optional(),
  configHistory: z.array(z.unknown()).optional(),
  configPointer: z.number().int().optional(),
});

// ---------------------------------------------------------------------------
// GET /api/sessions — list sessions for the authenticated user (max 20)
// ---------------------------------------------------------------------------

export async function GET() {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;

  try {
    // Hard-delete empty sessions (no messages) older than 1 minute — no data worth keeping
    await db
      .delete(dashboardSessions)
      .where(
        and(
          eq(dashboardSessions.user_id, userId),
          eq(dashboardSessions.title, "Untitled"),
          isNull(dashboardSessions.deleted_at),
          sql`jsonb_array_length(${dashboardSessions.messages}) = 0`,
          sql`${dashboardSessions.updated_at} < now() - interval '1 minute'`,
        ),
      )
      .catch(() => {}); // Non-critical, don't fail the request

    const rows = await db
      .select({
        id: dashboardSessions.id,
        title: dashboardSessions.title,
        updatedAt: dashboardSessions.updated_at,
      })
      .from(dashboardSessions)
      .where(
        and(
          eq(dashboardSessions.user_id, userId),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .orderBy(desc(dashboardSessions.updated_at))
      .limit(20);

    const sessions = rows.map((row) => ({
      id: row.id,
      title: row.title,
      updatedAt: row.updatedAt,
    }));

    return NextResponse.json({ sessions });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/sessions — create a new session
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userId = session.user.userId;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsed = createSessionSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { id, title, messages, configHistory, configPointer } = parsed.data;

  try {
    // Build insert payload — only include id if provided (otherwise DB default applies)
    const payload = {
      ...(id ? { id } : {}),
      user_id: userId,
      title: title ?? "Untitled",
      messages: messages ?? [],
      config_history: configHistory ?? [],
      config_pointer: configPointer ?? -1,
    };

    const rows = await db
      .insert(dashboardSessions)
      .values(payload)
      .returning({ id: dashboardSessions.id });

    return NextResponse.json({ id: rows[0].id }, { status: 201 });
  } catch (err: unknown) {
    // Unique constraint violation — session already exists
    const msg = err instanceof Error ? err.message : "";
    if (msg.includes("unique") || msg.includes("duplicate")) {
      return NextResponse.json({ error: "Session already exists" }, { status: 409 });
    }
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
