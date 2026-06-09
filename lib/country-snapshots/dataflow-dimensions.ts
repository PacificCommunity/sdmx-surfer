import dimensionsRaw from "@/data/country-snapshots/dataflow-dimensions.json";

const DIMENSIONS: Record<string, string[]> =
  dimensionsRaw as Record<string, string[]>;

// SDMX has no single canonical name for "the country/area dimension". SPC
// flows use GEO_PICT, the SDG family uses REF_AREA, other providers may
// differ again. This list is the set we recognise.
const GEO_DIM_NAMES = ["GEO_PICT", "REF_AREA", "COUNTRY"];

/**
 * Resolve the SDMX dimension name to use as the country series concept on
 * legend.concept when rendering a chart for the given dataflow. Looks up
 * `data/country-snapshots/dataflow-dimensions.json` and returns the first
 * known geo dimension name present in that dataflow's structure.
 *
 * Falls back to GEO_PICT (the dominant SPC convention) when the dataflow
 * isn't in the JSON yet — that keeps things working for unrecognised
 * dataflows without crashing the library, at the cost of a console warning.
 *
 * Add new dataflows to dataflow-dimensions.json as they appear in the
 * catalogue. The dim list is what MCP's get_dataflow_structure returns
 * for that DSD, minus TIME_PERIOD.
 */
export function geoConceptForDataflow(
  dataflow: string | undefined,
): string {
  if (!dataflow) return "GEO_PICT";
  const dims = DIMENSIONS[dataflow];
  if (!dims) {
    // Surface once per dataflow per session so we can grow the JSON without
    // a console-flood.
    warnMissing(dataflow);
    return "GEO_PICT";
  }
  for (const name of GEO_DIM_NAMES) {
    if (dims.includes(name)) return name;
  }
  warnNoGeo(dataflow, dims);
  return "GEO_PICT";
}

const warnedMissing = new Set<string>();
const warnedNoGeo = new Set<string>();

function warnMissing(dataflow: string): void {
  if (warnedMissing.has(dataflow)) return;
  warnedMissing.add(dataflow);
  console.warn(
    "[country-snapshots] dataflow " +
      dataflow +
      " is not in dataflow-dimensions.json; defaulting geo concept to GEO_PICT. " +
      "Add an entry there to silence this warning.",
  );
}

function warnNoGeo(dataflow: string, dims: string[]): void {
  if (warnedNoGeo.has(dataflow)) return;
  warnedNoGeo.add(dataflow);
  console.warn(
    "[country-snapshots] dataflow " +
      dataflow +
      " has no recognised geo dimension (saw: " +
      dims.join(", ") +
      "). Defaulting to GEO_PICT.",
  );
}
