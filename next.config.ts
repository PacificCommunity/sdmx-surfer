import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["@ai-sdk/mcp", "onnxruntime-node", "@huggingface/transformers"],
};

export default nextConfig;
