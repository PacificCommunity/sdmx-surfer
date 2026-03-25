import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

const MCP_URL = process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp";

/**
 * Execute a function with a fresh MCP client.
 * Creates a new session per request (safe for multi-user).
 * Client auto-closed after function completes.
 */
export async function withMCPClient<T>(
  fn: (client: MCPClient) => Promise<T>,
): Promise<T> {
  const client = await createMCPClient({
    transport: { type: "http", url: MCP_URL },
  });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Call a single MCP tool and unwrap the response envelope.
 */
export async function callMcpTool(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tools = await client.tools();
  const tool = tools[toolName];
  if (!tool?.execute) {
    throw new Error("MCP tool not found: " + toolName);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (tool.execute as any)(args, {
    toolCallId: "mcp-" + Date.now(),
    messages: [],
  });

  if (raw && typeof raw === "object" && "content" in raw) {
    const content = (raw as { content: Array<{ type: string; text: string }> })
      .content;
    if (content?.[0]?.type === "text" && content[0].text) {
      return JSON.parse(content[0].text);
    }
  }
  return raw;
}
