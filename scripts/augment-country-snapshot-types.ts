#!/usr/bin/env node
/**
 * Augment the country-snapshot catalogue with empirically detected chart types.
 *
 * For each (indicator × country) pair that has a data URL:
 *   - If the existing cache entry is `locked` (>= LOCK_THRESHOLD time points),
 *     skip the probe.
 *   - Otherwise, call the MCP gateway's `probe_data_url` for the substituted
 *     URL. The gateway handles endpoint quirks (Accept negotiation, SBS v1/v2,
 *     OECD agency_id) and returns observation/series counts cheaply.
 *   - With `--direct`, URLs on the SPC endpoint are fetched as SDMX-CSV
 *     instead (≈4.5 s per gateway probe makes a full refresh take hours;
 *     direct requests take minutes). Other hosts keep the gateway path.
 *
 * Heuristic per Python script convention:
 *   - 0 time points       → "empty"  (render placeholder)
 *   - 1..2 time points    → "bar"    (sparse data, comparable as bars)
 *   - >= 3 time points    → "line"   (enough for a time series)
 *   - >= LOCK_THRESHOLD   → "line", locked (never re-probed; SDMx data is
 *                            additive, indicators that have hit the threshold
 *                            once will not regress)
 *
 * Cache entries for indicator ids no longer in the catalogue (or without a
 * data URL) are dropped: ids are positional in the spreadsheet, so a stale
 * id can name a different indicator after a source refresh.
 *
 * Usage:
 *   tsx scripts/augment-country-snapshot-types.ts
 *     [--concurrency N] [--only II.4] [--report data/.../report.md]
 *     [--recheck-locked]   (re-probe locked pairs too; data can disappear)
 *     [--direct]           (fetch SPC URLs directly; default concurrency 6)
 *
 * Requires MCP_GATEWAY_URL (and optionally MCP_AUTH_TOKEN) in the environment
 * unless every probed URL is on the SPC endpoint and `--direct` is set.
 */
import "dotenv/config";
import { parseArgs } from "node:util";
import { writeFileSync } from "node:fs";
import { catalogue } from "../lib/country-snapshots/catalogue.generated";
import { chartTypes as cached } from "../lib/country-snapshots/chart-types.generated";
import {
  decide,
  LOCK_THRESHOLD,
  type ChartTypesCache,
  type ChartTypeEntry,
} from "../lib/country-snapshots/chart-types";
import { withMCPClient, callMcpTool } from "../lib/mcp-client";

const CACHE_PATH = "lib/country-snapshots/chart-types.generated.ts";

const SPC_HOST = "stats-sdmx-disseminate.pacificdata.org";
const DIRECT_TIMEOUT_MS = 45_000;

type McpClient = Parameters<typeof callMcpTool>[0];

const today = new Date().toISOString().slice(0, 10);

type Probe = {
  indicatorId: string;
  countryCode: string;
  url: string;
};

type ProbeResult = {
  status?: "nonempty" | "empty" | "error" | string;
  observation_count?: number;
  series_count?: number;
};

function buildProbes(only: string | undefined, recheckLocked: boolean): Probe[] {
  const probes: Probe[] = [];
  for (const i of catalogue.indicators) {
    if (only && i.id !== only) continue;
    if (!i.apiUrlTemplate) continue;
    for (const c of catalogue.countries) {
      const existing = cached[i.id]?.[c.code];
      if (existing?.locked && !recheckLocked) continue;
      probes.push({
        indicatorId: i.id,
        countryCode: c.code,
        url: i.apiUrlTemplate.replace("[TAG_GEO]", c.code),
      });
    }
  }
  return probes;
}

function entryFor(timePoints: number): ChartTypeEntry {
  return {
    type: decide(timePoints),
    timePoints,
    detectedAt: today,
    locked: timePoints >= LOCK_THRESHOLD,
  };
}

const ERROR_ENTRY: ChartTypeEntry = {
  type: "error",
  timePoints: 0,
  detectedAt: today,
  locked: false,
};

/**
 * The MCP gateway's probe under-reports observation count for URLs that
 * carry no time-window constraint — it falls back to a 1-observation
 * sample. Adding a benign `startPeriod=1900` triggers the available-
 * constraint path and gives the real total. Leaves existing constraints
 * alone so the curator's intent is preserved when present.
 */
