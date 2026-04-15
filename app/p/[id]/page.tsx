"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { SurferLogo } from "@/components/surfer-logo";
import { exportToPdf, exportToHtml, exportToHtmlLive, exportToJson } from "@/lib/export-dashboard";
import { extractDataSources } from "@/lib/data-explorer-url";
import { getDashboardSubtitle, getDashboardTitle } from "@/lib/dashboard-text";
import { useHighchartsViewportReflow } from "@/lib/use-highcharts-viewport-reflow";
import type { SDMXDashboardConfig } from "@/lib/types";

const SDMXDashboard = dynamic(
  () =>
    Promise.all([
      import("sdmx-dashboard-components"),
      import("highcharts"),
    ]).then(([mod, hcMod]) => {
      const Highcharts = hcMod.default;
      if (Highcharts.addEvent && !Highcharts.__errorHandlerInstalled) {
        Highcharts.addEvent(Highcharts, "displayError", function (
          e: { code: number; message: string; preventDefault: () => void },
        ) {
          console.warn("[Highcharts] error #" + String(e.code));
          e.preventDefault();
        });
        Highcharts.__errorHandlerInstalled = true;
      }
      return mod.SDMXDashboard;
    }),
  { ssr: false },
);

export default function PublicDashboardPage() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [config, setConfig] = useState<SDMXDashboardConfig | null>(null);
  const [title, setTitle] = useState<string | null>(null);
  const [description, setDescription] = useState<string | null>(null);
  const [author, setAuthor] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const [exporting, setExporting] = useState(false);
  const dashboardRef = useRef<HTMLDivElement | null>(null);

  const handleExplore = async () => {
    const forkUrl = "/builder?fork=" + id + "&new=1";
    try {
      // Quick auth check — no SessionProvider needed
      const res = await fetch("/api/auth/session");
      const data = await res.json();
      if (data?.user) {
        router.push(forkUrl);
        return;
      }
    } catch {
      // If check fails, fall through to login
    }
    router.push("/login?callbackUrl=" + encodeURIComponent(forkUrl));
  };

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/public/dashboards/" + id, {
          cache: "no-store",
        });
        if (!res.ok) {
          setNotFound(true);
          return;
        }
        const data = await res.json();
        if (data.config) {
          setConfig(data.config as SDMXDashboardConfig);
          setTitle(typeof data.title === "string" ? data.title : null);
          setDescription(typeof data.description === "string" ? data.description : null);
          setAuthor(data.author || null);
        } else {
          setNotFound(true);
        }
      } catch {
        setNotFound(true);
      }
    })();
  }, [id]);

  useHighchartsViewportReflow(Boolean(config));

  if (notFound) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface p-8">
        <div className="submerged-overlay max-w-md rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-surface-high">
            <SurferLogo className="h-8 w-8 text-accent-muted" />
          </div>
          <h2 className="type-headline-sm text-on-surface">
            Dashboard not found
          </h2>
          <p className="mt-3 text-sm text-on-surface-variant">
            This dashboard doesn&apos;t exist or is no longer published.
          </p>
          <Link
            href="/"
            className="brand-gradient mt-6 inline-block rounded-full px-6 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
          >
            Go Home
          </Link>
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

  const dashboardTitle = title || getDashboardTitle(config);
  const subtitle = getDashboardSubtitle(config);
  const sources = extractDataSources(config);

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-3">
        <div className="mx-auto flex max-w-7xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="brand-gradient flex h-8 w-8 items-center justify-center rounded-[var(--radius-md)] transition-transform hover:scale-105"
            >
              <SurferLogo className="h-4 w-4 text-white" />
            </Link>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-primary">
                {dashboardTitle}
              </h1>
              {subtitle && (
                <p className="type-label-md text-on-tertiary-fixed-variant">
                  {subtitle}
                </p>
              )}
            </div>
          </div>

          {/* Explore this data */}
          <button
            type="button"
            onClick={handleExplore}
            className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
          >
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Explore this data
          </button>

          {/* Export dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportMenu((v) => !v)}
              disabled={exporting}
              className="brand-gradient flex items-center gap-1.5 rounded-full px-4 py-1.5 text-xs font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              {exporting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-white border-t-transparent" />
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export
                </>
              )}
            </button>

            {exportMenu && (
              <>
                <div className="fixed inset-0 z-20" onClick={() => setExportMenu(false)} />
                <div className="absolute right-0 z-30 mt-1 w-48 rounded-[var(--radius-lg)] bg-surface-card p-1 shadow-ambient">
                  {[
                    { label: "PDF", sub: "Snapshot image", fn: async () => {
                      setExportMenu(false);
                      if (!dashboardRef.current) return;
                      setExporting(true);
                      try { await exportToPdf(dashboardRef.current, config); }
                      catch (err) { console.error("PDF export failed:", err); }
                      finally { setExporting(false); }
                    }},
                    { label: "HTML (static)", sub: "Works offline", fn: () => {
                      setExportMenu(false);
                      if (dashboardRef.current) exportToHtml(dashboardRef.current, config);
                    }},
                    { label: "HTML (live)", sub: "Interactive, needs HTTP", fn: () => {
                      setExportMenu(false);
                      exportToHtmlLive(config);
                    }},
                    { label: "JSON Config", sub: "Raw config file", fn: () => {
                      setExportMenu(false);
                      exportToJson(config);
                    }},
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onClick={item.fn}
                      className="flex w-full flex-col rounded-[var(--radius-md)] px-3 py-2 text-left text-xs transition-colors hover:bg-surface-low"
                    >
                      <span className="font-medium text-on-surface">{item.label}</span>
                      <span className="text-[10px] text-on-surface-variant">{item.sub}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Dashboard content */}
      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6">
            <span className="type-label-md rounded-full bg-secondary-container px-2.5 py-0.5 text-on-secondary-container">
            Published Dashboard
          </span>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-3xl font-extrabold tracking-tight text-on-surface">
            {dashboardTitle}
          </h2>
          {subtitle && (
            <p className="mt-1 text-sm text-on-surface-variant">{subtitle}</p>
          )}
          {description && (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
              {description}
            </p>
          )}
          {author && (
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.12em] text-on-tertiary-fixed-variant">
              By {author}
            </p>
          )}
        </div>

        <div className="overflow-x-auto">
          <div
            ref={(el) => { dashboardRef.current = el; }}
            className="min-w-full w-max rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient"
          >
            {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
            <SDMXDashboard config={config as any} lang="en" />
          </div>
        </div>

        {/* Data sources */}
        {sources.length > 0 && (
          <div className="mt-8 rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient">
            <h4 className="type-label-md mb-4 text-on-tertiary-fixed-variant">
              Data Sources
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left">
                    <th className="pb-2 pr-4 font-semibold text-on-surface-variant">Component</th>
                    <th className="pb-2 pr-4 font-semibold text-on-surface-variant">Dataflow</th>
                    <th className="pb-2 pr-4 font-semibold text-on-surface-variant">Source</th>
                    <th className="pb-2 pr-4 font-semibold text-on-surface-variant">Type</th>
                    <th className="pb-2 font-semibold text-on-surface-variant">Links</th>
                  </tr>
                </thead>
                <tbody>
                  {sources.map((src) => (
                    <tr key={src.componentId + "-" + src.apiUrl} className="transition-colors hover:bg-surface-low">
                      <td className="py-2 pr-4 font-medium text-on-surface">{src.componentTitle}</td>
                      <td className="py-2 pr-4 text-on-surface">{src.dataflowName}</td>
                      <td className="py-2 pr-4">
                        <span
                          className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold uppercase text-on-secondary-container"
                          title={src.endpointName}
                        >
                          {src.endpointShortName}
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <span className="rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-semibold uppercase text-on-surface-variant">
                          {src.componentType}
                        </span>
                      </td>
                      <td className="py-2">
                        <div className="flex items-center gap-3">
                          <a href={src.apiUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-primary hover:underline">
                            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                            </svg>
                            API
                          </a>
                          {src.explorerUrl && (
                            <a href={src.explorerUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-secondary hover:underline">
                              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
                              </svg>
                              Data Explorer
                            </a>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Explore CTA */}
        <div className="mt-8 rounded-[var(--radius-xl)] bg-secondary-container p-8 text-center">
          <h3 className="font-[family-name:var(--font-display)] text-lg font-bold text-on-secondary-container">
            Want to dig deeper?
          </h3>
          <p className="mt-2 text-sm text-on-secondary-container/80">
            Start from this dashboard and explore the data further — filter, compare, or add new views.
          </p>
          <button
            type="button"
            onClick={handleExplore}
            className="brand-gradient mt-4 inline-flex items-center gap-2 rounded-full px-6 py-2.5 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M7.5 8.25h9m-9 3H12m-9.75 1.51c0 1.6 1.123 2.994 2.707 3.227 1.129.166 2.27.293 3.423.379.35.026.67.21.865.501L12 21l2.755-4.133a1.14 1.14 0 01.865-.501 48.172 48.172 0 003.423-.379c1.584-.233 2.707-1.626 2.707-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
            </svg>
            Explore this data
          </button>
        </div>

        {/* Footer */}
        <footer className="mt-8 text-center text-xs text-on-surface-variant">
          {(() => {
            const uniqueNames = Array.from(new Set(sources.map((s) => s.endpointName)));
            return uniqueNames.length > 0 ? "Data from " + uniqueNames.join(", ") + " · " : "";
          })()}
          Built with{" "}
          <Link href="/" className="text-primary hover:underline">SDMX Surfer</Link>
        </footer>
      </main>
    </div>
  );
}
