import { NextResponse } from "next/server";
import {
  verifyPassword,
  mintCookieValue,
  COOKIE,
  ensureAnonIdentity,
} from "@/lib/country-snapshots/auth";

// Spec §9: rate-limit the login form at 5 attempts per minute per IP.
// In-memory per instance — Fluid Compute reuses instances across requests,
// and a distributed attacker is out of scope for a shared-password gate.
const ATTEMPT_WINDOW_MS = 60_000;
const MAX_ATTEMPTS_PER_WINDOW = 5;
const attempts = new Map<string, number[]>();

function isThrottled(ip: string): boolean {
  const now = Date.now();
  const recent = (attempts.get(ip) ?? []).filter(
    (t) => now - t < ATTEMPT_WINDOW_MS,
  );
  recent.push(now);
  attempts.set(ip, recent);
  // Opportunistic cleanup so the map doesn't grow unboundedly.
  if (attempts.size > 1000) {
    for (const [key, times] of attempts) {
      if (times.every((t) => now - t >= ATTEMPT_WINDOW_MS)) attempts.delete(key);
    }
  }
  return recent.length > MAX_ATTEMPTS_PER_WINDOW;
}

/** Same-origin paths only — `new URL(next, base)` accepts absolute URLs,
 *  which would make the post-login redirect an open redirect. */
function safeNext(raw: string): string {
  if (!raw.startsWith("/") || raw.startsWith("//")) return "/countrysnapshots";
  return raw;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (isThrottled(ip)) {
    return NextResponse.json(
      { error: "Too many attempts. Try again in a minute." },
      { status: 429 },
    );
  }

  if (
    !process.env.COUNTRY_SNAPSHOTS_PASSWORD ||
    !process.env.NEXTAUTH_SECRET
  ) {
    console.error(
      "[country-snapshots/auth] COUNTRY_SNAPSHOTS_PASSWORD / NEXTAUTH_SECRET not set",
    );
    return NextResponse.json(
      { error: "Country Snapshots is not configured on this deployment." },
      { status: 503 },
    );
  }

  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = safeNext(String(form.get("next") ?? "/countrysnapshots"));

  try {
    if (!verifyPassword(password)) {
      return NextResponse.redirect(
        new URL(
          `/countrysnapshots/login?error=1&next=${encodeURIComponent(next)}`,
          req.url,
        ),
        303,
      );
    }

    const { value, uid } = mintCookieValue();
    await ensureAnonIdentity(uid);
    const res = NextResponse.redirect(new URL(next, req.url), 303);
    res.headers.set("Set-Cookie", COOKIE.serialize(value));
    return res;
  } catch (error) {
    // verifyPassword/mintCookieValue throw when NEXTAUTH_SECRET or
    // COUNTRY_SNAPSHOTS_PASSWORD is missing — a deployment problem, not a
    // user error. Surface it clearly instead of a bare 500.
    console.error("[country-snapshots/auth] configuration error", error);
    return NextResponse.json(
      { error: "Country Snapshots is not configured on this deployment." },
      { status: 503 },
    );
  }
}
