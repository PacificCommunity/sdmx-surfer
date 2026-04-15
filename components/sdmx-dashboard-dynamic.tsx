"use client";

import dynamic from "next/dynamic";

declare module "highcharts" {
  let __errorHandlerInstalled: boolean | undefined;
}

export const SDMXDashboardDynamic = dynamic(
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
          console.warn(
            "[Highcharts] error #" + String(e.code) + ":",
            e.message,
          );
          e.preventDefault();
        });
        Highcharts.__errorHandlerInstalled = true;
      }
      return mod.SDMXDashboard;
    }),
  { ssr: false },
);
