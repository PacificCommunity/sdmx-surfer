#!/usr/bin/env npx tsx
/**
 * Build the semantic search index for dataflows.
 *
 * Usage:
 *   npm run build-index                 incremental (what the daily job runs)
 *   npm run build-index -- --force-embed   re-embed everything
 *
 * Requires:
 *   - MCP gateway reachable (MCP_GATEWAY_URL)
 *   - GOOGLE_AI_API_KEY, only when something actually needs embedding
 *
 * This script:
 * 1. Fetches all dataflows from the MCP gateway via AI SDK's MCP client
 * 2. For each, fetches the structure (dimensions, codelists)
 * 3. Builds a rich text description for embedding
 * 4. Embeds descriptions that are new or whose text changed, reusing the rest
 * 5. Saves the index to models/dataflow-index.json
 *
 * INCREMENTAL BY DESIGN, because the two halves of this index age at very
 * different rates. Structure and availability move constantly: availability
 * changes whenever data is loaded, and a stale index told the explorer that
 * DF_VITAL ended in 2022 when it ran to 2026. Embeddings move only when a
 * dataflow is added or its name, description, dimensions or codelists change,
 * and they are the expensive part.
 *
 * The two are separable because `richText` is built from name, description,
 * dimension ids and codelist names only. Availability is stored on the entry
 * but never fed to the embedding, so refreshing it daily costs no embedding
 * calls at all. A run that finds nothing new needs no API key and writes
 * nothing.
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";

const MCP_URL = process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp";
const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");

// This script currently builds an SPC-only catalogue. The MCP endpoint and the
// REST base are hardcoded to SPC below; the index stamps each entry with
// `endpoint: INDEX_ENDPOINT` so multi-endpoint consumers can tell which
// provider an entry belongs to, and so a future multi-endpoint build can
// concatenate per-endpoint runs without ambiguity.
const INDEX_ENDPOINT = "SPC";
const EMBED_MODEL_ID = "gemini-embedding-001";

interface PreviousIndex {
  modelId: string;
  createdAt: string;
  entries: Array<{
    id: string;
    richText: string;
    embedding?: number[];
    structure?: unknown;
  }>;
}

/** The committed index, when there is one. Absent on a first build. */
function loadPreviousIndex(): PreviousIndex | null {
  if (!existsSync(INDEX_PATH)) return null;
  try {
    return JSON.parse(readFileSync(INDEX_PATH, "utf-8")) as PreviousIndex;
  } catch {
    console.warn("  Warning: existing index unreadable; rebuilding from scratch");
    return null;
  }
}
const STAT_BASE = "https://stats-nsi-stable.pacificdata.org/rest";

// ── Category fetching from .Stat SDMx REST API ──

interface CategoryTag {
  scheme: string;
  id: string;
  name: string;
}

/**
 * Fetch category-to-dataflow mappings from SPC .Stat category schemes.
 * Returns a map: dataflow ID → array of category tags.
 *
 * Reads the SDMx-JSON 2.0 structure message: `data.categorisations` links a
 * category URN to a dataflow URN, and `data.categorySchemes[].categories`
 * carries the names. The previous implementation read a `references` object
 * with embedded `links[rel=dataflow]`, which the endpoint stopped returning;
 * it failed silently, warning nothing and categorising zero dataflows, so a
 * rebuild would have quietly stripped the categories from every entry.
 */
