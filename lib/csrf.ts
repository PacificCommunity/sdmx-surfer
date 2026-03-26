/**
 * Simple CSRF check for mutating API routes.
 * Verifies the Origin header matches the expected app URL.
 * Returns null if OK, or an error Response if the check fails.
 */
export function checkCsrf(req: Request): Response | null {
  const origin = req.headers.get("origin");
  const appUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
  const expected = new URL(appUrl).origin;

  // Allow requests with no Origin (same-origin fetch, curl, server-side)
  if (!origin) return null;

  if (origin !== expected) {
    return Response.json(
      { error: "CSRF check failed: origin mismatch" },
      { status: 403 },
    );
  }

  return null;
}
