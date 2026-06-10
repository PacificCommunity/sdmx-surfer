import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db, authUsers } from "@/lib/db";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "cs_session";

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required for snapshot cookie signing");
  return s;
}

function passwordHash(): string {
  // Token version: HMAC(secret, password). Rotating the password invalidates outstanding cookies.
  const pw = process.env.COUNTRY_SNAPSHOTS_PASSWORD;
  if (!pw) throw new Error("COUNTRY_SNAPSHOTS_PASSWORD is required");
  return createHmac("sha256", secret()).update(pw).digest("hex").slice(0, 8);
}

export function verifyPassword(candidate: string): boolean {
  const expected = process.env.COUNTRY_SNAPSHOTS_PASSWORD ?? "";
  if (!expected) return false;
  // Compare HMAC digests rather than the raw strings: digests are always
  // equal-length buffers, so timingSafeEqual can't throw on multibyte
  // input (string .length counts UTF-16 units, not bytes), and the
  // comparison stays constant-time.
  const key = secret();
  const a = createHmac("sha256", key).update(candidate).digest();
  const b = createHmac("sha256", key).update(expected).digest();
  return timingSafeEqual(a, b);
}

type Payload = { uid: string; v: string };

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyCookie(token: string | undefined): Payload | null {
  if (!token) return null;
  // Missing NEXTAUTH_SECRET / COUNTRY_SNAPSHOTS_PASSWORD must mean
  // "not authenticated", never a 500 — verifyCookie runs in the layout
  // gate and on the login page itself, so a thrown config error would
  // brick the whole area including the page that explains the problem.
  try {
    const [body, sig] = token.split(".");
    if (!body || !sig) return null;
    const expected = createHmac("sha256", secret())
      .update(body)
      .digest("base64url");
    if (sig.length !== expected.length) return null;
    if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
    const payload = JSON.parse(
      Buffer.from(body, "base64url").toString("utf8"),
    ) as Payload;
    if (payload.v !== passwordHash()) return null;
    return payload;
  } catch {
    return null;
  }
}

export function mintCookieValue(): { value: string; uid: string } {
  const uid = randomUUID();
  return { value: sign({ uid, v: passwordHash() }), uid };
}

export const COOKIE = {
  name: COOKIE_NAME,
  serialize(value: string): string {
    const maxAge = 60 * 60 * 24 * 30;
    return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  },
};

/** Ensure a snapshot_anon row exists in authUsers for this cookie's uid. */
export async function ensureAnonIdentity(uid: string): Promise<string> {
  const userId = `snapshot_anon_${uid}`;
  const existing = await db
    .select()
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  if (existing.length === 0) {
    // onConflictDoNothing: the warm ping and the first chat turn can race
    // here on a brand-new cookie; losing the race must not 500.
    await db
      .insert(authUsers)
      .values({
        id: userId,
        email: `${userId}@snapshot.local`,
        role: "snapshot_anon",
      })
      .onConflictDoNothing();
  }
  return userId;
}

/** Used by API routes: returns the resolved snapshot identity or null. */
export async function requireSnapshotSession(): Promise<{
  uid: string;
  userId: string;
} | null> {
  const c = await cookies();
  const payload = verifyCookie(c.get(COOKIE_NAME)?.value);
  if (!payload) return null;
  const userId = await ensureAnonIdentity(payload.uid);
  return { uid: payload.uid, userId };
}
