import { auth } from "@/lib/auth";
import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
import {
  normaliseReferenceMetadata,
  resolveDrillDown,
  withResolvedFields,
  type DataflowProvenance,
  type DrillDownOutcome,
} from "@/lib/reference-metadata";

export const maxDuration = 25;

// Provenance for a dataflow: source, compilation method, revision policy.
// Called by the app (not the model) so citations are deterministic and cost
// no agent tokens — the AI chooses the query, this explains where the numbers
// came from.
//
// Answers are scoped to the panel's own query key, which is what makes them
// worth showing: keyed lookups resolve 23 of the 26 dataflows Country
// Snapshots cites, against 16 unkeyed, and the extra ones carry the specific
// per-country sourcing rather than a statement about the whole dataset.
//
// This was briefly served from a committed sweep of the catalogue. That is the
// wrong shape once the key is part of the question: the key space is unbounded,
// so a precomputed file could only ever answer the weaker dataflow-level
// version, and it would have to be rebuilt on a schedule to stay honest. An
// in-process cache carries the same load with no staleness to manage.
//
// The gateway is slow here: p50 3.6s, p90 7.5s, max 14.6s per call, each
// opening a fresh MCP session. So nothing is fetched until a user asks.

const TTL_MS = 6 * 60 * 60 * 1000;
const MAX_ENTRIES = 500;

const cache = new Map<string, { at: number; value: DataflowProvenance }>();
// Concurrent requests for the same dataflow share one gateway call rather than
// each paying the multi-second round-trip.
const inFlight = new Map<string, Promise<DataflowProvenance>>();

function fromCache(key: string): DataflowProvenance | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function store(key: string, value: DataflowProvenance) {
  // Absence is cached too: a flow that publishes nothing would otherwise pay
  // the full round-trip on every panel open, forever.
  if (cache.size >= MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { at: Date.now(), value });
}

async function lookup(
  key: string,
  dataflowId: string,
  endpoint: string,
  dataKey: string,
): Promise<DataflowProvenance> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const value = await withMCPClient(async (client) => {
      const raw = await callMcpTool(client, "get_reference_metadata", {
        dataflow_id: dataflowId,
        ...(dataKey ? { key: dataKey } : {}),
        ...(endpoint ? { endpoint } : {}),
      });
      const summary = normaliseReferenceMetadata(dataflowId, raw, dataKey);

      // Attributes attached below the dataflow report themselves populated
      // with no value; their text lives behind get_metadata_attribute. These
      // are the per-observation citations, so skipping the second call would
      // drop the most specific sourcing we have. Resolved here rather than in
      // the browser so a panel still costs the client one request.
      const pending = summary.pending ?? [];
      if (pending.length === 0) return withResolvedFields(summary, []);

      const resolved = await Promise.all(
        pending.map(async (attribute): Promise<DrillDownOutcome> => {
          try {
            const detail = await callMcpTool(client, "get_metadata_attribute", {
              dataflow_id: dataflowId,
              attribute_id: attribute.id,
              ...(dataKey ? { key: dataKey } : {}),
              ...(endpoint ? { endpoint } : {}),
            });
            return resolveDrillDown(attribute, detail);
          } catch {
            // One unreadable attribute must not lose the others, and a call we
            // never completed says nothing about what the provider publishes.
            return { kind: "unestablished" };
          }
        }),
      );
      return withResolvedFields(summary, resolved);
    });
    store(key, value);
    return value;
  })();

  inFlight.set(key, task);
  try {
    return await task;
  } finally {
    inFlight.delete(key);
  }
}

export async function GET(req: Request) {
  const session = await auth();
  if (!session?.user?.userId) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const dataflowId = (url.searchParams.get("dataflow") ?? "").trim();
  const endpoint = (url.searchParams.get("endpoint") ?? "").trim();
  if (!dataflowId) {
    return Response.json({ error: "missing dataflow" }, { status: 400 });
  }

  const dataKey = (url.searchParams.get("key") ?? "").trim();
  const key = endpoint + "|" + dataflowId + "|" + dataKey;

  const cached = fromCache(key);
  if (cached) {
    return Response.json(cached, {
      headers: {
        "cache-control": "private, max-age=3600",
        "x-provenance-source": "cache",
      },
    });
  }

  try {
    const result = await lookup(key, dataflowId, endpoint, dataKey);
    return Response.json(result, {
      // Provenance is editorial metadata; it changes far less often than data.
      headers: {
        "cache-control": "private, max-age=3600",
        "x-provenance-source": "live",
      },
    });
  } catch (error) {
    console.error("[api/reference-metadata]", dataflowId, error);
    // A failed lookup is NOT cached, and reads differently from an absent one:
    // "we could not check" must not be shown as "the provider published none".
    return Response.json(
      {
        dataflowId,
        available: false,
        fields: [],
        note: "Could not reach the metadata service. The API link is the direct source.",
      } satisfies DataflowProvenance,
      { status: 200 },
    );
  }
}
