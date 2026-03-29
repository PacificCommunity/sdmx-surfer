import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@ai-sdk/mcp"],
  outputFileTracingIncludes: {
    "/api/explore": ["./models/dataflow-index.json"],
  },
};

export default nextConfig;
