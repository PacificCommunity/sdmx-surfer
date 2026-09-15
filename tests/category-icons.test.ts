import { describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import {
  categoryIconPath,
  primaryCategoryIcon,
  UNMAPPED_CATEGORIES,
} from "@/lib/category-icons";

describe("category pictograms", () => {
  it("maps the subject categories that have a pictogram", () => {
    expect(categoryIconPath({ scheme: "CAS_COM_TOPIC", id: "HEA" }))
      .toBe("/brand/icons/icon_health.svg");
    expect(categoryIconPath({ scheme: "CAS_COM_TOPIC", id: "ECO" }))
      .toBe("/brand/icons/icon_economy.svg");
  });

  it("every mapped icon file actually exists", () => {
    // A path typo would fail as a broken image at runtime and nowhere else.
    for (const id of ["ECO", "ENV", "HEA", "POP", "SOC"]) {
      const p = categoryIconPath({ scheme: "CAS_COM_TOPIC", id })!;
      expect(existsSync("public" + p), p).toBe(true);
    }
  });

  it("returns null rather than a near-miss for domains with no pictogram", () => {
    // Multi-domain and Industry & Services have no pictogram that means them.
    // A wrong domain label is worse than no label.
    for (const key of UNMAPPED_CATEGORIES) {
      const [scheme, id] = key.split(":");
      expect(categoryIconPath({ scheme, id }), key).toBeNull();
    }
  });

  it("refuses to give indicator frameworks a subject icon", () => {
    // SDG, BP50 and NMDI describe how something is reported, not what it is
    // about, so an icon would assert a subject the dataflow does not have.
    for (const id of ["SDG", "BP50", "NMDI"]) {
      expect(categoryIconPath({ scheme: "CAS_COM_DEV", id })).toBeNull();
    }
  });

  it("prefers the subject tag over a framework tag", () => {
    const hit = primaryCategoryIcon([
      { scheme: "CAS_COM_DEV", id: "SDG" },
      { scheme: "CAS_COM_TOPIC", id: "POP" },
    ]);
    expect(hit?.src).toBe("/brand/icons/icon_population.svg");
    expect(hit?.tag.id).toBe("POP");
  });

  it("returns null for a dataflow with no usable tag", () => {
    expect(primaryCategoryIcon([])).toBeNull();
    expect(primaryCategoryIcon(undefined)).toBeNull();
    expect(primaryCategoryIcon([{ scheme: "CAS_COM_DEV", id: "SDG" }])).toBeNull();
  });
});
