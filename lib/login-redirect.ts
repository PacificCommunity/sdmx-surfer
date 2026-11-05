/**
 * Build the `/login` URL that returns the visitor to `callbackPath` after
 * sign-in.
 *
 * The login page only honours a same-origin path in `callbackUrl` (it falls
 * back to "/" for anything absolute or protocol-relative), so callers must
 * pass `pathname + search`, never an absolute URL. Anything that is not a
 * same-origin path is replaced with "/" here as well, so a crafted request
 * path can never turn the sign-in round-trip into an open redirect.
 *
 * Edge-safe (no imports): used by the proxy as well as Node route handlers.
 */
export function loginPathWithCallback(callbackPath: string): string {
  const safe =
    callbackPath.startsWith("/") &&
    !callbackPath.startsWith("//") &&
    !callbackPath.startsWith("/\\")
      ? callbackPath
      : "/";
  return `/login?callbackUrl=${encodeURIComponent(safe)}`;
}
