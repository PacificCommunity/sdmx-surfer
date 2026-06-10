"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { Country, Theme } from "@/lib/country-snapshots/catalogue";
import { themeEmoji } from "@/lib/country-snapshots/theme-emoji";

/**
 * In-place navigation for canonical thematic pages: switch country or
 * theme without round-tripping through the entry page, and jump into a
 * comparison with the current country pre-selected.
 */
export function PageSwitcher({
  countries,
  themes,
  currentCountry,
  currentTheme,
}: {
  countries: Country[];
  themes: Theme[];
  currentCountry: string; // code
  currentTheme: string; // slug
}) {
  const router = useRouter();
  const sortedCountries = useMemo(
    () => [...countries].sort((a, b) => a.name.localeCompare(b.name, "en")),
    [countries],
  );
  const compareCandidates = useMemo(
    () => sortedCountries.filter((c) => c.code !== currentCountry),
    [sortedCountries, currentCountry],
  );

  const selectClass =
    "rounded-md border border-neutral-200 bg-white px-3 py-2 text-sm text-neutral-700 shadow-sm";

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Switch country"
        className={selectClass}
        value={currentCountry}
        onChange={(e) =>
          router.push(`/countrysnapshots/${e.target.value}/${currentTheme}`)
        }
      >
        {sortedCountries.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>

      <select
        aria-label="Switch theme"
        className={selectClass}
        value={currentTheme}
        onChange={(e) =>
          router.push(`/countrysnapshots/${currentCountry}/${e.target.value}`)
        }
      >
        {themes.map((t) => (
          <option key={t.id} value={t.slug}>
            {themeEmoji(t.id)} {t.title}
          </option>
        ))}
      </select>

      <select
        aria-label="Compare with another country"
        className={selectClass}
        value=""
        onChange={(e) => {
          if (!e.target.value) return;
          router.push(
            `/countrysnapshots/compare/${currentTheme}/${currentCountry}/${e.target.value}`,
          );
        }}
      >
        <option value="">Compare with…</option>
        {compareCandidates.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </select>
    </div>
  );
}
