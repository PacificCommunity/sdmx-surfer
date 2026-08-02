/**
 * Reference metadata (provenance) for a dataflow.
 *
 * The gateway's `get_reference_metadata` returns the descriptive material
 * about a dataflow — who compiled it, from what source, how it is processed
 * and revised — as opposed to its structure. This is what turns "here is a
 * chart" into "here is a chart, and here is where the numbers come from".
 *
 * Coverage varies by provider: the response reports which channels answered,
 * so "this dataflow has no published metadata" is distinguishable from "the
 * lookup failed". Callers should render the former quietly and not retry.
 */

/** One provenance field, ready to display. */
export interface ProvenanceField {
  id: string;
  label: string;
  text: string;
}

export interface DataflowProvenance {
  dataflowId: string;
  /** True when at least one metadata field was found. */
  available: boolean;
  fields: ProvenanceField[];
  /** Gateway note when nothing was found (absent vs. unanswerable). */
  note?: string;
}

/**
 * Values arrive language-tagged, e.g. `en: "National Statistics
 * Organisations."`. Prefer English, fall back to the first tag present, and
 * strip the surrounding quotes.
 */
export function cleanMetadataValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const withoutTag = raw.replace(/^\s*[a-z]{2}(-[A-Z]{2})?\s*:\s*/, "");
  const unquoted = withoutTag.replace(/^"([\s\S]*)"$/, "$1");
  return unquoted.trim();
}

/** Fields worth showing, in display order. Anything else is dropped. */
const DISPLAY_ORDER: Record<string, string> = {
  DATA_SOURCE_TITLE: "Source",
  DATA_SOURCE_ORGANIZATION: "Source organisation",
  DATA_PROCESSING: "How it is compiled",
  DATA_REVISION: "Revision policy",
  DATA_COMMENT: "Note",
  DATA_LICENCE: "Licence",
  DATA_LICENSE: "Licence",
};

interface RawAttribute {
  id?: string;
  label?: string | null;
  value?: unknown;
  values?: unknown[];
  level?: string;
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
  const attrs = Array.isArray(r.metadata_attributes) ? r.metadata_attributes : [];

  const fields: ProvenanceField[] = [];
  for (const key of Object.keys(DISPLAY_ORDER)) {
    const hit = attrs.find((a) => a?.id === key);
    if (!hit) continue;
    const text = cleanMetadataValue(
      hit.value ?? (Array.isArray(hit.values) ? hit.values[0] : undefined),
    );
    if (!text) continue;
    fields.push({ id: key, label: hit.label || DISPLAY_ORDER[key], text });
  }

  const notes = Array.isArray(r.notes) ? r.notes : [];
  return {
    dataflowId,
    available: fields.length > 0,
    fields,
    note:
      fields.length === 0 && typeof notes[0] === "string"
        ? (notes[0] as string)
        : undefined,
  };
}
