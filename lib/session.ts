import type { UIMessage } from "ai";
import type { SDMXDashboardConfig } from "./types";

const STORAGE_PREFIX = "spc-dashboard-";
const CURRENT_KEY = STORAGE_PREFIX + "current";
const MAX_SESSIONS = 20;

export interface SessionData {
  sessionId: string;
  messages: UIMessage[];
  configHistory: SDMXDashboardConfig[];
  configPointer: number;
  title: string;
  updatedAt: string;
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

function sessionKey(id: string): string {
  return STORAGE_PREFIX + "session-" + id;
}

export function saveSession(data: SessionData): void {
  try {
    const json = JSON.stringify(data);
    // Guard against localStorage quota (~5MB)
    if (json.length > 4_000_000) {
      // Trim tool outputs from older messages to fit
      const trimmed = {
        ...data,
        messages: data.messages.map((m, i) =>
          i < data.messages.length - 4 ? trimMessage(m) : m,
        ),
      };
      localStorage.setItem(sessionKey(data.sessionId), JSON.stringify(trimmed));
    } else {
      localStorage.setItem(sessionKey(data.sessionId), json);
    }
    localStorage.setItem(CURRENT_KEY, data.sessionId);
    pruneOldSessions();
  } catch {
    // localStorage full or unavailable — silently fail
  }
}

export function loadSession(sessionId?: string): SessionData | null {
  try {
    const id = sessionId || localStorage.getItem(CURRENT_KEY);
    if (!id) return null;
    const raw = localStorage.getItem(sessionKey(id));
    if (!raw) return null;
    return JSON.parse(raw) as SessionData;
  } catch {
    return null;
  }
}

export function getCurrentSessionId(): string | null {
  try {
    return localStorage.getItem(CURRENT_KEY);
  } catch {
    return null;
  }
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAt: string;
}

export function listSessions(): SessionSummary[] {
  const sessions: SessionSummary[] = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || !key.startsWith(STORAGE_PREFIX + "session-")) continue;
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const data = JSON.parse(raw) as SessionData;
      sessions.push({
        sessionId: data.sessionId,
        title: data.title || "Untitled",
        updatedAt: data.updatedAt,
      });
    }
  } catch {
    // ignore
  }
  return sessions.sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function deleteSession(sessionId: string): void {
  try {
    localStorage.removeItem(sessionKey(sessionId));
    const current = localStorage.getItem(CURRENT_KEY);
    if (current === sessionId) {
      localStorage.removeItem(CURRENT_KEY);
    }
  } catch {
    // ignore
  }
}

function pruneOldSessions(): void {
  const sessions = listSessions();
  if (sessions.length <= MAX_SESSIONS) return;
  const toDelete = sessions.slice(MAX_SESSIONS);
  for (const s of toDelete) {
    deleteSession(s.sessionId);
  }
}

/** Strip large tool outputs from a message to save storage space */
function trimMessage(message: UIMessage): UIMessage {
  return {
    ...message,
    parts: message.parts.map((part) => {
      const p = part as Record<string, unknown>;
      if (
        (typeof p.type === "string" && p.type.startsWith("tool-")) ||
        p.type === "dynamic-tool"
      ) {
        const output = p.output;
        if (typeof output === "object" && output !== null) {
          const out = output as Record<string, unknown>;
          // Keep dashboard configs, trim everything else
          if (out.dashboard) return part;
          return { ...p, output: { trimmed: true } } as unknown as typeof part;
        }
      }
      return part;
    }),
  };
}
