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
}

interface InviteRecord {
  email: string;
  invited_by: string | null;
  created_at: string | null;
}

// ---------------------------------------------------------------------------
// Admin page
// ---------------------------------------------------------------------------

export default function AdminPage() {
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [accessDenied, setAccessDenied] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);

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

  useEffect(() => {
    void (async () => {
      const ok = await fetchUsers();
      if (ok) {
        await fetchInvites();
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
          <div className="ocean-gradient mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full opacity-60">
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
            className="ocean-gradient inline-block rounded-full px-6 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
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
          <h2 className="font-[family-name:var(--font-manrope)] text-xl font-bold text-on-surface mb-1">
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
                className="ocean-gradient rounded-[var(--radius-sm)] px-5 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
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
              <div className="grid grid-cols-12 gap-4 bg-surface-high/50 px-6 py-3">
                <div className="type-label-md col-span-6 text-on-surface">Email</div>
                <div className="type-label-md col-span-4 text-on-surface">Invited</div>
                <div className="type-label-md col-span-2 text-right text-on-surface">Action</div>
              </div>
              {invites.map((invite) => (
                <div
                  key={invite.email}
                  className="grid grid-cols-12 items-center gap-4 border-t border-surface-high/30 px-6 py-3 transition-colors hover:bg-surface-low"
                >
                  <div className="col-span-6 truncate text-sm font-medium text-on-surface">
                    {invite.email}
                  </div>
                  <div className="col-span-4 text-sm text-on-surface-variant">
                    {invite.created_at
                      ? new Date(invite.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          year: "numeric",
                        })
                      : "—"}
                  </div>
                  <div className="col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleRemoveInvite(invite.email)}
                      disabled={removingEmail === invite.email}
                      className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {removingEmail === invite.email ? "Removing..." : "Remove"}
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
          <h2 className="font-[family-name:var(--font-manrope)] text-xl font-bold text-on-surface mb-1">
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
                <div className="type-label-md col-span-2 text-on-surface">Role</div>
                <div className="type-label-md col-span-2 text-on-surface">Sessions</div>
                <div className="type-label-md col-span-3 text-on-surface">Tokens Used</div>
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

                  <div className="col-span-2">
                    {user.role === "admin" ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">
                        Admin
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 rounded-full bg-surface-high px-2.5 py-0.5 text-xs font-semibold text-on-surface-variant">
                        User
                      </span>
                    )}
                  </div>

                  <div className="col-span-2 text-sm text-on-surface-variant">
                    {user.sessionCount.toLocaleString()}
                  </div>

                  <div className="col-span-3 text-sm text-on-surface-variant">
                    {user.totalTokens.toLocaleString()}
                    {user.requestCount > 0 && (
                      <span className="ml-1.5 text-xs text-text-muted">
                        {"(" + user.requestCount.toLocaleString() + " req)"}
                      </span>
                    )}
                  </div>

                  <div className="col-span-2 flex justify-end">
                    <button
                      type="button"
                      onClick={() => void handleToggleRole(user)}
                      disabled={togglingId === user.id}
                      className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-on-surface-variant transition-colors hover:bg-surface-high disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {togglingId === user.id
                        ? "Updating..."
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
