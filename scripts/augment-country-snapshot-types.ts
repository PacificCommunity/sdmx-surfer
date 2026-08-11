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
 *
 * Heuristic per Python script convention:
 *   - 0 time points       → "empty"  (render placeholder)
 *   - 1..2 time points    → "bar"    (sparse data, comparable as bars)
 *   - >= 3 time points    → "line"   (enough for a time series)
 *   - >= LOCK_THRESHOLD   → "line", locked (never re-probed; SDMx data is
 *                            additive, indicators that have hit the threshold
 *                            once will not regress)
 *
 * Usage:
 *   tsx scripts/augment-country-snapshot-types.ts
 *     [--concurrency 8] [--only II.4] [--report data/.../report.md]
 *
 * Requires MCP_GATEWAY_URL (and optionally MCP_AUTH_TOKEN) in the environment.
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

function buildProbes(only?: string): Probe[] {
  const probes: Probe[] = [];
  for (const i of catalogue.indicators) {
    if (only && i.id !== only) continue;
    if (!i.apiUrlTemplate) continue;
    for (const c of catalogue.countries) {
      const existing = cached[i.id]?.[c.code];
      if (existing?.locked) continue;
      probes.push({
        indicatorId: i.id,
        countryCode: c.code,
        url: i.apiUrlTemplate.replace("[TAG_GEO]", c.code),
      });
    }
  }
  return probes;
}

function decideFromProbe(result: ProbeResult): {
  type: ChartTypeEntry["type"];
  timePoints: number;
} {
  if (result.status === "error") {
    return { type: "error", timePoints: 0 };
  }
  if (result.status === "empty") {
    return { type: "empty", timePoints: 0 };
  }
  const obs = result.observation_count ?? 0;
  const series = Math.max(1, result.series_count ?? 1);
  // For multi-series indicators (e.g. M vs F breakdown), divide total
  // observations by series count to get time points per series.
  const timePoints = Math.round(obs / series);
  return { type: decide(timePoints), timePoints };
}

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

async function probeOne(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  probe: Probe,
): Promise<ChartTypeEntry> {
  const now = new Date().toISOString().slice(0, 10);
  try {
    const result = (await callMcpTool(client, "probe_data_url", {
      data_url: withProbeWindow(probe.url),
      timeout_ms: 15000,
    })) as ProbeResult;
    if (result.status === "error") {
      return { type: "error", timePoints: 0, detectedAt: now, locked: false };
    }
    if (result.status === "empty") {
      return { type: "empty", timePoints: 0, detectedAt: now, locked: false };
    }
    const { type, timePoints } = decideFromProbe(result);
    return {
      type,
      timePoints,
      detectedAt: now,
      locked: timePoints >= LOCK_THRESHOLD,
    };
  } catch {
    return {
      type: "error",
      timePoints: 0,
      detectedAt: now,
      locked: false,
    };
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
      concurrency: { type: "string", default: "8" },
      only: { type: "string" },
      report: { type: "string" },
    },
  });
  const concurrency = Math.max(1, Number(values.concurrency) || 8);
  const probes = buildProbes(values.only);
  const merged: ChartTypesCache = JSON.parse(JSON.stringify(cached));

  let skippedLocked = 0;
  for (const i of catalogue.indicators) {
    if (!i.apiUrlTemplate) continue;
    for (const c of catalogue.countries) {
      if (cached[i.id]?.[c.code]?.locked) skippedLocked++;
    }
  }

  console.error(
    `Probing ${probes.length} (indicator × country) pairs via MCP ` +
      `(${skippedLocked} already locked, skipped). ` +
      `Concurrency=${concurrency}.`,
  );

  await withMCPClient(async (client) => {
    let lastReport = Date.now();
    const results = await runWithConcurrency(
      probes,
      concurrency,
      async (p) => ({ probe: p, entry: await probeOne(client, p) }),
      (done, total) => {
        const now = Date.now();
        if (now - lastReport > 2000 || done === total) {
          lastReport = now;
          const pct = ((done / total) * 100).toFixed(1);
          process.stderr.write(`\r  ${done}/${total} (${pct}%)        `);
        }
      },
    );
    process.stderr.write("\n");

    const counts = { line: 0, bar: 0, empty: 0, error: 0 };
    for (const { probe, entry } of results) {
      if (!merged[probe.indicatorId]) merged[probe.indicatorId] = {};
      merged[probe.indicatorId][probe.countryCode] = entry;
      counts[entry.type]++;
    }

    writeFileSync(CACHE_PATH, renderGeneratedTs(merged), "utf8");

    console.error(
      `Wrote ${CACHE_PATH}: line=${counts.line} bar=${counts.bar} empty=${counts.empty} error=${counts.error}`,
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
      const md = [
        `# Chart type augmentation report`,
        ``,
        `Probed at ${new Date().toISOString().slice(0, 19)} via MCP gateway`,
        ``,
        `## Summary`,
        `- line: ${counts.line}`,
        `- bar:  ${counts.bar}`,
        `- empty: ${counts.empty}`,
        `- error: ${counts.error}`,
        `- locked entries carried over: ${skippedLocked}`,
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
  });
}

if (
  process.argv[1] &&
  process.argv[1].endsWith("augment-country-snapshot-types.ts")
) {
  void main();
}
