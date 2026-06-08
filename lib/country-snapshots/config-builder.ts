import type { Catalogue, Country, Indicator, Theme } from "./catalogue";

export type DashboardItem = {
  type: "chart" | "table" | "text";
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
    const type: DashboardItem["type"] =
      i.rendering === "CHART"
        ? "chart"
        : i.rendering === "TABLE"
          ? "table"
          : "text";
    return {
      type,
      id: i.id,
      title: i.title,
      rendering: i.rendering,
      dataUrl: i.apiUrlTemplate ? resolveUrl(i.apiUrlTemplate, codes) : undefined,
      source: i.dataflow ? { dataflow: i.dataflow, visUrl: i.visUrl } : undefined,
      notes: i.notes,
    };
  });

  return { countries, theme: args.theme, items };
}
