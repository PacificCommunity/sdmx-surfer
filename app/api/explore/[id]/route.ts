import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
import { getDataflowEntry } from "@/lib/embeddings";

/**
 * GET /api/explore/[id] — get dataflow structure (from index) + diagram (from MCP)
 * GET /api/explore/[id]?codes=GEO_PICT — get dimension codes (MCP)
 * GET /api/explore/[id]?availability=1 — get data availability (MCP)
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

    // Dimension codes — always live from MCP
    if (codesFor) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "get_dimension_codes", {
          dataflow_id: dataflowId,
          dimension_id: codesFor,
        })
      );
      return Response.json(result);
    }

    // Data availability — always live from MCP
    if (availability) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "get_data_availability", {
          dataflow_id: dataflowId,
        })
      );
      return Response.json(result);
    }

    // Default: structure from pre-built index, diagram from MCP
    const entry = getDataflowEntry(dataflowId);

    // Diagram always needs MCP (not stored in index)
    const diagram = await withMCPClient((client) =>
      callMcpTool(client, "get_structure_diagram", {
        structure_type: "dataflow",
        structure_id: dataflowId,
      }).catch(() => null),
    );

    if (entry?.structure) {
      // Serve structure from index — matches the shape the detail page expects
      return Response.json({
        structure: {
          dataflow: {
            id: entry.id,
            name: entry.name,
            description: entry.description,
          },
          structure: entry.structure,
        },
        diagram,
      });
    }

    // Fallback to MCP if entry not in index
    const structure = await withMCPClient((client) =>
      callMcpTool(client, "get_dataflow_structure", {
        dataflow_id: dataflowId,
      }),
    );

    return Response.json({ structure, diagram });
  } catch (error) {
    console.error("[api/explore/[id]]", "Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch structure" },
      { status: 500 },
    );
  }
}
