import { auth } from "@/lib/auth";
import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
import {
  normaliseReferenceMetadata,
  type DataflowProvenance,
} from "@/lib/reference-metadata";
import { lookupProvenance } from "@/lib/provenance-index";

export const maxDuration = 25;

// Provenance for a dataflow: source, compilation method, revision policy.
// Called by the app (not the model) so citations are deterministic and cost
// no agent tokens — the AI chooses the query, this explains where the numbers
// came from.
//
// The gateway is slow here: measured across the 127-flow SPC catalogue, p50
// 3.6s, p90 7.5s, max 14.6s per call, each opening a fresh MCP session, and
// only 69 of those 127 have anything to show. So requests are answered from
// the committed sweep first (lib/provenance-index), then an in-process cache,
// and only then live.

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
): Promise<DataflowProvenance> {
  const existing = inFlight.get(key);
  if (existing) return existing;

  const task = (async () => {
    const raw = await withMCPClient((client) =>
      callMcpTool(client, "get_reference_metadata", {
        dataflow_id: dataflowId,
        ...(endpoint ? { endpoint } : {}),
      }),
    );
    const value = normaliseReferenceMetadata(dataflowId, raw);
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

  const key = endpoint + "|" + dataflowId;

  // The committed sweep answers most requests with no gateway call at all.
  const indexed = lookupProvenance(dataflowId, endpoint);
  if (indexed) {
    return Response.json(indexed, {
      headers: {
        "cache-control": "private, max-age=3600",
        "x-provenance-source": "index",
      },
    });
  }

  const cached = fromCache(key);
  if (cached) {
    return Response.json(cached, {
      headers: {
        "cache-control": "private, max-age=3600",
        "x-provenance-source": "cache",
      },
    });
  }

  // `probe` asks only what can be answered instantly. The UI uses it on mount
  // to decide whether to offer the control at all, so it must never block on
  // a multi-second gateway call: an unknown flow reports itself as unknown and
  // is resolved live only if the user actually opens the panel.
  if (url.searchParams.get("probe") === "1") {
    return Response.json(
      { dataflowId, available: false, fields: [], status: "unknown" },
      { headers: { "x-provenance-source": "unknown" } },
    );
  }

  try {
    const result = await lookup(key, dataflowId, endpoint);
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
