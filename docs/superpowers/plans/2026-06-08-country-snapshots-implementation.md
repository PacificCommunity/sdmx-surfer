# Country Snapshots Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MFAT Country Snapshots module: a self-contained area of SDMX Surfer under `/countrysnapshots` with shared-password access, canonical thematic pages, N-country compare, PDF export, AI chat overlay, and a "fork to Surfer" handoff.

**Architecture:** Single repo, strict module boundary inside `app/countrysnapshots/`, `app/api/countrysnapshots/`, `lib/country-snapshots/`, `components/country-snapshots/`, plus `scripts/import-country-snapshots.ts` and `data/country-snapshots/`. Canonical pages are server-rendered with deterministic configs; data is fetched client-side by `sdmx-dashboard-components`. Chat overlay uses the existing AI SDK setup with a snapshot-scoped system prompt and a swappable catalogue-access mechanism.

**Tech Stack:** Next.js 16 App Router, React 19, NextAuth v4 (for the fork-to-Surfer side), Drizzle + Postgres (Neon), `sdmx-dashboard-components`, `html2canvas` + `jspdf` (already deps), Vitest. AI SDK v6 + Vercel AI Gateway for the agent.

**Phases:**

- **Phase A (Tasks A1–A6):** Foundation. Module skeleton, lint boundary, build flag, catalogue + importer, shared-password gate. Deliverable: `/countrysnapshots/login` lets you in, lands on a placeholder page; catalogue committed.
- **Phase B (Tasks B1–B6):** Read-only snapshot product. Config builder, canonical thematic pages, compare pages, entry-page matrix, partial-failure log endpoint, PDF export. Deliverable: end-to-end snapshot reading without AI.
- **Phase C (Tasks C1–C5):** AI integration. Catalogue access (both modes), snapshot system prompt, chat overlay UI + endpoint, fork-to-Surfer handshake, entry-page chat starter. Deliverable: full v1 feature.

Each phase ends with a checkpoint task (verify build, lint, tests, both build modes). The plan can pause after any phase.

---

## Phase A — Foundation

### Task A1: Create module skeleton, build flag, lint boundary

**Files:**
- Create: `app/countrysnapshots/page.tsx`
- Create: `lib/country-snapshots/feature-flag.ts`
- Create: `data/country-snapshots/.gitkeep`
- Modify: `eslint.config.mjs`
- Modify: `next.config.ts`
- Test: `tests/country-snapshots/module-boundary.test.ts`

- [ ] **Step 1: Create empty module directories**

```bash
mkdir -p app/countrysnapshots app/api/countrysnapshots lib/country-snapshots components/country-snapshots data/country-snapshots
touch data/country-snapshots/.gitkeep
```

- [ ] **Step 2: Add feature-flag helper**

Create `lib/country-snapshots/feature-flag.ts`:

```ts
/**
 * INCLUDE_COUNTRY_SNAPSHOTS is read at build/runtime to decide whether
 * the snapshots module surfaces are exposed. Default ON in MFAT
 * deployments, OFF when shipping a snapshot-free Surfer.
 */
export const countrySnapshotsEnabled =
  process.env.INCLUDE_COUNTRY_SNAPSHOTS !== "0";
```

- [ ] **Step 3: Add a placeholder landing page that respects the flag**

Create `app/countrysnapshots/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { countrySnapshotsEnabled } from "@/lib/country-snapshots/feature-flag";

export default function CountrySnapshotsPlaceholder() {
  if (!countrySnapshotsEnabled) notFound();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Country Snapshots</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Coming soon. The login screen will live at /countrysnapshots/login.
      </p>
    </main>
  );
}
```

- [ ] **Step 4: Wire build-time exclusion in `next.config.ts`**

Read `next.config.ts` first to see what's there, then add a rewrites rule that returns 404 for `/countrysnapshots/*` when the flag is off. Concrete edit (append to the config object):

```ts
async rewrites() {
  if (process.env.INCLUDE_COUNTRY_SNAPSHOTS === "0") {
    return {
      beforeFiles: [
        { source: "/countrysnapshots/:path*", destination: "/404" },
        { source: "/api/countrysnapshots/:path*", destination: "/404" },
      ],
    };
  }
  return [];
},
```

- [ ] **Step 5: Add a lint boundary rule**

Open `eslint.config.mjs` and add a `no-restricted-imports` rule that fails when files outside the five code paths import from `country-snapshots/*`. Concrete fragment to merge into the existing flat-config export:

```js
{
  files: ["**/*.{ts,tsx,js,jsx,mjs}"],
  ignores: [
    "app/countrysnapshots/**",
    "app/api/countrysnapshots/**",
    "lib/country-snapshots/**",
    "components/country-snapshots/**",
    "scripts/import-country-snapshots.ts",
    "tests/country-snapshots/**",
  ],
  rules: {
    "no-restricted-imports": ["error", {
      patterns: [
        {
          group: ["**/country-snapshots/**", "**/country-snapshots"],
          message: "Country Snapshots is a self-contained module. Code outside the five module paths may not import from it.",
        },
      ],
    }],
  },
},
```

- [ ] **Step 6: Write the boundary test (defensive belt + suspenders)**

Create `tests/country-snapshots/module-boundary.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ALLOWED_PATHS = [
  "app/countrysnapshots",
  "app/api/countrysnapshots",
  "lib/country-snapshots",
  "components/country-snapshots",
  "scripts/import-country-snapshots.ts",
  "tests/country-snapshots",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (name === "node_modules" || name.startsWith(".") || name === "data") return [];
    const s = statSync(full);
    if (s.isDirectory()) return walk(full);
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) return [full];
    return [];
  });
}

describe("module boundary", () => {
  it("no file outside the five module paths imports from country-snapshots/", () => {
    const root = process.cwd();
    const files = walk(root);
    const violators: string[] = [];
    const importRe = /from\s+["']([^"']*country-snapshots[^"']*)["']/g;

    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (ALLOWED_PATHS.some((p) => rel === p || rel.startsWith(p + "/"))) continue;
      const text = readFileSync(file, "utf8");
      if (importRe.test(text)) violators.push(rel);
      importRe.lastIndex = 0;
    }

    expect(violators).toEqual([]);
  });
});
```

- [ ] **Step 7: Run lint, tests, build**

```bash
npm run lint
npm test -- tests/country-snapshots/module-boundary.test.ts
INCLUDE_COUNTRY_SNAPSHOTS=0 npm run build
INCLUDE_COUNTRY_SNAPSHOTS=1 npm run build
```

Expected: all green. With the flag off, the `/countrysnapshots` route returns 404 via the rewrite (verify in build output).

- [ ] **Step 8: Commit**

```bash
git add app/countrysnapshots app/api/countrysnapshots lib/country-snapshots components/country-snapshots data/country-snapshots eslint.config.mjs next.config.ts tests/country-snapshots
git commit -m "country snapshots: module skeleton + build flag + lint boundary"
```

---

### Task A2: Catalogue type definitions and access helper

**Files:**
- Create: `lib/country-snapshots/catalogue.ts`
- Create: `lib/country-snapshots/catalogue.generated.ts` (placeholder)
- Test: `tests/country-snapshots/catalogue.test.ts`

- [ ] **Step 1: Define types in `lib/country-snapshots/catalogue.ts`**

```ts
export type Region = "POL" | "MEL" | "MIC";
export type Rendering = "TABLE" | "CHART" | "MAP" | "TEXT";

export type Country = {
  code: string;
  name: string;
  region: Region;
  mfatRelevant: boolean;
};

export type Theme = {
  id: string;       // Roman numeral as in the spreadsheet, e.g. "II"
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
  generatedAt: string;  // ISO date
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
```

- [ ] **Step 2: Create an empty placeholder generated file**

Create `lib/country-snapshots/catalogue.generated.ts`:

```ts
// AUTO-GENERATED by scripts/import-country-snapshots.ts. Do not edit by hand.
import type { Catalogue } from "./catalogue";

export const catalogue: Catalogue = {
  generatedAt: "1970-01-01T00:00:00Z",
  sourceFile: "(not yet imported)",
  countries: [],
  themes: [],
  indicators: [],
};
```

- [ ] **Step 3: Write a test for the helpers against a fixture catalogue**

Create `tests/country-snapshots/catalogue.test.ts`:

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/country-snapshots/catalogue.generated", () => ({
  catalogue: {
    generatedAt: "2026-06-08T00:00:00Z",
    sourceFile: "fixture.xlsx",
    countries: [
      { code: "TO", name: "Tonga", region: "POL", mfatRelevant: true },
      { code: "WS", name: "Samoa", region: "POL", mfatRelevant: true },
    ],
    themes: [
      { id: "II", slug: "health", title: "Health", order: 2 },
      { id: "III", slug: "education", title: "Education", order: 3 },
    ],
    indicators: [
      { id: "II.1", themeId: "II", title: "X", rendering: "CHART" },
      { id: "III.1", themeId: "III", title: "Y", rendering: "TABLE" },
      { id: "II.2", themeId: "II", title: "Z", rendering: "TABLE" },
    ],
  },
}));

import {
  getCountry,
  getThemeBySlug,
  getIndicatorsForTheme,
} from "../../lib/country-snapshots/catalogue";

describe("catalogue helpers", () => {
  it("looks up countries by code", () => {
    expect(getCountry("TO")?.name).toBe("Tonga");
    expect(getCountry("XX")).toBeUndefined();
  });

  it("looks up themes by slug", () => {
    expect(getThemeBySlug("health")?.id).toBe("II");
  });

  it("returns indicators for a theme in numeric id order", () => {
    const ids = getIndicatorsForTheme("II").map((i) => i.id);
    expect(ids).toEqual(["II.1", "II.2"]);
  });
});
```

- [ ] **Step 4: Run the test**

```bash
npm test -- tests/country-snapshots/catalogue.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/country-snapshots/catalogue.ts lib/country-snapshots/catalogue.generated.ts tests/country-snapshots/catalogue.test.ts
git commit -m "country snapshots: catalogue types and helpers"
```

---

### Task A3: Importer (Excel → catalogue.generated.ts)

**Files:**
- Create: `scripts/import-country-snapshots.ts`
- Test: `tests/country-snapshots/import.test.ts`
- Modify: `package.json` (add a script entry)

- [ ] **Step 1: Install the Excel reader (already a project policy permits adding deps)**

```bash
npm install --save-dev xlsx
```

(Note: `xlsx` from SheetJS is the standard. Verify it landed cleanly.)

- [ ] **Step 2: Write the importer**

Create `scripts/import-country-snapshots.ts`:

```ts
#!/usr/bin/env node
/**
 * Import the MFAT country snapshots spreadsheet into a typed catalogue.
 *
 * Usage:
 *   tsx scripts/import-country-snapshots.ts \
 *     --in  data/country-snapshots/country_snapshots_2025.xlsx \
 *     --out lib/country-snapshots/catalogue.generated.ts \
 *     --report data/country-snapshots/import-report.md
 */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import * as XLSX from "xlsx";
