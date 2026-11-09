"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { z } from "zod";
import { describeDomainRules, unverifiedSignupAllows } from "@/lib/unverified-signup";

export interface PasswordPolicy {
  minLength: number;
  maxLength: number;
}

const startResponseSchema = z.object({
  proofId: z.string(),
  address: z.string(),
  subject: z.string(),
  body: z.string(),
  expiresAt: z.string(),
});
type StartedProof = z.infer<typeof startResponseSchema> & { email: string };

const statusResponseSchema = z.object({
  status: z.enum(["pending", "verified", "rejected", "expired"]),
  reason: z.string().optional(),
});

const errorResponseSchema = z.object({ error: z.string() });

const POLL_MS = 3000;

const INPUT_CLASS =
  "focus-architectural w-full rounded-[var(--radius-md)] border border-outline-variant bg-surface-low px-4 py-3 text-sm text-on-surface placeholder:text-text-muted transition-colors";
const PRIMARY_BUTTON_CLASS =
  "brand-gradient flex w-full items-center justify-center rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-all hover:opacity-90 active:scale-95 disabled:cursor-not-allowed disabled:opacity-50";
const LINK_BUTTON_CLASS =
  "mt-4 w-full text-center text-xs text-on-surface-variant transition-colors hover:text-primary hover:underline";

/** What to tell the user about a refused proof. Reasons come from lib/email-proof. */
function rejectionMessage(reason: string | undefined, email: string): string {
  switch (reason) {
    case "dmarc_not_pass":
    case "no_authentication":
      return (
        "Your organisation's mail system didn't authenticate this message, so " +
        "it can't prove the address. Ask the Surfer admin for another way in."
      );
    case "sender_mismatch":
      return "The message came from a different address. Send it from " + email + " exactly.";
    case "expired":
    case "already_used":
      return "This attempt has expired. Please start again.";
    default:
      return "We couldn't check your message. Please start again.";
  }
}

/**
 * Self-service signup or password reset: choose a password, then prove the
 * address by sending one email from it (see lib/email-proof.ts). A signup at a
 * `UNVERIFIED_SIGNUP_DOMAINS` domain skips the proof and is created directly
 * (see lib/unverified-signup.ts); reset is always by email proof.
 */
