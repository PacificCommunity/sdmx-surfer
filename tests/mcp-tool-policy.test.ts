import { describe, expect, it, beforeEach, afterEach } from "vitest";
import {
  filterMcpTools,
  modelFacingMcpTools,
  DEFAULT_MODEL_FACING_MCP_TOOLS,
} from "@/lib/mcp-tool-policy";

// Stand-in for the live gateway surface (19 tools as of v1.26.0).
const GATEWAY_TOOLS = Object.fromEntries(
  [
    "list_dataflows",
    "get_dataflow_structure",
    "get_dimension_codes",
    "check_time_availability",
    "get_data_availability",
    "build_data_url",
    "probe_data_url",
    "suggest_nonempty_queries",
    "get_codelist",
    "get_code_usage",
    "find_code_usage_across_dataflows",
    "compare_dataflow_dimensions",
    "compare_structures",
    "validate_query",
    "build_key",
    "get_structure_diagram",
    "get_reference_metadata",
    "get_current_endpoint",
    "list_available_endpoints",
  ].map((n) => [n, { description: n }]),
);

const ORIGINAL = process.env.MCP_TOOL_ALLOWLIST;

beforeEach(() => {
  delete process.env.MCP_TOOL_ALLOWLIST;
});
afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.MCP_TOOL_ALLOWLIST;
  else process.env.MCP_TOOL_ALLOWLIST = ORIGINAL;
});

describe("mcp tool policy", () => {
  it("narrows the gateway surface to the documented workflow", () => {
    const filtered = filterMcpTools(GATEWAY_TOOLS);
    expect(Object.keys(filtered).sort()).toEqual(
      [...DEFAULT_MODEL_FACING_MCP_TOOLS].sort(),
    );
  });

  it("drops tools the app calls itself rather than the model", () => {
    const filtered = filterMcpTools(GATEWAY_TOOLS);
    // /api/explore calls these directly via callMcpTool.
    expect(filtered).not.toHaveProperty("get_structure_diagram");
    expect(filtered).not.toHaveProperty("find_code_usage_across_dataflows");
  });

  it("keeps every step of the discovery workflow", () => {
    const filtered = filterMcpTools(GATEWAY_TOOLS);
    for (const t of [
      "list_dataflows",
      "get_dataflow_structure",
      "build_data_url",
      "probe_data_url",
      "suggest_nonempty_queries",
    ]) {
      expect(filtered).toHaveProperty(t);
    }
  });

  it("honours an explicit allowlist override", () => {
    process.env.MCP_TOOL_ALLOWLIST = "list_dataflows, build_data_url";
    expect(Object.keys(filterMcpTools(GATEWAY_TOOLS)).sort()).toEqual([
      "build_data_url",
      "list_dataflows",
    ]);
  });

  it('passes everything through when set to "off"', () => {
    process.env.MCP_TOOL_ALLOWLIST = "off";
    expect(modelFacingMcpTools()).toBeNull();
    expect(Object.keys(filterMcpTools(GATEWAY_TOOLS))).toHaveLength(
      Object.keys(GATEWAY_TOOLS).length,
    );
  });

  it("ignores allowlist entries the gateway does not expose", () => {
    process.env.MCP_TOOL_ALLOWLIST = "list_dataflows,not_a_real_tool";
    expect(Object.keys(filterMcpTools(GATEWAY_TOOLS))).toEqual([
      "list_dataflows",
    ]);
  });
});