import type {
  Catalogue,
  Country,
  Theme,
  Indicator,
  Region,
  Rendering,
} from "../lib/country-snapshots/catalogue";

type ImportResult = {
  catalogue: Catalogue;
  report: {
    skippedRows: string[];
    urlFixups: string[];
    missingDataSources: string[];
    duplicates: string[];
  };
};

const RENDERING_VALUES: Rendering[] = ["TABLE", "CHART", "MAP", "TEXT"];

export function importExcel(buffer: Buffer, sourceName: string): ImportResult {
  const wb = XLSX.read(buffer, { type: "buffer" });
  const reports = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets["REPORTS"],
    { header: ["DO", "MFAT", "CD", "EN", "REG"], range: 1 },
  );
  const indicators = XLSX.utils.sheet_to_json<Record<string, unknown>>(
    wb.Sheets["INDICATORS"],
    {
      header: ["RID", "DO", "TYPE", "ID", "EN", "MFAT_NAME", "RENDERING", "DE", "API", "COMMENT1", "DF", "COMMENT2", "COMMENT_2025"],
      range: 1,
    },
  );

  const skippedRows: string[] = [];
  const urlFixups: string[] = [];
  const missingDataSources: string[] = [];
  const duplicates: string[] = [];

  // ---- Countries ----
  const countries: Country[] = [];
  const seenCountry = new Set<string>();
  for (const r of reports) {
    const code = String(r.CD ?? "").trim();
    const name = String(r.EN ?? "").trim();
    const region = String(r.REG ?? "").trim() as Region;
    const mfatRelevant = Number(r.MFAT ?? 0) === 1;
    if (!code || !name) {
      skippedRows.push(`REPORTS row with missing code/name: ${JSON.stringify(r)}`);
      continue;
    }
    if (!["POL", "MEL", "MIC"].includes(region)) {
      skippedRows.push(`REPORTS row ${code} has invalid region "${region}"`);
      continue;
    }
    if (seenCountry.has(code)) {
      duplicates.push(`Duplicate country code: ${code}`);
      continue;
    }
    seenCountry.add(code);
    countries.push({ code, name, region, mfatRelevant });
  }

  // ---- Themes and indicators ----
  const themes: Theme[] = [];
  const themeBySlug = new Map<string, Theme>();
  const indicatorsOut: Indicator[] = [];
  const seenIndicator = new Set<string>();
  let currentThemeId: string | null = null;
  let order = 0;

  function slugify(s: string): string {
    return s
      .toLowerCase()
      .replace(/&/g, "and")
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  function normaliseUrl(raw: string): { url: string; fixed: boolean } {
    // Replace SPC,DF_X,N.M/ with SPC,DF_X,/ per the 2026 update.
    const fixed = raw.replace(/(SPC,[^,]+,)\d+(?:\.\d+)?\//g, "$1/");
    return { url: fixed, fixed: fixed !== raw };
  }

  for (const r of indicators) {
    const type = String(r.TYPE ?? "").trim();
    const id = String(r.ID ?? "").trim();
    const en = String(r.EN ?? "").trim();
    if (type === "HEADING") {
      currentThemeId = id;
      const t: Theme = {
        id,
        slug: slugify(en),
        title: en,
        order: ++order,
      };
      if (themeBySlug.has(t.slug)) {
        throw new Error(`Duplicate theme slug "${t.slug}" from "${en}"`);
      }
      themeBySlug.set(t.slug, t);
      themes.push(t);
      continue;
    }
    if (type !== "INDICATOR") {
      skippedRows.push(`Unknown row type "${type}" id ${id}`);
      continue;
    }
    if (!currentThemeId) {
      skippedRows.push(`INDICATOR ${id} before any HEADING`);
      continue;
    }
    if (seenIndicator.has(id)) {
      duplicates.push(`Duplicate indicator id: ${id}`);
      continue;
    }
    seenIndicator.add(id);

    const rendering = String(r.RENDERING ?? "TABLE").trim().toUpperCase() as Rendering;
    if (!RENDERING_VALUES.includes(rendering)) {
      skippedRows.push(`INDICATOR ${id} has unknown rendering "${rendering}"`);
      continue;
    }

    const apiRaw = String(r.API ?? "").trim();
    let apiUrlTemplate: string | undefined;
    if (apiRaw && apiRaw !== "-") {
      const { url, fixed } = normaliseUrl(apiRaw);
      if (fixed) urlFixups.push(`${id}: ${apiRaw} -> ${url}`);
      // Some templates use [TAG_GEO] and some are unparameterised; in the latter case the
      // 2026 spreadsheet uses `..` to mean "all geos". We require [TAG_GEO] so the config
      // builder can substitute. If absent, attempt one insertion at the conventional spot.
      apiUrlTemplate = url.includes("[TAG_GEO]")
        ? url
        : url.replace(/\/A\.\./, "/A.[TAG_GEO].").replace(/\/A\./, "/A.[TAG_GEO].");
      if (!apiUrlTemplate.includes("[TAG_GEO]")) {
        skippedRows.push(`INDICATOR ${id} could not be parameterised with [TAG_GEO]; URL kept verbatim`);
        apiUrlTemplate = url;
      }
    } else {
      missingDataSources.push(id);
    }

    const dataflow = String(r.DF ?? "").trim();
    const visRaw = String(r.DE ?? "").trim();
    const visUrl = visRaw && visRaw !== "-" ? visRaw : undefined;
    const mfatName = String(r.MFAT_NAME ?? "").trim();
    const notes = [r.COMMENT1, r.COMMENT2, r.COMMENT_2025]
      .filter((c) => c && String(c).trim() && String(c).trim() !== "-")
      .map(String)
      .join(" | ") || undefined;

    indicatorsOut.push({
      id,
      themeId: currentThemeId,
      title: en,
      mfatName: mfatName && mfatName !== en ? mfatName : undefined,
      rendering,
      dataflow: dataflow && dataflow !== "-" ? dataflow : undefined,
      apiUrlTemplate,
      visUrl,
      notes,
    });
  }

  // Sort indicators by id for stable output
  indicatorsOut.sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true }),
  );

  return {
    catalogue: {
      generatedAt: new Date().toISOString().slice(0, 10) + "T00:00:00Z", // stable per-day
      sourceFile: sourceName,
      countries,
      themes,
      indicators: indicatorsOut,
    },
    report: { skippedRows, urlFixups, missingDataSources, duplicates },
  };
}

export function renderCatalogueTs(catalogue: Catalogue): string {
  return [
    "// AUTO-GENERATED by scripts/import-country-snapshots.ts. Do not edit by hand.",
    'import type { Catalogue } from "./catalogue";',
    "",
    "export const catalogue: Catalogue = " +
      JSON.stringify(catalogue, null, 2) +
      ";",
    "",
  ].join("\n");
}

export function renderReportMd(
  report: ImportResult["report"],
  sourceFile: string,
): string {
  const section = (title: string, items: string[]) =>
    items.length
      ? `### ${title} (${items.length})\n\n${items.map((i) => "- " + i).join("\n")}\n`
      : `### ${title}\n\n_None._\n`;
  return [
    `# Import report for ${sourceFile}`,
    "",
    section("URL fixups", report.urlFixups),
    section("Indicators without data source", report.missingDataSources),
    section("Skipped rows", report.skippedRows),
    section("Duplicates rejected", report.duplicates),
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      out: { type: "string" },
      report: { type: "string" },
    },
  });
  if (!values.in || !values.out || !values.report) {
    console.error("Usage: --in <xlsx> --out <ts> --report <md>");
    process.exit(2);
  }
  const buf = readFileSync(values.in);
  const { catalogue, report } = importExcel(buf, basename(values.in));
  writeFileSync(values.out, renderCatalogueTs(catalogue), "utf8");
  writeFileSync(values.report, renderReportMd(report, basename(values.in)), "utf8");
  console.error(
    `Wrote ${catalogue.indicators.length} indicators across ${catalogue.themes.length} themes for ${catalogue.countries.length} countries.`,
  );
}

if (require.main === module) {
  void main();
}
```

- [ ] **Step 3: Add a package.json script**

In `package.json` `scripts`, add:

```json
"import:country-snapshots": "tsx scripts/import-country-snapshots.ts --in data/country-snapshots/country_snapshots_2025.xlsx --out lib/country-snapshots/catalogue.generated.ts --report data/country-snapshots/import-report.md"
```

- [ ] **Step 4: Write unit tests against a tiny inline fixture**

Create `tests/country-snapshots/import.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { importExcel, renderCatalogueTs } from "../../scripts/import-country-snapshots";

