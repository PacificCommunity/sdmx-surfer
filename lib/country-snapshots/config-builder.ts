import type { Catalogue, Country, Indicator, Theme } from "./catalogue";
import { LINE_THRESHOLD, timePointsFor } from "./chart-types";
import { geoConceptForDataflow } from "./dataflow-dimensions";

export type DashboardItem = {
  type: "chart" | "value" | "table" | "text"; // "table" → our own pivot renderer
  chartType?: "line" | "bar"; // when type === "chart"
  legendConcept?: string; // chart series dim, when one varies (GEO_PICT, SEX, …)
  seriesConcept?: string; // the indicator's stratifier identity (for table pivots)
  // On multi-country pages: selected countries with NO data for this
  // indicator. Rendered as a per-item note so partially-covered compares
  // don't silently drop countries.
  missingCountries?: string[];
  id: string; // catalogue indicator id (e.g. "II.4"), also a stable in-page anchor
  title: string;
  dataUrl?: string; // template URL with country code(s) substituted
  rendering: Indicator["rendering"];
  source?: { dataflow: string; visUrl?: string };
  notes?: string;
};

export type SnapshotConfig = {
  countries: Country[];
  theme: Theme;
  items: DashboardItem[];
};

function resolveUrl(template: string, codes: string[]): string {
  return template.replace("[TAG_GEO]", codes.join("+"));
}

// Human labels for the stratifier codes the consolidator produces.
const STRATUM_LABELS: Record<string, string> = {
  _T: "Total",
  M: "Male",
  F: "Female",
  U: "Urban",
  R: "Rural",
};

function stratumLabel(code: string): string {
  return STRATUM_LABELS[code] ?? code;
}

/**
 * For a consolidated indicator's URL TEMPLATE (still carrying [TAG_GEO]),
 * find the stratifier segment the consolidator joined with "+" (e.g.
 * "M+F" for SEX) and return its values plus a function producing the
 * template narrowed to one value. Returns null when there is no such
 * segment.
 */
function splitStrata(
  template: string,
): { values: string[]; narrowTo: (v: string) => string } | null {
  const m = template.match(/^(.*\/[A-Z]+,[^,]+,\/)([^?]+)(\?.*)?$/);
  if (!m) return null;
  const [, prefix, key, qs = ""] = m;
  const segments = key.split(".");
  const idx = segments.findIndex(
    (s) => s.includes("+") && !s.includes("[TAG_GEO]"),
  );
  if (idx === -1) return null;
  const values = segments[idx].split("+");
  if (values.length < 2) return null;
  return {
    values,
    narrowTo: (v: string) => {
      const next = segments.slice();
      next[idx] = v;
      return prefix + next.join(".") + qs;
    },
  };
}

// ---------------------------------------------------------------------------
// The visual decision engine.
//
// The rendering library imposes exactly one structural rule:
//
//   A CHART CAN SERIES ON AT MOST ONE VARYING NON-TIME DIMENSION.
//
//   - bar (and other column-likes) REQUIRE that one varying dimension;
//   - line tolerates zero (a single series) or one (legend.concept);
//   - two or more varying dimensions cannot be drawn in one chart at all —
//     the library merges the extra dimension's observations into the same
//     series, producing the "see-saw" zig-zag.
//
// So instead of enumerating page-type cases (single / compare / regional ×
// plain / consolidated × dense / sparse), we MODEL THE QUERY: which
// dimensions actually vary in the response, and how long the series is.
// Both are computable up front — GEO varies iff at least two selected
// countries have data (chart-types cache), the stratifier varies iff the
// consolidated URL carries a multi-value segment, and series length comes
// from the same cache.
// ---------------------------------------------------------------------------

type VaryingDim = { concept: string; role: "geo" | "stratum" };

type VisualDecision =
  | { kind: "chart"; chartType: "line" | "bar"; legendConcept?: string }
  | { kind: "value" }
  | { kind: "table" }
  | { kind: "text" }
  | { kind: "split" };

