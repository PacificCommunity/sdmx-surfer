"use client";

import dynamic from "next/dynamic";

/**
 * Dynamic wrappers for the library components so Highcharts (browser-only)
 * doesn't run during SSR. Mirrors the pattern used by
 * components/sdmx-dashboard-dynamic.tsx.
 */

export const SnapshotValue = dynamic(
  () =>
    import("sdmx-dashboard-components").then((mod) => mod.SDMXValue),
  { ssr: false, loading: () => <ValueSkeleton /> },
);

function ValueSkeleton() {
  return (
    <div className="h-24 w-full animate-pulse rounded-md bg-surface-low" />
  );
}

export const SnapshotChart = dynamic(
  () =>
    Promise.all([
      import("sdmx-dashboard-components"),
      import("highcharts"),
    ]).then(([mod, hcMod]) => {
      const Highcharts = hcMod.default as unknown as {
        addEvent?: (
          target: unknown,
          event: string,
          handler: (e: {
            code: number;
            message: string;
            preventDefault: () => void;
          }) => void,
        ) => void;
        __snapshotErrorHandlerInstalled?: boolean;
      };
      if (
        Highcharts.addEvent &&
        !Highcharts.__snapshotErrorHandlerInstalled
      ) {
        Highcharts.addEvent(Highcharts, "displayError", function (e) {
          console.warn(
            "[snapshot Highcharts] error #" + String(e.code) + ":",
            e.message,
          );
          e.preventDefault();
        });
        Highcharts.__snapshotErrorHandlerInstalled = true;
      }
      return mod.SDMXChart;
    }),
  { ssr: false, loading: () => <ChartSkeleton /> },
);

function ChartSkeleton() {
  return (
    <div className="h-72 w-full animate-pulse rounded-md bg-surface-low" />
  );
}