function buildFixtureWorkbook() {
  const wb = XLSX.utils.book_new();

  const reports = [
    ["DO", "MFAT", "CD", "EN", "REG"],
    [0, 1, "TO", "Tonga", "POL"],
    [0, 1, "WS", "Samoa", "POL"],
    [0, 0, "WF", "Wallis and Futuna", "POL"],
  ];
  const indicatorRows = [
    ["RID", "DO", "TYPE", "ID", "EN", "MFAT Indicator Name", "RENDERING", "DE", "API", "COMMENT", "DF", "COMMENT", "comment 2025"],
    [1, 1, "HEADING", "I", "Context", "", "-", "-", "-", "-", "-", "", ""],
    [2, 1, "INDICATOR", "I.1", "Population", "Pop.", "TABLE", "-", "https://example.org/rest/data/SPC,DF_POP,3.0/A..MIDYEAR._T._T?dimensionAtObservation=AllDimensions", "-", "DF_POP", "", ""],
    [3, 1, "HEADING", "II", "Health", "", "-", "-", "-", "-", "-", "", ""],
    [4, 1, "INDICATOR", "II.1", "Life expectancy", "", "CHART", "-", "https://example.org/rest/data/SPC,DF_LIFE,/A.[TAG_GEO].LIFE?dimensionAtObservation=AllDimensions", "-", "DF_LIFE", "", ""],
    [5, 1, "INDICATOR", "II.2", "Static fact (no API)", "", "TEXT", "-", "-", "-", "-", "", ""],
  ];

  wb.SheetNames.push("REPORTS", "INDICATORS");
  wb.Sheets["REPORTS"] = XLSX.utils.aoa_to_sheet(reports);
  wb.Sheets["INDICATORS"] = XLSX.utils.aoa_to_sheet(indicatorRows);

  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("importExcel", () => {
  it("parses countries with regions and MFAT flag", () => {
    const { catalogue } = importExcel(buildFixtureWorkbook(), "fixture.xlsx");
    expect(catalogue.countries).toHaveLength(3);
    expect(catalogue.countries.find((c) => c.code === "TO")?.mfatRelevant).toBe(true);
    expect(catalogue.countries.find((c) => c.code === "WF")?.mfatRelevant).toBe(false);
  });

  it("groups indicators under their preceding heading", () => {
    const { catalogue } = importExcel(buildFixtureWorkbook(), "fixture.xlsx");
    const popInd = catalogue.indicators.find((i) => i.id === "I.1");
    expect(popInd?.themeId).toBe("I");
    const lifeInd = catalogue.indicators.find((i) => i.id === "II.1");
    expect(lifeInd?.themeId).toBe("II");
  });

  it("normalises versioned URLs and inserts [TAG_GEO] when absent", () => {
    const { catalogue, report } = importExcel(buildFixtureWorkbook(), "fixture.xlsx");
    const popInd = catalogue.indicators.find((i) => i.id === "I.1");
    expect(popInd?.apiUrlTemplate).toContain("SPC,DF_POP,/");
    expect(popInd?.apiUrlTemplate).toContain("[TAG_GEO]");
    expect(report.urlFixups.length).toBeGreaterThan(0);
  });

  it("records indicators with no data source", () => {
    const { catalogue, report } = importExcel(buildFixtureWorkbook(), "fixture.xlsx");
    const statics = catalogue.indicators.filter((i) => !i.apiUrlTemplate);
    expect(statics.map((i) => i.id)).toContain("II.2");
    expect(report.missingDataSources).toContain("II.2");
  });

  it("emits deterministic JSON across runs", () => {
    const ts1 = renderCatalogueTs(importExcel(buildFixtureWorkbook(), "fixture.xlsx").catalogue);
    const ts2 = renderCatalogueTs(importExcel(buildFixtureWorkbook(), "fixture.xlsx").catalogue);
    expect(ts1).toBe(ts2);
  });
});
```

- [ ] **Step 5: Run the tests**

```bash
npm test -- tests/country-snapshots/import.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/import-country-snapshots.ts tests/country-snapshots/import.test.ts package.json package-lock.json
git commit -m "country snapshots: importer with TDD"
```

---

### Task A4: Run the importer on the real spreadsheet

**Files:**
- Create: `data/country-snapshots/country_snapshots_2025.xlsx` (moved from repo root)
- Modify: `lib/country-snapshots/catalogue.generated.ts` (now real data)
- Create: `data/country-snapshots/import-report.md`

- [ ] **Step 1: Move the Excel into the data folder**

```bash
git mv country_snapshots_2025.xlsx data/country-snapshots/country_snapshots_2025.xlsx
```

(If untracked, just `mv`.)

- [ ] **Step 2: Run the import**

```bash
npm run import:country-snapshots
```

Expected: stderr line reports indicator/theme/country counts. The catalogue file and report file are updated.

- [ ] **Step 3: Review the import report**

```bash
cat data/country-snapshots/import-report.md
```

Verify:
- URL fixups look plausible (version pins removed).
- Indicators without a data source match expectations (Constitutional form, Head of State, etc.).
- No surprise skips or duplicates.

- [ ] **Step 4: Verify the catalogue type-checks and tests still pass**

```bash
npm run lint
npm test
npm run build
```

Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add data/country-snapshots/country_snapshots_2025.xlsx data/country-snapshots/import-report.md lib/country-snapshots/catalogue.generated.ts
git commit -m "country snapshots: import 2025 catalogue"
```

---

### Task A5: Catalogue invariant tests against the real catalogue

**Files:**
- Modify: `tests/country-snapshots/catalogue.test.ts` (add an "invariants on real catalogue" describe block)

- [ ] **Step 1: Add invariant tests**

Append to `tests/country-snapshots/catalogue.test.ts`:

```ts
import { catalogue as real } from "../../lib/country-snapshots/catalogue.generated";

describe("real catalogue invariants", () => {
  it("every indicator's themeId resolves to a known theme", () => {
    const themeIds = new Set(real.themes.map((t) => t.id));
    const orphans = real.indicators.filter((i) => !themeIds.has(i.themeId));
    expect(orphans).toEqual([]);
  });

  it("every indicator with a dataflow has an apiUrlTemplate", () => {
    const broken = real.indicators.filter((i) => i.dataflow && !i.apiUrlTemplate);
    expect(broken.map((i) => i.id)).toEqual([]);
  });

  it("every apiUrlTemplate contains exactly one [TAG_GEO]", () => {
    const malformed = real.indicators.filter((i) => {
      if (!i.apiUrlTemplate) return false;
      const matches = i.apiUrlTemplate.match(/\[TAG_GEO\]/g) ?? [];
      return matches.length !== 1;
    });
    expect(malformed.map((i) => i.id)).toEqual([]);
  });

  it("theme slugs are unique", () => {
    const slugs = real.themes.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("country codes are unique", () => {
    const codes = real.countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has the expected order of magnitude (sanity)", () => {
    expect(real.countries.length).toBeGreaterThan(15);
    expect(real.themes.length).toBeGreaterThanOrEqual(10);
    expect(real.indicators.length).toBeGreaterThan(100);
  });
});
```

- [ ] **Step 2: Run the tests**

```bash
npm test -- tests/country-snapshots/catalogue.test.ts
```

Expected: PASS. If any invariant fails, fix the importer (Task A3) before continuing.

- [ ] **Step 3: Commit**

```bash
git add tests/country-snapshots/catalogue.test.ts
git commit -m "country snapshots: invariant tests on real catalogue"
```

---

### Task A6: Shared-password gate (cookie, middleware, snapshot_anon identity)

**Files:**
- Create: `lib/country-snapshots/auth.ts`
- Create: `app/countrysnapshots/login/page.tsx`
- Create: `app/api/countrysnapshots/auth/route.ts`
- Modify: `proxy.ts`
- Modify: `app/countrysnapshots/page.tsx` (read the snapshot_anon identity)
- Test: `tests/country-snapshots/auth.test.ts`
- Modify: `.env.example`

- [ ] **Step 1: Helper to verify password, mint cookie, resolve identity**

Create `lib/country-snapshots/auth.ts`:

```ts
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { db, authUsers } from "@/lib/db";
import { eq } from "drizzle-orm";

const COOKIE_NAME = "cs_session";

function secret(): string {
  const s = process.env.NEXTAUTH_SECRET;
  if (!s) throw new Error("NEXTAUTH_SECRET is required for snapshot cookie signing");
  return s;
}

function passwordHash(): string {
  // Token version: HMAC(secret, password). Changing the password invalidates outstanding cookies.
  const pw = process.env.COUNTRY_SNAPSHOTS_PASSWORD;
  if (!pw) throw new Error("COUNTRY_SNAPSHOTS_PASSWORD is required");
  return createHmac("sha256", secret()).update(pw).digest("hex").slice(0, 8);
}

export function verifyPassword(candidate: string): boolean {
  const expected = process.env.COUNTRY_SNAPSHOTS_PASSWORD ?? "";
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(candidate), Buffer.from(expected));
}

type Payload = { uid: string; v: string };

function sign(payload: Payload): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyCookie(token: string | undefined): Payload | null {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  let payload: Payload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (payload.v !== passwordHash()) return null;
  return payload;
}

export function mintCookieValue(): { value: string; uid: string } {
  const uid = randomUUID();
  return { value: sign({ uid, v: passwordHash() }), uid };
}

export const COOKIE = {
  name: COOKIE_NAME,
  serialize(value: string): string {
    const maxAge = 60 * 60 * 24 * 30;
    return `${COOKIE_NAME}=${value}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAge}`;
  },
};

/** Ensure a snapshot_anon row exists in authUsers for this cookie's uid. */
export async function ensureAnonIdentity(uid: string): Promise<string> {
  const userId = `snapshot_anon_${uid}`;
  const existing = await db.select().from(authUsers).where(eq(authUsers.id, userId)).limit(1);
  if (existing.length === 0) {
    await db.insert(authUsers).values({
      id: userId,
      email: `${userId}@snapshot.local`,
      role: "snapshot_anon",
    });
  }
  return userId;
}
```

- [ ] **Step 2: Add the env example**

In `.env.example`, append:

```
# Country Snapshots module
INCLUDE_COUNTRY_SNAPSHOTS=1
COUNTRY_SNAPSHOTS_PASSWORD=
```

- [ ] **Step 3: Build the login page**

Create `app/countrysnapshots/login/page.tsx`:

```tsx
import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyCookie } from "@/lib/country-snapshots/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const c = await cookies();
  if (verifyCookie(c.get("cs_session")?.value)) {
    const next = (await searchParams).next ?? "/countrysnapshots";
    redirect(next);
  }
  const { error, next } = await searchParams;

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-semibold">Country Snapshots</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Enter the access password to continue.
      </p>
      <form method="POST" action="/api/countrysnapshots/auth" className="mt-6 space-y-4">
        <input type="hidden" name="next" value={next ?? ""} />
        <input
          type="password"
          name="password"
          required
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
          autoFocus
        />
        <button
          type="submit"
          className="w-full rounded-md bg-[#004467] px-3 py-2 text-white"
        >
          Enter
        </button>
        {error ? <p className="text-sm text-red-700">Incorrect password.</p> : null}
      </form>
    </main>
  );
}
```

