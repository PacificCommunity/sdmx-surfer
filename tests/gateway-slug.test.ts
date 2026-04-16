import { describe, it, expect } from "vitest";
import { toGatewaySlug } from "@/lib/model-router";

describe("toGatewaySlug", () => {
  it("translates Anthropic's dash-versioned slugs to the gateway's dot form", () => {
    expect(toGatewaySlug("anthropic", "claude-sonnet-4-6")).toBe("anthropic/claude-sonnet-4.6");
    expect(toGatewaySlug("anthropic", "claude-haiku-4-5")).toBe("anthropic/claude-haiku-4.5");
    expect(toGatewaySlug("anthropic", "claude-opus-4-6")).toBe("anthropic/claude-opus-4.6");
  });

  it("leaves already-dotted version strings alone", () => {
    expect(toGatewaySlug("openai", "gpt-4.1-mini")).toBe("openai/gpt-4.1-mini");
    expect(toGatewaySlug("openai", "gpt-5.4")).toBe("openai/gpt-5.4");
    expect(toGatewaySlug("google", "gemini-3.1-pro-preview")).toBe("google/gemini-3.1-pro-preview");
  });

  it("leaves single-segment versions alone", () => {
    // `claude-sonnet-4` has no minor version — must not become `claude-sonnet.4`
    expect(toGatewaySlug("anthropic", "claude-sonnet-4")).toBe("anthropic/claude-sonnet-4");
  });

  it("does not touch embedded version-like patterns that aren't at the tail", () => {
    // Only the trailing `-N-N` converts; mid-string patterns are preserved.
    expect(toGatewaySlug("anthropic", "claude-3-haiku")).toBe("anthropic/claude-3-haiku");
    expect(toGatewaySlug("google", "gemini-3-flash-preview")).toBe("google/gemini-3-flash-preview");
  });

  it("handles 'latest' or non-numeric tails without mangling them", () => {
    expect(toGatewaySlug("mistral", "mistral-large-latest")).toBe("mistral/mistral-large-latest");
  });
});
