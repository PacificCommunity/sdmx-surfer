/**
 * Simple CSRF check for mutating API routes.
 * Verifies the Origin header matches the expected app URL.
 * Returns null if OK, or an error Response if the check fails.
 */
export function checkCsrf(
  req: Request,
  options?: { strict?: boolean },
): Response | null {
  const origin = req.headers.get("origin");
  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const expected = new URL(appUrl).origin;
  const strict = options?.strict ?? false;

  // Some routes are intentionally curl-friendly in local development, but the
  // sensitive cookie-backed account/admin writes should fail closed.
  if (!origin) {
    if (!strict) return null;
    return Response.json(
      { error: "CSRF check failed: missing origin" },
      { status: 403 },
    );
  }

  if (origin !== expected) {
    return Response.json(
      { error: "CSRF check failed: origin mismatch" },
      { status: 403 },
    );
  }

  return null;
}
