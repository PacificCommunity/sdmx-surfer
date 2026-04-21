import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
import { loadIndex, semanticSearch } from "@/lib/embeddings";

/**
 * GET /api/explore — list all dataflows (from pre-built index, no MCP)
 * GET /api/explore?country=FJ — find dataflows with data for a country (MCP)
 * GET /api/explore?q=climate+vulnerability — semantic search (index + embedding API)
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const country = url.searchParams.get("country");
    const query = url.searchParams.get("q");

    // Semantic search — embed query, compare against index
    if (query) {
      try {
        const results = await semanticSearch(query, 20);
        // Enrich with categories from index
        const index = loadIndex();
        const catMap = new Map(
          (index?.entries || []).map((e) => [e.id, e.categories || []]),
        );
        return Response.json({
          dataflows: results.map((r) => ({
            id: r.id,
            name: r.name,
            description: r.description,
            score: r.score,
            endpoint: r.endpoint,
            categories: catMap.get(r.id) || [],
          })),
          total: results.length,
          searchType: "semantic",
        });
      } catch (err) {
        console.error("[api/explore] Semantic search failed, falling back to keyword:", err instanceof Error ? err.message : err, err instanceof Error ? err.stack : "");
        // Fallback: keyword filter against the index entries
        const index = loadIndex();
        if (index) {
          const words = query.toLowerCase().split(/\s+/);
          const filtered = index.entries.filter((e) => {
            const text = (e.id + " " + e.name + " " + e.description).toLowerCase();
            return words.some((w) => text.includes(w));
          });
          return Response.json({
            dataflows: filtered.map((e) => ({
              id: e.id, name: e.name, description: e.description,
              endpoint: e.endpoint ?? "SPC",
              categories: e.categories || [],
            })),
            total: filtered.length,
            searchType: "keyword",
          });
        }
      }
    }

    // Country filter — needs MCP (index doesn't have per-country availability)
    if (country) {
      const result = await withMCPClient((client) =>
        callMcpTool(client, "find_code_usage_across_dataflows", {
          code: country.toUpperCase(),
          dimension_id: "GEO_PICT",
        })
      );
      return Response.json(result);
    }

    // Default: serve the full dataflow list from the pre-built index (instant, no MCP)
    const index = loadIndex();
    if (index && index.entries.length > 0) {
      return Response.json({
        dataflows: index.entries.map((e) => ({
          id: e.id,
          name: e.name,
          description: e.description,
          endpoint: e.endpoint ?? "SPC",
          categories: e.categories || [],
        })),
        total: index.entries.length,
      });
    }

    // Index unavailable — fall back to MCP
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
