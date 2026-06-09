"use client";

import { useRouter } from "next/navigation";
import type { Country, Theme } from "@/lib/country-snapshots/catalogue";
import { countryFlag } from "@/lib/country-snapshots/country-flag";

const MAX = 5;

export function ComparePicker({
  theme,
  countries,
  selected,
}: {
  theme: Theme;
  countries: Country[];
  selected: string[];
}) {
  const router = useRouter();

  function go(codes: string[]) {
    // Use slash-separated codes (path segments) rather than '+', because Next.js
    // treats '+' as a space in URL paths and the route fails to match.
    router.push(
      `/countrysnapshots/compare/${theme.slug}/${codes.join("/")}`,
    );
  }

  function toggle(code: string) {
    const has = selected.includes(code);
    if (has) {
      if (selected.length <= 2) return;
      go(selected.filter((c) => c !== code));
    } else {
      if (selected.length >= MAX) return;
      go([...selected, code]);
    }
  }

  return (
    <div className="mb-6 rounded-md bg-white p-3 shadow-sm">
      <p className="mb-2 text-xs uppercase tracking-wide text-neutral-500">
        Compare ({selected.length}/{MAX})
      </p>
      <div className="flex flex-wrap gap-2">
        {countries.map((c) => {
          const on = selected.includes(c.code);
          return (
            <button
              key={c.code}
              type="button"
              onClick={() => toggle(c.code)}
              className={
                "rounded-full px-3 py-1 text-xs transition-colors " +
                (on
                  ? "bg-[#004467] text-white"
                  : "bg-[#f1f4f6] text-neutral-700 hover:bg-[#e5e9eb]")
              }
            >
              <span className="mr-1">{countryFlag(c.code)}</span>
              {c.name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
