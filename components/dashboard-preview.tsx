"use client";

import {
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { SDMXDashboardDynamic } from "@/components/sdmx-dashboard-dynamic";
import { SurferLogo } from "@/components/surfer-logo";
import { DashboardErrorBoundary } from "@/components/dashboard-error-boundary";
import { JsonEditor } from "@/components/json-editor";
import { DashboardSkeleton } from "@/components/dashboard-skeleton";
import { DataSourcesPanel } from "@/components/data-sources-panel";
import { useDashboardExport, type ExportAction } from "@/components/dashboard-export-menu";
import {
  getDashboardTitle,
  getTextConfigValue,
} from "@/lib/dashboard-text";
import { useHighchartsViewportReflow } from "@/lib/use-highcharts-viewport-reflow";
import type { SDMXDashboardConfig } from "@/lib/types";

const SDMXDashboard = SDMXDashboardDynamic;

// ── Main Component ──

interface DashboardPreviewProps {
  config: SDMXDashboardConfig | null;
  onConfigEdit?: (config: SDMXDashboardConfig) => void;
  onError?: (error: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  presentUrl?: string;
  isPublished?: boolean;
  onPublish?: () => void;
  onEditPublishDetails?: () => void;
  onUnpublish?: () => void;
  publicUrl?: string;
}

const LOAD_COMPLETE_SELECTOR = [
  ".highcharts-container",
  ".ol-viewport",
  "svg",
  "canvas",
].join(", ");

const PREVIEW_DASHBOARD_SCROLL_CLASS = "max-w-full overflow-x-auto";
const PREVIEW_DASHBOARD_CONTENT_CLASS = "relative z-10 block w-full min-w-[1024px] ";

function dashboardNeedsGraphicSignal(config: SDMXDashboardConfig): boolean {
  return config.rows.some((row) =>
    row.columns.some((column) => column.type !== "note" && column.type !== "value"),
  );
}

export const DashboardPreview = memo(function DashboardPreview({
  config,
  onConfigEdit,
  onError,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  presentUrl,
  isPublished,
  onPublish,
  onEditPublishDetails,
  onUnpublish,
  publicUrl,
}: DashboardPreviewProps) {
  const [tab, setTab] = useState<"preview" | "json">("preview");
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [animateDashboardEnter, setAnimateDashboardEnter] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const errorsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skeletonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardRootRef = useRef<HTMLDivElement>(null);
  const { exporting, actions: exportActions } = useDashboardExport(
    config ?? { id: "empty", rows: [] },
    dashboardRootRef,
  );

  const reportError = useCallback(
    (msg: string) => {
      if (errorsRef.current.has(msg)) return;
      errorsRef.current.add(msg);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const allErrors = Array.from(errorsRef.current);
        // Enrich with component context so the AI knows which panels to investigate
        let context = allErrors.join("; ");
        if (config) {
          const components = config.rows.flatMap((r) =>
            r.columns.map((c) => {
              const title = getTextConfigValue(c.title) || c.id;
              const url = typeof c.data === "string" ? c.data : Array.isArray(c.data) ? c.data[0] : "";
              // Truncate URL for readability
              const shortUrl = url && url.length > 80 ? url.slice(0, 80) + "..." : url;
              return title + " (" + c.type + ", url: " + shortUrl + ")";
            }),
          );
          context +=
            ". Dashboard components: " + components.join("; ") +
            ". Check that each data URL returns valid data with observations. " +
            "Try the URL in a browser to verify. If a URL returns no data, " +
            "broaden the query (fewer dimension filters, wider time range) or use a different dataflow.";
        }
        onError?.(context);
      }, 2000);
    },
    [onError, config],
  );

  useEffect(() => {
    if (!config) return;
    const handler = (event: PromiseRejectionEvent) => {
      const msg =
        event.reason?.message || String(event.reason) || "Unknown error";
      if (
        msg.includes("fetching data") ||
        msg.includes("Highcharts") ||
        msg.includes("not found in dataflow") ||
        msg.includes("observations empty") ||
        msg.includes("dimension") ||
        msg.includes("toFixed") ||
        msg.includes("Cannot read properties of undefined") ||
        msg.includes("Cannot read properties of null")
      ) {
        event.preventDefault();
        reportError(msg);
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, [config, reportError]);

  useEffect(() => {
    errorsRef.current = new Set();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [config]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
      }
    };
  }, []);

  const title = config ? getDashboardTitle(config) : null;

  const hasValidRows = Boolean(
    config?.id &&
      Array.isArray(config.rows) &&
      config.rows.length > 0 &&
      config.rows.every(
        (row) => row && Array.isArray(row.columns) && row.columns.length > 0,
      ),
  );
  const needsGraphicSignal = config
    ? dashboardNeedsGraphicSignal(config)
    : false;

  useHighchartsViewportReflow(
    dashboardRootRef,
    Boolean(config && tab === "preview" && hasValidRows),
  );

  useEffect(() => {
    if (!config || tab !== "preview" || !hasValidRows) {
      setShowSkeleton(false);
      return;
    }

    setShowSkeleton(true);
  }, [config, hasValidRows, tab]);

  useEffect(() => {
    if (!config || tab !== "preview" || !hasValidRows) {
      setAnimateDashboardEnter(false);
      return;
    }

    setAnimateDashboardEnter(false);
    const frame = window.requestAnimationFrame(() => {
      setAnimateDashboardEnter(true);
    });
    const timeout = window.setTimeout(() => {
      setAnimateDashboardEnter(false);
    }, 400);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [config, hasValidRows, tab]);

  useEffect(() => {
    if (!config || !showSkeleton || tab !== "preview" || !hasValidRows) {
      return;
    }

    const root = dashboardRootRef.current;

    if (!root) {
      return;
    }

    const hideSkeleton = () => {
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
        skeletonTimeoutRef.current = null;
      }
      setShowSkeleton(false);
    };

    const hasRenderedContent = () => {
      if (root.querySelector(LOAD_COMPLETE_SELECTOR)) {
        return true;
      }

      if (!needsGraphicSignal) {
        return (
          root.textContent?.trim().length !== 0 ||
          root.querySelectorAll("div, p, span, h1, h2, h3, h4, h5, h6").length > 4
        );
      }

      return false;
    };

    if (hasRenderedContent()) {
      hideSkeleton();
      return;
    }

    const observer = new MutationObserver(() => {
      if (hasRenderedContent()) {
        observer.disconnect();
        hideSkeleton();
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    skeletonTimeoutRef.current = setTimeout(hideSkeleton, 6000);

    return () => {
      observer.disconnect();
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
        skeletonTimeoutRef.current = null;
      }
    };
  }, [config, needsGraphicSignal, showSkeleton, tab, hasValidRows]);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="submerged-overlay max-w-md rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-surface-high">
            <SurferLogo className="h-8 w-8 text-accent-muted" />
          </div>
          <h3 className="type-headline-sm text-on-surface">
            Your exploration appears here
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            Start surfing in the chat — charts, maps, and data views
            will build up as you go.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with tabs */}
      <div className="flex shrink-0 items-center justify-between bg-surface px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex rounded-full bg-surface-low p-0.5">
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold transition-all " +
                (tab === "preview"
                  ? "bg-surface-card text-primary shadow-ambient"
                  : "text-on-surface-variant hover:text-on-surface")
              }
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setTab("json")}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold transition-all " +
                (tab === "json"
                  ? "bg-surface-card text-primary shadow-ambient"
                  : "text-on-surface-variant hover:text-on-surface")
              }
            >
              JSON
            </button>
          </div>

          {title && (
            <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-tight text-on-surface">
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex rounded-full bg-surface-low p-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo"
              className="rounded-full p-1 text-on-surface-variant transition-colors hover:text-primary disabled:opacity-25"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo"
              className="rounded-full p-1 text-on-surface-variant transition-colors hover:text-primary disabled:opacity-25"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
              </svg>
            </button>
          </div>

          {/* Present (full-screen view) */}
          {presentUrl && config && (
            <a
              href={presentUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full-screen presentation"
              className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Present
            </a>
          )}

          {/* Publish / Unpublish */}
          {config && (onPublish || onUnpublish) && (
            <div className="flex items-center gap-1.5">
              {isPublished ? (
                <>
                  {publicUrl && (
                    <button
                      type="button"
                      title="Copy public link"
                      onClick={() => {
                        const url = window.location.origin + publicUrl;
                        void navigator.clipboard.writeText(url);
                      }}
                      className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-secondary transition-transform hover:scale-105 active:scale-95"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.56a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.757 8.81" />
                      </svg>
                      Copy Link
                    </button>
                  )}
                  {onEditPublishDetails && (
                    <button
                      type="button"
                      onClick={onEditPublishDetails}
                      title="Edit publish details"
                      className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.125 2.125 0 113.005 3.005L7.5 19.86 3 21l1.14-4.5 12.722-12.013z" />
                      </svg>
                      Edit Details
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onUnpublish}
                    title="Unpublish dashboard"
                    className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                    Unpublish
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onPublish}
                  title="Publish dashboard — makes it publicly viewable via a link"
                  className="brand-gradient flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                  </svg>
                  Publish
                </button>
              )}
            </div>
          )}

          {/* Export dropdown */}
          <BuilderExportDropdown
            open={exportMenu}
            setOpen={setExportMenu}
            exporting={exporting}
            actions={config ? exportActions : []}
          />
        </div>
      </div>

      {/* Tab content */}
      {tab === "json" ? (
        <div className="flex-1 min-h-0">
          <JsonEditor
            config={config}
            onApply={(edited) => onConfigEdit?.(edited)}
          />
        </div>
      ) : !hasValidRows ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-lg rounded-[var(--radius-xl)] bg-surface-low p-8 text-center">
            <p className="type-label-md text-on-surface-variant">
              Config received but rows are malformed
            </p>
            <pre className="mt-3 max-h-60 overflow-auto rounded-[var(--radius-md)] bg-surface-high p-4 text-left text-xs text-on-surface-variant">
              {JSON.stringify(config, null, 2)}
            </pre>
            <button
              type="button"
              onClick={() => setTab("json")}
              className="mt-3 rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary shadow-ambient transition-transform hover:scale-105 active:scale-95"
            >
              Edit JSON
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 min-w-0 overflow-auto p-6">
          {/* Dashboard renders on top */}
          <div className={PREVIEW_DASHBOARD_SCROLL_CLASS}>
            <div
              ref={dashboardRootRef}
              className={
                PREVIEW_DASHBOARD_CONTENT_CLASS +
                (animateDashboardEnter ? "dashboard-enter" : "")
              }
            >
              <DashboardErrorBoundary
                onError={reportError}
              >
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <SDMXDashboard config={config as any} lang="en" />
              </DashboardErrorBoundary>
            </div>
          </div>
          {showSkeleton && (
            <div className="pointer-events-none absolute inset-6 z-20 transition-opacity duration-300">
              <DashboardSkeleton config={config} />
            </div>
          )}

          {/* Data sources table */}
          <DataSourcesPanel config={config} variant="builder" />
        </div>
      )}
    </div>
  );
});

