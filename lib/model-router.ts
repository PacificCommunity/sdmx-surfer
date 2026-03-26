import { anthropic } from "@ai-sdk/anthropic";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { type LanguageModel } from "ai";
import { type ProviderOptions } from "@ai-sdk/provider-utils";
import { db, userApiKeys } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { decryptApiKey } from "@/lib/encryption";

export interface ModelConfig {
  model: LanguageModel;
  modelId: string;
  providerId: string;
  providerOptions?: ProviderOptions;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1-mini",
  google: "gemini-3-flash-preview",
};

export async function getModelForUser(userId: string): Promise<ModelConfig> {
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
  } catch (_err) {
    // DB unavailable — fall through to free tier
  }

  for (const row of rows) {
    const providerId = row.provider;
    const modelId = row.model_preference ?? DEFAULT_MODELS[providerId] ?? "";

    let apiKey: string;
    try {
      apiKey = decryptApiKey(row.encrypted_key, providerId);
    } catch (_err) {
      // Decryption failed — never log key material, skip this row
      continue;
    }

    if (providerId === "anthropic") {
      const provider = createAnthropic({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
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
      };
    }

    if (providerId === "google") {
      const provider = createGoogleGenerativeAI({ apiKey });
      return {
        model: provider(modelId),
        modelId,
        providerId,
      };
    }
  }

  // No BYOK key found — try platform free tier (Google)
  const platformKey = process.env.GOOGLE_AI_API_KEY;
  if (platformKey) {
    const modelId = "gemini-3-flash-preview";
    const provider = createGoogleGenerativeAI({ apiKey: platformKey });
    return {
      model: provider(modelId),
      modelId,
      providerId: "google",
    };
  }

  // Last resort: Anthropic from environment (development fallback)
  const modelId = "claude-sonnet-4-6";
  return {
    model: anthropic(modelId),
    modelId,
    providerId: "anthropic",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}
