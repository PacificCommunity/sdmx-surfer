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

import { generateText, streamText, tool, stepCountIs } from "ai";
import { z } from "zod";
import { gateway } from "@ai-sdk/gateway";
import { anthropic } from "@ai-sdk/anthropic";
import { toGatewaySlug } from "@/lib/model-router";
import { PLATFORM_MODELS } from "@/lib/platform-models";

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

async function runMultiStepToolChain() {
  section("E) Multi-step tool chain (3 sequential calls, each platform model)");
  if (!process.env.AI_GATEWAY_API_KEY) {
    fail("AI_GATEWAY_API_KEY missing — skipping");
    return;
  }

  // Three tools that must be called in order. The correct answer is 18.
  //   start → 2, square(2) → 4, add_one(4) → 5, triple(5) → 15... wait let's use
  //   start → 2, square(2) → 4, triple(4) → 12, add_one(12) → 13.
  // Point is: model must call three different tools sequentially.
  const startTool = tool({
    description: "Return the starting number.",
    inputSchema: z.object({}),
    execute: async () => ({ value: 2 }),
  });
  const squareTool = tool({
    description: "Square the given number.",
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }: { n: number }) => ({ value: n * n }),
  });
  const tripleTool = tool({
    description: "Multiply the given number by 3.",
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }: { n: number }) => ({ value: n * 3 }),
  });
  const addOneTool = tool({
    description: "Add 1 to the given number.",
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }: { n: number }) => ({ value: n + 1 }),
  });

  const PROMPT =
    "Use the tools to compute this sequence, in order: " +
    "(1) call 'start' to get a starting number, " +
    "(2) call 'square' on that number, " +
    "(3) call 'triple' on that result, " +
    "(4) call 'add_one' on that result. " +
    "Reply with only the final integer. Do not compute it yourself.";

  // Mirror the per-provider providerOptions the server-side router sets in
  // lib/model-router.ts:platformViaGateway(). Without these, the smoke is
  // testing raw gateway defaults — not what production code actually sends.
  const providerOptionsFor = (providerId: string): Record<string, unknown> | undefined => {
    if (providerId === "anthropic") {
      return { anthropic: { cacheControl: { type: "ephemeral" } } };
    }
    if (providerId === "mistral") {
      return { mistral: { parallelToolCalls: false } };
    }
    return undefined;
  };

  for (const m of PLATFORM_MODELS) {
    const slug = toGatewaySlug(m.providerId, m.modelId);
    console.log("\n  → " + slug);
    const toolsCalled: string[] = [];
    try {
      const result = await generateText({
        model: gateway(slug),
        prompt: PROMPT,
        tools: {
          start: startTool,
          square: squareTool,
          triple: tripleTool,
          add_one: addOneTool,
        },
        stopWhen: stepCountIs(8),
        providerOptions: providerOptionsFor(m.providerId),
        onStepFinish: ({ toolCalls }) => {
          if (!toolCalls) return;
          for (const tc of toolCalls) toolsCalled.push(tc.toolName);
        },
      });
      const meta = result.providerMetadata as
        | { gateway?: { cost?: string } }
        | undefined;
      const cost = meta?.gateway?.cost ?? "n/a";
      const reply = (result.text ?? "").trim().slice(0, 40);
      const order = toolsCalled.join(" → ");
      const expectedAll = ["start", "square", "triple", "add_one"].every((t) =>
        toolsCalled.includes(t),
      );
      const finalCorrect = /\b13\b/.test(reply);
      if (expectedAll && finalCorrect) {
        ok("all 4 tools called (" + order + ") · reply: " + JSON.stringify(reply) + " · $" + cost);
      } else {
        fail(
          "tools=[" +
            order +
            "] · reply: " +
            JSON.stringify(reply) +
            " · $" +
            cost +
            (expectedAll ? "" : " · missing tool calls") +
            (finalCorrect ? "" : " · wrong final (expected 13)"),
        );
      }
    } catch (err) {
      fail("exception: " + (err instanceof Error ? err.message : String(err)));
    }
  }
}

