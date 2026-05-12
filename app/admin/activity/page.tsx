"use client";

import { useEffect, useState } from "react";
import { StatsTile } from "../_components/StatsTile";
import { SortableHeader } from "../SortableHeader";
import {
  dateValue,
  useSortableTable,
  type SortableColumn,
} from "../useSortableTable";
import { formatShortDate } from "../_components/format";

interface RankedRow {
  key: string;
  count: number;
  /** Optional longer label shown on hover. */
  tooltip?: string;
}

interface SessionRow {
  sessionId: string;
  userEmail: string | null;
  startedAt: string | null;
  lastAt: string | null;
  turns: number;
  toolCalls: number;
  dashboardsEmitted: number;
  errorCount: number;
  durationMs: number;
  firstPrompt: string | null;
}

interface ActivityResponse {
  epoch: string;
  tiles: {
    prompts: number;
    sessions: number;
    sessionsWithDashboard: number;
    successRate: number;
    avgTurnsPerSession: number;
    medianSessionDurationMs: number;
  };
  topDataflows: RankedRow[];
  topEndpoints: RankedRow[];
  topTools: RankedRow[];
  sessions: SessionRow[];
}

type SessionSortKey =
  | "user"
  | "started"
  | "turns"
  | "toolCalls"
  | "dashboards"
  | "errors"
  | "duration";

const SESSION_COLUMNS: SortableColumn<SessionRow, SessionSortKey>[] = [
  { key: "user", getValue: (r) => r.userEmail ?? "", defaultDir: "asc" },
  { key: "started", getValue: (r) => dateValue(r.startedAt), defaultDir: "desc" },
  { key: "turns", getValue: (r) => r.turns, defaultDir: "desc" },
  { key: "toolCalls", getValue: (r) => r.toolCalls, defaultDir: "desc" },
  { key: "dashboards", getValue: (r) => r.dashboardsEmitted, defaultDir: "desc" },
  { key: "errors", getValue: (r) => r.errorCount, defaultDir: "desc" },
  { key: "duration", getValue: (r) => r.durationMs, defaultDir: "desc" },
];

const sessionSearchText = (r: SessionRow): string =>
  (r.userEmail ?? "") + " " + (r.firstPrompt ?? "") + " " + r.sessionId;

function formatPercent(value: number): string {
  return (value * 100).toFixed(0) + "%";
}

function formatNumber(value: number, decimals = 0): string {
  return value.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return ms + "ms";
  const seconds = ms / 1000;
  if (seconds < 60) return seconds.toFixed(1) + "s";
  const minutes = seconds / 60;
  if (minutes < 60) return minutes.toFixed(1) + "m";
  const hours = minutes / 60;
  return hours.toFixed(1) + "h";
}

function truncate(text: string | null, max = 80): string {
  if (!text) return "—";
  if (text.length <= max) return text;
  return text.slice(0, max).trimEnd() + "…";
}

interface RankedListProps {
  title: string;
  rows: RankedRow[];
  emptyHint: string;
}

