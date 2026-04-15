import { getLocalizedTextValue } from "./dashboard-text";
import {
  detectEndpoint,
  type ParsedApiUrl,
} from "./endpoints-registry";

/**
 * Convert an SDMX REST API data URL into a Data Explorer URL, when the
 * endpoint has a known deep-linkable viewer. Returns null otherwise; callers
 * should fall back to showing only the API link.
 *
 * API URL format (generic SDMX):
 *   {host}/{rest-prefix}/data/[AGENCY,]DF_ID[,VERSION]/KEY?params
 */

function parseApiUrl(url: string): ParsedApiUrl | null {
  try {
    const u = new URL(url);

    const pathParts = u.pathname.split("/");
    const dataIdx = pathParts.indexOf("data");
    if (dataIdx === -1 || dataIdx + 2 > pathParts.length) return null;

    const flowPart = pathParts[dataIdx + 1];
    const key = pathParts[dataIdx + 2] || "";

    let agency = "SPC";
    let dataflowId = flowPart;
    let version = "1.0";

    if (flowPart.includes(",")) {
      const segments = flowPart.split(",");
      if (segments.length >= 2) {
        agency = segments[0];
        dataflowId = segments[1];
        if (segments.length >= 3) version = segments[2];
      }
    }

    return {
      agency,
      dataflowId,
      version,
      key,
      startPeriod: u.searchParams.get("startPeriod") || undefined,
      endPeriod: u.searchParams.get("endPeriod") || undefined,
      lastNObservations: u.searchParams.get("lastNObservations") || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Map components encode data as "{apiUrl}, {DIM} | {geoJsonUrl}, {projection}, {joinProp}".
 * Strip the geo suffix to recover the SDMX API URL.
 */
function extractSdmxUrl(raw: string): string {
  const pipeIdx = raw.indexOf(" | ");
  const beforePipe = pipeIdx >= 0 ? raw.slice(0, pipeIdx) : raw;
  const braceIdx = beforePipe.indexOf(", {");
  return (braceIdx >= 0 ? beforePipe.slice(0, braceIdx) : beforePipe).trim();
}

export function apiUrlToExplorerUrl(apiUrl: string): string | null {
  const clean = extractSdmxUrl(apiUrl);
  const parsed = parseApiUrl(clean);
  if (!parsed) return null;
  const endpoint = detectEndpoint(clean);
  return endpoint.buildExplorerUrl ? endpoint.buildExplorerUrl(parsed) : null;
}

/**
 * Extract all unique data URLs from a dashboard config, paired with the
 * component title, source endpoint, and Data Explorer link when available.
 */
export interface DataSource {
  componentId: string;
  componentTitle: string;
  componentType: string;
  dataflowId: string;
  dataflowName: string;
  apiUrl: string;
  explorerUrl: string | null;
  endpointKey: string;
  endpointName: string;
  endpointShortName: string;
}

export function extractDataSources(config: {
  dataflows?: Record<string, string>;
  rows: Array<{
    columns: Array<{
      id: string;
      type: string;
      title?: { text: string | Record<string, string> };
      data?: string | string[];
    }>;
  }>;
}): DataSource[] {
  const sources: DataSource[] = [];
  const seen = new Set<string>();
  const nameMap = config.dataflows ?? {};

  for (const row of config.rows) {
    for (const col of row.columns) {
      if (!col.data) continue;

      const urls = Array.isArray(col.data) ? col.data : [col.data];
      const title = getLocalizedTextValue(col.title?.text) || col.id;

      for (const rawUrl of urls) {
        const url = extractSdmxUrl(rawUrl);
        if (seen.has(url)) continue;
        seen.add(url);

        const parsed = parseApiUrl(url);
        const dfId = parsed?.dataflowId ?? "";
        const endpoint = detectEndpoint(url);

        sources.push({
          componentId: col.id,
          componentTitle: title,
          componentType: col.type,
          dataflowId: dfId,
          dataflowName: nameMap[dfId] || dfId,
          apiUrl: url,
          explorerUrl: parsed && endpoint.buildExplorerUrl
            ? endpoint.buildExplorerUrl(parsed)
            : null,
          endpointKey: endpoint.key,
          endpointName: endpoint.name,
          endpointShortName: endpoint.shortName,
        });
      }
    }
  }

  return sources;
}