async function runStreamingChecks() {
  section("F) Streaming works through the gateway (streamText code path)");
  if (!process.env.AI_GATEWAY_API_KEY) {
    fail("AI_GATEWAY_API_KEY missing — skipping");
    return;
  }

  // Test streaming on two providers: Anthropic (incumbent, cacheControl) and
  // OpenAI (different streaming shape). If both work, the route.ts path is
  // covered since it uses the same streamText call.
  const targets = PLATFORM_MODELS.filter(
    (m) => m.providerId === "anthropic" || m.providerId === "openai",
  );

  for (const m of targets) {
    const slug = toGatewaySlug(m.providerId, m.modelId);
    console.log("\n  → " + slug);
    try {
      const isAnthropic = m.providerId === "anthropic";
      // Long enough (~200+ chars output) that the provider must emit multiple
      // content deltas — a single-chunk response is a real "no streaming"
      // signal, not just a short reply fitting in one event.
      const result = streamText({
        model: gateway(slug),
        prompt:
          "Write a 5-sentence description of the Pacific Ocean. Keep it factual.",
        providerOptions: isAnthropic
          ? { anthropic: { cacheControl: { type: "ephemeral" } } }
          : undefined,
      });
      let chunkCount = 0;
      let text = "";
      for await (const part of result.textStream) {
        chunkCount++;
        text += part;
      }
      const usage = await result.usage;
      const meta = (await result.providerMetadata) as
        | { gateway?: { cost?: string } }
        | undefined;
      const cost = meta?.gateway?.cost ?? "n/a";
      // With ~200+ chars of output we expect at least 3 deltas — less than that
      // means the gateway buffered instead of streaming.
      if (chunkCount >= 3 && text.length >= 100 && usage?.inputTokens) {
        ok(
          "streamed " +
            chunkCount +
            " chunks (" +
            text.length +
            " chars) · $" +
            cost,
        );
      } else {
        fail(
          "chunks=" +
            chunkCount +
            " text.length=" +
            text.length +
            " usage.inputTokens=" +
            (usage?.inputTokens ?? "missing") +
            " — gateway may be buffering",
        );
      }
    } catch (err) {
      fail("exception: " + (err instanceof Error ? err.message : String(err)));
    }
  }
}

async function runToolCallAcrossProviders() {
  section("D) Tool-calling sanity check (each platform model, one turn)");
  if (!process.env.AI_GATEWAY_API_KEY) {
    fail("AI_GATEWAY_API_KEY missing — skipping");
    return;
  }

  // A trivial tool the model must call to answer. If tool-calling is broken on
  // a given model, it answers in plain text and we detect the skip.
  const echoTool = tool({
    description: "Reverse the given string. Use this to answer the prompt.",
    inputSchema: z.object({ value: z.string() }),
    execute: async ({ value }: { value: string }) => ({
      reversed: value.split("").reverse().join(""),
    }),
  });

  for (const m of PLATFORM_MODELS) {
    const slug = toGatewaySlug(m.providerId, m.modelId);
    console.log("\n  → " + slug);
    let toolWasCalled = false;
    try {
      const result = await generateText({
        model: gateway(slug),
        prompt:
          "Call the reverse tool on the string 'hello'. After it returns, reply with only the reversed value.",
        tools: { reverse: echoTool },
        stopWhen: stepCountIs(3),
        onStepFinish: ({ toolCalls }) => {
          if (toolCalls && toolCalls.length > 0) toolWasCalled = true;
        },
      });
      const meta = result.providerMetadata as
        | { gateway?: { cost?: string } }
        | undefined;
      const cost = meta?.gateway?.cost ?? "n/a";
      const text = (result.text ?? "").trim().slice(0, 60);
      if (toolWasCalled) {
        ok("tool called · cost $" + cost + " · reply: " + JSON.stringify(text));
      } else {
        fail(
          "tool NOT called · cost $" +
            cost +
            " · reply: " +
            JSON.stringify(text) +
            " — tool-calling may not work with this model",
        );
      }
    } catch (err) {
      fail("exception: " + (err instanceof Error ? err.message : String(err)));
    }
  }
}

