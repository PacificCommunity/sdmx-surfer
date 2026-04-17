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
    providerId: "anthropic",
    modelId: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    description: "Anthropic — balanced reasoning + tool use, 1M context",
  },
  {
    providerId: "google",
    modelId: "gemini-3.1-pro-preview",
    label: "Gemini 3.1 Pro",
    description: "Google — reasoning + tool use, 1M context",
  },
  {
    providerId: "mistral",
    modelId: "mistral-large-3",
    label: "Mistral Large 3",
    description: "Mistral — EU-hosted, 256K context",
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