function decideVisual(args: {
  varying: VaryingDim[];
  timePoints: number; // max per-series time points across countries with data
  renderingHint: Indicator["rendering"];
}): VisualDecision {
  const { varying, timePoints, renderingHint } = args;

  if (timePoints <= 0) return { kind: "text" };

  if (varying.length >= 2) {
    // More than one varying dimension → no single chart can show this.
    // The caller splits on the stratifier (GEO stays in-chart because
    // these pages exist to compare countries) and re-decides per part.
    return { kind: "split" };
  }

  if (varying.length === 1) {
    const legendConcept = varying[0].concept;
    // Long series read as trends; sparse series read better as grouped
    // bars on the one varying dimension. Note: the cache tells us the
    // dimension varies ACROSS THE QUERY; a country might still return
    // only one stratum value at runtime. Line handles that gracefully;
    // bar would throw and be caught by the per-item error boundary —
    // an acceptable residual for genuinely sparse, partially-reported
    // indicators.
    return timePoints >= LINE_THRESHOLD
      ? { kind: "chart", chartType: "line", legendConcept }
      : { kind: "chart", chartType: "bar", legendConcept };
  }

  // Nothing varies but time.
  if (timePoints >= LINE_THRESHOLD) {
    return { kind: "chart", chartType: "line" };
  }
  // 1-2 points: a chart over-implies continuity. The curator's TABLE hint
  // picks the pivot table; everything else becomes a KPI value.
  return renderingHint === "TABLE" ? { kind: "table" } : { kind: "value" };
}

export function buildSnapshotConfig(args: {
  country: Country | Country[];
  theme: Theme;
  catalogue: Catalogue;
}): SnapshotConfig {
  const countries = Array.isArray(args.country) ? args.country : [args.country];
  const codes = countries.map((c) => c.code);
  const indicators = args.catalogue.indicators
    .filter((i) => i.themeId === args.theme.id)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));

  const items: DashboardItem[] = indicators.flatMap((i) => {
    if (!i.apiUrlTemplate) {
      return [bareItem(i, undefined, { kind: "text" })];
    }

    // --- Model the query ---------------------------------------------------
    // Countries that actually have data, per the probe cache. Unknown
    // (never-probed) pairs count as having data with a long series — the
    // line chart that follows is the safest guess.
    const perCountryPoints = codes.map((c) => ({
      code: c,
      points: timePointsFor(i.id, c),
    }));
    const withData = perCountryPoints.filter(
      (e) => e.points === null || e.points > 0,
    );
    const timePoints = withData.length
      ? Math.max(...withData.map((e) => e.points ?? Number.MAX_SAFE_INTEGER))
      : 0;

    const strata = splitStrata(i.apiUrlTemplate);
    const varying: VaryingDim[] = [];
    if (withData.length > 1) {
      varying.push({
        concept: geoConceptForDataflow(i.dataflow),
        role: "geo",
      });
    }
    if (strata && i.seriesConcept) {
      varying.push({ concept: i.seriesConcept, role: "stratum" });
    }

    // On multi-country pages, name the countries that contribute nothing —
    // a compare that silently drops a country reads as a bug.
    const missingCountries =
      codes.length > 1 && withData.length > 0
        ? perCountryPoints
            .filter((e) => e.points === 0)
            .map(
              (e) =>
                countries.find((c) => c.code === e.code)?.name ?? e.code,
            )
        : undefined;

    // A degraded multi-country chart (only one country has data) carries no
    // varying geo dim, but the line should still SAY which country it shows.
    // A single-valued legend names the series — safe for line, and bar never
    // reaches this state (sparse single-data routes to value/table).
    const nameTheLonelyLine = (d: VisualDecision): VisualDecision =>
      d.kind === "chart" &&
      d.chartType === "line" &&
      !d.legendConcept &&
      codes.length > 1
        ? { ...d, legendConcept: geoConceptForDataflow(i.dataflow) }
        : d;

    // --- Decide ------------------------------------------------------------
    const decision = nameTheLonelyLine(
      decideVisual({
        varying,
        timePoints,
        renderingHint: i.rendering,
      }),
    );

    if (decision.kind !== "split") {
      return [
        {
          ...bareItem(i, resolveUrl(i.apiUrlTemplate, codes), decision),
          missingCountries,
        },
      ];
    }

    // Split on the stratifier: one item per stratum value, each re-decided
    // with the stratifier fixed (so only GEO — if anything — varies).
    return strata!.values.map((v) => {
      const subDecision = nameTheLonelyLine(
        decideVisual({
          varying: varying.filter((d) => d.role !== "stratum"),
          timePoints,
          renderingHint: i.rendering,
        }),
      );
      // With the stratifier fixed at most one dim remains, so a second
      // split is impossible; the guard is for the type system.
      const resolved =
        subDecision.kind === "split"
          ? ({ kind: "text" } as const)
          : subDecision;
      return {
        ...bareItem(
          { ...i, seriesConcept: undefined },
          resolveUrl(strata!.narrowTo(v), codes),
          resolved,
        ),
        id: `${i.id}-${v}`,
        title: `${i.title} — ${stratumLabel(v)}`,
        missingCountries,
      };
    });
  });

  return { countries, theme: args.theme, items };
}

