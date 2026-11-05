import { describe, expect, it } from "vitest";
import { createCountsAccumulator, packYears, summarizeConstraint } from "@/lib/coverage/aggregate";
import { createCsvParser } from "@/lib/coverage/csv";
import {
  buildIndicatorIndex,
  formatFlowSummary,
  queryCoverage,
  summarizeFlow,
  yearBins,
  yearRuns,
} from "@/lib/coverage/query";
import { ALL_INDICATOR, compareAreas, detectRoles, type DimensionRef } from "@/lib/coverage/roles";
import type { CoverageArtifact, FlowCoverage } from "@/lib/coverage/types";

function parseAll(text: string, chunkSize: number): string[][] {
  const rows: string[][] = [];
  const parser = createCsvParser((r) => rows.push(r));
  for (let i = 0; i < text.length; i += chunkSize) parser.push(text.slice(i, i + chunkSize));
  parser.end();
  return rows;
}

describe("createCsvParser", () => {
  const text =
    'A,B,C\r\n1,"x, y",3\r\n4,"multi\nline ""quoted""",6\n\n7,,"" \n8,9,10';

  it("handles quotes, embedded separators, CRLF and blank lines at any chunking", () => {
    const expected = [
      ["A", "B", "C"],
      ["1", "x, y", "3"],
      ["4", 'multi\nline "quoted"', "6"],
      ["7", "", " "],
      ["8", "9", "10"],
    ];
    for (const size of [1, 2, 3, 7, 1000]) expect(parseAll(text, size)).toEqual(expected);
  });
});

const dim = (id: string, codelist: string | null = null): DimensionRef => ({ id, codelist });

describe("detectRoles", () => {
  it("reads GEO_PICT and INDICATOR", () => {
    expect(detectRoles([dim("FREQ"), dim("GEO_PICT", "SPC:CL_COM_GEO_PICT(2.0)"), dim("INDICATOR"), dim("SEX")]))
      .toEqual({ areaDim: "GEO_PICT", indicatorDim: "INDICATOR", indicatorRule: "indicator" });
  });

  it("reads the SDG family's REF_AREA and SERIES", () => {
    const sdg = [
      dim("FREQ"),
      dim("REPORTING_TYPE"),
      dim("SERIES", "IAEG-SDGs:CL_SERIES(1.25)"),
      dim("REF_AREA", "SPC:CL_COM_GEO_AREA(3.0)"),
      dim("SEX"),
      { id: "TIME_PERIOD", codelist: null, type: "TimeDimension" },
    ];
    expect(detectRoles(sdg)).toEqual({ areaDim: "REF_AREA", indicatorDim: "SERIES", indicatorRule: "series" });
  });

  it("falls back to the first non-geo, non-FREQ, non-breakdown dimension", () => {
    const agri = [
      dim("FREQ"),
      dim("GEO_PICT", "SPC:CL_COM_GEO_AREA(3.0)"),
      dim("AGRICULTURE_PRODUCTION_ITEM", "SPC:CL_AGRICULTURAL_PRODUCTS(1.0)"),
      dim("AGRICULTURE_PRODUCTION_TYPE"),
    ];
    expect(detectRoles(agri)).toEqual({
      areaDim: "GEO_PICT",
      indicatorDim: "AGRICULTURE_PRODUCTION_ITEM",
      indicatorRule: "fallback",
    });
  });

  it("prefers an indicator-named dimension in the fallback", () => {
    const climate = [
      dim("FREQ"),
      dim("SECTOR"),
      dim("CLIMATE_CHANGE_INDICATORS", "SPC:CL_CLIMATE_CHANGE_INDICATORS(1.0)"),
      dim("GEO_PICT"),
    ];
    expect(detectRoles(climate).indicatorDim).toBe("CLIMATE_CHANGE_INDICATORS");
  });

  it("takes a geo-coded dimension as the area and skips other geo-coded ones", () => {
    const food = [
      dim("FREQ"),
      dim("IMPORTER", "SPC:CL_COM_GEO_AREA(3.0)"),
      dim("EXPORTER", "SPC:CL_COM_GEO_AREA(3.0)"),
      dim("COMMODITY", "SPC:CL_TRADE_FOOD_HS92(1.0)"),
    ];
    expect(detectRoles(food)).toEqual({ areaDim: "IMPORTER", indicatorDim: "COMMODITY", indicatorRule: "fallback" });
  });

  it("reports none when only FREQ, area and breakdowns remain", () => {
    expect(detectRoles([dim("FREQ"), dim("GEO_PICT"), dim("SEX")])).toEqual({
      areaDim: "GEO_PICT",
      indicatorDim: null,
      indicatorRule: "none",
    });
  });
});

describe("compareAreas", () => {
  it("puts countries first, then sub-national units, then aggregates", () => {
    expect(["_T", "MEL", "WS", "VU-101", "FJ"].sort(compareAreas)).toEqual(["FJ", "WS", "VU-101", "MEL", "_T"]);
  });
});

