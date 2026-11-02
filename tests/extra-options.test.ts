import { describe, expect, it } from "vitest";
import {
  translateDashboardExtraOptions,
  translateExtraOptions,
  translateStoredSession,
} from "@/lib/extra-options";
import type { SDMXDashboardConfig } from "@/lib/types";

function translate(extraOptions: Record<string, unknown>, type = "line") {
  return translateExtraOptions(extraOptions, type);
}

describe("translateExtraOptions: axis rows", () => {
  it("moves an axis title to the axis name", () => {
    expect(translate({ yAxis: { title: { text: "USD millions" } } })).toEqual({
      extraOptions: { yAxis: { name: "USD millions" } },
      dropped: [],
    });
    expect(translate({ xAxis: { title: { text: "Year" } } }, "column").extraOptions).toEqual({
      xAxis: { name: "Year" },
    });
  });

  it("keeps min and max on the same axis", () => {
    expect(translate({ yAxis: { min: 0, max: 100 } }, "lollipop").extraOptions).toEqual({
      yAxis: { min: 0, max: 100 },
    });
  });

  it("renames a logarithmic axis to log", () => {
    expect(translate({ yAxis: { type: "logarithmic" } }).extraOptions).toEqual({
      yAxis: { type: "log" },
    });
  });

  it("renames reversed to inverse", () => {
    expect(translate({ yAxis: { reversed: true } }).extraOptions).toEqual({
      yAxis: { inverse: true },
    });
  });

  it("turns a {value} label format into an axisLabel formatter", () => {
    expect(translate({ yAxis: { labels: { format: "{value}%" } } }).extraOptions).toEqual({
      yAxis: { axisLabel: { formatter: "{value}%" } },
    });
  });

  it("drops a Highcharts number format, which has no ECharts string form", () => {
    expect(translate({ yAxis: { labels: { format: "{value:,.0f}" } } })).toEqual({
      extraOptions: undefined,
      dropped: ["yAxis.labels.format"],
    });
  });

  it("renames label rotation to axisLabel.rotate", () => {
    expect(translate({ xAxis: { labels: { rotation: -45 } } }, "column").extraOptions).toEqual({
      xAxis: { axisLabel: { rotate: -45 } },
    });
  });

  it("drops axis keys with no ECharts equivalent, arrays included", () => {
    const result = translate({
      yAxis: {
        title: { text: "Balance" },
        plotLines: [{ value: 0, width: 2 }],
      },
      xAxis: { categories: ["NR", "TK"], labels: { formatter: "function () {}" } },
    });

    expect(result.extraOptions).toEqual({ yAxis: { name: "Balance" } });
    expect(result.dropped).toEqual([
      "yAxis.plotLines",
      "xAxis.categories",
      "xAxis.labels.formatter",
    ]);
  });

  it("drops axes on charts that have none", () => {
    for (const type of ["pie", "treemap"]) {
      expect(translate({ yAxis: { title: { text: "Share" } } }, type)).toEqual({
        extraOptions: undefined,
        dropped: ["yAxis.title.text"],
      });
    }
  });
});

describe("translateExtraOptions: bar flips the axes", () => {
  it("puts the Highcharts value axis on xAxis", () => {
    expect(
      translate(
        {
          yAxis: {
            title: { text: "Population" },
            min: 0,
            max: 10,
            type: "logarithmic",
            reversed: true,
            labels: { format: "{value}%" },
          },
        },
        "bar",
      ).extraOptions,
    ).toEqual({
      xAxis: {
        name: "Population",
        min: 0,
        max: 10,
        type: "log",
        inverse: true,
        axisLabel: { formatter: "{value}%" },
      },
    });
  });

  it("puts the Highcharts category axis on yAxis", () => {
    expect(
      translate(
        { xAxis: { title: { text: "Country" }, labels: { rotation: 30 } } },
        "bar",
      ).extraOptions,
    ).toEqual({ yAxis: { name: "Country", axisLabel: { rotate: 30 } } });
  });

  it("drops the category index window of a Highcharts bar's xAxis", () => {
    expect(translate({ xAxis: { title: { text: "Country" }, min: 2 } }, "bar")).toEqual({
      extraOptions: { yAxis: { name: "Country" } },
      dropped: ["xAxis.min"],
    });
  });

  it("keeps ECharts axes of a bar where they are", () => {
    const echarts = { xAxis: { name: "Population", min: 0, type: "log" }, yAxis: { name: "Country" } };
    expect(translate(echarts, "bar")).toEqual({ extraOptions: echarts, dropped: [] });
  });
});

