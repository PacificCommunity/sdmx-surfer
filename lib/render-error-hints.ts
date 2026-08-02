/**
 * Corrective hints for the rendering library's typed error contract.
 *
 * sdmx-dashboard-components (0.4.7+) reports per-visual failures as
 * SDMXRenderError with a stable `code`. The library's own message explains
 * WHAT went wrong; these hints tell the agent WHAT TO DO about it, in the
 * vocabulary of our authoring schema and MCP workflow.
 *
 * Used by the builder preview when auto-forwarding a render failure to the
 * model, so a failed panel produces a targeted repair instead of a generic
 * "something broke, try again".
 */

/** Mirrors SDMXRenderErrorCode from sdmx-dashboard-components. */
export type RenderErrorCode =
  | "ERR_FETCH"
  | "ERR_PARSE"
  | "ERR_EMPTY"
  | "ERR_NO_SERIES_DIMENSION"
  | "ERR_AMBIGUOUS_SERIES"
  | "ERR_CONCEPT_NOT_FOUND"
  | "ERR_ENGINE";

const HINTS: Record<RenderErrorCode, string> = {
  ERR_FETCH:
    "The data URL could not be fetched. Rebuild it with build_data_url (never hand-write a URL), then confirm it with probe_data_url before sending the config again.",
  ERR_PARSE:
    "The endpoint returned something the parser could not read. Rebuild the URL with build_data_url and probe it; if the probe also fails, pick a different dataflow.",
  ERR_EMPTY:
    "The query returned no observations. Widen it: drop lastNObservations, broaden the time range, or remove a dimension filter. Use suggest_nonempty_queries to find a filter combination that has data, then probe before resending.",
  ERR_NO_SERIES_DIMENSION:
    "A bar/column/lollipop/treemap chart needs a series dimension that actually varies. Either set seriesBy to a dimension with more than one value in this query, or switch chartType to line or pie. For cross-country comparisons use xAxis=TIME_PERIOD with seriesBy=<geo dimension>; never put the geo dimension on the x-axis.",
  ERR_AMBIGUOUS_SERIES:
    "Two or more dimensions vary in this query, so the chart cannot tell which is the series. Pin every dimension except xAxis and seriesBy to a single value in the data URL (rebuild it with build_data_url), or set seriesBy explicitly.",
  ERR_CONCEPT_NOT_FOUND:
    "A concept named in the config does not exist in this dataflow. Call get_dataflow_structure for the dataflow and use the exact dimension ids it lists (geography is GEO_PICT on SPC flows, REF_AREA on many others) for xAxis, seriesBy and legend.concept.",
  ERR_ENGINE:
    "The charting engine rejected the data, usually because values are not plottable for this chart type. Try a different chartType, or check that the query returns numeric observations.",
};

/**
 * Build the agent-facing description of a failed visual: the library's own
 * message plus the corrective action for its code.
 */
export function describeRenderError(args: {
  visualId?: string;
  code?: string;
  message: string;
}): string {
  const where = args.visualId ? `Panel "${args.visualId}"` : "A panel";
  const hint =
    args.code && args.code in HINTS
      ? " FIX: " + HINTS[args.code as RenderErrorCode]
      : "";
  const code = args.code ? ` [${args.code}]` : "";
  return `${where} failed${code}: ${args.message}${hint}`;
}
