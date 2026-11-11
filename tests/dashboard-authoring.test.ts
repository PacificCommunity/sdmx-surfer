import { describe, expect, it } from "vitest";
import {
  compileDashboardToolConfig,
  dashboardToolConfigSchema,
} from "@/lib/dashboard-authoring";

describe("dashboard authoring compiler", () => {
  it("compiles KPI intent visuals into native value visuals", () => {
    const parsed = dashboardToolConfigSchema.parse({
      id: "demo",
      rows: [
        {
          columns: [
            {
              kind: "kpi",
              id: "population_value",
              title: "Population",
              dataUrl: "https://example.com/rest/data/DF_POP/A.FJ",
              unit: { text: "persons", location: "suffix" },
              decimals: 0,
            },
          ],
        },
      ],
    });

    const compiled = compileDashboardToolConfig(parsed);
    const visual = compiled.rows[0].columns[0];

    expect(visual.type).toBe("value");
    expect(visual.xAxisConcept).toBe("OBS_VALUE");
    expect(visual.data).toBe(
      "https://example.com/rest/data/DF_POP/A.FJ?dimensionAtObservation=AllDimensions",
    );
  });

  it("compiles table intent visuals into native table visuals", () => {
    const parsed = dashboardToolConfigSchema.parse({
      id: "demo",
      rows: [
        {
          columns: [
            {
              kind: "table",
              id: "trade_table",
              title: "Trade by year",
              dataUrl: "https://example.com/rest/data/DF_IMTS/A.FJ",
              xAxis: "TIME_PERIOD",
              seriesBy: "GEO_PICT",
              unit: { text: "USD", location: "suffix" },
              decimals: 0,
            },
          ],
        },
      ],
    });

    const compiled = compileDashboardToolConfig(parsed);
    const visual = compiled.rows[0].columns[0];

    expect(visual.type).toBe("table");
    expect(visual.xAxisConcept).toBe("TIME_PERIOD");
    expect(visual.legend?.concept).toBe("GEO_PICT");
    expect(visual.data).toBe(
      "https://example.com/rest/data/DF_IMTS/A.FJ?dimensionAtObservation=AllDimensions",
    );
  });

  it("compiles a table without seriesBy (rows only, no legend)", () => {
    const parsed = dashboardToolConfigSchema.parse({
      id: "demo",
      rows: [
        {
          columns: [
            {
              kind: "table",
              id: "simple_table",
              dataUrl: "https://example.com/rest/data/DF_POP/A.FJ",
              xAxis: "TIME_PERIOD",
            },
          ],
        },
      ],
    });

    const visual = compileDashboardToolConfig(parsed).rows[0].columns[0];
    expect(visual.type).toBe("table");
    expect(visual.legend).toBeUndefined();
  });

  it("compiles map intent visuals into native packed map syntax", () => {
    const parsed = dashboardToolConfigSchema.parse({
      id: "map-demo",
      rows: [
        {
          columns: [
            {
              kind: "map",
              id: "population_map",
              title: "Population Map",
              dataUrl:
                "https://example.com/rest/data/SPC,DF_POP,1.0/A..MIDYEARPOPEST._T._T?lastNObservations=1",
              geoDimension: "GEO_PICT",
              geoPreset: "pacific-eez",
              colorScheme: "Blues",
            },
          ],
        },
      ],
    });

    const compiled = compileDashboardToolConfig(parsed);
    const visual = compiled.rows[0].columns[0];

    expect(visual.type).toBe("map");
    expect(visual.xAxisConcept).toBe("GEO_PICT");
    expect(visual.data).toContain(", {GEO_PICT} | ");
    expect(visual.data).toContain("geonode.pacificdata.org");
    expect(visual.data).toContain("EPSG:3832");
    expect(visual.data).toContain("iso_ter1");
    expect(visual.data).toContain("dimensionAtObservation=AllDimensions");
  });

  it("preserves native dashboards without modification", () => {
    const parsed = dashboardToolConfigSchema.parse({
      id: "native-demo",
      rows: [
        {
          columns: [
            {
              id: "native_chart",
              type: "line",
              xAxisConcept: "TIME_PERIOD",
              yAxisConcept: "OBS_VALUE",
              data: "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_X/A..X",
            },
          ],
        },
      ],
    });

    const compiled = compileDashboardToolConfig(parsed);

    expect(compiled).toEqual(parsed);
  });

  it("rejects fragile chart types without a series dimension", () => {
    const parsed = dashboardToolConfigSchema.parse({
      id: "bad-chart",
      rows: [
        {
          columns: [
            {
              kind: "chart",
              id: "ranking",
              chartType: "bar",
              title: "Ranking",
              dataUrl: "https://example.com/rest/data/DF_X/A..X",
              xAxis: "GEO_PICT",
            },
          ],
        },
      ],
    });

    expect(() => compileDashboardToolConfig(parsed)).toThrow(
      /requires `seriesBy`/,
    );
  });

  function compileChart(chart: Record<string, unknown>) {
    const parsed = dashboardToolConfigSchema.parse({
      id: "composition",
      rows: [
        {
          columns: [
            {
              kind: "chart",
              id: "mix",
              chartType: "bar",
              title: "Revenue mix",
              dataUrl: "https://example.com/rest/data/DF_X/A..X.1000+2000",
              xAxis: "GEO_PICT",
              seriesBy: "TRANSACTION",
              ...chart,
            },
          ],
        },
      ],
    });
    return compileDashboardToolConfig(parsed).rows[0].columns[0];
  }

  it("adds no chart options of its own to a treemap", () => {
    expect(compileChart({ chartType: "treemap" }).extraOptions).toBeUndefined();
  });

  it("compiles axisTitle and categoryAxisTitle to the native axis titles", () => {
    const compiled = compileChart({
      axisTitle: { en: "USD millions", fr: "Millions USD" },
      categoryAxisTitle: "Country",
    });

    expect(compiled.yAxisTitle).toEqual({
      text: { en: "USD millions", fr: "Millions USD" },
    });
    expect(compiled.xAxisTitle).toEqual({ text: "Country" });
    expect(compiled.extraOptions).toBeUndefined();
  });

  it("leaves the axis titles unset when the intent has none", () => {
    const compiled = compileChart({});

    expect(compiled.xAxisTitle).toBeUndefined();
    expect(compiled.yAxisTitle).toBeUndefined();
  });

  it("compiles stacked to one stack shared by every series", () => {
    expect(compileChart({ stacked: true }).extraOptions).toEqual({
      series: { stack: "total" },
    });
  });

  it("merges stacked with the intent's own extraOptions", () => {
    const compiled = compileChart({
      stacked: true,
      extraOptions: { grid: { left: 80 }, series: { barMaxWidth: 40 } },
    });

    expect(compiled.extraOptions).toEqual({
      grid: { left: 80 },
      series: { barMaxWidth: 40, stack: "total" },
    });
  });

  it("rejects a numeric colorPalette value", () => {
    expect(() =>
      compileChart({ colorPalette: { TRANSACTION: { "1000": 3 } } }),
    ).toThrow();
  });
});
