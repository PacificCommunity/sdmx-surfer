"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";

/**
 * Intermediate page for magic link sign-in.
 *
 * The email links to this page (not directly to the NextAuth callback).
 * Outlook SafeLinks pre-fetches the URL but can't click buttons —
 * so the actual auth callback is only triggered when a real user clicks.
 */

function VerifyContent() {
  const searchParams = useSearchParams();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Support both ?ref=<id> (production) and ?url=<callback> (dev fallback)
  const refId = searchParams.get("ref");
  const directUrl = searchParams.get("url");

  async function handleSignIn() {
    setLoading(true);
    setError(null);

    if (directUrl) {
      // Dev fallback — URL passed directly
      window.location.href = directUrl;
      return;
    }

    if (!refId) return;

    try {
      const res = await fetch("/api/auth/magic-link-ref?ref=" + encodeURIComponent(refId));
      const data = await res.json();

      if (!res.ok || !data.url) {
        setError(data.error || "This link has expired or already been used.");
        setLoading(false);
        return;
      }

      window.location.href = data.url;
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (!refId && !directUrl) {
    return (
      <div className="rounded-[var(--radius-xl)] bg-surface-card shadow-ambient ghost-border p-8 text-center">
        <p className="text-sm text-on-surface-variant">
          Invalid or missing sign-in link.
        </p>
        <a
          href="/login"
          className="mt-4 inline-block text-sm text-primary hover:underline"
        >
          Back to login
        </a>
      </div>
    );
  }

  return (
    <div className="rounded-[var(--radius-xl)] bg-surface-card shadow-ambient ghost-border p-8 text-center">
      <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary/10">
        <svg
          className="h-6 w-6 text-secondary"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={1.5}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12.75L11.25 15 15 9.75m-3-7.036A11.959 11.959 0 013.598 6 11.99 11.99 0 003 9.749c0 5.592 3.824 10.29 9 11.623 5.176-1.332 9-6.03 9-11.622 0-1.31-.21-2.571-.598-3.751h-.152c-3.196 0-6.1-1.248-8.25-3.285z"
          />
        </svg>
      </div>
      <h2 className="type-headline-sm text-on-surface">
        Confirm sign in
      </h2>
      <p className="mt-2 text-sm text-on-surface-variant">
        Click the button below to complete your sign in to the SPC Dashboard Builder.
      </p>
      {error && (
        <p className="mt-4 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}
      <button
        type="button"
        onClick={handleSignIn}
        disabled={loading}
        className="brand-gradient mt-6 inline-block rounded-full px-8 py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
      >
        {loading ? "Signing in..." : "Sign in now"}
      </button>
      <p className="mt-4 text-xs text-on-surface-variant">
        This link expires in 15 minutes.
      </p>
    </div>
  );
}

export default function VerifyPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-4 text-center">
          <div className="brand-gradient flex h-14 w-14 items-center justify-center rounded-[var(--radius-lg)] shadow-ambient">
            <svg
              className="h-8 w-8 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
              />
            </svg>
          </div>
          <h1 className="type-headline-sm text-on-surface">
            SPC Dashboard Builder
          </h1>
        </div>

        <Suspense
          fallback={
            <div className="rounded-[var(--radius-xl)] bg-surface-card shadow-ambient ghost-border p-8">
              <div className="shimmer h-32 rounded-[var(--radius-md)]" />
            </div>
          }
        >
          <VerifyContent />
        </Suspense>
      </div>
    </div>
  );
}
