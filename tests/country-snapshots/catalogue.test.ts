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

// The mock above replaces the generated catalogue module. To exercise the
// REAL catalogue, import its data via a side-channel that bypasses the mock.
// Using vi.importActual gives us a clean reference even though the module is mocked.
describe("real catalogue invariants", async () => {
  const real = (
    await vi.importActual<
      typeof import("../../lib/country-snapshots/catalogue.generated")
    >("../../lib/country-snapshots/catalogue.generated")
  ).catalogue;

  it("every indicator's themeId resolves to a known theme", () => {
    const themeIds = new Set(real.themes.map((t) => t.id));
    const orphans = real.indicators.filter((i) => !themeIds.has(i.themeId));
    expect(orphans).toEqual([]);
  });

  it("every indicator with a dataflow has an apiUrlTemplate", () => {
    const broken = real.indicators.filter((i) => i.dataflow && !i.apiUrlTemplate);
    expect(broken.map((i) => i.id)).toEqual([]);
  });

  it("every apiUrlTemplate contains exactly one [TAG_GEO]", () => {
    const malformed = real.indicators.filter((i) => {
      if (!i.apiUrlTemplate) return false;
      const matches = i.apiUrlTemplate.match(/\[TAG_GEO\]/g) ?? [];
      return matches.length !== 1;
    });
    expect(malformed.map((i) => i.id)).toEqual([]);
  });

  it("theme slugs are unique", () => {
    const slugs = real.themes.map((t) => t.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("country codes are unique", () => {
    const codes = real.countries.map((c) => c.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("has the expected order of magnitude (sanity)", () => {
    expect(real.countries.length).toBeGreaterThan(15);
    expect(real.themes.length).toBeGreaterThanOrEqual(10);
    expect(real.indicators.length).toBeGreaterThan(80);
  });
});
