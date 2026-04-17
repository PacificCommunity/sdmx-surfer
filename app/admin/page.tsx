"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SortableHeader } from "./SortableHeader";
import {
  dateValue,
  useSortableTable,
  type SortableColumn,
} from "./useSortableTable";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

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

function formatUsd(cost: number | null | undefined): string {
  if (cost === null || cost === undefined) return "—";
  return cost.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  });
}

interface InviteRecord {
  email: string;
  invited_by: string | null;
  created_at: string | null;
  invite_email_sent: boolean;
  signed_up: boolean;
  signed_up_at: string | null;
  last_active: string | null;
  last_login_at: string | null;
  pending_magic_links: number;
  total_magic_link_requests: number;
  last_link_expires_at: string | null;
  has_password: boolean;
  locked: boolean;
}

interface PasswordReveal {
  email: string;
  passphrase: string;
}

// ---------------------------------------------------------------------------
// Sortable table configuration
// ---------------------------------------------------------------------------

// Rank invites by stage in the sign-up funnel so "Status" sort puts active
// users at one end and never-invited stubs at the other.
function inviteStatusRank(i: InviteRecord): number {
  if (i.signed_up) return 4;
  if (i.total_magic_link_requests > 0) return 3;
  if (i.invite_email_sent) return 2;
  return 1;
}

type InviteSortKey = "email" | "status" | "invited" | "signed_up" | "last_active";

const INVITE_COLUMNS: SortableColumn<InviteRecord, InviteSortKey>[] = [
  { key: "email", getValue: (i) => i.email, defaultDir: "asc" },
  { key: "status", getValue: inviteStatusRank, defaultDir: "desc" },
  { key: "invited", getValue: (i) => dateValue(i.created_at), defaultDir: "desc" },
  { key: "signed_up", getValue: (i) => dateValue(i.signed_up_at), defaultDir: "desc" },
  { key: "last_active", getValue: (i) => dateValue(i.last_active ?? i.last_login_at), defaultDir: "desc" },
];

const inviteSearchText = (i: InviteRecord): string => i.email;

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

const userSearchText = (u: UserRecord): string =>
  u.email + " " + (u.name ?? "");

type DashboardSortKey = "title" | "author" | "owner" | "published";

const DASHBOARD_COLUMNS: SortableColumn<PublishedDashboardRecord, DashboardSortKey>[] = [
  { key: "title", getValue: (d) => d.title, defaultDir: "asc" },
  { key: "author", getValue: (d) => d.author, defaultDir: "asc" },
  { key: "owner", getValue: (d) => d.ownerEmail, defaultDir: "asc" },
  { key: "published", getValue: (d) => dateValue(d.publishedAt), defaultDir: "desc" },
];

const dashboardSearchText = (d: PublishedDashboardRecord): string =>
  d.title +
  " " +
  (d.description ?? "") +
  " " +
  (d.author ?? "") +
  " " +
  d.ownerEmail +
  " " +
  (d.ownerName ?? "");

// NextAuth magic links have maxAge 15 min, so requested_at ≈ expires - 15 min.
function formatRequestedAgo(lastExpiresAt: string | null): string | null {
  if (!lastExpiresAt) return null;
  const expiresMs = new Date(lastExpiresAt).getTime();
  if (Number.isNaN(expiresMs)) return null;
  const requestedMs = expiresMs - 15 * 60 * 1000;
  const deltaMin = Math.max(0, Math.round((Date.now() - requestedMs) / 60000));
  if (deltaMin < 1) return "just now";
  if (deltaMin < 60) return deltaMin + "m ago";
  const deltaHr = Math.round(deltaMin / 60);
  if (deltaHr < 24) return deltaHr + "h ago";
  const deltaDay = Math.round(deltaHr / 24);
  return deltaDay + "d ago";
}

interface PublishedDashboardRecord {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string | null;
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [publishedDashboards, setPublishedDashboards] = useState<PublishedDashboardRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [clearingLinksEmail, setClearingLinksEmail] = useState<string | null>(null);
  const [passwordBusyEmail, setPasswordBusyEmail] = useState<string | null>(null);
  const [passwordReveal, setPasswordReveal] = useState<PasswordReveal | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const [unpublishingDashboardId, setUnpublishingDashboardId] = useState<string | null>(null);
  const [expandedUserId, setExpandedUserId] = useState<string | null>(null);

