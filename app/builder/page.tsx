"use client";

import Link from "next/link";
import { useEffect, useState, useRef, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { ChatPanel } from "@/components/chat-panel";
import { DashboardPreview } from "@/components/dashboard-preview";
import type { SDMXDashboardConfig } from "@/lib/types";
import { useConfigHistory } from "@/lib/use-config-history";
import {
  generateSessionId,
  saveSession,
  loadSession,
  listSessions,
  deleteSession,
  type SessionData,
  type SessionSummary,
} from "@/lib/session";
import { getDashboardTitle } from "@/lib/dashboard-text";

function extractDashboardConfig(
  messages: { parts: Array<Record<string, unknown>> }[],
): SDMXDashboardConfig | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    for (let j = msg.parts.length - 1; j >= 0; j--) {
      const part = msg.parts[j] as Record<string, unknown>;
      const isUpdateDashboard =
        part.type === "tool-update_dashboard" ||
        (part.type === "dynamic-tool" &&
          (part as { toolName?: string }).toolName === "update_dashboard");

      if (!isUpdateDashboard) continue;

      const state = (part as { state?: string }).state;
      if (state !== "output-available") continue;

      const output = (part as { output?: Record<string, unknown> }).output;
      if (!output) continue;

      if (output.dashboard) {
        return output.dashboard as SDMXDashboardConfig;
      }
      if (output.rows) {
        return output as unknown as SDMXDashboardConfig;
      }
    }
  }
  return null;
}

function syncDashboardConfigIntoMessages(
  messages: UIMessage[],
  config: SDMXDashboardConfig,
): UIMessage[] {
  for (let messageIndex = messages.length - 1; messageIndex >= 0; messageIndex--) {
    const message = messages[messageIndex];

    if (message.role !== "assistant") {
      continue;
    }

    let partWasUpdated = false;
    const updatedParts = message.parts.map((part) => {
      const isUpdateDashboard =
        part.type === "tool-update_dashboard" ||
        (part.type === "dynamic-tool" && part.toolName === "update_dashboard");

      if (!isUpdateDashboard || part.state !== "output-available") {
        return part;
      }

      partWasUpdated = true;
      return {
        ...part,
        input: { config },
        output: {
          success: true,
          dashboard: config,
          message: "Dashboard updated. The preview now shows: " + getDashboardTitle(config),
        },
      };
    });

    if (partWasUpdated) {
      return messages.map((entry, index) =>
        index === messageIndex ? { ...entry, parts: updatedParts } : entry,
      );
    }
  }

  const manualMessageId = "manual-dashboard-" + String(Date.now());

  return [
    ...messages,
    {
      id: manualMessageId,
      role: "assistant",
      parts: [
        {
          type: "tool-update_dashboard",
          toolCallId: manualMessageId,
          state: "output-available",
          input: { config },
          output: {
            success: true,
            dashboard: config,
            message:
              "Dashboard updated. The preview now shows: " +
              getDashboardTitle(config),
          },
        },
      ],
    },
  ];
}

