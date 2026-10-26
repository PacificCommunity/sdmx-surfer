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
}

export const PLATFORM_MODELS: PlatformModel[] = [
  {
    providerId: "openai",
    modelId: "gpt-6.1-terra",
    label: "GPT-6.1 Terra",
    description: "OpenAI — mid tier, low cost, 1M context (default)",
  },
  {
    providerId: "anthropic",
    modelId: "claude-sonnet-5-5",
    label: "Claude Sonnet 5.5",
    description: "Anthropic — best speed + intelligence balance, 1M context",
  },
  {
    providerId: "anthropic",
    modelId: "claude-opus-5-5",
    label: "Claude Opus 5.5",
    description: "Anthropic — most capable, complex agentic reasoning, 1M context",
  },
  {
    providerId: "google",
    modelId: "gemini-4-argon",
    label: "Gemini 4 Argon",
    description: "Google — flagship reasoning + tool use, 1M context",
  },
  {
    providerId: "google",
    modelId: "gemini-3.8-flash",
    label: "Gemini 3.8 Flash",
    description: "Google — fast and low cost, 1M context",
  },
  {
    providerId: "mistral",
    modelId: "mistral-large-4",
    label: "Mistral Large 4",
    description: "Mistral — EU-hosted, 512K context",
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
