/**
 * Pure aggregation for the coverage build: SDMX-CSV rows → per-indicator,
 * per-area, per-year observation counts, and availability-constraint
 * responses → range envelopes. No I/O here, so the logic is unit-tested.
 */

import { ALL_INDICATOR, compareAreas, periodYear, type FlowRoles } from "@/lib/coverage/roles";
import type { CountsIndicator, YearCounts } from "@/lib/coverage/types";

export interface CountsResult {
  obs: number;
  first: number | null;
  last: number | null;
  indicators: CountsIndicator[];
}

export interface CountsAccumulator {
  add(row: string[]): void;
  finish(labels: ReadonlyMap<string, string>): CountsResult;
}

/** Pack a year → count map into `[firstYear, ...counts]`, zero-filling gaps. */
export function packYears(counts: ReadonlyMap<number, number>): YearCounts {
  if (counts.size === 0) return [];
  const years = [...counts.keys()];
  const first = Math.min(...years);
  const last = Math.max(...years);
  const packed: YearCounts = [first];
  for (let y = first; y <= last; y++) packed.push(counts.get(y) ?? 0);
  return packed;
}

function addTo(target: Map<number, number>, year: number, n: number): void {
  target.set(year, (target.get(year) ?? 0) + n);
}

/**
 * Count observations from SDMX-CSV rows. The first row given to the factory
 * is the header; columns are located by id because TIME_PERIOD sits in DSD
 * order and moves between flows.
 *
 * Rows whose OBS_VALUE is empty (missing-value placeholders) are not counted:
 * coverage answers "is there a number for this", which they are not.
 */
export function createCountsAccumulator(header: string[], roles: FlowRoles): CountsAccumulator {
  const timeCol = header.indexOf("TIME_PERIOD");
  if (timeCol < 0) throw new Error("SDMX-CSV header has no TIME_PERIOD column");
  const valueCol = header.indexOf("OBS_VALUE");
  const indicatorCol = roles.indicatorDim ? header.indexOf(roles.indicatorDim) : -1;
  if (roles.indicatorDim && indicatorCol < 0) {
    throw new Error("SDMX-CSV header has no " + roles.indicatorDim + " column");
  }
  const areaCol = roles.areaDim ? header.indexOf(roles.areaDim) : -1;
  if (roles.areaDim && areaCol < 0) {
    throw new Error("SDMX-CSV header has no " + roles.areaDim + " column");
  }

  // indicator → area ("" when the flow has no area dimension) → year → count
  const tree = new Map<string, Map<string, Map<number, number>>>();

  return {
    add(row) {
      if (valueCol >= 0 && (row[valueCol] ?? "") === "") return;
      const year = periodYear(row[timeCol] ?? "");
      if (year === null) return;
      const indicator = indicatorCol >= 0 ? row[indicatorCol] : ALL_INDICATOR;
      const area = areaCol >= 0 ? row[areaCol] : "";
      let byArea = tree.get(indicator);
      if (!byArea) tree.set(indicator, (byArea = new Map()));
      let byYear = byArea.get(area);
      if (!byYear) byArea.set(area, (byYear = new Map()));
      addTo(byYear, year, 1);
    },

    finish(labels) {
      const indicators: CountsIndicator[] = [];
      const flowYears = new Map<number, number>();
      for (const [code, byArea] of tree) {
        const totals = new Map<number, number>();
        const areas: Record<string, YearCounts> = {};
        let obs = 0;
        for (const area of [...byArea.keys()].sort(compareAreas)) {
          const byYear = byArea.get(area)!;
          for (const [year, n] of byYear) {
            addTo(totals, year, n);
            addTo(flowYears, year, n);
            obs += n;
          }
          if (area !== "") areas[area] = packYears(byYear);
        }
        indicators.push({
          code,
          label: code === ALL_INDICATOR ? "All observations" : labels.get(code) ?? null,
          obs,
          years: packYears(totals),
          areas,
        });
      }
      indicators.sort((a, b) => b.obs - a.obs || (a.code < b.code ? -1 : 1));
      const packed = packYears(flowYears);
      return {
        obs: indicators.reduce((s, i) => s + i.obs, 0),
        first: packed.length ? packed[0] : null,
        last: packed.length ? packed[0] + packed.length - 2 : null,
        indicators,
      };
    },
  };
}

// ── Availability constraints (range mode) ──

export interface ConstraintSummary {
  obs: number;
  first: number | null;
  last: number | null;
  /** Dimension id → codes present. */
  values: Record<string, string[]>;
}

/**
 * The parts of an NSI `availableconstraint` response (SDMX-JSON structure
 * 1.0) this build reads. Upstream-defined shape; fields we do not read are
 * left out.
 */
export interface AvailableConstraintResponse {
  data?: {
    contentConstraints?: Array<{
      annotations?: Array<{ id?: string; title?: string }>;
      cubeRegions?: Array<{
        keyValues?: Array<{
          id: string;
          values?: string[];
          timeRange?: { startPeriod?: { period?: string }; endPeriod?: { period?: string } };
        }>;
      }>;
    }>;
  };
}

/**
 * Read obs count, year envelope and dimension values from a constraint.
 * An exact query with no data answers 200 with obs_count 0 and the sentinel
 * range 9999 → 0001; that reads as empty, not as a range.
 */
export function summarizeConstraint(response: AvailableConstraintResponse): ConstraintSummary {
  const constraint = response.data?.contentConstraints?.[0];
  const obsTitle = constraint?.annotations?.find((a) => a.id === "obs_count")?.title;
  const obs = obsTitle ? Number.parseInt(obsTitle, 10) || 0 : 0;
  let first: number | null = null;
  let last: number | null = null;
  const values: Record<string, string[]> = {};
  for (const region of constraint?.cubeRegions ?? []) {
    for (const kv of region.keyValues ?? []) {
      if (kv.timeRange) {
        first = periodYear(kv.timeRange.startPeriod?.period ?? "");
        last = periodYear(kv.timeRange.endPeriod?.period ?? "");
      } else if (kv.values) {
        values[kv.id] = kv.values;
      }
    }
  }
  if (obs === 0 || first === null || last === null || first > last) {
    return { obs, first: null, last: null, values };
  }
  return { obs, first, last, values };
}
