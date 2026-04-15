"use client";

import { extractDataSources, type DataSource } from "@/lib/data-explorer-url";
import type { SDMXDashboardConfig } from "@/lib/types";

export const DATA_SOURCE_TYPE_ICONS: Record<string, string> = {
  line: "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605",
  bar: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  column: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  pie: "M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z",
  value: "M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z",
  map: "M9 6.75V15m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z",
};

type Variant = "presentation" | "builder";

export function DataSourcesPanel({
  config,
  variant = "presentation",
}: {
  config: SDMXDashboardConfig;
  variant?: Variant;
}) {
  const sources = extractDataSources(config);
  if (sources.length === 0) return null;

  if (variant === "builder") {
    return (
      <div className="mt-6 rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
        <div className="px-6 py-4">
          <h4 className="type-label-md text-on-tertiary-fixed-variant">
            Data Sources
          </h4>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-surface-high/40">
                <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">Component</th>
                <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">Dataflow</th>
                <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">Source</th>
                <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">Type</th>
                <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">Links</th>
              </tr>
            </thead>
            <tbody>
              {sources.map((src) => (
                <BuilderSourceRow key={src.componentId + "-" + src.apiUrl} source={src} />
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

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
              <PresentationSourceRow key={src.componentId + "-" + src.apiUrl} source={src} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SourceLinks({ source, withTooltips }: { source: DataSource; withTooltips?: boolean }) {
  return (
    <div className="flex items-center gap-3">
      <a
        href={source.apiUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
        title={withTooltips ? "Open raw SDMX API query" : undefined}
      >
        <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
        </svg>
        API
      </a>
      {source.explorerUrl && (
        <a
          href={source.explorerUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-secondary hover:underline"
          title={withTooltips ? "Open in Pacific Data Explorer" : undefined}
        >
          <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
          </svg>
          Data Explorer
        </a>
      )}
    </div>
  );
}

function PresentationSourceRow({ source }: { source: DataSource }) {
  return (
    <tr className="transition-colors hover:bg-surface-low">
      <td className="py-2 pr-4 font-medium text-on-surface">{source.componentTitle}</td>
      <td className="py-2 pr-4 text-on-surface">{source.dataflowName}</td>
      <td className="py-2 pr-4">
        <span
          className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold uppercase text-on-secondary-container"
          title={source.endpointName}
        >
          {source.endpointShortName}
        </span>
      </td>
      <td className="py-2 pr-4">
        <span className="rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-semibold uppercase text-on-surface-variant">
          {source.componentType}
        </span>
      </td>
      <td className="py-2">
        <SourceLinks source={source} />
      </td>
    </tr>
  );
}

function BuilderSourceRow({ source }: { source: DataSource }) {
  const iconPath = DATA_SOURCE_TYPE_ICONS[source.componentType] || DATA_SOURCE_TYPE_ICONS.line;

  return (
    <tr className="transition-colors hover:bg-surface-low">
      <td className="px-6 py-3">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 shrink-0 text-on-surface-variant"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
          </svg>
          <span className="font-medium text-on-surface">
            {source.componentTitle}
          </span>
        </div>
      </td>
      <td className="px-6 py-3 text-on-surface">{source.dataflowName}</td>
      <td className="px-6 py-3">
        <span
          className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold uppercase text-on-secondary-container"
          title={source.endpointName}
        >
          {source.endpointShortName}
        </span>
      </td>
      <td className="px-6 py-3">
        <span className="rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-semibold uppercase text-on-surface-variant">
          {source.componentType}
        </span>
      </td>
      <td className="px-6 py-3">
        <SourceLinks source={source} withTooltips />
      </td>
    </tr>
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
