"use client";

import { useEffect, type RefObject } from "react";

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

export function useHighchartsViewportReflow(
  rootRef: RefObject<HTMLElement | null>,
  enabled: boolean,
) {
  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let raf = 0;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let lastMeasuredWidth = -1;
    let lastMeasuredHeight = -1;

    const root = rootRef.current;
    const observedElement = root?.parentElement ?? root;

    const runReflow = () => {
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

    const scheduleReflow = () => {
      if (!observedElement) return;

      const nextWidth = observedElement.clientWidth;
      const nextHeight = observedElement.clientHeight;
      const widthChanged = nextWidth !== lastMeasuredWidth;
      const heightChanged = nextHeight !== lastMeasuredHeight;

      if (!widthChanged && !heightChanged) {
        return;
      }

      lastMeasuredWidth = nextWidth;
      lastMeasuredHeight = nextHeight;

      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      timeoutId = setTimeout(runReflow, 120);
    };

    let observer: ResizeObserver | null = null;
    if (observedElement && typeof ResizeObserver !== "undefined") {
      observer = new ResizeObserver(scheduleReflow);
      observer.observe(observedElement);
    }

    window.addEventListener("resize", scheduleReflow);
    window.visualViewport?.addEventListener("resize", scheduleReflow);

    // Handle the initial viewport state too, not just later changes.
    scheduleReflow();

    return () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
      observer?.disconnect();
      window.removeEventListener("resize", scheduleReflow);
      window.visualViewport?.removeEventListener("resize", scheduleReflow);
    };
  }, [enabled, rootRef]);
}
