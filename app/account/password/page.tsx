import { redirect } from "next/navigation";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { SurferLogo } from "@/components/surfer-logo";
import { ChangePasswordForm } from "./change-password-form";

export default async function AccountPasswordPage() {
  const session = await auth();
  if (!session?.user?.userId || !session.user.email) {
    redirect("/login?callbackUrl=/account/password");
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-4">
        <div className="mx-auto flex max-w-3xl items-center gap-4">
          <Link
            href="/"
            className="ghost-border flex h-9 w-9 items-center justify-center rounded-full bg-surface-card text-on-surface-variant transition-transform hover:scale-105 hover:text-primary"
            title="Back to home"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
            </svg>
          </Link>
          <div className="flex items-center gap-3">
            <div className="brand-gradient flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)]">
              <SurferLogo className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="type-headline-sm text-on-surface">Account</h1>
              <p className="type-label-md text-on-surface-variant">
                Change your password
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-md px-6 py-12">
        <div className="rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient">
          <h2 className="font-[family-name:var(--font-display)] text-xl font-bold text-on-surface">
            Change password
          </h2>
          <p className="mt-1 text-xs text-on-surface-variant">
            Signed in as{" "}
            <span className="font-medium text-on-surface">{session.user.email}</span>
          </p>

          <ChangePasswordForm />

          <p className="mt-6 text-[11px] leading-relaxed text-on-surface-variant">
            Forgot your current password? Ask an admin to reset it for you.
            New passwords are stored only as an argon2id hash — we never keep
            the plaintext.
          </p>
        </div>
      </main>
    </div>
  );
}
