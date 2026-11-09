#!/usr/bin/env node
/**
 * Import the MFAT country snapshots spreadsheet into a typed catalogue.
 *
 * Countries come from the `REPORTS` sheet; themes and indicators from
 * INDICATOR_SHEET. SUMMARY and PICTURE rows are layout rows of the printed
 * snapshot, not indicators, and are skipped. Indicator URLs that lack the
 * [TAG_GEO] country placeholder are not guessed at: they stay out of the
 * catalogue and are listed in the report for the curators.
 *
 * Usage:
 *   tsx scripts/import-country-snapshots.ts \
 *     --in  data/country-snapshots/country_snapshots_2026.xlsx \
 *     --out lib/country-snapshots/catalogue.generated.ts \
 *     --report data/country-snapshots/import-report.md
 */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { basename } from "node:path";
import ExcelJS from "exceljs";
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
    missingCountryPlaceholder: string[];
    duplicates: string[];
  };
};

/** SPC's 2026 exercise list of snapshot indicators (upstream `work` sheet). */
const INDICATOR_SHEET = "work";

/** Row types that lay out the printed snapshot but are not indicators. */
const LAYOUT_ROW_TYPES: Record<string, true> = { SUMMARY: true, PICTURE: true };

const RENDERING_VALUES: Rendering[] = ["TABLE", "CHART", "MAP", "TEXT"];

function cellToString(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value instanceof Date) return value.toISOString();
  // Cells with mixed formatting (several 2026 rows) come back as rich text.
  if ("richText" in value) return value.richText.map((r) => r.text).join("").trim();
  if ("hyperlink" in value) return (value.text || value.hyperlink).trim();
  if ("result" in value) return cellToString(value.result);
  return "";
}

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/**
 * Two normalisations applied to every URL:
 *
 *   1. Drop the dataflow version pin: `SPC,DF_X,3.0/` → `SPC,DF_X,/` (per the
 *      2026 spreadsheet update notes from C. Idler).
 *   2. Migrate legacy hosts to the canonical SPC endpoint
 *      `stats-sdmx-disseminate.pacificdata.org`. Older spreadsheets used
 *      `stats-nsi-stable.pacificdata.org` for many indicators; both hosts
 *      currently resolve to the same backend, but the MCP gateway and the
 *      rest of Surfer use the disseminate one, so we standardise on it.
 *
 * SDG dataflows (DF_SDG_*) were restructured in 2026 (15 key positions
 * instead of 11, renamed codelists). The 2026 exercise list carries URLs
 * already written for the new layout, so they go through the same
 * normalisation as every other row.
 */