function RankedList({ title, rows, emptyHint }: RankedListProps) {
  const max = rows[0]?.count ?? 0;
  return (
    <div className="rounded-[var(--radius-lg)] bg-surface-card p-4 shadow-ambient">
      <h3 className="type-label-md text-on-surface-variant">{title}</h3>
      {rows.length === 0 ? (
        <p className="mt-3 text-xs text-on-surface-variant">{emptyHint}</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {rows.map((row) => {
            const ratio = max === 0 ? 0 : row.count / max;
            return (
              <li key={row.key} className="text-sm">
                <div className="flex items-baseline justify-between gap-2">
                  <span
                    className="truncate text-on-surface"
                    title={row.tooltip ?? row.key}
                  >
                    {row.key}
                  </span>
                  <span className="tabular-nums text-on-surface-variant">
                    {formatNumber(row.count)}
                  </span>
                </div>
                <div className="mt-1 h-1 rounded-full bg-surface-low overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{ width: (ratio * 100).toFixed(1) + "%" }}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

export default function ActivityPage() {
  const [data, setData] = useState<ActivityResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/activity");
        if (res.status === 401) {
          setError("Unauthorized — sign in as an admin.");
          return;
        }
        if (res.status === 403) {
          setError("Forbidden — admin role required.");
          return;
        }
        if (!res.ok) {
          setError("Failed to load activity (HTTP " + res.status + ")");
          return;
        }
        const body = (await res.json()) as ActivityResponse;
        setData(body);
      } catch {
        setError("Network error — refresh to retry.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const sortable = useSortableTable<SessionRow, SessionSortKey>({
    rows: data?.sessions ?? [],
    columns: SESSION_COLUMNS,
    initialSort: { key: "started", dir: "desc" },
    searchText: sessionSearchText,
  });

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <p className="text-sm text-on-surface-variant">Loading activity…</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-5xl px-6 py-8">
        <div className="rounded-[var(--radius-md)] bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      </div>
    );
  }

  if (!data) {
    return null;
  }

  const tiles = data.tiles;

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-6 py-6">
      <div>
        <h2 className="font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-on-surface">
          Activity
        </h2>
        <p className="mt-1 text-xs text-on-surface-variant">
          Aggregates since {formatShortDate(data.epoch)}.
        </p>
      </div>

      {/* Tile row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <StatsTile label="Prompts" value={formatNumber(tiles.prompts)} />
        <StatsTile
          label="Sessions"
          value={formatNumber(tiles.sessions)}
          hint={formatNumber(tiles.sessionsWithDashboard) + " produced a dashboard"}
        />
        <StatsTile
          label="Success rate"
          value={formatPercent(tiles.successRate)}
          hint="sessions with ≥1 dashboard"
        />
        <StatsTile
          label="Avg turns / session"
          value={formatNumber(tiles.avgTurnsPerSession, 1)}
        />
        <StatsTile
          label="Median session"
          value={formatDuration(tiles.medianSessionDurationMs)}
          hint="total compute time"
        />
      </div>

      {/* Ranked lists */}
      <div className="grid gap-3 lg:grid-cols-3">
        <RankedList
          title="Top dataflows"
          rows={data.topDataflows}
          emptyHint="No dataflows queried yet."
        />
        <RankedList
          title="Top endpoints"
          rows={data.topEndpoints}
          emptyHint="No endpoint usage yet."
        />
        <RankedList
          title="Top tools"
          rows={data.topTools}
          emptyHint="No tool calls yet."
        />
      </div>

      {/* Session log */}
      <div className="rounded-[var(--radius-lg)] bg-surface-card shadow-ambient">
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <h3 className="type-label-md text-on-surface-variant">
            Sessions ({sortable.matchedCount} of {sortable.totalCount})
          </h3>
          <input
            type="search"
            placeholder="Search prompts, users, IDs…"
            value={sortable.query}
            onChange={(e) => sortable.setQuery(e.target.value)}
            className="rounded-full bg-surface-low px-3 py-1 text-xs text-on-surface placeholder:text-on-surface-variant focus:outline-none focus:ring-1 focus:ring-primary"
          />
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-low text-left">
                <th className="px-3 py-2">
                  <SortableHeader
                    label="User / first prompt"
                    {...sortable.getSortProps("user")}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortableHeader
                    label="Started"
                    {...sortable.getSortProps("started")}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortableHeader
                    label="Turns"
                    align="right"
                    {...sortable.getSortProps("turns")}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortableHeader
                    label="Tool calls"
                    align="right"
                    {...sortable.getSortProps("toolCalls")}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortableHeader
                    label="Dashboards"
                    align="right"
                    {...sortable.getSortProps("dashboards")}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortableHeader
                    label="Errors"
                    align="right"
                    {...sortable.getSortProps("errors")}
                  />
                </th>
                <th className="px-3 py-2">
                  <SortableHeader
                    label="Duration"
                    align="right"
                    {...sortable.getSortProps("duration")}
                  />
                </th>
              </tr>
            </thead>
            <tbody>
              {sortable.displayRows.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-3 py-6 text-center text-xs text-on-surface-variant"
                  >
                    No sessions match.
                  </td>
                </tr>
              ) : (
                sortable.displayRows.map((row) => (
                  <tr
                    key={row.sessionId}
                    className="border-b border-surface-low/50 last:border-b-0 align-top"
                  >
                    <td className="px-3 py-2">
                      <div className="font-medium text-on-surface">
                        {row.userEmail ?? "(unknown)"}
                      </div>
                      <div
                        className="mt-1 text-xs text-on-surface-variant"
                        title={row.firstPrompt ?? ""}
                      >
                        {truncate(row.firstPrompt)}
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-on-surface-variant tabular-nums">
                      {row.startedAt
                        ? new Date(row.startedAt).toLocaleString("en-GB", {
                            day: "2-digit",
                            month: "short",
                            hour: "2-digit",
                            minute: "2-digit",
                          })
                        : "—"}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(row.turns)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatNumber(row.toolCalls)}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.dashboardsEmitted > 0 ? (
                        <span className="font-semibold text-emerald-600">
                          {formatNumber(row.dashboardsEmitted)}
                        </span>
                      ) : (
                        <span className="text-on-surface-variant">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {row.errorCount > 0 ? (
                        <span className="font-semibold text-red-600">
                          {formatNumber(row.errorCount)}
                        </span>
                      ) : (
                        <span className="text-on-surface-variant">0</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">
                      {formatDuration(row.durationMs)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
