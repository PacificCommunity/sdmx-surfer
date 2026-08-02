/**
 * Reference metadata (provenance) for a dataflow.
 *
 * The gateway's `get_reference_metadata` returns the descriptive material
 * about a dataflow — who compiled it, from what source, how it is processed
 * and revised — as opposed to its structure. This is what turns "here is a
 * chart" into "here is a chart, and here is where the numbers come from".
 *
 * COVERAGE IS PARTIAL AND UNEVENLY DISTRIBUTED. Surveyed across all 127 SPC
 * dataflows (2026-08-03): 118 carry at least one attribute, 9 carry none.
 * The empty set is not a random tail — it includes DF_BP50 and DF_SDG, two of
 * the most-cited flows in the app. So "no provenance" has to be a first-class
 * outcome with its own wording, never an empty panel or a missing control.
 *
 * Field frequency from that survey, which is what DISPLAY_ORDER is built on:
 *   DATA_SOURCE_TITLE 74, DATA_COMMENT 71, DATA_SOURCE_ORGANIZATION 63,
 *   DATA_PROCESSING 61, DATA_SOURCE_LINK 50, DATA_REVISION 36,
 *   DATA_SOURCE_DATE 34, DATA_SOURCE_COMMENT 30, DATA_SOURCE 12,
 *   DATA_SOURCE_LICENSE 9.
 * Series-level attributes (UNIT_MEASURE, OBS_COMMENT, NATURE) also appear;
 * they describe observations rather than provenance and are dropped.
 */

/** One provenance field, ready to display. */
export interface ProvenanceField {
  id: string;
  label: string;
  text: string;
  /** Set when the field is a URL, so the UI can render an anchor. */
  href?: string;
}

export interface DataflowProvenance {
  dataflowId: string;
  /** True when at least one provenance field was found. */
  available: boolean;
  fields: ProvenanceField[];
  /**
   * Why there is nothing to show. Distinguishes "this provider publishes no
   * metadata for this flow" from "the lookup failed", which matter differently
   * to a user deciding whether to trust a number.
   */
  note?: string;
}

/**
 * Values normally arrive plain, with the language in a sibling `language`
 * field. Some gateway paths inline the tag instead, as `en: "..."`. Strip that
 * form when present and unwrap surrounding quotes.
 */
export function cleanMetadataValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const withoutTag = raw.replace(/^\s*[a-z]{2}(-[A-Z]{2})?\s*:\s*(?=")/, "");
  const unquoted = withoutTag.replace(/^"([\s\S]*)"$/, "$1");
  return unquoted.trim();
}

/**
 * Provenance fields in reading order, with the ids verified against the live
 * catalogue. Anything not listed here is dropped.
 *
 * DATA_SOURCE_LICENSE is spelled the American way by the provider; the earlier
 * DATA_LICENCE/DATA_LICENSE guesses matched nothing and never rendered.
 */
const DISPLAY_ORDER: Array<{ id: string; label: string; link?: boolean }> = [
  { id: "DATA_SOURCE_TITLE", label: "Source" },
  { id: "DATA_SOURCE", label: "Source" },
  { id: "DATA_SOURCE_ORGANIZATION", label: "Compiled by" },
  { id: "DATA_SOURCE_DATE", label: "Collected" },
  { id: "DATA_SOURCE_COMMENT", label: "About the source" },
  { id: "DATA_PROCESSING", label: "How it is compiled" },
  { id: "DATA_REVISION", label: "Revision policy" },
  { id: "DATA_SOURCE_LICENSE", label: "Licence" },
  { id: "DATA_COMMENT", label: "Notes" },
  { id: "DATA_SOURCE_LINK", label: "Source link", link: true },
];

interface RawAttribute {
  id?: string;
  label?: string | null;
  value?: unknown;
  values?: unknown[];
  language?: string | null;
  level?: string;
}

/** Dataflow-level attributes describe the flow; deeper ones describe a cell. */
function isDataflowLevel(a: RawAttribute): boolean {
  return !a.level || a.level === "dataflow";
}

function firstUrl(text: string): string | undefined {
  return /^https?:\/\/\S+$/.test(text) ? text : /https?:\/\/\S+/.exec(text)?.[0];
}

/** Normalise a raw `get_reference_metadata` response for display. */
export function normaliseReferenceMetadata(
  dataflowId: string,
  raw: unknown,
): DataflowProvenance {
  const r = (raw ?? {}) as {
    metadata_attributes?: RawAttribute[];
    notes?: unknown;
  };
  const attrs = Array.isArray(r.metadata_attributes)
    ? r.metadata_attributes.filter(
        (a) => a && typeof a === "object" && isDataflowLevel(a),
      )
    : [];

  const fields: ProvenanceField[] = [];
  for (const spec of DISPLAY_ORDER) {
    const matches = attrs.filter((a) => a?.id === spec.id);
    if (matches.length === 0) continue;
    // Providers may publish the same attribute per language.
    const hit =
      matches.find((a) => (a.language ?? "en").toLowerCase().startsWith("en")) ??
      matches[0];
    const text = cleanMetadataValue(
      hit.value ?? (Array.isArray(hit.values) ? hit.values[0] : undefined),
    );
    if (!text) continue;
    const href = spec.link ? firstUrl(text) : undefined;
    fields.push({
      id: spec.id,
      label: hit.label || spec.label,
      text,
      ...(href ? { href } : {}),
    });
  }

  const notes = Array.isArray(r.notes) ? r.notes : [];
  return {
    dataflowId,
    available: fields.length > 0,
    fields,
    note:
      fields.length === 0
        ? typeof notes[0] === "string"
          ? (notes[0] as string)
          : "This dataflow does not publish reference metadata."
        : undefined,
  };
}
