import { generateText } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import { mcpTransportConfig } from "@/lib/mcp-client";
import { getModelForUser } from "@/lib/model-router";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";
import {
  buildStableSystemMessage,
  buildSnapshotTools,
  type SnapshotChatMode,
} from "@/lib/country-snapshots/chat-assembly";

/**
 * Pre-warm the Anthropic prompt cache so a user's FIRST chat turn already
 * hits the cached prefix (tools + stable system block, ~25K tokens).
 *
 * The cache is keyed on the byte-exact prefix and shared across all users
 * of the platform key, with a 5-minute TTL refreshed on every hit. The
 * client fires this fire-and-forget when a chat surface mounts; by the
 * time the user types their first message the prefix is warm.
 *
 * Cost: a cold warm pays the one-off cache write (the user's first turn
 * would have paid it anyway — this just moves it earlier); a refresh hits
 * the cache and costs ~a tenth of input price for the prefix plus one
 * output token.
 *
 * Index and page modes have different tool sets and therefore different
 * cache entries; the client passes whichever mode its surface uses.
 *
 * Abuse guards: requires the snapshot cookie, and a per-instance debounce
 * (one warm per mode per WARM_DEBOUNCE_MS) absorbs reload spam.
 */

const WARM_DEBOUNCE_MS = 4 * 60 * 1000; // under the 5-minute cache TTL

const warmRequestSchema = z.object({
  mode: z.enum(["index", "page"]),
});

// Module-level debounce. On Fluid Compute instances are reused across
// requests, so this absorbs most duplicate warms; parallel instances may
// each warm once, which is harmless (the second write is a cache hit).
const lastWarmAt: Record<SnapshotChatMode, number> = { index: 0, page: 0 };

export const maxDuration = 60;

export async function POST(req: Request) {
  const session = await requireSnapshotSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  let mode: SnapshotChatMode;
  try {
    mode = warmRequestSchema.parse(await req.json()).mode;
  } catch {
    return Response.json({ error: "invalid mode" }, { status: 400 });
  }

  const now = Date.now();
  if (now - lastWarmAt[mode] < WARM_DEBOUNCE_MS) {
    return Response.json({ warmed: false, reason: "debounced" });
  }
  lastWarmAt[mode] = now;

  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;
  try {
    mcpClient = await createMCPClient({ transport: mcpTransportConfig() });
    const mcpTools = await mcpClient.tools();
    const tools = buildSnapshotTools(mcpTools, mode);

    // The warm context only matters for the STABLE system block, which is
    // identical for every snapshot context — the dynamic block sits after
    // the cache breakpoint and is omitted entirely.
    const stableSystemMessage = buildStableSystemMessage({
      countryCodes: [],
      themeSlug: "index",
      indicatorIds: [],
    });

    const modelConfig = await getModelForUser(session.userId);

    const result = await generateText({
      model: modelConfig.model,
      messages: [
        stableSystemMessage,
        { role: "user" as const, content: "." },
      ],
      providerOptions: modelConfig.providerOptions || {},
      tools: tools as Parameters<typeof generateText>[0]["tools"],
      maxOutputTokens: 1,
    });

    const details = (
      result.totalUsage as
        | {
            inputTokenDetails?: {
              cacheReadTokens?: number;
              cacheWriteTokens?: number;
            };
          }
        | undefined
    )?.inputTokenDetails;
    console.info(
      "[country-snapshots/warm] mode=" +
        mode +
        " cacheRead=" +
        (details?.cacheReadTokens ?? 0) +
        " cacheWrite=" +
        (details?.cacheWriteTokens ?? 0),
    );

    return Response.json({
      warmed: true,
      mode,
      cacheRead: details?.cacheReadTokens ?? 0,
      cacheWrite: details?.cacheWriteTokens ?? 0,
    });
  } catch (error) {
    // A failed warm must never surface to the user — the first chat turn
    // just pays the cache write as before.
    console.warn("[country-snapshots/warm] failed", error);
    // Allow a retry sooner than the full debounce window.
    lastWarmAt[mode] = 0;
    return Response.json({ warmed: false, reason: "error" });
  } finally {
    if (mcpClient) await mcpClient.close().catch(() => {});
  }
}
