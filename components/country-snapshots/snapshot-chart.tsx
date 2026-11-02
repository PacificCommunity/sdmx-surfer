"use client";

import type { ComponentProps } from "react";
import dynamic from "next/dynamic";

/**
 * Dynamic wrappers for the library components so ECharts and OpenLayers
 * (browser-only) don't run during SSR. Mirrors the pattern used by
 * components/sdmx-dashboard-dynamic.tsx, including the `.sdmx-scope` wrapper
 * for the Bootstrap utility shim.
 */

export const SnapshotValue = dynamic(
  () =>
    import("sdmx-dashboard-components").then((mod) => {
      const { SDMXValue } = mod;
      return function ScopedSDMXValue(props: ComponentProps<typeof SDMXValue>) {
        return (
          <div className="sdmx-scope">
            <SDMXValue {...props} />
          </div>
        );
      };
    }),
  { ssr: false, loading: () => <ValueSkeleton /> },
);

function ValueSkeleton() {
  return (
    <div className="h-24 w-full animate-pulse rounded-md bg-surface-low" />
  );
}

export const SnapshotChart = dynamic(
  () =>
    import("sdmx-dashboard-components").then((mod) => {
      const { SDMXChart } = mod;
      return function ScopedSDMXChart(props: ComponentProps<typeof SDMXChart>) {
        return (
          <div className="sdmx-scope">
            <SDMXChart {...props} />
          </div>
        );
      };
    }),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

function ChartSkeleton() {
  return (
    <div className="h-72 w-full animate-pulse rounded-md bg-surface-low" />
  );
}
