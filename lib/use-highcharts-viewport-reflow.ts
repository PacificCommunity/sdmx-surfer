"use client";

import { useEffect } from "react";

type HighchartsChartLike = {
  reflow?: () => void;
  renderTo?: Element | null;
};

let highchartsPromise: Promise<typeof import("highcharts")> | null = null;

function loadHighcharts() {
  if (!highchartsPromise) {
    highchartsPromise = import("highcharts");
  }
  return highchartsPromise;
}

export function useHighchartsViewportReflow(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    let raf = 0;
    let cancelled = false;

    const reflow = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        void loadHighcharts().then((hc) => {
          if (cancelled) return;

          const highcharts = ("default" in hc ? hc.default : hc) as {
            charts?: Array<HighchartsChartLike | undefined>;
          };
          const charts = highcharts.charts ?? [];
          charts.forEach((chart) => {
            if (!chart?.reflow) return;
            if (chart.renderTo && !chart.renderTo.isConnected) return;
            chart.reflow();
          });
        });
      });
    };

    window.addEventListener("resize", reflow);
    window.visualViewport?.addEventListener("resize", reflow);

    // Handle the initial viewport state too, not just later changes.
    reflow();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", reflow);
      window.visualViewport?.removeEventListener("resize", reflow);
    };
  }, [enabled]);
}
