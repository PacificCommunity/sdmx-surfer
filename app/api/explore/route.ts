import { createMCPClient } from "@ai-sdk/mcp";

let mcpClientPromise: ReturnType<typeof createMCPClient> | null = null;

function getMCPClient() {
  if (!mcpClientPromise) {
    mcpClientPromise = createMCPClient({
      transport: {
        type: "http",
        url: process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp",
      },
    }).catch((error) => {
      mcpClientPromise = null;
      throw error;
    });
  }
  return mcpClientPromise;
}

async function callMcpTool(toolName: string, args: Record<string, unknown>) {
  const client = await getMCPClient();
  const tools = await client.tools();
  const tool = tools[toolName];
  if (!tool || !tool.execute) {
    throw new Error("Tool not found: " + toolName);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (tool.execute as any)(args, { toolCallId: "explore-" + Date.now(), messages: [] });

  // MCP tools return { content: [{ type: "text", text: "..." }] } — unwrap
  if (raw && typeof raw === "object" && "content" in raw) {
    const content = (raw as { content: Array<{ type: string; text: string }> }).content;
    if (content?.[0]?.type === "text" && content[0].text) {
      return JSON.parse(content[0].text);
    }
  }
  return raw;
}

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
        const result = await callMcpTool("list_dataflows", {
          keywords: query.split(/\s+/),
          limit: 20,
        });
        return Response.json(result);
      }
    }

    if (country) {
      const result = await callMcpTool("find_code_usage_across_dataflows", {
        code: country.toUpperCase(),
        dimension_id: "GEO_PICT",
      });
      return Response.json(result);
    }

    // Fetch all dataflows (paginated, collect all)
    const allDataflows: unknown[] = [];
    let offset = 0;
    const limit = 50;
    let hasMore = true;

    while (hasMore) {
      const result = (await callMcpTool("list_dataflows", {
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
