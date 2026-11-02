"use client";

import type { ComponentProps } from "react";
import dynamic from "next/dynamic";

/**
 * The library (ECharts, OpenLayers) is browser-only, so it loads client-side.
 * Renders inside `.sdmx-scope` (display: contents), the scope of the
 * Bootstrap utility shim in app/globals.css.
 */
export const SDMXDashboardDynamic = dynamic(
  () =>
    import("sdmx-dashboard-components").then((mod) => {
      const { SDMXDashboard } = mod;
      return function ScopedSDMXDashboard(
        props: ComponentProps<typeof SDMXDashboard>,
      ) {
        return (
          <div className="sdmx-scope">
            <SDMXDashboard {...props} />
          </div>
        );
      };
    }),
  { ssr: false },
);
