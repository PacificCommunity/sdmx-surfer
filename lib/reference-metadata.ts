/**
 * Reference metadata (provenance) for what a panel actually shows.
 *
 * The gateway's `get_reference_metadata` returns the descriptive material
 * about a dataflow — who compiled it, from what source, how it is processed
 * and revised — as opposed to its structure. This is what turns "here is a
 * chart" into "here is a chart, and here is where the numbers come from".
 *
 * THE QUERY KEY IS THE UNIT, NOT THE DATAFLOW. Asking about a dataflow alone
 * answers from one channel (msd_v2) and returns only what is true of the whole
 * dataset. Passing the panel's own key opens a second channel
 * (dsd_attributes) carrying metadata attached to the slice, the series, or the
 * individual observation, and that is where the most useful sourcing lives.
 *
 * Measured over the 26 dataflows Country Snapshots cites (2026-08-03):
 * unkeyed lookups answer for 16, keyed lookups answer for 23. The difference
 * is entirely observation-level and partial-key attributes, and their values
 * are the specific provenance a reader wants: "Report of Fiji Population
 * Census, Fiji Bureau of Statistics", "HIES - Fiji 2003". A dataflow-level
 * answer could never say that, because the same flow collates a different
 * source per country and per indicator.
 *
 * Scope is therefore carried through to the UI rather than flattened: a reader
 * needs to know whether "compiled by X" describes this figure or the dataset
 * it sits in.
 */

/** What a provenance field describes, from most to least specific. */
export type ProvenanceScope = "figure" | "series" | "dataset";

/** One provenance field, ready to display. */
export interface ProvenanceField {
  id: string;
  label: string;
  text: string;
  scope: ProvenanceScope;
  /** Set when the field is a URL, so the UI can render an anchor. */
  href?: string;
}

export interface DataflowProvenance {
  dataflowId: string;
  /** The key the answer describes, when the lookup was scoped to one. */
  dataKey?: string;
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
  // Providers commonly render a link as "https://x (https://x)". Keep one.
  const deduped = unquoted.replace(
    /(https?:\/\/[^\s()]+)\s*\(\1\)/g,
    "$1",
  );
  return deduped.trim();
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
  { id: "OBS_COMMENT", label: "Note on this figure" },
  { id: "DATA_COMMENT", label: "Notes" },
  { id: "DATA_SOURCE_LINK", label: "Source link", link: true },
];

/**
 * Map the gateway's attachment levels onto display scope.
 *
 * `partial_key` means the attribute is attached to a slice of the cube rather
 * than to one cell, which is a series statement for our purposes. Levels we do
 * not recognise are treated as dataset-wide, the weakest claim, so an unknown
 * level can never overstate how specific a citation is.
 */
function scopeOf(level: string | undefined): ProvenanceScope {
  if (level === "observation") return "figure";
  if (level === "series" || level === "partial_key") return "series";
  return "dataset";
}

const SCOPE_RANK: Record<ProvenanceScope, number> = {
  figure: 0,
  series: 1,
  dataset: 2,
};

interface RawAttribute {
  id?: string;
  label?: string | null;
  value?: unknown;
  values?: unknown[];
  language?: string | null;
  level?: string;
}

function firstUrl(text: string): string | undefined {
  return /^https?:\/\/\S+$/.test(text) ? text : /https?:\/\/\S+/.exec(text)?.[0];
}

/**
 * Normalise a raw `get_reference_metadata` response for display.
 *
 * `dataKey` is recorded on the result, not used to filter it: the gateway has
 * already scoped the answer to that key, and the caller needs to know which
 * query the citation belongs to when several panels share a dataflow.
 */
export function normaliseReferenceMetadata(
  dataflowId: string,
  raw: unknown,
  dataKey?: string,
): DataflowProvenance {
  const r = (raw ?? {}) as {
    metadata_attributes?: RawAttribute[];
    notes?: unknown;
  };
  const attrs = Array.isArray(r.metadata_attributes)
    ? r.metadata_attributes.filter((a) => a && typeof a === "object")
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
      scope: scopeOf(hit.level),
      ...(href ? { href } : {}),
    });
  }

  // Most specific first: a source attached to this observation outranks one
  // describing the dataset, and is what a reader is actually citing.
  fields.sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);

  const notes = Array.isArray(r.notes) ? r.notes : [];
  return {
    dataflowId,
    ...(dataKey ? { dataKey } : {}),
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
