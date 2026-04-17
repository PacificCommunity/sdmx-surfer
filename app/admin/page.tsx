"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { StatsTile } from "./_components/StatsTile";
import { formatUsd } from "./_components/format";

interface SpendByModelRow {
  model: string | null;
  provider: string | null;
  keySource: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

interface RecentActivityRow {
  id: number;
  userEmail: string | null;
  model: string | null;
  provider: string | null;
  keySource: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  costUsd: number | null;
  stepCount: number | null;
  durationMs: number | null;
  createdAt: string | null;
}

interface OverviewResponse {
  epoch: string;
  totals: {
    users: number;
    sessions: number;
    publishedDashboards: number;
    requests: number;
    inputTokens: number;
    outputTokens: number;
    tokens: number;
    costUsd: number;
  };
  invites: {
    total: number;
    emailed: number;
    signedUp: number;
  };
  spendByModel: SpendByModelRow[];
  recentActivity: RecentActivityRow[];
}

function formatTimeAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return "—";
  const deltaMin = Math.max(0, Math.round((Date.now() - t) / 60000));
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return deltaMin + "m ago";
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return deltaHr + "h ago";
  const deltaDay = Math.round(deltaHr / 24);
  return deltaDay + "d ago";
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/admin/overview");
        if (!res.ok) return;
        const json = (await res.json()) as OverviewResponse;
        setData(json);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="shimmer ghost-border h-20 rounded-[var(--radius-lg)]"
            />
          ))}
        </div>
        <div className="shimmer ghost-border h-48 rounded-[var(--radius-lg)]" />
      </div>
    );
  }

  if (!data) {
    return (
      <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
        <p className="type-label-md text-on-surface-variant">
          Could not load overview.
        </p>
      </div>
    );
  }

  const { totals, invites, spendByModel, recentActivity, epoch } = data;
  const epochDate = new Date(epoch);
  const epochLabel = epochDate.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Largest bucket first — helps spot "who's eating the bill".
  const sortedSpend = [...spendByModel].sort(
    (a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1),
  );

  return (
    <div className="space-y-8">
      {/* Top KPI strip — scoped to the epoch */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-on-surface">
            Activity since {epochLabel}
          </h2>
          <span className="type-label-md text-on-surface-variant">
            Usage analytics epoch — earlier rows excluded
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <StatsTile
            label="Users"
            value={totals.users.toLocaleString()}
            hint="all-time"
          />
          <StatsTile
            label="Sessions"
            value={totals.sessions.toLocaleString()}
            hint="all-time"
          />
          <StatsTile
            label="Tokens"
            value={totals.tokens.toLocaleString()}
            hint={
              totals.inputTokens.toLocaleString() +
              " in / " +
              totals.outputTokens.toLocaleString() +
              " out"
            }
          />
          <StatsTile
            label="Spend"
            value={formatUsd(totals.costUsd)}
            hint="gateway-tracked only"
          />
        </div>
      </div>

      {/* Spend by model */}
      <div>
        <h3 className="font-[family-name:var(--font-display)] mb-2 text-lg font-bold text-on-surface">
          Spend by model
        </h3>
        {sortedSpend.length === 0 ? (
          <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
            <p className="type-label-md text-on-surface-variant">
              No usage recorded since {epochLabel}.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface-card shadow-ambient">
            <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-2 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
              <div className="col-span-4">Model</div>
              <div className="col-span-3">Key source</div>
              <div className="col-span-2 text-right">Requests</div>
              <div className="col-span-1 text-right">Tokens</div>
              <div className="col-span-2 text-right">Cost</div>
            </div>
            {sortedSpend.map((r, idx) => (
              <div
                key={
                  (r.model ?? "?") +
                  "|" +
                  (r.provider ?? "?") +
                  "|" +
                  (r.keySource ?? "?") +
                  "|" +
                  idx
                }
                className="grid grid-cols-12 gap-3 border-t border-surface-high/20 px-6 py-2 text-xs text-on-surface-variant"
              >
                <div className="col-span-4 truncate text-on-surface">
                  {r.model ?? "(unknown)"}
                  {r.provider && (
                    <span className="ml-1 text-on-surface-variant">· {r.provider}</span>
                  )}
                </div>
                <div className="col-span-3">
                  {r.keySource ? (
                    <span
                      className={
                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                        (r.keySource === "platform-gateway"
                          ? "bg-primary/10 text-primary"
                          : r.keySource === "byok"
                            ? "bg-surface-high text-on-surface"
                            : "bg-surface-high text-on-surface-variant")
                      }
                    >
                      {r.keySource}
                    </span>
                  ) : (
                    <span className="text-on-surface-variant">—</span>
                  )}
                </div>
                <div className="col-span-2 text-right tabular-nums">
                  {r.requestCount.toLocaleString()}
                </div>
                <div className="col-span-1 text-right tabular-nums">
                  {(r.inputTokens + r.outputTokens).toLocaleString()}
                </div>
                <div
                  className="col-span-2 text-right tabular-nums"
                  title={
                    r.costUsd === null
                      ? "No authoritative cost (direct-SDK or BYOK)"
                      : undefined
                  }
                >
                  {formatUsd(r.costUsd)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Invite funnel + published dashboards side by side */}
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <h3 className="font-[family-name:var(--font-display)] mb-2 text-lg font-bold text-on-surface">
            Invite funnel
          </h3>
          <div className="grid grid-cols-3 gap-2">
            <StatsTile label="Invited" value={invites.total.toLocaleString()} />
            <StatsTile label="Emailed" value={invites.emailed.toLocaleString()} />
            <StatsTile label="Signed up" value={invites.signedUp.toLocaleString()} />
          </div>
          <div className="mt-2 px-1">
            <Link
              href="/admin/invites"
              className="text-xs font-semibold text-primary transition-colors hover:underline"
            >
              Manage invites →
            </Link>
          </div>
        </div>

        <div>
          <h3 className="font-[family-name:var(--font-display)] mb-2 text-lg font-bold text-on-surface">
            Published dashboards
          </h3>
          <StatsTile
            label="Public dashboards"
            value={totals.publishedDashboards.toLocaleString()}
          />
          <div className="mt-2 px-1">
            <Link
              href="/admin/dashboards"
              className="text-xs font-semibold text-primary transition-colors hover:underline"
            >
              Review dashboards →
            </Link>
          </div>
        </div>
      </div>

      {/* Recent activity */}
      <div>
        <h3 className="font-[family-name:var(--font-display)] mb-2 text-lg font-bold text-on-surface">
          Recent activity
        </h3>
        {recentActivity.length === 0 ? (
          <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
            <p className="type-label-md text-on-surface-variant">
              No requests since {epochLabel}.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface-card shadow-ambient">
            <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-2 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
              <div className="col-span-3">User</div>
              <div className="col-span-3">Model</div>
              <div className="col-span-2 text-right">Tokens</div>
              <div className="col-span-2 text-right">Cost</div>
              <div className="col-span-2 text-right">When</div>
            </div>
            {recentActivity.map((r) => {
              const tokens =
                (r.inputTokens ?? 0) + (r.outputTokens ?? 0);
              return (
                <div
                  key={r.id}
                  className="grid grid-cols-12 gap-3 border-t border-surface-high/20 px-6 py-2 text-xs text-on-surface-variant"
                >
                  <div className="col-span-3 truncate text-on-surface">
                    {r.userEmail ?? "(unknown)"}
                  </div>
                  <div className="col-span-3 truncate">
                    {r.model ?? "—"}
                    {r.provider && (
                      <span className="ml-1 text-on-surface-variant">· {r.provider}</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right tabular-nums">
                    {tokens.toLocaleString()}
                  </div>
                  <div className="col-span-2 text-right tabular-nums">
                    {formatUsd(r.costUsd)}
                  </div>
                  <div
                    className="col-span-2 text-right tabular-nums"
                    title={r.createdAt ?? undefined}
                  >
                    {formatTimeAgo(r.createdAt)}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
