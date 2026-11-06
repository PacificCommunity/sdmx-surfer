/**
 * Self-service accounts proved by an email the user SENDS to us.
 *
 * Why inbound: partner mail systems (SPC's Exchange in particular) silently
 * swallow outbound sign-in links, while every partner domain publishes a strict
 * DMARC policy. So instead of mailing the user, we ask them to mail us: they
 * choose a password, send one message to `verify-<code>@INBOUND_EMAIL_DOMAIN`,
 * and Resend Receiving tells us (via a signed webhook) how that message
 * authenticated. A DMARC pass means the sending domain's own infrastructure
 * vouched for the From domain; an exact From match against the address being
 * proved ties it to the mailbox. Nothing is ever sent into the user's inbox.
 *
 * Everything here is pure (no database, no network) so it can be tested
 * directly. The routes under app/api/auth/email-proof, the inbound webhook and
 * the `email-proof` credentials provider in lib/auth.ts do the I/O.
 */

import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import type { EmailProof } from "@/lib/db/schema";
import { normaliseDomain } from "@/lib/signup-policy";

/** How long a started proof waits for its email. */
export const EMAIL_PROOF_TTL_MS = 15 * 60 * 1000;
/** How long after verification the starting browser may complete sign-in. */
export const EMAIL_PROOF_COMPLETION_MS = 15 * 60 * 1000;
/** Proofs that may be started per address, and per IP, in an hour. */
export const EMAIL_PROOF_HOURLY_LIMIT = 5;

/** Holds `<proofId>.<secret>`; scoped to /api/auth so status and the Auth.js callback both see it. */
export const EMAIL_PROOF_COOKIE = "surfer_email_proof";
export const EMAIL_PROOF_COOKIE_PATH = "/api/auth";

export type EmailProofPurpose = EmailProof["purpose"];

export const EMAIL_PROOF_REJECTIONS = [
  /** The email arrived after the proof's 15 minutes. */
  "expired",
  /** The proof was already verified, rejected or consumed. */
  "already_used",
  /** Resend reported no DMARC result at all. */
  "no_authentication",
  /** DMARC ran and did not pass (fail, gray, processing_failed, unknown). */
  "dmarc_not_pass",
  /** The header From was not exactly the address being proved. */
  "sender_mismatch",
  /** We could not fetch the received message from Resend to check it. */
  "unverifiable",
] as const;
export type EmailProofRejection = (typeof EMAIL_PROOF_REJECTIONS)[number];

export type EmailProofStatus =
  | { status: "pending" }
  | { status: "verified" }
  | { status: "expired" }
  | { status: "rejected"; reason: EmailProofRejection };

export interface EmailProofConfig {
  /** Host receiving `verify-<code>@…` mail, normalised. */
  inboundDomain: string;
  /** Signing secret of the Resend webhook. */
  webhookSecret: string;
  /** Key allowed to read received emails from the Resend API. */
  receivingApiKey: string;
}

/**
 * The flow's configuration, or null when it is switched off. All three are
 * needed: without the domain there is nowhere to send, without the secret the
 * webhook cannot be trusted, without the key the message cannot be checked.
 */
export function emailProofConfig(): EmailProofConfig | null {
  const inboundDomain = normaliseDomain(process.env.INBOUND_EMAIL_DOMAIN ?? "");
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim() ?? "";
  const receivingApiKey = (
    process.env.RESEND_RECEIVING_API_KEY ||
    process.env.RESEND_API_KEY ||
    ""
  ).trim();
  if (!inboundDomain || !webhookSecret || !receivingApiKey) return null;
  return { inboundDomain, webhookSecret, receivingApiKey };
}

// A deliberately plain addr-spec: no quoted local parts, no comments, no
// IP-literal hosts. Anything stranger is refused rather than interpreted.
const ADDRESS = /^[^\s@<>"(),;:\\[\]]+@[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;
const MAX_ADDRESS_LENGTH = 254;

/** Trim and lowercase a typed address; null unless it is a plain address. */
export function normaliseProofEmail(raw: string): string | null {
  const email = raw.trim().toLowerCase();
  return email.length <= MAX_ADDRESS_LENGTH && ADDRESS.test(email) ? email : null;
}

/**
 * The single address in a From/To header value, lowercased, or null.
 *
 * Accepts `addr@host` and `Display Name <addr@host>`. Quoted display names are
 * blanked before looking for the angle brackets, so `"Eve <ceo@spc.int>"
 * <eve@evil.example>` yields the real mailbox. More than one mailbox, or
 * anything that is not a plain address, gives null.
 */
export function parseMailboxAddress(header: string): string | null {
  let candidate = header.replace(/"(?:[^"\\]|\\.)*"/g, '""').trim();
  if (candidate.includes("<") || candidate.includes(">")) {
    const angle = /^[^<>]*<([^<>]*)>$/.exec(candidate);
    if (!angle) return null;
    candidate = angle[1].trim();
  }
  return normaliseProofEmail(candidate);
}

const CODE_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
// 10 base32 characters = 50 bits. The code only routes a message to its row;
// the proof itself rests on DMARC, the From match and the browser secret.
const CODE_LENGTH = 10;
const VERIFY_LOCAL_PART = /^verify-([a-z2-7]{10})$/;

