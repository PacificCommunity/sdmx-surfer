/**
 * Read-side logic over the coverage artifact: card summaries, the explore
 * detail payloads, and the agent's `get_indicator_coverage` answers. Pure;
 * the artifact is passed in (see `lib/coverage/load.ts`).
 */

import { ALL_INDICATOR } from "@/lib/coverage/roles";
import type {
  AreaRange,
  CountsIndicator,
  CoverageArtifact,
  FlowCoverage,
  RangeIndicator,
  YearCounts,
} from "@/lib/coverage/types";

// ── Year helpers ──

export interface YearWindow {
  from?: number;
  to?: number;
}

/** Years with data inside the window, with their counts, in ascending order. */
export function unpackYears(counts: YearCounts, w: YearWindow = {}): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 1; i < counts.length; i++) {
    const year = counts[0] + i - 1;
    if (counts[i] > 0 && (w.from === undefined || year >= w.from) && (w.to === undefined || year <= w.to)) {
      out.push([year, counts[i]]);
    }
  }
  return out;
}

/** `[2000, 2001, 2002, 2005]` → `"2000-2002,2005"`. */
export function yearRuns(years: number[]): string {
  const runs: string[] = [];
  let start = years[0];
  for (let i = 1; i <= years.length; i++) {
    if (i < years.length && years[i] === years[i - 1] + 1) continue;
    const end = years[i - 1];
    runs.push(start === end ? String(start) : start + "-" + end);
    start = years[i];
  }
  return runs.join(",");
}

/**
 * Columns for a year grid: one per year while the span fits in `maxColumns`,
 * otherwise bins of 2, 5, 10 or 20 years aligned to multiples of the width
 * (1950–1954, 1955–1959, ...), so a 1950–2050 projection stays readable.
 */
export function yearBins(first: number, last: number, maxColumns = 40): Array<{ from: number; to: number }> {
  const width =
    [1, 2, 5, 10, 20].find((w) => Math.floor(last / w) - Math.floor(first / w) + 1 <= maxColumns) ?? 50;
  const bins: Array<{ from: number; to: number }> = [];
  for (let start = Math.floor(first / width) * width; start <= last; start += width) {
    bins.push({ from: Math.max(start, first), to: Math.min(start + width - 1, last) });
  }
  return bins;
}

function overlaps(first: number | undefined | null, last: number | undefined | null, w: YearWindow): boolean {
  if (first == null || last == null) return true;
  return (w.to === undefined || first <= w.to) && (w.from === undefined || last >= w.from);
}

// ── Summaries ──

export interface FlowSummary {
  detail: FlowCoverage["detail"];
  indicators: number;
  areas: number;
  first: number | null;
  last: number | null;
  obs: number;
}

/** Catalogue facts for one flow: indicator and area counts, year envelope. */
export function summarizeFlow(flow: FlowCoverage): FlowSummary {
  const areas = new Set<string>();
  for (const ind of flow.indicators) for (const a of Object.keys(ind.areas)) areas.add(a);
  return {
    detail: flow.detail,
    indicators: flow.indicators.filter((i) => i.code !== ALL_INDICATOR).length,
    areas: areas.size,
    first: flow.first,
    last: flow.last,
    obs: flow.obs,
  };
}

/** `"560 indicators · 25 areas · 1980–2026"`; parts with nothing to say are left out. */
export function formatFlowSummary(s: FlowSummary): string {
  const parts: string[] = [];
  if (s.indicators > 0) parts.push(s.indicators + (s.indicators === 1 ? " indicator" : " indicators"));
  if (s.areas > 0) parts.push(s.areas + (s.areas === 1 ? " area" : " areas"));
  if (s.first !== null && s.last !== null) {
    parts.push(s.first === s.last ? String(s.first) : s.first + "–" + s.last);
  }
  return parts.join(" · ");
}

export interface IndicatorListItem {
  code: string;
  label: string | null;
  obs: number;
  first: number | null;
  last: number | null;
  areas: number;
}

function indicatorSpan(ind: CountsIndicator | RangeIndicator): { first: number | null; last: number | null } {
  if ("years" in ind) {
    return ind.years.length
      ? { first: ind.years[0], last: ind.years[0] + ind.years.length - 2 }
      : { first: null, last: null };
  }
  return { first: ind.first, last: ind.last };
}

export function listIndicators(flow: FlowCoverage): IndicatorListItem[] {
  return flow.indicators.map((ind) => ({
    code: ind.code,
    label: ind.label,
    obs: ind.obs,
    ...indicatorSpan(ind),
    areas: Object.keys(ind.areas).length,
  }));
}