  // ---------------------------------------------------------------------------
  // Sortable / searchable tables
  // ---------------------------------------------------------------------------

  const invitesTable = useSortableTable<InviteRecord, InviteSortKey>({
    rows: invites,
    columns: INVITE_COLUMNS,
    initialSort: { key: "invited", dir: "desc" },
    searchText: inviteSearchText,
  });

  const usersTable = useSortableTable<UserRecord, UserSortKey>({
    rows: users,
    columns: USER_COLUMNS,
    initialSort: { key: "last_active", dir: "desc" },
    searchText: userSearchText,
  });

  const dashboardsTable = useSortableTable<PublishedDashboardRecord, DashboardSortKey>({
    rows: publishedDashboards,
    columns: DASHBOARD_COLUMNS,
    initialSort: { key: "published", dir: "desc" },
    searchText: dashboardSearchText,
  });

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  async function fetchUsers(): Promise<boolean> {
    const res = await fetch("/api/admin/users");
    if (res.status === 403 || res.status === 401) {
      setAccessDenied(true);
      return false;
    }
    if (!res.ok) return false;
    const data = (await res.json()) as { users: UserRecord[] };
    setUsers(data.users);
    return true;
  }

  async function fetchInvites() {
    const res = await fetch("/api/admin/invites");
    if (!res.ok) return;
    const data = (await res.json()) as { invites: InviteRecord[] };
    setInvites(data.invites);
  }

  async function fetchPublishedDashboards() {
    const res = await fetch("/api/admin/published-dashboards");
    if (!res.ok) return;
    const data = (await res.json()) as { dashboards: PublishedDashboardRecord[] };
    setPublishedDashboards(data.dashboards);
  }

  useEffect(() => {
    void (async () => {
      const ok = await fetchUsers();
      if (ok) {
        await Promise.all([fetchInvites(), fetchPublishedDashboards()]);
      }
      setLoading(false);
    })();
  }, []);

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function handleInvite() {
    const trimmed = inviteEmail.trim();
    if (!trimmed) return;
    setInviting(true);
    setInviteError("");
    try {
      const res = await fetch("/api/admin/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        setInviteError(data.error ?? "Failed to invite");
        return;
      }
      setInviteEmail("");
      await fetchInvites();
    } catch {
      setInviteError("Network error");
    } finally {
      setInviting(false);
    }
  }

