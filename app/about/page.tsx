import Link from "next/link";
import { SurferLogo } from "@/components/surfer-logo";
import { AppFooter } from "@/components/app-footer";

export const metadata = {
  title: "About · Data Surfer",
  description: "About Data Surfer, the people who built it, and what it records.",
};

export default async function AboutPage({
  searchParams,
}: {
  searchParams: Promise<{ deleted?: string }>;
}) {
  // Where Settings lands someone who has just deleted their account.
  const { deleted } = await searchParams;
  return (
    <div className="min-h-screen">
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="brand-gradient flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] transition-transform hover:scale-105"
            >
              <SurferLogo className="h-5 w-5 text-white" />
            </Link>
            <div>
              <h1 className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-primary">
                About
              </h1>
              <p className="type-label-md text-on-tertiary-fixed-variant">
                Data Surfer
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        {deleted === "1" && (
          <p
            role="status"
            className="mb-8 rounded-[var(--radius-lg)] bg-surface-card p-4 text-sm leading-relaxed text-on-surface shadow-ambient"
          >
            Your account has been deleted and you have been signed out. What
            is kept, and for how long, is set out under{" "}
            <a href="#what-we-record" className="font-semibold text-primary underline">
              What we record
            </a>
            .
          </p>
        )}
        <section className="rounded-[var(--radius-2xl)] bg-gradient-to-br from-primary via-primary-container to-primary px-8 py-10 text-white">
          <p className="type-label-md text-white/70">About</p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight">
            Data Surfer
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80">
            A conversational companion for SDMx statistical platforms.
            Built at the Pacific Community (SPC), open source, currently in alpha.
          </p>
        </section>

        <section className="mt-8 rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient">
          <p className="type-label-md text-on-tertiary-fixed-variant">
            People
          </p>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary">
            Built by
          </h3>

          <dl className="mt-6 space-y-5 text-sm text-on-surface">
            <div>
              <dt className="font-semibold text-primary">
                Giulio Valentino Dalla Riva
              </dt>
              <dd className="mt-1 text-on-surface-variant">
                Data Surfer application, and the SDMx MCP gateway behind it
              </dd>
            </div>
            <div>
              <dt className="font-semibold text-primary">
                Stanislas Ozier and Thomas Tilak
              </dt>
              <dd className="mt-1 text-on-surface-variant">
                sdmx-dashboard-components, the open source library that renders
                every dashboard you see here
              </dd>
            </div>
          </dl>

          <p className="mt-8 text-sm text-on-surface-variant">
            All at the Pacific Community (SPC).
          </p>
        </section>

        <section
          id="what-we-record"
          className="mt-8 scroll-mt-24 rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient"
        >
          <p className="type-label-md text-on-tertiary-fixed-variant">
            Your data
          </p>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary">
            What we record
          </h3>

          <ul className="mt-6 list-disc space-y-3 pl-5 text-sm leading-relaxed text-on-surface">
            <li>
              Your account: your email address and how you sign in. If you
              sign in with Google, Microsoft or GitHub, also the name and
              picture they share.
            </li>
            <li>
              Your dashboards and the chat that built them, until you delete
              them. Deleted dashboards are erased for good after 30 days.
            </li>
            <li>
              Usage records for each request to the assistant, including short
              excerpts of your prompt and of the reply. Only the Data Surfer
              administrators can read them, for quality review and to handle
              abuse. The excerpts are removed after 3 months. The usage counts
              and costs are kept, because they count toward the service&apos;s
              AI budget.
            </li>
            <li>
              Sign-in and security events, such as a failed sign-in and the IP
              address it came from. They are kept for 3 months.
            </li>
            <li>
              API keys you choose to add are stored encrypted (AES-256-GCM).
              Passwords are stored only as Argon2id hashes.
            </li>
          </ul>

          <p className="mt-6 text-sm leading-relaxed text-on-surface-variant">
            There are no advertising or analytics trackers. Your chat messages
            are sent to an AI provider to generate the replies. The statistics
            themselves come from public SDMx APIs.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            You can delete your account yourself, in Settings. That removes
            your dashboards, API keys and sign-in details at once; deleted
            dashboards are erased for good after 30 days. Records of your past
            use are kept for 3 months so the administrators can review misuse,
            and are then no longer linked to you.
          </p>
        </section>

        <AppFooter />
      </main>
    </div>
  );
}