describe("createCountsAccumulator", () => {
  it("counts SDG rows by SERIES × REF_AREA × year, skipping empty values", () => {
    const roles = detectRoles([dim("FREQ"), dim("SERIES"), dim("REF_AREA"), dim("SEX")]);
    const header = ["DATAFLOW", "FREQ", "SERIES", "REF_AREA", "SEX", "TIME_PERIOD", "OBS_VALUE", "COMMENT"];
    const acc = createCountsAccumulator(header, roles);
    const rows = [
      ["SPC:DF_SDG(4.5)", "A", "SH_STA_STNT", "FJ", "F", "2015", "7.5", ""],
      ["SPC:DF_SDG(4.5)", "A", "SH_STA_STNT", "FJ", "M", "2015", "8.1", ""],
      ["SPC:DF_SDG(4.5)", "A", "SH_STA_STNT", "FJ", "_T", "2018", "7.9", ""],
      ["SPC:DF_SDG(4.5)", "A", "SH_STA_STNT", "MEL", "_T", "2015", "30", ""],
      ["SPC:DF_SDG(4.5)", "A", "SH_STA_STNT", "WS", "_T", "2016", "", "missing"],
      ["SPC:DF_SDG(4.5)", "Q", "SL_TLF_UEM", "WS", "_T", "2016-Q1", "9", ""],
    ];
    rows.forEach((r) => acc.add(r));
    const result = acc.finish(new Map([["SH_STA_STNT", "Stunting"]]));

    expect(result.obs).toBe(5);
    expect(result.first).toBe(2015);
    expect(result.last).toBe(2018);
    expect(result.indicators.map((i) => i.code)).toEqual(["SH_STA_STNT", "SL_TLF_UEM"]);
    const stunting = result.indicators[0];
    expect(stunting.label).toBe("Stunting");
    expect(stunting.obs).toBe(4);
    expect(stunting.years).toEqual([2015, 3, 0, 0, 1]);
    expect(Object.keys(stunting.areas)).toEqual(["FJ", "MEL"]);
    expect(stunting.areas.FJ).toEqual([2015, 2, 0, 0, 1]);
    expect(result.indicators[1].label).toBeNull();
    expect(result.indicators[1].areas.WS).toEqual([2016, 1]);
  });

  it("uses a single _ALL indicator and no areas when the flow has neither role", () => {
    const acc = createCountsAccumulator(["TIME_PERIOD", "OBS_VALUE"], {
      areaDim: null,
      indicatorDim: null,
      indicatorRule: "none",
    });
    acc.add(["2001", "1"]);
    acc.add(["2003", "2"]);
    const [only] = acc.finish(new Map()).indicators;
    expect(only.code).toBe(ALL_INDICATOR);
    expect(only.years).toEqual([2001, 1, 0, 1]);
    expect(only.areas).toEqual({});
  });

  it("fails loudly when a role column is missing from the header", () => {
    const roles = detectRoles([dim("GEO_PICT"), dim("INDICATOR")]);
    expect(() => createCountsAccumulator(["GEO_PICT", "TIME_PERIOD"], roles)).toThrow(/INDICATOR/);
  });
});

describe("packYears / summarizeConstraint", () => {
  it("packs years densely", () => {
    expect(packYears(new Map([[2003, 2], [2001, 1]]))).toEqual([2001, 1, 0, 2]);
    expect(packYears(new Map())).toEqual([]);
  });

  it("reads obs and range, and treats the 9999→0001 sentinel as empty", () => {
    const make = (obs: string, start: string, end: string) => ({
      data: {
        contentConstraints: [
          {
            annotations: [{ id: "obs_count", title: obs }],
            cubeRegions: [
              {
                keyValues: [
                  { id: "GEO_PICT", values: ["TO"] },
                  { id: "TIME_PERIOD", timeRange: { startPeriod: { period: start }, endPeriod: { period: end } } },
                ],
              },
            ],
          },
        ],
      },
    });
    expect(summarizeConstraint(make("42", "2024-01-01T00:00:00", "2026-12-31T23:59:59"))).toEqual({
      obs: 42,
      first: 2024,
      last: 2026,
      values: { GEO_PICT: ["TO"] },
    });
    const empty = summarizeConstraint(make("0", "9999-01-01T00:00:00", "0001-12-31T23:59:59"));
    expect(empty.first).toBeNull();
    expect(empty.last).toBeNull();
  });
});

describe("year helpers", () => {
  it("compresses runs", () => {
    expect(yearRuns([2000, 2001, 2002, 2005, 2007, 2008])).toBe("2000-2002,2005,2007-2008");
  });

  it("bins long spans into aligned groups", () => {
    expect(yearBins(2000, 2010)).toHaveLength(11);
    const bins = yearBins(1950, 2050);
    expect(bins.length).toBeLessThanOrEqual(40);
    expect(bins[0]).toEqual({ from: 1950, to: 1954 });
    expect(bins[bins.length - 1]).toEqual({ from: 2050, to: 2050 });
  });
});

// ── Tool queries ──

