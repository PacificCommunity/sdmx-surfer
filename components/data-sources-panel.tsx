"use client";

import { extractDataSources } from "@/lib/data-explorer-url";
import type { SDMXDashboardConfig } from "@/lib/types";

export function DataSourcesPanel({ config }: { config: SDMXDashboardConfig }) {
  const sources = extractDataSources(config);
  if (sources.length === 0) return null;

  return (
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
                    <a
                      href={src.apiUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                    >
                      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                      </svg>
                      API
                    </a>
                    {src.explorerUrl && (
                      <a
                        href={src.explorerUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-secondary hover:underline"
                      >
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
  );
}

export function DashboardSourceFooter({
  config,
  trailing,
}: {
  config: SDMXDashboardConfig;
  trailing?: React.ReactNode;
}) {
  const sources = extractDataSources(config);
  const uniqueNames = Array.from(new Set(sources.map((s) => s.endpointName)));
  return (
    <footer className="mt-8 text-center text-xs text-on-surface-variant">
      {uniqueNames.length > 0 ? "Data from " + uniqueNames.join(", ") + " · " : ""}
      {trailing ?? "SDMX Surfer"}
    </footer>
  );
}
