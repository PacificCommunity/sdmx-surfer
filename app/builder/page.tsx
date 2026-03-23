"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useChat } from "@ai-sdk/react";
import type { UIMessage } from "ai";
import { DefaultChatTransport } from "ai";
import { ChatPanel } from "@/components/chat-panel";
import { DashboardPreview } from "@/components/dashboard-preview";
import type { SDMXDashboardConfig } from "@/lib/types";

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
          message:
            "Dashboard updated. The preview now shows: " +
            (typeof config.header?.title?.text === "string"
              ? config.header.title.text
              : config.id),
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
              (typeof config.header?.title?.text === "string"
                ? config.header.title.text
                : config.id),
          },
        },
      ],
    },
  ];
}

const transport = new DefaultChatTransport({ api: "/api/chat" });

export default function BuilderPage() {
  const [dashboardConfig, setDashboardConfig] =
    useState<SDMXDashboardConfig | null>(null);
  const configJsonRef = useRef("");
  const pendingPreviewErrorRef = useRef<string | null>(null);
  const lastForwardedPreviewErrorRef = useRef<string | null>(null);

  const { messages, status, sendMessage, setMessages } = useChat({ transport });

  // Only update dashboard config when it actually changes
  useEffect(() => {
    const extracted = extractDashboardConfig(messages);
    if (!extracted) return;
    const json = JSON.stringify(extracted);
    if (json !== configJsonRef.current) {
      configJsonRef.current = json;
      setDashboardConfig(extracted);
    }
  }, [messages]);

  // Manual config edits from the JSON tab
  const handleConfigEdit = useCallback(
    (edited: SDMXDashboardConfig) => {
      const json = JSON.stringify(edited);
      configJsonRef.current = json;
      setDashboardConfig(edited);
      setMessages((currentMessages) =>
        syncDashboardConfigIntoMessages(currentMessages, edited),
      );
    },
    [setMessages],
  );

  const forwardPreviewError = useCallback(
    (error: string) => {
      if (lastForwardedPreviewErrorRef.current === error) {
        pendingPreviewErrorRef.current = null;
        return;
      }

      lastForwardedPreviewErrorRef.current = error;
      pendingPreviewErrorRef.current = null;

      void sendMessage({
        text:
          "[SYSTEM: The dashboard preview encountered an error: " +
          error +
          ". Please fix the dashboard configuration and call update_dashboard again.]",
      });
    },
    [sendMessage],
  );

  // When the dashboard preview hits an error, tell the AI so it can fix it.
  const handlePreviewError = useCallback(
    (error: string) => {
      pendingPreviewErrorRef.current = error;

      if (status === "ready") {
        forwardPreviewError(error);
      }
    },
    [forwardPreviewError, status],
  );

  useEffect(() => {
    if (status === "ready" && pendingPreviewErrorRef.current) {
      forwardPreviewError(pendingPreviewErrorRef.current);
    }
  }, [forwardPreviewError, status]);

  useEffect(() => {
    lastForwardedPreviewErrorRef.current = null;
  }, [dashboardConfig]);

  return (
    <div className="flex h-screen flex-col bg-surface">
      {/* App bar — glass panel with ambient shadow, no borders */}
      <header className="glass-panel shadow-ambient z-10 shrink-0 px-6 py-3">
        <div className="flex items-center gap-3">
          <div className="ocean-gradient flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]">
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
          </div>
          <div>
            <h1 className="font-[family-name:var(--font-manrope)] text-base font-bold tracking-tight text-primary">
              SPC Dashboard Builder
            </h1>
            <p className="type-label-md text-on-tertiary-fixed-variant">
              Pacific Data Hub
            </p>
          </div>
        </div>
      </header>

      {/* Main content — no border between panels, use tonal shift */}
      <div className="flex flex-1 overflow-hidden">
        {/* Chat panel — sits on surface-low */}
        <aside className="w-[420px] shrink-0 bg-surface-low">
          <ChatPanel
            messages={messages}
            status={status}
            sendMessage={sendMessage}
          />
        </aside>

        {/* Dashboard preview — sits on surface (lighter) */}
        <main className="flex-1 bg-surface">
          <DashboardPreview
            config={dashboardConfig}
            onConfigEdit={handleConfigEdit}
            onError={handlePreviewError}
          />
        </main>
      </div>
    </div>
  );
}
