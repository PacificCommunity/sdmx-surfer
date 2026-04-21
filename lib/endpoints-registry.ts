/**
 * Registry of SDMX endpoints supported by the MCP gateway, with:
 *   - display names for the Data Sources table
 *   - API host(s) for detecting which endpoint an API URL belongs to
 *   - an optional Data Explorer URL builder (null when the endpoint has no
 *     deep-linkable browser viewer, in which case only the API link is shown)
 *
 * Endpoint keys mirror those returned by the MCP `list_available_endpoints` tool.
 */

export interface ParsedApiUrl {
  agency: string;
  dataflowId: string;
  version: string;
  key: string;
  startPeriod?: string;
  endPeriod?: string;
  lastNObservations?: string;
}

export interface EndpointInfo {
  key: string;
  name: string;
  shortName: string;
  apiHosts: string[];
  buildExplorerUrl?: (parsed: ParsedApiUrl) => string | null;
}

/**
 * Build a .Stat Suite Data Explorer URL per
 * https://sis-cc.gitlab.io/dotstatsuite-documentation/using-de/general-layout/#url-parameters
 */
function buildDotStatUrl(
  baseUrl: string,
  datasourceId: string,
  p: ParsedApiUrl,
): string {
  const params = new URLSearchParams();
  params.set("df[ds]", datasourceId);
  params.set("df[id]", p.dataflowId);
  params.set("df[ag]", p.agency);
  if (p.version && p.version !== "1.0") params.set("df[vs]", p.version);
  params.set("dq", p.key);
  if (p.startPeriod || p.endPeriod) {
    params.set("pd", (p.startPeriod || "") + "," + (p.endPeriod || ""));
  }
  if (p.lastNObservations) {
    params.set("lom", "LASTNOBSERVATIONS");
    params.set("lo", p.lastNObservations);
  }
  params.set("to[TIME_PERIOD]", "false");
  return baseUrl + "?" + params.toString();
}

const BIS_FLOW_TO_TOPIC: Record<string, string> = {
  WS_LBS_D_PUB: "LBS",
  WS_CBS_PUB: "CBS",
  WS_NA_SEC_DSS: "DSS",
  WS_DEBT_SEC2_PUB: "IDS",
  WS_TC: "TOTAL_CREDIT",
  WS_CREDIT_GAP: "CREDIT_GAPS",
  WS_DSR: "DSR",
  WS_GLI: "GLI",
  WS_XTD_DERIV: "XTD_DER",
  WS_OTC_DERIV2: "OTC_DER",
  WS_DER_OTC_TOV: "DER",
  WS_SPP: "RPP",
  WS_DPP: "RPP",
  WS_CPP: "CPP",
  WS_LONG_CPI: "CPI",
  WS_XRU: "XRU",
  WS_EER: "EER",
  WS_CBTA: "CBTA",
  WS_CBPOL: "CBPOL",
  WS_CPMI_CT1: "CPMI_CT",
  WS_CPMI_DEVICES: "CPMI_CT",
  WS_CPMI_INSTITUT: "CPMI_CT",
  WS_CPMI_CASHLESS: "CPMI_CT",
  WS_CPMI_MACRO: "CPMI_CT",
  WS_CPMI_CT2: "CPMI_FMI",
  WS_CPMI_SYSTEMS: "CPMI_FMI",
  WS_CPMI_PARTICIP: "CPMI_FMI",
};

