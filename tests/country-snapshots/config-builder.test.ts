import { describe, it, expect } from "vitest";
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

  it("maps rendering to type: CHART→chart, TABLE→table, TEXT→text", () => {
    const cfg = buildSnapshotConfig({
      country: fixture.countries[0],
      theme: fixture.themes[0],
      catalogue: fixture,
    });
    const types = Object.fromEntries(cfg.items.map((i) => [i.id, i.type]));
    expect(types["II.1"]).toBe("chart");
    expect(types["II.2"]).toBe("table");
    expect(types["II.10"]).toBe("text");
  });
});