function withProbeWindow(url: string): string {
  if (/[?&]startPeriod=/.test(url)) return url;
  if (/[?&]endPeriod=/.test(url)) return url;
  if (/[?&]lastNObservations=/.test(url)) return url;
  if (/[?&]firstNObservations=/.test(url)) return url;
  return url + (url.includes("?") ? "&" : "?") + "startPeriod=1900";
}

async function probeViaGateway(
  client: McpClient,
  probe: Probe,
): Promise<ChartTypeEntry> {
  try {
    const result = (await callMcpTool(client, "probe_data_url", {
      data_url: withProbeWindow(probe.url),
      timeout_ms: 15000,
    })) as ProbeResult;
    if (result.status === "error") return ERROR_ENTRY;
    if (result.status === "empty") return entryFor(0);
    const obs = result.observation_count ?? 0;
    const series = Math.max(1, result.series_count ?? 1);
    // For multi-series indicators (e.g. M vs F breakdown), divide total
    // observations by series count to get time points per series.
    return entryFor(Math.round(obs / series));
  } catch {
    return ERROR_ENTRY;
  }
}

/** RFC 4180 rows: quoted fields may hold commas, quotes and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch !== '"') field += ch;
      else if (text[i + 1] === '"') {
        field += '"';
        i++;
      } else quoted = false;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(field);
      field = "";
    } else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += ch;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/**
 * Fetch the URL as SDMX-CSV from the SPC endpoint. 404 is the .Stat
 * NoRecordsFound answer; time points are the distinct TIME_PERIOD values
 * carrying a non-empty OBS_VALUE.
 */
async function probeDirect(probe: Probe): Promise<ChartTypeEntry> {
  try {
    const res = await fetch(probe.url, {
      headers: {
        Accept: "application/vnd.sdmx.data+csv;version=1.0.0",
        "Accept-Language": "en",
      },
      signal: AbortSignal.timeout(DIRECT_TIMEOUT_MS),
    });
    if (res.status === 404) return entryFor(0);
    if (!res.ok) return ERROR_ENTRY;
    const [header = [], ...rows] = parseCsv(await res.text());
    const obsCol = header.indexOf("OBS_VALUE");
    const timeCol = header.indexOf("TIME_PERIOD");
    if (obsCol < 0 || timeCol < 0) return rows.length ? ERROR_ENTRY : entryFor(0);
    const periods = new Set<string>();
    for (const row of rows) {
      if (row[obsCol]?.trim()) periods.add(row[timeCol]);
    }
    return entryFor(periods.size);
  } catch {
    return ERROR_ENTRY;
  }
}

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  let done = 0;
  async function takeOne(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await worker(items[i], i);
      done++;
      if (onProgress) onProgress(done, items.length);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () =>
    takeOne(),
  );
  await Promise.all(runners);
  return results;
}

function renderGeneratedTs(cache: ChartTypesCache): string {
  const sortedIndicators = Object.keys(cache).sort((a, b) =>
    a.localeCompare(b, "en", { numeric: true }),
  );
  const obj: ChartTypesCache = {};
  for (const id of sortedIndicators) {
    const byCountry = cache[id];
    const sortedCountries = Object.keys(byCountry).sort();
    obj[id] = {};
    for (const code of sortedCountries) {
      obj[id][code] = byCountry[code];
    }
  }
  return [
    "// AUTO-GENERATED by scripts/augment-country-snapshot-types.ts. Do not edit by hand.",
    'import type { ChartTypesCache } from "./chart-types";',
    "",
    "export const chartTypes: ChartTypesCache = " +
      JSON.stringify(obj, null, 2) +
      ";",
    "",
  ].join("\n");
}

