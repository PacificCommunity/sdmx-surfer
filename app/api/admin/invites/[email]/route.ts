import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, allowedEmails } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

// ---------------------------------------------------------------------------
// DELETE /api/admin/invites/[email] — remove an email from the allowlist
// ---------------------------------------------------------------------------

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ email: string }> },
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

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  try {
    await db
      .delete(allowedEmails)
      .where(eq(allowedEmails.email, email));

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
