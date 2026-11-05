/**
 * Shape of `models/dataflow-coverage.json`, the indicator × area × year
 * coverage of every SPC dataflow, built by `scripts/build-coverage.ts`.
 *
 * Kept apart from `models/dataflow-index.json` because `lib/embeddings.ts`
 * loads the index whole for semantic search; coverage is only needed by the
 * explore detail page and the agent's `get_indicator_coverage` tool.
 */

/** Bumping this invalidates every flow signature, forcing a full rebuild. */
export const COVERAGE_FORMAT_VERSION = 1;

/**
 * Observation counts per calendar year, packed densely:
 * `[firstYear, countInFirstYear, countInFirstYear+1, ...]`. Gaps are zeros.
 * Sub-annual periods (`2019-Q1`, `2019-03`) count towards their year.
 */
export type YearCounts = number[];

/** How the indicator dimension of a flow was chosen; see `lib/coverage/roles.ts`. */
export type IndicatorRule = "indicator" | "series" | "fallback" | "none";

/** Per-area envelope in range mode. Fields are absent when not fetched. */
export interface AreaRange {
  obs?: number;
  first?: number;
  last?: number;
}

/** Counts mode: exact counts from the full SDMX-CSV download. */
export interface CountsIndicator {
  code: string;
  label: string | null;
  obs: number;
  /** Totals across areas (and all other dimensions) per year. */
  years: YearCounts;
  /** Area code → per-year counts. Empty when the flow has no area dimension. */
  areas: Record<string, YearCounts>;
}

/** Range mode: envelopes from availability constraints, no per-year counts. */
export interface RangeIndicator {
  code: string;
  label: string | null;
  obs: number;
  first: number | null;
  last: number | null;
  areas: Record<string, AreaRange>;
}

interface FlowCoverageBase {
  /** Hash of the index facts this entry was built from; unchanged → skipped. */
  signature: string;
  indicatorDim: string | null;
  indicatorRule: IndicatorRule;
  areaDim: string | null;
  obs: number;
  first: number | null;
  last: number | null;
}

export interface CountsFlowCoverage extends FlowCoverageBase {
  detail: "counts";
  indicators: CountsIndicator[];
}

export interface RangeFlowCoverage extends FlowCoverageBase {
  detail: "range";
  indicators: RangeIndicator[];
}

export type FlowCoverage = CountsFlowCoverage | RangeFlowCoverage;

export interface CoverageArtifact {
  version: number;
  /** Last content change, not last run: an idle refresh leaves the file byte-identical. */
  createdAt: string;
  source: string;
  /** Index obsCount above which a flow is built in range mode. */
  rangeThreshold: number;
  /** Area code → English label, shared across flows (the geo codelists agree on codes). */
  areaLabels: Record<string, string>;
  flows: Record<string, FlowCoverage>;
}
