import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/rate-limit", () => ({
  consumeRateLimit: vi.fn(),
}));

import { NextRequest } from "next/server";
import { GET } from "@/app/api/sdmx-proxy/route";
import { declaresOversizeBody, readCappedBody } from "@/lib/capped-body";
import { consumeRateLimit } from "@/lib/rate-limit";

const MB = 1024 * 1024;
const STATSNZ_URL = "https://api.data.stats.govt.nz/rest/data/DF_POP/A..T";
const OECD_URL = "https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DF_QNA,1.0/A";

function proxyRequest(target: string, ip: string | null = "203.0.113.5") {
  const headers: Record<string, string> = { origin: "http://localhost:3000" };
  if (ip) headers["x-forwarded-for"] = ip;
  return new NextRequest(
    "http://localhost:3000/api/sdmx-proxy?url=" + encodeURIComponent(target),
    { headers },
  );
}

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SDMX_STATSNZ_KEY", "test-statsnz-key");
  vi.mocked(consumeRateLimit).mockResolvedValue({ allowed: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("readCappedBody", () => {
  it("returns the whole body when it fits", async () => {
    const body = await readCappedBody(
      streamOf([new Uint8Array([1, 2]), new Uint8Array([3])]),
      3,
    );
    expect(body).toEqual(new Uint8Array([1, 2, 3]));
  });

  it("returns null and cancels the stream once past the cap", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2));
      },
      cancel,
    });
    await expect(readCappedBody(stream, 5)).resolves.toBeNull();
    expect(cancel).toHaveBeenCalled();
  });

  it("treats a missing body as empty", async () => {
    await expect(readCappedBody(null, 5)).resolves.toEqual(new Uint8Array(0));
  });
});

describe("declaresOversizeBody", () => {
  it("flags only a numeric Content-Length over the cap", () => {
    expect(declaresOversizeBody("11", 10)).toBe(true);
    expect(declaresOversizeBody("10", 10)).toBe(false);
    expect(declaresOversizeBody(null, 10)).toBe(false);
    expect(declaresOversizeBody("garbage", 10)).toBe(false);
  });
});

describe("GET /api/sdmx-proxy", () => {
  it("rate-limits key-bearing hosts per client IP and injects the key", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}"));
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(proxyRequest(STATSNZ_URL));

    expect(res.status).toBe(200);
    expect(consumeRateLimit).toHaveBeenCalledWith(
      expect.objectContaining({
        bucket: "sdmx-proxy:api.data.stats.govt.nz",
        limit: 120,
        windowMs: 10 * 60 * 1000,
      }),
      "203.0.113.5",
    );
    expect(fetchMock.mock.calls[0][1].headers["Ocp-Apim-Subscription-Key"]).toBe(
      "test-statsnz-key",
    );
  });

  it("returns an uncached 429 with Retry-After and never calls upstream when limited", async () => {
    vi.mocked(consumeRateLimit).mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 42,
    });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const res = await GET(proxyRequest(STATSNZ_URL));

    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("42");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "rate limited" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("doesn't rate-limit CORS-only hosts", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));

    const res = await GET(proxyRequest(OECD_URL));

    expect(res.status).toBe(200);
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("skips the limiter when there is no client IP (local dev)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}")));

    const res = await GET(proxyRequest(STATSNZ_URL, null));

    expect(res.status).toBe(200);
    expect(consumeRateLimit).not.toHaveBeenCalled();
  });

  it("rejects a declared oversize upstream response with 502", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("{}", {
          headers: { "content-length": String(21 * MB) },
        }),
      ),
    );

    const res = await GET(proxyRequest(OECD_URL));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream response too large" });
  });

  it("rejects an undeclared oversize upstream response with 502", async () => {
    const chunk = new Uint8Array(MB);
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (sent++ > 25) controller.close();
        else controller.enqueue(chunk);
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body)));

    const res = await GET(proxyRequest(OECD_URL));

    expect(res.status).toBe(502);
    expect(await res.json()).toEqual({ error: "upstream response too large" });
    expect(sent).toBeLessThanOrEqual(22);
  });

  it("relays a body under the cap with its status and cache headers", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response('{"data":1}', {
          status: 200,
          headers: { "content-type": "application/vnd.sdmx.data+json" },
        }),
      ),
    );

    const res = await GET(proxyRequest(OECD_URL));

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/vnd.sdmx.data+json");
    expect(res.headers.get("cache-control")).toBe(
      "public, max-age=300, s-maxage=3600",
    );
    expect(await res.text()).toBe('{"data":1}');
  });
});
