import { describe, it, expect, vi } from "vitest";

// Stub the chart-types cache so tests aren't dependent on the real probed data.
// II.1 in TO/WS/VU has plenty of points (line); II.2 has 2 points (bar);
// II.10 is a text indicator with no data source.
vi.mock("../../lib/country-snapshots/chart-types.generated", () => ({
  chartTypes: {
    "II.1": {
      TO: { type: "line", timePoints: 10, detectedAt: "2026-06-08", locked: true },
      WS: { type: "line", timePoints: 10, detectedAt: "2026-06-08", locked: true },
      VU: { type: "line", timePoints: 10, detectedAt: "2026-06-08", locked: true },
    },
    "II.2": {
      TO: { type: "bar", timePoints: 2, detectedAt: "2026-06-08", locked: false },
      WS: { type: "bar", timePoints: 2, detectedAt: "2026-06-08", locked: false },
      VU: { type: "bar", timePoints: 2, detectedAt: "2026-06-08", locked: false },
    },
    "II.3": {
      // CHART rendering with sparse data — should render as value, not line
      TO: { type: "bar", timePoints: 1, detectedAt: "2026-06-08", locked: false },
      WS: { type: "bar", timePoints: 1, detectedAt: "2026-06-08", locked: false },
      VU: { type: "bar", timePoints: 1, detectedAt: "2026-06-08", locked: false },
    },
    "II.4": {
      // Only ONE country has data — compare-mode bar would have GEO as a
      // single-valued dim and the library throws. Must degrade.
      TO: { type: "bar", timePoints: 2, detectedAt: "2026-06-08", locked: false },
      WS: { type: "empty", timePoints: 0, detectedAt: "2026-06-08", locked: false },
      VU: { type: "empty", timePoints: 0, detectedAt: "2026-06-08", locked: false },
    },
    "II.5": {
      // Only one country has data but a LONG series — degrade to plain line.
      TO: { type: "line", timePoints: 12, detectedAt: "2026-06-08", locked: true },
      WS: { type: "error", timePoints: 0, detectedAt: "2026-06-08", locked: false },
      VU: { type: "empty", timePoints: 0, detectedAt: "2026-06-08", locked: false },
    },
    "II.6": {
      // Consolidated (SEX=M+F) with data in multiple countries.
      TO: { type: "line", timePoints: 10, detectedAt: "2026-06-08", locked: true },
      WS: { type: "line", timePoints: 10, detectedAt: "2026-06-08", locked: true },
      VU: { type: "line", timePoints: 10, detectedAt: "2026-06-08", locked: true },
    },
  },
}));

import { buildSnapshotConfig } from "../../lib/country-snapshots/config-builder";
import type { Catalogue } from "../../lib/country-snapshots/catalogue";

const fixture: Catalogue = {
  generatedAt: "2026-06-08T00:00:00Z",
  sourceFile: "fixture",
  countries: [
    { code: "TO", name: "Tonga", region: "POL", mfatRelevant: true },
    { code: "WS", name: "Samoa", region: "POL", mfatRelevant: true },
    { code: "VU", name: "Vanuatu", region: "MEL", mfatRelevant: true },
  ],
  themes: [{ id: "II", slug: "health", title: "Health", order: 2 }],
  indicators: [
    {
      id: "II.1",
      themeId: "II",
      title: "Life expectancy",
      rendering: "CHART",
      dataflow: "DF_LIFE",
      apiUrlTemplate: "https://x/SPC,DF_LIFE,/A.[TAG_GEO].LIFE",
      visUrl: "https://stats.x/vis",
    },
    {
      id: "II.10",
      themeId: "II",
      title: "Static fact",
      rendering: "TEXT",
    },
    {
      id: "II.2",
      themeId: "II",
      title: "Smoking",
      rendering: "TABLE",
      dataflow: "DF_SMK",
      apiUrlTemplate: "https://x/SPC,DF_SMK,/A.[TAG_GEO].SMK",
    },
    {
      id: "II.3",
      themeId: "II",
      title: "Recent census coverage",
      rendering: "CHART",
      dataflow: "DF_CENSUS",
      apiUrlTemplate: "https://x/SPC,DF_CENSUS,/A.[TAG_GEO].CENSUS",
    },
    {
      id: "II.4",
      themeId: "II",
      title: "Sparse single-source indicator",
      rendering: "TABLE",
      dataflow: "DF_SPARSE",
      apiUrlTemplate: "https://x/SPC,DF_SPARSE,/A.[TAG_GEO].SPARSE",
    },
    {
      id: "II.5",
      themeId: "II",
      title: "Long series in one country only",
      rendering: "CHART",
      dataflow: "DF_LONG",
      apiUrlTemplate: "https://x/SPC,DF_LONG,/A.[TAG_GEO].LONG",
    },
    {
      id: "II.6",
      themeId: "II",
      title: "Life expectancy at birth",
      rendering: "CHART",
      dataflow: "DF_VITAL2",
      apiUrlTemplate: "https://x/SPC,DF_VITAL2,/A.[TAG_GEO].LEB.M+F?dimensionAtObservation=AllDimensions",
      seriesConcept: "SEX",
      consolidatedFromIds: ["II.6", "II.7"],
    },
  ],
};

