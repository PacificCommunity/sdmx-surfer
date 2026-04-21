import { NextRequest, NextResponse } from "next/server";
import { KEYED_HOSTS } from "@/lib/keyed-hosts";

// ---------------------------------------------------------------------------
// GET /api/sdmx-proxy?url=… — proxy SDMX fetches for hosts that require a
// subscription key. The key is read from env on every request and injected as
// the configured header; it never crosses the network to the browser.
// ---------------------------------------------------------------------------
//
// Defenses (since published dashboards at /p/[id] and the gallery are served
// unauthenticated, this route is necessarily public):
//   - Host allowlist — only hosts in lib/keyed-hosts.ts are forwarded.
//   - Path allowlist per host — narrows what the shared key can query.
//   - https required on the target URL.
//   - Loose Origin/Referer check — blocks requests with no browser context.
//   - Cache-Control gated on status: long cache for 2xx, brief for 4xx, no
//     cache for 5xx, so a transient upstream error doesn't poison the edge.

function logProxy(fields: Record<string, unknown>) {
  console.info("sdmx-proxy " + JSON.stringify(fields));
}

function isAllowedDevOrigin(origin: string): boolean {
  return (
    origin.startsWith("http://localhost") ||
    origin.startsWith("http://127.0.0.1")
  );
}

function hasBrowserContext(req: NextRequest): boolean {
  const candidate = req.headers.get("origin") || req.headers.get("referer");
  if (!candidate) return false;
  try {
    const candidateOrigin = new URL(candidate).origin;
    const requestOrigin = req.nextUrl.origin;

    if (candidateOrigin === requestOrigin) return true;

    const configuredOrigin = process.env.NEXTAUTH_URL
      ? new URL(process.env.NEXTAUTH_URL).origin
      : null;
    if (configuredOrigin && candidateOrigin === configuredOrigin) return true;

    if (isAllowedDevOrigin(candidateOrigin)) return true;
  } catch {
    return false;
  }

  return false;
}

function cacheControlFor(status: number): string {
  if (status >= 200 && status < 300) {
    return "public, max-age=300, s-maxage=3600";
  }
  if (status >= 400 && status < 500) {
    return "public, max-age=0, s-maxage=60";
  }
  return "no-store";
}

export async function GET(req: NextRequest) {
  const started = Date.now();

  if (!hasBrowserContext(req)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const target = req.nextUrl.searchParams.get("url");
  if (!target) {
    return NextResponse.json({ error: "missing url" }, { status: 400 });
  }

  let parsed: URL;
  try {
    parsed = new URL(target);
  } catch {
    return NextResponse.json({ error: "invalid url" }, { status: 400 });
  }

  if (parsed.protocol !== "https:") {
    return NextResponse.json({ error: "https required" }, { status: 400 });
  }

  const config = KEYED_HOSTS[parsed.host];
  if (!config) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  if (!config.allowedPathPattern.test(parsed.pathname)) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  const key = process.env[config.envVar];
  if (!key) {
    return NextResponse.json(
      { error: "server misconfigured" },
      { status: 500 },
    );
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), {
      headers: {
        [config.header]: key,
        Accept:
          req.headers.get("accept") ??
          "application/vnd.sdmx.data+json;version=1.0.0",
        "Accept-Language": req.headers.get("accept-language") ?? "en",
      },
    });
  } catch (err) {
    logProxy({
      host: parsed.host,
      path: parsed.pathname,
      status: 502,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "upstream fetch failed" },
      { status: 502 },
    );
  }

  logProxy({
    host: parsed.host,
    path: parsed.pathname,
    status: upstream.status,
    ms: Date.now() - started,
  });

  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": cacheControlFor(upstream.status),
      Vary: "Accept, Accept-Language",
    },
  });
}