/**
 * Translate a SnapshotConfig into the NATIVE dashboard config shape that
 * the main Surfer builder loads, previews, and lets the agent iterate on
 * (lib/types.ts SDMXDashboardConfig). Used by the fork-to-Surfer handshake:
 * seeding the session with our internal SnapshotConfig shape crashes the
 * builder preview, which only understands the library schema.
 *
 *   chart → line/bar visual with the item's legend concept
 *   value → value visual (latest observation)
 *   table → value visual (no native table type)
 *   text  → omitted (nothing to render; the catalogue gap is noted in the
 *           seeded chat message instead)
 */
export function toNativeDashboardConfig(config: SnapshotConfig): {
  id: string;
  rows: Array<{ columns: Array<Record<string, unknown>> }>;
  header: { title: { text: string } };
} {
  const visuals = config.items
    .filter((item) => item.type !== "text" && item.dataUrl)
    .map((item) => {
      if (item.type === "chart") {
        return {
          id: item.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
          type: item.chartType ?? "line",
          title: { text: item.title },
          data: item.dataUrl!,
          xAxisConcept: "TIME_PERIOD",
          yAxisConcept: "OBS_VALUE",
          ...(item.legendConcept
            ? {
                legend: {
                  concept: item.legendConcept,
                  location: "bottom" as const,
                },
              }
            : {}),
        };
      }
      // value + table → KPI value visual
      return {
        id: item.id.replace(/[^a-zA-Z0-9_-]/g, "_"),
        type: "value" as const,
        title: { text: item.title },
        data: item.dataUrl!,
        xAxisConcept: "OBS_VALUE",
      };
    });

  // Two visuals per row, matching the builder's usual layout density.
  const rows: Array<{ columns: Array<Record<string, unknown>> }> = [];
  for (let k = 0; k < visuals.length; k += 2) {
    rows.push({ columns: visuals.slice(k, k + 2) });
  }

  const countryNames = config.countries.map((c) => c.name).join(" vs ");
  return {
    id: `snapshot-fork-${config.theme.slug}`,
    rows,
    header: {
      title: { text: `${countryNames} — ${config.theme.title}` },
    },
  };
}

function bareItem(
  i: Indicator,
  dataUrl: string | undefined,
  decision: Exclude<VisualDecision, { kind: "split" }>,
): DashboardItem {
  return {
    type: decision.kind,
    chartType: decision.kind === "chart" ? decision.chartType : undefined,
    legendConcept:
      decision.kind === "chart" ? decision.legendConcept : undefined,
    seriesConcept: i.seriesConcept,
    id: i.id,
    title: i.title,
    rendering: i.rendering,
    dataUrl,
    source: i.dataflow ? { dataflow: i.dataflow, visUrl: i.visUrl } : undefined,
    notes: i.notes,
  };
}
