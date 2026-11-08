import { describe, expect, it } from "vitest";
import {
  dashboardReferenceProblems,
  disallowedDataHosts,
  stripDashboardMarkup,
  stripMarkup,
  visualReferenceProblems,
} from "@/lib/dashboard-safety";
import { dataUrlRefusal, filterMcpTools } from "@/lib/mcp-tool-policy";

const SPC = "https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_POP_PROJ,3.0/A.FJ.MIDYEARPOPEST._T._T";
const EEZ = "https://geonode.pacificdata.org/geoserver/gwc/service/tms/1.0.0/geonode%3Aglobal_eez_200nm_split@EPSG%3A3857@pbf/{z}/{x}/{-y}.pbf";

describe("disallowedDataHosts", () => {
  it("passes registered providers, map layers and non-network tokens", () => {
    expect(disallowedDataHosts(SPC)).toEqual([]);
    expect(disallowedDataHosts(SPC + ", {GEO_PICT} | " + EEZ + ", EPSG:3857, {iso_ter1}")).toEqual([]);
    expect(disallowedDataHosts("hist(" + SPC + ")[0]")).toEqual([]);
    expect(disallowedDataHosts(SPC + " / https://sdmx.oecd.org/public/rest/data/X")).toEqual([]);
  });

  it("flags any other host, however the URL is spelled", () => {
    expect(disallowedDataHosts("https://evil.example/x")).toEqual(["evil.example"]);
    expect(disallowedDataHosts("//evil.example/x")).toEqual(["evil.example"]);
    // Same scheme as the page and no "//": the browser reads a same-site path.
    expect(disallowedDataHosts("https:/evil.example/x")).toEqual([]);
    expect(disallowedDataHosts("http:/evil.example/x")).toEqual(["evil.example"]);
    expect(disallowedDataHosts("https:\\\\evil.example\\x")).toEqual(["evil.example"]);
    expect(disallowedDataHosts("https://stats.bis.org@evil.example/x")).toEqual(["evil.example"]);
    expect(disallowedDataHosts("https://stats.bis.org.evil.example/x")).toEqual(["stats.bis.org.evil.example"]);
    expect(disallowedDataHosts(SPC + " | https://evil.example/layer.json, EPSG:3857, {id}")).toEqual(["evil.example"]);
  });

  it("refuses control characters the URL parser would silently drop", () => {
    expect(disallowedDataHosts("https://ev\nil.example/x")).toEqual(["(control characters)"]);
  });
});

describe("visualReferenceProblems", () => {
  it("rejects links that are not http(s)", () => {
    expect(visualReferenceProblems({ id: "a", dataLink: "javascript:alert(1)" })).toHaveLength(1);
    expect(visualReferenceProblems({ id: "a", metadataLink: "https://pacificdata.org/x" })).toEqual([]);
  });
});

describe("dashboardReferenceProblems", () => {
  it("names the offending visual and reports malformed configs", () => {
    const config = { rows: [{ columns: [{ id: "ok", data: SPC }, { id: "bad", data: ["https://evil.example/d"] }] }] };
    expect(dashboardReferenceProblems(config)).toEqual([
      "visual bad loads data from evil.example, which is not a registered SDMX provider",
    ]);
    expect(dashboardReferenceProblems({ rows: "nope" })).toEqual(["the dashboard config is malformed"]);
  });
});

describe("stripMarkup", () => {
  it("removes tags, including ones rebuilt by removing another", () => {
    expect(stripMarkup('<img src=x onerror="alert(1)">Map')).toBe("Map");
    expect(stripMarkup("<<b>img src=x onerror=alert(1)>Map")).toBe("Map");
    expect(stripMarkup("Title <!-- x --> <script>alert(1)</script>")).toBe("Title  alert(1)");
  });

  it("keeps comparisons that are plain text in HTML too", () => {
    expect(stripMarkup("Children aged < 5 and >= 2")).toBe("Children aged < 5 and >= 2");
    expect(stripMarkup("Under-5 mortality <5%")).toBe("Under-5 mortality <5%");
  });
});

describe("stripDashboardMarkup", () => {
  it("cleans every text field and leaves data expressions alone", () => {
    const config = {
      id: "d",
      header: { title: { text: "<b>GDP</b>" } },
      rows: [{ columns: [{ id: "m", type: "map", data: SPC + ", {GEO_PICT} | " + EEZ, extraOptions: { tooltip: { formatter: "<img src=x onerror=alert(1)>{b}" } } }] }],
    };
    expect(stripDashboardMarkup(config)).toEqual({
      ...config,
      header: { title: { text: "GDP" } },
      rows: [{ columns: [{ ...config.rows[0].columns[0], extraOptions: { tooltip: { formatter: "{b}" } } }] }],
    });
  });
});

describe("gateway data URL guard", () => {
  it("allows registered providers and refuses everything else", () => {
    expect(dataUrlRefusal(SPC)).toBeNull();
    expect(dataUrlRefusal("https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_RDS_GERD@DF_GERD_SOF,1.0/all")).toBeNull();
    expect(dataUrlRefusal("https://evil.example/rest/data/X")).toBe("evil.example is not a registered SDMX provider");
    expect(dataUrlRefusal("https://stats.bis.org@evil.example/x")).toBe("not a plain http(s) URL");
    expect(dataUrlRefusal("https://stats.bis.org\\@evil.example/x")).toBe("not a plain http(s) URL");
    expect(dataUrlRefusal("http://169.254.169.254/latest/meta-data")).toBe("169.254.169.254 is not a registered SDMX provider");
  });

  it("answers a refused probe without calling the gateway", async () => {
    const calls: unknown[] = [];
    const tools = filterMcpTools({
      probe_data_url: { execute: async (...args: unknown[]) => { calls.push(args[0]); return "fetched"; } },
    });
    const probe = tools.probe_data_url;
    if (!probe || !("execute" in probe) || typeof probe.execute !== "function") throw new Error("probe tool missing");
    expect(await probe.execute({ data_url: SPC }, {})).toBe("fetched");
    expect(await probe.execute({ data_url: "https://evil.example/x" }, {})).toMatchObject({ isError: true });
    expect(await probe.execute({ dataflow_id: "DF_POP_PROJ" }, {})).toBe("fetched");
    expect(calls).toHaveLength(2);
  });
});
