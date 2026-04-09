import type { UIMessage } from "ai";
import type { SDMXDashboardConfig } from "./types";

export interface SessionData {
  sessionId: string;
  messages: UIMessage[];
  configHistory: SDMXDashboardConfig[];
  configPointer: number;
  title: string;
  updatedAt: string;
  publishedAt: string | null;
  publicTitle: string | null;
  publicDescription: string | null;
  authorDisplayName: string | null;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAt: string;
}

export interface PublishInput {
  authorDisplayName: string;
  publicTitle: string;
  publicDescription?: string;
}

export interface PublishResult {
  publishedAt: string | null;
  publicTitle: string | null;
  publicDescription: string | null;
  authorDisplayName: string | null;
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

export async function saveSession(data: SessionData): Promise<boolean> {
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
        return true;
      }
      // Already exists (409 or similar) — fall through to PUT
    }

    knownSessions.add(data.sessionId);
    const putRes = await fetch("/api/sessions/" + data.sessionId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    return putRes.ok;
  } catch {
    // Network or server error — silently fail (same behaviour as localStorage version)
    return false;
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

export async function deleteSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/sessions/" + sessionId, { method: "DELETE" });
    knownSessions.delete(sessionId);
    if (!res.ok) {
      console.error("[session] Delete failed:", res.status, sessionId);
      return false;
    }
    return true;
  } catch (err) {
    console.error("[session] Delete error:", err);
    return false;
  }
}

// ---------------------------------------------------------------------------
// publishSession / unpublishSession
// ---------------------------------------------------------------------------

export async function publishSession(
  sessionId: string,
  input: PublishInput,
): Promise<PublishResult | null> {
  try {
    const res = await fetch("/api/sessions/" + sessionId + "/publish", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
    if (!res.ok) return null;
    const data = await res.json() as Partial<PublishResult>;
    return {
      publishedAt: data.publishedAt ?? null,
      publicTitle: data.publicTitle ?? null,
      publicDescription: data.publicDescription ?? null,
      authorDisplayName: data.authorDisplayName ?? null,
    };
  } catch {
    return null;
  }
}

export async function unpublishSession(sessionId: string): Promise<boolean> {
  try {
    const res = await fetch("/api/sessions/" + sessionId + "/publish", {
      method: "DELETE",
    });
    return res.ok;
  } catch {
    return false;
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
    publishedAt:
      row.published_at instanceof Date
        ? row.published_at.toISOString()
        : typeof row.published_at === "string"
          ? row.published_at
          : null,
    publicTitle:
      typeof row.public_title === "string" ? row.public_title : null,
    publicDescription:
      typeof row.public_description === "string" ? row.public_description : null,
    authorDisplayName:
      typeof row.author_display_name === "string" ? row.author_display_name : null,
  };
}
