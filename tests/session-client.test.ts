import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock fetch globally
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  type SessionData,
} from "@/lib/session";

beforeEach(() => {
  mockFetch.mockReset();
});

describe("session client", () => {
  describe("generateSessionId", () => {
    it("returns a 16-char hex string", () => {
      const id = generateSessionId();
      expect(id).toMatch(/^[0-9a-f]{16}$/);
    });

    it("returns unique IDs", () => {
      const ids = new Set(Array.from({ length: 100 }, () => generateSessionId()));
      expect(ids.size).toBe(100);
    });
  });

  describe("saveSession", () => {
    const testSession: SessionData = {
      sessionId: "abc123",
      messages: [],
      configHistory: [],
      configPointer: -1,
      title: "Test",
      updatedAt: new Date().toISOString(),
    };

    it("tries POST first for unknown sessions", async () => {
      mockFetch.mockResolvedValue({ status: 201, ok: true });

      await saveSession(testSession);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe("/api/sessions");
      expect(opts.method).toBe("POST");
    });

    it("uses PUT for subsequent saves of the same session", async () => {
      // First save — POST creates the session
      mockFetch.mockResolvedValueOnce({ status: 201, ok: true });
      await saveSession(testSession);

      // Second save — PUT updates it
      mockFetch.mockResolvedValueOnce({ status: 200, ok: true });
      await saveSession(testSession);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[1][0]).toBe("/api/sessions/abc123");
      expect(mockFetch.mock.calls[1][1].method).toBe("PUT");
    });

    it("falls back to PUT when POST returns conflict", async () => {
      // Reset known sessions by using a new session ID
      const conflictSession = { ...testSession, sessionId: "conflict123" };
      mockFetch
        .mockResolvedValueOnce({ status: 409, ok: false }) // POST conflict
        .mockResolvedValueOnce({ status: 200, ok: true }); // PUT success

      await saveSession(conflictSession);

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][1].method).toBe("POST");
      expect(mockFetch.mock.calls[1][0]).toBe("/api/sessions/conflict123");
      expect(mockFetch.mock.calls[1][1].method).toBe("PUT");
    });

    it("silently fails on network error", async () => {
      mockFetch.mockRejectedValue(new Error("Network error"));

      // Should not throw
      await expect(saveSession(testSession)).resolves.toBeUndefined();
    });
  });

  describe("loadSession", () => {
    it("loads a specific session by ID", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            id: "sess-1",
            title: "My Dashboard",
            messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
            config_history: [],
            config_pointer: -1,
            updated_at: "2026-03-25T10:00:00Z",
          }),
      });

      const result = await loadSession("sess-1");

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("sess-1");
      expect(result!.title).toBe("My Dashboard");
      expect(result!.messages).toHaveLength(1);
    });

    it("loads most recent session when no ID given", async () => {
      // First call: list sessions
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              sessions: [{ id: "latest-sess", title: "Latest", updatedAt: "2026-03-25" }],
            }),
        })
        // Second call: load that session
        .mockResolvedValueOnce({
          ok: true,
          json: () =>
            Promise.resolve({
              id: "latest-sess",
              title: "Latest",
              messages: [],
              config_history: [],
              config_pointer: -1,
              updated_at: "2026-03-25",
            }),
        });

      const result = await loadSession();

      expect(result).not.toBeNull();
      expect(result!.sessionId).toBe("latest-sess");
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("returns null on 404", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 404 });

      const result = await loadSession("nonexistent");
      expect(result).toBeNull();
    });

    it("returns null when session list is empty", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ sessions: [] }),
      });

      const result = await loadSession();
      expect(result).toBeNull();
    });

    it("returns null on network error", async () => {
      mockFetch.mockRejectedValue(new Error("offline"));

      const result = await loadSession("any");
      expect(result).toBeNull();
    });
  });

  describe("listSessions", () => {
    it("returns mapped session summaries", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            sessions: [
              { id: "s1", title: "Dashboard 1", updatedAt: "2026-03-25T10:00:00Z" },
              { id: "s2", title: "Dashboard 2", updatedAt: "2026-03-24T10:00:00Z" },
            ],
          }),
      });

      const sessions = await listSessions();

      expect(sessions).toHaveLength(2);
      expect(sessions[0].sessionId).toBe("s1");
      expect(sessions[0].title).toBe("Dashboard 1");
      expect(sessions[1].sessionId).toBe("s2");
    });

    it("returns empty array on error", async () => {
      mockFetch.mockRejectedValue(new Error("offline"));

      const sessions = await listSessions();
      expect(sessions).toEqual([]);
    });

    it("returns empty array on non-OK response", async () => {
      mockFetch.mockResolvedValue({ ok: false, status: 500 });

      const sessions = await listSessions();
      expect(sessions).toEqual([]);
    });
  });

  describe("deleteSession", () => {
    it("sends DELETE request", async () => {
      mockFetch.mockResolvedValue({ ok: true });

      await deleteSession("sess-to-delete");

      expect(mockFetch).toHaveBeenCalledWith("/api/sessions/sess-to-delete", {
        method: "DELETE",
      });
    });

    it("silently fails on error", async () => {
      mockFetch.mockRejectedValue(new Error("offline"));

      await expect(deleteSession("any")).resolves.toBeUndefined();
    });
  });
});
