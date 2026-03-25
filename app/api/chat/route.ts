import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import {
  dashboardConfigSchema,
  getConfigTitle,
} from "@/lib/dashboard-schema";
import { getSystemPrompt } from "@/lib/system-prompt";
import {
  extractKnowledgeFromMessages,
  formatKnowledgeSummary,
} from "@/lib/tier2-knowledge";
import { createRequestLogger } from "@/lib/logger";

const chatRequestSchema = z.object({
  messages: z.array(z.unknown()),
  previewError: z.string().optional(),
});

const STEP_LIMIT = 25;
const NUDGE_AT = 18;

const NUDGE_MESSAGE =
  "URGENT: You are running low on tool-call budget. " +
  "You MUST call update_dashboard NOW with a draft dashboard using the data URLs " +
  "you have built so far. Use what you have discovered — do not make more discovery calls. " +
  "After emitting the dashboard, tell the user this is a first draft and offer to refine it.";

export const maxDuration = 300;

export async function POST(req: Request) {
  const sessionId = req.headers.get("x-session-id") || "anonymous";
  const logger = createRequestLogger(sessionId);

  try {
    const { messages, previewError } = chatRequestSchema.parse(await req.json());

    // Extract last user message for logging
    const uiMessages = messages as Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>;
    const lastUser = uiMessages.filter((m) => m.role === "user").pop();
    const lastUserText = lastUser?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ") || "";
    logger.setUserMessage(lastUserText);

    const mcpClient = await createMCPClient({
      transport: {
        type: "http",
        url: process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp",
      },
    });
    const mcpTools = await mcpClient.tools();

    const modelMessages = await convertToModelMessages(
      messages as Parameters<typeof convertToModelMessages>[0],
    );

    // Tier 2: extract knowledge from conversation history
    const tier2Knowledge = extractKnowledgeFromMessages(modelMessages);
    const tier2Summary = formatKnowledgeSummary(tier2Knowledge);

    const systemPromptBase = getSystemPrompt();
    const previewRepairPrompt = previewError
      ? "## Preview Repair Context\n\n" +
        "The previous dashboard render failed in the live preview. " +
        "Treat this as hidden system feedback, not as a user message. " +
        "Fix only the broken component(s), then call update_dashboard again.\n\n" +
        "Preview error details:\n" +
        previewError
      : "";
    const systemPrompt = [systemPromptBase, tier2Summary, previewRepairPrompt]
      .filter(Boolean)
      .join("\n\n");

    let dashboardEmitted = false;
    let currentStep = 0;

    const result = streamText({
      model: anthropic("claude-sonnet-4-6"),
      system: systemPrompt,
      messages: modelMessages,
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
      tools: {
        ...mcpTools,
        update_dashboard: tool({
          description:
            "Send a dashboard configuration to the live preview. " +
            "Call this tool whenever you want to create or update the dashboard. " +
            "Always send the complete config, not just changed parts.",
          inputSchema: z.object({ config: dashboardConfigSchema }),
          execute: async ({
            config,
          }: {
            config: z.infer<typeof dashboardConfigSchema>;
          }) => {
            dashboardEmitted = true;
            const result = {
              success: true,
              dashboard: config,
              message: "Dashboard updated. The preview now shows: " + getConfigTitle(config),
            };
            logger.recordToolCall(
              "update_dashboard",
              { configId: config.id },
              result,
              currentStep,
            );
            return result;
          },
        }),
      },
      stopWhen: stepCountIs(STEP_LIMIT),
      prepareStep: ({ stepNumber }) => {
        currentStep = stepNumber;

        if (stepNumber >= NUDGE_AT && !dashboardEmitted) {
          // Combine Tier 2 knowledge + nudge
          const nudgedPrompt = tier2Summary
            ? systemPromptBase + "\n\n" + tier2Summary + "\n\n" + NUDGE_MESSAGE
            : systemPromptBase + "\n\n" + NUDGE_MESSAGE;
          return { system: nudgedPrompt };
        }

        // Inject Tier 2 on every step (knowledge might grow via in-flight tool calls,
        // but for now the initial extraction covers the conversation history)
        if (tier2Summary) {
          return { system: systemPrompt };
        }

        return {};
      },
      onStepFinish: ({ toolCalls }) => {
        if (!toolCalls) return;
        for (const tc of toolCalls) {
          if (tc.toolName !== "update_dashboard") {
            const tcAny = tc as Record<string, unknown>;
            logger.recordToolCall(
              tc.toolName,
              (tcAny.args ?? tcAny.input ?? {}) as Record<string, unknown>,
              (tcAny.result ?? tcAny.output) as unknown,
              currentStep,
            );
          }
        }
      },
      onFinish: async ({ text, usage }) => {
        logger.setAiResponse(text);
        await logger.flush(
          usage
            ? { input: usage.inputTokens ?? 0, output: usage.outputTokens ?? 0 }
            : undefined,
        );
      },
    });

    return result.toUIMessageStreamResponse();
  } catch (error) {
    console.error("[api/chat] Request failed", error);
    logger.recordError(error instanceof Error ? error.message : String(error));
    await logger.flush();

    const message =
      error instanceof Error
        ? error.message
        : "The chat request failed before the model could respond.";

    return Response.json({ error: message }, { status: 500 });
  }
}
