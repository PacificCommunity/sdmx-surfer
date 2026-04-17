"use client";

import { useEffect, useState } from "react";
import { SortableHeader } from "../SortableHeader";
import {
  dateValue,
  useSortableTable,
  type SortableColumn,
} from "../useSortableTable";
import { StatsTile } from "../_components/StatsTile";
import { formatUsd, formatShortDate } from "../_components/format";

interface CostBreakdownRow {
  model: string | null;
  provider: string | null;
  keySource: string | null;
  requestCount: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
}

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string | null;
  joinedAt: string | null;
  requestCount: number;
  totalTokens: number;
  totalCostUsd: number | null;
  sessionCount: number;
  lastActive: string | null;
  breakdown: CostBreakdownRow[];
}

type UserSortKey =
  | "email"
  | "role"
  | "sessions"
  | "tokens"
  | "cost"
  | "joined"
  | "last_active";

const USER_COLUMNS: SortableColumn<UserRecord, UserSortKey>[] = [
  { key: "email", getValue: (u) => u.email, defaultDir: "asc" },
  { key: "role", getValue: (u) => (u.role === "admin" ? 1 : 0), defaultDir: "desc" },
  { key: "sessions", getValue: (u) => u.sessionCount, defaultDir: "desc" },
  { key: "tokens", getValue: (u) => u.totalTokens, defaultDir: "desc" },
  { key: "cost", getValue: (u) => u.totalCostUsd, defaultDir: "desc" },
  { key: "joined", getValue: (u) => dateValue(u.joinedAt ?? u.createdAt), defaultDir: "desc" },
  { key: "last_active", getValue: (u) => dateValue(u.lastActive), defaultDir: "desc" },
];

const userSearchText = (u: UserRecord): string => u.email + " " + (u.name ?? "");

