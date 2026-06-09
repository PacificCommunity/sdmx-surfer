import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { mcpTransportConfig } from "@/lib/mcp-client";
import { getModelForUser } from "@/lib/model-router";
import { sanitizeToolInputs } from "@/lib/sanitize-messages";
import { createRequestLogger } from "@/lib/logger";
import { db, dashboardSessions } from "@/lib/db";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";
import { type SnapshotContext } from "@/lib/country-snapshots/system-prompt";
import {
  buildSystemMessages,
  buildSnapshotTools,
  modeFor,
} from "@/lib/country-snapshots/chat-assembly";
import { checkTurnCap } from "@/lib/country-snapshots/turn-cap";

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

    const sanitized = sanitizeToolInputs(
      messages as Array<Record<string, unknown>>,
    );
    const modelMessages = await convertToModelMessages(
      sanitized as Parameters<typeof convertToModelMessages>[0],
      { ignoreIncompleteToolCalls: true },
    );

    // Tools + the stable system message form the Anthropic cache prefix.
    // Assembly lives in chat-assembly.ts, SHARED with the warm route —
    // both must produce a byte-identical prefix or pre-warming silently
    // stops working.
    const ctx = snapshotContext as SnapshotContext;
    const mode = modeFor(ctx);
    const systemMessages = buildSystemMessages(ctx);
    const tools = buildSnapshotTools(mcpTools, mode);

    const modelConfig = await getModelForUser(session.userId);
    logger.setModelInfo(
      modelConfig.modelId,
      modelConfig.providerId,
      modelConfig.keySource,
    );

    const result = streamText({
      model: modelConfig.model,
      messages: [...systemMessages, ...modelMessages],
      providerOptions: modelConfig.providerOptions || {},
      tools: tools as Parameters<typeof streamText>[0]["tools"],
      stopWhen: stepCountIs(
        mode === "index" ? STEP_LIMIT_INDEX : STEP_LIMIT_PAGE,
      ),
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
