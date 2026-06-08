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
      { id: "II", slug: "health", title: "Health", order: 2 },
      { id: "III", slug: "education", title: "Education", order: 3 },
    ],
    indicators: [
      { id: "II.1", themeId: "II", title: "X", rendering: "CHART" },
      { id: "III.1", themeId: "III", title: "Y", rendering: "TABLE" },
      { id: "II.2", themeId: "II", title: "Z", rendering: "TABLE" },
    ],
  },
}));

import {
  getCountry,
  getThemeBySlug,
  getIndicatorsForTheme,
} from "../../lib/country-snapshots/catalogue";

describe("catalogue helpers", () => {
  it("looks up countries by code", () => {
    expect(getCountry("TO")?.name).toBe("Tonga");
    expect(getCountry("XX")).toBeUndefined();
  });

  it("looks up themes by slug", () => {
    expect(getThemeBySlug("health")?.id).toBe("II");
  });

  it("returns indicators for a theme in numeric id order", () => {
    const ids = getIndicatorsForTheme("II").map((i) => i.id);
    expect(ids).toEqual(["II.1", "II.2"]);
  });
});