describe("translateExtraOptions: other rows", () => {
  it("turns legend.enabled into legend.show and keeps ECharts legend keys", () => {
    expect(translate({ legend: { enabled: false, top: "bottom", verticalAlign: "top" } })).toEqual({
      extraOptions: { legend: { show: false, top: "bottom" } },
      dropped: ["legend.verticalAlign"],
    });
  });

  it("turns normal stacking into a stack shared by every series", () => {
    expect(
      translate({ plotOptions: { series: { stacking: "normal" } } }, "bar").extraOptions,
    ).toEqual({ series: { stack: "total" } });
  });

  it("drops percent stacking", () => {
    expect(translate({ plotOptions: { series: { stacking: "percent" } } }, "bar")).toEqual({
      extraOptions: undefined,
      dropped: ["plotOptions.series.stacking"],
    });
  });

  it("turns data labels into series labels", () => {
    expect(
      translate({ plotOptions: { series: { dataLabels: { enabled: true, format: "{y}" } } } }),
    ).toEqual({
      extraOptions: { series: { label: { show: true } } },
      dropped: ["plotOptions.series.dataLabels.format"],
    });
  });

  it("turns step and marker visibility into their ECharts series names", () => {
    expect(
      translate({ plotOptions: { series: { step: "left", marker: { enabled: false } } } })
        .extraOptions,
    ).toEqual({ series: { step: "start", showSymbol: false } });
  });

  it("drops treemap plot options, which ECharts defaults already cover", () => {
    expect(
      translate(
        { plotOptions: { treemap: { colorByPoint: true, layoutAlgorithm: "squarified" } } },
        "treemap",
      ),
    ).toEqual({
      extraOptions: undefined,
      dropped: ["plotOptions.treemap.colorByPoint", "plotOptions.treemap.layoutAlgorithm"],
    });
  });

  it("renames colors to color", () => {
    expect(translate({ colors: ["#1a6fbb", "#e8609a"] }, "bar").extraOptions).toEqual({
      color: ["#1a6fbb", "#e8609a"],
    });
  });

  it("drops tooltip affixes, which ECharts takes only as a function", () => {
    expect(translate({ tooltip: { valueSuffix: " %", valuePrefix: "$", confine: true } })).toEqual({
      extraOptions: { tooltip: { confine: true } },
      dropped: ["tooltip.valueSuffix", "tooltip.valuePrefix"],
    });
  });

  it("drops the components the library builds itself", () => {
    const result = translate(
      {
        chart: { inverted: true },
        credits: { enabled: false },
        exporting: { enabled: false },
        accessibility: { enabled: true },
        title: { text: "x" },
        subtitle: { text: "y" },
      },
      "bar",
    );
    expect(result.extraOptions).toBeUndefined();
    expect(result.dropped).toEqual([
      "chart.inverted",
      "credits.enabled",
      "exporting.enabled",
      "accessibility.enabled",
      "title.text",
      "subtitle.text",
    ]);
  });

  it("keeps ECharts components such as grid", () => {
    expect(translate({ grid: { left: 80 }, legend: { top: 0 } })).toEqual({
      extraOptions: { grid: { left: 80 }, legend: { top: 0 } },
      dropped: [],
    });
  });

  it("never passes an array through", () => {
    const result = translate({
      yAxis: [{ title: { text: "a" } }, { title: { text: "b" } }],
      series: [{ data: [1, 2] }],
      grid: { left: 10, containLabel: true, extra: [1] },
      seriesMapping: [{ name: "Primary" }],
    });
    expect(result.extraOptions).toEqual({ grid: { left: 10, containLabel: true } });
    expect(result.dropped).toEqual(["yAxis", "series", "grid.extra", "seriesMapping"]);
  });

  it("drops a non-object extraOptions", () => {
    expect(translateExtraOptions(["x"], "line")).toEqual({
      extraOptions: undefined,
      dropped: ["extraOptions"],
    });
  });

  it("leaves visuals the library does not draw with ECharts alone", () => {
    const value = { maxHeight: "80px", minHeight: "80px" };
    expect(translateExtraOptions(value, "value")).toEqual({ extraOptions: value, dropped: [] });
  });
});

