"use client";

import { useEffect, useState } from "react";

type Observation = Record<string, string | number | undefined>;

export function SnapshotTable({
  dataUrl,
  seriesConcept,
  isCompare,
}: {
  dataUrl: string;
  seriesConcept?: string;          // e.g. "SEX" when consolidated
  isCompare: boolean;
}) {
  const [rows, setRows] = useState<Observation[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Library is a UMD build; require at runtime so SSR doesn't choke.
        const mod = (await import("sdmx-json-parser")) as unknown as {
          SDMXParser: new () => {
            getDatasets: (url: string) => Promise<unknown>;
            getData: () => Observation[];
          };
        };
        const Parser = mod.SDMXParser || (mod as { default?: { SDMXParser?: typeof mod.SDMXParser } }).default?.SDMXParser;
        if (!Parser) throw new Error("sdmx-json-parser export shape mismatch");
        const p = new Parser();
        await p.getDatasets(dataUrl);
        const data = p.getData();
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [dataUrl]);

  if (err) throw new Error(err); // surfaces in the parent ErrorBoundary

  if (rows === null) {
    return <div className="h-32 w-full animate-pulse rounded-md bg-[#f1f4f6]" />;
  }
  if (rows.length === 0) {
    return (
      <p className="rounded-md bg-[#f7fafc] p-4 text-sm italic text-neutral-500">
        No observations available.
      </p>
    );
  }

  // Pivot: TIME_PERIOD on rows; the "column dimension" is either the
  // seriesConcept (e.g. SEX) or GEO_PICT in compare mode. If neither
  // applies, single OBS_VALUE column.
  const colDim = isCompare ? "GEO_PICT" : seriesConcept ?? "";
  const periods = Array.from(
    new Set(rows.map((r) => String(r["TIME_PERIOD"] ?? ""))),
  )
    .filter(Boolean)
    .sort();
  const cols = colDim
    ? Array.from(new Set(rows.map((r) => String(r[colDim] ?? "")))).filter(
        Boolean,
      )
    : ["Value"];

  // Build pivot map: period → col → numeric value
  const pivot = new Map<string, Map<string, number | undefined>>();
  for (const p of periods) pivot.set(p, new Map());
  for (const r of rows) {
    const tp = String(r["TIME_PERIOD"] ?? "");
    if (!tp) continue;
    const c = colDim ? String(r[colDim] ?? "") : "Value";
    const v = typeof r["value"] === "number" ? r["value"] : undefined;
    pivot.get(tp)?.set(c, v);
  }

  function fmt(v: number | undefined): string {
    if (v == null || !Number.isFinite(v)) return "—";
    return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }

  return (
    <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
      <table className="w-full text-sm">
        <thead className="bg-[#f7fafc] text-xs uppercase tracking-wide text-neutral-600">
          <tr>
            <th className="px-3 py-2 text-left font-medium">Year</th>
            {cols.map((c) => (
              <th key={c} className="px-3 py-2 text-right font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {periods.map((p, idx) => (
            <tr
              key={p}
              className={idx % 2 ? "bg-[#fafbfc]" : ""}
            >
              <td className="px-3 py-1.5 font-medium text-neutral-700">{p}</td>
              {cols.map((c) => (
                <td
                  key={c}
                  className="px-3 py-1.5 text-right tabular-nums text-neutral-800"
                >
                  {fmt(pivot.get(p)?.get(c))}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