const sdg: FlowCoverage = {
  signature: "a",
  detail: "counts",
  areaDim: "REF_AREA",
  indicatorDim: "SERIES",
  indicatorRule: "series",
  obs: 9,
  first: 2010,
  last: 2015,
  indicators: [
    {
      code: "SH_STA_STNT",
      label: "Stunting",
      obs: 6,
      years: [2010, 2, 0, 0, 0, 2, 2],
      areas: { FJ: [2010, 1, 0, 0, 0, 1, 1], WS: [2010, 1], MEL: [2014, 1, 1] },
    },
    { code: "SL_TLF_UEM", label: "Unemployment", obs: 3, years: [2012, 3], areas: { TO: [2012, 3] } },
  ],
};

const nmdi: FlowCoverage = {
  ...sdg,
  areaDim: "GEO_PICT",
  indicatorDim: "INDICATOR",
  indicatorRule: "indicator",
  obs: 2,
  indicators: [{ code: "SH_STA_STNT", label: "Stunting", obs: 2, years: [2013, 2], areas: { FJ: [2013, 2] } }],
};

const trade: FlowCoverage = {
  signature: "b",
  detail: "range",
  areaDim: "GEO_PICT",
  indicatorDim: "INDICATOR",
  indicatorRule: "indicator",
  obs: 900,
  first: 2023,
  last: 2026,
  indicators: [
    { code: "VALUE", label: "Value", obs: 900, first: 2023, last: 2026, areas: { TV: { obs: 900, first: 2023, last: 2026 } } },
  ],
};

const artifact: CoverageArtifact = {
  version: 1,
  createdAt: "2026-11-06T00:00:00.000Z",
  source: "test",
  rangeThreshold: 750000,
  areaLabels: { FJ: "Fiji", WS: "Samoa", TO: "Tonga", TV: "Tuvalu", MEL: "Melanesia" },
  flows: { DF_SDG: sdg, DF_NMDI: nmdi, DF_TRADE: trade },
};
const src = { artifact, indicatorIndex: buildIndicatorIndex(artifact) };

describe("queryCoverage", () => {
  it("links one indicator code across flows, biggest first", () => {
    const out = queryCoverage({ indicator: "sh_sta_stnt" }, src);
    expect(out.dataflows_total).toBe(2);
    expect(out.dataflows).toEqual([
      expect.objectContaining({
        dataflow_id: "DF_SDG",
        obs: 6,
        years: "2010-2015",
        areas: { FJ: "2010,2014-2015 (3)", WS: "2010 (1)", MEL: "2014-2015 (2)" },
      }),
      expect.objectContaining({ dataflow_id: "DF_NMDI", areas: { FJ: "2013 (2)" } }),
    ]);
  });

  it("filters by country name and year window", () => {
    const out = queryCoverage({ indicator: "SH_STA_STNT", country: "fiji", year_from: 2014 }, src);
    expect(out.area).toBe("FJ");
    expect(out.dataflows).toEqual([
      expect.objectContaining({ dataflow_id: "DF_SDG", obs: 2, areas: { FJ: "2014-2015 (2)" } }),
    ]);
  });

  it("lists a flow's indicators for one country", () => {
    const out = queryCoverage({ dataflow_id: "df_sdg", country: "TO" }, src);
    expect(out.indicators).toEqual([
      { code: "SL_TLF_UEM", label: "Unemployment", obs: 3, years: "2012", coverage: "2012 (3)" },
    ]);
  });

  it("reports range-mode flows with first-last years and a note", () => {
    const out = queryCoverage({ dataflow_id: "DF_TRADE", indicator: "VALUE" }, src);
    expect(out.detail).toBe("range");
    expect(out.note).toMatch(/range/);
    expect(out.areas).toEqual({ TV: "2023-2026 (900)" });
  });

  it("offers candidates for an unknown code by searching labels", () => {
    const out = queryCoverage({ indicator: "stunt" }, src);
    expect(out.error).toMatch(/No dataflow/);
    expect(out.candidates).toEqual([
      { indicator: "SH_STA_STNT", label: "Stunting", dataflows: ["DF_SDG", "DF_NMDI"] },
    ]);
  });

  it("lists flows with data for a country alone", () => {
    const out = queryCoverage({ country: "TV" }, src);
    expect(out.dataflows).toEqual([
      expect.objectContaining({ dataflow_id: "DF_TRADE", indicators: 1, obs: 900, years: "2023-2026" }),
    ]);
  });

  it("rejects unknown areas and empty queries", () => {
    expect(queryCoverage({ country: "Atlantis" }, src).error).toMatch(/Unknown area/);
    expect(queryCoverage({}, src).error).toMatch(/at least one/);
  });
});

describe("summaries", () => {
  it("formats the catalogue card line", () => {
    expect(formatFlowSummary(summarizeFlow(sdg))).toBe("2 indicators · 4 areas · 2010–2015");
    expect(formatFlowSummary(summarizeFlow(trade))).toBe("1 indicator · 1 area · 2023–2026");
  });
});
