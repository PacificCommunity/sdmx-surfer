import type { UIMessage } from "ai";
import type { SDMXDashboardConfig } from "./types";

export interface SessionData {
  sessionId: string;
  messages: UIMessage[];
  configHistory: SDMXDashboardConfig[];
  configPointer: number;
  title: string;
  updatedAt: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAt: string;
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

// ---------------------------------------------------------------------------
// saveSession — PUT to existing session, fall back to POST if 404
// ---------------------------------------------------------------------------

const knownSessions = new Set<string>();

export async function saveSession(data: SessionData): Promise<void> {
  try {
    const payload = {
      title: data.title,
      messages: data.messages,
      configHistory: data.configHistory,
      configPointer: data.configPointer,
    };

    if (!knownSessions.has(data.sessionId)) {
      // Try creating first — avoids a noisy 404 on PUT for new sessions
      const postRes = await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: data.sessionId, ...payload }),
      });

      if (postRes.ok || postRes.status === 201) {
        knownSessions.add(data.sessionId);
        return;
      }
      // Already exists (409 or similar) — fall through to PUT
    }

    knownSessions.add(data.sessionId);
    await fetch("/api/sessions/" + data.sessionId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch {
    // Network or server error — silently fail (same behaviour as localStorage version)
  }
}

// ---------------------------------------------------------------------------
// loadSession — GET by id, or GET list and return the most recent
// ---------------------------------------------------------------------------

export async function loadSession(sessionId?: string): Promise<SessionData | null> {
  try {
    if (sessionId) {
      const res = await fetch("/api/sessions/" + sessionId);
      if (!res.ok) return null;
      const row = await res.json();
      knownSessions.add(sessionId);
      return rowToSessionData(row);
    }

    // No id provided — return the most recent session
    const res = await fetch("/api/sessions");
    if (!res.ok) return null;
    const { sessions } = await res.json() as { sessions: { id: string }[] };
    if (!sessions || sessions.length === 0) return null;

    const firstId = sessions[0].id;
    const rowRes = await fetch("/api/sessions/" + firstId);
    if (!rowRes.ok) return null;
    const row = await rowRes.json();
    return rowToSessionData(row);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// listSessions — GET /api/sessions
// ---------------------------------------------------------------------------

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const res = await fetch("/api/sessions");
    if (!res.ok) return [];
    const { sessions } = await res.json() as {
      sessions: Array<{ id: string; title: string; updatedAt: string | null }>;
    };
    if (!sessions) return [];
    return sessions.map((s) => ({
      sessionId: s.id,
      title: s.title ?? "Untitled",
      updatedAt: s.updatedAt ?? new Date().toISOString(),
    }));
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// deleteSession — DELETE /api/sessions/[id]
// ---------------------------------------------------------------------------

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetch("/api/sessions/" + sessionId, { method: "DELETE" });
  } catch {
    // Silently fail
  }
}

// ---------------------------------------------------------------------------
// Internal helper — map DB row shape to SessionData
// ---------------------------------------------------------------------------

function rowToSessionData(row: Record<string, unknown>): SessionData {
  return {
    sessionId: row.id as string,
    messages: (row.messages as UIMessage[]) ?? [],
    configHistory: (row.config_history as SDMXDashboardConfig[]) ?? [],
    configPointer: typeof row.config_pointer === "number" ? row.config_pointer : -1,
    title: typeof row.title === "string" ? row.title : "Untitled",
    updatedAt:
      row.updated_at instanceof Date
        ? row.updated_at.toISOString()
        : typeof row.updated_at === "string"
          ? row.updated_at
          : new Date().toISOString(),
  };
}