/** Everything the explore page needs for one indicator's area × year grid. */
export type IndicatorGrid =
  | {
      detail: "counts";
      code: string;
      label: string | null;
      obs: number;
      years: YearCounts;
      areas: Array<{ code: string; label: string | null; obs: number; years: YearCounts }>;
    }
  | {
      detail: "range";
      code: string;
      label: string | null;
      obs: number;
      first: number | null;
      last: number | null;
      areas: Array<{ code: string; label: string | null } & AreaRange>;
    };

export function indicatorGrid(
  flow: FlowCoverage,
  code: string,
  areaLabels: Record<string, string>,
): IndicatorGrid | null {
  if (flow.detail === "counts") {
    const ind = flow.indicators.find((i) => i.code === code);
    if (!ind) return null;
    return {
      detail: "counts",
      code: ind.code,
      label: ind.label,
      obs: ind.obs,
      years: ind.years,
      areas: Object.entries(ind.areas).map(([area, years]) => ({
        code: area,
        label: areaLabels[area] ?? null,
        obs: years.slice(1).reduce((s, n) => s + n, 0),
        years,
      })),
    };
  }
  const ind = flow.indicators.find((i) => i.code === code);
  if (!ind) return null;
  return {
    detail: "range",
    code: ind.code,
    label: ind.label,
    obs: ind.obs,
    first: ind.first,
    last: ind.last,
    areas: Object.entries(ind.areas).map(([area, r]) => ({
      code: area,
      label: areaLabels[area] ?? null,
      ...r,
    })),
  };
}

// ── Inverted index ──

/** Upper-cased indicator code → dataflows carrying it, biggest first. */
export function buildIndicatorIndex(artifact: CoverageArtifact): Map<string, string[]> {
  const hits = new Map<string, Array<{ flow: string; obs: number }>>();
  for (const [flowId, flow] of Object.entries(artifact.flows)) {
    for (const ind of flow.indicators) {
      if (ind.code === ALL_INDICATOR) continue;
      const key = ind.code.toUpperCase();
      let list = hits.get(key);
      if (!list) hits.set(key, (list = []));
      list.push({ flow: flowId, obs: ind.obs });
    }
  }
  const index = new Map<string, string[]>();
  for (const [key, list] of hits) {
    index.set(key, list.sort((a, b) => b.obs - a.obs).map((h) => h.flow));
  }
  return index;
}

// ── Agent tool ──

export interface CoverageQuery {
  dataflow_id?: string;
  indicator?: string;
  country?: string;
  year_from?: number;
  year_to?: number;
}

export interface CoverageSource {
  artifact: CoverageArtifact;
  indicatorIndex: ReadonlyMap<string, string[]>;
  nameOf?: (dataflowId: string) => string;
}

/** Hard caps that keep one tool result to a few KB of model context. */
export const COVERAGE_LIMITS = {
  indicatorsPerFlow: 40,
  flowsPerIndicator: 15,
  flowsWithAreaDetail: 4,
  flowsPerCountry: 40,
  candidates: 12,
} as const;

/** Area code → `"2000-2005,2010 (12)"`: years with data, then observation count. */
type AreaCoverage = Record<string, string>;

interface AreaSlice {
  obs: number;
  first: number | null;
  last: number | null;
  areas: AreaCoverage;
}

/** One indicator in one flow, restricted to a window and optionally one area. */
function sliceIndicator(
  ind: CountsIndicator | RangeIndicator,
  w: YearWindow,
  area: string | undefined,
): AreaSlice {
  const areas: AreaCoverage = {};
  let obs = 0;
  let first: number | null = null;
  let last: number | null = null;
  const widen = (a: number | null | undefined, b: number | null | undefined) => {
    if (a != null) first = first === null ? a : Math.min(first, a);
    if (b != null) last = last === null ? b : Math.max(last, b);
  };

  if ("years" in ind) {
    const entries = Object.keys(ind.areas).length
      ? Object.entries(ind.areas)
      : [["", ind.years] as [string, YearCounts]];
    for (const [code, counts] of entries) {
      if (area !== undefined && code !== area) continue;
      const years = unpackYears(counts, w);
      if (!years.length) continue;
      const n = years.reduce((s, [, c]) => s + c, 0);
      obs += n;
      widen(years[0][0], years[years.length - 1][0]);
      if (code) areas[code] = yearRuns(years.map(([y]) => y)) + " (" + n + ")";
    }
    return { obs, first, last, areas };
  }

  const entries = Object.entries(ind.areas);
  for (const [code, r] of entries) {
    if (area !== undefined && code !== area) continue;
    if (!overlaps(r.first, r.last, w)) continue;
    obs += r.obs ?? 0;
    widen(r.first, r.last);
    areas[code] =
      (r.first != null && r.last != null ? r.first + "-" + r.last : "years unknown") +
      (r.obs != null ? " (" + r.obs + ")" : "");
  }
  if (!entries.length && overlaps(ind.first, ind.last, w) && area === undefined) {
    obs = ind.obs;
    widen(ind.first, ind.last);
  }
  // Pairs over the call budget carry no per-area counts; the indicator total
  // is still right when no single area was asked for.
  if (obs === 0 && area === undefined && Object.keys(areas).length) obs = ind.obs;
  return { obs, first, last, areas };
}

