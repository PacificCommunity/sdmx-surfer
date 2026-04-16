"use client";

import { useState } from "react";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError("New password fields do not match.");
      return;
    }
    if (newPassword.length < 12) {
      setError("New password must be at least 12 characters.");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/account/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        setError(data.error ?? "Failed to update password.");
        return;
      }
      setSuccess(true);
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {success && (
        <div className="mt-5 rounded-[var(--radius-md)] bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-700">
          Password updated.
        </div>
      )}

      <form onSubmit={handleSubmit} noValidate className="mt-6 space-y-4">
        <div>
          <label
            htmlFor="current"
            className="type-label-md mb-2 block text-on-surface-variant"
          >
            Current password
          </label>
          <input
            id="current"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            className="focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 font-mono text-sm text-on-surface transition-colors"
          />
        </div>

        <div>
          <label
            htmlFor="new"
            className="type-label-md mb-2 block text-on-surface-variant"
          >
            New password
          </label>
          <input
            id="new"
            type="password"
            autoComplete="new-password"
            required
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="at least 12 characters"
            className="focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 font-mono text-sm text-on-surface placeholder:text-text-muted transition-colors"
          />
        </div>

        <div>
          <label
            htmlFor="confirm"
            className="type-label-md mb-2 block text-on-surface-variant"
          >
            Confirm new password
          </label>
          <input
            id="confirm"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            className="focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 font-mono text-sm text-on-surface transition-colors"
          />
        </div>

        {error && (
          <p className="rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={
            loading || !currentPassword || !newPassword || !confirmPassword
          }
          className="brand-gradient w-full rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? "Updating…" : "Change password"}
        </button>
      </form>
    </>
  );
}
