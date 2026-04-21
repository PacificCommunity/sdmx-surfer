import { describe, it, expect } from "vitest";
import {
  apiUrlToExplorerUrl,
  extractDataSources,
} from "../lib/data-explorer-url";
import { detectEndpoint } from "../lib/endpoints-registry";

// Real `build_data_url` outputs captured from the MCP gateway (2026-04-22
// per-endpoint probe). Every working provider hands out BARE-FLOW URLs
// (/data/<FLOW>/<KEY>) rather than the comma form. These fixtures lock in
// that shape so the parse + endpoint-detect + explorer-URL path is exercised
// against real gateway behaviour, not assumptions.
const GATEWAY_URLS = {
  SPC: "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_BOP/all?dimensionAtObservation=AllDimensions",
  ECB: "https://data-api.ecb.europa.eu/service/data/AME/all?dimensionAtObservation=AllDimensions",
  UNICEF:
    "https://sdmx.data.unicef.org/ws/public/sdmxapi/rest/data/CCRI/all?dimensionAtObservation=AllDimensions",
  IMF: "https://api.imf.org/external/sdmx/2.1/data/FA/all?dimensionAtObservation=AllDimensions",
  ABS: "https://data.api.abs.gov.au/rest/data/ABORIGINAL_POP_PROJ/all?dimensionAtObservation=AllDimensions",
  ESTAT:
    "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1/data/LFST_HHACEDAY/all?dimensionAtObservation=AllDimensions",
  FBOS: "https://data-sdmx-disseminate.statsfiji.gov.fj/rest/data/DF_BOP_TABLE1/all?dimensionAtObservation=AllDimensions",
  SBS: "https://data-sdmx-disseminate.sbs.gov.ws/rest/data/DF_CPI/all?dimensionAtObservation=AllDimensions",
  ILO: "https://sdmx.ilo.org/rest/data/DF_CPI/all?dimensionAtObservation=AllDimensions",
  STATSNZ:
    "https://api.data.stats.govt.nz/rest/data/CEN13_HAD_004/A.NZL..._T?dimensionAtObservation=AllDimensions",
  BIS: "https://stats.bis.org/api/v1/data/WS_CBPOL/all?dimensionAtObservation=AllDimensions",
  OECD: "https://sdmx.oecd.org/public/rest/data/OECD.SDD.NAD,DSD_NAQLI@DF_QNA,1.0/A.AUT?dimensionAtObservation=AllDimensions",
} as const;

describe("detectEndpoint", () => {
  it.each(Object.entries(GATEWAY_URLS))(
    "detects %s from the gateway URL",
    (key, url) => {
      expect(detectEndpoint(url).key).toBe(key);
    },
  );

  it("returns UNKNOWN for an unrecognised host", () => {
    expect(detectEndpoint("https://example.com/rest/data/X/all").key).toBe(
      "UNKNOWN",
    );
  });
});

describe("apiUrlToExplorerUrl", () => {
  it("builds an SPC DE link with agency SPC from a bare-flow URL", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.SPC);
    expect(url).not.toBeNull();
    const p = new URL(url!);
    expect(p.origin + p.pathname).toBe("https://stats.pacificdata.org/vis");
    expect(p.searchParams.get("df[ag]")).toBe("SPC");
    expect(p.searchParams.get("df[id]")).toBe("DF_BOP");
    expect(p.searchParams.get("df[ds]")).toBe("ds:SPC2");
    expect(p.searchParams.get("to[TIME_PERIOD]")).toBe("false");
  });

  it("builds an ABS DE link with agency ABS (not SPC) from a bare-flow URL", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.ABS);
    expect(url).not.toBeNull();
    const p = new URL(url!);
    expect(p.searchParams.get("df[ag]")).toBe("ABS");
    expect(p.searchParams.get("df[id]")).toBe("ABORIGINAL_POP_PROJ");
    expect(p.searchParams.get("df[ds]")).toBe("ABS_ABS_TOPICS");
  });

  it("builds an ILO DE link with agency ILO", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.ILO);
    expect(url).not.toBeNull();
    const p = new URL(url!);
    expect(p.searchParams.get("df[ag]")).toBe("ILO");
    expect(p.searchParams.get("df[id]")).toBe("DF_CPI");
    expect(p.searchParams.get("df[ds]")).toBe("ds-ilostat-prod");
  });

  it("builds a StatsNZ DE link with agency STATSNZ and TIME axis", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.STATSNZ);
    expect(url).not.toBeNull();
    const p = new URL(url!);
    expect(p.origin + p.pathname).toBe(
      "https://explore.data.stats.govt.nz/vis",
    );
    expect(p.searchParams.get("df[ag]")).toBe("STATSNZ");
    expect(p.searchParams.get("df[id]")).toBe("CEN13_HAD_004");
    expect(p.searchParams.get("to[TIME]")).toBe("false");
    expect(p.searchParams.get("to[TIME_PERIOD]")).toBeNull();
  });

  it("builds an FBOS DE link with agency FBOS", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.FBOS);
    expect(url).not.toBeNull();
    expect(new URL(url!).searchParams.get("df[ag]")).toBe("FBOS");
  });

  it("builds an SBS DE link with agency SBS", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.SBS);
    expect(url).not.toBeNull();
    expect(new URL(url!).searchParams.get("df[ag]")).toBe("SBS");
  });

  it("builds a Eurostat DE link from the dataflow id only", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.ESTAT);
    expect(url).toBe(
      "https://ec.europa.eu/eurostat/databrowser/view/LFST_HHACEDAY/default/table",
    );
  });

  it("builds an OECD DE link from a comma-form URL preserving the subagency", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.OECD);
    expect(url).not.toBeNull();
    const p = new URL(url!);
    expect(p.searchParams.get("df[ag]")).toBe("OECD.SDD.NAD");
    expect(p.searchParams.get("df[id]")).toBe("DSD_NAQLI@DF_QNA");
    expect(p.searchParams.get("df[ds]")).toBe("dsDisseminateFinalDMZ");
  });

  it("builds a BIS topic deep-link with agency BIS for a known flow", () => {
    const url = apiUrlToExplorerUrl(GATEWAY_URLS.BIS);
    expect(url).not.toBeNull();
    // CBPOL is in the registry's BIS topic map (CBPOL) so it should produce
    // a topic URL. The builder hardcodes the BIS agency into the flowRef.
    expect(url).toContain("/topics/CBPOL/BIS,WS_CBPOL,1.0");
  });

  it("returns null for endpoints without a DE builder", () => {
    expect(apiUrlToExplorerUrl(GATEWAY_URLS.ECB)).toBeNull();
    expect(apiUrlToExplorerUrl(GATEWAY_URLS.UNICEF)).toBeNull();
    expect(apiUrlToExplorerUrl(GATEWAY_URLS.IMF)).toBeNull();
  });

  it("strips the map compound-data suffix before parsing", () => {
    const mapData =
      GATEWAY_URLS.SPC +
      ", {GEO_PICT} | https://example.org/pacific.json, EPSG:3832, iso_ter1";
    const url = apiUrlToExplorerUrl(mapData);
    expect(url).not.toBeNull();
    expect(new URL(url!).searchParams.get("df[id]")).toBe("DF_BOP");
  });
});

