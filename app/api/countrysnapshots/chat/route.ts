import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { mcpTransportConfig } from "@/lib/mcp-client";
import { getModelForUser } from "@/lib/model-router";
import { sanitizeToolInputs } from "@/lib/sanitize-messages";
import { createRequestLogger } from "@/lib/logger";
import { db, dashboardSessions } from "@/lib/db";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";
import {
  buildSnapshotSystemPromptParts,
  type SnapshotContext,
} from "@/lib/country-snapshots/system-prompt";
import {
  getMode,
  catalogueTool,
} from "@/lib/country-snapshots/catalogue-access";
import { checkTurnCap } from "@/lib/country-snapshots/turn-cap";
import {
  compileDashboardToolConfig,
  dashboardToolConfigSchema,
} from "@/lib/dashboard-authoring";
import { resolveDataflowNamesFromConfig } from "@/lib/dataflow-names";
import { getConfigTitle } from "@/lib/dashboard-schema";

// Per-page snapshot chats are read-only and tightly capped. The index
// (entry-page) mode is a full builder agent and needs more room.
const STEP_LIMIT_PAGE = 12;
const STEP_LIMIT_INDEX = 25;
const MAX_MESSAGES = 200;
const MAX_INDICATOR_IDS = 100;

// countryCodes / themeSlug / indicatorIds all relax to empty for the
// entry-page catalogue-wide mode. Page-scoped chats fill them in.
const snapshotContextSchema = z.object({
  countryCodes: z.array(z.string()).max(5),
  themeSlug: z.string(),
  indicatorIds: z.array(z.string()).max(MAX_INDICATOR_IDS),
});

