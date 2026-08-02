"use client";

import { useCallback, useState } from "react";
import type {
  DataflowProvenance,
  ProvenanceScope,
} from "@/lib/reference-metadata";

const FAILED: DataflowProvenance = {
  dataflowId: "",
  available: false,
  fields: [],
  note: "Could not load source details.",
};

/**
 * How specific a group of fields is. Shown because the same label means
 * different things at different scopes: "Source" against one observation is a
 * citation for that figure, while "Source" against the dataflow describes the
 * collection it was drawn from.
 */
const SCOPE_HEADING: Record<ProvenanceScope, string> = {
  figure: "For this figure",
  series: "For this series",
  dataset: "For the dataset",
};

const SCOPE_ORDER: ProvenanceScope[] = ["figure", "series", "dataset"];

/**
 * "Where these numbers come from" for one panel.
 *
 * Asked against the panel's own query key, not just its dataflow. That is what
 * makes the answer worth reading: keyed lookups resolve 23 of the 26 dataflows
 * Country Snapshots cites against 16 unkeyed, and the extra material is the
 * per-country sourcing ("Report of Fiji Population Census, Fiji Bureau of
 * Statistics") that a dataflow-level answer cannot express, since one flow
 * collates a different source per country and per indicator.
 *
 * Nothing is fetched until a user opens the block: a lookup costs seconds, and
 * most panels are never asked about.
 */
export function DataflowProvenanceBlock({
  dataflowId,
  dataKey,
  endpoint,
}: {
  dataflowId: string;
  dataKey?: string;
  endpoint?: string;
}) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<DataflowProvenance | null>(null);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const nowOpen = !wasOpen;
      if (nowOpen && !data && !loading) {
        setLoading(true);
        const params = new URLSearchParams({ dataflow: dataflowId });
        if (dataKey) params.set("key", dataKey);
        if (endpoint) params.set("endpoint", endpoint);
        fetch("/api/reference-metadata?" + params.toString())
          .then((r) => (r.ok ? (r.json() as Promise<DataflowProvenance>) : null))
          .then((j) => setData(j ?? { ...FAILED, dataflowId }))
          .catch(() => setData({ ...FAILED, dataflowId }))
          .finally(() => setLoading(false));
      }
      return nowOpen;
    });
  }, [data, loading, dataflowId, dataKey, endpoint]);

  if (!dataflowId) return null;

  const groups = SCOPE_ORDER.map((scope) => ({
    scope,
    fields: (data?.fields ?? []).filter((f) => f.scope === scope),
  })).filter((g) => g.fields.length > 0);

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={toggle}
        className="text-[11px] font-medium text-on-surface-variant underline underline-offset-2 hover:text-on-surface"
        aria-expanded={open}
      >
        {open ? "Hide source details" : "About this data"}
      </button>
      {open && (
        <div className="mt-2 rounded-[var(--radius-md)] bg-surface-high/40 p-3 text-[11px] leading-relaxed">
          {loading && (
            <p className="text-on-surface-variant">Loading source details…</p>
          )}
          {!loading && data && !data.available && (
            <p className="text-on-surface-variant">
              {data.note} The API link opens the exact query behind this panel,
              so every figure can still be checked at the source.
            </p>
          )}
          {!loading &&
            groups.map((group) => (
              <div key={group.scope} className="mb-2 last:mb-0">
                {/* Only worth labelling once more than one scope answered. */}
                {groups.length > 1 && (
                  <p className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant/70">
                    {SCOPE_HEADING[group.scope]}
                  </p>
                )}
                <dl className="space-y-1.5">
                  {group.fields.map((f) => (
                    <div key={f.scope + "-" + f.id}>
                      <dt className="font-semibold text-on-surface-variant">
                        {f.label}
                      </dt>
                      <dd className="text-on-surface">
                        {f.href ? (
                          <a
                            href={f.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="underline underline-offset-2 hover:text-primary"
                          >
                            {f.text}
                          </a>
                        ) : (
                          f.text
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>
            ))}
        </div>
      )}
    </div>
  );
}
