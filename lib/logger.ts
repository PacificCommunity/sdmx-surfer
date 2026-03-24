import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";

export interface ChatLogEntry {
  timestamp: string;
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
}

const LOG_DIR = join(process.cwd(), "logs");

let dirEnsured = false;

async function ensureDir(): Promise<void> {
  if (dirEnsured) return;
  try {
    await mkdir(LOG_DIR, { recursive: true });
    dirEnsured = true;
  } catch {
    // ignore — directory might already exist
  }
}

function getLogFile(): string {
  const date = new Date().toISOString().slice(0, 10);
  return join(LOG_DIR, "chat-" + date + ".jsonl");
}

/** Truncate a value to a short preview string for logging */
function preview(value: unknown, maxLen = 300): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

export async function logChatEntry(entry: ChatLogEntry): Promise<void> {
  try {
    await ensureDir();
    const line = JSON.stringify(entry) + "\n";
    await appendFile(getLogFile(), line, "utf-8");
  } catch (err) {
    // Never let logging failures affect the request
    console.warn("[logger] Failed to write log entry:", err);
  }
}

export function createRequestLogger(sessionId: string) {
  const requestId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const startTime = Date.now();
  const toolCalls: ChatLogEntry["toolCalls"] = [];
  const dashboardConfigIds: string[] = [];
  const errors: string[] = [];
  let userMessage = "";
  let aiResponse = "";
  let stepCount = 0;

  return {
    requestId,

    setUserMessage(msg: string) {
      userMessage = msg;
    },

    recordToolCall(
      name: string,
      args: Record<string, unknown>,
      result: unknown,
      step: number,
    ) {
      toolCalls.push({
        name,
        args: JSON.parse(preview(args, 500)),
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
      await logChatEntry({
        timestamp: new Date().toISOString(),
        sessionId,
        requestId,
        userMessage: preview(userMessage, 500),
        aiResponse: preview(aiResponse, 1000),
        toolCalls,
        dashboardConfigIds,
        errors,
        tokenUsage,
        durationMs: Date.now() - startTime,
        stepCount,
      });
    },
  };
}