- [ ] **Step 4: Build the auth route**

Create `app/api/countrysnapshots/auth/route.ts`:

```ts
import { NextResponse } from "next/server";
import {
  verifyPassword,
  mintCookieValue,
  COOKIE,
  ensureAnonIdentity,
} from "@/lib/country-snapshots/auth";

export async function POST(req: Request) {
  const form = await req.formData();
  const password = String(form.get("password") ?? "");
  const next = String(form.get("next") ?? "/countrysnapshots") || "/countrysnapshots";
  if (!verifyPassword(password)) {
    const url = new URL(req.url);
    return NextResponse.redirect(
      new URL(`/countrysnapshots/login?error=1&next=${encodeURIComponent(next)}`, url),
      303,
    );
  }
  const { value, uid } = mintCookieValue();
  await ensureAnonIdentity(uid);
  const res = NextResponse.redirect(new URL(next, req.url), 303);
  res.headers.set("Set-Cookie", COOKIE.serialize(value));
  return res;
}
```

- [ ] **Step 5: Wire the snapshots gate into `proxy.ts`**

`withAuth`'s matcher already excludes most snapshot paths if we add `countrysnapshots` to its excluded prefix list. Open `proxy.ts` and amend the matcher:

```ts
export const config = {
  matcher: [
    "/((?!api/auth|api/public|api/sdmx-proxy|_next/static|_next/image|favicon.ico|models/|login|gallery(?:/|$)|p(?:/|$)|countrysnapshots(?:/|$)|api/countrysnapshots(?:/|$)).*)",
  ],
};
```

Add a small custom middleware exclusively for snapshot routes. Create a sibling file `middleware-snapshots.ts` and chain it from `proxy.ts`:

Actually, simpler: add the gate logic directly in a route-segment middleware. Create `app/countrysnapshots/middleware.ts` is not supported in App Router. Use a wrapping check in the page layout instead. Create `app/countrysnapshots/layout.tsx`:

```tsx
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { verifyCookie } from "@/lib/country-snapshots/auth";
import { countrySnapshotsEnabled } from "@/lib/country-snapshots/feature-flag";
import { notFound } from "next/navigation";

export default async function CountrySnapshotsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!countrySnapshotsEnabled) notFound();
  const h = await headers();
  const path = h.get("x-invoke-path") ?? h.get("next-url") ?? "";
  const isLogin = path.endsWith("/countrysnapshots/login");
  const c = await cookies();
  const valid = verifyCookie(c.get("cs_session")?.value);
  if (!valid && !isLogin) {
    redirect("/countrysnapshots/login");
  }
  return <div className="min-h-screen bg-[#f7fafc]">{children}</div>;
}
```

For the API routes, add an inline guard helper. Add to `lib/country-snapshots/auth.ts`:

```ts
import { cookies } from "next/headers";

export async function requireSnapshotSession(): Promise<{
  uid: string;
  userId: string;
} | null> {
  const c = await cookies();
  const payload = verifyCookie(c.get(COOKIE_NAME)?.value);
  if (!payload) return null;
  const userId = await ensureAnonIdentity(payload.uid);
  return { uid: payload.uid, userId };
}
```

(The auth route POST is intentionally unguarded.)

- [ ] **Step 6: Test the auth helpers**

Create `tests/country-snapshots/auth.test.ts`:

```ts
import { describe, it, expect, beforeAll } from "vitest";
import {
  verifyPassword,
  mintCookieValue,
  verifyCookie,
} from "../../lib/country-snapshots/auth";

beforeAll(() => {
  process.env.NEXTAUTH_SECRET = "test-secret-32-chars-long-padding!";
  process.env.COUNTRY_SNAPSHOTS_PASSWORD = "CountrySnapshots";
});

describe("snapshot auth", () => {
  it("accepts the configured password and rejects others", () => {
    expect(verifyPassword("CountrySnapshots")).toBe(true);
    expect(verifyPassword("wrong")).toBe(false);
    expect(verifyPassword("")).toBe(false);
  });

  it("round-trips a signed cookie", () => {
    const { value, uid } = mintCookieValue();
    const payload = verifyCookie(value);
    expect(payload?.uid).toBe(uid);
  });

  it("rejects a tampered cookie", () => {
    const { value } = mintCookieValue();
    const [body, sig] = value.split(".");
    const tampered = body + "x." + sig;
    expect(verifyCookie(tampered)).toBeNull();
  });

  it("invalidates when password changes (token version)", () => {
    const { value } = mintCookieValue();
    process.env.COUNTRY_SNAPSHOTS_PASSWORD = "RotatedPassword";
    expect(verifyCookie(value)).toBeNull();
  });
});
```

- [ ] **Step 7: Run tests, lint, both builds**

```bash
npm test -- tests/country-snapshots/auth.test.ts
npm run lint
INCLUDE_COUNTRY_SNAPSHOTS=0 npm run build
INCLUDE_COUNTRY_SNAPSHOTS=1 npm run build
```

Expected: all green. Set `COUNTRY_SNAPSHOTS_PASSWORD=CountrySnapshots` in `.env.local` for local builds.

- [ ] **Step 8: Manual smoke**

```bash
npm run dev
# Visit http://localhost:3000/countrysnapshots → redirected to /countrysnapshots/login
# Enter "CountrySnapshots" → redirected back to /countrysnapshots
# Refresh → still in; cookie persists.
```

- [ ] **Step 9: Commit**

```bash
git add lib/country-snapshots/auth.ts app/countrysnapshots/login app/api/countrysnapshots/auth app/countrysnapshots/layout.tsx app/countrysnapshots/page.tsx proxy.ts tests/country-snapshots/auth.test.ts .env.example
git commit -m "country snapshots: shared-password gate + snapshot_anon identity"
```

### Phase A checkpoint

After A6:
- Both `INCLUDE_COUNTRY_SNAPSHOTS=0` and `=1` builds succeed.
- All tests pass: `npm test`.
- Lint is clean: `npm run lint`.
- Manual: `/countrysnapshots` redirects to login; login accepts the password; placeholder page renders.

Stop here, deploy to preview, sanity-check before Phase B.

---

## Phase B — Read-only snapshot product

### Task B1: Config builder (single country and N-country)

**Files:**
- Create: `lib/country-snapshots/config-builder.ts`
- Test: `tests/country-snapshots/config-builder.test.ts`

The config we emit targets `sdmx-dashboard-components`. Check the library's expected shape in `node_modules/sdmx-dashboard-components/README.md` or its TypeScript types before writing; the structure below is the working assumption.

- [ ] **Step 1: Write the builder**

Create `lib/country-snapshots/config-builder.ts`:

```ts
import type { Catalogue, Country, Indicator, Theme } from "./catalogue";

export type DashboardItem = {
  type: "chart" | "table" | "text";
  id: string;          // catalogue indicator id, used as a stable anchor
  title: string;
  dataUrl?: string;    // resolved URL with country code substituted
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
      i.rendering === "CHART" ? "chart" :
      i.rendering === "TABLE" ? "table" :
      "text";
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
```

- [ ] **Step 2: Tests**

Create `tests/country-snapshots/config-builder.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildSnapshotConfig } from "../../lib/country-snapshots/config-builder";
import type { Catalogue } from "../../lib/country-snapshots/catalogue";

const fixture: Catalogue = {
  generatedAt: "2026-06-08T00:00:00Z",
  sourceFile: "fixture",
  countries: [
    { code: "TO", name: "Tonga", region: "POL", mfatRelevant: true },
    { code: "WS", name: "Samoa", region: "POL", mfatRelevant: true },
  ],
  themes: [{ id: "II", slug: "health", title: "Health", order: 2 }],
  indicators: [
    {
      id: "II.1",
      themeId: "II",
      title: "Life expectancy",
      rendering: "CHART",
      dataflow: "DF_LIFE",
      apiUrlTemplate: "https://x/SPC,DF_LIFE,/A.[TAG_GEO].LIFE",
      visUrl: "https://stats.x/vis",
    },
    {
      id: "II.2",
      themeId: "II",
      title: "Static fact",
      rendering: "TEXT",
    },
  ],
};

describe("buildSnapshotConfig", () => {
  it("substitutes a single country code", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    expect(cfg.items[0].dataUrl).toBe("https://x/SPC,DF_LIFE,/A.TO.LIFE");
  });

  it("substitutes multiple country codes as a + list", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries,
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    expect(cfg.items[0].dataUrl).toBe("https://x/SPC,DF_LIFE,/A.TO+WS.LIFE");
  });

  it("emits a text item with no dataUrl for indicators lacking a source", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const staticItem = cfg.items.find((i) => i.id === "II.2");
    expect(staticItem?.type).toBe("text");
    expect(staticItem?.dataUrl).toBeUndefined();
  });

  it("preserves catalogue order", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    expect(cfg.items.map((i) => i.id)).toEqual(["II.1", "II.2"]);
  });
});
```

- [ ] **Step 3: Run tests and commit**

```bash
npm test -- tests/country-snapshots/config-builder.test.ts
git add lib/country-snapshots/config-builder.ts tests/country-snapshots/config-builder.test.ts
git commit -m "country snapshots: config builder for single and N-country pages"
```

---

### Task B2: Canonical thematic page (server-rendered, library renders client-side)

**Files:**
- Create: `app/countrysnapshots/[country]/[theme]/page.tsx`
- Create: `components/country-snapshots/snapshot-page-shell.tsx`
- Create: `components/country-snapshots/dashboard-renderer.tsx`
- Create: `components/country-snapshots/source-citation.tsx`

Before writing, confirm the library's render API by reading `node_modules/sdmx-dashboard-components/dist/index.d.ts`. The component name and config shape used below (`SDMXDashboard`, `config={item.dataUrl ...}`) are placeholders; replace with the real API in Step 2.

- [ ] **Step 1: Shell component**

Create `components/country-snapshots/snapshot-page-shell.tsx`:

```tsx
import Link from "next/link";

export function SnapshotPageShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6">
        <p className="text-xs uppercase tracking-wide text-[#006970]">
          <Link href="/countrysnapshots" className="hover:underline">
            Country Snapshots
          </Link>
        </p>
        <h1 className="mt-1 text-2xl font-semibold text-[#181c1e]">{title}</h1>
        {subtitle ? <p className="text-sm text-neutral-600">{subtitle}</p> : null}
      </header>
      {children}
    </div>
  );
}
```

