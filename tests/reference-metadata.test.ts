import { describe, expect, it } from "vitest";
import {
  cleanMetadataValue,
  normaliseReferenceMetadata,
} from "@/lib/reference-metadata";

// Attribute shapes below are copied from live SPC responses (gateway v1.26.0):
// `value` is plain and the language sits in a sibling field.
const attr = (
  id: string,
  value: string,
  extra: Record<string, unknown> = {},
) => ({
  id,
  path: id,
  label: null,
  value,
  language: "en",
  level: "dataflow",
  source: "msd",
  ...extra,
});

describe("reference metadata", () => {
  it("passes plain values through untouched", () => {
    expect(cleanMetadataValue("National Statistics Offices (NSO)")).toBe(
      "National Statistics Offices (NSO)",
    );
    // A colon inside prose must survive; only a language tag is stripped.
    expect(cleanMetadataValue("Note: figures are provisional")).toBe(
      "Note: figures are provisional",
    );
    expect(cleanMetadataValue("https://dsbb.imf.org/")).toBe(
      "https://dsbb.imf.org/",
    );
    expect(cleanMetadataValue(undefined)).toBe("");
  });

  it("strips an inlined language tag when the gateway sends one", () => {
    expect(cleanMetadataValue('en: "National Statistics Organisations."')).toBe(
      "National Statistics Organisations.",
    );
    expect(cleanMetadataValue('fr-FR: "Recensement"')).toBe("Recensement");
  });

  it("normalises a well-documented dataflow in reading order", () => {
    const p = normaliseReferenceMetadata("DF_CPI", {
      metadata_attributes: [
        attr("DATA_COMMENT", "The CPI measures a representative basket."),
        attr("DATA_SOURCE_ORGANIZATION", "National Statistics Offices (NSO)"),
        attr("DATA_REVISION", "Revisions may not be reflected immediately."),
        attr("DATA_SOURCE_DATE", "2026-03-01", { language: null }),
        attr("DATA_PROCESSING", "Compiled per the CPI Manual."),
      ],
      notes: [],
    });

    expect(p.available).toBe(true);
    expect(p.note).toBeUndefined();
    expect(p.fields.map((f) => f.id)).toEqual([
      "DATA_SOURCE_ORGANIZATION",
      "DATA_SOURCE_DATE",
      "DATA_PROCESSING",
      "DATA_REVISION",
      "DATA_COMMENT",
    ]);
  });

  it("keeps the ids the catalogue actually publishes", () => {
    // DATA_SOURCE_LICENSE is the provider's spelling; a DATA_LICENCE key would
    // silently never match, which is how the licence field went missing.
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE_LICENSE", "CC BY 4.0"),
        attr("DATA_SOURCE_COMMENT", "Compiled manually from NSO websites."),
        attr("DATA_SOURCE_TITLE", "Consumer price statistics"),
      ],
    });
    expect(p.fields.map((f) => f.id)).toEqual([
      "DATA_SOURCE_TITLE",
      "DATA_SOURCE_COMMENT",
      "DATA_SOURCE_LICENSE",
    ]);
  });

  it("exposes a source link as an href", () => {
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE_LINK", "https://stats.pacificdata.org/"),
      ],
    });
    expect(p.fields[0].href).toBe("https://stats.pacificdata.org/");
  });

  it("drops series-level attributes, which describe cells not provenance", () => {
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("UNIT_MEASURE", "KM2", { level: "series" }),
        attr("OBS_COMMENT", "Break in series", { level: "observation" }),
        attr("DATA_COMMENT", "Regional aggregate."),
      ],
    });
    expect(p.fields.map((f) => f.id)).toEqual(["DATA_COMMENT"]);
  });

  it("prefers the English rendering when a field repeats per language", () => {
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_COMMENT", "Recensement de la population", {
          language: "fr",
        }),
        attr("DATA_COMMENT", "Population census"),
      ],
    });
    expect(p.fields[0].text).toBe("Population census");
  });

  it("states absence in words rather than returning a blank panel", () => {
    // Nine SPC flows publish nothing, DF_BP50 and DF_SDG among them.
    const p = normaliseReferenceMetadata("DF_SDG", {
      metadata_attributes: [],
      notes: [],
    });
    expect(p.available).toBe(false);
    expect(p.fields).toHaveLength(0);
    expect(p.note).toMatch(/does not publish reference metadata/);
  });

  it("prefers the gateway's own explanation when it gives one", () => {
    const p = normaliseReferenceMetadata("DF_IMTS", {
      metadata_attributes: [],
      notes: ["The metadata query did not produce a usable result."],
    });
    expect(p.note).toContain("did not produce a usable result");
  });

  it("survives a malformed or empty response", () => {
    expect(normaliseReferenceMetadata("X", null).available).toBe(false);
    expect(normaliseReferenceMetadata("X", {}).fields).toEqual([]);
    expect(
      normaliseReferenceMetadata("X", { metadata_attributes: "nope" }).fields,
    ).toEqual([]);
  });
});
