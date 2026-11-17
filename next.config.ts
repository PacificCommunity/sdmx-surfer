import type { NextConfig } from "next";
import {
  contentSecurityPolicy,
  EMBED_FRAME_ANCESTORS,
  SAME_ORIGIN_FRAME_ANCESTORS,
} from "./lib/content-security-policy";

const nextConfig: NextConfig = {
  // Pin the workspace root. A stray package-lock.json exists above this
  // directory, and Turbopack's root inference picks the outermost lockfile it
  // finds, which lands on /home/gvdr/reps and breaks module resolution locally:
  // "Can't resolve 'tailwindcss'", so `npm run dev` serves the app unstyled
  // while reporting a clean 200. Vercel builds are unaffected, since the repo
  // is the root there, which is why this only ever bites in local development.
  turbopack: {
    root: __dirname,
  },
  serverExternalPackages: ["@ai-sdk/mcp"],
  outputFileTracingIncludes: {
    "/api/explore": ["./models/dataflow-index.json", "./models/dataflow-coverage.json"],
    "/api/explore/**": ["./models/dataflow-coverage.json"],
    "/api/chat": ["./models/dataflow-coverage.json"],
  },
  async headers() {
    const isDevelopment = process.env.NODE_ENV !== "production";
    const common = [
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      {
        key: "Permissions-Policy",
        value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
      },
      // Locally the site is plain http on localhost, where HSTS would only
      // pin a stale policy in the developer's browser.
      ...(isDevelopment
        ? []
        : [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]),
    ];
    // The two sources are complementary, so each path gets exactly one CSP.
    // Overriding a catch-all instead would not do: a later entry can replace
    // the CSP but cannot remove X-Frame-Options, which has no allow-list form
    // and would block the SPC embeds.
    return [
      {
        source: "/((?!p/.).*)",
        headers: [
          ...common,
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(isDevelopment, SAME_ORIGIN_FRAME_ANCESTORS),
          },
          // For browsers that predate CSP frame-ancestors.
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
      {
        // Published dashboards, embeddable from SPC sites.
        source: "/p/(.+)",
        headers: [
          ...common,
          {
            key: "Content-Security-Policy",
            value: contentSecurityPolicy(isDevelopment, EMBED_FRAME_ANCESTORS),
          },
        ],
      },
    ];
  },
  async rewrites() {
    if (process.env.INCLUDE_COUNTRY_SNAPSHOTS === "0") {
      return {
        beforeFiles: [
          { source: "/countrysnapshots/:path*", destination: "/404" },
          { source: "/api/countrysnapshots/:path*", destination: "/404" },
        ],
        afterFiles: [],
        fallback: [],
      };
    }
    return [];
  },
};

export default nextConfig;
