"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { getSession, signOut } from "next-auth/react";

/**
 * Self-service account deletion, kept apart from the rest of Settings.
 *
 * The user confirms by typing their address; the server checks it again
 * (app/api/account/route.ts). On success the server has already cleared this
 * browser's session cookie, and the client signs out as well before landing
 * on the confirmation on /about.
 */
export function DangerZone() {
  const [email, setEmail] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    void getSession().then((session) => setEmail(session?.user?.email ?? null));
  }, []);

  const matches = email !== null && typed.trim().toLowerCase() === email.toLowerCase();

  async function handleDelete() {
    if (!matches) return;
    setDeleting(true);
    setError("");
    try {
      const res = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmEmail: typed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Your account could not be deleted. Please try again.");
        setDeleting(false);
        return;
      }
      await signOut({ redirectTo: "/about?deleted=1#what-we-record" });
    } catch {
      setError("Network error. Please try again.");
      setDeleting(false);
    }
  }

  if (!email) return null;

  return (
    <section
      aria-labelledby="danger-zone-title"
      className="mt-12 rounded-[var(--radius-lg)] border border-red-300 bg-surface-card p-6"
    >
      <h2 id="danger-zone-title" className="type-headline-sm text-red-700">
        Delete account
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
        This removes, at once, your dashboards (including published ones, which
        leave the gallery and their public links), your API keys and your
        sign-in details. Deleted dashboards are erased for good after 30 days.
        Records of your past use are kept for 3 months so the administrators
        can review misuse, and then are no longer linked to you. This cannot
        be undone; you can register again later with the same address if you
        are still admitted.{" "}
        <Link href="/about#what-we-record" className="font-semibold text-primary underline">
          What we record
        </Link>
      </p>

      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="mt-4 rounded-[var(--radius-sm)] border border-red-300 px-4 py-2 text-sm font-semibold text-red-700 transition-colors hover:bg-red-50"
        >
          Delete my account…
        </button>
      ) : (
        <div className="mt-4 space-y-3">
          <label htmlFor="confirm-delete-email" className="block text-sm text-on-surface">
            Type <span className="font-semibold">{email}</span> to confirm.
          </label>
          <input
            id="confirm-delete-email"
            type="email"
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            className="focus-architectural ghost-border w-full rounded-[var(--radius-sm)] bg-surface-low px-3 py-2 text-sm text-on-surface transition-colors placeholder:text-text-muted hover:bg-surface-high"
          />
          {error && (
            <p role="alert" className="text-sm text-red-700">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => void handleDelete()}
              disabled={!matches || deleting}
              className="rounded-[var(--radius-sm)] bg-red-600 px-4 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {deleting ? "Deleting..." : "Delete my account permanently"}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                setTyped("");
                setError("");
              }}
              disabled={deleting}
              className="ghost-border rounded-[var(--radius-sm)] px-4 py-2 text-sm font-semibold text-on-surface-variant transition-colors hover:bg-surface-high disabled:cursor-not-allowed disabled:opacity-50"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
