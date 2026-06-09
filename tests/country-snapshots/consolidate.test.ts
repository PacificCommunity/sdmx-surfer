import { describe, it, expect } from "vitest";
import {
  parseUrl,
  longestCommonPrefix,
  consolidate,
} from "../../scripts/consolidate-country-snapshot-indicators";
import type { Catalogue } from "../../lib/country-snapshots/catalogue";

describe("parseUrl", () => {
  it("splits the SPC dataset key", () => {
    const p = parseUrl(
      "https://x/SPC,DF_VITAL,/A.[TAG_GEO].LEB.M?dimensionAtObservation=AllDimensions",
    );
    expect(p).not.toBeNull();
    expect(p!.parts).toEqual(["A", "[TAG_GEO]", "LEB", "M"]);
    expect(p!.querySuffix).toBe("?dimensionAtObservation=AllDimensions");
  });

  it("returns null for non-matching URLs", () => {
    expect(parseUrl("https://example.org/whatever")).toBeNull();
  });
});

describe("longestCommonPrefix", () => {
  it("strips trailing punctuation and whitespace", () => {
    expect(
      longestCommonPrefix([
        "Life expectancy at birth (male)",
        "Life expectancy at birth (female)",
      ]),
    ).toBe("Life expectancy at birth");
    expect(
      longestCommonPrefix([
        "Literacy Rates of 15-24 year olds (%)",
        "Literacy Rates of 15-24 year olds (% - female)",
        "Literacy Rates of 15-24 year olds (% - male)",
      ]),
    ).toBe("Literacy Rates of 15-24 year olds");
  });
});

describe("consolidate", () => {
  const fixture: Catalogue = {
    generatedAt: "2026-06-08T00:00:00Z",
    sourceFile: "fixture",
    countries: [
      { code: "TO", name: "Tonga", region: "POL", mfatRelevant: true },
    ],
    themes: [{ id: "II", slug: "health", title: "Health", order: 2 }],
    indicators: [
      {
        id: "II.1",
        themeId: "II",
        title: "Life expectancy at birth (male)",
        rendering: "CHART",
        dataflow: "DF_VITAL",
        apiUrlTemplate:
          "https://x/SPC,DF_VITAL,/A.[TAG_GEO].LEB.M?dimensionAtObservation=AllDimensions",
      },
      {
        id: "II.2",
        themeId: "II",
        title: "Life expectancy at birth (female)",
        rendering: "CHART",
        dataflow: "DF_VITAL",
        apiUrlTemplate:
          "https://x/SPC,DF_VITAL,/A.[TAG_GEO].LEB.F?dimensionAtObservation=AllDimensions",
      },
      {
        id: "II.3",
        themeId: "II",
        title: "Total fertility rate",
        rendering: "CHART",
        dataflow: "DF_VITAL",
        apiUrlTemplate:
          "https://x/SPC,DF_VITAL,/A.[TAG_GEO].TFR.?dimensionAtObservation=AllDimensions",
      },
    ],
  };

  it("merges paired indicators differing in one position", () => {
    const result = consolidate(fixture);
    expect(result.merges).toHaveLength(1);
    expect(result.merges[0].sourceIds).toEqual(["II.1", "II.2"]);
    const merged = result.catalogue.indicators.find((i) => i.id === "II.1");
    expect(merged).toBeDefined();
    expect(merged!.title).toBe("Life expectancy at birth");
    expect(merged!.seriesConcept).toBe("SEX");
    expect(merged!.consolidatedFromIds).toEqual(["II.1", "II.2"]);
    expect(merged!.apiUrlTemplate).toContain(".LEB.M+F?");
  });

  it("leaves unrelated indicators alone", () => {
    const result = consolidate(fixture);
    const tfr = result.catalogue.indicators.find((i) => i.id === "II.3");
    expect(tfr).toBeDefined();
    expect(tfr!.seriesConcept).toBeUndefined();
  });

  it("reduces the catalogue size for paired indicators", () => {
    const result = consolidate(fixture);
    expect(result.catalogue.indicators).toHaveLength(2); // II.1 (merged) + II.3
  });
});
