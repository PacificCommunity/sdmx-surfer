import { NextResponse } from "next/server";
import { z } from "zod";
import { like } from "drizzle-orm";
import { randomInt } from "node:crypto";
import { db, allowedEmails, authEvents, authUsers } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";
import { hashPassword } from "@/lib/password";
import { generatePassphrase } from "@/lib/passphrase";
import {
  TRAINEE_EMAIL_DOMAIN,
  codeMatches,
  pickFreeSlot,
  traineeEmail,
  traineeSlot,
  trainingEnabled,
} from "@/lib/training-access";

/**
 * Hand a workshop participant their own throwaway account.
 *
 * One shared code, typed on /training, in exchange for a trainee address and a
 * generated passphrase. Everyone gets a separate account, so sessions do not
 * collide, the per-user turn cap applies per person, and one participant
 * mistyping a password cannot lock anyone else out.
 *
 * The route answers 404 unless TRAINING_MODE is on and a code is configured, so
 * on any ordinary deployment it does not exist.
 */

const bodySchema = z.object({ code: z.string().min(1).max(200) });

/** Attempts to win the race for a slot before giving up. */
const MAX_ATTEMPTS = 5;

export async function POST(req: Request) {
  if (!trainingEnabled()) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const csrf = checkCsrf(req);
  if (csrf) return csrf;

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  if (!codeMatches(parsed.data.code, process.env.TRAINING_ACCESS_CODE)) {
    await db
      .insert(authEvents)
      .values({ email: "", event_type: "training_claim_denied" })
      .catch(() => {});
    return NextResponse.json({ error: "That code is not right." }, { status: 401 });
  }

  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const rows = await db
      .select({ email: authUsers.email })
      .from(authUsers)
      .where(like(authUsers.email, "trainee-%@" + TRAINEE_EMAIL_DOMAIN));
    const taken = rows
      .map((r) => traineeSlot(r.email))
      .filter((slot): slot is number => slot !== null);

    const slot = pickFreeSlot(taken, randomInt);
    if (slot === null) {
      return NextResponse.json(
        { error: "Every training account is in use. Ask the facilitator." },
        { status: 503 },
      );
    }

    const email = traineeEmail(slot);
    const password = generatePassphrase();

    // The driver has no transactions, so the unique index on the address is
    // what settles a race: losing the insert means someone claimed this slot in
    // between, and the next attempt picks another one.
    const created = await db
      .insert(authUsers)
      .values({
        email,
        name: "Trainee " + String(slot).padStart(2, "0"),
        password_hash: await hashPassword(password),
        emailVerified: new Date(),
      })
      .onConflictDoNothing({ target: authUsers.email })
      .returning({ id: authUsers.id });
    if (created.length === 0) continue;

    await db.insert(allowedEmails).values({ email }).onConflictDoNothing();
    await db
      .insert(authEvents)
      .values({
        user_id: created[0].id,
        email,
        event_type: "training_claim",
        metadata: { slot },
      })
      .catch(() => {});

    return NextResponse.json({ email, password }, { status: 201 });
  }

  return NextResponse.json(
    { error: "Could not allocate an account. Try once more." },
    { status: 409 },
  );
}
