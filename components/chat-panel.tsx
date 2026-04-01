"use client";

import { useRef, useEffect, useState } from "react";
import type { UIMessage, ChatStatus } from "ai";
import { MessageBubble } from "./message-bubble";

interface ChatPanelProps {
  messages: UIMessage[];
  status: ChatStatus;
  sendMessage: (message: { text: string }) => Promise<void>;
  onStop?: () => void;
  hasDashboard?: boolean;
}

const SUGGESTIONS = [
  "What dataflows are available about population?",
  "Show me trade data for Fiji as a bar chart",
  "Create a dashboard comparing GDP across Pacific Islands",
];

const REFINEMENT_SUGGESTIONS = [
  "Add a map showing this data by country",
  "Break it down by year as a line chart",
  "Add another indicator for comparison",
  "Change the colors and add a title",
];

export function ChatPanel({ messages, status, sendMessage, onStop, hasDashboard }: ChatPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [input, setInput] = useState("");
  const [submitError, setSubmitError] = useState<string | null>(null);
  const isStreaming = status === "streaming" || status === "submitted";

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);


  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = input.trim();
    if (!text || isStreaming) return;

    setInput("");
    setSubmitError(null);

    try {
      await sendMessage({ text });
    } catch (error) {
      setInput(text);
      setSubmitError(
        error instanceof Error ? error.message : "Failed to send message.",
      );
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Header — tonal shift instead of border */}
      <div className="shrink-0 bg-surface-low px-5 pb-3 pt-4">
        <h2 className="font-[family-name:var(--font-display)] text-lg font-bold tracking-tight text-primary">
          Dashboard Builder
        </h2>
        <p className="type-label-md mt-0.5 text-on-tertiary-fixed-variant">
          Describe the data you want to visualize
        </p>
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-surface px-4 py-5"
      >
        <div className="flex flex-col gap-4">
          {messages.length === 0 ? (
            <div className="submerged-overlay flex flex-col gap-3 rounded-[var(--radius-xl)] bg-surface-low px-5 py-8">
              <p className="text-center text-sm text-on-surface-variant">
                Ask me to build a dashboard using Pacific data
              </p>
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  className="ghost-border rounded-[var(--radius-xl)] bg-surface-card px-4 py-2.5 text-left text-sm text-on-surface-variant shadow-ambient transition-all hover:bg-surface-high hover:shadow-none"
                  onClick={() => setInput(s)}
                >
                  {s}
                </button>
              ))}
            </div>
          ) : (
            messages.map((m) => <MessageBubble key={m.id} message={m} />)
          )}

          {isStreaming &&
            messages.length > 0 &&
            messages[messages.length - 1].role === "user" && (
              <div className="flex justify-start">
                <div className="flex items-center gap-2 rounded-[var(--radius-xl)] rounded-tl-none bg-secondary-container px-4 py-3 shadow-ambient">
                  <div className="flex gap-1">
                    <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:0ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:150ms]" />
                    <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:300ms]" />
                  </div>
                </div>
              </div>
            )}

          {/* Refinement nudge — shown after a dashboard is rendered and the AI isn't streaming */}
          {hasDashboard && !isStreaming && messages.length > 0 &&
            messages[messages.length - 1].role === "assistant" && (
              <div className="flex flex-col gap-2 rounded-[var(--radius-xl)] bg-surface-low px-4 py-4">
                <p className="text-center text-xs font-medium text-on-surface-variant">
                  Keep going — refine your dashboard
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {REFINEMENT_SUGGESTIONS.map((s) => (
                    <button
                      key={s}
                      type="button"
                      className="ghost-border rounded-full bg-surface-card px-3 py-1.5 text-xs text-on-surface-variant transition-all hover:bg-surface-high hover:text-on-surface"
                      onClick={() => setInput(s)}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
        </div>
      </div>

      {/* Input area — blue when ready for input, dims to gray while LLM is working */}
      <form
        onSubmit={handleSubmit}
        className={
          "shrink-0 px-4 py-3 transition-colors duration-500 " +
          (isStreaming ? "bg-surface-low" : "bg-secondary-container/30")
        }
      >
        <textarea
          value={input}
          onChange={(e) => {
            setInput(e.target.value);
            if (submitError) {
              setSubmitError(null);
            }
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSubmit();
            }
          }}
          placeholder={hasDashboard ? "Ask me to change, add, or refine anything..." : "Describe the dashboard you want..."}
          rows={2}
          className={
            "focus-architectural ghost-border w-full resize-none rounded-[var(--radius-xl)] px-4 py-3 text-sm text-on-surface shadow-ambient transition-colors duration-500 placeholder:text-on-surface-variant/50 " +
            (isStreaming ? "bg-surface-high/50" : "bg-surface-card")
          }
          disabled={isStreaming}
        />
        {submitError && (
          <p className="mt-2 text-xs text-red-600">{submitError}</p>
        )}
        <div className="mt-2 flex items-center justify-end gap-2">
          {isStreaming && onStop ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-full bg-red-50 px-5 py-2 text-sm font-semibold text-red-600 transition-transform hover:scale-105 hover:bg-red-100 active:scale-95"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="brand-gradient rounded-full px-5 py-2 text-sm font-semibold text-on-primary shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            >
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
