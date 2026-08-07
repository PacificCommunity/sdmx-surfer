"use client";

import { Suspense, useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { AppFooter } from "@/components/app-footer";
import { BrandField } from "@/components/brand-field";

function getSafeCallbackUrl(rawCallbackUrl: string | null): string {
  if (!rawCallbackUrl) return "/";
  if (!rawCallbackUrl.startsWith("/")) return "/";
  if (rawCallbackUrl.startsWith("//")) return "/";
  return rawCallbackUrl;
}

type Mode = "magic" | "password";

function LoginForm() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("magic");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (searchParams.get("verify") === "1") {
      setSent(true);
    }
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    // Preserve callbackUrl from query params (e.g. from "Explore this" on published dashboards)
    const callbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"));
    const result = await signIn("email", { email, redirect: false, callbackUrl });

    setLoading(false);

    if (!result) {
      setError("Something went wrong. Please try again.");
      return;
    }

    if (result.error === "AccessDenied") {
      setError("This email is not on the invite list.");
      return;
    }

    if (result.error) {
      setError("Something went wrong. Please try again.");
      return;
    }

    setSent(true);
  }

  async function handlePasswordSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const callbackUrl = getSafeCallbackUrl(searchParams.get("callbackUrl"));
    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
      callbackUrl,
    });

    setLoading(false);

    if (!result || result.error) {
      // Generic message — never reveal whether email, password, or lockout failed.
      setError("Invalid email or password.");
      return;
    }

    router.push(callbackUrl);
    router.refresh();
  }

  return (
    <div className="rounded-[var(--radius-xl)] bg-surface-card shadow-ambient ghost-border p-8">
      {sent ? (
        /* Check email state */
        <div className="flex flex-col items-center gap-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary/10">
            <svg
              className="h-6 w-6 text-on-secondary-container"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
              />
            </svg>
          </div>
          <div>
            <h2 className="type-headline-sm text-on-surface">
              Check your email
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-on-surface-variant">
              We sent a magic link to your inbox. The link expires in{" "}
              <span className="font-semibold text-on-surface">15 minutes</span>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={() => {
              setSent(false);
              setError(null);
            }}
            className="mt-2 text-sm text-on-secondary-container hover:underline"
          >
            Use a different email
          </button>
        </div>
      ) : mode === "magic" ? (
        /* Magic link form */
        <form onSubmit={handleSubmit} noValidate>
          <h2 className="type-headline-sm mb-1 text-on-surface">Sign in</h2>
          <p className="mb-6 text-sm text-on-surface-variant">
            Enter your email to receive a sign-in link.
          </p>

          <div className="mb-4">
            <label
              htmlFor="email"
              className="type-label-md mb-2 block text-on-surface-variant"
            >
              Email address
            </label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={
                "focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 text-sm text-on-surface placeholder:text-text-muted transition-colors" +
                (error ? " border-red-400" : "")
              }
            />
          </div>

          {error && (
            <p className="mb-4 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || email.trim() === ""}
            className="brand-gradient w-full rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? (
              <span className="flex items-center justify-center gap-2">
                <svg
                  className="h-4 w-4 animate-spin"
                  fill="none"
                  viewBox="0 0 24 24"
                >
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
                  />
                </svg>
                Sending...
              </span>
            ) : (
              "Send magic link"
            )}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("password");
              setError(null);
            }}
            className="mt-4 w-full text-center text-xs text-on-surface-variant transition-colors hover:text-primary hover:underline"
          >
            Sign in with a password instead
          </button>

          <p className="mt-4 text-center text-xs text-text-muted">
            Invite-only access. Contact your SPC administrator to request
            access.
          </p>
        </form>
      ) : (
        /* Password form */
        <form onSubmit={handlePasswordSubmit} noValidate>
          <h2 className="type-headline-sm mb-1 text-on-surface">Sign in</h2>
          <p className="mb-6 text-sm text-on-surface-variant">
            Use the passphrase your administrator shared with you.
          </p>

          <div className="mb-4">
            <label
              htmlFor="pw-email"
              className="type-label-md mb-2 block text-on-surface-variant"
            >
              Email address
            </label>
            <input
              id="pw-email"
              type="email"
              autoComplete="username"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className={
                "focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 text-sm text-on-surface placeholder:text-text-muted transition-colors" +
                (error ? " border-red-400" : "")
              }
            />
          </div>

          <div className="mb-4">
            <label
              htmlFor="pw-password"
              className="type-label-md mb-2 block text-on-surface-variant"
            >
              Passphrase
            </label>
            <input
              id="pw-password"
              type="password"
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="cheerful-indigo-otter42!"
              className={
                "focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 font-mono text-sm text-on-surface placeholder:text-text-muted transition-colors" +
                (error ? " border-red-400" : "")
              }
            />
          </div>

          {error && (
            <p className="mb-4 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading || email.trim() === "" || password === ""}
            className="brand-gradient w-full rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {loading ? "Signing in..." : "Sign in"}
          </button>

          <button
            type="button"
            onClick={() => {
              setMode("magic");
              setError(null);
              setPassword("");
            }}
            className="mt-4 w-full text-center text-xs text-on-surface-variant transition-colors hover:text-primary hover:underline"
          >
            ← Use a magic link instead
          </button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    // A split field: the brand carries the left, the form sits on a plain
    // surface at the right. The pattern runs at full strength on the brand
    // side because nothing is read over it, which is the rule the rest of the
    // app follows; the form never sits on pattern at any width.
    <div className="flex min-h-screen flex-col lg:flex-row">
      <BrandField
        variant="hero"
        patternArea="full"
        className="flex items-center justify-center px-8 py-12 lg:w-[46%] lg:py-0"
      >
        <div className="flex max-w-sm flex-col items-start gap-6">
          <img
            src="/brand/logos/logo_horizontal_white_orange.svg"
            alt="Pacific Data Hub"
            className="h-10 w-auto"
          />
          <img
            src="/brand/wordmark/data-surfer-white.svg"
            alt="Data Surfer"
            className="h-16 w-auto"
          />
          <p className="text-base leading-relaxed text-white/85">
            Explore Pacific statistics by asking for them. Every figure traces
            back to the source it came from.
          </p>
        </div>
      </BrandField>

      <div className="flex flex-1 items-center justify-center bg-surface px-4 py-12">
        <div className="w-full max-w-sm">
          <Suspense
            fallback={
              <div className="rounded-[var(--radius-xl)] bg-surface-card shadow-ambient ghost-border p-8">
                <div className="shimmer h-48 rounded-[var(--radius-md)]" />
              </div>
            }
          >
            <LoginForm />
          </Suspense>

          <AppFooter className="mt-6" compact />
        </div>
      </div>
    </div>
  );
}
