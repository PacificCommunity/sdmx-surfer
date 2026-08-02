/**
 * Build the static provenance index.
 *
 * Reference metadata is editorial: it changes on the scale of months, while a
 * live lookup costs p50 3.6s / p90 7.5s and only about half the catalogue has
 * anything to show. Sweeping it ahead of time lets the app decide instantly
 * whether a dataflow has provenance worth offering, and serve the text with
 * no gateway call at all.
 *
 * Usage:  npm run build:provenance
 *         npm run build:provenance -- SPC ABS      (specific endpoints)
 */
import { writeFileSync } from "node:fs";
import { withMCPClient, callMcpTool } from "../lib/mcp-client";
import {
  normaliseReferenceMetadata,
  type DataflowProvenance,
} from "../lib/reference-metadata";

const OUT = "data/provenance-index.json";
const BATCH = 6;

async function listDataflows(endpoint: string): Promise<string[]> {
  return withMCPClient(async (client) => {
    const out: string[] = [];
    for (let offset = 0; offset < 1000; offset += 50) {
      const page = (await callMcpTool(client, "list_dataflows", {
        limit: 50,
        offset,
        ...(endpoint ? { endpoint } : {}),
      })) as {
        dataflows?: Array<{ id: string }>;
        pagination?: { has_more?: boolean };
      };
      for (const d of page.dataflows ?? []) out.push(d.id);
      if (!page.pagination?.has_more) break;
    }
    return out;
  });
}

async function sweep(endpoint: string) {
  const ids = await listDataflows(endpoint);
  console.log(endpoint + ": " + ids.length + " dataflows");
  const entries: Record<string, DataflowProvenance> = {};
  let withText = 0;

  for (let i = 0; i < ids.length; i += BATCH) {
    const batch = ids.slice(i, i + BATCH);
    // A fresh session per batch: one long-lived session gets dropped mid-sweep.
    try {
      await withMCPClient(async (client) => {
        await Promise.all(
          batch.map(async (id) => {
            try {
              const raw = await callMcpTool(client, "get_reference_metadata", {
                dataflow_id: id,
                ...(endpoint ? { endpoint } : {}),
              });
              const p = normaliseReferenceMetadata(id, raw);
              entries[id] = p;
              if (p.available) withText++;
            } catch {
              /* leave absent: the route falls back to a live lookup */
            }
          }),
        );
      });
    } catch {
      /* whole batch unreachable; leave absent */
    }
    process.stderr.write(".");
  }
  console.log(
    "\n" + endpoint + ": " + withText + "/" + ids.length + " carry provenance",
  );
  return entries;
}

async function main() {
  const endpoints = process.argv.slice(2).length
    ? process.argv.slice(2)
    : ["SPC"];
  const index: Record<string, Record<string, DataflowProvenance>> = {};
  for (const ep of endpoints) index[ep] = await sweep(ep);

  writeFileSync(
    OUT,
    JSON.stringify(
      { builtAt: new Date().toISOString(), endpoints: index },
      null,
      1,
    ) + "\n",
  );
  console.log("wrote " + OUT);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
