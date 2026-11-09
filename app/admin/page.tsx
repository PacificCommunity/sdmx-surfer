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

interface Last24hUserRow {
  userId: string;
  userEmail: string | null;
  turns: number;
  costUsd: number | null;
  lastTurnAt: string | null;
}

interface GatewayCredits {
  balanceUsd: number;
  totalUsedUsd: number;
}

interface OverviewResponse {
  epoch: string;
  costTrustedFrom: string;
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
  last24h: {
    costUsd: number;
    turns: number;
    turnsWithoutCost: number;
    byUser: Last24hUserRow[];
  };
  gatewayCredits: GatewayCredits | null;
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

const REFRESH_INTERVAL_MS = 60_000;
// Gateway balance thresholds (USD) for the credit card's warning colours.
const CREDIT_AMBER_BELOW_USD = 50;
const CREDIT_RED_BELOW_USD = 15;

function creditCardClass(credits: GatewayCredits | null): string {
  if (!credits) return "bg-surface-card text-on-surface-variant";
  if (credits.balanceUsd < CREDIT_RED_BELOW_USD) {
    return "bg-red-50 text-red-700 ring-1 ring-inset ring-red-200";
  }
  if (credits.balanceUsd < CREDIT_AMBER_BELOW_USD) {
    return "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-200";
  }
  return "bg-surface-card text-on-surface-variant";
}

export default function AdminOverviewPage() {
  const [data, setData] = useState<OverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null);

  // Poll while the tab is visible so spend stays current during a demo. A
  // failed refresh keeps the previous data; the "updated" label then shows
  // how stale it is.
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch("/api/admin/overview", { cache: "no-store" });
        if (!res.ok) return;
        const json = (await res.json()) as OverviewResponse;
        if (cancelled) return;
        setData(json);
        setUpdatedAt(new Date());
      } catch (error) {
        console.warn("[admin] overview refresh failed", error);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
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

  const {
    totals,
    invites,
    spendByModel,
    recentActivity,
    last24h,
    gatewayCredits,
    epoch,
    costTrustedFrom,
  } = data;
  const formatDate = (iso: string) =>
    new Date(iso).toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  const epochLabel = formatDate(epoch);
  const costLabel = formatDate(costTrustedFrom);
  const costScopeDiffers = epoch !== costTrustedFrom;

  // Largest bucket first — helps spot "who's eating the bill".
  const sortedSpend = [...spendByModel].sort(
    (a, b) => (b.costUsd ?? -1) - (a.costUsd ?? -1),
  );

  return (
    <div className="space-y-8">
      {/* Live spend — gateway balance (authoritative) and the last 24 hours */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-on-surface">
            Spend now
          </h2>
          <span className="type-label-md text-on-surface-variant tabular-nums">
            {updatedAt
              ? "updated " + updatedAt.toLocaleTimeString("en-GB")
              : ""}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div
            className={
              "rounded-[var(--radius-lg)] px-4 py-3 shadow-ambient " +
              creditCardClass(gatewayCredits)
            }
          >
            <div className="type-label-md">AI Gateway credit</div>
            {gatewayCredits ? (
              <>
                <div className="font-[family-name:var(--font-display)] text-2xl font-bold tabular-nums">
                  {formatUsd(gatewayCredits.balanceUsd)}
                  <span className="ml-1 text-xs font-semibold">left</span>
                </div>
                <div className="mt-0.5 text-[10px]">
                  {formatUsd(gatewayCredits.totalUsedUsd)} used in total ·
                  shared key, covers dev + production
                </div>
              </>
            ) : (
              <div className="font-[family-name:var(--font-display)] text-2xl font-bold">
                unavailable
              </div>
            )}
          </div>
          <div className="rounded-[var(--radius-lg)] bg-surface-card px-4 py-3 shadow-ambient">
            <div className="type-label-md text-on-surface-variant">
              Last 24 hours
            </div>
            <div className="font-[family-name:var(--font-display)] text-2xl font-bold text-on-surface tabular-nums">
              {formatUsd(last24h.costUsd)}
            </div>
            <div className="mt-0.5 text-[10px] text-on-surface-variant">
              {last24h.turns.toLocaleString() +
                (last24h.turns === 1 ? " turn" : " turns")}
              {last24h.turnsWithoutCost > 0 && (
                <span className="ml-1 font-semibold text-amber-700">
                  · {last24h.turnsWithoutCost.toLocaleString()}{" "}
                  {last24h.turnsWithoutCost === 1 ? "turn" : "turns"} without
                  cost
                </span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Last 24 hours by user */}
      <div>
        <h3 className="font-[family-name:var(--font-display)] mb-2 text-lg font-bold text-on-surface">
          Last 24 hours by user
        </h3>
        {last24h.byUser.length === 0 ? (
          <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
            <p className="type-label-md text-on-surface-variant">
              No requests in the last 24 hours.
            </p>
          </div>
        ) : (
          <div className="overflow-hidden rounded-[var(--radius-lg)] bg-surface-card shadow-ambient">
            <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-2 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
              <div className="col-span-5">User</div>
              <div className="col-span-2 text-right">Turns</div>
              <div className="col-span-3 text-right">Cost</div>
              <div className="col-span-2 text-right">Last active</div>
            </div>
            {last24h.byUser.map((r) => (
              <div
                key={r.userId}
                className="grid grid-cols-12 gap-3 border-t border-surface-high/20 px-6 py-2 text-xs text-on-surface-variant"
              >
                <div className="col-span-5 truncate text-on-surface">
                  {r.userEmail ?? "(unknown)"}
                </div>
                <div className="col-span-2 text-right tabular-nums">
                  {r.turns.toLocaleString()}
                </div>
                <div className="col-span-3 text-right tabular-nums">
                  {formatUsd(r.costUsd)}
                </div>
                <div
                  className="col-span-2 text-right tabular-nums"
                  title={r.lastTurnAt ?? undefined}
                >
                  {formatTimeAgo(r.lastTurnAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Top KPI strip — scoped to the epoch */}
      <div>
        <div className="mb-2 flex items-baseline justify-between">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-on-surface">
            Activity since {epochLabel}
          </h2>
          <span className="type-label-md text-on-surface-variant">
            {costScopeDiffers
              ? "Tokens / spend reset on " + costLabel + " after cost-accounting fix"
              : "Usage analytics epoch — earlier rows excluded"}
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
              (costScopeDiffers ? "since " + costLabel + " · " : "") +
              totals.inputTokens.toLocaleString() +
              " in / " +
              totals.outputTokens.toLocaleString() +
              " out"
            }
          />
          <StatsTile
            label="Spend"
            value={formatUsd(totals.costUsd)}
            hint={
              costScopeDiffers
                ? "since " + costLabel + " · gateway-tracked only"
                : "gateway-tracked only"
            }
          />
        </div>
        <p className="mt-2 px-1 text-[10px] text-on-surface-variant">
          Logged spend is a lower bound: usage logging missed every multi-step
          turn from August to 9 Nov 2026 (fixed in commit a907336), so totals
          covering that period undercount. The AI Gateway total above is
          authoritative.
        </p>
      </div>

      {/* Spend by model */}
      <div>
        <h3 className="font-[family-name:var(--font-display)] mb-2 text-lg font-bold text-on-surface">
          Spend by model
        </h3>
        {sortedSpend.length === 0 ? (
          <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
            <p className="type-label-md text-on-surface-variant">
              No usage recorded since {costLabel}.
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
