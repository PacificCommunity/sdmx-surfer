import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock the database module before importing model-router
vi.mock("@/lib/db", () => ({
  db: {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([]),
      }),
    }),
  },
  userApiKeys: { user_id: "user_id" },
}));

// Mock encryption — just return the input (no real crypto needed for routing tests)
vi.mock("@/lib/encryption", () => ({
  decryptApiKey: vi.fn((encrypted: string) => {
    if (encrypted === "CORRUPT") throw new Error("Decryption failed");
    return "decrypted-" + encrypted;
  }),
}));

import { getModelForUser } from "@/lib/model-router";
import { db } from "@/lib/db";
import { PLATFORM_MODELS } from "@/lib/platform-models";

/** Build a mock chain: select().from().where().orderBy().limit() → rows */
function mockDbRows(rows: unknown[]) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        orderBy: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(rows),
        }),
      }),
    }),
  });
}

/** Build the override path's chain: select().from().where().limit() → rows */
function mockByokLookup(rows: unknown[]) {
  (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue(rows),
      }),
    }),
  });
}

function enableGateway() {
  process.env.USE_AI_GATEWAY = "1";
  process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ENCRYPTION_SECRET = "test-secret-at-least-16-chars-long";
  delete process.env.USE_AI_GATEWAY;
  delete process.env.AI_GATEWAY_API_KEY;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("model-router", () => {
  describe("fallback chain", () => {
    it("returns direct Anthropic Sonnet 5.5 free tier when the gateway is off", async () => {
      const config = await getModelForUser("user-no-keys");

      expect(config.providerId).toBe("anthropic");
      expect(config.modelId).toBe("claude-sonnet-5-5");
      // Anthropic carries no call-level providerOptions: cache control is a
      // message-level concern (set on the system message in the chat routes),
      // and a call-level cacheControl would be a silent no-op.
      expect(config.providerOptions).toBeUndefined();
    });

    it("returns GPT-6.1 Terra via the gateway when the gateway is on", async () => {
      process.env.USE_AI_GATEWAY = "1";
      process.env.AI_GATEWAY_API_KEY = "test-gateway-key";
      const config = await getModelForUser("user-no-keys");

      expect(config.providerId).toBe("openai");
      expect(config.modelId).toBe("gpt-6.1-terra");
      expect(config.keySource).toBe("platform-gateway");
    });
  });

  describe("BYOK key selection", () => {
    it("uses Anthropic BYOK key when available", async () => {
      mockDbRows([{
        provider: "anthropic",
        encrypted_key: "fake-encrypted-anthropic-key",
        model_preference: "claude-opus-4-6",
      }]);

      const config = await getModelForUser("user-with-anthropic");

      expect(config.providerId).toBe("anthropic");
      expect(config.modelId).toBe("claude-opus-4-6");
      expect(config.providerOptions).toBeUndefined();
    });

    it("uses OpenAI BYOK key when available", async () => {
      mockDbRows([{
        provider: "openai",
        encrypted_key: "fake-encrypted-openai-key",
        model_preference: null,
      }]);

      const config = await getModelForUser("user-with-openai");

      expect(config.providerId).toBe("openai");
      expect(config.modelId).toBe("gpt-4.1-mini"); // default when no preference
      expect(config.providerOptions).toBeUndefined();
    });

    it("uses Google BYOK key when available", async () => {
      mockDbRows([{
        provider: "google",
        encrypted_key: "fake-encrypted-google-key",
        model_preference: "gemini-3.1-pro-preview",
      }]);

      const config = await getModelForUser("user-with-google");

      expect(config.providerId).toBe("google");
      expect(config.modelId).toBe("gemini-3.1-pro-preview");
    });

    it("warns about a corrupt BYOK key and falls through to platform Anthropic", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      mockDbRows([{
        provider: "anthropic",
        encrypted_key: "CORRUPT",
        model_preference: null,
      }]);

      const config = await getModelForUser("user-with-corrupt-key");

      expect(config.providerId).toBe("anthropic");
      expect(config.modelId).toBe("claude-sonnet-5-5");
      expect(warn).toHaveBeenCalledTimes(1);
      const message = String(warn.mock.calls[0][0]);
      expect(message).toContain("anthropic");
      expect(message).toContain("user-with-corrupt-key");
      expect(message).not.toContain("CORRUPT");
    });

    it("warns about a corrupt key for an explicit BYOK choice and uses the platform model", async () => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      enableGateway();
      mockByokLookup([{
        provider: "anthropic",
        encrypted_key: "CORRUPT",
        model_preference: null,
      }]);

      const config = await getModelForUser("user-with-corrupt-key", {
        provider: "anthropic",
        model: "claude-opus-5-5",
      });

      expect(config.keySource).toBe("platform-gateway");
      expect(config.modelId).toBe("claude-opus-5-5");
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0][0])).not.toContain("CORRUPT");
    });

    it("handles DB errors gracefully and falls back to platform Anthropic", async () => {
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockReturnValue({
            orderBy: vi.fn().mockReturnValue({
              limit: vi.fn().mockRejectedValue(new Error("DB connection failed")),
            }),
          }),
        }),
      });

      const config = await getModelForUser("user-db-error");

      expect(config.providerId).toBe("anthropic");
      expect(config.modelId).toBe("claude-sonnet-5-5");
    });
  });

  describe("AI Gateway retention controls", () => {
    it("requests zero data retention and no prompt training for every ZDR-flagged platform model", async () => {
      enableGateway();
      mockByokLookup([]);

      for (const m of PLATFORM_MODELS.filter((model) => model.zeroDataRetention)) {
        const config = await getModelForUser("user-no-keys", {
          provider: m.providerId,
          model: m.modelId,
        });

        expect(config.keySource).toBe("platform-gateway");
        expect(config.providerOptions?.gateway).toEqual({
          zeroDataRetention: true,
          disallowPromptTraining: true,
        });
      }
    });

    it("applies the flag to the default gateway model", async () => {
      enableGateway();
      mockDbRows([]);

      const config = await getModelForUser("user-no-keys");

      expect(config.modelId).toBe("gpt-6.1-terra");
      expect(config.providerOptions?.gateway).toEqual({
        zeroDataRetention: true,
        disallowPromptTraining: true,
      });
    });

    it("keeps a model without a ZDR provider, disallowing prompt training only", async () => {
      enableGateway();
      mockByokLookup([]);
      PLATFORM_MODELS.push({
        providerId: "google",
        modelId: "test-no-zdr",
        label: "Test",
        description: "Test",
        zeroDataRetention: false,
      });
      try {
        const config = await getModelForUser("user-no-keys", {
          provider: "google",
          model: "test-no-zdr",
        });

        expect(config.keySource).toBe("platform-gateway");
        expect(config.providerOptions).toEqual({
          gateway: { disallowPromptTraining: true },
        });
      } finally {
        PLATFORM_MODELS.pop();
      }
    });

    it("disallows prompt training for an Anthropic model outside the catalog", async () => {
      enableGateway();
      mockByokLookup([]);

      const config = await getModelForUser("user-no-keys", {
        provider: "anthropic",
        model: "claude-unlisted-1-0",
      });

      expect(config.keySource).toBe("platform-gateway");
      expect(config.providerOptions).toEqual({
        gateway: { disallowPromptTraining: true },
      });
    });

    it("leaves BYOK requests without gateway options", async () => {
      enableGateway();
      mockByokLookup([{
        provider: "anthropic",
        encrypted_key: "fake-encrypted-anthropic-key",
        model_preference: null,
      }]);

      const config = await getModelForUser("user-with-anthropic", {
        provider: "anthropic",
        model: "claude-opus-5-5",
      });

      expect(config.keySource).toBe("byok");
      expect(config.providerOptions).toBeUndefined();
    });
  });

  describe("model config structure", () => {
    it("always returns modelId and providerId", async () => {
      const config = await getModelForUser("any-user");

      expect(config.modelId).toBeTruthy();
      expect(config.providerId).toBeTruthy();
      expect(config.model).toBeDefined();
    });

    it("does NOT set call-level cache control for anthropic (message-level concern)", async () => {
      // A call-level anthropic.cacheControl used to live here and was a
      // silent no-op — @ai-sdk/anthropic only reads cacheControl from
      // message-level providerOptions. The chat routes now set it on the
      // system message instead. This test guards against re-adding it.
      const config = await getModelForUser("any-user");

      expect(config.providerId).toBe("anthropic");
      expect(config.providerOptions).toBeUndefined();
    });
  });
});
