import { describe, expect, it } from "vitest";
import {
  cleanMetadataValue,
  fieldFromDrillDown,
  normaliseReferenceMetadata,
  withResolvedFields,
} from "@/lib/reference-metadata";

// Attribute shapes copied from live SPC responses on the 2026-08-03 gateway
// contract: `status`/`scope`/`value_kind`, and a null `value` wherever the text
// sits behind a drill-down call.
const attr = (
  id: string,
  value: string | null,
  extra: Record<string, unknown> = {},
) => ({
  id,
  path: id,
  label: null,
  status: "populated",
  scope: "dataflow",
  value_kind: "prose",
  distinct_values: 1,
  value,
  language: "en",
  sample_key_context: null,
  drill_down: false,
  ...extra,
});

const blank = (id: string) => ({
  id,
  path: id,
  label: null,
  status: "declared_empty",
  scope: null,
  value_kind: "unknown",
  distinct_values: 0,
  value: null,
  language: null,
  sample_key_context: null,
  drill_down: false,
});

describe("cleanMetadataValue", () => {
  it("passes plain values through untouched", () => {
    expect(cleanMetadataValue("National Statistics Offices (NSO)")).toBe(
      "National Statistics Offices (NSO)",
    );
    // A colon inside prose must survive; only a language tag is stripped.
    expect(cleanMetadataValue("Note: figures are provisional")).toBe(
      "Note: figures are provisional",
    );
    expect(cleanMetadataValue(undefined)).toBe("");
    expect(cleanMetadataValue(null)).toBe("");
  });

  it("strips the inlined language tag the MSD channel uses", () => {
    expect(cleanMetadataValue('en: "National Statistics Organisations."')).toBe(
      "National Statistics Organisations.",
    );
    expect(cleanMetadataValue('fr-FR: "Recensement"')).toBe("Recensement");
  });

  it("collapses a link the provider repeated as a parenthetical", () => {
    expect(
      cleanMetadataValue("https://statsfiji.gov.fj/x (https://statsfiji.gov.fj/x)"),
    ).toBe("https://statsfiji.gov.fj/x");
    // A parenthetical that says something different is left alone.
    expect(cleanMetadataValue("See https://a.org/x (accessed 2026)")).toBe(
      "See https://a.org/x (accessed 2026)",
    );
  });
});

describe("normaliseReferenceMetadata", () => {
  it("reads dataflow-scoped values in reading order", () => {
    const p = normaliseReferenceMetadata("DF_CPI", {
      metadata_attributes: [
        attr("DATA_COMMENT", 'en: "The CPI measures a representative basket."'),
        attr("DATA_SOURCE_ORGANIZATION", 'en: "National Statistics Offices"'),
        attr("DATA_PROCESSING", 'en: "Compiled per the CPI Manual."'),
      ],
      coverage: { declared: 9, populated: 3, empty: 6 },
      channels: { msd_v2: "found", dsd_attributes: "skipped" },
    });

    expect(p.available).toBe(true);
    expect(p.fields.map((f) => f.id)).toEqual([
      "DATA_SOURCE_ORGANIZATION",
      "DATA_PROCESSING",
      "DATA_COMMENT",
    ]);
    expect(p.fields.every((f) => f.scope === "dataset")).toBe(true);
    expect(p.note).toBeUndefined();
  });

  it("does not present all_observed_rows as a dataflow-wide claim", () => {
    // The distinction the gateway change exists to preserve: this value held
    // on the rows the query returned, and says nothing about the rest.
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE", "UNSD", {
          scope: "all_observed_rows",
          drill_down: true,
        }),
        attr("DATA_PROCESSING", "Compiled centrally.", { scope: "dataflow" }),
      ],
    });
    expect(p.fields.map((f) => [f.id, f.scope])).toEqual([
      ["DATA_SOURCE", "query"],
      ["DATA_PROCESSING", "dataset"],
    ]);
  });

  it("defers attributes whose text needs a drill-down", () => {
    // DF_VITAL: populated at observation scope, value withheld from the summary.
    const p = normaliseReferenceMetadata(
      "DF_VITAL",
      {
        metadata_attributes: [
          attr("UNIT_MEASURE", null, { scope: "series", drill_down: true }),
          attr("DATA_SOURCE", null, { scope: "observation", drill_down: true }),
        ],
        channels: { msd_v2: "inconclusive", dsd_attributes: "found" },
      },
      "A.FJ.LEB.M+F",
    );

    expect(p.pending).toEqual([
      { id: "DATA_SOURCE", label: "Source", scope: "figure" },
    ]);
    expect(p.fields).toHaveLength(0);
    // Not "no metadata": the text is pending, so no absence note is emitted.
    expect(p.note).toBeUndefined();
    expect(p.dataKey).toBe("A.FJ.LEB.M+F");
    // UNIT_MEASURE is structural and never becomes a provenance field.
    expect(p.pending?.some((f) => f.id === "UNIT_MEASURE")).toBe(false);
  });

  it("keeps declared-but-blank fields apart from values", () => {
    const p = normaliseReferenceMetadata("DF_POP_PROJ", {
      metadata_attributes: [
        attr("DATA_SOURCE_TITLE", 'en: "Census of Population and Housing"'),
        blank("DATA_SOURCE_LICENSE"),
        blank("DATA_SOURCE_DATE"),
      ],
      coverage: { declared: 9, populated: 3, empty: 6 },
    });
    expect(p.fields.map((f) => f.id)).toEqual(["DATA_SOURCE_TITLE"]);
    // Reported in display order, so "Collected" precedes "Licence".
    expect(p.declaredEmpty).toEqual(["Collected", "Licence"]);
    expect(p.available).toBe(true);
  });

  it("uses value_kind rather than guessing at links", () => {
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE_LINK", "https://stats.pacificdata.org/", {
          value_kind: "url",
        }),
        // A date must not be linkified even if it looks unusual.
        attr("DATA_SOURCE_DATE", "2026-03-01", { value_kind: "date" }),
      ],
    });
    const link = p.fields.find((f) => f.id === "DATA_SOURCE_LINK");
    const date = p.fields.find((f) => f.id === "DATA_SOURCE_DATE");
    expect(link?.href).toBe("https://stats.pacificdata.org/");
    expect(date?.href).toBeUndefined();
  });

  it("treats an unrecognised scope as the weakest claim", () => {
    const p = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [attr("DATA_SOURCE", "X", { scope: "something_new" })],
    });
    expect(p.fields[0].scope).toBe("dataset");
  });

  it("separates an unreadable provider from one publishing nothing", () => {
    const unreachable = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [],
      coverage: null,
      channels: { msd_v2: "inconclusive", dsd_attributes: "inconclusive" },
    });
    expect(unreachable.note).toMatch(/unknown rather than absent/);

    const genuinelyEmpty = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [],
      coverage: { declared: 0, populated: 0, empty: 0 },
      channels: { msd_v2: "empty", dsd_attributes: "empty" },
    });
    expect(genuinelyEmpty.note).toMatch(/does not publish/);
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