function span(first: number | null, last: number | null): string {
  if (first === null || last === null) return "unknown";
  return first === last ? String(first) : first + "-" + last;
}

const RANGE_NOTE =
  "detail=range: a very large flow; areas show first-last year and observation counts " +
  "from availability constraints, not per-year counts, so gaps inside a range are possible.";

/** Resolve "fj", "FJ" or "Fiji" to an area code present in the artifact. */
export function resolveArea(input: string, areaLabels: Record<string, string>): string | null {
  const trimmed = input.trim();
  const upper = trimmed.toUpperCase();
  if (upper in areaLabels) return upper;
  const lower = trimmed.toLowerCase();
  const entries = Object.entries(areaLabels);
  const exact = entries.find(([, label]) => label.toLowerCase() === lower);
  if (exact) return exact[0];
  const partial = entries.filter(([, label]) => label.toLowerCase().includes(lower));
  return partial.length === 1 ? partial[0][0] : null;
}

/**
 * Answer a `get_indicator_coverage` call. Shapes:
 *  - dataflow_id + indicator: that indicator, per area;
 *  - dataflow_id (± country): the flow's indicators, biggest first;
 *  - indicator (± country): every flow carrying the code (inverted index),
 *    per-area detail for the biggest few; an unknown code falls back to a
 *    code/label text search and returns candidates;
 *  - country alone: the flows with data for it.
 * Years are limited to [year_from, year_to] throughout.
 */
