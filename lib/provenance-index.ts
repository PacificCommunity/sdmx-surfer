import indexData from "@/data/provenance-index.json";
import type { DataflowProvenance } from "@/lib/reference-metadata";

/**
 * Static provenance index, swept from the gateway by
 * `npm run build:provenance` and committed.
 *
 * Two measured facts make this worth precomputing rather than looking up live:
 *
 *  1. Only about half the SPC catalogue publishes anything displayable (69 of
 *     127 as of 2026-08-03), and the half that publishes nothing is precisely
 *     the indicator families the app leans on: every DF_SDG_*, every DF_BP50_*,
 *     every DF_NMDI_*. A live design cannot know which case it is without
 *     paying for the call, so it ends up offering an "About this data" control
 *     on rows where opening it yields nothing.
 *  2. A live lookup costs p50 3.6s, p90 7.5s, and opens a fresh MCP session.
 *
 * Reference metadata is editorial and moves on the scale of months, so a
 * committed index is accurate for far longer than it is stale. Anything the
 * index does not know about (other endpoints, a flow added since the last
 * sweep) still resolves live.
 */

interface IndexFile {
  builtAt: string;
  endpoints: Record<string, Record<string, DataflowProvenance>>;
}

const index = indexData as unknown as IndexFile;

/** When the committed index was swept. Surfaced by the admin panel. */
export const provenanceIndexBuiltAt: string = index.builtAt ?? "";

/** The default endpoint an unqualified request refers to. */
const DEFAULT_ENDPOINT = "SPC";

/**
 * What the index knows about a dataflow.
 *
 *   entry  — a swept result, ready to serve without touching the gateway
 *   null   — the index covers this endpoint but not this flow, or covers no
 *            such endpoint: the caller should look it up live
 */
export function lookupProvenance(
  dataflowId: string,
  endpoint?: string,
): DataflowProvenance | null {
  const key = endpoint?.trim() || DEFAULT_ENDPOINT;
  return index.endpoints?.[key]?.[dataflowId] ?? null;
}

/** Endpoints covered by the committed sweep. */
export function indexedEndpoints(): string[] {
  return Object.keys(index.endpoints ?? {});
}

/** Coverage counts, for the admin panel and for tests to assert against. */
export function provenanceCoverage(endpoint?: string): {
  total: number;
  withProvenance: number;
} {
  const key = endpoint?.trim() || DEFAULT_ENDPOINT;
  const entries = Object.values(index.endpoints?.[key] ?? {});
  return {
    total: entries.length,
    withProvenance: entries.filter((e) => e.available).length,
  };
}
