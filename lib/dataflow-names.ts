/**
 * Resolve dataflow IDs to human-readable names using the pre-built index.
 * Server-side only — reads models/dataflow-index.json.
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");

let nameMap: Map<string, string> | null = null;

function loadNameMap(): Map<string, string> {
  if (nameMap) return nameMap;

  nameMap = new Map();
  if (!existsSync(INDEX_PATH)) return nameMap;

  try {
    const raw = JSON.parse(readFileSync(INDEX_PATH, "utf-8")) as {
      entries: Array<{ id: string; name: string }>;
    };
    for (const entry of raw.entries) {
      nameMap.set(entry.id, entry.name);
    }
  } catch {
    // Index missing or malformed — return empty map, fall back to IDs
  }

  return nameMap;
}

/**
 * Look up a single dataflow name. Returns the ID itself if not found.
 */
export function getDataflowName(id: string): string {
  return loadNameMap().get(id) || id;
}

/**
 * Given a list of dataflow IDs, return a Record mapping each to its name.
 */
export function resolveDataflowNames(ids: string[]): Record<string, string> {
  const map = loadNameMap();
  const result: Record<string, string> = {};
  for (const id of ids) {
    if (id) {
      result[id] = map.get(id) || id;
    }
  }
  return result;
}

/**
 * Extract dataflow IDs from all data URLs in a compiled dashboard config,
 * then resolve them to names from the index.
 */
export function resolveDataflowNamesFromConfig(config: {
  dataflows?: Record<string, string>;
  rows: Array<{ columns: Array<{ data?: string | string[] }> }>;
}): Record<string, string> {
  // If the config already has dataflows, keep them (user/LLM override)
  const existing = config.dataflows ?? {};

  const ids = new Set<string>();
  for (const row of config.rows) {
    for (const col of row.columns) {
      if (!col.data) continue;
      const urls = Array.isArray(col.data) ? col.data : [col.data];
      for (const url of urls) {
        const dfId = extractDataflowId(url);
        if (dfId && !existing[dfId]) {
          ids.add(dfId);
        }
      }
    }
  }

  return { ...resolveDataflowNames(Array.from(ids)), ...existing };
}

/**
 * Extract a dataflow ID from an SDMX REST data URL.
 * Handles: /rest/data/AGENCY,DF_ID,VERSION/KEY and /rest/data/DF_ID/KEY
 */
function extractDataflowId(url: string): string | null {
  try {
    const pathParts = new URL(url).pathname.split("/");
    const dataIdx = pathParts.indexOf("data");
    if (dataIdx === -1 || dataIdx + 1 >= pathParts.length) return null;

    const flowPart = pathParts[dataIdx + 1];
    if (flowPart.includes(",")) {
      const segments = flowPart.split(",");
      return segments.length >= 2 ? segments[1] : flowPart;
    }
    return flowPart;
  } catch {
    return null;
  }
}
