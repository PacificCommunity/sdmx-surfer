import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, authVerificationTokens } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";

// DELETE /api/admin/invites/[email]/magic-links
// Clears all verification tokens for an identifier so the user can request
// a fresh magic link without waiting for the old ones to expire.
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
    const deleted = await db
      .delete(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, email))
      .returning({ token: authVerificationTokens.token });

    return NextResponse.json({ ok: true, cleared: deleted.length });
  } catch (err) {
    console.error("[admin/invites/magic-links] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
