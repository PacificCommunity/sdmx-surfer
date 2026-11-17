// Catalog of platform-tier models — exposed to any logged-in user (no BYOK
// needed). Shared between the server router (to validate + route) and the
// builder UI (to populate the model picker). Keep this file free of server-
// only imports so the client can pull it in directly.

export interface PlatformModel {
  providerId: string;
  // Canonical id — stored/passed in the direct-SDK form (dashes between
  // version parts for Anthropic). lib/model-router.ts:toGatewaySlug() converts
  // to the gateway's dot form at the boundary.
  modelId: string;
  label: string;
  description: string;
  // Whether AI Gateway can serve this model under zero data retention
  // (providerOptions.gateway.zeroDataRetention). Models without a ZDR provider
  // still run, with prompt training disallowed only; see providerOptionsFor()
  // in lib/model-router.ts. Verified live on 17 Nov 2026 with a 5-token call
  // per model: all five routed with ZDR (Gemini via Vertex, which skips
  // Google AI Studio). Re-check when adding a model: a ZDR request for a
  // model without a ZDR provider fails with no_zdr_providers_available.
  zeroDataRetention: boolean;
}

export const PLATFORM_MODELS: PlatformModel[] = [
  {
    providerId: "openai",
    modelId: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    description: "OpenAI — mid tier, low cost, 1M context (default)",
    zeroDataRetention: true,
  },
  {
    providerId: "anthropic",
    modelId: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    description: "Anthropic — best speed + intelligence balance, 1M context",
    zeroDataRetention: true,
  },
  {
    providerId: "anthropic",
    modelId: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    description: "Anthropic — most capable, complex agentic reasoning, 1M context",
    zeroDataRetention: true,
  },
  {
    providerId: "google",
    modelId: "gemini-4-argon",
    label: "Gemini 4 Argon",
    description: "Google — flagship reasoning + tool use, 1M context",
    zeroDataRetention: true,
  },
  {
    providerId: "google",
    modelId: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    description: "Google — fast and low cost, 1M context",
    zeroDataRetention: true,
  },
];

export function findPlatformModel(
  providerId: string,
  modelId: string,
): PlatformModel | undefined {
  return PLATFORM_MODELS.find(
    (m) => m.providerId === providerId && m.modelId === modelId,
  );
}
