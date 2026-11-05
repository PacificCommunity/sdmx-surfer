#!/usr/bin/env npx tsx
/**
 * Build indicator coverage for every SPC dataflow in the index.
 *
 * Usage:
 *   npm run build-coverage                         incremental (the daily job)
 *   npm run build-coverage -- --force              rebuild every flow
 *   npm run build-coverage -- --only DF_SDG,DF_NMDI   rebuild just these
 *
 * Writes models/dataflow-coverage.json (types: lib/coverage/types.ts): for
 * each flow, per indicator, the observation count and per-area, per-year
 * counts. Roles (which dimension is the area, which the indicator) follow
 * lib/coverage/roles.ts.
 *
 * Two modes, picked by the index's availability obsCount:
 *   - counts: stream the full SDMX-CSV (`/data/SPC,DF_X,/all`) and count key
 *     columns only; the text is never held whole.
 *   - range (obsCount > RANGE_THRESHOLD, i.e. the big PACCOMTRADE and
 *     TRADE_FOOD flows, 0.9-3.6M obs each): availability constraints per
 *     indicator code, then per indicator × area while that stays within
 *     PAIR_BUDGET calls. Areas get first-last year and obs, no per-year counts.
 *
 * Incremental: each flow records a signature of the index facts it was built
 * from (obsCount, time envelope, dimensions and codelists). The index is
 * refreshed first, so an unchanged signature means nothing was loaded and the
 * flow is skipped. A flow that fails keeps its previous coverage; a run that
 * changes nothing leaves the file byte-identical.
 *
 * Polite by construction: at most CONCURRENCY requests in flight, retries
 * with backoff, and a per-request timeout.
 */

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import {
  createCountsAccumulator,
  summarizeConstraint,
  type AvailableConstraintResponse,
  type CountsAccumulator,
} from "../lib/coverage/aggregate";
import { createCsvParser } from "../lib/coverage/csv";
import {
  ALL_INDICATOR,
  compareAreas,
  detectRoles,
  parseCodelistRef,
  type DimensionRef,
  type FlowRoles,
} from "../lib/coverage/roles";
import {
  COVERAGE_FORMAT_VERSION,
  type AreaRange,
  type CountsFlowCoverage,
  type CoverageArtifact,
  type FlowCoverage,
  type RangeFlowCoverage,
  type RangeIndicator,
} from "../lib/coverage/types";

// Same base as scripts/build-index.ts; it serves data as well as structure.
const STAT_BASE = "https://stats-nsi-stable.pacificdata.org/rest";
const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");
const COVERAGE_PATH = join(process.cwd(), "models", "dataflow-coverage.json");

/** Above this many observations a flow is built in range mode. */
const RANGE_THRESHOLD = 750_000;
/** Most indicator × area constraint calls one range-mode flow may make. */
const PAIR_BUDGET = 200;
const CONCURRENCY = 3;
const DATA_TIMEOUT_MS = 10 * 60_000;
const CONSTRAINT_TIMEOUT_MS = 90_000;
const RETRIES = 3;

const CSV_ACCEPT = "application/vnd.sdmx.data+csv;version=1.0.0";
const STRUCTURE_HEADERS = {
  Accept: "application/vnd.sdmx.structure+json; version=1.0",
  "Accept-Language": "en",
};

// ── CLI ──

const argv = process.argv.slice(2);
const force = argv.includes("--force");
const onlyArg = argv.find((a) => a.startsWith("--only"));
const only = onlyArg
  ? new Set(
      (onlyArg.includes("=") ? onlyArg.split("=")[1] : argv[argv.indexOf(onlyArg) + 1] ?? "")
        .split(",")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    )
  : null;

// ── Inputs ──

interface IndexEntry {
  id: string;
  structure: { dimensions: Array<DimensionRef & { position: number }> } | null;
  availability: { obsCount: number; timeStart: string | null; timeEnd: string | null } | null;
}

function readJson<T>(path: string): T | null {
  if (!existsSync(path)) return null;
  // Both files are written by this repo's own build scripts.
  return JSON.parse(readFileSync(path, "utf-8")) as T;
}

