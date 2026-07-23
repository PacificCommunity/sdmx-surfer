import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/country-snapshots/catalogue.generated", () => ({
  catalogue: {
    generatedAt: "2026-06-08T00:00:00Z",
    sourceFile: "fixture.xlsx",
    countries: [
      { code: "TO", name: "Tonga", region: "POL", mfatRelevant: true },
      { code: "WS", name: "Samoa", region: "POL", mfatRelevant: true },
    ],
    themes: [
      { id: "I", slug: "context", title: "Context", order: 1 },
      { id: "II", slug: "health", title: "Health", order: 2 },
    ],
    indicators: [
      {
        id: "I.5",
        themeId: "I",
        title: "Mid-year population estimate",
        rendering: "TABLE",
        dataflow: "DF_POP_PROJ",
      },
      {
        id: "II.1",
        themeId: "II",
        title: "Life expectancy at birth",
        rendering: "CHART",
        dataflow: "DF_VITAL",
      },
      {
        id: "II.99",
        themeId: "II",
        title: "Constitutional form",
        rendering: "TEXT",
        // no dataflow → "no data source"
      },
    ],
  },
}));

import { renderCatalogueForPrompt, getMode } from "../../lib/country-snapshots/catalogue-access";

describe("renderCatalogueForPrompt", () => {
  it("includes every theme title", () => {
    const text = renderCatalogueForPrompt();
    expect(text).toContain("## Context");
    expect(text).toContain("## Health");
  });

  it("includes every indicator id and title", () => {
    const text = renderCatalogueForPrompt();
    expect(text).toContain("I.5");
    expect(text).toContain("Mid-year population estimate");
    expect(text).toContain("II.1");
    expect(text).toContain("Life expectancy at birth");
    expect(text).toContain("II.99");
    expect(text).toContain("Constitutional form");
  });

  it("marks indicators with their dataflow + url or 'no data source'", () => {
    const text = renderCatalogueForPrompt();
    expect(text).toContain("dataflow: DF_POP_PROJ");
    expect(text).toContain("dataflow: DF_VITAL");
    expect(text).toContain("(no data source)");
  });

  it("lists every country with region and mfat flag", () => {
    const text = renderCatalogueForPrompt();
    expect(text).toContain("TO: Tonga, POL, mfat=1");
    expect(text).toContain("WS: Samoa, POL, mfat=1");
  });
});

describe("getMode", () => {
  it("defaults to prompt", () => {
    delete process.env.SNAPSHOT_CATALOGUE_MODE;
    expect(getMode()).toBe("prompt");
  });

  it("returns tool when env says so", () => {
    process.env.SNAPSHOT_CATALOGUE_MODE = "tool";
    expect(getMode()).toBe("tool");
    delete process.env.SNAPSHOT_CATALOGUE_MODE;
  });

  it("defaults to prompt for any other value", () => {
    process.env.SNAPSHOT_CATALOGUE_MODE = "rag";
    expect(getMode()).toBe("prompt");
    delete process.env.SNAPSHOT_CATALOGUE_MODE;
  });
});