async function runMistralDiagnostics() {
  section("G) Mistral multi-step diagnostics");
  if (!process.env.AI_GATEWAY_API_KEY) {
    fail("AI_GATEWAY_API_KEY missing — skipping");
    return;
  }

  const startTool = tool({
    description: "Return the starting number.",
    inputSchema: z.object({}),
    execute: async () => ({ value: 2 }),
  });
  const squareTool = tool({
    description: "Square the given number.",
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }: { n: number }) => ({ value: n * n }),
  });
  const tripleTool = tool({
    description: "Multiply the given number by 3.",
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }: { n: number }) => ({ value: n * 3 }),
  });
  const addOneTool = tool({
    description: "Add 1 to the given number.",
    inputSchema: z.object({ n: z.number() }),
    execute: async ({ n }: { n: number }) => ({ value: n + 1 }),
  });

  const PROMPT =
    "Use the tools to compute this sequence, in order: " +
    "(1) call 'start', " +
    "(2) call 'square' on that number, " +
    "(3) call 'triple' on that result, " +
    "(4) call 'add_one' on that result. " +
    "Reply with only the final integer from the last tool result.";

  const candidates: Array<{ slug: string; label: string; forceSequential?: boolean }> = [
    { slug: "mistral/mistral-large-3", label: "mistral-large-3 (default)" },
    {
      slug: "mistral/mistral-large-3",
      label: "mistral-large-3 (parallelToolCalls:false)",
      forceSequential: true,
    },
    { slug: "mistral/mistral-medium", label: "mistral-medium (default)" },
    {
      slug: "mistral/mistral-medium",
      label: "mistral-medium (parallelToolCalls:false)",
      forceSequential: true,
    },
    { slug: "mistral/codestral", label: "codestral (default)" },
    {
      slug: "mistral/codestral",
      label: "codestral (parallelToolCalls:false)",
      forceSequential: true,
    },
  ];

  for (const c of candidates) {
    console.log("\n  → " + c.label);
    try {
      const result = await generateText({
        model: gateway(c.slug),
        prompt: PROMPT,
        tools: {
          start: startTool,
          square: squareTool,
          triple: tripleTool,
          add_one: addOneTool,
        },
        stopWhen: stepCountIs(8),
        providerOptions: c.forceSequential
          ? { mistral: { parallelToolCalls: false } }
          : undefined,
      });
      console.log("    final text: " + JSON.stringify((result.text ?? "").trim().slice(0, 60)));
      console.log("    steps: " + result.steps.length);
      for (let i = 0; i < result.steps.length; i++) {
        const s = result.steps[i];
        const calls = s.toolCalls?.map((tc) => tc.toolName) ?? [];
        const resultsShape = s.toolResults?.map((tr) => {
          const out = (tr as { output?: unknown }).output;
          return typeof out === "object" && out !== null ? JSON.stringify(out) : String(out);
        }) ?? [];
        const textPreview = (s.text ?? "").trim().slice(0, 50);
        console.log(
          "    step[" +
            i +
            "] calls=[" +
            calls.join(",") +
            "] results=[" +
            resultsShape.join(",") +
            "] text=" +
            JSON.stringify(textPreview),
        );
      }
      const correctFinalInText = /\b13\b/.test(result.text ?? "");
      if (correctFinalInText) ok("reply contains 13 — " + c.label + " works end-to-end");
      else fail(c.label + " did not produce 13 — see step trace above");
    } catch (err) {
      fail("exception: " + (err instanceof Error ? err.message : String(err)));
    }
  }
}

(async () => {
  await runSlugChecks();
  await runGatewayPath();
  await runDirectPath();
  await runToolCallAcrossProviders();
  await runMultiStepToolChain();
  await runStreamingChecks();
  await runMistralDiagnostics();
  console.log("\nDone. Review results above.\n");
})().catch((err) => {
  console.error("\n[smoke-gateway] Unhandled error:", err);
  process.exit(1);
});
