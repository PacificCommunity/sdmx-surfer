"use client";

import { useEffect, useRef, useState } from "react";
import { SortableHeader } from "../SortableHeader";
import {
  dateValue,
  useSortableTable,
  type SortableColumn,
} from "../useSortableTable";
import { formatShortDate, formatRequestedAgo } from "../_components/format";

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
  {
    key: "last_active",
    getValue: (i) => dateValue(i.last_active ?? i.last_login_at),
    defaultDir: "desc",
  },
];

const inviteSearchText = (i: InviteRecord): string => i.email;

export default function InvitesPage() {
  const [invites, setInvites] = useState<InviteRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [removingEmail, setRemovingEmail] = useState<string | null>(null);
  const [clearingLinksEmail, setClearingLinksEmail] = useState<string | null>(null);
  const [passwordBusyEmail, setPasswordBusyEmail] = useState<string | null>(null);
  const [passwordReveal, setPasswordReveal] = useState<PasswordReveal | null>(null);
  const [passwordCopied, setPasswordCopied] = useState(false);
  const passwordCopyBtnRef = useRef<HTMLButtonElement>(null);
  const passwordDoneBtnRef = useRef<HTMLButtonElement>(null);
  const passwordModalRef = useRef<HTMLDivElement>(null);
  const passwordRestoreFocusRef = useRef<HTMLElement | null>(null);

  // Focus management + Esc handler for the password-reveal modal. Captures
  // the element that opened it (row button) so we can restore focus on
  // close; autofocuses the Copy button on open; handles Esc; and loops Tab
  // within the modal.
  useEffect(() => {
    if (!passwordReveal) return;

    passwordRestoreFocusRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    // Slight delay so the element is mounted before we focus it.
    const t = setTimeout(() => passwordCopyBtnRef.current?.focus(), 0);

    const closeModal = () => {
      setPasswordReveal(null);
      setPasswordCopied(false);
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        closeModal();
        return;
      }
      if (e.key !== "Tab") return;
      // Minimal focus trap — cycle between Copy and Done, the only two
      // focusable controls. Keeps focus out of the page behind the modal.
      const copy = passwordCopyBtnRef.current;
      const done = passwordDoneBtnRef.current;
      if (!copy || !done) return;
      const active = document.activeElement;
      if (e.shiftKey) {
        if (active === copy || !passwordModalRef.current?.contains(active)) {
          e.preventDefault();
          done.focus();
        }
      } else {
        if (active === done || !passwordModalRef.current?.contains(active)) {
          e.preventDefault();
          copy.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);

    return () => {
      clearTimeout(t);
      window.removeEventListener("keydown", onKey);
      // Restore focus to whatever opened the modal (the row button).
      passwordRestoreFocusRef.current?.focus();
      passwordRestoreFocusRef.current = null;
    };
  }, [passwordReveal]);

  const invitesTable = useSortableTable<InviteRecord, InviteSortKey>({
    rows: invites,
    columns: INVITE_COLUMNS,
    initialSort: { key: "invited", dir: "desc" },
    searchText: inviteSearchText,
  });

  async function fetchInvites() {
    const res = await fetch("/api/admin/invites");
    if (!res.ok) return;
    const data = (await res.json()) as { invites: InviteRecord[] };
    setInvites(data.invites);
  }

  useEffect(() => {
    void (async () => {
      await fetchInvites();
      setLoading(false);
    })();
  }, []);

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
      // Clipboard may be blocked; user can still copy manually from the modal.
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
      {passwordReveal && (
        <div
          ref={passwordModalRef}
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
              For{" "}
              <span className="font-medium text-on-surface">
                {passwordReveal.email}
              </span>
              . This is the only time you&apos;ll see it — copy it now and share it
              with the user over a trusted channel (Teams, work email, in person).
            </p>
            <div className="mt-4 flex items-center gap-2 rounded-[var(--radius-md)] bg-surface-low p-3">
              <code className="flex-1 select-all break-all font-mono text-sm text-on-surface">
                {passwordReveal.passphrase}
              </code>
              <button
                ref={passwordCopyBtnRef}
                type="button"
                onClick={() => void handleCopyPassword()}
                className="shrink-0 rounded-full bg-primary px-3 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                {passwordCopied ? "Copied" : "Copy"}
              </button>
            </div>
            <p className="mt-4 text-[11px] leading-relaxed text-on-surface-variant">
              Tell the user to sign in at <span className="font-mono">/login</span>{" "}
              using{" "}
              <span className="font-medium text-on-surface">
                Sign in with a password
              </span>
              . Their email is the username. If they lose this password, click{" "}
              <span className="font-semibold">reset</span> to generate a new one.
            </p>
            <div className="mt-5 flex justify-end">
              <button
                ref={passwordDoneBtnRef}
                type="button"
                onClick={() => {
                  setPasswordReveal(null);
                  setPasswordCopied(false);
                }}
                className="brand-gradient rounded-full px-5 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}

      <h2 className="font-[family-name:var(--font-display)] mb-1 text-xl font-bold text-on-surface">
        Pilot Invites
      </h2>
      <p className="type-label-md mb-4 text-on-surface-variant">
        Add email addresses to the allowlist. Only invited users can sign in.
      </p>

      <div className="ghost-border shadow-ambient rounded-[var(--radius-lg)] bg-surface-card p-4 mb-4">
        <div className="flex gap-3">
          <input
            type="email"
            value={inviteEmail}
            onChange={(e) => setInviteEmail(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleInvite();
            }}
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
        {inviteError && <p className="mt-2 text-xs text-red-600">{inviteError}</p>}
      </div>

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
                <SortableHeader
                  label="Email"
                  className="col-span-3"
                  {...invitesTable.getSortProps("email")}
                />
                <SortableHeader
                  label="Status"
                  className="col-span-2"
                  {...invitesTable.getSortProps("status")}
                />
                <SortableHeader
                  label="Invited"
                  className="col-span-2"
                  {...invitesTable.getSortProps("invited")}
                />
                <SortableHeader
                  label="Signed up"
                  className="col-span-2"
                  {...invitesTable.getSortProps("signed_up")}
                />
                <SortableHeader
                  label="Last active"
                  className="col-span-2"
                  {...invitesTable.getSortProps("last_active")}
                />
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
                            last asked{" "}
                            {formatRequestedAgo(invite.last_link_expires_at)}
                          </span>
                        )}
                        <button
                          type="button"
                          onClick={() => void handleClearMagicLinks(invite.email)}
                          disabled={clearingLinksEmail === invite.email}
                          className="w-fit text-[10px] font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          title="Delete unused verification tokens so the user can request a fresh link"
                        >
                          {clearingLinksEmail === invite.email
                            ? "clearing…"
                            : "clear requests"}
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
                    {formatShortDate(invite.created_at)}
                  </div>
                  <div className="col-span-2 flex flex-col gap-1 text-xs text-on-surface-variant">
                    <span>{formatShortDate(invite.signed_up_at)}</span>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      {invite.has_password ? (
                        <>
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-on-surface">
                            <svg
                              className="h-2.5 w-2.5"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                              strokeWidth={2.5}
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z"
                              />
                            </svg>
                            password set
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              void handleSetPassword(invite.email, "reset")
                            }
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
                          onClick={() =>
                            void handleSetPassword(invite.email, "set")
                          }
                          disabled={passwordBusyEmail === invite.email}
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-primary transition-colors hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                          title="Generate a memorable passphrase for this user"
                        >
                          {passwordBusyEmail === invite.email
                            ? "generating…"
                            : "set password"}
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
                    <span>{formatShortDate(invite.last_active)}</span>
                    {invite.last_login_at && (
                      <span className="text-[10px]" title="Most recent sign-in">
                        login{" "}
                        {new Date(invite.last_login_at).toLocaleDateString(
                          "en-GB",
                          { day: "numeric", month: "short" },
                        )}
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
  );
}
