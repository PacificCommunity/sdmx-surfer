import Link from "next/link";
import { SurferLogo } from "@/components/surfer-logo";
import { AppFooter } from "@/components/app-footer";

export const metadata = {
  title: "About · SDMX Surfer",
  description: "About SDMX Surfer and the people who built it.",
};

export default function AboutPage() {
  return (
    <div className="min-h-screen bg-surface">
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
                SDMX Surfer
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-10">
        <section className="rounded-[var(--radius-2xl)] bg-gradient-to-br from-primary via-primary-container to-primary px-8 py-10 text-white">
          <p className="type-label-md text-white/70">About</p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight">
            SDMX Surfer
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80">
            A conversational companion for SDMX statistical platforms.
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
                SDMX Surfer application, and the SDMX MCP gateway behind it
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

        <AppFooter />
      </main>
    </div>
  );
}
