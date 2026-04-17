import { anthropic } from "@ai-sdk/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createMistral } from "@ai-sdk/mistral";
import { gateway } from "@ai-sdk/gateway";
import { type LanguageModel } from "ai";
import { type ProviderOptions } from "@ai-sdk/provider-utils";
import { db, userApiKeys } from "@/lib/db";
import { eq, and, desc } from "drizzle-orm";
import { decryptApiKey } from "@/lib/encryption";
import { findPlatformModel } from "@/lib/platform-models";

export type KeySource = "platform-direct" | "platform-gateway" | "byok";

export interface ModelConfig {
  model: LanguageModel;
  modelId: string;
  providerId: string;
  keySource: KeySource;
  providerOptions?: ProviderOptions;
}

function useGateway(): boolean {
  return (
    process.env.USE_AI_GATEWAY === "1" &&
    !!process.env.AI_GATEWAY_API_KEY
  );
}

// Provider SDKs and the Vercel AI Gateway disagree on version-number punctuation.
// Native SDK slugs put a dash between version parts; the gateway uses a dot.
// Translate at the boundary so the rest of the codebase keeps one canonical form.
export function toGatewaySlug(providerId: string, modelId: string): string {
  const normalized = modelId.replace(/-(\d+)-(\d+)$/, "-$1.$2");
  return providerId + "/" + normalized;
}

// Platform-key path for any provider in PLATFORM_MODELS, routed through the
// gateway. Per-provider providerOptions land here:
//   - Anthropic: ephemeral cache_control (saves cost on our ~10-15K system prompt)
//   - Mistral:   parallelToolCalls:false — Mistral's default eager parallel
//     tool-calling breaks sequential ReAct loops (calls every tool in one
//     step with fabricated args). Forcing one-call-per-step restores the
//     standard agent loop. Verified via scripts/smoke-gateway.ts.
function platformViaGateway(providerId: string, modelId: string): ModelConfig {
  let providerOptions: ProviderOptions | undefined;
  if (providerId === "anthropic") {
    providerOptions = { anthropic: { cacheControl: { type: "ephemeral" } } };
  } else if (providerId === "mistral") {
    providerOptions = { mistral: { parallelToolCalls: false } };
  }
  return {
    model: gateway(toGatewaySlug(providerId, modelId)),
    modelId,
    providerId,
    keySource: "platform-gateway",
    providerOptions,
  };
}

// Platform-key path: either route through the Vercel AI Gateway (flag on) or
// call the Anthropic SDK directly (flag off — unchanged pre-migration path).
// Anthropic only — the other three platform providers are gateway-only.
function platformAnthropic(modelId: string): ModelConfig {
  if (useGateway()) return platformViaGateway("anthropic", modelId);
  return {
    model: anthropic(modelId),
    modelId,
    providerId: "anthropic",
    keySource: "platform-direct",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1-mini",
  google: "gemini-3-flash-preview",
  mistral: "mistral-large-latest",
};

export async function getModelForUser(
  userId: string,
  override?: { provider: string; model: string },
): Promise<ModelConfig> {
  // If the user explicitly chose a provider+model in the UI, use that
  if (override && override.provider && override.model) {
    // Check if they have a BYOK key for this provider
    const byokConfig = await tryByokProvider(userId, override.provider, override.model);
    if (byokConfig) return byokConfig;

    // Platform via gateway — any provider in the PLATFORM_MODELS catalog
    // resolves here when USE_AI_GATEWAY is on. One Vercel key pays for all.
    if (useGateway() && findPlatformModel(override.provider, override.model)) {
      return platformViaGateway(override.provider, override.model);
    }

    // Anthropic has a legacy direct-SDK platform path (pre-gateway) that
    // still works when the flag is off — keep it for rollback safety.
    if (override.provider === "anthropic" && process.env.ANTHROPIC_API_KEY) {
      return platformAnthropic(override.model);
    }
    // Fall through to default logic if override can't be satisfied
  }

  // Query all BYOK keys for this user
  let rows: Array<{
    provider: string;
    encrypted_key: string;
    model_preference: string | null;
  }> = [];

  try {
    rows = await db
      .select()
      .from(userApiKeys)
      .where(eq(userApiKeys.user_id, userId))
      .orderBy(desc(userApiKeys.updated_at))
      .limit(1);
  } catch {
    // DB unavailable — fall through to free tier
  }

  for (const row of rows) {
    const providerId = row.provider;
    const modelId = row.model_preference ?? DEFAULT_MODELS[providerId] ?? "";

    let apiKey: string;
    try {
      apiKey = decryptApiKey(row.encrypted_key, providerId);
    } catch {
      // Decryption failed — never log key material, skip this row
      continue;
    }

    if (providerId === "anthropic") {
      const provider = createAnthropic({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
        keySource: "byok",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      };
    }

    if (providerId === "openai") {
      const provider = createOpenAI({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
        keySource: "byok",
      };
    }

    if (providerId === "google") {
      const provider = createGoogleGenerativeAI({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
        keySource: "byok",
      };
    }

    if (providerId === "mistral") {
      const provider = createMistral({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
        keySource: "byok",
      };
    }
  }

  // No BYOK key found — use platform Anthropic path (Sonnet 4.6)
  return platformAnthropic("claude-sonnet-4-6");
}

/**
 * Try to create a model config for a specific provider using the user's BYOK key.
 * Returns null if no key is found for that provider.
 */
async function tryByokProvider(
  userId: string,
  providerId: string,
  modelId: string,
): Promise<ModelConfig | null> {
  try {
    const rows = await db
      .select()
      .from(userApiKeys)
      .where(
        and(
          eq(userApiKeys.user_id, userId),
          eq(userApiKeys.provider, providerId),
        ),
      )
      .limit(1);

    if (rows.length === 0) return null;

    const apiKey = decryptApiKey(rows[0].encrypted_key, providerId);

    if (providerId === "anthropic") {
      const provider = createAnthropic({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
        keySource: "byok",
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      };
    }

    if (providerId === "openai") {
      const provider = createOpenAI({ apiKey });
      return { model: provider(modelId), modelId, providerId, keySource: "byok" };
    }

    if (providerId === "google") {
      const provider = createGoogleGenerativeAI({ apiKey });
      return { model: provider(modelId), modelId, providerId, keySource: "byok" };
    }

    if (providerId === "mistral") {
      const provider = createMistral({ apiKey });
      return { model: provider(modelId), modelId, providerId, keySource: "byok" };
    }
  } catch {
    // Decryption or DB error — skip
  }
  return null;
}
