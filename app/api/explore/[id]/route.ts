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
      const result = await callMcpTool("get_dimension_codes", {
        dataflow_id: dataflowId,
        dimension_id: codesFor,
      });
      return Response.json(result);
    }

    if (availability) {
      const result = await callMcpTool("get_data_availability", {
        dataflow_id: dataflowId,
      });
      return Response.json(result);
    }

    // Default: structure + diagram in parallel
    const [structure, diagram] = await Promise.all([
      callMcpTool("get_dataflow_structure", {
        dataflow_id: dataflowId,
      }),
      callMcpTool("get_structure_diagram", {
        structure_type: "dataflow",
        structure_id: dataflowId,
      }).catch(() => null), // diagram is optional
    ]);

    return Response.json({ structure, diagram });
  } catch (error) {
    console.error("[api/explore/" + "]", "Failed:", error);
    return Response.json(
      { error: error instanceof Error ? error.message : "Failed to fetch structure" },
      { status: 500 },
    );
  }
}