export function EmailProofPanel({
  purpose,
  callbackUrl,
  passwordPolicy,
  emailProofEnabled,
  unverifiedRules,
  onBack,
}: {
  purpose: "signup" | "reset";
  callbackUrl: string;
  passwordPolicy: PasswordPolicy;
  /** Whether the email-proof flow is configured. */
  emailProofEnabled: boolean;
  /** `UNVERIFIED_SIGNUP_DOMAINS` rules; empty when that signup is off. */
  unverifiedRules: string[];
  onBack: () => void;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proof, setProof] = useState<StartedProof | null>(null);
  const [copied, setCopied] = useState(false);

  // Poll until the webhook settles the proof. A rejection or expiry sets an
  // error, which ends the poll; verification signs in.
  useEffect(() => {
    if (!proof || error) return;
    let cancelled = false;
    const timer = setInterval(async () => {
      const res = await fetch(
        "/api/auth/email-proof/status?id=" + encodeURIComponent(proof.proofId),
        { cache: "no-store" },
      ).catch(() => null);
      if (cancelled || !res) return;
      if (!res.ok) {
        setError("This attempt can no longer be checked. Please start again.");
        return;
      }
      const parsed = statusResponseSchema.safeParse(await res.json());
      if (cancelled || !parsed.success) return;
      const { status, reason } = parsed.data;
      if (status === "verified") {
        cancelled = true;
        clearInterval(timer);
        await signIn("email-proof", { proofId: proof.proofId, redirect: true, callbackUrl });
      } else if (status === "rejected") {
        setError(rejectionMessage(reason, proof.email));
      } else if (status === "expired") {
        setError(rejectionMessage("expired", proof.email));
      }
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [proof, error, callbackUrl]);

  async function handleStart(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < passwordPolicy.minLength || password.length > passwordPolicy.maxLength) {
      setError(
        "Password must be " + passwordPolicy.minLength + " to " +
          passwordPolicy.maxLength + " characters.",
      );
      return;
    }
    if (password !== confirm) {
      setError("The passwords don't match.");
      return;
    }

    if (purpose === "signup" && unverifiedSignupAllows(email, unverifiedRules)) {
      await createUnverifiedAccount();
      return;
    }
    if (!emailProofEnabled) {
      setError(
        "Self-service accounts are only open to addresses at " +
          describeDomainRules(unverifiedRules) +
          "; ask the Surfer admin for access.",
      );
      return;
    }

    setLoading(true);
    const res = await fetch("/api/auth/email-proof/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, purpose }),
    }).catch(() => null);
    setLoading(false);

    const json: unknown = res ? await res.json().catch(() => null) : null;
    const started = res?.ok ? startResponseSchema.safeParse(json) : null;
    if (!started?.success) {
      const failure = errorResponseSchema.safeParse(json);
      setError(failure.success ? failure.data.error : "Something went wrong. Please try again.");
      return;
    }
    setPassword("");
    setConfirm("");
    setProof({ ...started.data, email: email.trim().toLowerCase() });
  }

  /** Create the account directly, then sign in with the password just chosen. */
  async function createUnverifiedAccount() {
    setLoading(true);
    const res = await fetch("/api/auth/signup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    }).catch(() => null);
    if (!res?.ok) {
      setLoading(false);
      const failure = errorResponseSchema.safeParse(
        res ? await res.json().catch(() => null) : null,
      );
      setError(failure.success ? failure.data.error : "Something went wrong. Please try again.");
      return;
    }
    // Leaves the page on success, so loading stays on.
    await signIn("credentials", {
      email: email.trim().toLowerCase(),
      password,
      redirect: true,
      callbackUrl,
    });
  }

  function restart() {
    setProof(null);
    setError(null);
    setCopied(false);
  }

  async function copyAddress(address: string) {
    try {
      await navigator.clipboard.writeText(address);
      setCopied(true);
    } catch {
      // Clipboard refused (permissions, insecure origin); the field stays selectable.
    }
  }

  const heading = purpose === "signup" ? "Create an account" : "Reset your password";
  const unverifiedDomains = describeDomainRules(unverifiedRules);
  let intro =
    (purpose === "signup" ? "For staff of approved organisations and invited users. " : "") +
    "Choose a password, then prove your address by sending us one email.";
  if (purpose === "signup" && unverifiedRules.length > 0) {
    intro = emailProofEnabled
      ? "Choose a password. Addresses at " + unverifiedDomains + " are signed in " +
        "straight away; other approved organisations and invited users then " +
        "prove their address by sending us one email."
      : "For staff at " + unverifiedDomains + ". Choose a password to create " +
        "your account.";
  }

  if (proof) {
    const mailto =
      "mailto:" + proof.address +
      "?subject=" + encodeURIComponent(proof.subject) +
      "&body=" + encodeURIComponent(proof.body);
    const expiresAt = new Date(proof.expiresAt).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
    });

    return (
      <div>
        <h2 className="type-headline-sm mb-1 text-on-surface">Prove your address</h2>
        <p className="mb-5 text-sm leading-relaxed text-on-surface-variant">
          Send one email from{" "}
          <span className="font-semibold text-on-surface">{proof.email}</span> to
          prove the address is yours. We never send anything to your inbox.
        </p>

        <a href={mailto} className={PRIMARY_BUTTON_CLASS}>
          Open my email app
        </a>

        <label
          htmlFor="proof-address"
          className="type-label-md mb-2 mt-5 block text-on-surface-variant"
        >
          Or send any message to
        </label>
        <div className="flex gap-2">
          <input
            id="proof-address"
            readOnly
            value={proof.address}
            onFocus={(e) => e.currentTarget.select()}
            className={INPUT_CLASS + " font-mono text-xs"}
          />
          <button
            type="button"
            onClick={() => copyAddress(proof.address)}
            className="shrink-0 rounded-[var(--radius-md)] bg-surface-high px-3 text-xs font-medium text-on-surface transition-colors hover:bg-surface-high/70"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-xs text-text-muted">
          Send it within 15 minutes (by {expiresAt}). The subject and text don&apos;t
          matter; the sender address does.
        </p>

        {error ? (
          <>
            <p className="mt-5 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
              {error}
            </p>
            <button type="button" onClick={restart} className={LINK_BUTTON_CLASS}>
              Start again
            </button>
          </>
        ) : (
          <p className="mt-5 flex items-center gap-2 text-sm text-on-surface-variant">
            <span className="h-2 w-2 animate-pulse rounded-full bg-secondary" />
            Waiting for your email…
          </p>
        )}

        <button type="button" onClick={onBack} className={LINK_BUTTON_CLASS}>
          ← Back to sign in
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleStart} noValidate>
      <h2 className="type-headline-sm mb-1 text-on-surface">{heading}</h2>
      <p className="mb-6 text-sm text-on-surface-variant">{intro}</p>

      <div className="mb-4">
        <label htmlFor="proof-email" className="type-label-md mb-2 block text-on-surface-variant">
          Work email
        </label>
        <input
          id="proof-email"
          type="email"
          autoComplete="username"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.org"
          className={INPUT_CLASS}
        />
      </div>

      <div className="mb-4">
        <label htmlFor="proof-password" className="type-label-md mb-2 block text-on-surface-variant">
          {purpose === "signup" ? "Password" : "New password"}
        </label>
        <input
          id="proof-password"
          type="password"
          autoComplete="new-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={INPUT_CLASS + " font-mono"}
        />
        <p className="mt-1 text-xs text-text-muted">
          {passwordPolicy.minLength}–{passwordPolicy.maxLength} characters. A few
          unrelated words work well.
        </p>
      </div>

      <div className="mb-4">
        <label htmlFor="proof-confirm" className="type-label-md mb-2 block text-on-surface-variant">
          Confirm password
        </label>
        <input
          id="proof-confirm"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          className={INPUT_CLASS + " font-mono"}
        />
      </div>

      {error && (
        <p className="mb-4 rounded-[var(--radius-sm)] bg-red-50 px-3 py-2 text-xs font-medium text-red-700">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading || email.trim() === "" || password === "" || confirm === ""}
        className={PRIMARY_BUTTON_CLASS}
      >
        {loading ? "Starting..." : "Continue"}
      </button>

      <button type="button" onClick={onBack} className={LINK_BUTTON_CLASS}>
        ← Back to sign in
      </button>
    </form>
  );
}
