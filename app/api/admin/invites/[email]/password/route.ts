import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db, allowedEmails, authUsers, authEvents } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";
import { generatePassphrase } from "@/lib/passphrase";
import { hashPassword } from "@/lib/password";

/**
 * POST   /api/admin/invites/[email]/password
 *   Generate a new passphrase for the invited email, upsert the auth_users
 *   row if needed, store the argon2id hash, clear any lockout. Returns the
 *   plaintext passphrase ONCE so the admin can pass it to the user.
 *
 * DELETE /api/admin/invites/[email]/password
 *   Clear the password_hash so password login is disabled for that user.
 *   Magic-link sign-in still works. Useful for revoking a leaked password.
 */

async function guard(req: Request) {
  const csrfError = checkCsrf(req);
  if (csrfError) return { response: csrfError };
  const session = await auth();
  if (!session?.user?.userId) {
    return {
      response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }),
    };
  }
  if (session.user.role !== "admin") {
    return {
      response: NextResponse.json({ error: "Forbidden" }, { status: 403 }),
    };
  }
  return { session };
}

export async function POST(
  req: Request,
  { params }: { params: Promise<{ email: string }> },
) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const adminId = g.session.user.userId;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  // Require the email to be on the allowlist (no silent provisioning).
  const allow = await db
    .select({ email: allowedEmails.email })
    .from(allowedEmails)
    .where(eq(allowedEmails.email, email))
    .limit(1);
  if (allow.length === 0) {
    return NextResponse.json(
      { error: "Email not on allowlist" },
      { status: 404 },
    );
  }

  const passphrase = generatePassphrase();
  const passwordHash = await hashPassword(passphrase);

  try {
    // Upsert: if the user hasn't signed in yet, create the row.
    const existing = await db
      .select({ id: authUsers.id })
      .from(authUsers)
      .where(eq(authUsers.email, email))
      .limit(1);

    let userId: string;
    if (existing.length > 0) {
      userId = existing[0].id;
      await db
        .update(authUsers)
        .set({
          password_hash: passwordHash,
          failed_attempts: 0,
          locked_until: null,
        })
        .where(eq(authUsers.id, userId));
    } else {
      const [inserted] = await db
        .insert(authUsers)
        .values({
          email,
          password_hash: passwordHash,
        })
        .returning({ id: authUsers.id });
      userId = inserted.id;
    }

    await db.insert(authEvents).values({
      user_id: userId,
      email,
      event_type: "password_set",
      actor_user_id: adminId,
    });

    return NextResponse.json({ ok: true, email, passphrase });
  } catch (err) {
    console.error("[admin/password] POST error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ email: string }> },
) {
  const g = await guard(req);
  if ("response" in g) return g.response;
  const adminId = g.session.user.userId;

  const { email: rawEmail } = await params;
  const email = decodeURIComponent(rawEmail).toLowerCase();

  try {
    const [updated] = await db
      .update(authUsers)
      .set({ password_hash: null, failed_attempts: 0, locked_until: null })
      .where(eq(authUsers.email, email))
      .returning({ id: authUsers.id });

    if (updated) {
      await db.insert(authEvents).values({
        user_id: updated.id,
        email,
        event_type: "password_cleared",
        actor_user_id: adminId,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/password] DELETE error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