function signatureOf(entry: IndexEntry): string {
  const a = entry.availability;
  return createHash("sha1")
    .update(
      JSON.stringify([
        COVERAGE_FORMAT_VERSION,
        RANGE_THRESHOLD,
        a?.obsCount ?? null,
        a?.timeStart ?? null,
        a?.timeEnd ?? null,
        (entry.structure?.dimensions ?? []).map((d) => [d.id, d.codelist]),
      ]),
    )
    .digest("hex")
    .slice(0, 16);
}

// ── HTTP: one semaphore for every request, retries with backoff ──

let inFlight = 0;
const waiting: Array<() => void> = [];

async function withSlot<T>(fn: () => Promise<T>): Promise<T> {
  if (inFlight < CONCURRENCY) {
    inFlight++;
  } else {
    // A released slot is handed straight to the next waiter, never freed.
    const { promise, resolve } = Promise.withResolvers<void>();
    waiting.push(resolve);
    await promise;
  }
  try {
    return await fn();
  } finally {
    const next = waiting.shift();
    if (next) next();
    else inFlight--;
  }
}

async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await withSlot(fn);
    } catch (err) {
      if (attempt >= RETRIES) throw err;
      const wait = 2_000 * 3 ** (attempt - 1);
      console.warn("  retry " + label + " in " + wait / 1000 + "s: " + (err instanceof Error ? err.message : String(err)));
      await sleep(wait);
    }
  }
}

async function getJson<T>(url: string, timeoutMs: number): Promise<T> {
  return withRetry(url, async () => {
    const resp = await fetch(url, { headers: STRUCTURE_HEADERS, signal: AbortSignal.timeout(timeoutMs) });
    if (!resp.ok) throw new Error("HTTP " + resp.status + " for " + url);
    // Callers name the upstream response shape they read.
    return (await resp.json()) as T;
  });
}

// ── Labels ──

/** The codelist fields read for labels. */
interface CodelistResponse {
  data?: { codelists?: Array<{ codes?: Array<{ id: string; name?: string; names?: { en?: string } }> }> };
}

const codelistCache = new Map<string, Promise<Map<string, string>>>();

function fetchCodelist(ref: string | null): Promise<Map<string, string>> {
  if (!ref) return Promise.resolve(new Map());
  const cached = codelistCache.get(ref);
  if (cached) return cached;
  const parts = parseCodelistRef(ref);
  const promise = parts
    ? getJson<CodelistResponse>(
        STAT_BASE + "/codelist/" + parts.agency + "/" + parts.id + "/" + parts.version,
        CONSTRAINT_TIMEOUT_MS,
      )
        .then((json) => {
          const labels = new Map<string, string>();
          for (const code of json.data?.codelists?.[0]?.codes ?? []) {
            const name = code.names?.en ?? code.name;
            if (name) labels.set(code.id, name);
          }
          return labels;
        })
        .catch((err) => {
          console.warn("  codelist " + ref + " unavailable: " + (err instanceof Error ? err.message : err));
          return new Map<string, string>();
        })
    : Promise.resolve(new Map<string, string>());
  codelistCache.set(ref, promise);
  return promise;
}

// ── Counts mode ──

/** What a builder fills in; signature and roles are added by the caller. */
type BuiltFields = "detail" | "obs" | "first" | "last" | "indicators";

async function buildCounts(
  id: string,
  roles: FlowRoles,
  labels: Map<string, string>,
): Promise<Pick<CountsFlowCoverage, BuiltFields>> {
  const url = STAT_BASE + "/data/SPC," + id + ",/all";
  return withRetry(id + " data", async () => {
    const resp = await fetch(url, {
      // Node's fetch sends `Accept-Language: *` by default, which the NSI
      // answers with HTTP 500; a concrete language is required.
      headers: { Accept: CSV_ACCEPT, "Accept-Encoding": "gzip", "Accept-Language": "en" },
      signal: AbortSignal.timeout(DATA_TIMEOUT_MS),
    });
    // NSI answers 404 NoRecordsFound for a flow with no observations.
    if (resp.status === 404) {
      return { detail: "counts" as const, obs: 0, first: null, last: null, indicators: [] };
    }
    if (!resp.ok || !resp.body) throw new Error("HTTP " + resp.status + " for " + url);

    // The first row is the header; it decides the columns the accumulator reads.
    const sink: { acc: CountsAccumulator | null } = { acc: null };
    const parser = createCsvParser((row) => {
      if (sink.acc) sink.acc.add(row);
      else sink.acc = createCountsAccumulator(row, roles);
    });
    const decoder = new TextDecoder();
    const reader = resp.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
    }
    parser.push(decoder.decode());
    parser.end();
    if (!sink.acc) return { detail: "counts" as const, obs: 0, first: null, last: null, indicators: [] };
    return { detail: "counts" as const, ...sink.acc.finish(labels) };
  });
}

