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
    expect(cfg.items.map((i) => i.id)).toEqual(["II.1", "II.2", "II.10"]);
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

  it("emits type=chart for indicators with usable data, type=text otherwise", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const types = Object.fromEntries(cfg.items.map((i) => [i.id, i.type]));
    expect(types["II.1"]).toBe("chart"); // line in cache
    expect(types["II.2"]).toBe("chart"); // bar in cache
    expect(types["II.10"]).toBe("text"); // no data source
  });

  it("picks chartType from the per-(indicator × country) cache", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const chartTypes = Object.fromEntries(
      cfg.items.map((i) => [i.id, i.chartType]),
    );
    expect(chartTypes["II.1"]).toBe("line");
    expect(chartTypes["II.2"]).toBe("bar");
    expect(chartTypes["II.10"]).toBeUndefined();
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
});
