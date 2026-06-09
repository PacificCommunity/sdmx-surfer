"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import type { SDMXDashboardConfig } from "@/lib/types";
import { SDMXDashboardDynamic } from "@/components/sdmx-dashboard-dynamic";

// Curated examples. Kept regionally-neutral and varied across themes.
const EXAMPLES = [
  "Build me a dashboard of Tonga education over the last decade",
  "Show health indicators across Solomon Islands and Vanuatu",
  "Pacific tobacco use trends as a chart",
  "Climate adaptation data — which countries have the most?",
  "Governance indicators in Melanesia",
  "Population trends across the smaller PICTs",
];

const INDEX_CONTEXT = {
  countryCodes: [] as string[],
  themeSlug: "index",
  indicatorIds: [] as string[],
};

/**
 * Extract the most recent dashboard config emitted by the agent via
 * update_dashboard. Mirrors the pattern used by app/builder/page.tsx.
 */
function extractLatestDashboard(
  messages: Array<{ parts?: unknown[] }>,
): SDMXDashboardConfig | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i]?.parts;
    if (!Array.isArray(parts)) continue;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as {
        type?: string;
        state?: string;
        toolName?: string;
        output?: { dashboard?: SDMXDashboardConfig };
      };
      const isUpdate =
        part.type === "tool-update_dashboard" ||
        (part.type === "dynamic-tool" && part.toolName === "update_dashboard");
      if (!isUpdate) continue;
      if (part.state !== "output-available") continue;
      const out = part.output;
      if (out?.dashboard) return out.dashboard;
    }
  }
  return null;
}

export function ChatStarter() {
  const [capReached, setCapReached] = useState(false);
  const previewRef = useRef<HTMLDivElement | null>(null);

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

  // Stable dashboard prop: re-rendering SDMXDashboardDynamic with a new
  // object reference tears down and remounts every chart, even when the
  // content hasn't actually changed. The agent often emits update_dashboard
  // multiple times during one turn while iterating; we deep-compare by
  // serialised JSON and only update the reference when the content differs.
  const lastSerialisedRef = useRef<string | null>(null);
  const lastDashboardRef = useRef<SDMXDashboardConfig | null>(null);
  const dashboard = useMemo(() => {
    const next = extractLatestDashboard(messages);
    if (next === null) {
      lastSerialisedRef.current = null;
      lastDashboardRef.current = null;
      return null;
    }
    const serialised = JSON.stringify(next);
    if (serialised === lastSerialisedRef.current) {
      return lastDashboardRef.current;
    }
    lastSerialisedRef.current = serialised;
    lastDashboardRef.current = next;
    return next;
  }, [messages]);

  // Scroll the dashboard into view the first time it appears. Only re-fires
  // on the boolean transition; running on every config tweak would steal the
  // user's scroll position.
  const dashboardPresent = Boolean(dashboard);
  useEffect(() => {
    if (dashboardPresent && previewRef.current) {
      previewRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, [dashboardPresent]);

  return (
    <section className="mt-6 space-y-4">
      {dashboard ? (
        <div
          ref={previewRef}
          className="overflow-x-auto rounded-md bg-white p-4 shadow-sm"
        >
          <div className="mb-3 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-[#181c1e]">
              Live preview
            </h2>
            <span className="text-xs text-neutral-400">
              ask for changes in the chat below
            </span>
          </div>
          {/* Project's SDMXDashboardConfig uses `columns`; the library
              expects `colums` (sic). The dashboard-authoring layer compiles
              to the library shape; the cast acknowledges that without
              widening the project's own type. */}
          {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
          <SDMXDashboardDynamic config={dashboard as any} />
        </div>
      ) : null}

      <div className="rounded-md bg-white p-4 shadow-sm">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-[#181c1e]">
            Build with the assistant
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
          Ask the assistant to build you a dashboard from the catalogue, or
          to point you at the right canonical snapshot page.
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
            placeholder="e.g. Build me a dashboard of Fiji education since 2015"
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
            Daily chat limit reached. Sign in via &ldquo;Save to my Surfer
            account&rdquo; on a dashboard to continue.
          </p>
        ) : null}
        {error && !capReached ? (
          <p className="mt-3 rounded-md bg-red-50 p-2 text-xs text-red-800">
            Couldn&apos;t reach the assistant. Try again in a moment.
          </p>
        ) : null}
      </div>
    </section>
  );
}
