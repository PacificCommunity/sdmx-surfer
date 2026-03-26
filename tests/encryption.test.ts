import { describe, it, expect, beforeAll } from "vitest";
import { encryptApiKey, decryptApiKey } from "@/lib/encryption";

beforeAll(() => {
  // Set a test secret — must be present for encryption to work
  process.env.ENCRYPTION_SECRET = "test-secret-for-vitest-at-least-16-chars";
});

describe("encryption", () => {
  it("round-trips a key through encrypt then decrypt", () => {
    const original = "sk-ant-api03-fake-key-1234567890";
    const encrypted = encryptApiKey(original, "anthropic");
    const decrypted = decryptApiKey(encrypted, "anthropic");
    expect(decrypted).toBe(original);
  });

  it("produces different ciphertext each time (random IV)", () => {
    const key = "sk-test-key";
    const a = encryptApiKey(key, "openai");
    const b = encryptApiKey(key, "openai");
    expect(a).not.toBe(b);
    // But both decrypt to the same value
    expect(decryptApiKey(a, "openai")).toBe(key);
    expect(decryptApiKey(b, "openai")).toBe(key);
  });

  it("uses provider-specific key derivation", () => {
    const key = "same-key-different-provider";
    const encAnthropic = encryptApiKey(key, "anthropic");
    const encGoogle = encryptApiKey(key, "google");
    // Encrypted with different providers, can't cross-decrypt
    expect(() => decryptApiKey(encAnthropic, "google")).toThrow();
    expect(() => decryptApiKey(encGoogle, "anthropic")).toThrow();
  });

  it("fails to decrypt with tampered ciphertext", () => {
    const encrypted = encryptApiKey("secret-key", "openai");
    const tampered = encrypted.slice(0, -4) + "XXXX";
    expect(() => decryptApiKey(tampered, "openai")).toThrow();
  });

  it("throws if ENCRYPTION_SECRET is not set", () => {
    const saved = process.env.ENCRYPTION_SECRET;
    delete process.env.ENCRYPTION_SECRET;
    expect(() => encryptApiKey("key", "anthropic")).toThrow("ENCRYPTION_SECRET");
    process.env.ENCRYPTION_SECRET = saved;
  });

  it("handles empty string keys", () => {
    const encrypted = encryptApiKey("", "anthropic");
    expect(decryptApiKey(encrypted, "anthropic")).toBe("");
  });

  it("handles long keys", () => {
    const longKey = "x".repeat(10000);
    const encrypted = encryptApiKey(longKey, "google");
    expect(decryptApiKey(encrypted, "google")).toBe(longKey);
  });
});
