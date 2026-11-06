/**
 * The client address of a request, as reported by the proxy in front of us.
 *
 * Takes a Web `Request` (route handlers, and Auth.js v5's credentials
 * `authorize`), whose headers are a `Headers` object. `x-forwarded-for` may hold
 * a comma-separated chain; the first entry is the client.
 */
export function requestIp(request: Request | undefined): string | null {
  const headers = request?.headers;
  if (!headers || typeof headers.get !== "function") return null;
  const raw = headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  if (!raw) return null;
  const first = raw.split(",")[0]?.trim();
  return first || null;
}
