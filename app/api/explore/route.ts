import { withMCPClient, callMcpTool } from "@/lib/mcp-client";

/**
 * GET /api/explore — list all dataflows
 * GET /api/explore?country=FJ — find dataflows with data for a country
 * GET /api/explore?q=climate+vulnerability — semantic search
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const country = url.searchParams.get("country");
    const query = url.searchParams.get("q");

    // Semantic search
    if (query) {
      try {
        const { semanticSearch } = await import("@/lib/embeddings");
        const results = await semanticSearch(query, 20);
        return Response.json({
          dataflows: results.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            score: r.score,
          })),
          total: results.length,
          searchType: "semantic",
        });
      } catch (err) {
        // Fallback to keyword search if embeddings aren't set up
        console.error("[api/explore] Semantic search failed, falling back to keyword:", err instanceof Error ? err.message : err, err instanceof Error ? err.stack : "");
        // Fall through to keyword-based list_dataflows
        const result = await withMCPClient((client) =>
          callMcpTool(client, "list_dataflows", {
            keywords: query.split(/\s+/),
            limit: 20,
          })
        );
        return Response.json(result);
      }
    }

    if (country) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "find_code_usage_across_dataflows", {
          code: country.toUpperCase(),
          dimension_id: "GEO_PICT",
        })
      );
      return Response.json(result);
    }

    // Fetch all dataflows (paginated, collect all)
    const allDataflows: unknown[] = [];

    await withMCPClient(async (client) => {
      let offset = 0;
      const limit = 50;
      let hasMore = true;

      while (hasMore) {
        const result = (await callMcpTool(client, "list_dataflows", {
          limit,
          offset,
        })) as {
          dataflows: unknown[];
          pagination: { has_more: boolean };
        };

        allDataflows.push(...result.dataflows);
        hasMore = result.pagination.has_more;
        offset += limit;
      }
    });

    return Response.json({
      dataflows: allDataflows,
      total: allDataflows.length,
    });
  } catch (error) {
    console.error("[api/explore] Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch dataflows" },
      { status: 500 },
    );
  }
}
