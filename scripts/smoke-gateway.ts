#!/usr/bin/env npx tsx
/**
 * Smoke test for the Vercel AI Gateway migration.
 *
 * Verifies, end-to-end against live services:
 *   A) Gateway path  — calls claude-sonnet-4.6 through the gateway, prints
 *      usage + provider metadata, and confirms the per-request cost and
 *      credential type come back inline in providerMetadata.gateway.
 *   B) Direct path   — calls the same model through the Anthropic SDK directly,
 *      prints usage. Confirms nothing regressed with the flag off.
 *   C) Slug normalization — asserts toGatewaySlug() produces gateway-valid IDs.
 *
 * BYOK paths are not exercised here — they never touch the gateway by design,
 * and testing them requires a user's encrypted key. Covered by unit tests.
 *
 * Prereqs:
 *   - AI_GATEWAY_API_KEY in .env.local
 *   - ANTHROPIC_API_KEY in .env.local (for path B)
 *
 * Usage:
 *   npx tsx scripts/smoke-gateway.ts
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { generateText } from "ai";
import { gateway } from "@ai-sdk/gateway";
import { anthropic } from "@ai-sdk/anthropic";
import { toGatewaySlug } from "@/lib/model-router";

const MODEL_ID = "claude-sonnet-4-6"; // canonical (dashed) form used in DB / DEFAULT_MODELS
const PROMPT = "Reply with exactly one word: ok";

function section(title: string) {
  console.log("\n" + "=".repeat(60));
  console.log(title);
  console.log("=".repeat(60));
}

function ok(label: string) {
  console.log("  \u2713 " + label);
}

function fail(label: string) {
  console.log("  \u2717 " + label);
}

interface GatewayMetadata {
  cost?: string;
  generationId?: string;
  routing?: {
    finalProvider?: string;
    modelAttempts?: Array<{
      providerAttempts?: Array<{ credentialType?: string }>;
    }>;
  };
}

async function runSlugChecks() {
  section("C) Slug normalization");
  const cases: Array<[string, string, string]> = [
    ["anthropic", "claude-sonnet-4-6", "anthropic/claude-sonnet-4.6"],
    ["anthropic", "claude-haiku-4-5", "anthropic/claude-haiku-4.5"],
    ["openai", "gpt-4.1-mini", "openai/gpt-4.1-mini"],
    ["mistral", "mistral-large-latest", "mistral/mistral-large-latest"],
  ];
  for (const [provider, input, expected] of cases) {
    const actual = toGatewaySlug(provider, input);
    if (actual === expected) ok(provider + "/" + input + " -> " + actual);
    else fail(provider + "/" + input + " -> " + actual + " (expected " + expected + ")");
  }
}

async function runGatewayPath() {
  section("A) Gateway path (USE_AI_GATEWAY=1 equivalent)");
  if (!process.env.AI_GATEWAY_API_KEY) {
    fail("AI_GATEWAY_API_KEY missing in .env.local — skipping");
    return;
  }
  const slug = toGatewaySlug("anthropic", MODEL_ID);
  console.log("  model: " + slug);

  const result = await generateText({
    model: gateway(slug),
    prompt: PROMPT,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  });

  console.log("  text: " + JSON.stringify(result.text));
  console.log("  usage: " + JSON.stringify(result.usage));
  console.log("  providerMetadata: " + JSON.stringify(result.providerMetadata));

  if (result.usage && (result.usage.inputTokens ?? 0) > 0) ok("usage.inputTokens populated");
  else fail("usage.inputTokens missing");

  const meta = result.providerMetadata as { gateway?: GatewayMetadata } | undefined;
  const g = meta?.gateway;
  if (!g) {
    fail("no gateway metadata in providerMetadata — dump above for inspection");
    return;
  }

  if (g.generationId) ok("generation id: " + g.generationId);
  else fail("generation id missing");

  const cost = g.cost ? parseFloat(g.cost) : NaN;
  if (Number.isFinite(cost) && cost > 0) ok("cost = $" + g.cost + " (inline in response)");
  else fail("cost missing or zero: " + g.cost);

  const credType =
    g.routing?.modelAttempts?.[0]?.providerAttempts?.[0]?.credentialType;
  if (credType === "system") ok("credentialType = system (platform path, equivalent to is_byok:false)");
  else fail("credentialType = " + credType + " (expected 'system')");

  const finalProvider = g.routing?.finalProvider;
  if (finalProvider === "anthropic") ok("finalProvider = anthropic");
  else fail("finalProvider = " + finalProvider);
}

async function runDirectPath() {
  section("B) Direct SDK path (flag off equivalent)");
  if (!process.env.ANTHROPIC_API_KEY) {
    fail("ANTHROPIC_API_KEY missing in .env.local — skipping");
    return;
  }
  console.log("  model: anthropic/" + MODEL_ID);
  const result = await generateText({
    model: anthropic(MODEL_ID),
    prompt: PROMPT,
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  });
  console.log("  text: " + JSON.stringify(result.text));
  console.log("  usage: " + JSON.stringify(result.usage));
  if (result.usage && (result.usage.inputTokens ?? 0) > 0) ok("usage.inputTokens populated");
  else fail("usage.inputTokens missing");
}

(async () => {
  await runSlugChecks();
  await runGatewayPath();
  await runDirectPath();
  console.log("\nDone. Review results above.\n");
})().catch((err) => {
  console.error("\n[smoke-gateway] Unhandled error:", err);
  process.exit(1);
});