// ── Range mode ──

async function buildRange(
  id: string,
  dims: DimensionRef[],
  roles: FlowRoles,
  labels: Map<string, string>,
): Promise<Pick<RangeFlowCoverage, BuiltFields>> {
  const keyDims = dims.filter((d) => d.type !== "TimeDimension" && d.id !== "TIME_PERIOD").map((d) => d.id);
  const keyFor = (fixed: Record<string, string>) => keyDims.map((d) => fixed[d] ?? "").join(".");
  const constraint = (key: string, component: string) =>
    getJson<AvailableConstraintResponse>(
      STAT_BASE + "/availableconstraint/" + id + "/" + key + "/all/" + component + "?mode=exact",
      CONSTRAINT_TIMEOUT_MS,
    ).then(summarizeConstraint);

  const overall = await constraint("all", "all");
  const codes = roles.indicatorDim ? overall.values[roles.indicatorDim] ?? [] : [ALL_INDICATOR];

  const perIndicator = await Promise.all(
    codes.map(async (code) => {
      const s =
        code === ALL_INDICATOR ? overall : await constraint(keyFor({ [roles.indicatorDim!]: code }), "all");
      return { code, s, areas: roles.areaDim ? s.values[roles.areaDim] ?? [] : [] };
    }),
  );

  const pairs = perIndicator.reduce((n, p) => n + p.areas.length, 0);
  const withPairs = pairs <= PAIR_BUDGET;
  if (!withPairs) {
    console.log("  " + id + ": " + pairs + " indicator × area pairs > budget " + PAIR_BUDGET + "; areas listed without ranges");
  }

  const indicators: RangeIndicator[] = await Promise.all(
    perIndicator.map(async ({ code, s, areas }) => {
      const ranges: Record<string, AreaRange> = {};
      const sorted = [...areas].sort(compareAreas);
      const results = withPairs
        ? await Promise.all(
            sorted.map((area) => {
              const fixed: Record<string, string> = { [roles.areaDim!]: area };
              if (code !== ALL_INDICATOR) fixed[roles.indicatorDim!] = code;
              return constraint(keyFor(fixed), "TIME_PERIOD");
            }),
          )
        : null;
      sorted.forEach((area, i) => {
        const r = results?.[i];
        ranges[area] = r && r.first !== null && r.last !== null ? { obs: r.obs, first: r.first, last: r.last } : {};
      });
      return {
        code,
        label: code === ALL_INDICATOR ? "All observations" : labels.get(code) ?? null,
        obs: s.obs,
        first: s.first,
        last: s.last,
        areas: ranges,
      };
    }),
  );
  indicators.sort((a, b) => b.obs - a.obs || (a.code < b.code ? -1 : 1));
  return { detail: "range" as const, obs: overall.obs, first: overall.first, last: overall.last, indicators };
}

// ── Main ──

