import { NextResponse } from "next/server";
import { z } from "zod";
import { auth, signOut } from "@/lib/auth";
import { checkCsrf } from "@/lib/csrf";
import { requestIp } from "@/lib/request-ip";
import { deleteAccount, deletionConfirmed } from "@/lib/account-deletion";

const deleteSchema = z.object({
  confirmEmail: z.string().max(320),
});

/**
 * DELETE /api/account
 * The signed-in user deletes their own account (Settings, danger zone). See
 * lib/account-deletion.ts for what goes and what is kept.
 *
 * Confirmed by typing the account's address. Safe to repeat: a second call on
 * an account already deleted finishes any step an earlier one did not reach.
 */
export async function DELETE(req: Request) {
  const csrfError = checkCsrf(req, { strict: true });
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.userId || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  if (!deletionConfirmed(parsed.data.confirmEmail, session.user.email)) {
    return NextResponse.json(
      { error: "Type your email address exactly as shown to confirm." },
      { status: 400 },
    );
  }

  try {
    const result = await deleteAccount(session.user.userId, requestIp(req));
    if (!result) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } catch (err) {
    // A failed step leaves the account usable and the rest undone; the user
    // can retry. Postgres keeps row values in the error's detail, not its
    // message, so the message is safe to log.
    console.error("[account] deletion failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json(
      { error: "Your account could not be deleted. Please try again." },
      { status: 500 },
    );
  }

  // Clear this browser's session cookie in this response, so the deletion
  // takes effect here at once rather than at the next revalidation. Other
  // browsers signed in to the account are cut off by lib/session-revalidation
  // within SESSION_REVALIDATE_MS. The client signs out too, so a failure here
  // only loses the belt, not the braces.
  try {
    await signOut({ redirect: false });
  } catch (err) {
    console.warn(
      "[account] could not clear the session cookie after deletion",
      err instanceof Error ? err.message : "unknown",
    );
  }

  return NextResponse.json({ ok: true });
}
