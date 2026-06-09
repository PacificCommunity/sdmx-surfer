import type { Catalogue, Country, Indicator, Theme } from "./catalogue";
import { chartTypeFor, chartTypeForCompare } from "./chart-types";

export type DashboardItem = {
  type: "chart" | "value" | "text";  // "chart"/"value" for library; "text" for placeholders
  chartType?: "line" | "bar" | "lollipop";  // when type === "chart"
  id: string;          // catalogue indicator id (e.g. "II.4"), also used as a stable in-page anchor
  title: string;
  dataUrl?: string;    // template URL with country code(s) substituted
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

  const items: DashboardItem[] = indicators.map((i) => {
    const dataUrl = i.apiUrlTemplate
      ? resolveUrl(i.apiUrlTemplate, codes)
      : undefined;

    // Map the curator's rendering intent to a library visual.
    //   TEXT  → text placeholder (no data fetch)
    //   TABLE → "value" (single-country KPI) or "bar" (compare, lets bars
    //           group across countries on the GEO axis)
    //   CHART → "line" by default; "bar" only in compare mode
    //   MAP   → fall back to "value"/"line" for v1 (no geojson plumbing yet)
    let type: DashboardItem["type"] = "text";
    let chartType: "line" | "bar" | undefined;

    if (dataUrl) {
      const cacheDecision =
        codes.length === 1
          ? chartTypeFor(i.id, codes[0])
          : chartTypeForCompare(i.id, codes);
      const hasData = cacheDecision === "line" || cacheDecision === "bar";

      if (!hasData) {
        type = "text";
      } else if (i.rendering === "TABLE" || i.rendering === "MAP") {
        // Single-country: KPI card. Compare: bar across countries (GEO is
        // the varying dimension so the library accepts bar there).
        if (codes.length === 1) {
          type = "value";
        } else {
          type = "chart";
          chartType = "bar";
        }
      } else if (i.rendering === "CHART") {
        // Single-country: with ≥3 time points a line reads as a proper
        // trend. With 1-2 points a line over-implies continuity, so we
        // fall back to a KPI value — until the consolidation pass lets
        // us emit one chart with multiple series (M/F/Total etc.) where
        // lollipop becomes a valid stratified visual.
        if (codes.length === 1 && cacheDecision === "bar") {
          type = "value";
        } else if (codes.length === 1) {
          type = "chart";
          chartType = "line";
        } else {
          type = "chart";
          chartType = cacheDecision === "bar" ? "bar" : "line";
        }
      } else {
        // rendering === "TEXT" but the indicator unexpectedly has a data
        // URL — still surface it as a value rather than dropping.
        type = "value";
      }
    }

    return {
      type,
      chartType,
      id: i.id,
      title: i.title,
      rendering: i.rendering,
      dataUrl,
      source: i.dataflow ? { dataflow: i.dataflow, visUrl: i.visUrl } : undefined,
      notes: i.notes,
    };
  });

  return { countries, theme: args.theme, items };
}
