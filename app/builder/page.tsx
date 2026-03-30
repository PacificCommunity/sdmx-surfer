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

interface ModelOption {
  provider: string;
  model: string;
  label: string;
}

const FREE_TIER: ModelOption = {
  provider: "anthropic",
  model: "claude-sonnet-4-6",
  label: "Sonnet 4.6 (free)",
};

export default function BuilderPage() {
  const [sessionId, setSessionId] = useState<string>("");
  const [sessionLoaded, setSessionLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved">("idle");
  const [sessionMenu, setSessionMenu] = useState(false);
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([FREE_TIER]);
  const [selectedModel, setSelectedModel] = useState<ModelOption>(FREE_TIER);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPreviewErrorRef = useRef<string | null>(null);
  const outgoingPreviewErrorRef = useRef<string | null>(null);
  const lastForwardedPreviewErrorRef = useRef<string | null>(null);
  const configJsonRef = useRef("");

  const configHistory = useConfigHistory();

  // Dataflow context — injected into system prompt on first message, then cleared
  const dataflowContextRef = useRef<string | null>(null);

  // Stable transport — reads session ID + model from refs so it never recreates
  const sessionIdRef = useRef(sessionId);
  sessionIdRef.current = sessionId;
  const selectedModelRef = useRef(selectedModel);
  selectedModelRef.current = selectedModel;
  const transportRef = useRef(
    new DefaultChatTransport({
      api: "/api/chat",
      prepareSendMessagesRequest: ({ body, headers, messages, id, trigger, messageId }) => {
        // Consume dataflow context on first send, then clear it
        const ctx = dataflowContextRef.current;
        if (ctx) dataflowContextRef.current = null;

        return {
          body: {
            ...(body ?? {}),
            id,
            messages,
            trigger,
            messageId,
            previewError: outgoingPreviewErrorRef.current ?? undefined,
            dataflowContext: ctx ?? undefined,
            modelOverride: {
              provider: selectedModelRef.current.provider,
              model: selectedModelRef.current.model,
            },
          },
          headers: {
            ...(typeof headers === "object" && headers !== null && !Array.isArray(headers) ? headers : {}),
            "x-session-id": sessionIdRef.current || "anonymous",
          },
        };
      },
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

  // ── Load available models on mount ──
  useEffect(() => {
    fetch("/api/settings/keys")
      .then((r) => r.json())
      .then((data) => {
        const models: ModelOption[] = [FREE_TIER];
        const PROVIDER_MODELS: Record<string, Array<{ id: string; label: string }>> = {
          anthropic: [
            { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
            { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
            { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
          ],
          openai: [
            { id: "gpt-4.1-nano", label: "GPT-4.1 Nano" },
            { id: "gpt-4.1-mini", label: "GPT-4.1 Mini" },
            { id: "gpt-5.4", label: "GPT-5.4" },
          ],
          google: [
            { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash" },
            { id: "gemini-3-flash-preview", label: "Gemini 3 Flash" },
            { id: "gemini-3.1-pro-preview", label: "Gemini 3.1 Pro" },
          ],
        };
        // For each provider the user has a key for, add all models
        const providers = new Set<string>(
          (data.keys || []).map((k: { provider: string }) => k.provider),
        );
        for (const provider of providers) {
          const providerModels = PROVIDER_MODELS[provider];
          if (!providerModels) continue;
          for (const m of providerModels) {
            models.push({
              provider,
              model: m.id,
              label: m.label,
            });
          }
        }
        setAvailableModels(models);
      })
      .catch(() => {});
  }, []);

  // ── Session restore on mount (handles ?session= and ?prompt= query params) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const targetSession = params.get("session");
    const initialPrompt = params.get("prompt");
    const forceNew = params.get("new") === "1";
    const dfContext = params.get("dfContext");

    // Clean URL without reloading
    if (targetSession || initialPrompt || forceNew || dfContext) {
      window.history.replaceState({}, "", "/builder");
    }

    if (forceNew) {
      // Force a fresh session (from "Start New Dashboard" or topic cards)
      setSessionId(generateSessionId());
      setMessages([]);
      configHistory.restore([], -1);
      configJsonRef.current = "";
      setSessionLoaded(true);

      // Set dataflow context before sending — it'll be consumed on first send
      if (dfContext) {
        dataflowContextRef.current = dfContext;
      }

      if (initialPrompt) {
        setTimeout(() => {
          sendMessageRef.current({ text: initialPrompt });
        }, 500);
      }
      return;
    }

    if (targetSession) {
      // Load a specific session (from "Open" button on welcome page)
      void (async () => {
        const saved = await loadSession(targetSession);
        if (saved) {
          setSessionId(saved.sessionId);
          setMessages(saved.messages);
          if (saved.configHistory.length > 0) {
            configHistoryRef.current.restore(saved.configHistory, saved.configPointer);
          }
        }
        setSessionLoaded(true);
      })();
      return;
    }

    // Default: resume last session or start fresh
    void (async () => {
      const saved = await loadSession();
      if (saved) {
        setSessionId(saved.sessionId);
        setMessages(saved.messages);
        if (saved.configHistory.length > 0) {
          configHistoryRef.current.restore(saved.configHistory, saved.configPointer);
        }
      } else {
        setSessionId(generateSessionId());
      }
      setSessionLoaded(true);
    })();
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
    void saveSession(data).then(() => {
      setSaveState("saved");
      setTimeout(() => setSaveState("idle"), 2000);
    });
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
    void (async () => {
      const saved = await loadSession(targetId);
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
    })();
  }, [clearScheduledSave, doSave]);

  // ── Delete a session ──
  const handleDeleteSession = useCallback((targetId: string) => {
    clearScheduledSave();
    void (async () => {
      await deleteSession(targetId);
      setSessions(await listSessions());
      // If deleting the current session, start fresh
      if (targetId === sessionIdRef.current) {
        setSessionId(generateSessionId());
        setMessagesRef.current([]);
        configHistoryRef.current.restore([], -1);
        configJsonRef.current = "";
      }
    })();
  }, [clearScheduledSave]);

  // ── Error forwarding ──
  const errorCountRef = useRef(0);
  const MAX_AUTO_ERRORS = 2;

  const forwardPreviewError = useCallback(
    async (error: string) => {
      if (lastForwardedPreviewErrorRef.current === error) {
        pendingPreviewErrorRef.current = null;
        return;
      }

      // Limit auto-error forwarding to prevent loops
      errorCountRef.current += 1;
      if (errorCountRef.current > MAX_AUTO_ERRORS) {
        pendingPreviewErrorRef.current = null;
        return;
      }

      lastForwardedPreviewErrorRef.current = error;
      pendingPreviewErrorRef.current = null;

      try {
        await sendMessageRef.current({
          text:
            "[SYSTEM: The dashboard preview encountered an error: " +
            error +
            ". Please fix the broken component(s) and call update_dashboard again. " +
            "Every data URL MUST come from build_data_url.]",
        });
      } catch {
        lastForwardedPreviewErrorRef.current = null;
        pendingPreviewErrorRef.current = error;
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
    errorCountRef.current = 0; // Reset error counter on new config
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
            {/* Model picker */}
            <select
              value={selectedModel.provider + ":" + selectedModel.model}
              onChange={(e) => {
                const [provider, model] = e.target.value.split(":");
                const found = availableModels.find(
                  (m) => m.provider === provider && m.model === model,
                );
                if (!found) return;

                // If there's an active conversation, switching models starts a new session
                const hasUserMessages = messagesRef.current.some(
                  (m: { role: string }) => m.role === "user",
                );
                if (hasUserMessages) {
                  const ok = window.confirm(
                    "Switching models will start a new session.\n\n" +
                    "Your current session will be saved. Continue?",
                  );
                  if (!ok) {
                    e.target.value = selectedModel.provider + ":" + selectedModel.model;
                    return;
                  }
                  clearScheduledSave();
                  doSave();
                  setSessionId(generateSessionId());
                  setMessagesRef.current([]);
                  configHistoryRef.current.restore([], -1);
                  configJsonRef.current = "";
                  setSaveState("idle");
                }

                setSelectedModel(found);
              }}
              className="ghost-border rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-on-surface-variant"
              title="Active model"
            >
              {availableModels.map((m) => (
                <option key={m.provider + ":" + m.model} value={m.provider + ":" + m.model}>
                  {m.label}
                </option>
              ))}
            </select>

            {/* Save indicator — filled when saved, outline when unsaved, pulsing when saving */}
            <button
              type="button"
              onClick={doSave}
              title={saveState === "saved" ? "Session saved" : saveState === "saving" ? "Saving..." : "Save session"}
              className={"ghost-border rounded-full bg-surface-card p-1.5 transition-all hover:scale-105 active:scale-95 " +
                (saveState === "saved"
                  ? "text-primary"
                  : saveState === "saving"
                    ? "animate-pulse text-on-surface-variant"
                    : "text-on-surface-variant hover:text-primary")}
            >
              <svg className="h-4 w-4" viewBox="0 0 24 24" strokeWidth={1.5}
                fill={saveState === "saved" ? "currentColor" : "none"}
                stroke={saveState === "saved" ? "none" : "currentColor"}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M17.593 3.322c1.1.128 1.907 1.077 1.907 2.185V21L12 17.25 4.5 21V5.507c0-1.108.806-2.057 1.907-2.185a48.507 48.507 0 0111.186 0z" />
              </svg>
            </button>

            {/* Settings link */}
            <Link
              href="/settings"
              className="ghost-border rounded-full bg-surface-card p-1.5 text-on-surface-variant transition-transform hover:scale-105 hover:text-primary active:scale-95"
              title="Settings"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </Link>

            {/* Admin link */}
            <Link
              href="/admin"
              className="ghost-border rounded-full bg-surface-card p-1.5 text-on-surface-variant transition-transform hover:scale-105 hover:text-primary active:scale-95"
              title="Admin"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
              </svg>
            </Link>

            {/* Session picker */}
            <div className="relative">
              <button
                type="button"
                onClick={() => {
                  void listSessions().then((s) => setSessions(s));
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