// ── Export dropdown (builder-styled) ──

const BUILDER_EXPORT_ICONS: Record<ExportAction["key"], string> = {
  pdf: "M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z",
  "html-static": "M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5",
  "html-live": "M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418",
  json: "M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776",
};

const BUILDER_EXPORT_SUB: Record<ExportAction["key"], string> = {
  pdf: "Snapshot of current view",
  "html-static": "Snapshot — works offline, from file://",
  "html-live": "Interactive — needs HTTP server + internet",
  json: "Raw dashboard config",
};

function BuilderExportDropdown({
  open,
  setOpen,
  exporting,
  actions,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
  exporting: boolean;
  actions: ExportAction[];
}) {
  const disabled = exporting || actions.length === 0;
  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
      >
        {exporting ? (
          <>
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
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

      {open && (
        <>
          <div className="fixed inset-0 z-20" onClick={() => setOpen(false)} />
          <div className="absolute right-0 z-30 mt-1 w-48 rounded-[var(--radius-lg)] bg-surface-card p-1 shadow-ambient">
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                onClick={() => {
                  setOpen(false);
                  void action.run();
                }}
                className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs font-medium text-on-surface transition-colors hover:bg-surface-low"
              >
                <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={BUILDER_EXPORT_ICONS[action.key]} />
                </svg>
                <div>
                  <div>{action.label}</div>
                  <div className="text-[10px] text-on-surface-variant">{BUILDER_EXPORT_SUB[action.key]}</div>
                </div>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
