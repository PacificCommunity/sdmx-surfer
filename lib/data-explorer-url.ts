import { getLocalizedTextValue } from "./dashboard-text";

/**
 * Convert an SDMX REST API data URL to a Pacific Data Hub Data Explorer URL.
 *
 * API URL format:
 *   https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_NAME,VERSION/KEY?params
 *   or: https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_NAME/KEY?params
 *
 * DE URL format:
 *   https://stats.pacificdata.org/vis?df[ds]=ds:SPC2&df[id]=DF_NAME&df[ag]=SPC&df[vs]=VERSION&dq=KEY&pd=START,END&to[TIME_PERIOD]=false
 */

const DE_BASE = "https://stats.pacificdata.org/vis";

interface ParsedApiUrl {
  agency: string;
  dataflowId: string;
  version: string;
  key: string;
  startPeriod?: string;
  endPeriod?: string;
  lastNObservations?: string;
}

function parseApiUrl(url: string): ParsedApiUrl | null {
  try {
    const u = new URL(url);

    // Path: /rest/data/[AGENCY,]DF_ID[,VERSION]/KEY
    const pathParts = u.pathname.split("/");
    const dataIdx = pathParts.indexOf("data");
    if (dataIdx === -1 || dataIdx + 2 > pathParts.length) return null;

    const flowPart = pathParts[dataIdx + 1];
    const key = pathParts[dataIdx + 2] || "";

    let agency = "SPC";
    let dataflowId = flowPart;
    let version = "1.0";

    // Handle SPC,DF_NAME,VERSION format
    if (flowPart.includes(",")) {
      const segments = flowPart.split(",");
      if (segments.length >= 2) {
        agency = segments[0];
        dataflowId = segments[1];
        if (segments.length >= 3) {
          version = segments[2];
        }
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
 * Build a Data Explorer URL from a parsed API URL.
 *
 * Parameters per https://sis-cc.gitlab.io/dotstatsuite-documentation/using-de/general-layout/#url-parameters :
 *   df[ds]  — datasource ID
 *   df[id]  — dataflow identifier
 *   df[ag]  — agency ID
 *   df[vs]  — version (omit for latest)
 *   dq      — SDMX data query key
 *   pd      — time period range "start,end"
 *   lo      — last N observations (integer)
 *   lom     — last observation mode (undocumented, seen in production DE URLs)
 *   to[]    — time dimension ordering
 */
export function apiUrlToExplorerUrl(apiUrl: string): string | null {
  const parsed = parseApiUrl(apiUrl);
  if (!parsed) return null;

  const params = new URLSearchParams();

  // Dataflow identification
  params.set("df[ds]", "ds:SPC2");
  params.set("df[id]", parsed.dataflowId);
  params.set("df[ag]", parsed.agency);

  // Only set version if explicitly known (not "1.0" default guess)
  // Omitting df[vs] queries the latest published version per the docs
  if (parsed.version && parsed.version !== "1.0") {
    params.set("df[vs]", parsed.version);
  }

  // Data query key
  params.set("dq", parsed.key);

  // Time period range
  if (parsed.startPeriod || parsed.endPeriod) {
    params.set("pd", (parsed.startPeriod || "") + "," + (parsed.endPeriod || ""));
  }

  // Last N observations
  if (parsed.lastNObservations) {
    params.set("lom", "LASTNOBSERVATIONS");
    params.set("lo", parsed.lastNObservations);
  }

  // Time dimension ordering (show most recent first)
  params.set("to[TIME_PERIOD]", "false");

  return DE_BASE + "?" + params.toString();
}

/**
 * Extract all unique data URLs from a dashboard config,
 * paired with the component title and Data Explorer link.
 */
export interface DataSource {
  componentId: string;
  componentTitle: string;
  componentType: string;
  apiUrl: string;
  explorerUrl: string | null;
}

export function extractDataSources(config: {
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

  for (const row of config.rows) {
    for (const col of row.columns) {
      if (!col.data) continue;

      const urls = Array.isArray(col.data) ? col.data : [col.data];
      const title = getLocalizedTextValue(col.title?.text) || col.id;

      for (const url of urls) {
        if (seen.has(url)) continue;
        seen.add(url);

        sources.push({
          componentId: col.id,
          componentTitle: title,
          componentType: col.type,
          apiUrl: url,
          explorerUrl: apiUrlToExplorerUrl(url),
        });
      }
    }
  }

  return sources;
}
