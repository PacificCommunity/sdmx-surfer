import { streamText, tool, convertToModelMessages, stepCountIs } from "ai";
import { anthropic } from "@ai-sdk/anthropic";
import { createMCPClient } from "@ai-sdk/mcp";
import { z } from "zod";
import { getSystemPrompt } from "@/lib/system-prompt";
import {
  extractKnowledgeFromMessages,
  formatKnowledgeSummary,
} from "@/lib/tier2-knowledge";
import { createRequestLogger } from "@/lib/logger";

const chatRequestSchema = z.object({
  messages: z.array(z.unknown()),
});

const textConfigSchema = z
  .object({
    text: z.union([z.string(), z.record(z.string(), z.string())]),
    size: z.string().optional(),
    weight: z.string().optional(),
    align: z.enum(["center", "left", "right"]).optional(),
    color: z.string().optional(),
    font: z.string().optional(),
    style: z.string().optional(),
  })
  .passthrough();

const legendSchema = z
  .object({
    concept: z.string().optional(),
    location: z.enum(["top", "bottom", "left", "right", "none"]).optional(),
  })
  .passthrough();

const unitSchema = z
  .object({
    text: z.string(),
    location: z.enum(["prefix", "suffix", "under"]).optional(),
  })
  .passthrough();

const visualConfigSchema = z
  .object({
    id: z.string(),
    type: z.enum([
      "line",
      "bar",
      "column",
      "pie",
      "lollipop",
      "treemap",
      "value",
      "drilldown",
      "note",
      "map",
    ]),
    colSize: z.number().optional(),
    title: textConfigSchema.optional(),
    subtitle: textConfigSchema.optional(),
    note: textConfigSchema.optional(),
    xAxisConcept: z.string().optional(),
    yAxisConcept: z.string().optional(),
    data: z.union([z.string(), z.array(z.string())]).optional(),
    legend: legendSchema.optional(),
    labels: z.boolean().optional(),
    download: z.boolean().optional(),
    sortByValue: z.enum(["asc", "desc"]).optional(),
    unit: unitSchema.optional(),
    decimals: z.union([z.number(), z.string()]).optional(),
    colorScheme: z.string().optional(),
    frame: z.boolean().optional(),
    adaptiveTextSize: z.boolean().optional(),
    dataLink: z.string().optional(),
    metadataLink: z.string().optional(),
    extraOptions: z.record(z.string(), z.unknown()).optional(),
    colorPalette: z
      .record(
        z.string(),
        z.record(z.string(), z.union([z.string(), z.number()])),
      )
      .optional(),
    drilldown: z
      .object({
        xAxisConcept: z.string(),
        legend: legendSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    if (config.type !== "note") {
      if (!config.xAxisConcept) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "xAxisConcept is required for non-note visuals",
          path: ["xAxisConcept"],
        });
      }

      if (!config.data) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "data is required for non-note visuals",
          path: ["data"],
        });
      }
    }
  });

const dashboardConfigSchema = z
  .object({
    id: z.string().describe("Unique dashboard identifier"),
    languages: z.array(z.string()).optional(),
    colCount: z.number().optional().describe("Number of grid columns, default 3"),
    header: z
      .object({
        title: textConfigSchema.optional(),
        subtitle: textConfigSchema.optional(),
      })
      .passthrough()
      .optional(),
    footer: z
      .object({
        title: textConfigSchema.optional(),
        subtitle: textConfigSchema.optional(),
      })
      .passthrough()
      .optional(),
    rows: z.array(
      z
        .object({
          columns: z.array(visualConfigSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

function getConfigTitle(config: z.infer<typeof dashboardConfigSchema>) {
  const title = config.header?.title?.text;
  if (typeof title === "string") {
    return title;
  }
  if (title && typeof title === "object") {
    const first = Object.values(title)[0];
    if (typeof first === "string") {
      return first;
    }
  }
  return config.id;
}

let mcpClientPromise: ReturnType<typeof createMCPClient> | null = null;

function getMCPClient() {
  if (!mcpClientPromise) {
    mcpClientPromise = createMCPClient({
      transport: {
        type: "http",
        url: process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp",
      },
    }).catch((error) => {
      mcpClientPromise = null;
      throw error;
    });
  }
  return mcpClientPromise;
}

const STEP_LIMIT = 25;
const NUDGE_AT = 18;

const NUDGE_MESSAGE =
  "URGENT: You are running low on tool-call budget. " +
  "You MUST call update_dashboard NOW with a draft dashboard using the data URLs " +
  "you have built so far. Use what you have discovered — do not make more discovery calls. " +
  "After emitting the dashboard, tell the user this is a first draft and offer to refine it.";

export async function POST(req: Request) {
  const sessionId = req.headers.get("x-session-id") || "anonymous";
  const logger = createRequestLogger(sessionId);

  try {
    const { messages } = chatRequestSchema.parse(await req.json());

    // Extract last user message for logging
    const uiMessages = messages as Array<{ role?: string; parts?: Array<{ type?: string; text?: string }> }>;
    const lastUser = uiMessages.filter((m) => m.role === "user").pop();
    const lastUserText = lastUser?.parts
      ?.filter((p) => p.type === "text")
      .map((p) => p.text)
      .join(" ") || "";
    logger.setUserMessage(lastUserText);

    const mcpClient = await getMCPClient();
    const mcpTools = await mcpClient.tools();

    const modelMessages = await convertToModelMessages(
      messages as Parameters<typeof convertToModelMessages>[0],
    );

    // Tier 2: extract knowledge from conversation history
    const tier2Knowledge = extractKnowledgeFromMessages(modelMessages);
    const tier2Summary = formatKnowledgeSummary(tier2Knowledge);

    const systemPromptBase = getSystemPrompt();
    const systemPrompt = tier2Summary
      ? systemPromptBase + "\n\n" + tier2Summary
      : systemPromptBase;

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
