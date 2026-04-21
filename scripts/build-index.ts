#!/usr/bin/env npx tsx
/**
 * Build the semantic search index for dataflows.
 *
 * Usage:
 *   npm run build-index
 *
 * Requires:
 *   - MCP gateway running (locally or on Railway)
 *   - GOOGLE_AI_API_KEY set (for embedding via Gemini)
 *
 * This script:
 * 1. Fetches all dataflows from the MCP gateway via AI SDK's MCP client
 * 2. For each, fetches the structure (dimensions, codelists)
 * 3. Builds a rich text description for embedding
 * 4. Embeds each description with Google gemini-embedding-001
 * 5. Saves the index to models/dataflow-index.json
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
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
const STAT_BASE = "https://stats-nsi-stable.pacificdata.org/rest";

// ── Category fetching from .Stat SDMX REST API ──

interface CategoryTag {
  scheme: string;
  id: string;
  name: string;
}

/**
 * Fetch category-to-dataflow mappings from SPC .Stat category schemes.
 * Returns a map: dataflow ID → array of category tags.
 */
async function fetchCategories(): Promise<Map<string, CategoryTag[]>> {
  const map = new Map<string, CategoryTag[]>();
  const schemes = ["CAS_COM_TOPIC", "CAS_COM_DEV"];

  for (const scheme of schemes) {
    const url = STAT_BASE + "/categoryscheme/SPC/" + scheme + "/latest?references=all";
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
      if (!resp.ok) {
        console.warn("  Warning: could not fetch " + scheme + " (" + String(resp.status) + ")");
        continue;
      }
      const data = (await resp.json()) as {
        references?: Record<string, {
          items?: Array<{
            id: string;
            name: string;
            links?: Array<{ href: string; rel: string }>;
          }>;
        }>;
      };

      const refs = data.references || {};
      for (const ref of Object.values(refs)) {
        for (const item of ref.items || []) {
          const dfLinks = (item.links || [])
            .filter((l) => l.rel === "dataflow")
            .map((l) => {
              const m = l.href.match(/Dataflow=SPC:([^(]+)/);
              return m ? m[1] : null;
            })
            .filter((id): id is string => id !== null);

          for (const dfId of dfLinks) {
            const existing = map.get(dfId) || [];
            // Deduplicate within the same scheme+id
            if (!existing.some((t) => t.scheme === scheme && t.id === item.id)) {
              existing.push({ scheme, id: item.id, name: item.name });
            }
            map.set(dfId, existing);
          }
        }
      }
      console.log("  Fetched " + scheme + ": " + String(map.size) + " dataflows categorised so far");
    } catch (err) {
      console.warn("  Warning: failed to fetch " + scheme + ":", err instanceof Error ? err.message : err);
    }
  }

  return map;
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

  // Connect to MCP gateway
  console.log("Connecting to MCP gateway at " + MCP_URL + "...");
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: MCP_URL,
    },
  });

  const tools = await client.tools();
  console.log("Connected. " + String(Object.keys(tools).length) + " tools available.\n");

  // Helper to call MCP tools — unwraps the MCP content envelope
  async function call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
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
  console.log("   Fetching full descriptions from .Stat REST API...");
  try {
    const dfResp = await fetch(
      STAT_BASE + "/dataflow/SPC?references=none",
      { headers: { Accept: "application/json", "Accept-Language": "en" } },
    );
    if (dfResp.ok) {
      const dfData = (await dfResp.json()) as {
        references?: Record<string, { id: string; description?: string }>;
      };
      const refs = dfData.references || {};
      let enriched = 0;
      for (const ref of Object.values(refs)) {
        if (ref.description) {
          const df = allDataflows.find((d) => d.id === ref.id);
          if (df && (!df.description || df.description.endsWith("..."))) {
            df.description = ref.description;
            enriched++;
          }
        }
      }
      console.log("  Enriched " + String(enriched) + " truncated descriptions\n");
    } else {
      console.log("  Warning: .Stat returned " + String(dfResp.status) + ", using truncated descriptions\n");
    }
  } catch (err) {
    console.log("  Warning: could not fetch full descriptions:", err instanceof Error ? err.message : err, "\n");
  }

  // 2. Fetch structures
  console.log("2. Fetching structures...");
  const structures = new Map<string, StructureResponse | null>();
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
      structures.set(df.id, null);
    }
  }
  console.log("\n");

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
  const entries = allDataflows.map((df) => {
    const resp = structures.get(df.id) || null;
    const struct = resp?.structure || null;
    const parts: string[] = [df.name];

    if (df.description) {
      parts.push(df.description);
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
      name: df.name,
      description: df.description || "",
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

  // 6. Embed
  console.log("6. Embedding descriptions...");
  console.log("   (Loading model — first run may take a moment)\n");

  const { embedBatch } = await import("../lib/embeddings.js");
  const texts = entries.map((e) => e.richText);
  const embeddings = await embedBatch(texts);
  console.log("  Embedded " + String(embeddings.length) + " texts\n");

  // 7. Save index
  console.log("7. Saving index...");
  const index = {
    modelId: "gemini-embedding-001",
    createdAt: new Date().toISOString(),
    entries: entries.map((e, i) => ({
      ...e,
      embedding: embeddings[i],
    })),
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