  async function handleSetPassword(email: string, verb: "set" | "reset") {
    if (
      verb === "reset" &&
      !confirm(
        "Generate a new password for " +
          email +
          "? The previous password will stop working immediately.",
      )
    ) {
      return;
    }
    setPasswordBusyEmail(email);
    try {
      const res = await fetch(
        "/api/admin/invites/" + encodeURIComponent(email) + "/password",
        { method: "POST" },
      );
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        alert(data.error ?? "Failed to set password");
        return;
      }
      const data = (await res.json()) as PasswordReveal;
      setPasswordReveal(data);
      setPasswordCopied(false);
      await fetchInvites();
    } finally {
      setPasswordBusyEmail(null);
    }
  }

  async function handleRevokePassword(email: string) {
    if (
      !confirm(
        "Revoke password sign-in for " +
          email +
          "? They can still use the magic link if they can receive the email.",
      )
    ) {
      return;
    }
    setPasswordBusyEmail(email);
    try {
      await fetch(
        "/api/admin/invites/" + encodeURIComponent(email) + "/password",
        { method: "DELETE" },
      );
      await fetchInvites();
    } finally {
      setPasswordBusyEmail(null);
    }
  }

  async function handleCopyPassword() {
    if (!passwordReveal) return;
    try {
      await navigator.clipboard.writeText(passwordReveal.passphrase);
      setPasswordCopied(true);
    } catch {
      // Clipboard may be blocked; the user can still copy manually from the modal.
    }
  }

  async function handleClearMagicLinks(email: string) {
    setClearingLinksEmail(email);
    try {
      await fetch(
        "/api/admin/invites/" + encodeURIComponent(email) + "/magic-links",
        { method: "DELETE" },
      );
      await fetchInvites();
    } finally {
      setClearingLinksEmail(null);
    }
  }

  async function handleRemoveInvite(email: string) {
    setRemovingEmail(email);
    try {
      await fetch("/api/admin/invites/" + encodeURIComponent(email), {
        method: "DELETE",
      });
      await fetchInvites();
    } finally {
      setRemovingEmail(null);
    }
  }

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

  async function handleUnpublishDashboard(dashboardId: string) {
    setUnpublishingDashboardId(dashboardId);
    try {
      await fetch("/api/admin/published-dashboards/" + dashboardId, {
        method: "DELETE",
      });
      await fetchPublishedDashboards();
    } finally {
      setUnpublishingDashboardId(null);
    }
  }

  // ---------------------------------------------------------------------------
  // Render states
  // ---------------------------------------------------------------------------

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-4">
            <div className="shimmer h-9 w-9 rounded-full" />
            <div className="shimmer h-6 w-48 rounded" />
          </div>
        </header>
        <main className="mx-auto max-w-5xl px-6 py-8">
          <div className="space-y-4">
            {[0, 1, 2].map((i) => (
              <div key={i} className="shimmer ghost-border h-24 rounded-[var(--radius-lg)]" />
            ))}
          </div>
        </main>
      </div>
    );
  }

  if (accessDenied) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="ghost-border shadow-ambient rounded-[var(--radius-xl)] bg-surface-card p-10 text-center">
          <div className="brand-gradient mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full opacity-60">
            <svg className="h-7 w-7 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" />
            </svg>
          </div>
          <h1 className="type-headline-sm mb-2 text-on-surface">Access denied</h1>
          <p className="type-label-md mb-6 text-on-surface-variant">
            You do not have permission to view this page.
          </p>
          <Link
            href="/"
            className="brand-gradient inline-block rounded-full px-6 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Main render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-surface">
      {passwordReveal && (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm"
          role="dialog"
          aria-modal="true"
          aria-labelledby="password-reveal-title"
        >
          <div className="w-full max-w-md rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient">
            <h3
              id="password-reveal-title"
              className="font-[family-name:var(--font-display)] text-lg font-bold text-on-surface"
            >
              Password generated
            </h3>
            <p className="mt-1 text-xs text-on-surface-variant">
              For <span className="font-medium text-on-surface">{passwordReveal.email}</span>.
              This is the only time you&apos;ll see it — copy it now and share it with the user
              over a trusted channel (Teams, work email, in person).
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-surface-low p-3">
              <code className="flex-1 select-all break-all font-mono text-sm text-on-surface">
                {passwordReveal.passphrase}
              </code>
              <button
                type="button"
                onClick={() => void handleCopyPassword()}
                className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                {passwordCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-on-surface-variant">
              Tell the user to sign in at <span className="font-mono">/login</span> using{" "}
              <span className="font-medium text-on-surface">Sign in with a password</span>.
              Their email is the username. If they lose this password, click{" "}
              <span className="font-semibold">reset</span> to generate a new one.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                type="button"
                onClick={() => {
                  setPasswordReveal(null);
                  setPasswordCopied(false);
                }}
                className="brand-gradient rounded-full px-5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Glass header */}
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-4">
        <div className="mx-auto flex max-w-5xl items-center gap-4">
          <Link
            href="/"
            className="ghost-border flex h-9 w-9 items-center justify-center rounded-full bg-surface-card text-on-surface-variant transition-transform hover:scale-105 hover:text-primary"
            title="Back to home"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div>
            <h1 className="type-headline-sm text-on-surface">Admin Dashboard</h1>
            <p className="type-label-md text-on-surface-variant">User and invite management</p>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8 space-y-10">

        {/* ------------------------------------------------------------------ */}
        {/* Invite section                                                       */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-on-surface mb-1">
            Pilot Invites
          </h2>
          <p className="type-label-md text-on-surface-variant mb-4">
            Add email addresses to the allowlist. Only invited users can sign in.
          </p>

          {/* Invite input */}
          <div className="ghost-border shadow-ambient rounded-[var(--radius-lg)] bg-surface-card p-4 mb-4">
            <div className="flex gap-3">
              <input
                type="email"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") void handleInvite(); }}
                placeholder="user@example.com"
                className="focus-architectural ghost-border flex-1 rounded-[var(--radius-sm)] bg-surface-low px-3 py-2 text-sm text-on-surface transition-colors placeholder:text-text-muted hover:bg-surface-high"
              />
              <button
                type="button"
                onClick={() => void handleInvite()}
                disabled={inviting || !inviteEmail.trim()}
                className="brand-gradient rounded-[var(--radius-sm)] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {inviting ? "Inviting..." : "Invite"}
              </button>
            </div>
            {inviteError && (
              <p className="mt-2 text-xs text-red-600">{inviteError}</p>
            )}
          </div>

          {/* Invites table */}
          {invites.length === 0 ? (
            <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
              <p className="type-label-md text-on-surface-variant">No invites yet.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1">
                <input
                  type="search"
                  value={invitesTable.query}
                  onChange={(e) => invitesTable.setQuery(e.target.value)}
                  placeholder="Search invites by email..."
                  className="focus-architectural ghost-border w-64 rounded-[var(--radius-sm)] bg-surface-low px-3 py-1.5 text-xs text-on-surface placeholder:text-text-muted hover:bg-surface-high"
                />
                <span className="type-label-md text-on-surface-variant">
                  {invitesTable.query.trim()
                    ? invitesTable.matchedCount + " of " + invitesTable.totalCount
                    : invitesTable.totalCount + " total"}
                </span>
              </div>
              {invitesTable.displayRows.length === 0 ? (
                <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
                  <p className="type-label-md text-on-surface-variant">
                    No invites match &ldquo;{invitesTable.query}&rdquo;.
                  </p>
                </div>
              ) : (
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <SortableHeader label="Email" className="col-span-3" {...invitesTable.getSortProps("email")} />
                <SortableHeader label="Status" className="col-span-2" {...invitesTable.getSortProps("status")} />
                <SortableHeader label="Invited" className="col-span-2" {...invitesTable.getSortProps("invited")} />
                <SortableHeader label="Signed up" className="col-span-2" {...invitesTable.getSortProps("signed_up")} />
                <SortableHeader label="Last active" className="col-span-2" {...invitesTable.getSortProps("last_active")} />
                <div className="type-label-md col-span-1 text-right text-on-surface"></div>
              </div>
              {invitesTable.displayRows.map((invite) => (
                <div
                  key={invite.email}
                  className="grid grid-cols-12 items-center gap-3 border-t border-surface-high/30 px-6 py-3 transition-colors hover:bg-surface-low"
                >
                  <div className="col-span-3 truncate text-sm font-medium text-on-surface">
                    {invite.email}
                  </div>
                  <div className="col-span-2">
                    {invite.signed_up ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 ring-1 ring-inset ring-emerald-200">
                        Active
                      </span>
                    ) : invite.total_magic_link_requests > 0 ? (
                      <div className="flex flex-col gap-0.5">
                        <span
                          className="inline-flex w-fit items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-[10px] font-semibold text-orange-700 ring-1 ring-inset ring-orange-200"
                          title={
                            invite.total_magic_link_requests +
                            " magic-link request" +
                            (invite.total_magic_link_requests === 1 ? "" : "s") +
                            " on record (" +
                            invite.pending_magic_links +
                            " unexpired)"
                          }
                        >
                          {invite.pending_magic_links > 0 && (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-orange-500" />
                          )}
                          Awaiting link
                          {invite.total_magic_link_requests > 1 && (
                            <span className="rounded-full bg-orange-100 px-1 text-[9px] tabular-nums">
                              ×{invite.total_magic_link_requests}
                            </span>
                          )}
                        </span>
                        {invite.last_link_expires_at && (
                          <span className="text-[10px] text-on-surface-variant">
                            last asked {formatRequestedAgo(invite.last_link_expires_at)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleClearMagicLinks(invite.email)}
                          disabled={clearingLinksEmail === invite.email}
                          className="w-fit text-[10px] font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          title="Delete unused verification tokens so the user can request a fresh link"
                        >
                          {clearingLinksEmail === invite.email ? "clearing…" : "clear requests"}
                        </button>
                      </div>
                    ) : invite.invite_email_sent ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-semibold text-amber-700 ring-1 ring-inset ring-amber-200">
                        Invited
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
                        Pending
                      </span>
                    )}
                  </div>
                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {invite.created_at
                      ? new Date(invite.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "-"}
                  </div>
                  <div className="col-span-2 flex flex-col gap-1 text-xs text-on-surface-variant">
                    <span>
                      {invite.signed_up_at
                        ? new Date(invite.signed_up_at).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            })
                        : "-"}
                    </span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {invite.has_password ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-on-surface">
                            <svg className="h-2.5 w-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                            </svg>
                            password set
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleSetPassword(invite.email, "reset")}
                            disabled={passwordBusyEmail === invite.email}
                            className="text-[10px] font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            title="Generate a new password (the old one stops working immediately)"
                          >
                            {passwordBusyEmail === invite.email ? "…" : "reset"}
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRevokePassword(invite.email)}
                            disabled={passwordBusyEmail === invite.email}
                            className="text-[10px] font-semibold text-red-500 transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                            title="Disable password sign-in for this user"
                          >
                            revoke
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void handleSetPassword(invite.email, "set")}
                          disabled={passwordBusyEmail === invite.email}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          title="Generate a memorable passphrase for this user"
                        >
                          {passwordBusyEmail === invite.email ? "generating…" : "set password"}
                        </button>
                      )}
                      {invite.locked && (
                        <span
                          className="inline-flex items-center gap-1 rounded-full bg-red-50 px-1.5 py-0.5 text-[9px] font-semibold text-red-700 ring-1 ring-inset ring-red-200"
                          title="Too many failed password attempts; will auto-unlock in 15 minutes or on admin reset"
                        >
                          locked
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="col-span-2 flex flex-col gap-0.5 text-xs text-on-surface-variant">
                    <span>
                      {invite.last_active
                        ? new Date(invite.last_active).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                            })
                        : "-"}
                    </span>
                    {invite.last_login_at && (
                      <span className="text-[10px]" title="Most recent sign-in">
                        login{" "}
                        {new Date(invite.last_login_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    )}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleRemoveInvite(invite.email)}
                      disabled={removingEmail === invite.email}
                      className="ghost-border rounded-full px-2 py-1 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {removingEmail === invite.email ? "..." : "Remove"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
              )}
            </div>
          )}
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Published dashboards section                                        */}
        {/* ------------------------------------------------------------------ */}
        <section>
          <h2 className="font-[family-name:var(--font-display)] mb-1 text-xl font-bold text-on-surface">
            Published Dashboards
          </h2>
          <p className="type-label-md mb-4 text-on-surface-variant">
            Review public dashboards and unpublish them if needed.
          </p>

          {publishedDashboards.length === 0 ? (
            <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
              <p className="type-label-md text-on-surface-variant">No public dashboards right now.</p>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-3 px-1">
                <input
                  type="search"
                  value={dashboardsTable.query}
                  onChange={(e) => dashboardsTable.setQuery(e.target.value)}
                  placeholder="Search title, author, owner..."
                  className="focus-architectural ghost-border w-64 rounded-[var(--radius-sm)] bg-surface-low px-3 py-1.5 text-xs text-on-surface placeholder:text-text-muted hover:bg-surface-high"
                />
                <span className="type-label-md text-on-surface-variant">
                  {dashboardsTable.query.trim()
                    ? dashboardsTable.matchedCount + " of " + dashboardsTable.totalCount
                    : dashboardsTable.totalCount + " total"}
                </span>
              </div>
              {dashboardsTable.displayRows.length === 0 ? (
                <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
                  <p className="type-label-md text-on-surface-variant">
                    No dashboards match &ldquo;{dashboardsTable.query}&rdquo;.
                  </p>
                </div>
              ) : (
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <SortableHeader label="Dashboard" className="col-span-4" {...dashboardsTable.getSortProps("title")} />
                <SortableHeader label="Author" className="col-span-2" {...dashboardsTable.getSortProps("author")} />
                <SortableHeader label="Owner" className="col-span-2" {...dashboardsTable.getSortProps("owner")} />
                <SortableHeader label="Published" className="col-span-2" {...dashboardsTable.getSortProps("published")} />
                <div className="type-label-md col-span-2 text-right text-on-surface">Actions</div>
              </div>

              {dashboardsTable.displayRows.map((dashboard) => (
                <div
                  key={dashboard.id}
                  className="grid grid-cols-12 items-center gap-3 border-t border-surface-high/30 px-6 py-4 transition-colors hover:bg-surface-low"
                >
                  <div className="col-span-4 min-w-0">
                    <p className="truncate text-sm font-medium text-on-surface">{dashboard.title}</p>
                    {dashboard.description && (
                      <p className="mt-1 truncate text-xs text-on-surface-variant">
                        {dashboard.description}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {dashboard.author || "Anonymous"}
                  </div>

                  <div className="col-span-2 min-w-0 text-xs text-on-surface-variant">
                    <p className="truncate">{dashboard.ownerEmail}</p>
                    {dashboard.ownerName && (
                      <p className="truncate">{dashboard.ownerName}</p>
                    )}
                  </div>

                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {dashboard.publishedAt
                      ? new Date(dashboard.publishedAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "-"}
                  </div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <Link
                      href={"/p/" + dashboard.id}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-surface-high"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleUnpublishDashboard(dashboard.id)}
                      disabled={unpublishingDashboardId === dashboard.id}
                      className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {unpublishingDashboardId === dashboard.id ? "..." : "Unpublish"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
              )}
            </div>
          )}
        </section>

        <section>
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-on-surface mb-1">
            Users
          </h2>
          <p className="type-label-md text-on-surface-variant mb-4">
            All registered users and their usage statistics.
          </p>

          {users.length === 0 ? (
            <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
              <p className="type-label-md text-on-surface-variant">No users registered yet.</p>
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
                const stats: Array<{ label: string; value: string }> = [
                  { label: "Users", value: totalUsers.toLocaleString() },
                  { label: "Sessions", value: totalSessions.toLocaleString() },
                  { label: "Tokens", value: totalTokens.toLocaleString() },
                  { label: "Spend (gateway)", value: formatUsd(totalCost) },
                ];
                return (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {stats.map((s) => (
                      <div
                        key={s.label}
                        className="rounded-[var(--radius-lg)] bg-surface-card px-4 py-3 shadow-ambient"
                      >
                        <div className="type-label-md text-on-surface-variant">{s.label}</div>
                        <div className="font-[family-name:var(--font-display)] text-lg font-bold text-on-surface tabular-nums">
                          {s.value}
                        </div>
                      </div>
                    ))}
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
              {/* Table header */}
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <SortableHeader label="Email" className="col-span-3" {...usersTable.getSortProps("email")} />
                <SortableHeader label="Role" className="col-span-1" {...usersTable.getSortProps("role")} />
                <div className="col-span-2 flex items-center gap-2">
                  <SortableHeader label="sessions" size="sm" {...usersTable.getSortProps("sessions")} />
                  <SortableHeader label="tokens" size="sm" {...usersTable.getSortProps("tokens")} />
                  <SortableHeader label="cost" size="sm" {...usersTable.getSortProps("cost")} />
                </div>
                <SortableHeader label="Joined" className="col-span-2" {...usersTable.getSortProps("joined")} />
                <SortableHeader label="Last active" className="col-span-2" {...usersTable.getSortProps("last_active")} />
                <div className="type-label-md col-span-2 text-right text-on-surface">Actions</div>
              </div>

              {/* Rows */}
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
                          <p className="truncate text-sm font-medium text-on-surface">{user.email}</p>
                          {user.name && (
                            <p className="truncate text-xs text-on-surface-variant">{user.name}</p>
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
                        <span className="tabular-nums">{user.totalTokens.toLocaleString()}</span> tokens
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
                        {user.joinedAt
                          ? new Date(user.joinedAt).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : user.createdAt
                            ? (
                              <span
                                title={
                                  "Account provisioned " +
                                  new Date(user.createdAt).toLocaleDateString("en-GB", {
                                    day: "numeric",
                                    month: "short",
                                    year: "numeric",
                                  }) +
                                  " but no completed sign-in recorded yet"
                                }
                              >
                                -
                              </span>
                            )
                            : "-"}
                      </div>

                      <div className="col-span-2 text-xs text-on-surface-variant">
                        {user.lastActive
                          ? new Date(user.lastActive).toLocaleDateString("en-GB", {
                              day: "numeric",
                              month: "short",
                              year: "numeric",
                            })
                          : "-"}
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
                            <div className="col-span-2 text-right">Tokens (in+out)</div>
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

      </main>
    </div>
  );
}
