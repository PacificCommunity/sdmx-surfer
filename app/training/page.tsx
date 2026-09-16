"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";

/**
 * Workshop sign-in. One shared code in, one personal account out.
 *
 * The account is kept in localStorage as well as shown, so reloading the page
 * hands back the same credentials instead of spending another slot from the
 * pool, and a participant who signs out during the day can find them again.
 */

type Account = { email: string; password: string };

const STORE_KEY = "training-account";

function readStored(): Account | null {
  try {
    const raw = window.localStorage.getItem(STORE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Account;
    return parsed?.email && parsed?.password ? parsed : null;
  } catch {
    return null;
  }
}

export default function TrainingPage() {
  const [code, setCode] = useState("");
  const [account, setAccount] = useState<Account | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setAccount(readStored());
  }, []);

  async function claim(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/training/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Try again.");
        return;
      }
      const claimed = { email: data.email, password: data.password };
      try {
        window.localStorage.setItem(STORE_KEY, JSON.stringify(claimed));
      } catch {
        // A locked-down browser still gets the credentials on screen.
      }
      setAccount(claimed);
    } catch {
      setError("Could not reach the server. Check the wifi and try again.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (!account) return;
    setBusy(true);
    await signIn("credentials", {
      email: account.email,
      password: account.password,
      callbackUrl: "/builder",
    });
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface px-4 py-12">
      <div className="w-full max-w-md rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient ghost-border">
        <h1 className="type-headline-sm text-on-surface">Data Surfer training</h1>

        {account ? (
          <>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              This is your account for today. Write it down: you will need it if
              you sign out.
            </p>
            <dl className="mt-6 space-y-3 rounded-[var(--radius-md)] bg-surface-low p-4">
              <div>
                <dt className="type-label-md text-on-surface-variant">Username</dt>
                <dd className="font-mono text-sm text-on-surface">{account.email}</dd>
              </div>
              <div>
                <dt className="type-label-md text-on-surface-variant">Passphrase</dt>
                <dd className="font-mono text-sm text-on-surface">{account.password}</dd>
              </div>
            </dl>
            <button
              type="button"
              onClick={start}
              disabled={busy}
              className="brand-gradient mt-6 w-full rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Signing in..." : "Start building"}
            </button>
          </>
        ) : (
          <form onSubmit={claim} noValidate>
            <p className="mt-2 mb-6 text-sm leading-relaxed text-on-surface-variant">
              Enter the code from the screen to get your account for today.
            </p>
            <label
              htmlFor="code"
              className="type-label-md mb-2 block text-on-surface-variant"
            >
              Access code
            </label>
            <input
              id="code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              autoFocus
              autoComplete="off"
              required
              className="focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 text-sm text-on-surface placeholder:text-text-muted transition-colors"
            />
            {error && (
              <p className="mt-4 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
                {error}
              </p>
            )}
            <button
              type="submit"
              disabled={busy || code.trim() === ""}
              className="brand-gradient mt-6 w-full rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? "Getting your account..." : "Get my account"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
