"use client";

import { useMemo, useState, type RefObject } from "react";
import {
  exportToPdf,
  exportToHtml,
  exportToHtmlLive,
  exportToJson,
} from "@/lib/export-dashboard";
import type { SDMXDashboardConfig } from "@/lib/types";

export type ExportAction = {
  key: "pdf" | "html-static" | "html-live" | "json";
  label: string;
  sub: string;
  run: () => void | Promise<void>;
};

export function useDashboardExport(
  config: SDMXDashboardConfig,
  dashboardRef: RefObject<HTMLDivElement | null>,
) {
  const [exporting, setExporting] = useState(false);

  const actions = useMemo<ExportAction[]>(
    () => [
      {
        key: "pdf",
        label: "PDF",
        sub: "Snapshot image",
        run: async () => {
          if (!dashboardRef.current) return;
          setExporting(true);
          try {
            await exportToPdf(dashboardRef.current, config);
          } catch (err) {
            console.error("PDF export failed:", err);
            alert(
              "PDF export failed: " +
                (err instanceof Error ? err.message : String(err)),
            );
          } finally {
            setExporting(false);
          }
        },
      },
      {
        key: "html-static",
        label: "HTML (static)",
        sub: "Works offline",
        run: () => {
          if (dashboardRef.current) exportToHtml(dashboardRef.current, config);
        },
      },
      {
        key: "html-live",
        label: "HTML (live)",
        sub: "Interactive, needs HTTP",
        run: () => exportToHtmlLive(config),
      },
      {
        key: "json",
        label: "JSON Config",
        sub: "Raw config file",
        run: () => exportToJson(config),
      },
    ],
    [config, dashboardRef],
  );

  return { exporting, actions };
}

export function DashboardExportMenu({
  config,
  dashboardRef,
}: {
  config: SDMXDashboardConfig;
  dashboardRef: RefObject<HTMLDivElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const { exporting, actions } = useDashboardExport(config, dashboardRef);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
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
                className="flex w-full flex-col rounded-[var(--radius-md)] px-3 py-2 text-left text-xs transition-colors hover:bg-surface-low"
              >
                <span className="font-medium text-on-surface">{action.label}</span>
                <span className="text-[10px] text-on-surface-variant">{action.sub}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
