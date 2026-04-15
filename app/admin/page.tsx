"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  role: string;
  createdAt: string | null;
  requestCount: number;
  totalTokens: number;
  sessionCount: number;
  lastActive: string | null;
}

interface InviteRecord {
  email: string;
  invited_by: string | null;
  created_at: string | null;
  invite_email_sent: boolean;
  signed_up: boolean;
  signed_up_at: string | null;
  last_active: string | null;
  pending_magic_links: number;
  total_magic_link_requests: number;
  last_link_expires_at: string | null;
}

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
  const [unpublishingDashboardId, setUnpublishingDashboardId] = useState<string | null>(null);

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
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <div className="type-label-md col-span-3 text-on-surface">Email</div>
                <div className="type-label-md col-span-2 text-on-surface">Status</div>
                <div className="type-label-md col-span-2 text-on-surface">Invited</div>
                <div className="type-label-md col-span-2 text-on-surface">Signed up</div>
                <div className="type-label-md col-span-2 text-on-surface">Last active</div>
                <div className="type-label-md col-span-1 text-right text-on-surface"></div>
              </div>
              {invites.map((invite) => (
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
                          timeZone: "UTC",
                        })
                      : "-"}
                  </div>
                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {invite.signed_up_at
                      ? new Date(invite.signed_up_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "-"}
                  </div>
                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {invite.last_active
                      ? new Date(invite.last_active).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "-"}
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
        </section>

        {/* ------------------------------------------------------------------ */}
        {/* Users section                                                        */}
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
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <div className="type-label-md col-span-4 text-on-surface">Dashboard</div>
                <div className="type-label-md col-span-2 text-on-surface">Author</div>
                <div className="type-label-md col-span-2 text-on-surface">Owner</div>
                <div className="type-label-md col-span-2 text-on-surface">Published</div>
                <div className="type-label-md col-span-2 text-right text-on-surface">Actions</div>
              </div>

              {publishedDashboards.map((dashboard) => (
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
                          timeZone: "UTC",
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
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              {/* Table header */}
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <div className="type-label-md col-span-3 text-on-surface">Email</div>
                <div className="type-label-md col-span-1 text-on-surface">Role</div>
                <div className="type-label-md col-span-2 text-on-surface">Usage</div>
                <div className="type-label-md col-span-2 text-on-surface">Joined</div>
                <div className="type-label-md col-span-2 text-on-surface">Last active</div>
                <div className="type-label-md col-span-2 text-right text-on-surface">Actions</div>
              </div>

              {/* Rows */}
              {users.map((user) => (
                <div
                  key={user.id}
                  className="grid grid-cols-12 items-center gap-3 border-t border-surface-high/30 px-6 py-4 transition-colors hover:bg-surface-low"
                >
                  <div className="col-span-3 min-w-0">
                    <p className="truncate text-sm font-medium text-on-surface">{user.email}</p>
                    {user.name && (
                      <p className="truncate text-xs text-on-surface-variant">{user.name}</p>
                    )}
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
                  </div>

                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {user.createdAt
                      ? new Date(user.createdAt).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "-"}
                  </div>

                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {user.lastActive
                      ? new Date(user.lastActive).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                          timeZone: "UTC",
                        })
                      : "-"}
                  </div>

                  <div className="col-span-2 flex justify-end">
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
              ))}
            </div>
          )}
        </section>

      </main>
    </div>
  );
}
