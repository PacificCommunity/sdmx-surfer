import { streamText, convertToModelMessages, stepCountIs } from "ai";
import { createMCPClient } from "@ai-sdk/mcp";
import { and, eq } from "drizzle-orm";
import { mcpTransportConfig } from "@/lib/mcp-client";
import { getModelForUser } from "@/lib/model-router";
import { sanitizeToolInputs } from "@/lib/sanitize-messages";
import { createRequestLogger } from "@/lib/logger";
import { db, dashboardSessions } from "@/lib/db";
import { auth } from "@/lib/auth";
import { type SnapshotContext } from "@/lib/country-snapshots/system-prompt";
import {
  buildSystemMessages,
  buildSnapshotTools,
  chatRequestSchema,
  modeFor,
} from "@/lib/country-snapshots/chat-assembly";
import { checkTurnCap } from "@/lib/country-snapshots/turn-cap";
import { checkGlobalBudget } from "@/lib/usage-caps";

// Per-page snapshot chats are read-only and tightly capped. The index
// (entry-page) mode is a full builder agent and needs more room.
const STEP_LIMIT_PAGE = 12;
const STEP_LIMIT_INDEX = 25;

export const maxDuration = 120;

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.userId;

  // Global AI budget circuit breaker applies everywhere, snapshots included.
  const budget = await checkGlobalBudget();
  if (!budget.allowed) {
    return Response.json(
      {
        error: "global_budget",
        message:
          "Data Surfer has reached its AI usage budget for now, so new requests are paused while it is topped up. The snapshot pages themselves are still available.",
      },
      { status: 503 },
    );
  }

  const cap = await checkTurnCap(userId);
  if (!cap.allowed) {
    return Response.json(
      {
        error: "cap-reached",
        message:
          "You have reached today's Country Snapshots chat limit. It resets within 24 hours.",
        used: cap.used,
        cap: cap.cap,
      },
      { status: 429 },
    );
  }

  // No dashboard session id: the snapshot conversation row is only written
  // in onFinish, after the log flush, and usage_logs.session_id is a foreign
  // key to dashboard_sessions.
  const logger = createRequestLogger(userId, "anonymous");
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

    const modelConfig = await getModelForUser(userId);
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
        // The client generates one uuid per conversation and sends it on
        // every turn, so the whole exchange lives in ONE row (update-first,
        // insert on the first turn). The update predicate scopes by owner —
        // a client-supplied sessionId must never touch another user's row.
        // The row belongs to the signed-in user, so it shows up in their
        // Surfer session list: store the reply as a UIMessage ({ id, role,
        // parts }) like the client's own messages, because the builder
        // renders message.parts and crashes on a bare { role, content }.
        try {
          const finalText = steps[steps.length - 1]?.text ?? "";
          const updatedMessages = [
            ...(messages as unknown[]),
            {
              id: crypto.randomUUID(),
              role: "assistant",
              parts: [{ type: "text", text: finalText }],
            },
          ];
          if (sessionId) {
            const updated = await db
              .update(dashboardSessions)
              .set({
                messages: updatedMessages as unknown as never,
                updated_at: new Date(),
              })
              .where(
                and(
                  eq(dashboardSessions.id, sessionId),
                  eq(dashboardSessions.user_id, userId),
                ),
              )
              .returning({ id: dashboardSessions.id });
            if (updated.length === 0) {
              // First turn of this conversation (or a uuid we don't own —
              // in which case the insert below fails on the primary key
              // and we log + move on rather than clobbering anything).
              await db.insert(dashboardSessions).values({
                id: sessionId,
                user_id: userId,
                title: `Snapshot chat — ${snapshotContext.countryCodes.join("+") || "catalogue"} ${snapshotContext.themeSlug}`,
                messages: updatedMessages as unknown as never,
                config_history: [] as unknown as never,
                config_pointer: -1,
              });
            }
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
      // The AI SDK fires onAbort (not onFinish) when the client disconnects
      // mid-stream — e.g. the user navigates between snapshot pages while
      // the assistant is replying. Without this the MCP HTTP session leaks.
      onAbort: async () => {
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
