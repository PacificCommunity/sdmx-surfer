import Link from "next/link";
import { BrandField } from "@/components/brand-field";
import { AppFooter } from "@/components/app-footer";

export const metadata = { title: "Page not found — Data Surfer" };

/**
 * 404.
 *
 * There was no not-found.tsx, so Next served its own bare default: black
 * Helvetica on white, no navigation, nothing identifying the service. A 404 is
 * reached by people who followed a stale link or mistyped, which makes it one
 * of the few pages guaranteed to be seen by someone who is already slightly
 * lost, and the worst place to give them a dead end.
 *
 * The pattern runs at panel strength here, since nothing is being read beyond
 * two short lines, and the links out matter more than the apology.
 */
export default function NotFound() {
  return (
    <div className="flex min-h-screen flex-col">
      <BrandField
        variant="panel"
        className="flex flex-1 items-center justify-center px-6 py-16"
      >
        <div className="max-w-md text-center">
          <img
            src="/brand/wordmark/data-surfer.svg"
            alt="Data Surfer"
            className="mx-auto mb-8 h-12 w-auto"
          />
          <p className="type-label-md mb-2 text-on-tertiary-fixed-variant">
            404
          </p>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-on-surface">
            That page isn&rsquo;t here
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            The link may be out of date, or the dashboard it pointed to may have
            been unpublished by its author.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="rounded-[var(--radius-md)] bg-primary px-4 py-2 text-sm font-medium text-on-primary transition-colors hover:bg-primary-dark"
            >
              Go to Data Surfer
            </Link>
            <Link
              href="/explore"
              className="ghost-border rounded-[var(--radius-md)] bg-surface-card px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:text-primary"
            >
              Browse the catalogue
            </Link>
            <Link
              href="/gallery"
              className="ghost-border rounded-[var(--radius-md)] bg-surface-card px-4 py-2 text-sm font-medium text-on-surface transition-colors hover:text-primary"
            >
              Published dashboards
            </Link>
          </div>
        </div>
      </BrandField>

      <AppFooter className="" />
    </div>
  );
}