async function fetchCategories(): Promise<Map<string, CategoryTag[]>> {
  const map = new Map<string, CategoryTag[]>();
  const schemes = ["CAS_COM_TOPIC", "CAS_COM_DEV"];

  for (const scheme of schemes) {
    const url = STAT_BASE + "/categoryscheme/SPC/" + scheme + "/latest?references=all";
    try {
      const resp = await fetch(url, {
        headers: { Accept: "application/json", "Accept-Language": "en" },
      });
      if (!resp.ok) {
        console.warn("  Warning: could not fetch " + scheme + " (" + String(resp.status) + ")");
        continue;
      }
      const body = (await resp.json()) as {
        data?: {
          categorisations?: Array<{ source?: string; target?: string }>;
          categorySchemes?: Array<{ id?: string; categories?: RawCategory[] }>;
        };
      };
      const data = body.data ?? {};

      // Category id path -> display name, following nesting.
      const names = new Map<string, string>();
      for (const cs of data.categorySchemes ?? []) {
        collectCategoryNames(cs.categories ?? [], "", names);
      }

      let linked = 0;
      for (const c of data.categorisations ?? []) {
        const cat = parseCategoryUrn(c.source);
        const dfId = parseDataflowUrn(c.target);
        if (!cat || !dfId) continue;
        const existing = map.get(dfId) || [];
        if (!existing.some((t) => t.scheme === cat.scheme && t.id === cat.id)) {
          existing.push({
            scheme: cat.scheme,
            id: cat.id,
            name: names.get(cat.id) || cat.id,
          });
        }
        map.set(dfId, existing);
        linked++;
      }

      // A scheme that parses to nothing is a shape change, not an empty scheme.
      if (linked === 0) {
        console.warn(
          "  Warning: " + scheme + " returned " +
          String((data.categorisations ?? []).length) +
          " categorisations but none could be parsed. Check the response shape.",
        );
      }
      console.log("  Fetched " + scheme + ": " + String(map.size) + " dataflows categorised so far");
    } catch (err) {
      console.warn("  Warning: failed to fetch " + scheme + ":", err instanceof Error ? err.message : err);
    }
  }

  return map;
}

/**
 * Full names and descriptions, straight from .Stat.
 *
 * NOT from `list_dataflows`, which truncates descriptions to 100 characters
 * and appends an ellipsis. Building from that would have replaced full text
 * (up to 427 characters) with truncations in both the description the explorer
 * displays and the richText that gets embedded, quietly degrading semantic
 * search on 95 of 127 dataflows and forcing a re-embed of all of them.
 */
async function fetchDataflowText(): Promise<Map<string, { name: string; description: string }>> {
  const out = new Map<string, { name: string; description: string }>();
  const url = STAT_BASE + "/dataflow/SPC/all/latest";
  try {
    const resp = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "en" },
    });
    if (!resp.ok) {
      console.warn("  Warning: could not fetch dataflow text (" + String(resp.status) +
        "); falling back to the truncated summaries");
      return out;
    }
    const body = (await resp.json()) as {
      data?: { dataflows?: Array<{ id?: string; name?: string; description?: string }> };
    };
    for (const df of body.data?.dataflows ?? []) {
      if (df.id) out.set(df.id, { name: df.name || df.id, description: df.description || "" });
    }
    console.log("  Fetched full text for " + String(out.size) + " dataflows");
  } catch (err) {
    console.warn("  Warning: dataflow text fetch failed:",
      err instanceof Error ? err.message : err);
  }
  return out;
}

interface RawCategory {
  id?: string;
  name?: string;
  categories?: RawCategory[];
}

/** Flatten a category tree into dotted-path -> name. */
function collectCategoryNames(
  categories: RawCategory[],
  prefix: string,
  out: Map<string, string>,
): void {
  for (const c of categories) {
    if (!c.id) continue;
    const path = prefix ? prefix + "." + c.id : c.id;
    out.set(path, c.name || c.id);
    if (c.categories?.length) collectCategoryNames(c.categories, path, out);
  }
}

/** urn:...Category=SPC:CAS_COM_TOPIC(1.0).ECO -> { scheme, id } */
function parseCategoryUrn(urn: string | undefined): { scheme: string; id: string } | null {
  if (!urn) return null;
  const m = /Category=[^:]+:([^(]+)\([^)]*\)\.(.+)$/.exec(urn);
  return m ? { scheme: m[1], id: m[2] } : null;
}

