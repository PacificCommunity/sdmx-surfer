#!/usr/bin/env node
/**
 * Consolidate paired catalogue indicators that differ only in a single
 * stratification dimension (typically SEX or URBANIZATION).
 *
 * Detection: for each (themeId, dataflow) group, find sets of >=2 indicators
 * whose URL keys are byte-identical EXCEPT in exactly one position. Such a
 * group is collapsed into a single consolidated indicator with:
 *   - URL: differing position's values joined with "+" so the query returns
 *     all sub-series at once (e.g. SEX=M+F+_T).
 *   - title: longest common prefix of the source titles, trimmed.
 *   - seriesConcept: the SDMx dimension name at the differing position,
 *     looked up from data/country-snapshots/dataflow-dimensions.json.
 *   - consolidatedFromIds: the source indicator ids, kept for diff review.
 *
 * Dataflows without a dim template in dataflow-dimensions.json are skipped
 * with a warning. Add an entry there to extend coverage.
 *
 * Usage:
 *   tsx scripts/consolidate-country-snapshot-indicators.ts
 *     [--in lib/country-snapshots/catalogue.generated.ts]
 *     [--out lib/country-snapshots/catalogue.generated.ts]
 *     [--report data/country-snapshots/consolidation-report.md]
 */
import { parseArgs } from "node:util";
import { readFileSync, writeFileSync } from "node:fs";
import { catalogue } from "../lib/country-snapshots/catalogue.generated";
import type {
  Catalogue,
  Indicator,
} from "../lib/country-snapshots/catalogue";

const DIM_TEMPLATES_PATH = "data/country-snapshots/dataflow-dimensions.json";
const DEFAULT_OUT = "lib/country-snapshots/catalogue.generated.ts";

function loadDimTemplates(): Record<string, string[]> {
  try {
    return JSON.parse(readFileSync(DIM_TEMPLATES_PATH, "utf8")) as Record<
      string,
      string[]
    >;
  } catch {
    return {};
  }
}

type ParsedKey = { prefix: string; parts: string[]; querySuffix: string };

/** Parse the dataset key segment out of an apiUrlTemplate. */
function parseUrl(url: string): ParsedKey | null {
  // Match: <prefix up to and including SPC,DF_X,/> {KEY} (? optional query)
  const m = url.match(/^(.*\/SPC,[^,]+,\/)([^?]+)(\?.*)?$/);
  if (!m) return null;
  return { prefix: m[1], parts: m[2].split("."), querySuffix: m[3] ?? "" };
}

function joinUrl(p: ParsedKey): string {
  return p.prefix + p.parts.join(".") + p.querySuffix;
}

/** Indices where two parsed keys differ. */
function diffIndices(a: ParsedKey, b: ParsedKey): number[] {
  if (a.parts.length !== b.parts.length) return [-1];
  const idx: number[] = [];
  for (let i = 0; i < a.parts.length; i++) {
    if (a.parts[i] !== b.parts[i]) idx.push(i);
  }
  return idx;
}

/**
 * Longest common prefix of strings, with extra tidying so paired-indicator
 * titles like "Foo (%)" / "Foo (% - male)" reduce to "Foo" rather than
 * "Foo (%" with a dangling open paren.
 */
