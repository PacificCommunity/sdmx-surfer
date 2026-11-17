import { NextRequest, NextResponse } from "next/server";
import { declaresOversizeBody, readCappedBody } from "@/lib/capped-body";
import { PROXIED_HOSTS } from "@/lib/proxied-hosts";
import { consumeRateLimit, type RateLimitPolicy } from "@/lib/rate-limit";
import { requestIp } from "@/lib/request-ip";

// ---------------------------------------------------------------------------
// GET /api/sdmx-proxy?url=… — forward SDMx fetches for hosts that either need
// a subscription key or block CORS. Key-bearing hosts have the key injected
// server-side; CORS-blocked hosts are simply relayed so the browser sees a
// same-origin response.
// ---------------------------------------------------------------------------
//
// Defenses (since published dashboards at /p/[id] and the gallery are served
// unauthenticated, this route is necessarily public):
//   - Host allowlist — only hosts in lib/proxied-hosts.ts are forwarded.
//   - Path allowlist per host — narrows what the proxy will relay so it can't
//     become an open forwarder for unrelated URLs on the same domain.
//   - https required on the target URL.
//   - Loose Origin/Referer check — blocks requests with no browser context.
//     Scripts can forge these headers, so it is not what protects the keys.
//   - Per-IP rate limit on key-bearing hosts, so a script can't spend SPC's
//     subscription quota. Only CDN misses reach this function, so repeat views
//     of a published dashboard mostly don't count.
//   - Response-size cap on every host, so one request can't exhaust function
//     memory or bandwidth.
//   - Cache-Control gated on status: long cache for 2xx, brief for 4xx, no
//     cache for 5xx, so a transient upstream error doesn't poison the edge.

// Generous for a dashboard with dozens of panels refreshed several times.
const KEYED_HOST_LIMIT = 120;
const KEYED_HOST_WINDOW_MS = 10 * 60 * 1000;

// SDMx JSON for a dashboard panel is typically well under 1 MB.
const MAX_RESPONSE_BYTES = 20 * 1024 * 1024;

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

function keyedHostPolicy(host: string): RateLimitPolicy {
  return {
    bucket: "sdmx-proxy:" + host,
    limit: KEYED_HOST_LIMIT,
    windowMs: KEYED_HOST_WINDOW_MS,
  };
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

  const config = PROXIED_HOSTS[parsed.host];
  if (!config) {
    return NextResponse.json({ error: "host not allowed" }, { status: 403 });
  }

  if (!config.allowedPathPattern.test(parsed.pathname)) {
    return NextResponse.json({ error: "path not allowed" }, { status: 403 });
  }

  const outgoingHeaders: Record<string, string> = {
    Accept:
      req.headers.get("accept") ??
      "application/vnd.sdmx.data+json;version=1.0.0",
    "Accept-Language": req.headers.get("accept-language") ?? "en",
  };

  if (config.key) {
    const keyValue = process.env[config.key.envVar];
    if (!keyValue) {
      return NextResponse.json(
        { error: "server misconfigured" },
        { status: 500 },
      );
    }

    // Vercel sets x-forwarded-for itself, so the IP can't be spoofed there. No
    // IP means we're not behind Vercel (local dev), where there's no quota to
    // protect from strangers.
    const ip = requestIp(req);
    if (ip) {
      const decision = await consumeRateLimit(keyedHostPolicy(parsed.host), ip);
      if (!decision.allowed) {
        logProxy({
          host: parsed.host,
          path: parsed.pathname,
          reason: config.reason,
          status: 429,
          ms: Date.now() - started,
        });
        return NextResponse.json(
          { error: "rate limited" },
          {
            status: 429,
            headers: {
              "Retry-After": String(decision.retryAfterSeconds),
              "Cache-Control": "no-store",
            },
          },
        );
      }
    }

    outgoingHeaders[config.key.header] = keyValue;
  }

  let upstream: Response;
  try {
    upstream = await fetch(parsed.toString(), { headers: outgoingHeaders });
  } catch (err) {
    logProxy({
      host: parsed.host,
      path: parsed.pathname,
      reason: config.reason,
      status: 502,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "upstream fetch failed" },
      { status: 502 },
    );
  }

  // Buffered rather than streamed so an oversize body still gets a clean 502
  // instead of a truncated 200 the CDN might cache.
  let body: Uint8Array<ArrayBuffer> | null = null;
  try {
    if (
      declaresOversizeBody(
        upstream.headers.get("content-length"),
        MAX_RESPONSE_BYTES,
      )
    ) {
      await upstream.body?.cancel().catch(() => {});
    } else {
      body = await readCappedBody(upstream.body, MAX_RESPONSE_BYTES);
    }
  } catch (err) {
    logProxy({
      host: parsed.host,
      path: parsed.pathname,
      reason: config.reason,
      status: 502,
      ms: Date.now() - started,
      error: err instanceof Error ? err.message : String(err),
    });
    return NextResponse.json(
      { error: "upstream fetch failed" },
      { status: 502 },
    );
  }

  if (!body) {
    logProxy({
      host: parsed.host,
      path: parsed.pathname,
      reason: config.reason,
      status: 502,
      ms: Date.now() - started,
      error: "upstream response too large",
    });
    return NextResponse.json(
      { error: "upstream response too large" },
      { status: 502 },
    );
  }

  logProxy({
    host: parsed.host,
    path: parsed.pathname,
    reason: config.reason,
    status: upstream.status,
    ms: Date.now() - started,
  });

  return new Response(body, {
    status: upstream.status,
    headers: {
      "Content-Type":
        upstream.headers.get("content-type") ?? "application/json",
      "Cache-Control": cacheControlFor(upstream.status),
      Vary: "Accept, Accept-Language",
    },
  });
}
