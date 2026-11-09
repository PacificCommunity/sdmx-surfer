import { NextResponse } from "next/server";
import { checkBotId } from "botid/server";
import { z } from "zod";
import { and, count, eq, gte, lt } from "drizzle-orm";
import { db, emailProofs, authEvents } from "@/lib/db";
import { checkCsrf } from "@/lib/csrf";
import { hashPassword, validatePasswordShape } from "@/lib/password";
import { isEmailAdmitted } from "@/lib/admission";
import { requestIp } from "@/lib/request-ip";
import {
  EMAIL_PROOF_COMPLETION_MS,
  EMAIL_PROOF_COOKIE,
  EMAIL_PROOF_COOKIE_PATH,
  EMAIL_PROOF_HOURLY_LIMIT,
  EMAIL_PROOF_TTL_MS,
  emailProofConfig,
  emailProofCookieValue,
  generateProofCode,
  hashProofSecret,
  newProofSecret,
  normaliseProofEmail,
  proofMessage,
  verifyAddressFor,
} from "@/lib/email-proof";

export const runtime = "nodejs";

const startSchema = z.object({
  email: z.string(),
  password: z.string(),
  purpose: z.enum(["signup", "reset"]),
});

const HOUR_MS = 60 * 60 * 1000;

/**
 * POST /api/auth/email-proof/start
 *
 * Begins a self-service signup or password reset. Stores the chosen password's
 * hash against a fresh code and answers with the address the user must mail
 * from their work account. The browser gets a secret cookie that the status
 * poll and the final sign-in both require. See lib/email-proof.ts.
 *
 * Signup and reset are the same operation (completion upserts the account), so
 * nothing here depends on, or reveals, whether an account already exists.
 */
export async function POST(req: Request) {
  const csrfError = checkCsrf(req, { strict: true });
  if (csrfError) return csrfError;

  const config = emailProofConfig();
  if (!config) {
    return NextResponse.json({ error: "Self-service accounts are not enabled." }, { status: 503 });
  }

  // Registered for BotID in instrumentation-client.ts.
  if ((await checkBotId()).isBot) {
    return NextResponse.json({ error: "Automated requests are not allowed." }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = startSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }

  const email = normaliseProofEmail(parsed.data.email);
  if (!email) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }
  const shape = validatePasswordShape(parsed.data.password);
  if (!shape.ok) {
    return NextResponse.json({ error: shape.reason }, { status: 400 });
  }

  const ip = requestIp(req);
  const windowStart = new Date(Date.now() - HOUR_MS);
  const [byEmail] = await db
    .select({ count: count(emailProofs.id) })
    .from(emailProofs)
    .where(and(eq(emailProofs.email, email), gte(emailProofs.created_at, windowStart)));
  const [byIp] = ip
    ? await db
        .select({ count: count(emailProofs.id) })
        .from(emailProofs)
        .where(and(eq(emailProofs.ip, ip), gte(emailProofs.created_at, windowStart)))
    : [];
  if (
    Number(byEmail?.count ?? 0) >= EMAIL_PROOF_HOURLY_LIMIT ||
    Number(byIp?.count ?? 0) >= EMAIL_PROOF_HOURLY_LIMIT
  ) {
    return NextResponse.json(
      { error: "Too many attempts. Please wait an hour and try again." },
      { status: 429 },
    );
  }

  if (!(await isEmailAdmitted(email))) {
    return NextResponse.json(
      {
        error:
          "This address isn't admitted: it needs an approved organisation " +
          "domain or an invitation. Contact your SPC administrator to request access.",
      },
      { status: 403 },
    );
  }

  // Proofs older than a day are past every window (TTL, completion, hourly
  // limit); drop them so stale password hashes don't accumulate.
  await db.delete(emailProofs).where(lt(emailProofs.created_at, new Date(Date.now() - 24 * 60 * 60 * 1000)));

  const code = generateProofCode();
  const secret = newProofSecret();
  const expiresAt = new Date(Date.now() + EMAIL_PROOF_TTL_MS);
  const [proof] = await db
    .insert(emailProofs)
    .values({
      code,
      email,
      purpose: parsed.data.purpose,
      password_hash: await hashPassword(parsed.data.password),
      browser_secret_hash: hashProofSecret(secret),
      ip,
      expires_at: expiresAt,
    })
    .returning({ id: emailProofs.id });

  try {
    await db.insert(authEvents).values({
      email,
      event_type: "email_proof_started",
      ip,
      metadata: { purpose: parsed.data.purpose, code },
    });
  } catch {
    // audit logging must never block the auth path
  }

  const { subject, body: messageBody } = proofMessage(code);
  const res = NextResponse.json({
    proofId: proof.id,
    address: verifyAddressFor(code, config.inboundDomain),
    subject,
    body: messageBody,
    expiresAt: expiresAt.toISOString(),
  });
  res.cookies.set(EMAIL_PROOF_COOKIE, emailProofCookieValue(proof.id, secret), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: EMAIL_PROOF_COOKIE_PATH,
    // Covers the wait for the email plus the completion window after it.
    maxAge: (EMAIL_PROOF_TTL_MS + EMAIL_PROOF_COMPLETION_MS) / 1000,
  });
  return res;
}