describe("buildSnapshotConfig", () => {
  it("substitutes a single country code", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const lifeItem = cfg.items.find((i) => i.id === "II.1");
    expect(lifeItem?.dataUrl).toBe("https://x/SPC,DF_LIFE,/A.TO.LIFE");
  });

  it("substitutes multiple country codes as a + list", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries,
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const lifeItem = cfg.items.find((i) => i.id === "II.1");
    expect(lifeItem?.dataUrl).toBe("https://x/SPC,DF_LIFE,/A.TO+WS+VU.LIFE");
  });

  it("emits a text item with no dataUrl for indicators lacking a source", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const staticItem = cfg.items.find((i) => i.id === "II.10");
    expect(staticItem?.type).toBe("text");
    expect(staticItem?.dataUrl).toBeUndefined();
    expect(staticItem?.source).toBeUndefined();
  });

  it("orders items by indicator id with numeric semantics (II.2 before II.10)", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    expect(cfg.items.map((i) => i.id)).toEqual([
      "II.1", "II.2", "II.3", "II.4", "II.5", "II.6", "II.10",
    ]);
  });

  it("attaches source metadata for indicators with a dataflow", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const lifeItem = cfg.items.find((i) => i.id === "II.1");
    expect(lifeItem?.source?.dataflow).toBe("DF_LIFE");
    expect(lifeItem?.source?.visUrl).toBe("https://stats.x/vis");
  });

  it("data-shape-first routing on single-country", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const types = Object.fromEntries(cfg.items.map((i) => [i.id, i.type]));
    expect(types["II.1"]).toBe("chart"); // ≥3 pts → line chart (was CHART)
    expect(types["II.2"]).toBe("table"); // sparse + TABLE rendering → pivot table
    expect(types["II.3"]).toBe("value"); // sparse + CHART rendering → value KPI
    expect(types["II.10"]).toBe("text"); // no data → text
  });

  it("CHART indicators with ≥3 points get chartType=line on single-country pages", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const lifeItem = cfg.items.find((i) => i.id === "II.1");
    expect(lifeItem?.type).toBe("chart");
    expect(lifeItem?.chartType).toBe("line");
  });

  it("CHART indicators with sparse data fall back to value on single-country pages", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const sparseChart = cfg.items.find((i) => i.id === "II.3");
    // Lollipop would be the ideal viz but it needs a second varying
    // dimension; until consolidation produces multi-series queries we
    // settle for the KPI value.
    expect(sparseChart?.type).toBe("value");
    expect(sparseChart?.chartType).toBeUndefined();
  });

  it("compare-mode uses chart visuals; GEO provides the varying dim", () => {
    const cfg = buildSnapshotConfig({
      country: [fixture.countries[0], fixture.countries[1]],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const sparseItem = cfg.items.find((i) => i.id === "II.2");
    expect(sparseItem?.type).toBe("chart");
    expect(sparseItem?.chartType).toBe("bar");
  });

  it("collapses compare-mode chartType to line when any country has line", () => {
    const cfg = buildSnapshotConfig({
      country: [fixture.countries[0], fixture.countries[1]],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const lifeItem = cfg.items.find((i) => i.id === "II.1");
    expect(lifeItem?.chartType).toBe("line");
  });

  // Regression: bar/lollipop in compare mode require GEO to actually VARY.
  // When only one of the selected countries has data, the library throws
  // "needs at least one other varying dimension" — the builder must degrade
  // to single-country rules instead.
  describe("compare with only one country holding data", () => {
    it("degrades sparse single-data TABLE indicators to a table, not bar", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      const item = cfg.items.find((i) => i.id === "II.4");
      expect(item?.type).toBe("table");
      expect(item?.chartType).toBeUndefined();
    });

    it("degrades long single-data series to a plain line", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1], fixture.countries[2]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      const item = cfg.items.find((i) => i.id === "II.5");
      expect(item?.type).toBe("chart");
      expect(item?.chartType).toBe("line");
    });

    it("keeps true multi-country compare as bar", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      const item = cfg.items.find((i) => i.id === "II.2");
      expect(item?.chartType).toBe("bar");
    });
  });

  // Regression: a consolidated indicator (SEX=M+F in one URL) in compare
  // mode would put TWO varying dims in one chart — legending on GEO merges
  // the M/F observations per country into a zig-zag line. The builder must
  // split into one chart per stratum with countries as the series.
  describe("consolidated indicators in compare mode", () => {
    it("splits SEX=M+F into one chart per stratum", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      const male = cfg.items.find((i) => i.id === "II.6-M");
      const female = cfg.items.find((i) => i.id === "II.6-F");
      expect(male).toBeDefined();
      expect(female).toBeDefined();
      expect(cfg.items.find((i) => i.id === "II.6")).toBeUndefined();
      expect(male!.title).toBe("Life expectancy at birth — Male");
      expect(female!.title).toBe("Life expectancy at birth — Female");
      // Each stratum URL is narrowed to one SEX value with GEO substituted.
      expect(male!.dataUrl).toBe(
        "https://x/SPC,DF_VITAL2,/A.TO+WS.LEB.M?dimensionAtObservation=AllDimensions",
      );
      expect(female!.dataUrl).toBe(
        "https://x/SPC,DF_VITAL2,/A.TO+WS.LEB.F?dimensionAtObservation=AllDimensions",
      );
      // seriesConcept dropped: countries are the series now.
      expect(male!.seriesConcept).toBeUndefined();
      expect(male!.type).toBe("chart");
      expect(male!.chartType).toBe("line");
    });

    it("keeps the consolidated single chart on single-country pages", () => {
      const cfg = buildSnapshotConfig({
        country: fixture.countries[0],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      const item = cfg.items.find((i) => i.id === "II.6");
      expect(item).toBeDefined();
      expect(item!.seriesConcept).toBe("SEX");
      expect(cfg.items.find((i) => i.id === "II.6-M")).toBeUndefined();
    });
  });

  // The decision engine's one rule: a chart series on at most ONE varying
  // non-time dimension, named in legendConcept. These assertions pin the
  // legend choice per scenario.
  describe("legendConcept selection", () => {
    it("single country, plain indicator → no legend", () => {
      const cfg = buildSnapshotConfig({
        country: fixture.countries[0],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      expect(cfg.items.find((i) => i.id === "II.1")!.legendConcept)
        .toBeUndefined();
    });

    it("single country, consolidated → legend on the stratifier", () => {
      const cfg = buildSnapshotConfig({
        country: fixture.countries[0],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      const item = cfg.items.find((i) => i.id === "II.6")!;
      expect(item.type).toBe("chart");
      expect(item.legendConcept).toBe("SEX");
    });

    it("compare, plain indicator → legend on the geo dimension", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      expect(cfg.items.find((i) => i.id === "II.1")!.legendConcept).toBe(
        "GEO_PICT",
      );
    });

    it("compare, split strata → each part legends on geo", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      expect(cfg.items.find((i) => i.id === "II.6-M")!.legendConcept).toBe(
        "GEO_PICT",
      );
    });

    it("compare degraded to one country with data → line still NAMES that country", () => {
      const cfg = buildSnapshotConfig({
        country: [fixture.countries[0], fixture.countries[1], fixture.countries[2]],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      // II.5 only has data in TO. GEO doesn't vary, so this is a single
      // series — but a one-entry legend labels which country it shows,
      // and the missing countries are surfaced explicitly.
      const item = cfg.items.find((i) => i.id === "II.5")!;
      expect(item.chartType).toBe("line");
      expect(item.legendConcept).toBe("GEO_PICT");
      expect(item.missingCountries).toEqual(["Samoa", "Vanuatu"]);
    });

    it("single-country pages never carry missingCountries", () => {
      const cfg = buildSnapshotConfig({
        country: fixture.countries[0],
        theme: fixture.themes[0],
        catalogue: fixture,
      });
      for (const item of cfg.items) {
        expect(item.missingCountries).toBeUndefined();
      }
    });
  });
});
