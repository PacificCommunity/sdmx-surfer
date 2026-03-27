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
    expect(visual.data).toContain("maps/eez.json");
    expect(visual.data).toContain("EPSG:3832");
    expect(visual.data).toContain("{id}");
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
              data: "https://example.com/rest/data/DF_X/A..X",
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
});
