"use client";

import { useCallback, useEffect, useState } from "react";
import type { DataflowProvenance } from "@/lib/reference-metadata";

type Probe = DataflowProvenance & { status?: "unknown" };

const FAILED: DataflowProvenance = {
  dataflowId: "",
  available: false,
  fields: [],
  note: "Could not load source details.",
};

/**
 * "Where these numbers come from" for one dataflow.
 *
 * Coverage is the constraint that shapes this. Across the SPC catalogue only
 * 69 of 127 dataflows publish anything displayable, and the 58 that publish
 * nothing include every DF_SDG_*, every DF_BP50_* and every DF_NMDI_* — the
 * families the snapshots lean on hardest. An always-visible "About this data"
 * control would therefore open onto nothing on most snapshot rows, which is
 * worse than not offering it: a missing provenance block reads as unsourced
 * data, when in fact the API link beside it is the direct source.
 *
 * So the control appears only where there is something behind it. On mount the
 * component probes /api/reference-metadata?probe=1, which answers from the
 * committed index without touching the gateway. Flows the index does not cover
 * (other endpoints, newly added flows) come back "unknown"; those keep the
 * control and resolve live when a user actually opens it, since a live lookup
 * costs seconds and most rows would never be opened.
 */
export function DataflowProvenanceBlock({
  dataflowId,
  endpoint,
}: {
  dataflowId: string;
  endpoint?: string;
}) {
  const [probe, setProbe] = useState<Probe | null>(null);
  const [open, setOpen] = useState(false);
  const [full, setFull] = useState<DataflowProvenance | null>(null);
  const [loading, setLoading] = useState(false);

  const query = useCallback(
    (probeOnly: boolean) => {
      const params = new URLSearchParams({ dataflow: dataflowId });
      if (endpoint) params.set("endpoint", endpoint);
      if (probeOnly) params.set("probe", "1");
      return fetch("/api/reference-metadata?" + params.toString()).then((r) =>
        r.ok ? (r.json() as Promise<Probe>) : null,
      );
    },
    [dataflowId, endpoint],
  );

  useEffect(() => {
    if (!dataflowId) return;
    let cancelled = false;
    query(true)
      .then((j) => {
        if (!cancelled) setProbe(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataflowId, query]);

  const toggle = useCallback(() => {
    setOpen((wasOpen) => {
      const nowOpen = !wasOpen;
      // The probe already carries the text whenever the index knew the answer.
      if (nowOpen && !full && !loading) {
        if (probe?.available) {
          setFull(probe);
        } else {
          setLoading(true);
          query(false)
            .then((j) => setFull(j ?? { ...FAILED, dataflowId }))
            .catch(() => setFull({ ...FAILED, dataflowId }))
            .finally(() => setLoading(false));
        }
      }
      return nowOpen;
    });
  }, [full, loading, probe, query, dataflowId]);

  // Known to publish nothing: stay out of the way entirely.
  if (!probe || (!probe.available && probe.status !== "unknown")) return null;

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
          {!loading && full && !full.available && (
            <p className="text-on-surface-variant">
              {full.note} The API link opens the exact query behind this panel,
              so every figure can still be checked at the source.
            </p>
          )}
          {!loading && full?.available && (
            <dl className="space-y-1.5">
              {full.fields.map((f) => (
                <div key={f.id}>
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
          )}
        </div>
      )}
    </div>
  );
}