export function queryCoverage(q: CoverageQuery, src: CoverageSource): Record<string, unknown> {
  const { artifact, indicatorIndex } = src;
  const nameOf = src.nameOf ?? ((id: string) => id);
  const w: YearWindow = { from: q.year_from, to: q.year_to };

  let area: string | undefined;
  if (q.country) {
    const resolved = resolveArea(q.country, artifact.areaLabels);
    if (!resolved) {
      return {
        error: "Unknown area '" + q.country + "'. Use an SPC area code such as FJ, WS, TO, or an aggregate such as MEL.",
      };
    }
    area = resolved;
  }
  const areaLabel = area ? { area, area_label: artifact.areaLabels[area] ?? null } : {};

  if (q.dataflow_id) {
    const flowId = q.dataflow_id.trim().toUpperCase();
    const flow = artifact.flows[flowId];
    if (!flow) {
      return {
        error: "No coverage for '" + q.dataflow_id + "'. Coverage exists only for SPC dataflows (ids like DF_SDG, DF_POP_PROJ).",
      };
    }
    const header = {
      dataflow_id: flowId,
      name: nameOf(flowId),
      detail: flow.detail,
      indicator_dimension: flow.indicatorDim,
      area_dimension: flow.areaDim,
      ...areaLabel,
      ...(flow.detail === "range" ? { note: RANGE_NOTE } : {}),
    };

    if (q.indicator) {
      const code = q.indicator.trim().toUpperCase();
      const ind = flow.indicators.find((i) => i.code.toUpperCase() === code);
      if (!ind) {
        return {
          ...header,
          error: "Indicator '" + q.indicator + "' not in " + flowId + ".",
          candidates: searchIndicators(q.indicator, artifact, flowId),
        };
      }
      const s = sliceIndicator(ind, w, area);
      return {
        ...header,
        indicator: ind.code,
        label: ind.label,
        obs: s.obs,
        years: span(s.first, s.last),
        areas: s.areas,
      };
    }

    const rows = flow.indicators
      .map((ind) => ({ ind, s: sliceIndicator(ind, w, area) }))
      .filter(({ s }) => s.obs > 0 || Object.keys(s.areas).length > 0);
    return {
      ...header,
      indicators_total: rows.length,
      indicators: rows.slice(0, COVERAGE_LIMITS.indicatorsPerFlow).map(({ ind, s }) => ({
        code: ind.code,
        label: ind.label,
        obs: s.obs,
        years: span(s.first, s.last),
        ...(area
          ? { coverage: s.areas[area] ?? null }
          : { areas: Object.keys(s.areas).length }),
      })),
      ...(rows.length > COVERAGE_LIMITS.indicatorsPerFlow
        ? { truncated: "Showing the " + COVERAGE_LIMITS.indicatorsPerFlow + " biggest; pass indicator= for one." }
        : {}),
    };
  }

  if (q.indicator) {
    const code = q.indicator.trim().toUpperCase();
    const flowIds = indicatorIndex.get(code);
    if (!flowIds) {
      const candidates = searchIndicators(q.indicator, artifact);
      return {
        indicator: q.indicator,
        error: "No dataflow carries indicator code '" + q.indicator + "'.",
        ...(candidates.length
          ? { candidates, hint: "Retry with one of these codes." }
          : {}),
      };
    }
    const flows = flowIds
      .map((flowId) => {
        const flow = artifact.flows[flowId];
        const ind = flow.indicators.find((i) => i.code.toUpperCase() === code)!;
        return { flowId, flow, ind, s: sliceIndicator(ind, w, area) };
      })
      .filter(({ s }) => s.obs > 0 || Object.keys(s.areas).length > 0);
    const shown = flows.slice(0, COVERAGE_LIMITS.flowsPerIndicator);
    return {
      indicator: shown[0]?.ind.code ?? q.indicator,
      label: shown[0]?.ind.label ?? null,
      ...areaLabel,
      dataflows_total: flows.length,
      dataflows: shown.map(({ flowId, flow, s }, i) => ({
        dataflow_id: flowId,
        name: nameOf(flowId),
        detail: flow.detail,
        obs: s.obs,
        years: span(s.first, s.last),
        ...(i < COVERAGE_LIMITS.flowsWithAreaDetail || area
          ? { areas: s.areas }
          : { area_count: Object.keys(s.areas).length }),
      })),
      ...(flows.length === 0
        ? { note: "The code exists but has no data for this area/year filter." }
        : {}),
      ...(flows.length > shown.length || shown.length > COVERAGE_LIMITS.flowsWithAreaDetail
        ? { truncated: "Per-area detail for the biggest flows only; pass dataflow_id for any other." }
        : {}),
    };
  }

  if (area) {
    const flows = Object.entries(artifact.flows)
      .map(([flowId, flow]) => {
        let obs = 0;
        let first: number | null = null;
        let last: number | null = null;
        let indicators = 0;
        for (const ind of flow.indicators) {
          const s = sliceIndicator(ind, w, area);
          if (!Object.keys(s.areas).length) continue;
          indicators++;
          obs += s.obs;
          if (s.first !== null) first = first === null ? s.first : Math.min(first, s.first);
          if (s.last !== null) last = last === null ? s.last : Math.max(last, s.last);
        }
        return { flowId, flow, obs, first, last, indicators };
      })
      .filter((f) => f.indicators > 0)
      .sort((a, b) => b.obs - a.obs);
    return {
      ...areaLabel,
      dataflows_total: flows.length,
      dataflows: flows.slice(0, COVERAGE_LIMITS.flowsPerCountry).map((f) => ({
        dataflow_id: f.flowId,
        name: nameOf(f.flowId),
        detail: f.flow.detail,
        indicators: f.indicators,
        obs: f.obs,
        years: span(f.first, f.last),
      })),
    };
  }

  return { error: "Pass at least one of dataflow_id, indicator or country." };
}

/** Indicators whose code or label contains the text, across flows or in one flow. */
export function searchIndicators(
  text: string,
  artifact: CoverageArtifact,
  onlyFlow?: string,
): Array<{ indicator: string; label: string | null; dataflows: string[] }> {
  const needle = text.trim().toLowerCase();
  if (!needle) return [];
  const found = new Map<string, { label: string | null; flows: string[]; obs: number }>();
  for (const [flowId, flow] of Object.entries(artifact.flows)) {
    if (onlyFlow && flowId !== onlyFlow) continue;
    for (const ind of flow.indicators) {
      if (ind.code === ALL_INDICATOR) continue;
      const hay = (ind.code + " " + (ind.label ?? "")).toLowerCase();
      if (!hay.includes(needle)) continue;
      const hit = found.get(ind.code) ?? { label: ind.label, flows: [], obs: 0 };
      hit.flows.push(flowId);
      hit.obs += ind.obs;
      found.set(ind.code, hit);
    }
  }
  return [...found.entries()]
    .sort((a, b) => b[1].obs - a[1].obs)
    .slice(0, COVERAGE_LIMITS.candidates)
    .map(([code, hit]) => ({ indicator: code, label: hit.label, dataflows: hit.flows.slice(0, 6) }));
}
