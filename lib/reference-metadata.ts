/**
 * Reference metadata (provenance) for what a panel actually shows.
 *
 * The gateway's `get_reference_metadata` returns the descriptive material
 * about a dataflow: who compiled it, from what source, how it is processed and
 * revised. This is what turns "here is a chart" into "here is a chart, and here
 * is where the numbers come from".
 *
 * THE QUERY KEY IS THE UNIT, NOT THE DATAFLOW. Asking about a dataflow alone
 * answers from one channel (msd_v2) and returns only what is true of the whole
 * dataset. Passing the panel's own key opens a second channel
 * (dsd_attributes) carrying metadata attached to a slice, a series or an
 * individual observation, and that is where the most useful sourcing lives.
 * Measured over the 26 dataflows Country Snapshots cites (2026-08-03): unkeyed
 * lookups answer for 16, keyed for 23, and the difference is per-country
 * sourcing such as "Report of Fiji Population Census, Fiji Bureau of
 * Statistics".
 *
 * WRITTEN AGAINST THE 2026-08-03 GATEWAY CONTRACT (PRs #22 and #23). Four of
 * its properties drive the code below:
 *
 *  - A non-null `value` no longer means "this describes the dataflow". It is
 *    also filled for `all_observed_rows`, meaning one value that happened to be
 *    identical on every row THIS query returned. Rows outside the query are not
 *    covered by that claim, so the two are kept apart in the UI rather than
 *    both being read as dataset-wide. Presenting the weaker one as the stronger
 *    is the exact failure the gateway change was made to stop.
 *  - Attributes attached below the dataflow arrive `populated` with a null
 *    `value` and `drill_down: true`. Their text has to be fetched separately
 *    through `get_metadata_attribute`. Skipping that step would silently empty
 *    every per-observation citation, which is the most specific material we
 *    have.
 *  - Attributes a provider declares and leaves blank now appear explicitly, as
 *    `declared_empty`. "This provider defines a licence field and published
 *    nothing in it" answers a licensing question; it is kept, apart from the
 *    values, rather than rendered as a blank row or dropped.
 *  - The drill-down reports one of four outcomes in `status`. Two of them,
 *    `declared_empty` and `unestablished`, are identical in the payload apart
 *    from that field and mean opposite things: the provider published nothing,
 *    versus no channel resolved and nothing can be concluded. Branch on
 *    `status`, never on the deprecated `"Error: "` note prefix, which was
 *    order-dependent and marked only one of the four.
 */

/** What a provenance field describes, from most to least specific. */
export type ProvenanceScope = "figure" | "series" | "query" | "dataset";

/** One provenance field, ready to display. */
export interface ProvenanceField {
  id: string;
  label: string;
  text: string;
  scope: ProvenanceScope;
  /** Set when the field is a URL, so the UI can render an anchor. */
  href?: string;
  /** Further distinct values exist, on slices this one does not cover. */
  moreValues?: number;
}

/** An attribute whose text lives behind a `get_metadata_attribute` call. */
export interface PendingAttribute {
  id: string;
  label: string;
  scope: ProvenanceScope;
}

export interface DataflowProvenance {
  dataflowId: string;
  /** The key the answer describes, when the lookup was scoped to one. */
  dataKey?: string;
  /** True when at least one provenance field carries text. */
  available: boolean;
  fields: ProvenanceField[];
  /**
   * Attributes still needing a drill-down call. Resolved server-side before
   * the response reaches the browser, so a client should never see these set.
   */
  pending?: PendingAttribute[];
  /** Labels the provider declares for this dataflow but left blank. */
  declaredEmpty?: string[];
  /**
   * Why there is nothing to show. Absence and an unreadable provider matter
   * differently to someone deciding whether to trust a number, so they are
   * never collapsed into one message.
   */
  note?: string;
}

/**
 * Unwrap a value that still carries its language tag, as `en: "..."`.
 *
 * Defensive, and traceable to a specific upstream defect rather than to the
 * contract: the gateway's localised-value pattern requires `:"` with no space,
 * so a provider writing `en: "..."` falls through unparsed. Measured across the
 * 26 snapshot flows, drill-down values are 8 plain, 0 wrapped without a space,
 * 2 wrapped with one (both DF_HHCOUNTS). Remove this once the gateway pattern
 * tolerates the space. Harmless on already-plain values.
 *
 * The doubled-link workaround this used to carry is gone: PR #23 collapses
 * `https://x (https://x)` upstream, confirmed in both link values and prose.
 */