export default function BuilderPage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [sessionMenu, setSessionMenu] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewErrorRef = useRef<string | null>(null);
  const outgoingPreviewErrorRef = useRef<string | null>(null);
  const lastForwardedPreviewErrorRef = useRef<string | null>(null);
  const configJsonRef = useRef("");

  const configHistory = useConfigHistory();

  // Stable transport — reads session ID from ref so it never recreates
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ body, headers, messages, id, trigger, messageId }) => ({
        body: {
          ...(body ?? {}),
          id,
          messages,
          trigger,
          messageId,
          previewError: outgoingPreviewErrorRef.current ?? undefined,
        },
        headers: {
          ...(typeof headers === "object" && headers !== null && !Array.isArray(headers) ? headers : {}),
          "x-session-id": sessionIdRef.current || "anonymous",
        },
      }),
    }),
  );

  const { messages, status, sendMessage, setMessages, stop, regenerate } = useChat({
    transport: transportRef.current,
  });

  // ── Stable refs for callbacks (declared early so mount effect can use them) ──
  const configHistoryRef = useRef(configHistory);
  configHistoryRef.current = configHistory;
  const setMessagesRef = useRef(setMessages);
  setMessagesRef.current = setMessages;
  const messagesRef = useRef(messages);
  messagesRef.current = messages;
  const sendMessageRef = useRef(sendMessage);
  sendMessageRef.current = sendMessage;
  const regenerateRef = useRef(regenerate);
  regenerateRef.current = regenerate;
  const statusRef = useRef(status);
  statusRef.current = status;

  // ── Session restore on mount (handles ?session= and ?prompt= query params) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetSession = params.get("session");
    const initialPrompt = params.get("prompt");
    const forceNew = params.get("new") === "1";

    // Clean URL without reloading
    if (targetSession || initialPrompt || forceNew) {
      window.history.replaceState({}, "", "/builder");
    }

    if (forceNew) {
      // Force a fresh session (from "Start New Dashboard" or topic cards)
      setSessionId(generateSessionId());
      setMessages([]);
      configHistory.restore([], -1);
      configJsonRef.current = "";
      setSessionLoaded(true);

      if (initialPrompt) {
        setTimeout(() => {
          sendMessageRef.current({ text: initialPrompt });
        }, 500);
      }
      return;
    }

    if (targetSession) {
      // Load a specific session (from "Open" button on welcome page)
      const saved = loadSession(targetSession);
      if (saved) {
        setSessionId(saved.sessionId);
        setMessages(saved.messages);
        if (saved.configHistory.length > 0) {
          configHistory.restore(saved.configHistory, saved.configPointer);
        }
        setSessionLoaded(true);
        return;
      }
    }

    // Default: resume last session or start fresh
    const saved = loadSession();
    if (saved) {
      setSessionId(saved.sessionId);
      setMessages(saved.messages);
      if (saved.configHistory.length > 0) {
        configHistory.restore(saved.configHistory, saved.configPointer);
      }
    } else {
      setSessionId(generateSessionId());
    }
    setSessionLoaded(true);
  }, []);

  // ── Debounced session save ──
  const clearScheduledSave = useCallback(() => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
  }, []);

  const doSave = useCallback(() => {
    if (!sessionIdRef.current) return;
    setSaveState("saving");
    const { history, pointer } = configHistoryRef.current.snapshot();
    const currentConfig = configHistoryRef.current.current;
    const data: SessionData = {
      sessionId: sessionIdRef.current,
      messages: messagesRef.current,
      configHistory: history,
      configPointer: pointer,
      title: currentConfig ? getDashboardTitle(currentConfig) : "Untitled",
      updatedAt: new Date().toISOString(),
    };
    saveSession(data);
    setSaveState("saved");
    setTimeout(() => setSaveState("idle"), 2000);
  }, []);

  const debouncedSave = useCallback(() => {
    clearScheduledSave();
    saveTimerRef.current = setTimeout(doSave, 1500);
  }, [clearScheduledSave, doSave]);

  useEffect(() => clearScheduledSave, [clearScheduledSave]);

  useEffect(() => {
    if (sessionLoaded && sessionId) {
      debouncedSave();
    }
  }, [messages, configHistory.current, sessionLoaded, sessionId, debouncedSave]);

  // ── Extract config from messages → push to history ──
  useEffect(() => {
    const extracted = extractDashboardConfig(messages);
    if (!extracted) return;
    const json = JSON.stringify(extracted);
    if (json !== configJsonRef.current) {
      configJsonRef.current = json;
      configHistory.push(extracted);
    }
  }, [messages, configHistory]);

  const handleConfigEdit = useCallback(
    (edited: SDMXDashboardConfig) => {
      configJsonRef.current = JSON.stringify(edited);
      configHistoryRef.current.push(edited);
      setMessagesRef.current((currentMessages) =>
        syncDashboardConfigIntoMessages(currentMessages, edited),
      );
    },
    [],
  );

  const handleUndo = useCallback(() => {
    const config = configHistoryRef.current.undo();
    if (config) {
      configJsonRef.current = JSON.stringify(config);
      setMessagesRef.current((cur) => syncDashboardConfigIntoMessages(cur, config));
    }
  }, []);

  const handleRedo = useCallback(() => {
    const config = configHistoryRef.current.redo();
    if (config) {
      configJsonRef.current = JSON.stringify(config);
      setMessagesRef.current((cur) => syncDashboardConfigIntoMessages(cur, config));
    }
  }, []);

  // ── New session ──
  const handleNewSession = useCallback(() => {
    // Save current session first
    clearScheduledSave();
    doSave();
    setSessionId(generateSessionId());
    setMessagesRef.current([]);
    configHistoryRef.current.restore([], -1);
    configJsonRef.current = "";
    setSaveState("idle");
  }, [clearScheduledSave, doSave]);

  // ── Switch to an existing session ──
  const handleLoadSession = useCallback((targetId: string) => {
    clearScheduledSave();
    doSave(); // save current first
    const saved = loadSession(targetId);
    if (!saved) return;
    setSessionId(saved.sessionId);
    setMessagesRef.current(saved.messages);
    if (saved.configHistory.length > 0) {
      configHistoryRef.current.restore(saved.configHistory, saved.configPointer);
    } else {
      configHistoryRef.current.restore([], -1);
    }
    configJsonRef.current = "";
    setSessionMenu(false);
    setSaveState("idle");
  }, [clearScheduledSave, doSave]);

  // ── Delete a session ──
  const handleDeleteSession = useCallback((targetId: string) => {
    clearScheduledSave();
    deleteSession(targetId);
    setSessions(listSessions());
    // If deleting the current session, start fresh
    if (targetId === sessionIdRef.current) {
      setSessionId(generateSessionId());
      setMessagesRef.current([]);
      configHistoryRef.current.restore([], -1);
      configJsonRef.current = "";
    }
  }, [clearScheduledSave]);

  // ── Error forwarding ──
  const forwardPreviewError = useCallback(
    async (error: string) => {
      if (lastForwardedPreviewErrorRef.current === error) {
        pendingPreviewErrorRef.current = null;
        return;
      }

      lastForwardedPreviewErrorRef.current = error;
      pendingPreviewErrorRef.current = null;
      outgoingPreviewErrorRef.current = error;

      try {
        await regenerateRef.current();
      } catch {
        lastForwardedPreviewErrorRef.current = null;
        pendingPreviewErrorRef.current = error;
      } finally {
        outgoingPreviewErrorRef.current = null;
      }
    },
    [],
  );

  const handlePreviewError = useCallback(
    (error: string) => {
      pendingPreviewErrorRef.current = error;

      if (statusRef.current === "ready") {
        void forwardPreviewError(error);
      }
    },
    [forwardPreviewError],
  );

  useEffect(() => {
    if (status === "ready" && pendingPreviewErrorRef.current) {
      void forwardPreviewError(pendingPreviewErrorRef.current);
    }
  }, [forwardPreviewError, status]);

  // Keep statusRef in sync for the effect
  useEffect(() => {
    statusRef.current = status;
  }, [status]);

  useEffect(() => {
    lastForwardedPreviewErrorRef.current = null;
  }, [configHistory.current]);

  return (
    <div className="flex h-screen flex-col bg-surface">
      {/* App bar */}
      <header className="glass-panel shadow-ambient z-50 shrink-0 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="ocean-gradient flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] transition-transform hover:scale-105"
              title="Back to home"
            >
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
                />
              </svg>
            </Link>
            <div>
              <h1 className="font-[family-name:var(--font-manrope)] text-base font-bold tracking-tight text-primary">
                SPC Dashboard Builder
              </h1>
              <p className="type-label-md text-on-tertiary-fixed-variant">
                Pacific Data Hub
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            {/* Save indicator */}
            <span className="text-xs text-on-surface-variant">
              {saveState === "saving" && (
                <span className="flex items-center gap-1">
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
                  Saving...
                </span>
              )}
              {saveState === "saved" && (
                <span className="flex items-center gap-1 text-secondary">
                  <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                  </svg>
                  Saved
                </span>
              )}
            </span>

            {/* Save button */}
            <button
              type="button"
              onClick={doSave}
              title="Save session"
              className="ghost-border rounded-full bg-surface-card p-1.5 text-on-surface-variant transition-transform hover:scale-105 hover:text-primary active:scale-95"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            </button>

            {/* Session picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  setSessions(listSessions());
                  setSessionMenu((v) => !v);
                }}
                className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1.5 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
              >
                <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 12h16.5m-16.5 3.75h16.5M3.75 19.5h16.5M5.625 4.5h12.75a1.875 1.875 0 010 3.75H5.625a1.875 1.875 0 010-3.75z" />
                </svg>
                Sessions
              </button>

              {sessionMenu && (
                <>
                  <div
                    className="fixed inset-0 z-20"
                    onClick={() => setSessionMenu(false)}
                  />
                  <div className="absolute right-0 z-30 mt-1 w-72 rounded-[var(--radius-lg)] bg-surface-card p-2 shadow-ambient">
                    {/* New session */}
                    <button
                      type="button"
                      onClick={() => {
                        setSessionMenu(false);
                        handleNewSession();
                      }}
                      className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs font-medium text-primary transition-colors hover:bg-surface-low"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
                      </svg>
                      New Session
                    </button>

                    {sessions.length > 0 && (
                      <div className="my-1 h-px bg-surface-high" />
                    )}

                    {/* Session list */}
                    <div className="max-h-60 overflow-y-auto">
                      {sessions.map((s) => (
                        <div
                          key={s.sessionId}
                          className={
                            "group flex items-center justify-between rounded-[var(--radius-md)] px-3 py-2 transition-colors hover:bg-surface-low " +
                            (s.sessionId === sessionId ? "bg-surface-low" : "")
                          }
                        >
                          <button
                            type="button"
                            onClick={() => handleLoadSession(s.sessionId)}
                            className="flex-1 text-left"
                          >
                            <div className="text-xs font-medium text-on-surface">
                              {s.title}
                              {s.sessionId === sessionId && (
                                <span className="ml-1.5 text-[10px] text-secondary">current</span>
                              )}
                            </div>
                            <div className="text-[10px] text-on-surface-variant">
                              {new Date(s.updatedAt).toLocaleDateString("en-GB", {
                                day: "numeric",
                                month: "short",
                                hour: "2-digit",
                                minute: "2-digit",
                              })}
                            </div>
                          </button>
                          {s.sessionId !== sessionId && (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteSession(s.sessionId);
                              }}
                              className="ml-2 rounded-full p-1 text-on-surface-variant opacity-0 transition-opacity hover:text-red-500 group-hover:opacity-100"
                              title="Delete session"
                            >
                              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                              </svg>
                            </button>
                          )}
                        </div>
                      ))}
                    </div>

                    {sessions.length === 0 && (
                      <p className="px-3 py-2 text-xs text-on-surface-variant">
                        No saved sessions yet
                      </p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Main content */}
      <div className="flex flex-1 overflow-hidden">
        <aside className="w-[420px] shrink-0 bg-surface-low">
          <ChatPanel
            messages={messages}
            status={status}
            sendMessage={sendMessage}
            onStop={stop}
          />
        </aside>

        <main className="flex-1 bg-surface">
          <DashboardPreview
            config={configHistory.current}
            onConfigEdit={handleConfigEdit}
            onError={handlePreviewError}
            onUndo={handleUndo}
            onRedo={handleRedo}
            canUndo={configHistory.canUndo}
            canRedo={configHistory.canRedo}
            presentUrl={sessionId ? "/dashboard/" + sessionId : undefined}
          />
        </main>
      </div>
    </div>
  );
}