async function main() {
  const started = Date.now();
  const index = readJson<{ entries: IndexEntry[] }>(INDEX_PATH);
  if (!index) throw new Error("No index at " + INDEX_PATH + "; run npm run build-index first.");
  const previous = readJson<CoverageArtifact>(COVERAGE_PATH);
  const previousFlows = previous?.version === COVERAGE_FORMAT_VERSION ? previous.flows : {};

  const todo: Array<{ entry: IndexEntry; signature: string }> = [];
  const flows: Record<string, FlowCoverage> = {};
  for (const entry of index.entries) {
    const signature = signatureOf(entry);
    const prior = previousFlows[entry.id];
    const wanted = only ? only.has(entry.id) : force || prior?.signature !== signature;
    if (wanted && entry.structure) todo.push({ entry, signature });
    else if (prior) flows[entry.id] = prior;
  }
  console.log(
    "Coverage: " + todo.length + " of " + index.entries.length + " flows to build" +
      (force ? " (--force)" : only ? " (--only)" : " (incremental)") + "\n",
  );

  const failures: string[] = [];
  const areaCodelists = new Set<string>();
  const queue = [...todo];
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      const { entry, signature } = job;
      const dims = [...entry.structure!.dimensions].sort((a, b) => a.position - b.position);
      const roles = detectRoles(dims);
      const indicatorRef = dims.find((d) => d.id === roles.indicatorDim)?.codelist ?? null;
      const areaRef = dims.find((d) => d.id === roles.areaDim)?.codelist ?? null;
      if (areaRef) areaCodelists.add(areaRef);
      const range = (entry.availability?.obsCount ?? 0) > RANGE_THRESHOLD;
      const t0 = Date.now();
      try {
        const labels = await fetchCodelist(indicatorRef);
        const built = range
          ? await buildRange(entry.id, dims, roles, labels)
          : await buildCounts(entry.id, roles, labels);
        flows[entry.id] = { signature, ...roles, ...built };
        console.log(
          "  " + entry.id.padEnd(28) + built.detail.padEnd(7) +
            String(built.indicators.length).padStart(5) + " ind " +
            String(built.obs).padStart(9) + " obs  " +
            ((Date.now() - t0) / 1000).toFixed(1) + "s" +
            "  [" + (roles.indicatorDim ?? "-") + "/" + roles.indicatorRule + ", " + (roles.areaDim ?? "no area") + "]",
        );
      } catch (err) {
        failures.push(entry.id);
        const prior = previousFlows[entry.id];
        if (prior) flows[entry.id] = prior;
        const msg = err instanceof Error ? err.message : String(err);
        console.error("  " + entry.id + " FAILED after " + ((Date.now() - t0) / 1000).toFixed(1) + "s: " + msg +
          (prior ? " (kept previous coverage)" : ""));
        if (process.env.GITHUB_ACTIONS) console.log("::warning::Coverage failed for " + entry.id + ": " + msg);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Area labels: fresh codelists over the previous run's, limited to codes in use.
  const used = new Set<string>();
  for (const flow of Object.values(flows)) {
    for (const ind of flow.indicators) for (const a of Object.keys(ind.areas)) used.add(a);
  }
  const fresh = new Map<string, string>();
  for (const ref of areaCodelists) {
    for (const [code, label] of await fetchCodelist(ref)) if (!fresh.has(code)) fresh.set(code, label);
  }
  const areaLabels: Record<string, string> = {};
  for (const code of [...used].sort(compareAreas)) {
    const label = fresh.get(code) ?? previous?.areaLabels[code];
    if (label) areaLabels[code] = label;
  }

  const ordered: Record<string, FlowCoverage> = {};
  for (const entry of index.entries) if (flows[entry.id]) ordered[entry.id] = flows[entry.id];

  const body = {
    version: COVERAGE_FORMAT_VERSION,
    source: STAT_BASE,
    rangeThreshold: RANGE_THRESHOLD,
    areaLabels,
    flows: ordered,
  };
  const elapsed = ((Date.now() - started) / 1000).toFixed(0) + "s";
  const missing = index.entries.filter((e) => !ordered[e.id]).map((e) => e.id);
  if (missing.length) console.warn("\n  No coverage for: " + missing.join(", "));
  if (failures.length) console.warn("  Failed this run: " + failures.join(", "));

  if (previous && JSON.stringify({ ...previous, createdAt: undefined }) === JSON.stringify({ ...body, createdAt: undefined })) {
    console.log("\nNo change; coverage left untouched (built " + previous.createdAt + "). " + elapsed);
    return;
  }
  const artifact: CoverageArtifact = { ...body, createdAt: new Date().toISOString() };
  const text = JSON.stringify(artifact);
  writeFileSync(COVERAGE_PATH, text, "utf-8");
  console.log(
    "\nSaved " + COVERAGE_PATH + " (" + (text.length / 1024 / 1024).toFixed(2) + " MB, " +
      Object.keys(ordered).length + " flows) in " + elapsed,
  );
}

main().catch((err) => {
  console.error("\nFailed:", err instanceof Error ? err.message : err);
  process.exit(1);
});