- [ ] **Step 2: Dashboard renderer (calls the library)**

Create `components/country-snapshots/dashboard-renderer.tsx`. Look up the actual library import:

```bash
sed -n '1,80p' node_modules/sdmx-dashboard-components/dist/index.d.ts
```

Write the renderer:

```tsx
"use client";
import { ErrorBoundary } from "react-error-boundary";
import type { SnapshotConfig, DashboardItem } from "@/lib/country-snapshots/config-builder";
import { SourceCitation } from "./source-citation";

// Replace the import below with the real one identified from the library's d.ts.
// Common shapes are `import { Chart } from "sdmx-dashboard-components"` or a default export.
import { Chart, Table } from "sdmx-dashboard-components";

function ItemErrorFallback({ item }: { item: DashboardItem }) {
  return (
    <div className="rounded-md bg-[#f1f4f6] p-4 text-sm">
      <p className="font-medium">Couldn't load this indicator right now.</p>
      <p className="mt-1 text-neutral-600">
        {item.title}. Try refreshing the page.
        {item.source?.visUrl ? (
          <>
            {" "}
            Or <a href={item.source.visUrl} target="_blank" rel="noreferrer" className="underline">view on .Stat</a>.
          </>
        ) : null}
      </p>
    </div>
  );
}

export function DashboardRenderer({ config }: { config: SnapshotConfig }) {
  return (
    <div className="space-y-8">
      {config.items.map((item) => (
        <section key={item.id} id={item.id} className="scroll-mt-16">
          <h2 className="text-lg font-semibold">{item.title}</h2>
          {item.notes ? (
            <p className="mt-1 text-xs text-neutral-500">{item.notes}</p>
          ) : null}
          <div className="mt-3">
            <ErrorBoundary
              fallback={<ItemErrorFallback item={item} />}
              onError={(err) => {
                // Best-effort partial-failure log; ignore failure of the log itself.
                void fetch("/api/countrysnapshots/log", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    indicator: item.id,
                    dataflow: item.source?.dataflow,
                    error: String(err?.message ?? err),
                  }),
                }).catch(() => {});
              }}
            >
              {item.type === "text" || !item.dataUrl ? (
                <p className="text-sm italic text-neutral-500">
                  No data source for this indicator yet.
                </p>
              ) : item.type === "chart" ? (
                <Chart dataUrl={item.dataUrl} />
              ) : (
                <Table dataUrl={item.dataUrl} />
              )}
            </ErrorBoundary>
          </div>
          {item.source ? (
            <SourceCitation dataflow={item.source.dataflow} visUrl={item.source.visUrl} />
          ) : null}
        </section>
      ))}
    </div>
  );
}
```

If the library's API differs from `<Chart dataUrl=... />` and `<Table dataUrl=... />`, replace with the real props. The error boundary and the surrounding shell stay the same.

- [ ] **Step 3: Source citation component**

Create `components/country-snapshots/source-citation.tsx`:

```tsx
export function SourceCitation({
  dataflow,
  visUrl,
}: {
  dataflow: string;
  visUrl?: string;
}) {
  return (
    <p className="mt-2 text-xs text-neutral-500">
      Source: SPC <code>{dataflow}</code> via .Stat
      {visUrl ? (
        <>
          {" "}
          (<a href={visUrl} target="_blank" rel="noreferrer" className="underline">view dataset</a>)
        </>
      ) : null}
    </p>
  );
}
```

- [ ] **Step 4: Page route with `generateStaticParams`**

Create `app/countrysnapshots/[country]/[theme]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import {
  getSnapshotCatalogue,
  getCountry,
  getThemeBySlug,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { DashboardRenderer } from "@/components/country-snapshots/dashboard-renderer";

export async function generateStaticParams() {
  const cat = getSnapshotCatalogue();
  const params: { country: string; theme: string }[] = [];
  for (const c of cat.countries) {
    for (const t of cat.themes) {
      params.push({ country: c.code, theme: t.slug });
    }
  }
  return params;
}

export default async function Page({
  params,
}: {
  params: Promise<{ country: string; theme: string }>;
}) {
  const { country: countryCode, theme: themeSlug } = await params;
  const country = getCountry(countryCode);
  const theme = getThemeBySlug(themeSlug);
  if (!country || !theme) notFound();
  const config = buildSnapshotConfig({
    country,
    theme,
    catalogue: getSnapshotCatalogue(),
  });

  return (
    <SnapshotPageShell
      title={`${country.name} — ${theme.title}`}
      subtitle={`Snapshot of ${config.items.length} indicators`}
    >
      <DashboardRenderer config={config} />
    </SnapshotPageShell>
  );
}
```

- [ ] **Step 5: Type-check and build**

```bash
npm run lint
npm test
INCLUDE_COUNTRY_SNAPSHOTS=1 npm run build
```

Expected: build emits 22 × 12 = 264 static routes (visible in the build output). Lint and tests pass.

- [ ] **Step 6: Manual smoke**

```bash
npm run dev
# After logging in, visit http://localhost:3000/countrysnapshots/TO/health
# Expect: page renders with indicator titles. Charts may show "Couldn't load" depending on .Stat availability.
```

- [ ] **Step 7: Commit**

```bash
git add app/countrysnapshots/[country] components/country-snapshots/snapshot-page-shell.tsx components/country-snapshots/dashboard-renderer.tsx components/country-snapshots/source-citation.tsx
git commit -m "country snapshots: canonical thematic page"
```

---

### Task B3: Partial-failure log endpoint

**Files:**
- Create: `app/api/countrysnapshots/log/route.ts`
- Test: extend `tests/country-snapshots/auth.test.ts` or new `tests/country-snapshots/log.test.ts`

- [ ] **Step 1: Endpoint**

Create `app/api/countrysnapshots/log/route.ts`:

```ts
import { NextResponse } from "next/server";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";

export async function POST(req: Request) {
  const session = await requireSnapshotSession();
  if (!session) return NextResponse.json({ ok: false }, { status: 401 });
  let body: { indicator?: string; dataflow?: string; error?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
  if (!body.indicator) return NextResponse.json({ ok: false }, { status: 400 });
  console.warn("[country-snapshots] indicator failure", {
    indicator: body.indicator,
    dataflow: body.dataflow,
    error: body.error?.slice(0, 200),
    uid: session.uid,
  });
  return NextResponse.json({ ok: true });
}
```

(Future enhancement: write to a dedicated DB table. For v1 console.warn is sufficient; the existing activity-monitoring infrastructure captures these.)

- [ ] **Step 2: Smoke and commit**

```bash
npm run build
git add app/api/countrysnapshots/log
git commit -m "country snapshots: partial-failure log endpoint"
```

---

### Task B4: Compare page (N-country)

**Files:**
- Create: `app/countrysnapshots/compare/[theme]/[...countries]/page.tsx`
- Create: `components/country-snapshots/compare-picker.tsx`

- [ ] **Step 1: Page route**

Create `app/countrysnapshots/compare/[theme]/[...countries]/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import {
  getSnapshotCatalogue,
  getCountry,
  getThemeBySlug,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { DashboardRenderer } from "@/components/country-snapshots/dashboard-renderer";
import { ComparePicker } from "@/components/country-snapshots/compare-picker";

const MAX_COMPARE = 5;

export const dynamic = "force-dynamic"; // compare combinations are open-ended

export default async function ComparePage({
  params,
}: {
  params: Promise<{ theme: string; countries: string[] }>;
}) {
  const { theme: themeSlug, countries: countryParam } = await params;
  const theme = getThemeBySlug(themeSlug);
  if (!theme) notFound();

  // URL shape: /compare/health/TO+WS+VU  → countryParam = ["TO+WS+VU"]
  // Alternative: /compare/health/TO/WS   → countryParam = ["TO", "WS"]
  // Support both.
  const codes = countryParam.flatMap((c) => c.split("+")).filter(Boolean);
  if (codes.length < 2 || codes.length > MAX_COMPARE) notFound();
  const countries = codes.map(getCountry);
  if (countries.some((c) => !c)) notFound();

  const cat = getSnapshotCatalogue();
  const config = buildSnapshotConfig({
    country: countries as NonNullable<typeof countries[number]>[],
    theme,
    catalogue: cat,
  });
  const safeCountries = countries as NonNullable<typeof countries[number]>[];

  return (
    <SnapshotPageShell
      title={`${safeCountries.map((c) => c.name).join(" vs ")} — ${theme.title}`}
      subtitle={`Compare of ${config.items.length} indicators across ${codes.length} countries`}
    >
      <ComparePicker
        theme={theme}
        countries={cat.countries}
        selected={codes}
      />
      <DashboardRenderer config={config} />
    </SnapshotPageShell>
  );
}
```

- [ ] **Step 2: Compare picker (client component)**

Create `components/country-snapshots/compare-picker.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";
import type { Country, Theme } from "@/lib/country-snapshots/catalogue";

const MAX = 5;

export function ComparePicker({
  theme,
  countries,
  selected,
}: {
  theme: Theme;
  countries: Country[];
  selected: string[];
}) {
  const router = useRouter();

  function go(codes: string[]) {
    router.push(`/countrysnapshots/compare/${theme.slug}/${codes.join("+")}`);
  }

  function toggle(code: string) {
    const has = selected.includes(code);
    const next = has ? selected.filter((c) => c !== code) : [...selected, code];
    if (next.length < 2) return;
    if (next.length > MAX) return;
    go(next);
  }

  return (
    <div className="mb-6 flex flex-wrap gap-2">
      {countries.map((c) => {
        const on = selected.includes(c.code);
        return (
          <button
            key={c.code}
            type="button"
            onClick={() => toggle(c.code)}
            className={
              "rounded-full px-3 py-1 text-xs " +
              (on
                ? "bg-[#004467] text-white"
                : "bg-[#f1f4f6] text-neutral-700 hover:bg-[#e5e9eb]")
            }
          >
            {c.name}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: Build and smoke**

```bash
npm run lint
npm run build
npm run dev
# Visit /countrysnapshots/compare/health/TO+WS
# Add a third country via the picker; URL updates and page re-renders.
```

- [ ] **Step 4: Commit**

```bash
git add app/countrysnapshots/compare components/country-snapshots/compare-picker.tsx
git commit -m "country snapshots: N-country compare page"
```

---

### Task B5: Entry page matrix index

**Files:**
- Modify: `app/countrysnapshots/page.tsx`
- Create: `components/country-snapshots/entry-page-matrix.tsx`

- [ ] **Step 1: Matrix component**

Create `components/country-snapshots/entry-page-matrix.tsx`:

```tsx
"use client";
import { useState } from "react";
import Link from "next/link";
import type { Country, Theme } from "@/lib/country-snapshots/catalogue";

