"use client";

import { useEffect, useState } from "react";
import type { DataflowProvenance } from "@/lib/reference-metadata";

/**
 * "Where these numbers come from" for one dataflow.
 *
 * Fetched from /api/reference-metadata, which asks the SDMX gateway for the
 * dataflow's published reference metadata. Renders nothing at all when the
 * provider publishes none — partial coverage is normal, and an empty block
 * would be worse than no block.
 */
export function DataflowProvenanceBlock({
  dataflowId,
  endpoint,
}: {
  dataflowId: string;
  endpoint?: string;
}) {
  const [data, setData] = useState<DataflowProvenance | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams({ dataflow: dataflowId });
    if (endpoint) params.set("endpoint", endpoint);
    fetch("/api/reference-metadata?" + params.toString())
      .then((r) => (r.ok ? r.json() : null))
      .then((j: DataflowProvenance | null) => {
        if (!cancelled) setData(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataflowId, endpoint]);

  if (!data?.available) return null;

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="text-[11px] font-medium text-on-surface-variant underline underline-offset-2 hover:text-on-surface"
        aria-expanded={open}
      >
        {open ? "Hide source details" : "About this data"}
      </button>
      {open && (
        <dl className="mt-2 space-y-1.5 rounded-[var(--radius-md)] bg-surface-high/40 p-3 text-[11px] leading-relaxed">
          {data.fields.map((f) => (
            <div key={f.id}>
              <dt className="font-semibold text-on-surface-variant">
                {f.label}
              </dt>
              <dd className="text-on-surface">{f.text}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}