const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).max(MAX_MESSAGES),
  snapshotContext: snapshotContextSchema,
  sessionId: z.string().optional(),
});

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await requireSnapshotSession();
  if (!session) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cap = await checkTurnCap(session.userId);
  if (!cap.allowed) {
    return Response.json(
      {
        error: "cap-reached",
        message:
          "You have reached today's free chat limit. Sign in via 'Explore in Surfer' to continue.",
        used: cap.used,
        cap: cap.cap,
      },
      { status: 429 },
    );
  }

  const logger = createRequestLogger(
    session.userId,
    `snapshot-${session.uid.slice(0, 8)}`,
  );
  let mcpClient: Awaited<ReturnType<typeof createMCPClient>> | null = null;

  try {
    const body = chatRequestSchema.parse(await req.json());
    const { messages, snapshotContext, sessionId } = body;

    // Last user message for the activity log.
    const uiMessages = messages as Array<{
      role?: string;
      parts?: Array<{ type?: string; text?: string }>;
    }>;
    const lastUser = uiMessages.filter((m) => m.role === "user").pop();
    const lastUserText =
      lastUser?.parts
        ?.filter((p) => p.type === "text")
        .map((p) => p.text)
        .join(" ") || "";
    logger.setUserMessage(lastUserText);

    mcpClient = await createMCPClient({ transport: mcpTransportConfig() });
    const mcpTools = await mcpClient.tools();

    // The snapshot is read-only: drop update_dashboard if the MCP gateway
    // happens to expose it. The chat overlay can investigate but not
    // mutate.
    const safeMcpTools = Object.fromEntries(
      Object.entries(mcpTools).filter(([name]) => name !== "update_dashboard"),
    );

    const sanitized = sanitizeToolInputs(
      messages as Array<Record<string, unknown>>,
    );
    const modelMessages = await convertToModelMessages(
      sanitized as Parameters<typeof convertToModelMessages>[0],
      { ignoreIncompleteToolCalls: true },
    );

    // Split system prompt: the stable block (base prompt + catalogue) gets
    // an Anthropic cache breakpoint; the dynamic block (per-page context)
    // follows uncached. Anthropic's cache prefix is tools → system →
    // messages, so the breakpoint on the stable system block also caches
    // the ~8K tokens of MCP tool definitions ahead of it. Without this,
    // every step of every turn re-prefills the full ~21K-token prefix.
    // NOTE: cache_control must sit on MESSAGE-level providerOptions — the
    // provider ignores it at the streamText call level.
    const { stable, dynamic } = buildSnapshotSystemPromptParts({
      ctx: snapshotContext as SnapshotContext,
    });
    const systemMessages = [
      {
        role: "system" as const,
        content: stable,
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" as const } },
        },
      },
      { role: "system" as const, content: dynamic },
    ];
    const modelConfig = await getModelForUser(session.userId);
    logger.setModelInfo(
      modelConfig.modelId,
      modelConfig.providerId,
      modelConfig.keySource,
    );

    // Index (entry-page) mode unlocks update_dashboard so the assistant can
    // actually produce a live dashboard; per-page snapshot chats stay
    // read-only (the canonical snapshot config must not mutate).
    const isIndex =
      snapshotContext.themeSlug === "index" ||
      snapshotContext.countryCodes.length === 0;

    const updateDashboardTool = tool({
      description:
        "Send a dashboard configuration to the live preview. " +
        "Prefer the simplified authoring schema (intent visuals like kpi, chart, map, note). " +
        "Always send the complete config, not just changed parts.",
      inputSchema: z.object({ config: dashboardToolConfigSchema }),
      execute: async ({
        config,
      }: {
        config: z.infer<typeof dashboardToolConfigSchema>;
      }) => {
        const compiled = compileDashboardToolConfig(config);
        compiled.dataflows = resolveDataflowNamesFromConfig(compiled);
        return {
          success: true,
          dashboard: compiled,
          message:
            "Dashboard updated. The preview now shows: " +
            getConfigTitle(compiled),
        };
      },
    });

    const indexTools = {
      ...mcpTools,                          // index mode is allowed to mutate
      ...(getMode() === "tool"
        ? { list_catalogue_indicators: catalogueTool }
        : {}),
      update_dashboard: updateDashboardTool,
    };
    const pageTools =
      getMode() === "tool"
        ? { ...safeMcpTools, list_catalogue_indicators: catalogueTool }
        : safeMcpTools;
    const tools = isIndex ? indexTools : pageTools;

    const result = streamText({
      model: modelConfig.model,
      messages: [...systemMessages, ...modelMessages],
      providerOptions: modelConfig.providerOptions || {},
      tools,
      stopWhen: stepCountIs(isIndex ? STEP_LIMIT_INDEX : STEP_LIMIT_PAGE),
      onFinish: async ({ steps, totalUsage }) => {
        let totalCost = 0;
        let anyCost = false;
        for (const step of steps) {
          const c = (
            step.providerMetadata as { gateway?: { cost?: string } } | undefined
          )?.gateway?.cost;
          if (c == null) continue;
          const parsed = parseFloat(c);
          if (Number.isFinite(parsed)) {
            totalCost += parsed;
            anyCost = true;
          }
        }
        // Cache observability. The AI SDK standardises cache accounting on
        // totalUsage (inputTokenDetails.cacheReadTokens / cacheWriteTokens);
        // the provider-metadata field names differ per provider and per
        // gateway hop, so don't read them. read ≫ write on warm turns
        // means the system-prompt cache breakpoint is working.
        const details = (
          totalUsage as
            | {
                inputTokenDetails?: {
                  cacheReadTokens?: number;
                  cacheWriteTokens?: number;
                  noCacheTokens?: number;
                };
              }
            | undefined
        )?.inputTokenDetails;
        if (details?.cacheReadTokens || details?.cacheWriteTokens) {
          console.info(
            "[country-snapshots/chat] prompt cache: read=" +
              (details.cacheReadTokens ?? 0) +
              " write=" +
              (details.cacheWriteTokens ?? 0) +
              " uncached=" +
              (details.noCacheTokens ?? 0) +
              " across " +
              steps.length +
              " steps",
          );
        }
        logger.setCostUsd(anyCost ? totalCost : null);
        await logger.flush(
          totalUsage
            ? {
                input: totalUsage.inputTokens ?? 0,
                output: totalUsage.outputTokens ?? 0,
              }
            : undefined,
        );
        // Persist the conversation to dashboardSessions for resumability.
        try {
          const finalText = steps[steps.length - 1]?.text ?? "";
          const updatedMessages = [
            ...(messages as unknown[]),
            { role: "assistant", content: finalText },
          ];
          if (sessionId) {
            await db
              .update(dashboardSessions)
              .set({
                messages: updatedMessages as unknown as never,
                updated_at: new Date(),
              })
              .where(eq(dashboardSessions.id, sessionId));
          } else {
            await db.insert(dashboardSessions).values({
              user_id: session.userId,
              title: `Snapshot chat — ${snapshotContext.countryCodes.join("+")} ${snapshotContext.themeSlug}`,
              messages: updatedMessages as unknown as never,
              config_history: [] as unknown as never,
              config_pointer: -1,
            });
          }
        } catch (err) {
          console.warn(
            "[country-snapshots/chat] persistence failed",
            err,
          );
        }
        if (mcpClient) await mcpClient.close().catch(() => {});
      },
      onError: async ({ error }) => {
        console.error("[country-snapshots/chat] streamText error", error);
        logger.recordError(
          error instanceof Error ? error.message : String(error),
        );
        await logger.flush().catch(() => {});
        if (mcpClient) await mcpClient.close().catch(() => {});
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[country-snapshots/chat] request failed", error);
    logger.recordError(error instanceof Error ? error.message : String(error));
    await logger.flush();
    if (mcpClient) await mcpClient.close().catch(() => {});
    return Response.json(
      { error: "The chat request failed. Please try again." },
      { status: 500 },
    );
  }
}
