/**
 * Which dimension of a dataflow names the area, and which names the indicator.
 *
 * SPC flows mostly say `GEO_PICT` and `INDICATOR`. The SDG family (DF_SDG and
 * DF_SDG_01..17) follows the global SDMX-SDG DSD instead: `REF_AREA` on
 * SPC:CL_COM_GEO_AREA and `SERIES` on IAEG-SDGs:CL_SERIES. The area codes
 * coincide (ISO alpha-2 plus aggregates such as MEL, MIC, POL, _T), and
 * DF_NMDI's INDICATOR codes are SDG series codes, so one code links across
 * both families.
 *
 * Area rule, in order:
 *   1. a dimension called GEO_PICT or REF_AREA;
 *   2. otherwise the first dimension coded on an SPC geo codelist
 *      (CL_COM_GEO_PICT*, CL_COM_GEO_AREA) — DF_TRADE_FOOD's IMPORTER;
 *   3. otherwise none, and coverage is indicator × year only
 *      (DF_SAM_CATCH, DF_COMMODITY_PRICES, DF_CURRENCIES).
 *
 * Indicator rule, in order:
 *   1. INDICATOR ("indicator"), else SERIES ("series");
 *   2. otherwise ("fallback") among the dimensions that are not FREQ, time,
 *      the area, another geo-coded dimension (counterparts, exporters) or a
 *      generic breakdown (SEX, AGE, URBANIZATION, ...): the first whose id or
 *      codelist mentions INDICATOR, else the first in key order. That gives
 *      DF_AGRICULTURAL_PRODUCTION → AGRICULTURE_PRODUCTION_ITEM,
 *      DF_POWER_GEN → ENERGY_SOURCE, DF_ENV_TAXES → ENV_TAXES,
 *      DF_TOURISM_ARRIVALS → VISITOR_DURATION_CAT,
 *      DF_METEO_MONITOR_NET → METEO_STATION_TYPE and
 *      DF_CLIMATE_CHANGE → CLIMATE_CHANGE_INDICATORS;
 *   3. otherwise "none": a single pseudo-indicator `_ALL` carries the
 *      area × year coverage of the whole flow.
 */

import type { IndicatorRule } from "@/lib/coverage/types";

export interface DimensionRef {
  id: string;
  codelist: string | null;
  type?: string;
}

export interface FlowRoles {
  areaDim: string | null;
  indicatorDim: string | null;
  indicatorRule: IndicatorRule;
}

/** Code of the pseudo-indicator used when a flow has no indicator-like dimension. */
export const ALL_INDICATOR = "_ALL";

const AREA_IDS = ["GEO_PICT", "REF_AREA"];
const GEO_CODELIST = /^SPC:CL_COM_GEO_(PICT|AREA)\b/;
const NOT_INDICATOR: Record<string, true> = {
  FREQ: true,
  TIME_PERIOD: true,
  SEX: true,
  AGE: true,
  URBANIZATION: true,
  URBANISATION: true,
  DISABILITY: true,
  DISABILITY_STATUS: true,
  REPORTING_TYPE: true,
  UNIT_MEASURE: true,
  UNIT_MULT: true,
};

function isGeoCoded(d: DimensionRef): boolean {
  return d.codelist !== null && GEO_CODELIST.test(d.codelist);
}

export function detectRoles(dimensions: DimensionRef[]): FlowRoles {
  const dims = dimensions.filter((d) => d.type !== "TimeDimension" && d.id !== "TIME_PERIOD");

  const areaDim =
    AREA_IDS.map((id) => dims.find((d) => d.id === id)).find(Boolean)?.id ??
    dims.find(isGeoCoded)?.id ??
    null;

  if (dims.some((d) => d.id === "INDICATOR")) {
    return { areaDim, indicatorDim: "INDICATOR", indicatorRule: "indicator" };
  }
  if (dims.some((d) => d.id === "SERIES")) {
    return { areaDim, indicatorDim: "SERIES", indicatorRule: "series" };
  }

  const candidates = dims.filter(
    (d) => d.id !== areaDim && !isGeoCoded(d) && !NOT_INDICATOR[d.id],
  );
  const named = candidates.find(
    (d) => d.id.includes("INDICATOR") || (d.codelist ?? "").includes("INDICATOR"),
  );
  const pick = named ?? candidates[0];
  if (pick) return { areaDim, indicatorDim: pick.id, indicatorRule: "fallback" };
  return { areaDim, indicatorDim: null, indicatorRule: "none" };
}

// ── Areas ──

export type AreaKind = "country" | "subnational" | "aggregate";

/**
 * ISO alpha-2 codes are countries and territories; `FJ-C`, `VU-101` are
 * sub-national units; anything else (MEL, MIC, POL, _T, _TXPNG, _UPICT) is a
 * regional aggregate. Aggregates are kept but listed after real areas.
 */
export function areaKind(code: string): AreaKind {
  if (/^[A-Z]{2}$/.test(code)) return "country";
  if (/^[A-Z]{2}-/.test(code)) return "subnational";
  return "aggregate";
}

const KIND_RANK: Record<AreaKind, number> = { country: 0, subnational: 1, aggregate: 2 };

export function compareAreas(a: string, b: string): number {
  const rank = KIND_RANK[areaKind(a)] - KIND_RANK[areaKind(b)];
  if (rank !== 0) return rank;
  return a < b ? -1 : a > b ? 1 : 0;
}

/** Calendar year of an SDMX period (`2019`, `2019-Q1`, `2019-03-31`), or null. */
export function periodYear(period: string): number | null {
  const m = /^(\d{4})/.exec(period);
  return m ? Number(m[1]) : null;
}

/** `SPC:CL_COM_GEO_PICT(2.0)` → its REST path parts. */
export function parseCodelistRef(
  ref: string,
): { agency: string; id: string; version: string } | null {
  const m = /^([^:]+):([^(]+)\(([^)]+)\)$/.exec(ref);
  return m ? { agency: m[1], id: m[2], version: m[3] } : null;
}
