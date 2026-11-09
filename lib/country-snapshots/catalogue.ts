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
  // For consolidated indicators: the SDMx dimension that varies as the
  // chart's series (e.g. "SEX" produces M/F/Total series). Lets the
  // renderer set legend.concept so bar/lollipop work even on single-
  // country pages.
  seriesConcept?: string;
  // The source indicator ids that were merged into this entry. Useful
  // for diff review and for re-running the consolidator idempotently.
  consolidatedFromIds?: string[];
};

export type Catalogue = {
  generatedAt: string;   // ISO date
  sourceFile: string;
  countries: Country[];
  themes: Theme[];
  indicators: Indicator[];
};

import { catalogue as generated } from "./catalogue.generated";

// The spreadsheet keeps placeholder rows titled "-" (19 in the 2025 sheet):
// planned slots with neither a name nor a source. Nothing about them can be
// shown, so they never reach a page, the TOC or the assistant.
const catalogue: Catalogue = {
  ...generated,
  indicators: generated.indicators.filter((i) => /[A-Za-z0-9]/.test(i.title)),
};

export function getSnapshotCatalogue(): Catalogue {
  return catalogue;
}

export function getCountry(code: string): Country | undefined {
  return catalogue.countries.find((c) => c.code === code);
}

export function getThemeBySlug(slug: string): Theme | undefined {
  return catalogue.themes.find((t) => t.slug === slug);
}

export function getIndicatorsForTheme(themeId: string): Indicator[] {
  return catalogue.indicators
    .filter((i) => i.themeId === themeId)
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
}