export function cleanMetadataValue(raw: unknown): string {
  if (typeof raw !== "string") return "";
  const withoutTag = raw.replace(/^\s*[a-z]{2}(-[A-Z]{2})?\s*:\s*(?=")/, "");
  return withoutTag.replace(/^"([\s\S]*)"$/, "$1").trim();
}

/**
 * Provenance fields in reading order, with the ids verified against the live
 * catalogue. Anything not listed here is dropped, which is how structural
 * attributes such as UNIT_MEASURE stay out: they describe the number rather
 * than its origin.
 *
 * DATA_SOURCE_LICENSE is spelled the American way by the provider; the earlier
 * DATA_LICENCE guess matched nothing and never rendered.
 */
const DISPLAY_ORDER: Array<{ id: string; label: string }> = [
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
  { id: "DATA_SOURCE_LINK", label: "Source link" },
];

/**
 * Map the gateway's `scope` onto display scope.
 *
 * `all_observed_rows` becomes "query" rather than "dataset": the provider did
 * not mark it as covering the dataflow, it merely held on every row this query
 * returned. An unrecognised scope is treated as dataset-wide, the weakest
 * claim, so a future scope value can never overstate a citation's specificity.
 */
function scopeOf(scope: string | null | undefined): ProvenanceScope {
  if (scope === "observation") return "figure";
  if (scope === "series" || scope === "partial_key") return "series";
  if (scope === "all_observed_rows") return "query";
  return "dataset";
}

const SCOPE_RANK: Record<ProvenanceScope, number> = {
  figure: 0,
  series: 1,
  query: 2,
  dataset: 3,
};

interface RawAttribute {
  id?: string;
  label?: string | null;
  status?: string;
  scope?: string | null;
  value_kind?: string;
  value?: string | null;
  language?: string | null;
  distinct_values?: number;
  drill_down?: boolean;
}

interface RawResult {
  metadata_attributes?: RawAttribute[];
  coverage?: { declared: number; populated: number; empty: number } | null;
  channels?: Record<string, string>;
  notes?: unknown;
}

const UNESTABLISHED_NOTE =
  "The provider could not be reached for source details, so this is unknown rather than absent.";
const NOTHING_PUBLISHED_NOTE =
  "This dataflow does not publish reference metadata.";

function firstUrl(text: string): string | undefined {
  return /^https?:\/\/\S+$/.test(text) ? text : /https?:\/\/\S+/.exec(text)?.[0];
}

/**
 * `value_kind` is authoritative, with one exception.
 *
 * A value whose entire text is a URL is a link whatever the server calls it.
 * That exception earns its place today: the unparsed `en: "..."` wrapper also
 * defeats URL detection upstream, so SPC's DF_HHCOUNTS source link arrives
 * typed as prose. Trusting `value_kind` alone would render a bare URL as
 * plain text. Safe in general, since a whole-string URL cannot be a date or
 * prose.
 */
function hrefFor(
  text: string,
  valueKind: string | undefined,
): string | undefined {
  if (valueKind === "url") return firstUrl(text) ?? text;
  if (/^https?:\/\/\S+$/.test(text)) return text;
  if (valueKind && valueKind !== "unknown") return undefined;
  return firstUrl(text);
}

/** Most specific first: a source for this figure outranks one for the dataset. */
function sortByScope(fields: ProvenanceField[]) {
  fields.sort((a, b) => SCOPE_RANK[a.scope] - SCOPE_RANK[b.scope]);
}

/**
 * Explain an empty answer, keeping "the provider published nothing" apart from
 * "we could not read the provider".
 *
 * `coverage` is only reported after a complete read, so a null coverage with no
 * channel reporting back means the question is unresolved rather than answered
 * in the negative.
 */
function explainEmpty(r: RawResult): string {
  const notes = Array.isArray(r.notes) ? r.notes : [];
  if (typeof notes[0] === "string" && notes[0]) return notes[0];

  const channels = Object.values(r.channels ?? {});
  const readAnything = channels.some((c) => c === "found" || c === "empty");
  if (r.coverage == null && !readAnything) {
    return UNESTABLISHED_NOTE;
  }
  return NOTHING_PUBLISHED_NOTE;
}

/**
 * Normalise a raw `get_reference_metadata` response for display.
 *
 * `dataKey` is recorded rather than used to filter: the gateway has already
 * scoped the answer to that key, and the caller needs to know which query a
 * citation belongs to when several panels share a dataflow.
 */
export function normaliseReferenceMetadata(
  dataflowId: string,
  raw: unknown,
  dataKey?: string,
): DataflowProvenance {
  const r = (raw ?? {}) as RawResult;
  const attrs = Array.isArray(r.metadata_attributes)
    ? r.metadata_attributes.filter((a) => a && typeof a === "object")
    : [];

  const fields: ProvenanceField[] = [];
  const pending: PendingAttribute[] = [];
  const declaredEmpty: string[] = [];

  for (const spec of DISPLAY_ORDER) {
    const matches = attrs.filter((a) => a?.id === spec.id);
    if (matches.length === 0) continue;
    // Providers may publish the same attribute per language.
    const hit =
      matches.find(
        (a) =>
          a.status === "populated" &&
          (a.language ?? "en").toLowerCase().startsWith("en"),
      ) ??
      matches.find((a) => a.status === "populated") ??
      matches[0];

    const label = hit.label || spec.label;

    if (hit.status !== "populated") {
      // Declared and left blank: a real answer, shown apart from the values.
      declaredEmpty.push(label);
      continue;
    }

    const text = cleanMetadataValue(hit.value);
    if (!text) {
      // Populated below dataflow level: the text needs a drill-down call.
      pending.push({ id: spec.id, label, scope: scopeOf(hit.scope) });
      continue;
    }

    const href = hrefFor(text, hit.value_kind);
    fields.push({
      id: spec.id,
      label,
      text,
      scope: scopeOf(hit.scope),
      ...(href ? { href } : {}),
    });
  }

  sortByScope(fields);

  return {
    dataflowId,
    ...(dataKey ? { dataKey } : {}),
    available: fields.length > 0,
    fields,
    ...(pending.length ? { pending } : {}),
    ...(declaredEmpty.length ? { declaredEmpty } : {}),
    note:
      fields.length === 0 && pending.length === 0 ? explainEmpty(r) : undefined,
  };
}

interface DrillDownResult {
  status?: string;
  values?: Array<{ value?: string | null; language?: string | null }>;
  total?: number;
  distinct_values?: number;
  truncated?: boolean;
  value_kind?: string;
}

/**
 * What a `get_metadata_attribute` call established.
 *
 * Four outcomes, and two of them look identical in the payload apart from
 * `status`: `declared_empty` says the provider published nothing, while
 * `unestablished` says no channel resolved and nothing can be concluded.
 * Rendering the second as the first asserts something we do not know, so they
 * stay apart all the way to the wording a reader sees.
 */
export type DrillDownOutcome =
  | { kind: "value"; field: ProvenanceField }
  | { kind: "declared_empty"; label: string }
  | { kind: "unestablished" }
  | { kind: "unknown_attribute" };

/**
 * Interpret a `get_metadata_attribute` response for a pending attribute.
 *
 * Branches on `status` (PR #23). The deprecated `"Error: "` note prefix is
 * deliberately not consulted: it was order-dependent, and it only ever marked
 * one of the four outcomes.
 */
export function resolveDrillDown(
  attribute: PendingAttribute,
  raw: unknown,
): DrillDownOutcome {
  const d = (raw ?? {}) as DrillDownResult;

  if (d.status === "declared_empty") {
    return { kind: "declared_empty", label: attribute.label };
  }
  // An id we did not ask about cannot happen from a summary-driven call, so
  // treat it as our own bug rather than telling a reader anything.
  if (d.status === "unknown_attribute") return { kind: "unknown_attribute" };
  if (d.status && d.status !== "values") return { kind: "unestablished" };

  const values = Array.isArray(d.values) ? d.values : [];
  const preferred =
    values.find((v) => (v.language ?? "en").toLowerCase().startsWith("en")) ??
    values[0];
  const text = cleanMetadataValue(preferred?.value);
  // `status: "values"` with nothing readable is not an answer about the
  // provider, so it is reported as unestablished rather than as absence.
  if (!text) return { kind: "unestablished" };

  // `distinct_values` counts distinct texts; `total` counts (value, context)
  // pairs. Three countries citing the same source are one answer, and showing
  // the pair count would imply they disagree.
  const distinct = d.distinct_values ?? 1;
  const href = hrefFor(text, d.value_kind);

  return {
    kind: "value",
    field: {
      id: attribute.id,
      label: attribute.label,
      text,
      scope: attribute.scope,
      ...(href ? { href } : {}),
      ...(distinct > 1 ? { moreValues: distinct - 1 } : {}),
    },
  };
}

/** Fold resolved drill-downs into a provenance result. */
export function withResolvedFields(
  provenance: DataflowProvenance,
  outcomes: DrillDownOutcome[],
): DataflowProvenance {
  const fields = [
    ...provenance.fields,
    ...outcomes.flatMap((o) => (o.kind === "value" ? [o.field] : [])),
  ];
  sortByScope(fields);

  const declaredEmpty = [
    ...(provenance.declaredEmpty ?? []),
    ...outcomes.flatMap((o) => (o.kind === "declared_empty" ? [o.label] : [])),
  ];
  const anyUnestablished = outcomes.some((o) => o.kind === "unestablished");

  // Drop `pending`: an internal step the client has no way to act on.
  const rest = { ...provenance };
  delete rest.pending;

  return {
    ...rest,
    fields,
    available: fields.length > 0,
    ...(declaredEmpty.length ? { declaredEmpty } : {}),
    note:
      fields.length > 0
        ? undefined
        : anyUnestablished
          ? UNESTABLISHED_NOTE
          : (provenance.note ?? NOTHING_PUBLISHED_NOTE),
  };
}