/** urn:...Dataflow=SPC:DF_BOP(1.1) -> DF_BOP */
function parseDataflowUrn(urn: string | undefined): string | null {
  if (!urn) return null;
  const m = /Dataflow=[^:]+:([^(]+)\(/.exec(urn);
  return m ? m[1] : null;
}

// ── Availability fetching from .Stat REST API ──

interface DimensionAvailability {
  id: string;
  values: string[];
}

interface CountryAvailability {
  code: string;
  obsCount: number;
  timeStart: string | null;
  timeEnd: string | null;
}

interface AvailabilityInfo {
  obsCount: number;
  timeStart: string | null;
  timeEnd: string | null;
  frequencies: string[];
  dimensions: DimensionAvailability[];
  countries: CountryAvailability[];
}

/**
 * Fetch availability constraint for a dataflow from .Stat REST API.
 * Returns the overall envelope + per-country breakdown.
 */
async function fetchAvailability(dataflowId: string, geoCodes: string[]): Promise<AvailabilityInfo | null> {
  const ACCEPT = "application/vnd.sdmx.structure+json; version=1.0";
  const HEADERS = { Accept: ACCEPT, "Accept-Language": "en" };

  // 1. Overall constraint
  const overallUrl = STAT_BASE + "/availableconstraint/" + dataflowId + "/all/all/all?mode=exact";
  let obsCount = 0;
  let timeStart: string | null = null;
  let timeEnd: string | null = null;
  let frequencies: string[] = [];
  const dimensions: DimensionAvailability[] = [];

  try {
    const resp = await fetch(overallUrl, { headers: HEADERS });
    if (!resp.ok) return null;

    const data = (await resp.json()) as {
      data: {
        contentConstraints: Array<{
          annotations?: Array<{ id?: string; title?: string }>;
          cubeRegions?: Array<{
            keyValues?: Array<{
              id: string;
              values?: string[];
              timeRange?: {
                startPeriod: { period: string };
                endPeriod: { period: string };
              };
            }>;
          }>;
        }>;
      };
    };

    const constraint = data.data.contentConstraints[0];
    if (!constraint) return null;

    // Observation count from annotations
    const obsAnnot = (constraint.annotations || []).find((a) => a.id === "obs_count");
    obsCount = obsAnnot?.title ? parseInt(obsAnnot.title, 10) : 0;

    // Dimension values + time range
    for (const region of constraint.cubeRegions || []) {
      for (const kv of region.keyValues || []) {
        if (kv.timeRange) {
          timeStart = kv.timeRange.startPeriod.period.slice(0, 4);
          timeEnd = kv.timeRange.endPeriod.period.slice(0, 4);
        } else if (kv.values) {
          dimensions.push({ id: kv.id, values: kv.values });
          if (kv.id === "FREQ") frequencies = kv.values;
        }
      }
    }
  } catch {
    return null;
  }

  // 2. Per-country breakdown (if GEO_PICT dimension exists with reasonable count)
  const countries: CountryAvailability[] = [];

  if (geoCodes.length > 0 && geoCodes.length <= 40) {
    // Build the key position for GEO_PICT from the dimensions list
    // Key format: empty segments for wildcard, country code for GEO_PICT
    // We need to know which position GEO_PICT is in the key
    const geoIndex = dimensions.findIndex((d) => d.id === "GEO_PICT");
    if (geoIndex >= 0) {
      const keyParts = dimensions.map(() => "");

      for (const cc of geoCodes) {
        keyParts[geoIndex] = cc;
        const key = keyParts.join(".");
        const url = STAT_BASE + "/availableconstraint/" + dataflowId + "/" + key + "/all/TIME_PERIOD?mode=exact";

        try {
          const resp = await fetch(url, { headers: HEADERS });
          if (!resp.ok) {
            countries.push({ code: cc, obsCount: 0, timeStart: null, timeEnd: null });
            continue;
          }

          const cData = (await resp.json()) as {
            data: {
              contentConstraints: Array<{
                annotations?: Array<{ id?: string; title?: string }>;
                cubeRegions?: Array<{
                  keyValues?: Array<{
                    id: string;
                    timeRange?: {
                      startPeriod: { period: string };
                      endPeriod: { period: string };
                    };
                  }>;
                }>;
              }>;
            };
          };

          const cc_constraint = cData.data.contentConstraints[0];
          const cc_obs = (cc_constraint?.annotations || []).find((a) => a.id === "obs_count");
          let cc_start: string | null = null;
          let cc_end: string | null = null;

          for (const region of cc_constraint?.cubeRegions || []) {
            for (const kv of region.keyValues || []) {
              if (kv.timeRange) {
                cc_start = kv.timeRange.startPeriod.period.slice(0, 4);
                cc_end = kv.timeRange.endPeriod.period.slice(0, 4);
              }
            }
          }

          countries.push({
            code: cc,
            obsCount: cc_obs?.title ? parseInt(cc_obs.title, 10) : 0,
            timeStart: cc_start,
            timeEnd: cc_end,
          });
        } catch {
          countries.push({ code: cc, obsCount: 0, timeStart: null, timeEnd: null });
        }
      }
    }
  }

  return { obsCount, timeStart, timeEnd, frequencies, dimensions, countries };
}

// ── Main ──

interface Dataflow {
  id: string;
  name: string;
  description?: string;
}

interface Dimension {
  id: string;
  position: number;
  type: string;
  codelist: string | null;
}

interface Attribute {
  id: string;
  assignment_status: string;
}

interface StructureDetail {
  id: string;
  key_template: string;
  key_example?: string;
  dimensions: Dimension[];
  attributes: Attribute[];
  measure: string;
}

interface StructureResponse {
  dataflow?: { id: string; name: string; description?: string; version?: string };
  structure?: StructureDetail;
}

async function main() {
  console.log("Building dataflow semantic search index...\n");

  // Connect to MCP gateway.
  //
  // The token matters: without it the gateway is reachable but the sweep does
  // not survive 127 calls. A run that omitted it produced structures for 40
  // dataflows and nulls for the rest, silently.
  console.log("Connecting to MCP gateway at " + MCP_URL + "...");
  const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

  async function connect() {
    const c = await createMCPClient({
      transport: {
        type: "http",
        url: MCP_URL,
        ...(MCP_AUTH_TOKEN
          ? { headers: { Authorization: "Bearer " + MCP_AUTH_TOKEN } }
          : {}),
      },
    });
    return { c, t: await c.tools() };
  }

  let { c: client, t: tools } = await connect();
  console.log(
    "Connected. " + String(Object.keys(tools).length) + " tools available" +
    (MCP_AUTH_TOKEN ? " (authenticated)" : " (NO TOKEN — sweeps may be cut short)") + ".\n",
  );

  /**
   * Call an MCP tool, unwrapping the content envelope.
   *
   * Retries once on a fresh session. A single long-lived session gets dropped
   * part way through a 127-dataflow sweep, and every later call then fails; the
   * result was an index that lost two thirds of its structures without saying
   * so.
   */
  async function call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const tool = tools[toolName];
        if (!tool?.execute) throw new Error("Tool not found: " + toolName);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const raw = await (tool.execute as any)(args, { toolCallId: "idx-" + Date.now(), messages: [] });

        // MCP tools return { content: [{ type: "text", text: "..." }] }
        if (raw && typeof raw === "object" && "content" in raw) {
          const content = (raw as { content: Array<{ type: string; text: string }> }).content;
          if (content?.[0]?.type === "text" && content[0].text) {
            return JSON.parse(content[0].text);
          }
        }
        return raw;
      } catch (err) {
        if (attempt === 1) throw err;
        await client.close().catch(() => {});
        ({ c: client, t: tools } = await connect());
      }
    }
    throw new Error("unreachable");
  }

  // 1. Fetch all dataflows
  console.log("1. Fetching dataflows...");
  const allDataflows: Dataflow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const result = (await call("list_dataflows", {
      limit: 50,
      offset,
      endpoint: INDEX_ENDPOINT,
    })) as { dataflows: Dataflow[]; pagination: { has_more: boolean } };

    allDataflows.push(...result.dataflows);
    hasMore = result.pagination.has_more;
    offset += 50;
    process.stdout.write("\r  Fetched " + String(allDataflows.length) + " dataflows...");
  }
  console.log("\n  Found " + String(allDataflows.length) + " dataflows\n");

  // 1b. Enrich descriptions from .Stat REST API (list_dataflows truncates them)
  // Full names and descriptions, replacing the truncated summaries.
  const dataflowText = await fetchDataflowText();

  // 2. Fetch structures
  console.log("2. Fetching structures...");
  const structures = new Map<string, StructureResponse | null>();
  const structureFailures: string[] = [];
  for (let i = 0; i < allDataflows.length; i++) {
    const df = allDataflows[i];
    process.stdout.write(
      "\r  [" +
        String(i + 1) +
        "/" +
        String(allDataflows.length) +
        "] " +
        df.id +
        "                    ",
    );
    try {
      const s = (await call("get_dataflow_structure", {
        dataflow_id: df.id,
        endpoint: INDEX_ENDPOINT,
      })) as StructureResponse;
      structures.set(df.id, s);
    } catch {
      // Keep whatever the committed index already knows. A transient gateway
      // failure must never be able to delete a structure, because the loss is
      // invisible downstream: richText simply comes out shorter, everything
      // re-embeds, and the entry quietly stops describing its own dimensions.
      structureFailures.push(df.id);
      structures.set(df.id, null);
    }
  }
  console.log("\n");
  if (structureFailures.length) {
    console.warn(
      "  " + String(structureFailures.length) + " structure fetches failed: " +
      structureFailures.slice(0, 10).join(", ") +
      (structureFailures.length > 10 ? ", ..." : ""),
    );
  }

  // 3. Fetch categories from .Stat REST API
  console.log("3. Fetching categories from .Stat...");
  const categoryMap = await fetchCategories();
  const uncategorised = allDataflows.filter((df) => !categoryMap.has(df.id));
  if (uncategorised.length > 0) {
    console.log("  Uncategorised: " + uncategorised.map((d) => d.id).join(", "));
  }
  console.log("");

  // 4. Fetch availability from .Stat REST API
  console.log("4. Fetching availability from .Stat...");
  const availabilityMap = new Map<string, AvailabilityInfo>();
  for (let i = 0; i < allDataflows.length; i++) {
    const df = allDataflows[i];
    process.stdout.write(
      "\r  [" + String(i + 1) + "/" + String(allDataflows.length) + "] " + df.id + "                    ",
    );
    // First get the overall envelope (no per-country), then use the
    // GEO_PICT values from the envelope to do per-country calls
    const envelope = await fetchAvailability(df.id, []);
    if (envelope) {
      const geoDimAvail = envelope.dimensions.find((d) => d.id === "GEO_PICT");
      if (geoDimAvail && geoDimAvail.values.length > 0 && geoDimAvail.values.length <= 40) {
        // Re-fetch with per-country breakdown — the overall part is re-fetched
        // but it's one extra lightweight call to avoid storing intermediate state
        const detailed = await fetchAvailability(df.id, geoDimAvail.values);
        availabilityMap.set(df.id, detailed || envelope);
      } else {
        availabilityMap.set(df.id, envelope);
      }
    }
  }
  console.log("\n  Fetched availability for " + String(availabilityMap.size) + " dataflows\n");

  // 5. Build rich texts + persist structure metadata
  console.log("5. Building rich text descriptions...");
  const priorIndex = loadPreviousIndex();
  const previousStructures = new Map<string, unknown>(
    (priorIndex?.entries ?? []).map((e) => [e.id, (e as { structure?: unknown }).structure]),
  );
  const entries = allDataflows.map((df) => {
    const resp = structures.get(df.id) || null;
    // A failed fetch falls back to what the committed index already holds, so
    // a transient outage degrades nothing.
    const struct =
      resp?.structure || previousStructures.get(df.id) || null;
    // Prefer .Stat's full text; the MCP summary truncates descriptions.
    const text = dataflowText.get(df.id);
    const name = text?.name || df.name;
    const description = text?.description || df.description || "";
    const parts: string[] = [name];

    if (description) {
      parts.push(description);
    }

    if (struct?.dimensions) {
      const dimNames = struct.dimensions.map((d) => d.id);
      parts.push("Dimensions: " + dimNames.join(", "));

      const codelists = struct.dimensions
        .filter((d) => d.codelist)
        .map((d) => {
          const clName =
            (d.codelist || "").split(":").pop()?.split("(")[0] || "";
          return d.id + " (" + clName + ")";
        });
      if (codelists.length > 0) {
        parts.push("Codelists: " + codelists.join(", "));
      }
    }

    return {
      id: df.id,
      name,
      description,
      richText: parts.join(". "),
      categories: categoryMap.get(df.id) || [],
      structure: struct ? {
        id: struct.id,
        key_template: struct.key_template,
        dimensions: struct.dimensions,
        attributes: struct.attributes,
        measure: struct.measure,
      } : null,
      availability: availabilityMap.get(df.id) || null,
      endpoint: INDEX_ENDPOINT,
    };
  });
  console.log("  Built " + String(entries.length) + " descriptions\n");

  // 6. Embed only what changed
  console.log("6. Embedding descriptions...");
  const previous = loadPreviousIndex();

  /**
   * Refuse to publish an index that knows less than the one it replaces.
   *
   * The first scheduled run wrote 40 structures where the committed index had
   * 127, committed it, and reported success. Nothing downstream would have
   * complained: the explorer falls back to a live MCP call when an entry has no
   * structure, so the damage shows up only as slower pages and worse search.
   * An automated job that can quietly publish a worse artefact than it started
   * with is worth stopping outright.
   */
  if (previous) {
    const before = previous.entries.filter((e) => e.structure).length;
    const after = entries.filter((e) => e.structure).length;
    if (after < before) {
      console.error(
        "\nRefusing to write: structures went from " + String(before) +
        " to " + String(after) + " of " + String(entries.length) + ".",
      );
      console.error(
        "The gateway did not answer for " + String(structureFailures.length) +
        " dataflows. Nothing was changed; re-run when it is healthy.",
      );
      await client.close().catch(() => {});
      process.exit(1);
    }
  }
  const forceEmbed = process.argv.includes("--force-embed");

  // Embeddings from a different model live in a different vector space, so
  // mixing them would silently corrupt search rather than fail.
  const modelChanged = previous !== null && previous.modelId !== EMBED_MODEL_ID;
  if (modelChanged) {
    console.log("  Model changed (" + previous.modelId + " -> " + EMBED_MODEL_ID +
      "); re-embedding everything");
  }
  const reuse = !forceEmbed && !modelChanged;

  const priorByText = new Map<string, number[]>();
  if (reuse && previous) {
    for (const e of previous.entries) {
      if (e.embedding?.length) priorByText.set(e.id + "\u0000" + e.richText, e.embedding);
    }
  }

  const needEmbedding = entries.filter(
    (e) => !priorByText.has(e.id + "\u0000" + e.richText),
  );
  console.log(
    "  " + String(entries.length - needEmbedding.length) + " reused, " +
    String(needEmbedding.length) + " to embed",
  );

  const fresh = new Map<string, number[]>();
  if (needEmbedding.length > 0) {
    const { embedBatch } = await import("../lib/embeddings.js");
    const vectors = await embedBatch(needEmbedding.map((e) => e.richText));
    needEmbedding.forEach((e, i) => fresh.set(e.id, vectors[i]));
    console.log("  Embedded " + String(vectors.length) + " texts");
  }
  const priorIds = new Set((previous?.entries ?? []).map((e) => e.id));
  const added = entries.filter((e) => !priorIds.has(e.id)).map((e) => e.id);
  const removed = [...priorIds].filter((id) => !entries.some((e) => e.id === id));
  if (added.length) console.log("  Added: " + added.join(", "));
  if (removed.length) console.log("  Removed: " + removed.join(", "));
  console.log();

  // 7. Save index
  console.log("7. Saving index...");
  const nextEntries = entries.map((e) => ({
    ...e,
    embedding: fresh.get(e.id) ?? priorByText.get(e.id + "\u0000" + e.richText),
  }));

  // `createdAt` marks the last CONTENT change, not the last run. A daily job
  // that finds nothing new should leave the file byte-identical so it produces
  // no commit and no deploy; the job's own run history records that we looked.
  const unchanged =
    previous !== null &&
    JSON.stringify(previous.entries) === JSON.stringify(nextEntries);
  if (unchanged) {
    console.log("  No change. Index left untouched (built " +
      previous.createdAt + ").\n");
    // Same teardown as the success path: an open MCP client would hang the
    // scheduled job on the very runs that are meant to be cheapest.
    await client.close();
    console.log("Done! Nothing to update.");
    process.exit(0);
  }

  const index = {
    modelId: EMBED_MODEL_ID,
    createdAt: new Date().toISOString(),
    entries: nextEntries,
  };

  writeFileSync(INDEX_PATH, JSON.stringify(index), "utf-8");

  const sizeMB = (JSON.stringify(index).length / 1024 / 1024).toFixed(1);
  console.log(
    "  Saved to " +
      INDEX_PATH +
      " (" +
      sizeMB +
      " MB, " +
      String(index.entries.length) +
      " entries)\n",
  );

  // Cleanup
  await client.close();
  console.log("Done! Semantic search is ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