async function main() {
  const { values } = parseArgs({
    options: {
      concurrency: { type: "string" },
      only: { type: "string" },
      report: { type: "string" },
      // Locked pairs can lose their data: FM's V.2 and V.3 had 16 years in
      // June 2026 and none by November. Re-probe everything before a demo.
      "recheck-locked": { type: "boolean", default: false },
      direct: { type: "boolean", default: false },
    },
  });
  const direct = values.direct ?? false;
  const concurrency = Math.max(1, Number(values.concurrency) || (direct ? 6 : 8));
  const recheckLocked = values["recheck-locked"] ?? false;
  const probes = buildProbes(values.only, recheckLocked);
  const merged: ChartTypesCache = JSON.parse(JSON.stringify(cached));
  const isDirect = (p: Probe) => direct && new URL(p.url).host === SPC_HOST;

  let skippedLocked = 0;
  if (!recheckLocked) {
    for (const i of catalogue.indicators) {
      if (!i.apiUrlTemplate) continue;
      for (const c of catalogue.countries) {
        if (cached[i.id]?.[c.code]?.locked) skippedLocked++;
      }
    }
  }

  const directCount = probes.filter(isDirect).length;
  console.error(
    `Probing ${probes.length} (indicator × country) pairs ` +
      `(${directCount} direct, ${probes.length - directCount} via MCP; ` +
      `${skippedLocked} already locked, skipped). ` +
      `Concurrency=${concurrency}.`,
  );

  let lastReport = Date.now();
  const probeAll = (client: McpClient | null) =>
    runWithConcurrency(
      probes,
      concurrency,
      async (p) => ({
        probe: p,
        entry:
          client && !isDirect(p)
            ? await probeViaGateway(client, p)
            : await probeDirect(p),
      }),
      (done, total) => {
        const now = Date.now();
        if (now - lastReport > 2000 || done === total) {
          lastReport = now;
          const pct = ((done / total) * 100).toFixed(1);
          process.stderr.write(`\r  ${done}/${total} (${pct}%)        `);
        }
      },
    );
  const results =
    directCount === probes.length
      ? await probeAll(null)
      : await withMCPClient(probeAll);
  process.stderr.write("\n");

  const counts = { line: 0, bar: 0, empty: 0, error: 0 };
  for (const { probe, entry } of results) {
    if (!merged[probe.indicatorId]) merged[probe.indicatorId] = {};
    merged[probe.indicatorId][probe.countryCode] = entry;
    counts[entry.type]++;
  }

  const probedIds = new Set(
    catalogue.indicators.filter((i) => i.apiUrlTemplate).map((i) => i.id),
  );
  const dropped = Object.keys(merged).filter((id) => !probedIds.has(id));
  for (const id of dropped) delete merged[id];

  writeFileSync(CACHE_PATH, renderGeneratedTs(merged), "utf8");

  console.error(
    `Wrote ${CACHE_PATH}: line=${counts.line} bar=${counts.bar} empty=${counts.empty} error=${counts.error}` +
      `; dropped ${dropped.length} stale indicator id(s)`,
  );

  if (values.report) {
    const errorList: string[] = [];
    const barList: string[] = [];
    const emptyList: string[] = [];
    for (const { probe, entry } of results) {
      const tag = `${probe.indicatorId}/${probe.countryCode}`;
      if (entry.type === "error") errorList.push(tag);
      if (entry.type === "bar") barList.push(`${tag} (${entry.timePoints} points)`);
      if (entry.type === "empty") emptyList.push(tag);
    }
    const via = direct
      ? "directly against the SPC endpoint (other hosts via MCP gateway)"
      : "via MCP gateway";
    const md = [
      `# Chart type augmentation report`,
      ``,
      `Probed at ${new Date().toISOString().slice(0, 19)} ${via}`,
      ``,
      `## Summary`,
      `- line: ${counts.line}`,
      `- bar:  ${counts.bar}`,
      `- empty: ${counts.empty}`,
      `- error: ${counts.error}`,
      `- locked entries carried over: ${skippedLocked}`,
      `- stale indicator ids dropped: ${dropped.length}`,
      ``,
      `## Errors (${errorList.length})`,
      errorList.length ? errorList.map((s) => "- " + s).join("\n") : "_None._",
      ``,
      `## Bar (1-2 time points) (${barList.length})`,
      barList.length ? barList.map((s) => "- " + s).join("\n") : "_None._",
      ``,
      `## Empty (${emptyList.length})`,
      emptyList.length ? emptyList.map((s) => "- " + s).join("\n") : "_None._",
      ``,
    ].join("\n");
    writeFileSync(values.report, md, "utf8");
    console.error(`Wrote report ${values.report}`);
  }
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("augment-country-snapshot-types.ts")
) {
  void main();
}
