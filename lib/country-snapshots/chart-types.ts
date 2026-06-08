import { chartTypes as cached } from "./chart-types.generated";

export type ChartTypeDecision = "line" | "bar" | "empty" | "error";

export type ChartTypeEntry = {
  type: ChartTypeDecision;
  timePoints: number;
  detectedAt: string;        // ISO date (e.g. "2026-06-08")
  locked: boolean;           // true once timePoints >= LOCK_THRESHOLD; never re-probed
  httpStatus?: number;       // last observed HTTP status (for diagnostics)
};

export type ChartTypesByCountry = Record<string, ChartTypeEntry>;
export type ChartTypesCache = Record<string, ChartTypesByCountry>; // indicatorId -> countryCode -> entry

export const LOCK_THRESHOLD = 5; // >= this many time points → permanent "line"
export const LINE_THRESHOLD = 3; // >= this many time points → line (else bar)

export function getCachedChartTypes(): ChartTypesCache {
  return cached;
}

/** Look up the chart type for a single-country page. Falls back to "line". */
export function chartTypeFor(
  indicatorId: string,
  countryCode: string,
): ChartTypeDecision {
  const entry = cached[indicatorId]?.[countryCode];
  return entry?.type ?? "line";
}

/**
 * Collapse per-country types for a compare page. The library can only render
 * one type per visual, so we need a single decision across the selected
 * countries:
 *
 *   - If any country has a known data series (>=1 time point), use the
 *     widest applicable type: "line" wins over "bar" wins over "empty".
 *   - If all countries are "empty" or "error", return "empty".
 *
 * Rationale: a line chart can degrade gracefully to single points; a bar
 * chart with a single point per country reads as bars, which is fine.
 * Mixing forces a choice; we prefer the type that the most data-rich
 * country can support.
 */
export function chartTypeForCompare(
  indicatorId: string,
  countryCodes: string[],
): ChartTypeDecision {
  const entries = countryCodes
    .map((c) => cached[indicatorId]?.[c])
    .filter((e): e is ChartTypeEntry => Boolean(e));
  if (entries.length === 0) return "line";
  if (entries.some((e) => e.type === "line")) return "line";
  if (entries.some((e) => e.type === "bar")) return "bar";
  return "empty";
}

export function decide(timePoints: number): ChartTypeDecision {
  if (timePoints <= 0) return "empty";
  if (timePoints >= LINE_THRESHOLD) return "line";
  return "bar";
}
