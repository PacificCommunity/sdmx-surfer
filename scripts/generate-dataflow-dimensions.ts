#!/usr/bin/env node
/**
 * Generate data/country-snapshots/dataflow-dimensions.json from the MCP
 * gateway for EVERY dataflow referenced by the catalogue.
 *
 * The renderers use this file to pick the country dimension for chart
 * legends (GEO_PICT for SPC flows, REF_AREA for SDG-family, …). A
 * hand-maintained subset silently fell back to GEO_PICT for uncovered
 * flows; generating it from the same source of truth as the chart-type
 * augmentation removes that drift.
 *
 * Usage: tsx scripts/generate-dataflow-dimensions.ts
 * Requires MCP_GATEWAY_URL (and optionally MCP_AUTH_TOKEN) in the env.
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { catalogue } from "../lib/country-snapshots/catalogue.generated";
import { withMCPClient, callMcpTool } from "../lib/mcp-client";

const OUT_PATH = "data/country-snapshots/dataflow-dimensions.json";

type StructureResult = {
  structure?: {
    dimensions?: Array<{ id?: string; type?: string }>;
  };
};

async function main() {
  const dataflows = Array.from(
    new Set(
      catalogue.indicators
        .map((i) => i.dataflow)
        .filter((d): d is string => Boolean(d)),
    ),
  ).sort();

  console.error(`Fetching structures for ${dataflows.length} dataflows…`);

  const out: Record<string, string[]> = {};
  const failures: string[] = [];

  await withMCPClient(async (client) => {
    for (const df of dataflows) {
      try {
        const res = (await callMcpTool(client, "get_dataflow_structure", {
          dataflow_id: df,
        })) as StructureResult;
        const dims = (res.structure?.dimensions ?? [])
          .filter((d) => d.type !== "TimeDimension")
          .map((d) => d.id)
          .filter((id): id is string => Boolean(id));
        if (dims.length === 0) {
          failures.push(`${df}: structure returned no dimensions`);
          continue;
        }
        out[df] = dims;
        console.error(`  ${df}: ${dims.join(", ")}`);
      } catch (err) {
        failures.push(`${df}: ${err instanceof Error ? err.message : err}`);
      }
    }
  });

  if (failures.length > 0) {
    console.error("\nFailed dataflows (kept out of the JSON):");
    for (const f of failures) console.error("  - " + f);
  }

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2) + "\n", "utf8");
  console.error(
    `\nWrote ${OUT_PATH}: ${Object.keys(out).length}/${dataflows.length} dataflows.`,
  );
  if (failures.length > 0) process.exit(1);
}

void main();
