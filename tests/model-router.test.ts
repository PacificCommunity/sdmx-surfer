import { describe, it, expect, vi, beforeEach } from "vitest";

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

beforeEach(() => {
  vi.clearAllMocks();
  delete process.env.GOOGLE_AI_API_KEY;
  process.env.ANTHROPIC_API_KEY = "test-anthropic-key";
  process.env.ENCRYPTION_SECRET = "test-secret-at-least-16-chars-long";
});

describe("model-router", () => {
  describe("fallback chain", () => {
    it("returns Gemini free tier when user has no BYOK keys and GOOGLE_AI_API_KEY is set", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-google-key";

      const config = await getModelForUser("user-no-keys");

      expect(config.providerId).toBe("google");
      expect(config.modelId).toBe("gemini-3-flash");
    });

    it("falls back to Anthropic from env when no BYOK keys and no GOOGLE_AI_API_KEY", async () => {
      // No GOOGLE_AI_API_KEY set (deleted in beforeEach)

      const config = await getModelForUser("user-no-keys");

      expect(config.providerId).toBe("anthropic");
      expect(config.modelId).toBe("claude-sonnet-4-6");
      expect(config.providerOptions).toBeDefined();
    });
  });

  describe("BYOK key selection", () => {
    it("uses Anthropic BYOK key when available", async () => {
      // Mock DB to return an Anthropic key
      const mockWhere = vi.fn().mockResolvedValue([
        {
          provider: "anthropic",
          encrypted_key: "fake-encrypted-anthropic-key",
          model_preference: "claude-opus-4-6",
        },
      ]);
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({ where: mockWhere }),
      });

      const config = await getModelForUser("user-with-anthropic");

      expect(config.providerId).toBe("anthropic");
      expect(config.modelId).toBe("claude-opus-4-6");
      expect(config.providerOptions).toHaveProperty("anthropic");
    });

    it("uses OpenAI BYOK key when available", async () => {
      const mockWhere = vi.fn().mockResolvedValue([
        {
          provider: "openai",
          encrypted_key: "fake-encrypted-openai-key",
          model_preference: null,
        },
      ]);
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({ where: mockWhere }),
      });

      const config = await getModelForUser("user-with-openai");

      expect(config.providerId).toBe("openai");
      expect(config.modelId).toBe("gpt-4.1-mini"); // default when no preference
      expect(config.providerOptions).toBeUndefined();
    });

    it("uses Google BYOK key when available", async () => {
      const mockWhere = vi.fn().mockResolvedValue([
        {
          provider: "google",
          encrypted_key: "fake-encrypted-google-key",
          model_preference: "gemini-3.1-pro-preview",
        },
      ]);
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({ where: mockWhere }),
      });

      const config = await getModelForUser("user-with-google");

      expect(config.providerId).toBe("google");
      expect(config.modelId).toBe("gemini-3.1-pro-preview");
    });

    it("skips corrupt BYOK key and falls through to free tier", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-google-key";

      const mockWhere = vi.fn().mockResolvedValue([
        {
          provider: "anthropic",
          encrypted_key: "CORRUPT", // triggers mock decryption failure
          model_preference: null,
        },
      ]);
      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({ where: mockWhere }),
      });

      const config = await getModelForUser("user-with-corrupt-key");

      // Should skip the corrupt key and fall back to free tier
      expect(config.providerId).toBe("google");
      expect(config.modelId).toBe("gemini-3-flash");
    });

    it("handles DB errors gracefully and falls back to free tier", async () => {
      process.env.GOOGLE_AI_API_KEY = "test-google-key";

      (db.select as ReturnType<typeof vi.fn>).mockReturnValue({
        from: vi.fn().mockReturnValue({
          where: vi.fn().mockRejectedValue(new Error("DB connection failed")),
        }),
      });

      const config = await getModelForUser("user-db-error");

      expect(config.providerId).toBe("google");
      expect(config.modelId).toBe("gemini-3-flash");
    });
  });

  describe("model config structure", () => {
    it("always returns modelId and providerId", async () => {
      const config = await getModelForUser("any-user");

      expect(config.modelId).toBeTruthy();
      expect(config.providerId).toBeTruthy();
      expect(config.model).toBeDefined();
    });

    it("includes anthropic cache control for anthropic provider", async () => {
      // Falls back to env-based anthropic
      const config = await getModelForUser("any-user");

      expect(config.providerId).toBe("anthropic");
      expect(config.providerOptions).toEqual({
        anthropic: { cacheControl: { type: "ephemeral" } },
      });
    });
  });
});
