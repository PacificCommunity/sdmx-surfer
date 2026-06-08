"use client";

import { useMemo, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";

// Curated examples. Kept regionally-neutral and varied across themes so the
// surface doesn't favour any one PICT or single MFAT priority.
const EXAMPLES = [
  "Show me Tonga education over the last decade",
  "Compare health indicators across Solomon Islands and Vanuatu",
  "What has been changing in Pacific tobacco use?",
  "Which countries have the most data on climate adaptation?",
  "Governance indicators in Melanesia",
  "Population trends across the smaller PICTs",
];

const INDEX_CONTEXT = {
  countryCodes: [] as string[],
  themeSlug: "index",
  indicatorIds: [] as string[],
};

export function ChatStarter() {
  const [capReached, setCapReached] = useState(false);

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/countrysnapshots/chat",
        prepareSendMessagesRequest: ({ body, messages }) => ({
          body: {
            ...(body as Record<string, unknown>),
            messages,
            snapshotContext: INDEX_CONTEXT,
          },
        }),
      }),
    [],
  );

  const { messages, sendMessage, status, error, setMessages } = useChat({
    transport,
    onError: (err) => {
      if (String(err?.message ?? "").toLowerCase().includes("cap-reached")) {
        setCapReached(true);
      }
    },
  });

  const busy = status === "submitted" || status === "streaming";

  return (
    <section className="mt-6 rounded-md bg-white p-4 shadow-sm">
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-[#181c1e]">
          Start with the assistant
        </h2>
        {messages.length > 0 ? (
          <button
            type="button"
            onClick={() => setMessages([])}
            className="text-xs text-neutral-500 hover:underline"
          >
            New chat
          </button>
        ) : null}
      </div>
      <p className="mt-1 text-xs text-neutral-500">
        Ask anything about the Pacific indicators in this catalogue. The
        assistant draws on every theme below and can point you at the
        right snapshot page.
      </p>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          const form = e.currentTarget;
          const fd = new FormData(form);
          const text = String(fd.get("q") ?? "").trim();
          if (!text || busy) return;
          setCapReached(false);
          void sendMessage({ text });
          form.reset();
        }}
        className="mt-3 flex gap-2"
      >
        <input
          name="q"
          placeholder="e.g. How has Fiji education changed since 2015?"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm"
          autoComplete="off"
          disabled={busy}
        />
        <button
          type="submit"
          className="rounded-md bg-[#004467] px-4 py-2 text-sm text-white hover:bg-[#003355] disabled:opacity-60"
          disabled={busy}
        >
          Ask
        </button>
      </form>

      {messages.length === 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLES.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => {
                if (busy) return;
                setCapReached(false);
                void sendMessage({ text: p });
              }}
              disabled={busy}
              className="rounded-full bg-[#f1f4f6] px-3 py-1 text-xs hover:bg-[#e5e9eb] disabled:opacity-60"
            >
              {p}
            </button>
          ))}
        </div>
      ) : (
        <div className="mt-4 max-h-[40vh] overflow-y-auto rounded-md bg-[#f7fafc] p-3 text-sm">
          {messages.map((m) => (
            <div key={m.id} className="mb-3">
              <div className="text-xs font-medium text-neutral-500">
                {m.role === "user" ? "You" : "Assistant"}
              </div>
              <div className="whitespace-pre-wrap">
                {m.parts
                  ?.filter((p) => p.type === "text")
                  .map((p, idx) => (
                    <span key={idx}>{(p as { text?: string }).text}</span>
                  ))}
              </div>
            </div>
          ))}
          {busy ? (
            <p className="text-xs italic text-neutral-500">thinking…</p>
          ) : null}
        </div>
      )}

      {capReached ? (
        <p className="mt-3 rounded-md bg-amber-50 p-2 text-xs text-amber-800">
          Daily chat limit reached. Sign in via &ldquo;Explore in Surfer&rdquo;
          on any snapshot page to continue.
        </p>
      ) : null}
      {error && !capReached ? (
        <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-800">
          Couldn&apos;t reach the assistant. Try again in a moment.
        </p>
      ) : null}
    </section>
  );
}
