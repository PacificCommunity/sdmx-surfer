import { db, authMagicLinkRefs } from "@/lib/db";
import { eq, and, gt, isNull } from "drizzle-orm";

/**
 * GET /api/auth/magic-link-ref?ref=<id>
 *
 * Resolves a magic link reference ID to the actual callback URL.
 * The ref is single-use and time-limited (15 minutes).
 * Returns { url } on success, { error } on failure.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const refId = url.searchParams.get("ref");

  if (!refId) {
    return Response.json({ error: "Missing ref parameter" }, { status: 400 });
  }

  try {
    // Find the ref — must exist, not be expired, and not already used
    const [row] = await db
      .select()
      .from(authMagicLinkRefs)
      .where(
        and(
          eq(authMagicLinkRefs.refId, refId),
          gt(authMagicLinkRefs.expiresAt, new Date()),
          isNull(authMagicLinkRefs.usedAt),
        ),
      )
      .limit(1);

    if (!row) {
      return Response.json(
        { error: "Link expired or already used" },
        { status: 410 },
      );
    }

    // Mark as used
    await db
      .update(authMagicLinkRefs)
      .set({ usedAt: new Date() })
      .where(eq(authMagicLinkRefs.refId, refId));

    return Response.json({ url: row.callbackUrl });
  } catch (err) {
    console.error("Failed to resolve magic link ref:", err);
    return Response.json({ error: "Internal error" }, { status: 500 });
  }
}