function normaliseUrl(raw: string): { url: string; fixed: boolean } {
  let out = raw.replace(/(SPC,[^,]+,)\d+(?:\.\d+)?\//g, "$1/");
  out = out.replace(
    /stats-nsi-stable\.pacificdata\.org/g,
    "stats-sdmx-disseminate.pacificdata.org",
  );
  return { url: out, fixed: out !== raw };
}

export async function importExcel(
  buffer: Buffer,
  sourceName: string,
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  // exceljs typings predate Node's generic Buffer<ArrayBufferLike>; runtime accepts it.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  const reportsSheet = wb.getWorksheet("REPORTS");
  const indicatorsSheet = wb.getWorksheet(INDICATOR_SHEET);
  if (!reportsSheet || !indicatorsSheet) {
    throw new Error(
      `Workbook ${sourceName} is missing REPORTS or ${INDICATOR_SHEET} sheet`,
    );
  }

  const skippedRows: string[] = [];
  const urlFixups: string[] = [];
  const missingDataSources: string[] = [];
  const missingCountryPlaceholder: string[] = [];
  const duplicates: string[] = [];

  // ---- Countries (skip header row 1) ----
  const countries: Country[] = [];
  const seenCountry = new Set<string>();
  reportsSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const cells = Array.isArray(row.values) ? row.values : [];
    // ExcelJS row.values is 1-indexed (cells[0] is undefined).
    const DO = cells[1];
    const MFAT = cells[2];
    const CD = cellToString(cells[3]);
    const EN = cellToString(cells[4]);
    const REG = cellToString(cells[5]) as Region;
    void DO;
    if (!CD || !EN) {
      skippedRows.push(`REPORTS row ${rowNumber}: missing code or name`);
      return;
    }
    if (!["POL", "MEL", "MIC"].includes(REG)) {
      skippedRows.push(
        `REPORTS row ${rowNumber} (${CD}): invalid region "${REG}"`,
      );
      return;
    }
    if (seenCountry.has(CD)) {
      duplicates.push(`Duplicate country code: ${CD}`);
      return;
    }
    seenCountry.add(CD);
    countries.push({
      code: CD,
      name: EN,
      region: REG,
      mfatRelevant: Number(MFAT ?? 0) === 1,
    });
  });

  // ---- Themes and indicators (skip header row 1) ----
  const themes: Theme[] = [];
  const themeBySlug = new Map<string, Theme>();
  const indicatorsOut: Indicator[] = [];
  const seenIndicator = new Set<string>();
  let currentThemeId: string | null = null;
  let order = 0;

  indicatorsSheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    if (rowNumber === 1) return; // header
    const cells = Array.isArray(row.values) ? row.values : [];
    // Columns (1-indexed): RID DO TYPE ID EN MFAT_NAME RENDERING DE API COMMENT1 DF COMMENT2 COMMENT_2025 COMMENT_2026
    const TYPE = cellToString(cells[3]);
    const ID = cellToString(cells[4]);
    const EN = cellToString(cells[5]);
    const MFAT_NAME = cellToString(cells[6]);
    const renderingRaw = cellToString(cells[7]).toUpperCase();
    // Spreadsheet uses "-" for indicators without a defined rendering;
    // treat these as TEXT (static fact placeholders) so they still appear in the catalogue.
    const RENDERING = (renderingRaw === "-" || renderingRaw === ""
      ? "TEXT"
      : renderingRaw) as Rendering;
    const DE = cellToString(cells[8]);
    const API = cellToString(cells[9]);
    const COMMENT1 = cellToString(cells[10]);
    const DF = cellToString(cells[11]);
    const COMMENT2 = cellToString(cells[12]);
    const COMMENT_2025 = cellToString(cells[13]);
    const COMMENT_2026 = cellToString(cells[14]);

    if (TYPE === "HEADING") {
      currentThemeId = ID;
      const t: Theme = {
        id: ID,
        slug: slugify(EN),
        title: EN,
        order: ++order,
      };
      if (themeBySlug.has(t.slug)) {
        throw new Error(`Duplicate theme slug "${t.slug}" from "${EN}"`);
      }
      themeBySlug.set(t.slug, t);
      themes.push(t);
      return;
    }
    if (LAYOUT_ROW_TYPES[TYPE]) return;
    if (TYPE !== "INDICATOR") {
      skippedRows.push(`${INDICATOR_SHEET} row ${rowNumber}: unknown type "${TYPE}"`);
      return;
    }
    if (!currentThemeId) {
      skippedRows.push(
        `${INDICATOR_SHEET} row ${rowNumber} (${ID}): INDICATOR before any HEADING`,
      );
      return;
    }
    if (seenIndicator.has(ID)) {
      duplicates.push(`Duplicate indicator id: ${ID}`);
      return;
    }
    seenIndicator.add(ID);

    if (!RENDERING_VALUES.includes(RENDERING)) {
      skippedRows.push(
        `${INDICATOR_SHEET} row ${rowNumber} (${ID}): unknown rendering "${RENDERING}"`,
      );
      return;
    }

    let apiUrlTemplate: string | undefined;
    if (API && API !== "-") {
      const { url, fixed } = normaliseUrl(API);
      if (!url.includes("[TAG_GEO]")) {
        missingCountryPlaceholder.push(`${ID}: ${EN}: \`${url}\``);
        return;
      }
      if (fixed) urlFixups.push(`${ID}: ${API} -> ${url}`);
      apiUrlTemplate = url;
    } else {
      missingDataSources.push(ID);
    }

    const visUrl = DE && DE !== "-" ? DE : undefined;
    const noteParts = [COMMENT1, COMMENT2, COMMENT_2025, COMMENT_2026]
      .map((s) => s.trim())
      .filter((s) => s && s !== "-");
    const notes = noteParts.length ? noteParts.join(" | ") : undefined;

    indicatorsOut.push({
      id: ID,
      themeId: currentThemeId,
      title: EN,
      mfatName: MFAT_NAME && MFAT_NAME !== EN ? MFAT_NAME : undefined,
      rendering: RENDERING,
      dataflow: DF && DF !== "-" ? DF : undefined,
      apiUrlTemplate,
      visUrl,
      notes,
    });
  });

  // Stable order for diff-friendly output.
  indicatorsOut.sort((a, b) =>
    a.id.localeCompare(b.id, "en", { numeric: true }),
  );

  return {
    catalogue: {
      generatedAt: new Date().toISOString().slice(0, 10) + "T00:00:00Z",
      sourceFile: sourceName,
      countries,
      themes,
      indicators: indicatorsOut,
    },
    report: {
      skippedRows,
      urlFixups,
      missingDataSources,
      missingCountryPlaceholder,
      duplicates,
    },
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
    section("Rows without a country placeholder", report.missingCountryPlaceholder),
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
  const { catalogue, report } = await importExcel(buf, basename(values.in));
  writeFileSync(values.out, renderCatalogueTs(catalogue), "utf8");
  writeFileSync(values.report, renderReportMd(report, basename(values.in)), "utf8");
  console.error(
    `Wrote ${catalogue.indicators.length} indicators across ${catalogue.themes.length} themes for ${catalogue.countries.length} countries.`,
  );
}

// Run if invoked directly.
if (process.argv[1] && process.argv[1].endsWith("import-country-snapshots.ts")) {
  void main();
}