export const ENDPOINTS: EndpointInfo[] = [
  {
    key: "SPC",
    name: "Pacific Data Hub",
    shortName: "SPC",
    apiHosts: ["stats-sdmx-disseminate.pacificdata.org"],
    buildExplorerUrl: (p) =>
      buildDotStatUrl("https://stats.pacificdata.org/vis", "ds:SPC2", p),
  },
  {
    key: "FBOS",
    name: "Fiji Bureau of Statistics",
    shortName: "FBOS",
    apiHosts: ["data-sdmx-disseminate.statsfiji.gov.fj"],
    buildExplorerUrl: (p) =>
      buildDotStatUrl("https://data.statsfiji.gov.fj/vis", "ds:FBOS3", p),
  },
  {
    key: "SBS",
    name: "Samoa Bureau of Statistics",
    shortName: "SBS",
    apiHosts: ["data-sdmx-disseminate.sbs.gov.ws"],
    buildExplorerUrl: (p) =>
      buildDotStatUrl("https://data.sbs.gov.ws/vis", "ds:SBS3", p),
  },
  {
    key: "OECD",
    name: "OECD",
    shortName: "OECD",
    apiHosts: ["sdmx.oecd.org"],
    buildExplorerUrl: (p) =>
      buildDotStatUrl(
        "https://data-explorer.oecd.org/vis",
        "dsDisseminateFinalDMZ",
        p,
      ),
  },
  {
    key: "ESTAT",
    name: "Eurostat",
    shortName: "Eurostat",
    apiHosts: ["ec.europa.eu"],
    buildExplorerUrl: (p) =>
      "https://ec.europa.eu/eurostat/databrowser/view/" +
      encodeURIComponent(p.dataflowId) +
      "/default/table",
  },
  {
    key: "UNICEF",
    name: "UNICEF",
    shortName: "UNICEF",
    apiHosts: ["sdmx.data.unicef.org"],
  },
  {
    key: "IMF",
    name: "International Monetary Fund",
    shortName: "IMF",
    apiHosts: ["api.imf.org", "dataservices.imf.org"],
  },
  {
    key: "ECB",
    name: "European Central Bank",
    shortName: "ECB",
    apiHosts: ["data-api.ecb.europa.eu"],
  },
  {
    key: "ILO",
    name: "International Labour Organization",
    shortName: "ILO",
    apiHosts: ["sdmx.ilo.org"],
    buildExplorerUrl: (p) =>
      buildDotStatUrl("https://data.ilo.org/vis", "ds-ilostat-prod", p),
  },
  {
    key: "ABS",
    name: "Australian Bureau of Statistics",
    shortName: "ABS",
    apiHosts: ["data.api.abs.gov.au"],
    // ABS's DE has many `df[ds]` values (LABOUR_TOPICS, ECONOMY_TOPICS, …),
    // but all map to the same backend — it's a UI scope label, not a routing key.
    // `ABS_ABS_TOPICS` is the generic "all topics" catalog and loads any dataflow.
    buildExplorerUrl: (p) =>
      buildDotStatUrl(
        "https://dataexplorer.abs.gov.au/vis",
        "ABS_ABS_TOPICS",
        p,
      ),
  },
  {
    key: "STATSNZ",
    name: "Stats NZ — Aotearoa Data Explorer",
    shortName: "Stats NZ",
    apiHosts: ["api.data.stats.govt.nz"],
    // Data Explorer deep-link URL pattern TBC — API-only for now.
  },
  {
    key: "BIS",
    name: "Bank for International Settlements",
    shortName: "BIS",
    apiHosts: ["stats.bis.org"],
    // BIS Data Portal deep links require the dataflow's topic segment in the path:
    //   https://data.bis.org/topics/{TOPIC}/{AGENCY},{FLOW},{VERSION}/{KEY}
    // Mapping scraped from https://data.bis.org/topics — unknown flows fall back to API-only.
    buildExplorerUrl: (p) => {
      const topic = BIS_FLOW_TO_TOPIC[p.dataflowId];
      if (!topic) return null;
      const flowRef = p.agency + "," + p.dataflowId + "," + (p.version || "1.0");
      const base = "https://data.bis.org/topics/" + topic + "/" + flowRef;
      return p.key ? base + "/" + p.key : base;
    },
  },
];

const UNKNOWN_ENDPOINT: EndpointInfo = {
  key: "UNKNOWN",
  name: "External source",
  shortName: "External",
  apiHosts: [],
};

export function detectEndpoint(apiUrl: string): EndpointInfo {
  try {
    const host = new URL(apiUrl).host.toLowerCase();
    const match = ENDPOINTS.find((e) =>
      e.apiHosts.some((h) => host === h || host.endsWith("." + h)),
    );
    return match ?? UNKNOWN_ENDPOINT;
  } catch {
    return UNKNOWN_ENDPOINT;
  }
}
