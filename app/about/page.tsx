import Link from "next/link";
import { SurferLogo } from "@/components/surfer-logo";
import { AppFooter } from "@/components/app-footer";

export const metadata = {
  title: "About · Data Surfer",
  description: "About Data Surfer, Country Snapshots and the people who built them.",
};

export default function AboutPage() {
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
          id="country-snapshots"
          className="mt-8 scroll-mt-24 rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient"
        >
          <p className="type-label-md text-on-tertiary-fixed-variant">
            Sibling product
          </p>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-2xl font-bold tracking-tight text-primary">
            Country Snapshots
          </h3>
          <p className="mt-4 text-sm leading-relaxed text-on-surface">
            Curated statistical profiles of the 22 Pacific Island Countries and
            Territories, organised in twelve themes from health and education to
            oceans, governance and official development assistance. The indicator
            list is maintained by SPC&apos;s Statistics for Development Division,
            and every figure is read live from the Pacific Data Hub .Stat data
            platform, with a link to its source dataset.
          </p>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            Snapshots can be compared across countries, summarised regionally, and
            opened in Data Surfer to explore further.
          </p>
        </section>

        <AppFooter />
      </main>
    </div>
  );
}
