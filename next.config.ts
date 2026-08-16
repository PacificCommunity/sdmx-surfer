import type { NextConfig } from "next";

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
    "/api/explore": ["./models/dataflow-index.json"],
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
