import { NextResponse } from "next/server";
import { z } from "zod";
import { and, count, eq, gte } from "drizzle-orm";
import { db, authUsers, authEvents } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";
import { hashPassword, validatePasswordShape } from "@/lib/password";
import { isEmailAdmitted } from "@/lib/admission";
import { requestIp } from "@/lib/request-ip";
import { normaliseProofEmail } from "@/lib/email-proof";
import { emailDomain } from "@/lib/signup-policy";
import {
  UNVERIFIED_SIGNUP_EVENT,
  UNVERIFIED_SIGNUP_GLOBAL_HOURLY_LIMIT,
  UNVERIFIED_SIGNUP_IP_HOURLY_LIMIT,
  describeDomainRules,
  unverifiedSignupAllows,
  unverifiedSignupDomains,
} from "@/lib/unverified-signup";

export const runtime = "nodejs";

const signupSchema = z.object({
  email: z.string(),
  password: z.string(),
});

const HOUR_MS = 60 * 60 * 1000;

/**
 * POST /api/auth/signup
 *
 * Creates a password account for an address at a `UNVERIFIED_SIGNUP_DOMAINS`
 * domain WITHOUT proving the address (see lib/unverified-signup.ts). Only ever
 * inserts: an existing account answers 409 and is left untouched, because
 * setting its password here would hand it to whoever typed the address.
 */
export async function POST(req: Request) {
  const csrfError = checkCsrf(req, { strict: true });
  if (csrfError) return csrfError;

  const rules = unverifiedSignupDomains();
  if (rules.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const body: unknown = await req.json().catch(() => null);
  const parsed = signupSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const email = normaliseProofEmail(parsed.data.email);
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  if (!unverifiedSignupAllows(email, rules) || !(await isEmailAdmitted(email))) {
    return NextResponse.json(
      {
        error:
          "Self-service accounts are only open to addresses at " +
          describeDomainRules(rules) +
          "; ask the Surfer admin for access.",
      },
      { status: 403 },
    );
  }

  const shape = validatePasswordShape(parsed.data.password);
  if (!shape.ok) {
    return NextResponse.json({ error: shape.reason }, { status: 400 });
  }

  const ip = requestIp(req);
  const recentSignups = and(
    eq(authEvents.event_type, UNVERIFIED_SIGNUP_EVENT),
    gte(authEvents.created_at, new Date(Date.now() - HOUR_MS)),
  );
  const [overall] = await db
    .select({ count: count(authEvents.id) })
    .from(authEvents)
    .where(recentSignups);
  const [byIp] = ip
    ? await db
        .select({ count: count(authEvents.id) })
        .from(authEvents)
        .where(and(recentSignups, eq(authEvents.ip, ip)))
    : [];
  if (
    Number(overall?.count ?? 0) >= UNVERIFIED_SIGNUP_GLOBAL_HOURLY_LIMIT ||
    Number(byIp?.count ?? 0) >= UNVERIFIED_SIGNUP_IP_HOURLY_LIMIT
  ) {
    return NextResponse.json(
      { error: "Too many new accounts right now. Please try again in an hour." },
      { status: 429 },
    );
  }

  const [created] = await db
    .insert(authUsers)
    .values({
      email,
      role: "user",
      password_hash: await hashPassword(parsed.data.password),
      emailVerified: null,
    })
    .onConflictDoNothing({ target: authUsers.email })
    .returning({ id: authUsers.id });
  if (!created) {
    return NextResponse.json(
      {
        error:
          "An account already exists for this address. Sign in with its " +
          "password, or ask the Surfer admin to reset it.",
      },
      { status: 409 },
    );
  }

  try {
    await db.insert(authEvents).values({
      email,
      event_type: UNVERIFIED_SIGNUP_EVENT,
      ip,
      user_id: created.id,
      metadata: { domain: emailDomain(email) },
    });
  } catch (err) {
    // The account exists either way; a lost row only weakens the throttle.
    console.error("[auth] could not record unverified_signup event", err);
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
