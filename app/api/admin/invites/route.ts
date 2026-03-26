import { NextResponse } from "next/server";
import { z } from "zod";
import { desc } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, allowedEmails } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const inviteSchema = z.object({
  email: z.string().email(),
});

// ---------------------------------------------------------------------------
// GET /api/admin/invites — list all allowed emails ordered by createdAt DESC
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
    const invites = await db
      .select()
      .from(allowedEmails)
      .orderBy(desc(allowedEmails.created_at));

    return NextResponse.json({ invites });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ---------------------------------------------------------------------------
// POST /api/admin/invites — add an email to the allowlist
// ---------------------------------------------------------------------------

export async function POST(req: Request) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = inviteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const email = parsed.data.email.toLowerCase();
  const invitedBy = session.user.userId;

  try {
    await db
      .insert(allowedEmails)
      .values({ email, invited_by: invitedBy })
      .onConflictDoNothing();

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
