"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SurferLogo } from "@/components/surfer-logo";
import { AppFooter } from "@/components/app-footer";

interface PublishedDashboardSummary {
  id: string;
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
}

export default function GalleryPage() {
  const [dashboards, setDashboards] = useState<PublishedDashboardSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/public/dashboards", { cache: "no-store" });
        if (!res.ok) {
          setDashboards([]);
          return;
        }
        const data = await res.json() as { dashboards?: PublishedDashboardSummary[] };
        setDashboards(Array.isArray(data.dashboards) ? data.dashboards : []);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

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
                Published Dashboards
              </h1>
              <p className="type-label-md text-on-tertiary-fixed-variant">
                Public gallery
              </p>
            </div>
          </div>

          <Link
            href="/builder?new=1"
            className="brand-gradient rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
          >
            Open Builder
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        <section className="mb-8 rounded-[var(--radius-2xl)] bg-gradient-to-br from-primary via-primary-container to-primary px-8 py-10 text-white">
          <p className="type-label-md text-white/70">Gallery</p>
          <h2 className="mt-2 font-[family-name:var(--font-display)] text-4xl font-extrabold tracking-tight">
            Explore published SDMX dashboards
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-white/80">
            Browse dashboards shared from SDMX Surfer. Open any dashboard to
            inspect the charts, export it, or continue the exploration in the builder.
          </p>
        </section>

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2, 3, 4, 5].map((index) => (
              <div
                key={index}
                className="shimmer h-52 rounded-[var(--radius-xl)] bg-surface-card shadow-ambient"
              />
            ))}
          </div>
        ) : dashboards.length === 0 ? (
          <div className="submerged-overlay rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
            <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-surface-high">
              <SurferLogo className="h-8 w-8 text-accent-muted" />
            </div>
            <h3 className="type-headline-sm text-on-surface">
              No published dashboards yet
            </h3>
            <p className="mt-3 text-sm text-on-surface-variant">
              Publish a dashboard from the builder and it will appear here.
            </p>
          </div>
        ) : (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {dashboards.map((dashboard) => (
              <Link
                key={dashboard.id}
                href={"/p/" + dashboard.id}
                className="group rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient transition-all hover:-translate-y-0.5 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="mb-4 flex items-start justify-between gap-3">
                  <span className="type-label-md rounded-full bg-secondary-container px-2.5 py-0.5 text-on-secondary-container">
                    Published
                  </span>
                  {dashboard.publishedAt && (
                    <span className="text-[11px] text-on-surface-variant">
                      {new Date(dashboard.publishedAt).toLocaleDateString("en-GB", {
                        day: "numeric",
                        month: "short",
                        year: "numeric",
                        timeZone: "UTC",
                      })}
                    </span>
                  )}
                </div>
                <h3 className="font-[family-name:var(--font-display)] text-xl font-bold tracking-tight text-on-surface group-hover:text-primary">
                  {dashboard.title}
                </h3>
                {dashboard.description && (
                  <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
                    {dashboard.description}
                  </p>
                )}
                <div className="mt-5 flex items-center justify-between text-xs">
                  <span className="font-semibold uppercase tracking-[0.12em] text-on-tertiary-fixed-variant">
                    {dashboard.author || "Anonymous"}
                  </span>
                  <span className="text-primary transition-transform group-hover:translate-x-0.5">
                    Open
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
        <AppFooter />
      </main>
    </div>
  );
}
