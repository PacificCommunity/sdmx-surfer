import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
