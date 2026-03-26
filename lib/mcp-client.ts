import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

const MCP_URL = process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp";
const MCP_AUTH_TOKEN = process.env.MCP_AUTH_TOKEN;

function mcpTransportConfig() {
  const config: { type: "http"; url: string; headers?: Record<string, string> } = {
    type: "http",
    url: MCP_URL,
  };
  if (MCP_AUTH_TOKEN) {
    config.headers = { Authorization: "Bearer " + MCP_AUTH_TOKEN };
  }
  return config;
}

/**
 * Execute a function with a fresh MCP client.
 * Creates a new session per request (safe for multi-user).
 * Sends MCP_AUTH_TOKEN as Bearer header if configured.
 * Client auto-closed after function completes.
 */
export async function withMCPClient<T>(
  fn: (client: MCPClient) => Promise<T>,
): Promise<T> {
  const client = await createMCPClient({
    transport: mcpTransportConfig(),
  });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/** Exported for the chat route which needs to manage its own client lifecycle. */
export { mcpTransportConfig };

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