function longestCommonPrefix(strs: string[]): string {
  if (strs.length === 0) return "";
  let prefix = strs[0];
  for (let i = 1; i < strs.length; i++) {
    while (!strs[i].startsWith(prefix)) {
      prefix = prefix.slice(0, -1);
      if (!prefix) return "";
    }
  }
  // Strip trailing whitespace and lightweight punctuation.
  let out = prefix.replace(/[\s\-(:,/]+$/u, "").trim();
  // If we still have an unbalanced trailing "(" (e.g. "Foo (%"), drop
  // everything from the last unmatched "(".
  const opens = (out.match(/\(/g) ?? []).length;
  const closes = (out.match(/\)/g) ?? []).length;
  if (opens > closes) {
    const lastOpen = out.lastIndexOf("(");
    if (lastOpen >= 0) out = out.slice(0, lastOpen).trim();
  }
  return out.replace(/[\s\-,:/]+$/u, "").trim();
}

/**
 * Find groups of indicators within (theme, dataflow) that share an
 * identical URL structure except in exactly one position. Returns groups
 * keyed by a canonical structural key.
 */
function findGroups(indicators: Indicator[]): Map<string, Indicator[]> {
  const groups = new Map<string, Indicator[]>();
  for (let i = 0; i < indicators.length; i++) {
    const a = indicators[i];
    if (!a.apiUrlTemplate) continue;
    const pa = parseUrl(a.apiUrlTemplate);
    if (!pa) continue;
    for (let j = i + 1; j < indicators.length; j++) {
      const b = indicators[j];
      if (b.themeId !== a.themeId) continue;
      if (b.dataflow !== a.dataflow) continue;
      if (!b.apiUrlTemplate) continue;
      const pb = parseUrl(b.apiUrlTemplate);
      if (!pb) continue;
      const diff = diffIndices(pa, pb);
      if (diff.length !== 1) continue;
      // Canonical key: theme + dataflow + parts with diff position replaced by "*"
      const idx = diff[0];
      const canon = pa.parts.map((v, k) => (k === idx ? "*" : v)).join(".");
      const key = `${a.themeId}|${a.dataflow}|${idx}|${canon}`;
      const bucket = groups.get(key) ?? [];
      if (!bucket.includes(a)) bucket.push(a);
      if (!bucket.includes(b)) bucket.push(b);
      groups.set(key, bucket);
    }
  }
  return groups;
}

function dimAtPosition(
  dataflow: string,
  pos: number,
  dimTemplates: Record<string, string[]>,
): string | null {
  const tpl = dimTemplates[dataflow];
  if (!tpl) return null;
  if (pos < 0 || pos >= tpl.length) return null;
  return tpl[pos];
}

type ConsolidationResult = {
  catalogue: Catalogue;
  merges: Array<{ key: string; sourceIds: string[]; mergedId: string }>;
  skipped: Array<{ key: string; reason: string }>;
};

function consolidate(input: Catalogue): ConsolidationResult {
  const dimTemplates = loadDimTemplates();
  const groups = findGroups(input.indicators);

  const replaced = new Map<string, Indicator>(); // sourceId -> consolidated indicator
  const merges: ConsolidationResult["merges"] = [];
  const skipped: ConsolidationResult["skipped"] = [];

  for (const [key, group] of groups) {
    if (group.some((g) => replaced.has(g.id))) continue; // already consumed
    if (!group[0].dataflow) continue;
    const dataflow = group[0].dataflow;
    const [, , idxStr] = key.split("|");
    const diffIdx = Number(idxStr);

    const concept = dimAtPosition(dataflow, diffIdx, dimTemplates);
    if (!concept) {
      skipped.push({
        key,
        reason: `no dim template for ${dataflow} (position ${diffIdx})`,
      });
      continue;
    }
    // Concepts that should NEVER be the stratifier:
    //   - GEO_PICT / REF_AREA: the page's own country axis
    //   - TIME_PERIOD: the page's own time axis
    //   - INDICATOR / SERIES: the very thing that makes two rows distinct
    //     indicators. Merging on INDICATOR collapses e.g. drop-out rate +
    //     education spend into one "education" entry, which is nonsense.
    const EXCLUDED = new Set([
      "GEO_PICT",
      "REF_AREA",
      "TIME_PERIOD",
      "INDICATOR",
      "SERIES",
    ]);
    if (EXCLUDED.has(concept)) {
      skipped.push({
        key,
        reason: `differing dimension is ${concept}, not a stratifier`,
      });
      continue;
    }

    // Build the consolidated URL: replace the differing position with
    // join("+") of distinct values present in the group.
    const parsedFirst = parseUrl(group[0].apiUrlTemplate!)!;
    const distinctValues = Array.from(
      new Set(
        group.map((g) => parseUrl(g.apiUrlTemplate!)!.parts[diffIdx]),
      ),
    );
    const newParts = parsedFirst.parts.slice();
    newParts[diffIdx] = distinctValues.join("+");
    const newUrl = joinUrl({
      ...parsedFirst,
      parts: newParts,
    });

    // Choose the lowest-id indicator as the "primary" so the merged entry
    // takes its id and keeps catalogue ordering predictable.
    const sorted = group
      .slice()
      .sort((a, b) =>
        a.id.localeCompare(b.id, "en", { numeric: true }),
      );
    const primary = sorted[0];
    const title = longestCommonPrefix(sorted.map((g) => g.title)) || primary.title;

    const distinctNotes = Array.from(
      new Set(
        sorted
          .map((g) => g.notes)
          .filter((n): n is string => Boolean(n))
          .flatMap((n) => n.split(" | ")),
      ),
    );
    const merged: Indicator = {
      ...primary,
      title,
      apiUrlTemplate: newUrl,
      seriesConcept: concept,
      consolidatedFromIds: sorted.map((g) => g.id),
      notes: distinctNotes.length ? distinctNotes.join(" | ") : undefined,
    };

    for (const g of sorted) replaced.set(g.id, merged);
    merges.push({
      key,
      sourceIds: sorted.map((g) => g.id),
      mergedId: primary.id,
    });
  }

  const seenMerged = new Set<string>();
  const indicators: Indicator[] = [];
  for (const i of input.indicators) {
    const m = replaced.get(i.id);
    if (m) {
      if (seenMerged.has(m.id)) continue;
      seenMerged.add(m.id);
      indicators.push(m);
    } else {
      indicators.push(i);
    }
  }

  return {
    catalogue: { ...input, indicators },
    merges,
    skipped,
  };
}

function renderCatalogueTs(cat: Catalogue): string {
  return [
    "// AUTO-GENERATED by scripts/import-country-snapshots.ts. Do not edit by hand.",
    'import type { Catalogue } from "./catalogue";',
    "",
    "export const catalogue: Catalogue = " +
      JSON.stringify(cat, null, 2) +
      ";",
    "",
  ].join("\n");
}

function renderReportMd(result: ConsolidationResult): string {
  const lines: string[] = [];
  lines.push("# Catalogue consolidation report");
  lines.push("");
  lines.push(`Merges performed: ${result.merges.length}`);
  lines.push(`Skipped groups: ${result.skipped.length}`);
  lines.push("");
  lines.push("## Merges");
  if (result.merges.length === 0) lines.push("_None._");
  for (const m of result.merges) {
    lines.push(`- **${m.mergedId}** ← ${m.sourceIds.join(", ")}`);
  }
  lines.push("");
  lines.push("## Skipped");
  if (result.skipped.length === 0) lines.push("_None._");
  for (const s of result.skipped) {
    lines.push(`- ${s.key} — ${s.reason}`);
  }
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      out: { type: "string", default: DEFAULT_OUT },
      report: { type: "string" },
    },
  });
  const result = consolidate(catalogue);
  writeFileSync(values.out!, renderCatalogueTs(result.catalogue), "utf8");
  if (values.report) {
    writeFileSync(values.report, renderReportMd(result), "utf8");
  }
  console.error(
    `Consolidated ${result.merges.length} group(s). ` +
      `Skipped ${result.skipped.length}. ` +
      `Catalogue now has ${result.catalogue.indicators.length} indicators.`,
  );
}

export { consolidate, parseUrl, joinUrl, longestCommonPrefix };

if (
  process.argv[1] &&
  process.argv[1].endsWith("consolidate-country-snapshot-indicators.ts")
) {
  void main();
}
