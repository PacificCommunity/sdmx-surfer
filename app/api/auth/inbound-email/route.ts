import { NextResponse } from "next/server";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import { Resend, type WebhookEventPayload } from "resend";
import { db, emailProofs, authEvents } from "@/lib/db";
import {
  emailProofConfig,
  emailProofVerdict,
  parseVerifyAddress,
  proofStateProblem,
  type EmailProofRejection,
} from "@/lib/email-proof";
import type { EmailProof } from "@/lib/db/schema";

export const runtime = "nodejs";

// The Resend SDK's received-email type has no `authentication`, so the
// message is fetched directly and checked here. Results are documented as
// pass | fail | gray | processing_failed | unknown; read as plain strings so an
// undocumented value lands as "not pass" instead of failing the parse.
const authResult = z.string().nullish();
const receivedEmailSchema = z.object({
  from: z.string(),
  authentication: z
    .object({ spf: authResult, dkim: authResult, dmarc: authResult })
    .nullish(),
});
type ReceivedEmail = z.infer<typeof receivedEmailSchema>;

async function fetchReceivedEmail(
  emailId: string,
  apiKey: string,
): Promise<ReceivedEmail | null> {
  try {
    const res = await fetch(
      "https://api.resend.com/emails/receiving/" + encodeURIComponent(emailId),
      { headers: { Authorization: "Bearer " + apiKey }, cache: "no-store" },
    );
    if (!res.ok) {
      console.error("[email-proof] fetching received email failed:", res.status);
      return null;
    }
    const parsed = receivedEmailSchema.safeParse(await res.json());
    if (!parsed.success) {
      console.error("[email-proof] unexpected received-email shape:", parsed.error.message);
      return null;
    }
    return parsed.data;
  } catch (err) {
    console.error("[email-proof] fetching received email failed:", err);
    return null;
  }
}

async function recordOutcome(
  proof: EmailProof,
  reason: EmailProofRejection | null,
  message: ReceivedEmail | null,
): Promise<void> {
  try {
    await db.insert(authEvents).values({
      email: proof.email,
      event_type: reason ? "email_proof_rejected" : "email_proof_verified",
      metadata: {
        code: proof.code,
        purpose: proof.purpose,
        ...(reason ? { reason } : {}),
        ...(message ? { from: message.from, authentication: message.authentication ?? null } : {}),
      },
    });
  } catch {
    // audit logging must never block the auth path
  }
}

async function settleProof(code: string, emailId: string, apiKey: string): Promise<void> {
  const [proof] = await db
    .select()
    .from(emailProofs)
    .where(eq(emailProofs.code, code))
    .limit(1);
  // Dev and prod may share the inbound domain and both receive every
  // delivery; a code this deployment never issued is someone else's.
  if (!proof) return;

  const now = new Date();
  const stateProblem = proofStateProblem(proof, now);
  if (stateProblem) {
    // Already final, or past its time: record the attempt, leave the row alone.
    await recordOutcome(proof, stateProblem, null);
    return;
  }

  const message = await fetchReceivedEmail(emailId, apiKey);
  const verdict = message
    ? emailProofVerdict(proof, message, now)
    : ({ verified: false, reason: "unverifiable" } as const);
  const reason = verdict.verified ? null : verdict.reason;

  // Conditional on the row still waiting, so a concurrent delivery for the
  // same code cannot overwrite the first verdict.
  await db
    .update(emailProofs)
    .set(reason ? { rejection: reason } : { verified_at: now })
    .where(
      and(
        eq(emailProofs.id, proof.id),
        isNull(emailProofs.verified_at),
        isNull(emailProofs.consumed_at),
        isNull(emailProofs.rejection),
      ),
    );
  await recordOutcome(proof, reason, message);
}

/**
 * POST /api/auth/inbound-email
 *
 * Resend Receiving webhook. For each `verify-<code>@INBOUND_EMAIL_DOMAIN`
 * recipient, fetches the received message's authentication results and marks
 * the matching proof verified or rejected (see emailProofVerdict).
 *
 * Answers 200 to every correctly signed delivery, whatever became of it, so
 * Resend does not retry a message that will never verify.
 */
export async function POST(req: Request) {
  const config = emailProofConfig();
  if (!config) {
    return NextResponse.json({ error: "Not configured" }, { status: 503 });
  }

  const payload = await req.text();
  const id = req.headers.get("svix-id");
  const timestamp = req.headers.get("svix-timestamp");
  const signature = req.headers.get("svix-signature");
  if (!id || !timestamp || !signature) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: WebhookEventPayload;
  try {
    event = new Resend(config.receivingApiKey).webhooks.verify({
      payload,
      headers: { id, timestamp, signature },
      webhookSecret: config.webhookSecret,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  if (event.type !== "email.received") return NextResponse.json({ ok: true });

  const codes = new Set<string>();
  for (const recipient of event.data.to) {
    const code = parseVerifyAddress(recipient, config.inboundDomain);
    if (code) codes.add(code);
  }

  for (const code of codes) {
    try {
      await settleProof(code, event.data.email_id, config.receivingApiKey);
    } catch (err) {
      console.error("[email-proof] settling proof failed:", code, err);
    }
  }

  return NextResponse.json({ ok: true });
}
