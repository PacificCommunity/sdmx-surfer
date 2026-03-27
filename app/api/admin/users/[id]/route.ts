import { NextResponse } from "next/server";
import { z } from "zod";
import { eq, count } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, authUsers } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

const patchSchema = z.object({
  role: z.enum(["admin", "user"]),
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/[id] — update a user's role
// ---------------------------------------------------------------------------

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const { role } = parsed.data;

  // Prevent self-demotion
  if (id === session.user.userId && role !== "admin") {
    return NextResponse.json(
      { error: "Cannot demote yourself. Ask another admin." },
      { status: 400 },
    );
  }

  try {
    // Prevent removing the last admin
    if (role === "user") {
      const [result] = await db
        .select({ adminCount: count() })
        .from(authUsers)
        .where(eq(authUsers.role, "admin"));
      if ((result?.adminCount ?? 0) <= 1) {
        return NextResponse.json(
          { error: "Cannot remove the last admin." },
          { status: 400 },
        );
      }
    }

    await db
      .update(authUsers)
      .set({ role })
      .where(eq(authUsers.id, id));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