export default function UsersPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  const usersTable = useSortableTable<UserRecord, UserSortKey>({
    rows: users,
    columns: USER_COLUMNS,
    initialSort: { key: "last_active", dir: "desc" },
    searchText: userSearchText,
  });

  async function fetchUsers(): Promise<void> {
    const res = await fetch("/api/admin/users");
    if (!res.ok) return;
    const data = (await res.json()) as { users: UserRecord[] };
    setUsers(data.users);
  }

  useEffect(() => {
    void (async () => {
      await fetchUsers();
      setLoading(false);
    })();
  }, []);

  async function handleToggleRole(user: UserRecord) {
    const newRole = user.role === "admin" ? "user" : "admin";
    setTogglingId(user.id);
    try {
      await fetch("/api/admin/users/" + user.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: newRole }),
      });
      await fetchUsers();
    } finally {
      setTogglingId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="shimmer ghost-border h-24 rounded-[var(--radius-lg)]"
          />
        ))}
      </div>
    );
  }

  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] mb-1 text-xl font-bold text-on-surface">
        Users
      </h2>
      <p className="type-label-md mb-4 text-on-surface-variant">
        All registered users and their usage statistics.
      </p>

      {users.length === 0 ? (
        <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
          <p className="type-label-md text-on-surface-variant">
            No users registered yet.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {(() => {
            const totalUsers = users.length;
            const totalSessions = users.reduce((s, u) => s + u.sessionCount, 0);
            const totalTokens = users.reduce((s, u) => s + u.totalTokens, 0);
            const totalCost = users.reduce(
              (s, u) => s + (u.totalCostUsd ?? 0),
              0,
            );
            return (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <StatsTile label="Users" value={totalUsers.toLocaleString()} />
                <StatsTile label="Sessions" value={totalSessions.toLocaleString()} />
                <StatsTile label="Tokens" value={totalTokens.toLocaleString()} />
                <StatsTile
                  label="Spend (gateway)"
                  value={formatUsd(totalCost)}
                />
              </div>
            );
          })()}

          <div className="flex items-center justify-between gap-3 px-1">
            <input
              type="search"
              value={usersTable.query}
              onChange={(e) => usersTable.setQuery(e.target.value)}
              placeholder="Search users by email or name..."
              className="focus-architectural ghost-border w-64 rounded-[var(--radius-sm)] bg-surface-low px-3 py-1.5 text-xs text-on-surface placeholder:text-text-muted hover:bg-surface-high"
            />
            <span className="type-label-md text-on-surface-variant">
              {usersTable.query.trim()
                ? usersTable.matchedCount + " of " + usersTable.totalCount
                : usersTable.totalCount + " total"}
            </span>
          </div>

          {usersTable.displayRows.length === 0 ? (
            <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
              <p className="type-label-md text-on-surface-variant">
                No users match &ldquo;{usersTable.query}&rdquo;.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <SortableHeader
                  label="Email"
                  className="col-span-3"
                  {...usersTable.getSortProps("email")}
                />
                <SortableHeader
                  label="Role"
                  className="col-span-1"
                  {...usersTable.getSortProps("role")}
                />
                <div className="col-span-2 flex flex-col items-start gap-0.5">
                  <SortableHeader
                    label="sessions"
                    size="sm"
                    {...usersTable.getSortProps("sessions")}
                  />
                  <SortableHeader
                    label="tokens"
                    size="sm"
                    {...usersTable.getSortProps("tokens")}
                  />
                  <SortableHeader
                    label="cost"
                    size="sm"
                    {...usersTable.getSortProps("cost")}
                  />
                </div>
                <SortableHeader
                  label="Joined"
                  className="col-span-2"
                  {...usersTable.getSortProps("joined")}
                />
                <SortableHeader
                  label="Last active"
                  className="col-span-2"
                  {...usersTable.getSortProps("last_active")}
                />
                <div className="type-label-md col-span-2 text-right text-on-surface">
                  Actions
                </div>
              </div>

              {usersTable.displayRows.map((user) => {
                const expanded = expandedUserId === user.id;
                const hasBreakdown = user.breakdown.length > 0;
                const toggle = () => {
                  if (!hasBreakdown) return;
                  setExpandedUserId(expanded ? null : user.id);
                };
                return (
                  <div key={user.id}>
                    <div
                      className={
                        "grid grid-cols-12 items-center gap-3 border-t border-surface-high/30 px-6 py-4 transition-colors " +
                        (hasBreakdown ? "cursor-pointer hover:bg-surface-low " : "") +
                        (expanded ? "bg-surface-low" : "")
                      }
                      onClick={toggle}
                      role={hasBreakdown ? "button" : undefined}
                      aria-expanded={hasBreakdown ? expanded : undefined}
                    >
                      <div className="col-span-3 flex min-w-0 items-start gap-2">
                        <span
                          aria-hidden="true"
                          className={
                            "mt-0.5 inline-block text-[10px] tabular-nums transition-transform " +
                            (hasBreakdown ? "text-on-surface-variant " : "text-transparent ") +
                            (expanded ? "rotate-90" : "")
                          }
                        >
                          ▸
                        </span>
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-on-surface">
                            {user.email}
                          </p>
                          {user.name && (
                            <p className="truncate text-xs text-on-surface-variant">
                              {user.name}
                            </p>
                          )}
                        </div>
                      </div>

                      <div className="col-span-1">
                        {user.role === "admin" ? (
                          <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                            Admin
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                            User
                          </span>
                        )}
                      </div>

                      <div className="col-span-2 text-xs text-on-surface-variant">
                        <span className="tabular-nums">{user.sessionCount}</span> sessions
                        <br />
                        <span className="tabular-nums">
                          {user.totalTokens.toLocaleString()}
                        </span>{" "}
                        tokens
                        <br />
                        <span
                          className="tabular-nums"
                          title={
                            user.totalCostUsd === null
                              ? "No gateway-tracked requests yet"
                              : "Sum of authoritative per-request cost (gateway path only)"
                          }
                        >
                          {formatUsd(user.totalCostUsd)}
                        </span>
                      </div>

                      <div className="col-span-2 text-xs text-on-surface-variant">
                        {user.joinedAt ? (
                          formatShortDate(user.joinedAt)
                        ) : user.createdAt ? (
                          <span
                            title={
                              "Account provisioned " +
                              formatShortDate(user.createdAt) +
                              " but no completed sign-in recorded yet"
                            }
                          >
                            -
                          </span>
                        ) : (
                          "-"
                        )}
                      </div>

                      <div className="col-span-2 text-xs text-on-surface-variant">
                        {formatShortDate(user.lastActive)}
                      </div>

                      <div
                        className="col-span-2 flex justify-end"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <button
                          type="button"
                          onClick={() => void handleToggleRole(user)}
                          disabled={togglingId === user.id}
                          className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-high disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {togglingId === user.id
                            ? "..."
                            : user.role === "admin"
                              ? "Make User"
                              : "Make Admin"}
                        </button>
                      </div>
                    </div>

                    {expanded && hasBreakdown && (
                      <div className="border-t border-surface-high/30 bg-surface-low/50 px-6 py-4">
                        <div className="rounded-[var(--radius-lg)] bg-surface-card p-4">
                          <div className="type-label-md mb-2 text-on-surface-variant">
                            Per-model breakdown — {user.breakdown.length}{" "}
                            {user.breakdown.length === 1 ? "bucket" : "buckets"}
                          </div>
                          <div className="grid grid-cols-12 gap-3 border-b border-surface-high/30 pb-2 text-[10px] font-semibold uppercase tracking-wide text-on-surface-variant">
                            <div className="col-span-4">Model</div>
                            <div className="col-span-2">Key source</div>
                            <div className="col-span-2 text-right">Requests</div>
                            <div className="col-span-2 text-right">
                              Tokens (in+out)
                            </div>
                            <div className="col-span-2 text-right">Cost</div>
                          </div>
                          {[...user.breakdown]
                            .sort(
                              (a, b) =>
                                (b.costUsd ?? -1) - (a.costUsd ?? -1) ||
                                b.requestCount - a.requestCount,
                            )
                            .map((b, idx) => (
                              <div
                                key={
                                  (b.model ?? "?") +
                                  "|" +
                                  (b.provider ?? "?") +
                                  "|" +
                                  (b.keySource ?? "?") +
                                  "|" +
                                  idx
                                }
                                className="grid grid-cols-12 gap-3 border-b border-surface-high/10 py-2 text-xs text-on-surface-variant last:border-b-0"
                              >
                                <div className="col-span-4 truncate text-on-surface">
                                  {b.model ?? "(unknown)"}
                                  {b.provider && (
                                    <span className="ml-1 text-on-surface-variant">
                                      · {b.provider}
                                    </span>
                                  )}
                                </div>
                                <div className="col-span-2">
                                  {b.keySource ? (
                                    <span
                                      className={
                                        "inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold " +
                                        (b.keySource === "platform-gateway"
                                          ? "bg-primary/10 text-primary"
                                          : b.keySource === "byok"
                                            ? "bg-surface-high text-on-surface"
                                            : "bg-surface-high text-on-surface-variant")
                                      }
                                    >
                                      {b.keySource}
                                    </span>
                                  ) : (
                                    <span className="text-on-surface-variant">—</span>
                                  )}
                                </div>
                                <div className="col-span-2 text-right tabular-nums">
                                  {b.requestCount.toLocaleString()}
                                </div>
                                <div className="col-span-2 text-right tabular-nums">
                                  {(b.inputTokens + b.outputTokens).toLocaleString()}
                                </div>
                                <div
                                  className="col-span-2 text-right tabular-nums"
                                  title={
                                    b.costUsd === null
                                      ? "No authoritative cost — " +
                                        (b.keySource === "byok"
                                          ? "BYOK (user pays provider)"
                                          : "direct-SDK path (pre-gateway)")
                                      : undefined
                                  }
                                >
                                  {formatUsd(b.costUsd)}
                                </div>
                              </div>
                            ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
