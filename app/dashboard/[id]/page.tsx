"use client";

import { useEffect, useRef, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { loadSession } from "@/lib/session";
import { getDashboardSubtitle, getDashboardTitle } from "@/lib/dashboard-text";
import { useHighchartsViewportReflow } from "@/lib/use-highcharts-viewport-reflow";
import { SDMXDashboardDynamic } from "@/components/sdmx-dashboard-dynamic";
import { DataSourcesPanel, DashboardSourceFooter } from "@/components/data-sources-panel";
import { DashboardExportMenu } from "@/components/dashboard-export-menu";
import type { SDMXDashboardConfig } from "@/lib/types";

const DASHBOARD_CARD_SCROLL_CLASS =
  "max-w-full overflow-x-auto rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient";
const DASHBOARD_CARD_CONTENT_CLASS = "block w-full min-w-[1024px]";

async function extractConfigFromSession(sessionId: string): Promise<SDMXDashboardConfig | null> {
  const session = await loadSession(sessionId);
  if (!session) return null;
  const { configHistory, configPointer } = session;
  if (configHistory.length === 0 || configPointer < 0) return null;
  return configHistory[Math.min(configPointer, configHistory.length - 1)];
}

export default function DashboardViewPage() {
  const params = useParams();
  const router = useRouter();
  const sessionId = params.id as string;

  const [config, setConfig] = useState<SDMXDashboardConfig | null>(null);
  const [notFound, setNotFound] = useState(false);
  const dashboardRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void (async () => {
      const extracted = await extractConfigFromSession(sessionId);
      if (extracted) {
        setConfig(extracted);
      } else {
        setNotFound(true);
      }
    })();
  }, [sessionId]);

  useHighchartsViewportReflow(dashboardRef, Boolean(config));

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-8">
        <div className="submerged-overlay max-w-md rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
          <h2 className="type-headline-sm text-on-surface">
            Dashboard not found
          </h2>
          <p className="mt-3 text-sm text-on-surface-variant">
            This session doesn&apos;t exist or has no dashboard yet.
          </p>
          <button
            type="button"
            onClick={() => router.push("/")}
            className="brand-gradient mt-6 rounded-full px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
          >
            Go Home
          </button>
        </div>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  const title = getDashboardTitle(config);
  const subtitle = getDashboardSubtitle(config);

  return (
    <div className="min-h-screen bg-surface">
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => router.push("/")}
              className="rounded-full p-1.5 text-on-surface-variant transition-colors hover:text-primary"
              title="Back to home"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
              </svg>
            </button>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-primary">
                {title}
              </h1>
              {subtitle && (
                <p className="type-label-md text-on-tertiary-fixed-variant">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => router.push("/builder?session=" + sessionId)}
              className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
              </svg>
              Edit via Chat
            </button>

            <DashboardExportMenu config={config} dashboardRef={dashboardRef} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
          <span className="type-label-md rounded-full bg-secondary-container px-2.5 py-0.5 text-on-secondary-container">
            Live SDMX Dashboard
          </span>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-on-surface">
            {title}
          </h2>
          {subtitle && (
            <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>
          )}
        </div>

        <div className={DASHBOARD_CARD_SCROLL_CLASS}>
          <div
            ref={(el) => { dashboardRef.current = el; }}
            className={DASHBOARD_CARD_CONTENT_CLASS}
          >
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <SDMXDashboardDynamic config={config as any} lang="en" />
          </div>
        </div>

        <DataSourcesPanel config={config} />

        <DashboardSourceFooter config={config} />
      </main>
    </div>
  );
}