describe("drill-down resolution", () => {
  const pendingSource = {
    id: "DATA_SOURCE",
    label: "Source",
    scope: "figure" as const,
  };

  it("recovers the per-observation citation", () => {
    const f = fieldFromDrillDown(pendingSource, {
      value_kind: "prose",
      values: [
        {
          value: "Report of Fiji Population Census, Fiji Bureau of Statistics",
          key_context: null,
          language: null,
        },
      ],
      total: 1,
      truncated: false,
      notes: [],
    });
    expect(f).toMatchObject({
      id: "DATA_SOURCE",
      scope: "figure",
      text: "Report of Fiji Population Census, Fiji Bureau of Statistics",
    });
    expect(f?.moreValues).toBeUndefined();
  });

  it("counts distinct texts, not value/key pairs", () => {
    // Three slices sharing one text is one answer, not three.
    const same = fieldFromDrillDown(pendingSource, {
      values: [
        { value: "Census 2017" },
        { value: "Census 2017" },
        { value: "Census 2017" },
      ],
      total: 3,
    });
    expect(same?.moreValues).toBeUndefined();

    const differing = fieldFromDrillDown(pendingSource, {
      values: [{ value: "Census 2017" }, { value: "HIES 2003" }],
      total: 2,
    });
    expect(differing?.moreValues).toBe(1);
  });

  it("refuses to render an unreadable attribute as a value", () => {
    // The tool has no error field: an Error note is the only signal, and
    // showing it as text would present a failure as provenance.
    expect(
      fieldFromDrillDown(pendingSource, {
        values: [],
        total: 0,
        notes: ["Error: no such attribute. Declared ids are DATA_COMMENT."],
      }),
    ).toBeNull();
  });

  it("returns nothing for a declared but blank attribute", () => {
    expect(
      fieldFromDrillDown(pendingSource, {
        values: [],
        total: 0,
        notes: ["This attribute is declared and carries no values."],
      }),
    ).toBeNull();
  });

  it("prefers the English value when several languages are published", () => {
    const f = fieldFromDrillDown(pendingSource, {
      values: [
        { value: "Recensement", language: "fr" },
        { value: "Census", language: "en" },
      ],
      total: 2,
    });
    expect(f?.text).toBe("Census");
  });

  it("merges resolved fields most-specific first and clears pending", () => {
    const summary = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_PROCESSING", "Compiled centrally.", { scope: "dataflow" }),
        attr("DATA_SOURCE", null, { scope: "observation", drill_down: true }),
      ],
    });
    const resolved = fieldFromDrillDown(summary.pending![0], {
      values: [{ value: "HIES - Fiji 2003" }],
      total: 1,
    })!;

    const merged = withResolvedFields(summary, [resolved]);
    expect(merged.pending).toBeUndefined();
    expect(merged.available).toBe(true);
    expect(merged.fields.map((f) => f.scope)).toEqual(["figure", "dataset"]);
  });

  it("reports absence when every drill-down failed", () => {
    const summary = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE", null, { scope: "observation", drill_down: true }),
      ],
    });
    const merged = withResolvedFields(summary, []);
    expect(merged.available).toBe(false);
    expect(merged.note).toBeTruthy();
  });
});
