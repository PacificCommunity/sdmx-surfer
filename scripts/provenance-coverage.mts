/**
 * Report reference-metadata coverage. A diagnostic, not a build step: nothing
 * at runtime depends on its output.
 *
 * It exists because coverage is the thing that decides whether the provenance
 * feature is worth anything, and coverage is a property of the provider, not
 * of this app. Run it to see what a provider publishes, and to tell whoever
 * curates a catalogue which dataflows are missing sourcing.
 *
 * Reports two numbers, because they differ a lot and only the second reflects
 * what a user sees:
 *   unkeyed — asking about the dataflow alone (channel msd_v2)
 *   keyed   — asking against a real query key, which also opens the
 *             dsd_attributes channel and its per-series/observation sourcing
 *
 * Usage:  npm run report:provenance                  (SPC, unkeyed sweep)
 *         npm run report:provenance -- --keyed       (adds keyed comparison
 *                                                     over snapshot flows)
 */
import { readFileSync } from "node:fs";
import { withMCPClient, callMcpTool } from "../lib/mcp-client";
import { normaliseReferenceMetadata } from "../lib/reference-metadata";

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

/** Run `job` over `items` in small batches, one MCP session per batch. */
async function inBatches<T>(
  items: T[],
  job: (client: unknown, item: T) => Promise<void>,
) {
  for (let i = 0; i < items.length; i += BATCH) {
    const batch = items.slice(i, i + BATCH);
    try {
      // A single long-lived session gets dropped part way through a sweep.
      await withMCPClient(async (client) => {
        await Promise.all(batch.map((item) => job(client, item)));
      });
    } catch {
      /* whole batch unreachable */
    }
    process.stderr.write(".");
  }
  process.stderr.write("\n");
}

/** Query keys actually used by Country Snapshots, one per dataflow. */
function snapshotKeys(): Array<[string, string]> {
  const src = readFileSync("lib/country-snapshots/catalogue.generated.ts", "utf8");
  const urls = [...src.matchAll(/https?:\/\/[^"'`\s]+\/data\/[^"'`\s]+/g)].map(
    (m) => m[0],
  );
  const byFlow = new Map<string, string>();
  for (const u of urls) {
    const m = /\/data\/([^/]+)\/([^?/]*)/.exec(u);
    if (!m) continue;
    const flow = m[1].split(",").slice(-2)[0] || m[1];
    // TAG_GEO is the per-country placeholder; any real country will do.
    if (!byFlow.has(flow)) byFlow.set(flow, m[2].replace("[TAG_GEO]", "FJ"));
  }
  return [...byFlow];
}

async function unkeyedSweep(endpoint: string) {
  const ids = await listDataflows(endpoint);
  let withProvenance = 0;
  const blank: string[] = [];
  await inBatches(ids, async (client, id) => {
    try {
      const raw = await callMcpTool(client as never, "get_reference_metadata", {
        dataflow_id: id,
        ...(endpoint ? { endpoint } : {}),
      });
      if (normaliseReferenceMetadata(id, raw).available) withProvenance++;
      else blank.push(id);
    } catch {
      blank.push(id + "(err)");
    }
  });
  console.log("\n=== " + endpoint + ", unkeyed ===");
  console.log("  " + withProvenance + "/" + ids.length + " publish provenance");
  console.log("  blank: " + blank.join(", "));
}

async function keyedComparison(endpoint: string) {
  const cases = snapshotKeys();
  let keyed = 0;
  let unkeyed = 0;
  const blank: string[] = [];
  await inBatches(cases, async (client, [flow, key]) => {
    const ask = async (withKey: boolean) => {
      try {
        const raw = await callMcpTool(client as never, "get_reference_metadata", {
          dataflow_id: flow,
          ...(withKey ? { key } : {}),
          ...(endpoint ? { endpoint } : {}),
        });
        return normaliseReferenceMetadata(flow, raw, withKey ? key : undefined)
          .available;
      } catch {
        return false;
      }
    };
    if (await ask(false)) unkeyed++;
    if (await ask(true)) keyed++;
    else blank.push(flow);
  });
  console.log("\n=== " + endpoint + ", flows cited by Country Snapshots ===");
  console.log("  unkeyed: " + unkeyed + "/" + cases.length);
  console.log("  keyed  : " + keyed + "/" + cases.length);
  console.log("  no provenance at any level: " + blank.join(", "));
}

async function main() {
  const args = process.argv.slice(2);
  const endpoints = args.filter((a) => !a.startsWith("--"));
  const endpoint = endpoints[0] ?? "SPC";
  await unkeyedSweep(endpoint);
  if (args.includes("--keyed")) await keyedComparison(endpoint);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
