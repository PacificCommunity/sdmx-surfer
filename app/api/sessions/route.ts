import { NextResponse } from "next/server";
import { z } from "zod";
import { desc, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";

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
    const rows = await db
      .select({
        id: dashboardSessions.id,
        title: dashboardSessions.title,
        updatedAt: dashboardSessions.updated_at,
      })
      .from(dashboardSessions)
      .where(eq(dashboardSessions.user_id, userId))
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
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
