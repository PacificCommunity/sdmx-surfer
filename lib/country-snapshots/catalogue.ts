export type Region = "POL" | "MEL" | "MIC";
export type Rendering = "TABLE" | "CHART" | "MAP" | "TEXT";

export type Country = {
  code: string;
  name: string;
  region: Region;
  mfatRelevant: boolean;
};

export type Theme = {
  id: string;       // Roman numeral from the spreadsheet, e.g. "II"
  slug: string;     // kebab-case lower, used in URLs, e.g. "health"
  title: string;
  order: number;
};

export type Indicator = {
  id: string;             // e.g. "II.4"
  themeId: string;
  title: string;
  mfatName?: string;
  rendering: Rendering;
  dataflow?: string;
  apiUrlTemplate?: string;  // contains exactly one [TAG_GEO]
  visUrl?: string;
  notes?: string;
};

export type Catalogue = {
  generatedAt: string;   // ISO date
  sourceFile: string;
  countries: Country[];
  themes: Theme[];
  indicators: Indicator[];
};

import { catalogue as generated } from "./catalogue.generated";

export function getSnapshotCatalogue(): Catalogue {
  return generated;
}

export function getCountry(code: string): Country | undefined {
  return generated.countries.find((c) => c.code === code);
}

export function getThemeBySlug(slug: string): Theme | undefined {
  return generated.themes.find((t) => t.slug === slug);
}

export function getIndicatorsForTheme(themeId: string): Indicator[] {
  return generated.indicators
    .filter((i) => i.themeId === themeId)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}
