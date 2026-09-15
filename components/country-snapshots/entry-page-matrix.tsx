"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import type { Country, Theme } from "@/lib/country-snapshots/catalogue";
import { themeEmoji } from "@/lib/country-snapshots/theme-emoji";

export function EntryPageMatrix({
  countries,
  themes,
}: {
  countries: Country[];
  themes: Theme[];
}) {
  const [pivot, setPivot] = useState<"by-country" | "by-theme">("by-country");
  const sortedCountries = useMemo(
    () =>
      [...countries].sort((a, b) =>
        a.name.localeCompare(b.name, "en"),
      ),
    [countries],
  );

  return (
    <section className="mt-8">
      <div className="mb-3 rounded-md bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-on-surface">
            Regional summaries
          </h2>
          <span className="text-xs text-neutral-500">
            one chart per indicator across MFAT-priority countries
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {themes.map((t) => (
            <Link
              key={t.id}
              href={`/countrysnapshots/regional/${t.slug}`}
              className="rounded-full bg-primary px-3 py-1 text-xs text-white hover:bg-primary-dark"
            >
              <span className="mr-1">{themeEmoji(t.id)}</span>
              {t.title}
            </Link>
          ))}
        </div>
      </div>

      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Browse by country or theme</h2>
        <button
          type="button"
          onClick={() =>
            setPivot(pivot === "by-country" ? "by-theme" : "by-country")
          }
          className="text-xs text-on-secondary-container underline"
        >
          {pivot === "by-country" ? "View by theme" : "View by country"}
        </button>
      </div>

      {pivot === "by-country" ? (
        <ul className="space-y-2">
          {sortedCountries.map((c) => (
            <li
              key={c.code}
              className="flex flex-wrap items-baseline gap-2 rounded-md bg-white p-3 shadow-sm"
            >
              <span className="w-44 shrink-0 text-sm font-medium">
                {c.name}
              </span>
              {themes.map((t) => (
                <Link
                  key={t.id}
                  href={`/countrysnapshots/${c.code}/${t.slug}`}
                  className="rounded-full bg-surface-low px-2 py-0.5 text-xs hover:bg-surface-high"
                >
                  <span className="mr-1">{themeEmoji(t.id)}</span>
                  {t.title}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      ) : (
        <ul className="space-y-2">
          {themes.map((t) => (
            <li
              key={t.id}
              className="flex flex-wrap items-baseline gap-2 rounded-md bg-white p-3 shadow-sm"
            >
              <span className="w-48 shrink-0 text-sm font-medium">
                <span className="mr-1.5">{themeEmoji(t.id)}</span>
                {t.title}
              </span>
              <Link
                href={`/countrysnapshots/regional/${t.slug}`}
                className="rounded-full bg-primary px-2 py-0.5 text-xs text-white hover:bg-primary-dark"
                title={`Regional summary for ${t.title}`}
              >
                regional
              </Link>
              {sortedCountries.map((c) => (
                <Link
                  key={c.code}
                  href={`/countrysnapshots/${c.code}/${t.slug}`}
                  className="rounded-full bg-surface-low px-2 py-0.5 text-xs hover:bg-surface-high"
                >
                  {c.name}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