export function EntryPageMatrix({
  countries,
  themes,
}: {
  countries: Country[];
  themes: Theme[];
}) {
  const [pivot, setPivot] = useState<"by-country" | "by-theme">("by-country");

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Browse</h2>
        <button
          type="button"
          onClick={() => setPivot(pivot === "by-country" ? "by-theme" : "by-country")}
          className="text-xs text-[#006970] underline"
        >
          {pivot === "by-country" ? "View by theme" : "View by country"}
        </button>
      </div>

      {pivot === "by-country" ? (
        <ul className="space-y-2">
          {countries.map((c) => (
            <li key={c.code} className="flex flex-wrap items-baseline gap-2">
              <span className="w-32 shrink-0 text-sm font-medium">{c.name}</span>
              {themes.map((t) => (
                <Link
                  key={t.id}
                  href={`/countrysnapshots/${c.code}/${t.slug}`}
                  className="rounded-full bg-[#f1f4f6] px-2 py-0.5 text-xs hover:bg-[#e5e9eb]"
                >
                  {t.title}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {themes.map((t) => (
            <li key={t.id} className="flex flex-wrap items-baseline gap-2">
              <span className="w-40 shrink-0 text-sm font-medium">{t.title}</span>
              {countries.map((c) => (
                <Link
                  key={c.code}
                  href={`/countrysnapshots/${c.code}/${t.slug}`}
                  className="rounded-full bg-[#f1f4f6] px-2 py-0.5 text-xs hover:bg-[#e5e9eb]"
                >
                  {c.code}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```

- [ ] **Step 2: Replace the placeholder entry page**

Replace `app/countrysnapshots/page.tsx`:

```tsx
import { notFound } from "next/navigation";
import { countrySnapshotsEnabled } from "@/lib/country-snapshots/feature-flag";
import { getSnapshotCatalogue } from "@/lib/country-snapshots/catalogue";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { EntryPageMatrix } from "@/components/country-snapshots/entry-page-matrix";

export default function CountrySnapshotsEntry() {
  if (!countrySnapshotsEnabled) notFound();
  const cat = getSnapshotCatalogue();

  return (
    <SnapshotPageShell
      title="Country Snapshots"
      subtitle="Curated indicators across 22 Pacific Island Countries and Territories."
    >
      <p className="text-sm text-neutral-700">
        Pick a country and theme to browse, or compare countries side by side. An AI assistant will be added shortly to help you explore further.
      </p>
      <EntryPageMatrix countries={cat.countries} themes={cat.themes} />
    </SnapshotPageShell>
  );
}
```

- [ ] **Step 3: Smoke and commit**

```bash
npm run lint
npm run build
git add app/countrysnapshots/page.tsx components/country-snapshots/entry-page-matrix.tsx
git commit -m "country snapshots: entry page matrix index"
```

---

### Task B6: PDF export

**Files:**
- Create: `components/country-snapshots/export-button.tsx`
- Modify: `app/countrysnapshots/[country]/[theme]/page.tsx`
- Modify: `app/countrysnapshots/compare/[theme]/[...countries]/page.tsx`

- [ ] **Step 1: Export button (client component)**

Create `components/country-snapshots/export-button.tsx`:

```tsx
"use client";
import { useState } from "react";

export function ExportButton({
  filenameStem,
}: {
  filenameStem: string;
}) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  async function exportPdf() {
    setBusy(true);
    setToast(null);
    try {
      const html2canvas = (await import("html2canvas")).default;
      const { jsPDF } = await import("jspdf");
      const main = document.querySelector("main") as HTMLElement | null;
      if (!main) {
        setToast("Couldn't find the page content.");
        return;
      }
      const canvas = await html2canvas(main, { scale: 2, useCORS: true, backgroundColor: "#ffffff" });
      const imgData = canvas.toDataURL("image/png");
      const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const ratio = canvas.height / canvas.width;
      const imgW = pageW - 40;
      const imgH = imgW * ratio;
      let position = 20;
      const stamp = new Date().toISOString().slice(0, 10);
      pdf.setFontSize(8);
      pdf.text(`SDMX Surfer — Country Snapshot — ${filenameStem} — ${stamp}`, 20, 14);
      pdf.addImage(imgData, "PNG", 20, position, imgW, imgH);
      pdf.setFontSize(7);
      pdf.text(
        `Data sourced from .Stat (Pacific Data Hub). Retrieved ${stamp}.`,
        20,
        pageH - 14,
      );
      pdf.save(`${filenameStem.replace(/\s+/g, "_")}_${stamp}.pdf`);
    } catch (err) {
      setToast("Some charts are still loading. Wait a moment and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={exportPdf}
        disabled={busy}
        className="rounded-md bg-[#006970] px-3 py-1 text-xs text-white disabled:opacity-60"
      >
        {busy ? "Generating…" : "Download PDF"}
      </button>
      {toast ? <span className="text-xs text-amber-700">{toast}</span> : null}
    </div>
  );
}
```

- [ ] **Step 2: Add the button to the canonical page**

Edit `app/countrysnapshots/[country]/[theme]/page.tsx`. Add to imports:

```tsx
import { ExportButton } from "@/components/country-snapshots/export-button";
```

Inside the `<SnapshotPageShell>`, above `<DashboardRenderer>`:

```tsx
<div className="mb-4 flex justify-end">
  <ExportButton filenameStem={`${country.name}_${theme.title}`} />
</div>
<DashboardRenderer config={config} />
```

- [ ] **Step 3: Add the button to the compare page**

Edit `app/countrysnapshots/compare/[theme]/[...countries]/page.tsx`. Add to imports:

```tsx
import { ExportButton } from "@/components/country-snapshots/export-button";
```

Inside the `<SnapshotPageShell>`, above `<DashboardRenderer>`:

```tsx
<div className="mb-4 flex justify-end">
  <ExportButton
    filenameStem={`${safeCountries.map((c) => c.name).join("_vs_")}_${theme.title}`}
  />
</div>
<DashboardRenderer config={config} />
```

- [ ] **Step 4: Smoke and commit**

```bash
npm run build
git add components/country-snapshots/export-button.tsx app/countrysnapshots/[country] app/countrysnapshots/compare
git commit -m "country snapshots: whole-page PDF export"
```

### Phase B checkpoint

After B6:
- `/countrysnapshots` shows the matrix index.
- `/countrysnapshots/TO/health` renders the canonical Tonga health page; "Download PDF" works.
- `/countrysnapshots/compare/health/TO+WS` renders the compare page; picker adds/removes countries.
- Both build modes succeed.
- Lint and tests green.

Stop here, ship to preview, validate with a sample audience before Phase C.

---

## Phase C — AI integration

### Task C1: Catalogue access — system prompt mode (path A)

**Files:**
- Create: `lib/country-snapshots/catalogue-access.ts`
- Create: `lib/country-snapshots/system-prompt.ts`

- [ ] **Step 1: Access interface and prompt-mode implementation**

Create `lib/country-snapshots/catalogue-access.ts`:

```ts
import { getSnapshotCatalogue, type Catalogue } from "./catalogue";

export type CatalogueAccessMode = "prompt" | "tool";

export function getMode(): CatalogueAccessMode {
  return process.env.SNAPSHOT_CATALOGUE_MODE === "tool" ? "tool" : "prompt";
}

/** Compact text rendering of the catalogue for system-prompt injection. */
export function renderCatalogueForPrompt(cat: Catalogue = getSnapshotCatalogue()): string {
  const lines: string[] = [];
  lines.push("# Country Snapshot Catalogue");
  lines.push(
    "You have prior knowledge of the following indicators, themes, and dataflows. " +
      "Use these to answer questions about Country Snapshots without re-discovering dataflows.",
  );
  lines.push("");
  for (const t of cat.themes) {
    lines.push(`## ${t.title} (id=${t.id}, slug=${t.slug})`);
    const inds = cat.indicators.filter((i) => i.themeId === t.id);
    for (const i of inds) {
      const src = i.dataflow ? ` [dataflow=${i.dataflow}]` : " [no data source]";
      lines.push(`- ${i.id} ${i.title}${src}`);
    }
    lines.push("");
  }
  lines.push("Countries (code: name, region, mfat=1|0):");
  for (const c of cat.countries) {
    lines.push(`- ${c.code}: ${c.name}, ${c.region}, mfat=${c.mfatRelevant ? 1 : 0}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 2: Snapshot-specific system prompt**

Create `lib/country-snapshots/system-prompt.ts`:

```ts
import { getSnapshotCatalogue } from "./catalogue";
import { getMode, renderCatalogueForPrompt } from "./catalogue-access";

export type SnapshotContext = {
  countryCodes: string[];
  themeSlug: string;
  indicatorIds: string[];
};

export function buildSnapshotSystemPrompt(args: {
  baseSystemPrompt: string;
  ctx: SnapshotContext;
}): string {
  const parts: string[] = [args.baseSystemPrompt];

  if (getMode() === "prompt") {
    parts.push("");
    parts.push(renderCatalogueForPrompt());
  }
  // In tool mode we register a tool instead (see Task C2); no prompt block.

  parts.push("");
  parts.push("# Current Snapshot Context");
  parts.push(`Country/countries: ${args.ctx.countryCodes.join(", ")}`);
  parts.push(`Theme slug: ${args.ctx.themeSlug}`);
  parts.push(`Indicators visible: ${args.ctx.indicatorIds.join(", ")}`);
  parts.push(
    "Answer questions about what is on the page. You cannot modify the snapshot. " +
      "If the user wants to add indicators or change the view, suggest they use 'Explore in Surfer'.",
  );

  return parts.join("\n");
}
```

- [ ] **Step 3: Quick test of prompt rendering**

Append to `tests/country-snapshots/catalogue.test.ts`:

```ts
import { renderCatalogueForPrompt } from "../../lib/country-snapshots/catalogue-access";

describe("renderCatalogueForPrompt", () => {
  it("includes every theme and every indicator", () => {
    const text = renderCatalogueForPrompt(real);
    for (const t of real.themes) {
      expect(text).toContain(`## ${t.title}`);
    }
    for (const i of real.indicators) {
      expect(text).toContain(i.id);
    }
  });
});
```

- [ ] **Step 4: Test, lint, commit**

```bash
npm test
npm run lint
git add lib/country-snapshots/catalogue-access.ts lib/country-snapshots/system-prompt.ts tests/country-snapshots/catalogue.test.ts
git commit -m "country snapshots: catalogue access (prompt mode) and snapshot system prompt"
```

---

### Task C2: Catalogue access — tool mode (path B)

**Files:**
- Modify: `lib/country-snapshots/catalogue-access.ts`

- [ ] **Step 1: Add tool definition**

Append to `lib/country-snapshots/catalogue-access.ts`:

```ts
import { tool } from "ai";
import { z } from "zod";

export const catalogueTool = tool({
  description:
    "Look up Country Snapshot indicators by theme or country. Returns up to 50 matches.",
  inputSchema: z.object({
    themeSlug: z.string().optional(),
    countryCode: z.string().optional(),
    search: z.string().optional(),
  }),
  execute: async ({ themeSlug, countryCode, search }) => {
    const cat = getSnapshotCatalogue();
    let inds = cat.indicators;
    if (themeSlug) {
      const t = cat.themes.find((th) => th.slug === themeSlug);
      if (!t) return { error: "unknown theme slug" };
      inds = inds.filter((i) => i.themeId === t.id);
    }
    if (search) {
      const q = search.toLowerCase();
      inds = inds.filter(
        (i) => i.title.toLowerCase().includes(q) || i.id.toLowerCase().includes(q),
      );
    }
    const trimmed = inds.slice(0, 50).map((i) => ({
      id: i.id,
      themeId: i.themeId,
      title: i.title,
      dataflow: i.dataflow,
      hasDataSource: Boolean(i.apiUrlTemplate),
    }));
    return {
      countryContext: countryCode ?? null,
      indicators: trimmed,
      total: inds.length,
      truncated: inds.length > 50,
    };
  },
});
```

(Adjust the `import { tool } from "ai"` if the project pins a specific subpath. Confirm with `grep -r "from \"ai\"" lib/` first.)

- [ ] **Step 2: Smoke and commit**

```bash
npm run lint
npm run build
git add lib/country-snapshots/catalogue-access.ts
git commit -m "country snapshots: catalogue access (tool mode)"
```

---

### Task C3: Chat overlay UI + endpoint

**Files:**
- Create: `lib/country-snapshots/turn-cap.ts`
- Create: `app/api/countrysnapshots/chat/route.ts`
- Create: `components/country-snapshots/chat-overlay.tsx`
- Modify: `app/countrysnapshots/[country]/[theme]/page.tsx`
- Modify: `app/countrysnapshots/compare/[theme]/[...countries]/page.tsx`

- [ ] **Step 1: Read the existing chat patterns**

Before writing the endpoint, read the main chat route and the model router to mirror their patterns. Skim these:

```bash
sed -n '1,200p' app/api/chat/route.ts
sed -n '1,80p' lib/model-router.ts
sed -n '1,80p' lib/system-prompt.ts
grep -n "messages" lib/db/schema.ts
```

Confirm:
- The exact export name of the base system prompt (commonly `SYSTEM_PROMPT` or `getBaseSystemPrompt()` or similar).
- The shape used when writing `messages` into `dashboardSessions` (it is `jsonb` in the schema, expect an array of message objects).
- Whether `streamText` is imported from `"ai"` directly or through a project wrapper.

Adapt the imports in the steps below to match what you find.

- [ ] **Step 2: Per-cookie turn-cap helper**

Create `lib/country-snapshots/turn-cap.ts`:

```ts
import { db, dashboardSessions, usageLogs } from "@/lib/db";
import { and, eq, gte } from "drizzle-orm";

const DAILY_TURN_CAP = Number(process.env.SNAPSHOT_CHAT_DAILY_TURNS ?? "10");

/**
 * Counts usage_logs rows attributed to the snapshot anon user in the last 24h.
 * Returns whether the user is allowed to continue and the current count.
 */
export async function checkTurnCap(userId: string): Promise<{
  allowed: boolean;
  used: number;
  cap: number;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: usageLogs.id })
    .from(usageLogs)
    .where(and(eq(usageLogs.user_id, userId), gte(usageLogs.created_at, since)));
  const used = rows.length;
  return { allowed: used < DAILY_TURN_CAP, used, cap: DAILY_TURN_CAP };
}
```

- [ ] **Step 3: Chat endpoint with cap + minimal persistence**

Create `app/api/countrysnapshots/chat/route.ts`:

```ts
import { NextResponse } from "next/server";
import { streamText, convertToModelMessages } from "ai";
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";
import {
  buildSnapshotSystemPrompt,
  type SnapshotContext,
} from "@/lib/country-snapshots/system-prompt";
import { getMode, catalogueTool } from "@/lib/country-snapshots/catalogue-access";
import { checkTurnCap } from "@/lib/country-snapshots/turn-cap";
import { getModelForUser } from "@/lib/model-router";
// Replace the import below with the actual export name confirmed in Step 1.
import { SYSTEM_PROMPT as BASE_SYSTEM_PROMPT } from "@/lib/system-prompt";
import { db, dashboardSessions, usageLogs } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function POST(req: Request) {
  const session = await requireSnapshotSession();
  if (!session) return NextResponse.json({ error: "unauthorised" }, { status: 401 });

  const cap = await checkTurnCap(session.userId);
  if (!cap.allowed) {
    return NextResponse.json(
      {
        error: "cap-reached",
        message:
          "You've reached today's free limit. Sign in via 'Explore in Surfer' to continue.",
        used: cap.used,
        cap: cap.cap,
      },
      { status: 429 },
    );
  }

  const body = (await req.json()) as {
    messages: { role: string; content: string }[];
    snapshotContext: SnapshotContext;
    sessionId?: string;
  };

  const system = buildSnapshotSystemPrompt({
    baseSystemPrompt: BASE_SYSTEM_PROMPT,
    ctx: body.snapshotContext,
  });
  const { model } = await getModelForUser(session.userId);
  const tools = getMode() === "tool" ? { list_catalogue_indicators: catalogueTool } : undefined;

  const result = streamText({
    model,
    system,
    messages: convertToModelMessages(
      body.messages as Parameters<typeof convertToModelMessages>[0],
    ),
    tools,
    onFinish: async ({ text, usage }) => {
      try {
        // Persist a usage log row for the cap and for cost tracking.
        await db.insert(usageLogs).values({
          user_id: session.userId,
          session_id: body.sessionId ?? null,
          request_id: crypto.randomUUID(),
          user_message: body.messages.at(-1)?.content?.toString().slice(0, 4000) ?? "",
          ai_response: text.slice(0, 16000),
          input_tokens: usage?.inputTokens ?? null,
          output_tokens: usage?.outputTokens ?? null,
          model: null,
          provider: null,
          key_source: "platform-gateway",
        });

        // Persist the conversation to dashboardSessions for resumability.
        if (body.sessionId) {
          await db
            .update(dashboardSessions)
            .set({
              messages: [...body.messages, { role: "assistant", content: text }] as any,
              updated_at: new Date(),
            })
            .where(eq(dashboardSessions.id, body.sessionId));
        } else {
          await db.insert(dashboardSessions).values({
            user_id: session.userId,
            title: `Snapshot chat — ${body.snapshotContext.countryCodes.join("+")} ${body.snapshotContext.themeSlug}`,
            messages: [...body.messages, { role: "assistant", content: text }] as any,
            config_history: [] as any,
            config_pointer: -1,
          });
        }
      } catch (err) {
        console.warn("[country-snapshots] persistence failed", err);
      }
    },
  });

  return result.toUIMessageStreamResponse();
}
```

Two implementation notes the engineer should verify against the codebase patterns from Step 1:

- The `streamText` `onFinish` signature and the `usage` field name. Some `ai` versions use `inputTokens`/`outputTokens`, others `promptTokens`/`completionTokens`. Match the existing chat route's usage.
- The `messages` field in `dashboardSessions` is `jsonb`. Cast with `as any` to satisfy Drizzle's strict typing, or define a typed message shape.

- [ ] **Step 4: Chat overlay component**

Create `components/country-snapshots/chat-overlay.tsx`:

```tsx
"use client";
import { useState } from "react";
import { useChat } from "@ai-sdk/react"; // confirm import path matches the rest of the app
import type { SnapshotContext } from "@/lib/country-snapshots/system-prompt";

export function ChatOverlay({
  snapshotContext,
}: {
  snapshotContext: SnapshotContext;
}) {
  const [open, setOpen] = useState(false);

  const { messages, sendMessage, status } = useChat({
    api: "/api/countrysnapshots/chat",
    body: { snapshotContext },
  });

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="fixed bottom-6 right-6 rounded-full bg-[#004467] px-4 py-2 text-sm text-white shadow"
      >
        {open ? "Close chat" : "Ask the assistant"}
      </button>
      {open ? (
        <aside className="fixed bottom-20 right-6 flex h-[60vh] w-96 flex-col rounded-md bg-white shadow-lg">
          <header className="border-b border-neutral-200 px-3 py-2 text-xs font-medium">
            Assistant — read-only chat
          </header>
          <div className="flex-1 overflow-y-auto p-3 text-sm">
            {messages.map((m) => (
              <div key={m.id} className="mb-2">
                <span className="font-medium">{m.role}: </span>
                {typeof m.content === "string" ? m.content : ""}
              </div>
            ))}
            {status === "in_progress" ? (
              <p className="text-xs italic text-neutral-500">thinking…</p>
            ) : null}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const fd = new FormData(e.currentTarget);
              const text = String(fd.get("q") ?? "");
              if (!text.trim()) return;
              sendMessage({ text });
              e.currentTarget.reset();
            }}
            className="border-t border-neutral-200 p-2"
          >
            <input
              name="q"
              placeholder="Ask about this snapshot…"
              className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
            />
          </form>
          <div className="border-t border-neutral-200 px-3 py-2 text-xs">
            <a
              href={`/api/countrysnapshots/fork?country=${snapshotContext.countryCodes.join(",")}&theme=${snapshotContext.themeSlug}`}
              className="text-[#006970] underline"
            >
              Explore in Surfer (sign in required)
            </a>
          </div>
        </aside>
      ) : null}
    </>
  );
}
```

If the project uses a different chat hook (check by reading `app/builder/`), adapt accordingly. The streaming hook and tool-call rendering may differ from `useChat`.

- [ ] **Step 5: Add the overlay to the canonical page**

In `app/countrysnapshots/[country]/[theme]/page.tsx`, add to imports:

```tsx
import { ChatOverlay } from "@/components/country-snapshots/chat-overlay";
```

At the end of the `<SnapshotPageShell>` body (after `<DashboardRenderer>`):

```tsx
<ChatOverlay
  snapshotContext={{
    countryCodes: [country.code],
    themeSlug: theme.slug,
    indicatorIds: config.items.map((i) => i.id),
  }}
/>
```

- [ ] **Step 6: Add the overlay to the compare page**

In `app/countrysnapshots/compare/[theme]/[...countries]/page.tsx`, add to imports:

```tsx
import { ChatOverlay } from "@/components/country-snapshots/chat-overlay";
```

At the end of the `<SnapshotPageShell>` body (after `<DashboardRenderer>`):

```tsx
<ChatOverlay
  snapshotContext={{
    countryCodes: safeCountries.map((c) => c.code),
    themeSlug: theme.slug,
    indicatorIds: config.items.map((i) => i.id),
  }}
/>
```

- [ ] **Step 7: Smoke and commit**

```bash
npm run lint
npm run build
git add lib/country-snapshots/turn-cap.ts app/api/countrysnapshots/chat app/countrysnapshots/[country] app/countrysnapshots/compare components/country-snapshots/chat-overlay.tsx
git commit -m "country snapshots: chat overlay UI + endpoint (read-only, capped, persisted)"
```

---

### Task C4: Fork-to-Surfer handshake

**Files:**
- Create: `app/api/countrysnapshots/fork/route.ts`

- [ ] **Step 1: Fork endpoint**

Create `app/api/countrysnapshots/fork/route.ts`:

```ts
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth"; // confirm export name
import { requireSnapshotSession } from "@/lib/country-snapshots/auth";
import {
  getCountry,
  getThemeBySlug,
  getSnapshotCatalogue,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";
import { db, dashboardSessions } from "@/lib/db";

export async function GET(req: Request) {
  return handle(req);
}

export async function POST(req: Request) {
  return handle(req);
}

async function handle(req: Request) {
  const snap = await requireSnapshotSession();
  if (!snap) return NextResponse.redirect(new URL("/countrysnapshots/login", req.url), 303);

  const url = new URL(req.url);
  const countryParam = url.searchParams.get("country") ?? "";
  const themeSlug = url.searchParams.get("theme") ?? "";
  const codes = countryParam.split(",").filter(Boolean);
  if (codes.length === 0 || !themeSlug) {
    return NextResponse.json({ error: "missing country/theme" }, { status: 400 });
  }
  const theme = getThemeBySlug(themeSlug);
  const countries = codes.map(getCountry);
  if (!theme || countries.some((c) => !c)) {
    return NextResponse.json({ error: "unknown country/theme" }, { status: 400 });
  }

  // Require a real Surfer account.
  const surferSession = await getServerSession(authOptions);
  if (!surferSession?.user?.userId) {
    const next = encodeURIComponent(req.url);
    return NextResponse.redirect(new URL(`/login?next=${next}`, req.url), 303);
  }

  const cat = getSnapshotCatalogue();
  const config = buildSnapshotConfig({
    country: countries.length === 1 ? countries[0]! : (countries as NonNullable<typeof countries[number]>[]),
    theme,
    catalogue: cat,
  });

  const title = `${countries.map((c) => c!.name).join(" vs ")} — ${theme.title} (forked from snapshot)`;
  const messageNote = {
    role: "system" as const,
    content: `This session was forked from a Country Snapshot for ${countries
      .map((c) => c!.name)
      .join(", ")}, ${theme.title}.`,
  };

  const [row] = await db
    .insert(dashboardSessions)
    .values({
      user_id: surferSession.user.userId,
      title,
      config_history: [config] as unknown as any,
      config_pointer: 0,
      messages: [messageNote] as unknown as any,
    })
    .returning();

  return NextResponse.redirect(new URL(`/builder?session=${row.id}`, req.url), 303);
}
```

Confirm the actual property names (`authOptions` export, `dashboardSessions` column types for jsonb fields) against `lib/auth.ts` and `lib/db/schema.ts`.

- [ ] **Step 2: Smoke and commit**

```bash
npm run lint
npm run build
git add app/api/countrysnapshots/fork
git commit -m "country snapshots: fork-to-Surfer handshake"
```

---

### Task C5: Entry page chat starter

**Files:**
- Create: `components/country-snapshots/chat-starter.tsx`
- Modify: `app/countrysnapshots/page.tsx`

- [ ] **Step 1: Chat starter component**

Create `components/country-snapshots/chat-starter.tsx`:

```tsx
"use client";
import { useRouter } from "next/navigation";

const EXAMPLES = [
  "Show me Tonga education over the last decade",
  "How does Solomon Islands fisheries compare to Vanuatu?",
  "What has been changing in Pacific tobacco use?",
  "Which PICTs have the most data on climate adaptation?",
  "Compare governance indicators across Melanesia",
  "Population trends in the smallest PICTs",
];

export function ChatStarter() {
  const router = useRouter();

  function start(prompt: string) {
    const target = `/countrysnapshots/chat?prompt=${encodeURIComponent(prompt)}`;
    router.push(target);
  }

  return (
    <section>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const fd = new FormData(e.currentTarget);
          const text = String(fd.get("q") ?? "");
          if (text.trim()) start(text);
        }}
        className="flex gap-2"
      >
        <input
          name="q"
          placeholder="Ask the assistant…"
          className="flex-1 rounded-md border border-neutral-300 px-3 py-2"
        />
        <button type="submit" className="rounded-md bg-[#004467] px-4 py-2 text-sm text-white">
          Ask
        </button>
      </form>
      <div className="mt-3 flex flex-wrap gap-2">
        {EXAMPLES.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => start(p)}
            className="rounded-full bg-[#f1f4f6] px-3 py-1 text-xs hover:bg-[#e5e9eb]"
          >
            {p}
          </button>
        ))}
      </div>
    </section>
  );
}
```

(`/countrysnapshots/chat` is a route we can stub later: for v1 it can redirect to the country/theme pages with the chat overlay open, or be a simple dedicated chat page. Mark as a small follow-up; the starter UI is the testable surface.)

- [ ] **Step 2: Add the starter to the entry page**

Edit `app/countrysnapshots/page.tsx`:

```tsx
import { ChatStarter } from "@/components/country-snapshots/chat-starter";

// inside the SnapshotPageShell, before <EntryPageMatrix>:
<ChatStarter />
<EntryPageMatrix countries={cat.countries} themes={cat.themes} />
```

- [ ] **Step 3: Smoke and commit**

```bash
npm run lint
npm run build
git add components/country-snapshots/chat-starter.tsx app/countrysnapshots/page.tsx
git commit -m "country snapshots: entry page chat starter"
```

### Phase C checkpoint

After C5:
- All Phase A and B functionality intact.
- Chat overlay opens on canonical and compare pages, exchanges messages, reflects snapshot context.
- "Explore in Surfer" link redirects authenticated users into `/builder?session=…` with a forked session containing the snapshot config and a note.
- Entry page shows chat starter chips alongside the matrix.
- Both build modes still succeed.

Stop here. Run the full v1 smoke checklist from spec §14.4 before sharing with MFAT.

---

## Cross-cutting follow-ups (post-v1)

The plan leaves these explicit follow-ups for a later sweep:

1. `/countrysnapshots/chat` route (referenced by `ChatStarter` in Task C5). Decide UX: dedicated page or auto-route to most-recent snapshot with the starter prompt as the first message.
2. Per-country static facts (Head of State, etc.). Catalogue schema extension plus per-country values file.
3. MFAT-branded PDF cover.
4. Snapshot-anon cleanup job for inactive cookies after 90 days.
5. Lock in catalogue access mode (prompt vs tool) after running a fixture comparison; remove the unused path.
6. Aggregate region compare (Q7 options C/D) if MFAT requests it.

## Self-review notes (from plan author)

- All ten settled decisions from the spec §3 are covered by tasks. Cross-checks:
  - Q1 hybrid + fork: Tasks B2 (canonical), C4 (fork).
  - Q2 importer + JSON: Tasks A3, A4.
  - Q3 client-side data: Task B2 (renderer uses library; no server fetches).
  - Q4 swappable catalogue access: Tasks C1 (prompt), C2 (tool).
  - Q5 anon-persisted + real account for fork: Tasks A6 (anon), C3 (overlay persists under anon), C4 (requires Surfer session).
  - Q6 dense one-pager: Task B2.
  - Q7 N-country compare: Task B4.
  - Q8 PDF only: Task B6.
  - Q9 split entry page: Tasks B5 (matrix), C5 (chat starter).
  - Module boundary + build flag: Task A1.
- No `TBD`/`TODO`/`fill in later` placeholders in step bodies. Conditional verifications ("confirm export name", "if the library API differs, replace with the real props") are realistic engineering instructions for known unknowns (external library shape, project-internal export names) and resolved during the task by reading the named file.
- Type consistency: `SnapshotContext` defined in `system-prompt.ts` (Task C1) is consumed by `chat/route.ts` and `chat-overlay.tsx` (Task C3) with identical field names. `SnapshotConfig` and `DashboardItem` defined in `config-builder.ts` (Task B1) are used by `dashboard-renderer.tsx` (Task B2) and by the fork endpoint (Task C4). The `requireSnapshotSession` helper returns `{ uid, userId }` consistently across the log route (B3), chat route (C3), and fork route (C4).
