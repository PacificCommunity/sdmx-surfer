import type { SDMXDashboardConfig } from "./types";

/**
 * Example dashboard configs for the system prompt.
 * These use real working URLs from stats-sdmx-disseminate.pacificdata.org.
 */

export const EXAMPLE_POPULATION_CHART: SDMXDashboardConfig = {
  id: "population_chart",
  colCount: 1,
  header: {
    title: { text: "Pacific Island Population" },
    subtitle: { text: "Mid-year population estimates (latest)" },
  },
  rows: [
    {
      columns: [
        {
          id: "pop_bar",
          type: "bar",
          colSize: 1,
          title: { text: "Population by Country" },
          xAxisConcept: "GEO_PICT",
          yAxisConcept: "OBS_VALUE",
          data: "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_POP_PROJ/A..MIDYEARPOPEST._T._T?dimensionAtObservation=AllDimensions&lastNObservations=1",
          legend: { concept: "INDICATOR", location: "none" },
          labels: true,
          download: true,
          sortByValue: "desc",
        },
      ],
    },
  ],
};

export const EXAMPLE_TRADE_LINE: SDMXDashboardConfig = {
  id: "trade_trends",
  colCount: 1,
  header: {
    title: { text: "Trade Trends" },
    subtitle: { text: "Fiji, Samoa, Tonga — Imports & Exports (USD)" },
  },
  rows: [
    {
      columns: [
        {
          id: "trade_line",
          type: "line",
          colSize: 1,
          title: { text: "Trade Value Over Time" },
          xAxisConcept: "TIME_PERIOD",
          yAxisConcept: "OBS_VALUE",
          data: "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_IMTS/A.FJ+WS+TO.AMT.M+X._T._T._T.USD?dimensionAtObservation=AllDimensions&startPeriod=2010",
          legend: { concept: "GEO_PICT", location: "bottom" },
          labels: false,
          download: true,
        },
      ],
    },
  ],
};

export const EXAMPLE_KPI_DASHBOARD: SDMXDashboardConfig = {
  id: "kpi_overview",
  colCount: 3,
  header: {
    title: { text: "Key Indicators" },
  },
  rows: [
    {
      columns: [
        {
          id: "pop_value",
          type: "value",
          colSize: 1,
          title: { text: "Fiji Population" },
          xAxisConcept: "OBS_VALUE",
          data: "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_POP_PROJ/A.FJ.MIDYEARPOPEST._T._T?dimensionAtObservation=AllDimensions&lastNObservations=1",
          unit: { text: "persons", location: "suffix" },
          decimals: 0,
        },
        {
          id: "pop_chart",
          type: "column",
          colSize: 2,
          title: { text: "Population by Country" },
          xAxisConcept: "GEO_PICT",
          yAxisConcept: "OBS_VALUE",
          data: "https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_POP_PROJ/A..MIDYEARPOPEST._T._T?dimensionAtObservation=AllDimensions&lastNObservations=1",
          legend: { concept: "INDICATOR", location: "none" },
          sortByValue: "desc",
          download: true,
        },
      ],
    },
  ],
};

export function examplesAsText(): string {
  return [
    "Example 1 - Bar chart of population:\n" +
      JSON.stringify(EXAMPLE_POPULATION_CHART, null, 2),
    "Example 2 - Line chart of trade trends:\n" +
      JSON.stringify(EXAMPLE_TRADE_LINE, null, 2),
    "Example 3 - KPI + column chart dashboard:\n" +
      JSON.stringify(EXAMPLE_KPI_DASHBOARD, null, 2),
  ].join("\n\n");
}
