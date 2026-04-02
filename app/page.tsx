"use client";

import { useEffect, useState } from "react";
import {
  listSessions,
  deleteSession,
  type SessionSummary,
} from "@/lib/session";
import { SurferLogo } from "@/components/surfer-logo";

export default function WelcomePage() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      setSessions(await listSessions());
      setLoaded(true);
    })();
  }, []);

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]">
              <SurferLogo className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-primary">
                SDMX Surfer
              </h1>
              <p className="type-label-md text-on-tertiary-fixed-variant">
                Pacific Data Hub
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => { window.location.href = "/builder"; }}
            className="brand-gradient rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
          >
            Open Builder
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = "/explore"; }}
            className="ghost-border rounded-full bg-surface-card px-4 py-2 text-sm font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
          >
            Data Catalogue
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = "/settings"; }}
            className="ghost-border rounded-full bg-surface-card p-2 text-on-surface-variant transition-transform hover:scale-105 hover:text-primary active:scale-95"
            title="Settings"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9.594 3.94c.09-.542.56-.94 1.11-.94h2.593c.55 0 1.02.398 1.11.94l.213 1.281c.063.374.313.686.645.87.074.04.147.083.22.127.325.196.72.257 1.075.124l1.217-.456a1.125 1.125 0 011.37.49l1.296 2.247a1.125 1.125 0 01-.26 1.431l-1.003.827c-.293.241-.438.613-.43.992a7.723 7.723 0 010 .255c-.008.378.137.75.43.991l1.004.827c.424.35.534.955.26 1.43l-1.298 2.247a1.125 1.125 0 01-1.369.491l-1.217-.456c-.355-.133-.75-.072-1.076.124a6.47 6.47 0 01-.22.128c-.331.183-.581.495-.644.869l-.213 1.281c-.09.543-.56.94-1.11.94h-2.594c-.55 0-1.019-.398-1.11-.94l-.213-1.281c-.062-.374-.312-.686-.644-.87a6.52 6.52 0 01-.22-.127c-.325-.196-.72-.257-1.076-.124l-1.217.456a1.125 1.125 0 01-1.369-.49l-1.297-2.247a1.125 1.125 0 01.26-1.431l1.004-.827c.292-.24.437-.613.43-.991a6.932 6.932 0 010-.255c.007-.38-.138-.751-.43-.992l-1.004-.827a1.125 1.125 0 01-.26-1.43l1.297-2.247a1.125 1.125 0 011.37-.491l1.216.456c.356.133.751.072 1.076-.124.072-.044.146-.086.22-.128.332-.183.582-.495.644-.869l.214-1.28z" />
              <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
          </button>
          <button
            type="button"
            onClick={() => { window.location.href = "/admin"; }}
            className="ghost-border rounded-full bg-surface-card p-2 text-on-surface-variant transition-transform hover:scale-105 hover:text-primary active:scale-95"
            title="Admin"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z" />
            </svg>
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Hero */}
        <section className="relative overflow-hidden rounded-[var(--radius-2xl)] bg-gradient-to-br from-primary via-primary-container to-primary p-12 text-white">
          {/* Decorative elements */}
          <div className="pointer-events-none absolute inset-0 opacity-10">
            <div className="absolute -right-20 -top-20 h-80 w-80 rounded-full bg-accent-light blur-3xl" />
            <div className="absolute -bottom-20 -left-20 h-64 w-64 rounded-full bg-secondary blur-3xl" />
          </div>

          <div className="relative z-10 grid gap-8 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <span className="type-label-md mb-4 inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 backdrop-blur-md">
                <span className="h-2 w-2 animate-pulse rounded-full bg-accent-light" />
                Live Intelligence
              </span>
              <h2 className="font-[family-name:var(--font-display)] text-4xl font-extrabold leading-tight tracking-tight lg:text-5xl">
                Surf the{" "}
                <span className="bg-gradient-to-r from-accent-light to-secondary-fixed-dim bg-clip-text text-transparent">
                  Data
                </span>
              </h2>
              <p className="mt-4 max-w-lg text-lg leading-relaxed text-white/80">
                Explore Pacific statistics through conversation.
                Describe what you want to know, and the AI discovers data,
                builds visualisations, and digs deeper with you.
              </p>
              <div className="mt-8 flex flex-wrap gap-3">
                <button
                  type="button"
                  onClick={() => { window.location.href = "/builder?new=1"; }}
                  className="rounded-full bg-white px-6 py-3 text-sm font-bold text-primary shadow-xl transition-transform hover:scale-105 active:scale-95"
                >
                  Start Exploring
                </button>
                {sessions.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      const el = document.getElementById("recent-sessions");
                      el?.scrollIntoView({ behavior: "smooth" });
                    }}
                    className="rounded-full border border-white/20 bg-white/10 px-6 py-3 text-sm font-bold backdrop-blur-md transition-transform hover:scale-105 hover:bg-white/20 active:scale-95"
                  >
                    Resume a Session
                  </button>
                )}
              </div>
            </div>

            {/* Stat cards */}
            <div className="hidden gap-4 lg:col-span-2 lg:grid lg:grid-cols-2">
              {[
                { value: "121", label: "Dataflows", color: "bg-accent-light/20" },
                { value: "22", label: "Pacific Nations", color: "bg-secondary-fixed-dim/20" },
                { value: "18", label: "SDMX Tools", color: "bg-white/10" },
                { value: "Live", label: "Data Access", color: "bg-white/10" },
              ].map((stat) => (
                <div
                  key={stat.label}
                  className={"flex flex-col justify-end rounded-[var(--radius-xl)] border border-white/10 p-6 backdrop-blur-xl " + stat.color}
                >
                  <span className="font-[family-name:var(--font-display)] text-3xl font-black">
                    {stat.value}
                  </span>
                  <span className="type-label-md mt-1 text-white/60">
                    {stat.label}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Quick start topics */}
        <section className="mt-10">
          <div className="mb-4 flex items-baseline justify-between">
            <div>
              <p className="type-label-md text-on-tertiary-fixed-variant">
                Quick Start
              </p>
              <h3 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-primary">
                Catch a Wave
              </h3>
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                title: "Population",
                description: "Demographics, projections, urbanization across Pacific Islands",
                prompt: "Show me population data for Pacific Island countries",
                icon: "M15 19.128a9.38 9.38 0 002.625.372 9.337 9.337 0 004.121-.952 4.125 4.125 0 00-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 018.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0111.964-3.07M12 6.375a3.375 3.375 0 11-6.75 0 3.375 3.375 0 016.75 0zm8.25 2.25a2.625 2.625 0 11-5.25 0 2.625 2.625 0 015.25 0z",
                bg: "bg-primary/5",
                iconColor: "text-primary",
              },
              {
                title: "Trade",
                description: "International merchandise trade, imports, exports, balance",
                prompt: "Create a trade dashboard for Fiji showing imports and exports",
                icon: "M2.25 18.75a60.07 60.07 0 0115.797 2.101c.727.198 1.453-.342 1.453-1.096V18.75M3.75 4.5v.75A.75.75 0 013 6h-.75m0 0v-.375c0-.621.504-1.125 1.125-1.125H20.25M2.25 6v9m18-10.5v.75c0 .414.336.75.75.75h.75m-1.5-1.5h.375c.621 0 1.125.504 1.125 1.125v9.75c0 .621-.504 1.125-1.125 1.125h-.375m1.5-1.5H21a.75.75 0 00-.75.75v.75m0 0H3.75m0 0h-.375a1.125 1.125 0 01-1.125-1.125V15m1.5 1.5v-.75A.75.75 0 003 15h-.75M15 10.5a3 3 0 11-6 0 3 3 0 016 0zm3 0h.008v.008H18V10.5zm-12 0h.008v.008H6V10.5z",
                bg: "bg-secondary/5",
                iconColor: "text-secondary",
              },
              {
                title: "Health",
                description: "Health facilities, SDG 3 indicators, maternal and child health",
                prompt: "What health data is available for Pacific Islands?",
                bg: "bg-tertiary/5",
                iconColor: "text-tertiary",
                icon: "M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z",
              },
              {
                title: "Education",
                description: "School enrollment, literacy, education spending",
                prompt: "Show me education statistics across Pacific Islands",
                bg: "bg-primary-fixed-dim/10",
                iconColor: "text-primary-container",
                icon: "M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5",
              },
            ].map((topic) => (
              <button
                key={topic.title}
                type="button"
                onClick={() => { window.location.href = "/builder?new=1&prompt=" + encodeURIComponent(topic.prompt); }}
                className="group rounded-[var(--radius-xl)] bg-surface-card p-6 text-left shadow-ambient transition-all hover:shadow-lg hover:shadow-primary/5"
              >
                <div className={"mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)] transition-colors group-hover:brand-gradient group-hover:text-white " + topic.bg}>
                  <svg
                    className={"h-6 w-6 transition-colors group-hover:text-white " + (topic.iconColor || "")}
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={1.5}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d={topic.icon} />
                  </svg>
                </div>
                <h4 className="font-[family-name:var(--font-display)] text-lg font-bold text-on-surface">
                  {topic.title}
                </h4>
                <p className="mt-1 text-sm text-on-surface-variant">
                  {topic.description}
                </p>
              </button>
            ))}
          </div>
        </section>

        {/* Recent sessions */}
        {loaded && sessions.length > 0 && (
          <section id="recent-sessions" className="mt-10">
            <div className="mb-4">
              <p className="type-label-md text-on-tertiary-fixed-variant">
                Recent Explorations
              </p>
              <h3 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-primary">
                Saved Dashboards
              </h3>
            </div>

            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-4 bg-surface-high/50 px-6 py-3">
                <div className="type-label-md col-span-6 text-on-surface">
                  Dashboard
                </div>
                <div className="type-label-md col-span-3 text-on-surface">
                  Last Modified
                </div>
                <div className="type-label-md col-span-3 text-right text-on-surface">
                  Actions
                </div>
              </div>

              {/* Rows */}
              {sessions.map((session) => (
                <div
                  key={session.sessionId}
                  className="grid grid-cols-12 items-center gap-4 px-6 py-4 transition-colors hover:bg-surface-low"
                >
                  <div className="col-span-6">
                    <button
                      type="button"
                      onClick={() => { window.location.href = "/builder?session=" + session.sessionId; }}
                      className="text-left"
                    >
                      <span className="font-[family-name:var(--font-display)] text-sm font-semibold text-primary hover:underline">
                        {session.title}
                      </span>
                    </button>
                  </div>
                  <div className="col-span-3 text-sm text-on-surface-variant">
                    {new Date(session.updatedAt).toLocaleDateString("en-GB", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </div>
                  <div className="col-span-3 flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={() => { window.location.href = "/builder?session=" + session.sessionId; }}
                      className="ghost-border rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
                    >
                      Open
                    </button>
                    <button
                      type="button"
                      onClick={() => { window.location.href = "/dashboard/" + session.sessionId; }}
                      className="ghost-border rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
                    >
                      View
                    </button>
                    <button
                      type="button"
                      onClick={async () => {
                        if (!window.confirm("Delete this session?")) return;
                        const ok = await deleteSession(session.sessionId);
                        if (!ok) {
                          window.alert("Failed to delete session. Check the console for details.");
                        }
                        setSessions(await listSessions());
                      }}
                      className="rounded-full p-1 text-on-surface-variant transition-colors hover:text-red-500"
                      title="Delete session"
                    >
                      <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer className="mt-16 pb-8 text-center text-xs text-on-surface-variant">
          SDMX Surfer — Pacific Community
          <br />
          Data from{" "}
          <a
            href="https://stats.pacificdata.org"
            className="text-secondary hover:underline"
          >
            Pacific Data Hub
          </a>
        </footer>
      </main>
    </div>
  );
}
