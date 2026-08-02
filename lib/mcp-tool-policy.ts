/**
 * Which MCP tools the agent is offered.
 *
 * The gateway exposes 19 tools (~9.4K tokens of schema). Handing all of them
 * to the model on every turn is not primarily a cost problem — tool schemas
 * sit at the head of the cached prefix — but a focus problem: eleven of them
 * are never mentioned in the system prompt, and several duplicate a step the
 * workflow already has, which gives the model plausible-but-wrong paths to
 * wander down.
 *
 * Two categories are excluded deliberately:
 *
 *   1. Tools the APP calls in code, never the model — `get_structure_diagram`
 *      and `find_code_usage_across_dataflows` are invoked directly by the
 *      /api/explore routes. Exposing them to the model is pure overhead.
 *   2. Tools redundant with the documented workflow — `build_key` (covered by
 *      `build_data_url`), `validate_query` (covered by `probe_data_url`),
 *      `get_codelist`/`get_code_usage` (covered by `get_dimension_codes` in
 *      dataflow context), `compare_structures`/`compare_dataflow_dimensions`
 *      (niche), and `get_current_endpoint`/`list_available_endpoints` (the
 *      prompt already lists the endpoints, and `endpoint=` is per-call).
 *
 * Set MCP_TOOL_ALLOWLIST to a comma-separated list to override, or to "off"
 * to pass every gateway tool through unfiltered (useful for A/B testing this
 * policy against the full set).
 */

/** The progressive-discovery workflow documented in the system prompt. */
export const DEFAULT_MODEL_FACING_MCP_TOOLS = [
  "list_dataflows",
  "get_dataflow_structure",
  "get_dimension_codes",
  "check_time_availability",
  "get_data_availability",
  "build_data_url",
  "probe_data_url",
  "suggest_nonempty_queries",
] as const;

/** Resolve the configured allowlist, or null when filtering is disabled. */
export function modelFacingMcpTools(): ReadonlySet<string> | null {
  const raw = process.env.MCP_TOOL_ALLOWLIST?.trim();
  if (raw && raw.toLowerCase() === "off") return null;
  if (raw) {
    const names = raw
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (names.length > 0) return new Set(names);
  }
  return new Set(DEFAULT_MODEL_FACING_MCP_TOOLS);
}

/**
 * Narrow a gateway tool map to the model-facing set. Unknown names in the
 * allowlist are ignored (the gateway is the source of truth), and a tool the
 * gateway stops exposing simply disappears — neither case throws, so a
 * gateway upgrade cannot break the chat route.
 */
export function filterMcpTools<T extends Record<string, unknown>>(
  tools: T,
): Partial<T> {
  const allow = modelFacingMcpTools();
  if (!allow) return tools;
  return Object.fromEntries(
    Object.entries(tools).filter(([name]) => allow.has(name)),
  ) as Partial<T>;
}
