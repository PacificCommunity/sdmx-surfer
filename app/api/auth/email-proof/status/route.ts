import { NextResponse } from "next/server";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, emailProofs } from "@/lib/db";
import {
  emailProofStatus,
  proofSecretFromCookieHeader,
  proofSecretMatches,
} from "@/lib/email-proof";

export const runtime = "nodejs";

const proofIdSchema = z.uuid();

/**
 * GET /api/auth/email-proof/status?id=<proofId>
 *
 * Polled by the browser that started the proof. Answers only that browser:
 * without the matching secret cookie every id looks the same as an unknown one.
 */
export async function GET(req: Request) {
  const notFound = NextResponse.json({ error: "Not found" }, { status: 404 });

  const proofId = proofIdSchema.safeParse(new URL(req.url).searchParams.get("id"));
  if (!proofId.success) return notFound;

  const secret = proofSecretFromCookieHeader(req.headers.get("cookie"), proofId.data);
  if (!secret) return notFound;

  const [proof] = await db
    .select()
    .from(emailProofs)
    .where(eq(emailProofs.id, proofId.data))
    .limit(1);
  if (!proof || !proofSecretMatches(secret, proof.browser_secret_hash)) return notFound;

  return NextResponse.json(emailProofStatus(proof, new Date()), {
    headers: { "Cache-Control": "no-store" },
  });
}
