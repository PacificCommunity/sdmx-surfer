import { db, usageLogs } from "@/lib/db";

export interface ChatLogEntry {
  timestamp: string;
  userId: string;
  sessionId: string;
  requestId: string;
  userMessage: string;
  aiResponse: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    resultPreview: string;
    stepNumber: number;
  }>;
  dashboardConfigIds: string[];
  errors: string[];
  tokenUsage?: { input: number; output: number };
  durationMs: number;
  stepCount: number;
  model?: string;
  provider?: string;
}

/** Truncate a value to a short preview string for logging */
function preview(value: unknown, maxLen = 300): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

/** Safely truncate args for logging — returns an object, never a broken JSON string */
function safePreviewArgs(args: Record<string, unknown>, maxLen: number): Record<string, unknown> {
  const json = JSON.stringify(args);
  if (json.length <= maxLen) return args;
  // Too large to store fully — store a truncated string representation instead
  return { _truncated: json.slice(0, maxLen) + "..." };
}

export function createRequestLogger(userId: string, sessionId: string) {
  const requestId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const startTime = Date.now();
  const toolCalls: ChatLogEntry["toolCalls"] = [];
  const dashboardConfigIds: string[] = [];
  const errors: string[] = [];
  let userMessage = "";
  let aiResponse = "";
  let stepCount = 0;
  let model: string | undefined;
  let provider: string | undefined;

  return {
    requestId,

    setUserMessage(msg: string) {
      userMessage = msg;
    },

    setModelInfo(m: string, p: string) {
      model = m;
      provider = p;
    },

    recordToolCall(
      name: string,
      args: Record<string, unknown>,
      result: unknown,
      step: number,
    ) {
      toolCalls.push({
        name,
        args: safePreviewArgs(args, 500),
        resultPreview: preview(result),
        stepNumber: step,
      });
      stepCount = Math.max(stepCount, step + 1);

      if (name === "update_dashboard") {
        const r = result as { dashboard?: { id?: string } } | null;
        if (r?.dashboard?.id) {
          dashboardConfigIds.push(r.dashboard.id);
        }
      }
    },

    recordError(error: string) {
      errors.push(error);
    },

    setAiResponse(text: string) {
      aiResponse = text;
    },

    async flush(
      tokenUsage?: { input: number; output: number },
    ): Promise<void> {
      try {
        await db.insert(usageLogs).values({
          user_id: userId,
          session_id: sessionId === "anonymous" ? null : sessionId,
          request_id: requestId,
          user_message: preview(userMessage, 500),
          ai_response: preview(aiResponse, 1000),
          tool_calls: toolCalls,
          dashboard_config_ids: dashboardConfigIds,
          errors: errors,
          input_tokens: tokenUsage?.input ?? null,
          output_tokens: tokenUsage?.output ?? null,
          duration_ms: Date.now() - startTime,
          step_count: stepCount,
          model: model ?? null,
          provider: provider ?? null,
        });
      } catch (err) {
        // Never let logging failures affect the request
        console.warn("[logger] Failed to insert usage log:", err);
      }
    },
  };
}
