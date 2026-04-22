import type { DashboardAuthoringConfig } from "./dashboard-authoring";

/**
 * Example dashboard authoring specs for the system prompt.
 * These compile into valid sdmx-dashboard-components configs server-side.
 */

export const EXAMPLE_POPULATION_CHART: DashboardAuthoringConfig = {
  id: "population_chart",
  colCount: 1,
  header: {
    title: "Pacific Island Population",
    subtitle: "Mid-year population estimates (latest)",
  },
  rows: [
    {
      columns: [
        {
          kind: "chart",
          id: "pop_bar",
          chartType: "bar",
          colSize: 1,
          title: "Population by Country",
          xAxis: "GEO_PICT",
          seriesBy: "INDICATOR",
          legendLocation: "none",
          dataUrl:
            "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_POP_PROJ/A..MIDYEARPOPEST._T._T?lastNObservations=1",
          labels: true,
          download: true,
          sortByValue: "desc",
        },
      ],
    },
  ],
};

export const EXAMPLE_TRADE_LINE: DashboardAuthoringConfig = {
  id: "trade_trends",
  colCount: 1,
  header: {
    title: "Trade Trends",
    subtitle: "Imports & Exports over time, multi-country comparison (USD)",
  },
  rows: [
    {
      columns: [
        {
          kind: "chart",
          id: "trade_line",
          chartType: "line",
          colSize: 1,
          title: "Trade Value Over Time",
          xAxis: "TIME_PERIOD",
          seriesBy: "GEO_PICT",
          legendLocation: "bottom",
          dataUrl:
            "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_IMTS/A.FJ+WS+TO.AMT.M+X._T._T._T.USD?startPeriod=2010",
          download: true,
        },
      ],
    },
  ],
};

export const EXAMPLE_KPI_AND_MAP: DashboardAuthoringConfig = {
  id: "population_overview",
  colCount: 3,
  header: {
    title: "Population Snapshot",
    subtitle: "Latest available values",
  },
  rows: [
    {
      columns: [
        {
          kind: "kpi",
          id: "pop_value",
          colSize: 1,
          title: "Latest Population",
          dataUrl:
            "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_POP_PROJ/A.FJ.MIDYEARPOPEST._T._T?lastNObservations=1",
          unit: { text: "persons", location: "suffix" },
          decimals: 0,
        },
        {
          kind: "map",
          id: "pop_map",
          colSize: 2,
          title: "Population by Country",
          dataUrl:
            "https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_POP_PROJ,3.0/A..MIDYEARPOPEST._T._T?lastNObservations=1",
          geoDimension: "GEO_PICT",
          geoPreset: "pacific-eez",
          colorScheme: "Blues",
          download: true,
        },
      ],
    },
  ],
};

export function examplesAsText(): string {
  return [
    "Example 1 - Bar chart of population (authoring schema):\n" +
      JSON.stringify(EXAMPLE_POPULATION_CHART, null, 2),
    "Example 2 - Line chart of trade trends (authoring schema):\n" +
      JSON.stringify(EXAMPLE_TRADE_LINE, null, 2),
    "Example 3 - KPI + map dashboard (authoring schema):\n" +
      JSON.stringify(EXAMPLE_KPI_AND_MAP, null, 2),
  ].join("\n\n");
}
