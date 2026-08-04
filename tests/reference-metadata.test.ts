import { describe, expect, it } from "vitest";
import {
  cleanMetadataValue,
  resolveDrillDown,
  normaliseReferenceMetadata,
  withResolvedFields,
} from "@/lib/reference-metadata";

// Attribute shapes copied from live SPC responses on the 2026-08-03 gateway
// contract: `status`/`scope`/`value_kind`, values already parsed, and a null
// `value` wherever the text sits behind a drill-down call.
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

  it("leaves parsing to the gateway", () => {
    // Language wrappers, markup and doubled links are all resolved upstream.
    // Anything of that shape arriving here is a gateway bug to report rather
    // than one to paper over, so these pass through untouched.
    expect(cleanMetadataValue("https://a.org/x (https://a.org/x)")).toBe(
      "https://a.org/x (https://a.org/x)",
    );
    expect(cleanMetadataValue('en: "Recensement"')).toBe('en: "Recensement"');
    // Anchor text that genuinely differs keeps its parenthetical URL.
    expect(cleanMetadataValue("Census 2017 (https://a.org/x)")).toBe(
      "Census 2017 (https://a.org/x)",
    );
  });
});

describe("normaliseReferenceMetadata", () => {
  it("reads dataflow-scoped values in reading order", () => {
    const p = normaliseReferenceMetadata("DF_CPI", {
      metadata_attributes: [
        attr("DATA_COMMENT", "The CPI measures a representative basket."),
        attr("DATA_SOURCE_ORGANIZATION", "National Statistics Offices"),
        attr("DATA_PROCESSING", "Compiled per the CPI Manual."),
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
        attr("DATA_SOURCE_TITLE", "Census of Population and Housing"),
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

  it("links a bare URL whatever value_kind claims", () => {
    const p = normaliseReferenceMetadata("DF_HHCOUNTS", {
      metadata_attributes: [
        attr("DATA_SOURCE_LINK", "https://www.statsfiji.gov.fj/x", {
          value_kind: "prose",
        }),
      ],
    });
    expect(p.fields[0].href).toBe("https://www.statsfiji.gov.fj/x");
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
    const o = resolveDrillDown(pendingSource, {
      status: "values",
      value_kind: "prose",
      values: [
        {
          value: "Report of Fiji Population Census, Fiji Bureau of Statistics",
          key_context: null,
          language: null,
        },
      ],
      total: 1,
      distinct_values: 1,
      truncated: false,
      notes: ["This attribute came from the DSD-attribute channel."],
    });
    expect(o).toMatchObject({
      kind: "value",
      field: {
        id: "DATA_SOURCE",
        scope: "figure",
        text: "Report of Fiji Population Census, Fiji Bureau of Statistics",
      },
    });
    expect(o.kind === "value" && o.field.moreValues).toBeUndefined();
  });

  it("counts distinct texts from distinct_values, never from total", () => {
    // Three slices carrying one answer. Reporting the pair count would say the
    // three countries disagree about their source when they agree.
    const same = resolveDrillDown(pendingSource, {
      status: "values",
      values: [{ value: "UNSD" }, { value: "UNSD" }, { value: "UNSD" }],
      total: 3,
      distinct_values: 1,
    });
    expect(same.kind === "value" && same.field.moreValues).toBeUndefined();

    const differing = resolveDrillDown(pendingSource, {
      status: "values",
      values: [{ value: "Census 2017" }, { value: "HIES 2003" }],
      total: 2,
      distinct_values: 2,
    });
    expect(differing.kind === "value" && differing.field.moreValues).toBe(1);
  });

  it("stays truthful when the value list was truncated", () => {
    // distinct_values is computed over the full uncapped set, so it remains
    // correct even though `values` was capped.
    const o = resolveDrillDown(pendingSource, {
      status: "values",
      values: [{ value: "Source A" }, { value: "Source B" }],
      total: 200,
      distinct_values: 12,
      truncated: true,
    });
    expect(o.kind === "value" && o.field.moreValues).toBe(11);
  });

  it("separates declared_empty from unestablished", () => {
    // The pair that matters: both carry total 0 and they mean opposite things.
    const declared = resolveDrillDown(pendingSource, {
      status: "declared_empty",
      values: [],
      total: 0,
      distinct_values: 0,
      notes: ["'DATA_SOURCE' is declared and the provider published no value."],
    });
    expect(declared).toEqual({ kind: "declared_empty", label: "Source" });

    const unestablished = resolveDrillDown(pendingSource, {
      status: "unestablished",
      values: [],
      total: 0,
      distinct_values: 0,
      notes: ["No channel resolved."],
    });
    expect(unestablished).toEqual({ kind: "unestablished" });
  });

  it("does not read the deprecated Error: note prefix", () => {
    // status is the signal. A note beginning "Error:" alongside a values
    // status must not turn a real answer into a failure, and the prefix was
    // never guaranteed to come first.
    const o = resolveDrillDown(pendingSource, {
      status: "values",
      values: [{ value: "HIES - Fiji 2003" }],
      total: 1,
      distinct_values: 1,
      notes: ["Error: something legacy", "and an explanation"],
    });
    expect(o.kind).toBe("value");

    const unknown = resolveDrillDown(pendingSource, {
      status: "unknown_attribute",
      values: [],
      total: 0,
      notes: ["Error: Unknown attribute 'DATA_SOURC' for DF_X: declared are ..."],
    });
    expect(unknown).toEqual({ kind: "unknown_attribute" });
  });

  it("treats a values status with nothing readable as unestablished", () => {
    expect(
      resolveDrillDown(pendingSource, { status: "values", values: [], total: 0 }),
    ).toEqual({ kind: "unestablished" });
  });

  it("prefers the English value when several languages are published", () => {
    const o = resolveDrillDown(pendingSource, {
      status: "values",
      values: [
        { value: "Recensement", language: "fr" },
        { value: "Census", language: "en" },
      ],
      total: 2,
      distinct_values: 2,
    });
    expect(o.kind === "value" && o.field.text).toBe("Census");
  });

  it("merges resolved fields most-specific first and clears pending", () => {
    const summary = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_PROCESSING", "Compiled centrally.", { scope: "dataflow" }),
        attr("DATA_SOURCE", null, { scope: "observation", drill_down: true }),
      ],
    });
    const outcome = resolveDrillDown(summary.pending![0], {
      status: "values",
      values: [{ value: "HIES - Fiji 2003" }],
      total: 1,
      distinct_values: 1,
    });

    const merged = withResolvedFields(summary, [outcome]);
    expect(merged.pending).toBeUndefined();
    expect(merged.available).toBe(true);
    expect(merged.fields.map((f) => f.scope)).toEqual(["figure", "dataset"]);
  });

  it("folds a declared_empty drill-down into the blank list", () => {
    const summary = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE", null, { scope: "observation", drill_down: true }),
      ],
    });
    const merged = withResolvedFields(summary, [
      { kind: "declared_empty", label: "Source" },
    ]);
    expect(merged.declaredEmpty).toEqual(["Source"]);
    expect(merged.available).toBe(false);
    expect(merged.note).toMatch(/does not publish/);
  });

  it("never reports an unestablished drill-down as absence", () => {
    // The failure the status field exists to prevent: saying the provider
    // publishes nothing when we simply could not read it.
    const summary = normaliseReferenceMetadata("DF_X", {
      metadata_attributes: [
        attr("DATA_SOURCE", null, { scope: "observation", drill_down: true }),
      ],
    });
    const merged = withResolvedFields(summary, [{ kind: "unestablished" }]);
    expect(merged.available).toBe(false);
    expect(merged.note).toMatch(/unknown rather than absent/);
    expect(merged.note).not.toMatch(/does not publish/);
  });
});
