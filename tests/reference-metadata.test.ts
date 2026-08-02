import { describe, expect, it } from "vitest";
import {
  cleanMetadataValue,
  normaliseReferenceMetadata,
} from "@/lib/reference-metadata";

// Shapes below are copied from live gateway v1.26.0 responses.
describe("reference metadata", () => {
  it("strips the language tag and quotes from a value", () => {
    expect(cleanMetadataValue('en: "National Statistics Organisations."')).toBe(
      "National Statistics Organisations.",
    );
    expect(cleanMetadataValue('fr-FR: "Recensement"')).toBe("Recensement");
    expect(cleanMetadataValue("plain text")).toBe("plain text");
    expect(cleanMetadataValue(undefined)).toBe("");
  });

  it("normalises a dataflow that publishes provenance", () => {
    const raw = {
      metadata_attributes: [
        {
          id: "DATA_SOURCE_ORGANIZATION",
          label: "Source organisation",
          value: 'en: "National Statistics Organisations."',
          level: "dataflow",
        },
        {
          id: "DATA_REVISION",
          label: "Revision",
          value: 'en: "Data is subject to revision."',
          level: "dataflow",
        },
        { id: "UNIT_MEASURE", label: null, value: "KM2", level: "series" },
      ],
      notes: [],
    };
    const p = normaliseReferenceMetadata("DF_NATIONAL_ACCOUNTS", raw);

    expect(p.available).toBe(true);
    expect(p.fields.map((f) => f.id)).toEqual([
      "DATA_SOURCE_ORGANIZATION",
      "DATA_REVISION",
    ]);
    expect(p.fields[0].text).toBe("National Statistics Organisations.");
    // Structural attributes like UNIT_MEASURE are not provenance.
    expect(p.fields.some((f) => f.id === "UNIT_MEASURE")).toBe(false);
  });

  it("reports absence distinctly from failure, with the gateway note", () => {
    const p = normaliseReferenceMetadata("DF_IMTS", {
      metadata_attributes: [],
      notes: ["The metadata query did not produce a usable result."],
    });
    expect(p.available).toBe(false);
    expect(p.fields).toHaveLength(0);
    expect(p.note).toContain("did not produce a usable result");
  });

  it("survives a malformed or empty response", () => {
    expect(normaliseReferenceMetadata("X", null).available).toBe(false);
    expect(normaliseReferenceMetadata("X", {}).fields).toEqual([]);
  });
});
