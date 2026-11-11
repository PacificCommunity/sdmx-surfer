"use client";

import { useEffect, useMemo, useState } from "react";
import { areaKind } from "@/lib/coverage/roles";
import { yearBins, type IndicatorGrid, type IndicatorListItem } from "@/lib/coverage/query";
import type { FlowCoverage } from "@/lib/coverage/types";

interface CoverageOverview {
  detail: FlowCoverage["detail"];
  indicatorDim: string | null;
  indicatorRule: FlowCoverage["indicatorRule"];
  areaDim: string | null;
  obs: number;
  first: number | null;
  last: number | null;
  indicators: IndicatorListItem[];
}

const LIST_LIMIT = 200;

function spanText(first: number | null | undefined, last: number | null | undefined): string {
  if (first == null || last == null) return "—";
  return first === last ? String(first) : first + "–" + last;
}

/**
 * Indicator × area × year coverage for one dataflow, from the coverage
 * artifact via /api/explore/[id]?coverage=1. Renders nothing when the flow
 * has no coverage entry.
 */
export function IndicatorCoverage({ dataflowId }: { dataflowId: string }) {
  const [overview, setOverview] = useState<CoverageOverview | null>(null);
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [grids, setGrids] = useState<Record<string, IndicatorGrid | null>>({});

  useEffect(() => {
    fetch("/api/explore/" + dataflowId + "?coverage=1")
      .then((r) => r.json())
      .then((data: { coverage?: CoverageOverview | null }) => {
        const cov = data.coverage ?? null;
        setOverview(cov);
        setSelected(cov?.indicators[0]?.code ?? null);
      })
      .catch(() => setOverview(null));
  }, [dataflowId]);

  useEffect(() => {
    if (!selected || selected in grids) return;
    fetch("/api/explore/" + dataflowId + "?coverage=1&indicator=" + encodeURIComponent(selected))
      .then((r) => r.json())
      .then((data: { grid?: IndicatorGrid | null }) =>
        setGrids((prev) => ({ ...prev, [selected]: data.grid ?? null })),
      )
      .catch(() => setGrids((prev) => ({ ...prev, [selected]: null })));
  }, [dataflowId, selected, grids]);

  const filtered = useMemo(() => {
    if (!overview) return [];
    const needle = filter.trim().toLowerCase();
    if (!needle) return overview.indicators;
    return overview.indicators.filter((i) =>
      (i.code + " " + (i.label ?? "")).toLowerCase().includes(needle),
    );
  }, [overview, filter]);

  if (!overview || overview.indicators.length === 0) return null;

  const grid = selected ? grids[selected] : undefined;
  const dimNote =
    overview.indicatorRule === "fallback"
      ? "No INDICATOR dimension; indicators are the " + overview.indicatorDim + " codes."
      : overview.indicatorRule === "none"
        ? "No indicator-like dimension; coverage is shown for the flow as a whole."
        : null;

  return (
    <section className="mb-6">
      <h3 className="mb-3 font-[family-name:var(--font-display)] text-sm font-bold text-on-surface">
        Indicator coverage
      </h3>
      <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
        <p className="mb-3 text-xs text-on-surface-variant">
          {overview.indicators.length.toLocaleString()} indicator
          {overview.indicators.length === 1 ? "" : "s"} · {overview.obs.toLocaleString()} observations ·{" "}
          {spanText(overview.first, overview.last)}
          {overview.detail === "range" &&
            " · Large dataflow: areas show first–last year, not per-year counts."}
          {dimNote && " · " + dimNote}
        </p>

        <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
          {/* Indicator list */}
          <div>
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter indicators..."
              aria-label="Filter indicators"
              className="ghost-border mb-2 w-full rounded-[var(--radius-md)] bg-surface-low px-3 py-1.5 text-xs text-on-surface placeholder:text-on-surface-variant"
            />
            <ul className="max-h-96 overflow-y-auto">
              {filtered.slice(0, LIST_LIMIT).map((ind) => (
                <li key={ind.code}>
                  <button
                    type="button"
                    onClick={() => setSelected(ind.code)}
                    className={
                      "flex w-full items-start justify-between gap-2 rounded-[var(--radius-md)] px-2 py-1.5 text-left text-xs transition-colors " +
                      (ind.code === selected ? "bg-primary/10" : "hover:bg-surface-low")
                    }
                  >
                    <span className="min-w-0">
                      <span className="block truncate font-mono font-semibold text-primary">{ind.code}</span>
                      {ind.label && (
                        <span className="line-clamp-2 text-on-surface-variant">{ind.label}</span>
                      )}
                    </span>
                    <span className="shrink-0 text-right tabular-nums text-on-surface-variant">
                      {ind.obs.toLocaleString()}
                      <span className="block text-[10px]">{spanText(ind.first, ind.last)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {filtered.length > LIST_LIMIT && (
              <p className="mt-1 text-[10px] text-on-surface-variant">
                Showing {LIST_LIMIT} of {filtered.length}; filter to narrow.
              </p>
            )}
            {filtered.length === 0 && (
              <p className="py-2 text-xs text-on-surface-variant">No indicator matches.</p>
            )}
          </div>

          {/* Grid for the selected indicator */}
          <div className="min-w-0">
            {grid === undefined ? (
              <div className="shimmer h-40 rounded-[var(--radius-md)]" />
            ) : grid === null ? (
              <p className="text-xs text-on-surface-variant">Coverage unavailable for this indicator.</p>
            ) : (
              <>
                <p className="mb-2 text-xs font-semibold text-on-surface">
                  <span className="font-mono text-primary">{grid.code}</span>
                  {grid.label && " — " + grid.label}
                </p>
                {grid.detail === "counts" ? <CountsGrid grid={grid} /> : <RangeTable grid={grid} />}
              </>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function areaName(area: { code: string; label: string | null }): string {
  return area.label ? area.code + " — " + area.label : area.code;
}

function CountsGrid({ grid }: { grid: Extract<IndicatorGrid, { detail: "counts" }> }) {
  if (grid.years.length < 2) {
    return <p className="text-xs text-on-surface-variant">No observations.</p>;
  }
  const first = grid.years[0];
  const last = first + grid.years.length - 2;
  const bins = yearBins(first, last);
  const binned = (counts: number[]) =>
    bins.map((b) => {
      let n = 0;
      for (let y = b.from; y <= b.to; y++) {
        const i = y - counts[0] + 1;
        if (i >= 1 && i < counts.length) n += counts[i];
      }
      return n;
    });
  const rows = grid.areas.length
    ? grid.areas.map((a) => ({ key: a.code, name: areaName(a), short: a.code, cells: binned(a.years) }))
    : [{ key: "_ALL", name: "All observations", short: "All", cells: binned(grid.years) }];
  const max = Math.max(1, ...rows.flatMap((r) => r.cells));
  // Where countries end and aggregates / sub-national units begin.
  const split = grid.areas.findIndex((a) => areaKind(a.code) !== "country");
  const binLabel = (b: { from: number; to: number }) => (b.from === b.to ? String(b.from) : b.from + "–" + b.to);
  const labelEvery = bins.length > 20 ? 5 : 1;

  return (
    <div className="overflow-x-auto">
      <table className="border-separate border-spacing-[2px] text-[10px]">
        <thead>
          <tr>
            <th className="sticky left-0 bg-surface-card" />
            {bins.map((b, i) => (
              <th
                key={b.from}
                className="h-8 p-0 align-bottom font-normal text-on-surface-variant"
                title={binLabel(b)}
              >
                {/* Set vertically: a horizontal four-digit year is wider than
                    the column and runs into its neighbours. Upright, it is one
                    line of text wide and never widens the column. */}
                {i % labelEvery === 0 && (
                  <span className="inline-block rotate-180 whitespace-nowrap leading-none tabular-nums [writing-mode:vertical-rl]">
                    {b.from}
                  </span>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={row.key}>
              <th
                scope="row"
                title={row.name}
                className={
                  "sticky left-0 bg-surface-card pr-2 text-left font-mono font-semibold text-primary " +
                  (r === split && split > 0 ? "border-t border-surface-high pt-1" : "")
                }
              >
                {row.short}
              </th>
              {row.cells.map((n, i) => (
                <td
                  key={bins[i].from}
                  title={row.name + " · " + binLabel(bins[i]) + ": " + n.toLocaleString() + " obs"}
                  className="h-4 min-w-4 rounded-[2px] bg-surface-high"
                  style={
                    n > 0
                      ? {
                          backgroundColor:
                            "color-mix(in srgb, var(--color-primary) " +
                            Math.round(20 + 80 * Math.sqrt(n / max)) +
                            "%, transparent)",
                        }
                      : undefined
                  }
                />
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-2 text-[10px] text-on-surface-variant">
        Darker means more observations{bins.length && bins[0].to > bins[0].from ? "; columns group years" : ""}.
        {split > 0 && " Regional aggregates and sub-national areas follow the countries."}
      </p>
    </div>
  );
}

function RangeTable({ grid }: { grid: Extract<IndicatorGrid, { detail: "range" }> }) {
  const first = grid.first;
  const last = grid.last;
  const width = first !== null && last !== null ? Math.max(1, last - first + 1) : 1;
  const split = grid.areas.findIndex((a) => areaKind(a.code) !== "country");
  return (
    <div className="max-h-96 overflow-y-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-surface-high text-left">
            <th className="px-2 py-1.5 font-semibold text-on-surface-variant">Area</th>
            <th className="px-2 py-1.5 text-right font-semibold text-on-surface-variant">Obs</th>
            <th className="px-2 py-1.5 font-semibold text-on-surface-variant">Period</th>
            <th className="px-2 py-1.5 font-semibold text-on-surface-variant">
              {spanText(first, last)}
            </th>
          </tr>
        </thead>
        <tbody>
          {grid.areas.map((a, r) => (
            <tr
              key={a.code}
              className={"transition-colors hover:bg-surface-low " + (r === split && split > 0 ? "border-t border-surface-high" : "")}
            >
              <td className="px-2 py-1.5" title={areaName(a)}>
                <span className="font-mono font-semibold text-primary">{a.code}</span>
                {a.label && <span className="ml-1.5 text-on-surface-variant">{a.label}</span>}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-on-surface">
                {a.obs != null ? a.obs.toLocaleString() : "—"}
              </td>
              <td className="px-2 py-1.5 tabular-nums text-on-surface-variant">{spanText(a.first, a.last)}</td>
              <td className="w-1/3 px-2 py-1.5">
                {first !== null && a.first != null && a.last != null && (
                  <div className="relative h-2 w-full rounded-full bg-surface-high">
                    <div
                      className="absolute h-2 rounded-full bg-primary/60"
                      style={{
                        left: ((a.first - first) / width) * 100 + "%",
                        width: ((a.last - a.first + 1) / width) * 100 + "%",
                      }}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
