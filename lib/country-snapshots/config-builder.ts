import type { Catalogue, Country, Indicator, Theme } from "./catalogue";
import { chartTypeFor, chartTypeForCompare } from "./chart-types";

export type DashboardItem = {
  type: "chart" | "text";  // "chart" iff renderable with library; "text" otherwise
  chartType?: "line" | "bar";  // resolved from per-(indicator × country) cache
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

    let chartType: "line" | "bar" | undefined;
    if (dataUrl) {
      const decision =
        codes.length === 1
          ? chartTypeFor(i.id, codes[0])
          : chartTypeForCompare(i.id, codes);
      // "empty" or "error" from the cache → treat as text (no useful chart).
      if (decision === "line" || decision === "bar") chartType = decision;
    }

    const type: DashboardItem["type"] = chartType ? "chart" : "text";

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
