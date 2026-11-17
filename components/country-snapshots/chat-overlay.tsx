"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SnapshotContext } from "@/lib/country-snapshots/system-prompt";
import { ChatMarkdown } from "./chat-markdown";
import { CHAT_UI_THROTTLE_MS } from "@/lib/chat-ui";

export function ChatOverlay({
  snapshotContext,
}: {
  snapshotContext: SnapshotContext;
}) {
  const [open, setOpen] = useState(false);
  const [capReached, setCapReached] = useState<{
    used: number;
    cap: number;
  } | null>(null);

  // Reference to the latest context so the prepareSendMessagesRequest closure
  // sees current data after navigation between snapshot pages.
  const ctxRef = useRef(snapshotContext);
  ctxRef.current = snapshotContext;

  // One conversation id for the lifetime of this overlay mount; the server
  // upserts the whole exchange into a single dashboardSessions row.
  const sessionIdRef = useRef<string>(
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : "",
  );

  // Pre-warm the prompt cache for page-mode chats on mount. Fire-and-forget;
  // the server debounces, and a failed warm only means the first turn pays
  // the cache write as before.
  useEffect(() => {
    void fetch("/api/countrysnapshots/warm", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "page" }),
    }).catch(() => {});
  }, []);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/countrysnapshots/chat",
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...(body as Record<string, unknown>),
            messages,
            snapshotContext: ctxRef.current,
            ...(sessionIdRef.current
              ? { sessionId: sessionIdRef.current }
              : {}),
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error } = useChat({
    transport,
    experimental_throttle: CHAT_UI_THROTTLE_MS,
    onError: (err) => {
      // Try to read the cap-reached payload from the server's 429 response.
      // The AI SDK rethrows a generic Error in this case; we surface a friendly UI.
      const msg = String(err?.message ?? "");
      if (msg.toLowerCase().includes("cap-reached")) {
        setCapReached({ used: 0, cap: 0 });
      }
    },
  });

  const ctxKey = `${snapshotContext.countryCodes.join("+")}/${snapshotContext.themeSlug}`;
  // Both "Explore in Surfer" buttons submit the one fork form below (a <form>
  // cannot nest inside the cap-reached <p>). Forking creates a session, so it
  // is a POST; the browser follows the 303 into the builder like a link.
  const forkFormId = useId();
  const forkReturnToRef = useRef<HTMLInputElement>(null);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 z-40 rounded-full bg-primary px-4 py-2 text-sm text-white shadow-lg hover:bg-primary-dark"
      >
        {open ? "Close chat" : "Ask the assistant"}
      </button>

      {open ? (
        <aside className="fixed bottom-20 right-6 z-40 flex h-[60vh] w-[min(420px,calc(100vw-3rem))] flex-col rounded-md bg-white shadow-2xl">
          <header className="flex items-center justify-between border-b border-neutral-200 px-3 py-2 text-xs">
            <span className="font-medium">Assistant — read-only</span>
            <span className="text-neutral-400">{ctxKey}</span>
          </header>

          <div className="flex-1 overflow-y-auto p-3 text-sm">
            {messages.length === 0 ? (
              <p className="text-xs italic text-neutral-500">
                Ask about anything visible on this page. The assistant cannot
                modify the snapshot; use &ldquo;Explore in Surfer&rdquo; below to
                customise it.
              </p>
            ) : null}
            {messages.map((m) => {
              const text =
                m.parts
                  ?.filter((p) => p.type === "text")
                  .map((p) => (p as { text?: string }).text ?? "")
                  .join("") ?? "";
              return (
                <div key={m.id} className="mb-3">
                  <div className="text-xs font-medium text-neutral-500">
                    {m.role === "user" ? "You" : "Assistant"}
                  </div>
                  {m.role === "assistant" ? (
                    <ChatMarkdown text={text} />
                  ) : (
                    <div className="whitespace-pre-wrap text-sm">{text}</div>
                  )}
                </div>
              );
            })}
            {status === "streaming" || status === "submitted" ? (
              <p className="text-xs italic text-neutral-500">thinking…</p>
            ) : null}
            {capReached ? (
              <p className="rounded-md bg-amber-50 p-2 text-xs text-amber-800">
                Daily chat limit reached.{" "}
                <button
                  type="submit"
                  form={forkFormId}
                  className="cursor-pointer underline"
                >
                  Explore in Surfer
                </button>{" "}
                to continue.
              </p>
            ) : null}
            {error && !capReached ? (
              <p className="rounded-md bg-red-50 p-2 text-xs text-red-800">
                Couldn&apos;t reach the assistant. Try again in a moment.
              </p>
            ) : null}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              const form = e.currentTarget;
              const fd = new FormData(form);
              const text = String(fd.get("q") ?? "").trim();
              if (!text) return;
              setCapReached(null);
              void sendMessage({ text });
              form.reset();
            }}
            className="border-t border-neutral-200 p-2"
          >
            <input
              name="q"
              placeholder="Ask about this snapshot…"
              className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-sm"
              autoComplete="off"
            />
          </form>

          <form
            id={forkFormId}
            method="post"
            action="/api/countrysnapshots/fork"
            onSubmit={() => {
              // Signed-out visitors are sent to /login and back to this page;
              // the POST itself cannot be replayed after sign-in.
              if (forkReturnToRef.current) {
                forkReturnToRef.current.value =
                  window.location.pathname + window.location.search;
              }
            }}
            className="border-t border-neutral-200 px-3 py-2 text-xs"
          >
            <input
              type="hidden"
              name="country"
              value={snapshotContext.countryCodes.join(",")}
            />
            <input
              type="hidden"
              name="theme"
              value={snapshotContext.themeSlug}
            />
            <input type="hidden" name="returnTo" ref={forkReturnToRef} />
            <button
              type="submit"
              className="cursor-pointer text-on-secondary-container underline"
            >
              Explore in Surfer
            </button>
          </form>
        </aside>
      ) : null}
    </>
  );
}
