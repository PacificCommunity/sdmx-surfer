import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
import { getDataflowEntry } from "@/lib/embeddings";
import { loadCoverage } from "@/lib/coverage/load";
import { indicatorGrid, listIndicators } from "@/lib/coverage/query";

/**
 * Everything this route returns is reference material about a dataflow:
 * dimensions, codelists, a diagram, and the availability snapshot carried by
 * the index. None of it is per-user, and none of it changes faster than the
 * daily index refresh. Without a header a browser refetches all of it on every
 * back-navigation, and each miss is a multi-second gateway round trip
 * (measured: diagram 4.8-5.9s, dimension codes 2.7-3.5s).
 *
 * `private` because the route sits behind auth, not because the data is
 * sensitive.
 */
const REFERENCE_CACHE = { "cache-control": "private, max-age=3600" };

/**
 * GET /api/explore/[id] — get dataflow structure (from index) + diagram (from MCP)
 * GET /api/explore/[id]?codes=GEO_PICT — get dimension codes (MCP)
 * GET /api/explore/[id]?availability=1 — get data availability (MCP)
 * GET /api/explore/[id]?coverage=1 — indicator list from the coverage artifact
 * GET /api/explore/[id]?coverage=1&indicator=X — that indicator's area × year grid
 *
 * Coverage is served one flow (or one indicator) at a time so the page never
 * ships models/dataflow-coverage.json whole.
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

    if (url.searchParams.get("coverage")) {
      const loaded = loadCoverage();
      const flow = loaded?.artifact.flows[dataflowId];
      if (!loaded || !flow) return Response.json({ coverage: null }, { headers: REFERENCE_CACHE });
      const indicator = url.searchParams.get("indicator");
      if (indicator) {
        const grid = indicatorGrid(flow, indicator, loaded.artifact.areaLabels);
        return Response.json({ grid }, { headers: REFERENCE_CACHE });
      }
      return Response.json({
        coverage: {
          detail: flow.detail,
          indicatorDim: flow.indicatorDim,
          indicatorRule: flow.indicatorRule,
          areaDim: flow.areaDim,
          obs: flow.obs,
          first: flow.first,
          last: flow.last,
          indicators: listIndicators(flow),
        },
      }, { headers: REFERENCE_CACHE });
    }

    // Dimension codes — always live from MCP
    if (codesFor) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "get_dimension_codes", {
          dataflow_id: dataflowId,
          dimension_id: codesFor,
        })
      );
      return Response.json(result, { headers: REFERENCE_CACHE });
    }

    // Data availability — always live from MCP
    if (availability) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "get_data_availability", {
          dataflow_id: dataflowId,
        })
      );
      return Response.json(result, { headers: REFERENCE_CACHE });
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
      return Response.json({
        structure: {
          dataflow: {
            id: entry.id,
            name: entry.name,
            description: entry.description,
          },
          structure: entry.structure,
        },
        endpoint: entry.endpoint ?? "SPC",
        categories: entry.categories || [],
        availability: entry.availability || null,
        diagram,
      }, { headers: REFERENCE_CACHE });
    }

    // Fallback to MCP if entry not in index
    const structure = await withMCPClient((client) =>
      callMcpTool(client, "get_dataflow_structure", {
        dataflow_id: dataflowId,
      }),
    );

    return Response.json({ structure, diagram }, { headers: REFERENCE_CACHE });
  } catch (error) {
    console.error("[api/explore/[id]]", "Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch structure" },
      { status: 500 },
    );
  }
}
