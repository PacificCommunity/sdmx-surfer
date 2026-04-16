import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, authUsers, authEvents } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";
import {
  hashPassword,
  verifyPassword,
  validatePasswordShape,
  isLocked,
} from "@/lib/password";

const changeSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(1),
});

/**
 * PUT /api/account/password
 * Signed-in user rotates their own password.
 *
 * Requires the current password. Succeeds only if it matches the stored hash.
 * Generic error messages on failure to avoid revealing state.
 */
export async function PUT(req: Request) {
  const csrfError = checkCsrf(req);
  if (csrfError) return csrfError;

  const session = await auth();
  if (!session?.user?.userId || !session.user.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.userId;
  const email = session.user.email.toLowerCase();

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = changeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const shape = validatePasswordShape(parsed.data.newPassword);
  if (!shape.ok) {
    return NextResponse.json({ error: shape.reason }, { status: 400 });
  }

  const [user] = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // If the user has no password set (magic-link only), we require them to
  // have an admin set one first. This keeps the "admin provisions" invariant.
  if (!user.password_hash) {
    return NextResponse.json(
      {
        error:
          "Your account does not have a password set. Ask an admin to provision one.",
      },
      { status: 400 },
    );
  }

  if (isLocked(user.locked_until)) {
    return NextResponse.json(
      { error: "Account temporarily locked. Try again later." },
      { status: 423 },
    );
  }

  const ok = await verifyPassword(user.password_hash, parsed.data.currentPassword);
  if (!ok) {
    return NextResponse.json({ error: "Current password is incorrect." }, { status: 400 });
  }

  const newHash = await hashPassword(parsed.data.newPassword);
  await db
    .update(authUsers)
    .set({ password_hash: newHash, failed_attempts: 0, locked_until: null })
    .where(eq(authUsers.id, userId));

  try {
    await db.insert(authEvents).values({
      user_id: userId,
      email,
      event_type: "password_self_change",
      actor_user_id: userId,
    });
  } catch {
    // audit failures must not block the response
  }

  return NextResponse.json({ ok: true });
}