describe("extractDataSources", () => {
  it("preserves the raw API URL and detects the endpoint for every provider", () => {
    const config = {
      rows: [
        {
          columns: Object.entries(GATEWAY_URLS).map(([key, data], i) => ({
            id: "c" + i,
            type: "line",
            title: { text: key + " panel" },
            data,
          })),
        },
      ],
    };

    const sources = extractDataSources(config);
    expect(sources).toHaveLength(Object.keys(GATEWAY_URLS).length);

    for (const source of sources) {
      const expected =
        GATEWAY_URLS[source.componentTitle.replace(" panel", "") as keyof typeof GATEWAY_URLS];
      expect(source.apiUrl).toBe(expected);
      expect(source.endpointKey).toBe(
        source.componentTitle.replace(" panel", ""),
      );
    }
  });

  it("produces a non-null explorerUrl for endpoints with a DE builder", () => {
    const config = {
      rows: [
        {
          columns: [
            { id: "abs", type: "line", data: GATEWAY_URLS.ABS },
            { id: "ilo", type: "line", data: GATEWAY_URLS.ILO },
            { id: "fbos", type: "line", data: GATEWAY_URLS.FBOS },
            { id: "sbs", type: "line", data: GATEWAY_URLS.SBS },
            { id: "statsnz", type: "line", data: GATEWAY_URLS.STATSNZ },
            { id: "estat", type: "line", data: GATEWAY_URLS.ESTAT },
            { id: "spc", type: "line", data: GATEWAY_URLS.SPC },
          ],
        },
      ],
    };
    const sources = extractDataSources(config);
    for (const source of sources) {
      expect(source.explorerUrl).not.toBeNull();
    }
  });

  it("produces a null explorerUrl for endpoints without a DE builder (ECB/UNICEF/IMF)", () => {
    const config = {
      rows: [
        {
          columns: [
            { id: "ecb", type: "line", data: GATEWAY_URLS.ECB },
            { id: "unicef", type: "line", data: GATEWAY_URLS.UNICEF },
            { id: "imf", type: "line", data: GATEWAY_URLS.IMF },
          ],
        },
      ],
    };
    const sources = extractDataSources(config);
    for (const source of sources) {
      expect(source.explorerUrl).toBeNull();
    }
  });

  it("falls back to the raw dataflow id when the name map misses it", () => {
    const config = {
      // deliberately no `dataflows` map
      rows: [
        {
          columns: [{ id: "abs", type: "line", data: GATEWAY_URLS.ABS }],
        },
      ],
    };
    const sources = extractDataSources(config);
    expect(sources[0].dataflowId).toBe("ABORIGINAL_POP_PROJ");
    expect(sources[0].dataflowName).toBe("ABORIGINAL_POP_PROJ");
  });

  it("uses the configured dataflow name when supplied", () => {
    const config = {
      dataflows: { ABORIGINAL_POP_PROJ: "Aboriginal population projections" },
      rows: [
        {
          columns: [{ id: "abs", type: "line", data: GATEWAY_URLS.ABS }],
        },
      ],
    };
    const sources = extractDataSources(config);
    expect(sources[0].dataflowName).toBe(
      "Aboriginal population projections",
    );
  });

  it("deduplicates repeated URLs across components", () => {
    const config = {
      rows: [
        {
          columns: [
            { id: "a", type: "line", data: GATEWAY_URLS.SPC },
            { id: "b", type: "line", data: GATEWAY_URLS.SPC },
          ],
        },
      ],
    };
    expect(extractDataSources(config)).toHaveLength(1);
  });
});
