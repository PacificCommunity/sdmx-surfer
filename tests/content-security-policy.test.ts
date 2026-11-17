import { describe, expect, it } from "vitest";
import { getPathMatch } from "next/dist/shared/lib/router/utils/path-match";
import nextConfig from "../next.config";
import {
  contentSecurityPolicy,
  EMBED_FRAME_ANCESTORS,
  SAME_ORIGIN_FRAME_ANCESTORS,
} from "@/lib/content-security-policy";

describe("contentSecurityPolicy frame-ancestors", () => {
  it("restricts framing to this site by default", () => {
    const csp = contentSecurityPolicy(false, SAME_ORIGIN_FRAME_ANCESTORS);
    expect(csp.split("; ").filter((d) => d.startsWith("frame-ancestors "))).toEqual([
      "frame-ancestors 'self'",
    ]);
  });

  it("lets SPC sites embed published dashboards", () => {
    const csp = contentSecurityPolicy(false, EMBED_FRAME_ANCESTORS);
    expect(csp.split("; ").filter((d) => d.startsWith("frame-ancestors "))).toEqual([
      "frame-ancestors 'self' https://*.pacificdata.org https://pacificdata.org https://*.spc.int https://spc.int",
    ]);
  });

  it("keeps the rest of the policy identical between variants", () => {
    const strip = (csp: string) => csp.split("; ").filter((d) => !d.startsWith("frame-ancestors"));
    expect(strip(contentSecurityPolicy(false, EMBED_FRAME_ANCESTORS))).toEqual(
      strip(contentSecurityPolicy(false, SAME_ORIGIN_FRAME_ANCESTORS)),
    );
  });
});

describe("next.config headers", () => {
  // Resolve headers for a path the way Next's router does: every matching
  // entry applies in order, later values overriding earlier ones.
  async function headersFor(pathname: string): Promise<Map<string, string[]>> {
    const entries = (await nextConfig.headers?.()) ?? [];
    const result = new Map<string, string[]>();
    for (const entry of entries) {
      const match = getPathMatch(entry.source, {
        strict: true,
        removeUnnamedParams: true,
        sensitive: false,
      });
      if (match(pathname) === false) continue;
      for (const { key, value } of entry.headers) {
        result.set(key, [...(result.get(key) ?? []), value]);
      }
    }
    return result;
  }

  it.each(["/", "/builder", "/gallery", "/login", "/p", "/p/", "/api/p/x", "/pricing"])(
    "%s gets one same-origin CSP and X-Frame-Options",
    async (pathname) => {
      const headers = await headersFor(pathname);
      expect(headers.get("Content-Security-Policy")).toEqual([
        contentSecurityPolicy(true, SAME_ORIGIN_FRAME_ANCESTORS),
      ]);
      expect(headers.get("X-Frame-Options")).toEqual(["SAMEORIGIN"]);
      expect(headers.get("X-Content-Type-Options")).toEqual(["nosniff"]);
    },
  );

  it.each(["/p/abc123", "/p/abc123/", "/P/abc123"])(
    "%s gets one embeddable CSP and no X-Frame-Options",
    async (pathname) => {
      const headers = await headersFor(pathname);
      expect(headers.get("Content-Security-Policy")).toEqual([
        contentSecurityPolicy(true, EMBED_FRAME_ANCESTORS),
      ]);
      expect(headers.has("X-Frame-Options")).toBe(false);
      expect(headers.get("Referrer-Policy")).toEqual(["strict-origin-when-cross-origin"]);
    },
  );
});