export function generateProofCode(): string {
  return Array.from({ length: CODE_LENGTH }, () => CODE_ALPHABET[randomInt(32)]).join("");
}

/** The address the user mails to prove ownership. */
export function verifyAddressFor(code: string, inboundDomain: string): string {
  return "verify-" + code + "@" + inboundDomain;
}

/**
 * The proof code in a recipient address, or null when the address is not one
 * of ours: a different domain, a different local part, plus-addressing or
 * anything else that is not exactly `verify-<code>@<inboundDomain>`.
 */
export function parseVerifyAddress(address: string, inboundDomain: string): string | null {
  const mailbox = parseMailboxAddress(address);
  if (!mailbox) return null;
  const at = mailbox.lastIndexOf("@");
  if (mailbox.slice(at + 1) !== normaliseDomain(inboundDomain)) return null;
  return VERIFY_LOCAL_PART.exec(mailbox.slice(0, at))?.[1] ?? null;
}

/** Subject and body prefilled into the user's mail client. Content is not checked. */
export function proofMessage(code: string): { subject: string; body: string } {
  return {
    subject: "SDMX Surfer verification " + code,
    body: "Please verify my SDMX Surfer account. Code: " + code,
  };
}

/** A fresh browser secret; only its hash is stored. */
export function newProofSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashProofSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

export function proofSecretMatches(secret: string, storedHash: string): boolean {
  const presented = Buffer.from(hashProofSecret(secret), "hex");
  const stored = Buffer.from(storedHash, "hex");
  return presented.length === stored.length && timingSafeEqual(presented, stored);
}

export function emailProofCookieValue(proofId: string, secret: string): string {
  return proofId + "." + secret;
}

/** The browser secret for `proofId` from a Cookie header, or null. */
export function proofSecretFromCookieHeader(
  cookieHeader: string | null,
  proofId: string,
): string | null {
  if (!cookieHeader || !proofId) return null;
  for (const part of cookieHeader.split(";")) {
    const eq = part.indexOf("=");
    if (eq < 0 || part.slice(0, eq).trim() !== EMAIL_PROOF_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    const dot = value.indexOf(".");
    if (dot > 0 && value.slice(0, dot) === proofId && dot < value.length - 1) {
      return value.slice(dot + 1);
    }
  }
  return null;
}

/** The parts of an `email_proofs` row the decisions below read. */
export type EmailProofState = Pick<
  EmailProof,
  "email" | "expires_at" | "verified_at" | "consumed_at" | "rejection"
>;

/** What Resend reports about a received message, as far as the verdict needs. */
export interface ReceivedMessage {
  /** Header From, possibly `Name <addr>`. */
  from: string;
  authentication?: { dmarc?: string | null } | null;
}

/** Why a proof can no longer accept an email, or null while it is waiting for one. */
export function proofStateProblem(
  proof: EmailProofState,
  now: Date,
): "expired" | "already_used" | null {
  if (proof.verified_at || proof.consumed_at || proof.rejection) return "already_used";
  if (proof.expires_at.getTime() <= now.getTime()) return "expired";
  return null;
}

/**
 * Does this received message prove the address of this proof?
 *
 * DMARC must have passed: that is the sending organisation's own mail system
 * vouching that the From domain is genuine, which partner domains enforce
 * (p=quarantine / p=reject). Absent or null authentication is a rejection,
 * never a pass. Then the header From must be exactly the address being proved,
 * so a colleague on the same domain cannot prove someone else's address.
 */
export function emailProofVerdict(
  proof: EmailProofState,
  message: ReceivedMessage,
  now: Date,
): { verified: true } | { verified: false; reason: EmailProofRejection } {
  const stateProblem = proofStateProblem(proof, now);
  if (stateProblem) return { verified: false, reason: stateProblem };
  const dmarc = message.authentication?.dmarc;
  if (dmarc == null) return { verified: false, reason: "no_authentication" };
  if (dmarc !== "pass") return { verified: false, reason: "dmarc_not_pass" };
  if (parseMailboxAddress(message.from) !== proof.email) {
    return { verified: false, reason: "sender_mismatch" };
  }
  return { verified: true };
}

/** May the starting browser now turn this proof into a signed-in account? */
export function emailProofCanComplete(proof: EmailProofState, now: Date): boolean {
  return (
    proof.verified_at !== null &&
    proof.consumed_at === null &&
    proof.rejection === null &&
    now.getTime() < proof.verified_at.getTime() + EMAIL_PROOF_COMPLETION_MS
  );
}

/** What the waiting browser is told. A consumed proof reads as expired. */
export function emailProofStatus(proof: EmailProofState, now: Date): EmailProofStatus {
  if (proof.rejection === "expired") return { status: "expired" };
  if (proof.rejection) return { status: "rejected", reason: proof.rejection };
  if (proof.verified_at) {
    return emailProofCanComplete(proof, now) ? { status: "verified" } : { status: "expired" };
  }
  if (proof.consumed_at || proof.expires_at.getTime() <= now.getTime()) {
    return { status: "expired" };
  }
  return { status: "pending" };
}