describe("translateExtraOptions: idempotence", () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ["bar", { chart: { inverted: true }, plotOptions: { series: { stacking: "normal" } } }],
    ["bar", { yAxis: { type: "logarithmic", title: { text: "Population (log scale)" }, min: 1 } }],
    ["bar", { xAxis: { title: { text: "Country" }, labels: { rotation: 45 } }, colors: ["#000"] }],
    ["line", { yAxis: { title: { text: "Rate" } }, plotOptions: { series: { step: "left", marker: { enabled: false } } } }],
    ["column", { legend: { enabled: false }, plotOptions: { series: { dataLabels: { enabled: true } } } }],
    ["treemap", { plotOptions: { treemap: { colorByPoint: true } } }],
  ];

  it.each(cases)("is a no-op on its own %s output", (type, legacy) => {
    const once = translateExtraOptions(legacy, type);
    const twice = translateExtraOptions(once.extraOptions, type);
    expect(twice.dropped).toEqual([]);
    expect(twice.extraOptions).toBe(once.extraOptions);
  });
});

describe("translateDashboardExtraOptions", () => {
  const config: SDMXDashboardConfig = {
    id: "demo",
    rows: [
      {
        columns: [
          {
            id: "pop_bar",
            type: "bar",
            xAxisConcept: "GEO_PICT",
            extraOptions: { yAxis: { title: { text: "Persons" } }, chart: { inverted: true } },
          },
          {
            id: "mix",
            type: "treemap",
            xAxisConcept: "TRANSACTION",
            extraOptions: { plotOptions: { treemap: { colorByPoint: true } } },
          },
          { id: "kpi", type: "value", xAxisConcept: "OBS_VALUE", extraOptions: { minHeight: "80px" } },
        ],
      },
    ],
  };

  it("translates every visual and reports drops by visual id", () => {
    const result = translateDashboardExtraOptions(config);
    const [bar, treemap, kpi] = result.config.rows[0].columns;

    expect(bar.extraOptions).toEqual({ xAxis: { name: "Persons" } });
    expect("extraOptions" in treemap).toBe(false);
    expect(kpi).toBe(config.rows[0].columns[2]);
    expect(result.dropped).toEqual([
      "pop_bar: chart.inverted",
      "mix: plotOptions.treemap.colorByPoint",
    ]);
  });

  it("returns the same config when there is nothing to translate", () => {
    const translated = translateDashboardExtraOptions(config).config;
    const again = translateDashboardExtraOptions(translated);
    expect(again.config).toBe(translated);
    expect(again.dropped).toEqual([]);
  });

  it("tolerates malformed stored configs", () => {
    const broken = { id: "x" } as unknown as SDMXDashboardConfig;
    expect(translateDashboardExtraOptions(broken)).toEqual({ config: broken, dropped: [] });
  });
});

describe("translateStoredSession", () => {
  const legacy: SDMXDashboardConfig = {
    id: "demo",
    rows: [
      {
        columns: [
          {
            id: "trend",
            type: "line",
            xAxisConcept: "TIME_PERIOD",
            extraOptions: { yAxis: { title: { text: "Rate" } } },
          },
        ],
      },
    ],
  };

  it("translates every history entry and every update_dashboard output", () => {
    const messages = [
      { id: "u1", role: "user", parts: [{ type: "text", text: "hi" }] },
      {
        id: "a1",
        role: "assistant",
        parts: [
          {
            type: "tool-update_dashboard",
            state: "output-available",
            output: { success: true, dashboard: legacy },
          },
        ],
      },
    ];

    const result = translateStoredSession([legacy, legacy], messages);

    expect(result.historyEntriesChanged).toBe(2);
    expect(result.messageOutputsChanged).toBe(1);
    expect(result.dropped).toEqual([]);
    const translated = result.configHistory[1] as SDMXDashboardConfig;
    expect(translated.rows[0].columns[0].extraOptions).toEqual({ yAxis: { name: "Rate" } });
    expect(result.messages[1].parts[0]).toMatchObject({ output: { dashboard: translated } });
    expect(result.messages[0]).toBe(messages[0]);
  });
});
