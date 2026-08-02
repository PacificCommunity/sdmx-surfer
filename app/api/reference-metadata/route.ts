import { auth } from "@/lib/auth";
import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
import {
  normaliseReferenceMetadata,
  type DataflowProvenance,
} from "@/lib/reference-metadata";

export const maxDuration = 25;

// Provenance for a dataflow: source, compilation method, revision policy.
// Called by the app (not the model) so citations are deterministic and cost
// no agent tokens — the AI chooses the query, this explains where the numbers
// came from.
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

  try {
    const raw = await withMCPClient((client) =>
      callMcpTool(client, "get_reference_metadata", {
        dataflow_id: dataflowId,
        ...(endpoint ? { endpoint } : {}),
      }),
    );
    const result: DataflowProvenance = normaliseReferenceMetadata(
      dataflowId,
      raw,
    );
    return Response.json(result, {
      // Provenance is editorial metadata; it changes far less often than data.
      headers: { "cache-control": "private, max-age=3600" },
    });
  } catch (error) {
    console.error("[api/reference-metadata]", dataflowId, error);
    return Response.json(
      { dataflowId, available: false, fields: [], note: "Metadata lookup failed." },
      { status: 200 },
    );
  }
}
