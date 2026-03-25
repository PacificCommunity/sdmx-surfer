import { withMCPClient, callMcpTool } from "@/lib/mcp-client";

/**
 * GET /api/explore/[id] — get dataflow structure + diagram
 * GET /api/explore/[id]?codes=GEO_PICT — get dimension codes
 * GET /api/explore/[id]?availability=1 — get data availability
 */
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id: dataflowId } = await params;
    const url = new URL(req.url);
    const codesFor = url.searchParams.get("codes");
    const availability = url.searchParams.get("availability");

    if (codesFor) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "get_dimension_codes", {
          dataflow_id: dataflowId,
          dimension_id: codesFor,
        })
      );
      return Response.json(result);
    }

    if (availability) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "get_data_availability", {
          dataflow_id: dataflowId,
        })
      );
      return Response.json(result);
    }

    // Default: structure + diagram in parallel
    const { structure, diagram } = await withMCPClient(async (client) => {
      const [structure, diagram] = await Promise.all([
        callMcpTool(client, "get_dataflow_structure", {
          dataflow_id: dataflowId,
        }),
        callMcpTool(client, "get_structure_diagram", {
          structure_type: "dataflow",
          structure_id: dataflowId,
        }).catch(() => null), // diagram is optional
      ]);
      return { structure, diagram };
    });

    return Response.json({ structure, diagram });
  } catch (error) {
    console.error("[api/explore/" + "]", "Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch structure" },
      { status: 500 },
    );
  }
}
