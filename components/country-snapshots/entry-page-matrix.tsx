"use client";

import { useState } from "react";
import Link from "next/link";
import type { Country, Theme } from "@/lib/country-snapshots/catalogue";

export function EntryPageMatrix({
  countries,
  themes,
}: {
  countries: Country[];
  themes: Theme[];
}) {
  const [pivot, setPivot] = useState<"by-country" | "by-theme">("by-country");

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-semibold">Browse</h2>
        <button
          type="button"
          onClick={() =>
            setPivot(pivot === "by-country" ? "by-theme" : "by-country")
          }
          className="text-xs text-[#006970] underline"
        >
          {pivot === "by-country" ? "View by theme" : "View by country"}
        </button>
      </div>

      {pivot === "by-country" ? (
        <ul className="space-y-2">
          {countries.map((c) => (
            <li
              key={c.code}
              className="flex flex-wrap items-baseline gap-2 rounded-md bg-white p-3 shadow-sm"
            >
              <span className="w-32 shrink-0 text-sm font-medium">
                {c.name}
              </span>
              {themes.map((t) => (
                <Link
                  key={t.id}
                  href={`/countrysnapshots/${c.code}/${t.slug}`}
                  className="rounded-full bg-[#f1f4f6] px-2 py-0.5 text-xs hover:bg-[#e5e9eb]"
                >
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
              <span className="w-44 shrink-0 text-sm font-medium">
                {t.title}
              </span>
              {countries.map((c) => (
                <Link
                  key={c.code}
                  href={`/countrysnapshots/${c.code}/${t.slug}`}
                  className="rounded-full bg-[#f1f4f6] px-2 py-0.5 font-mono text-xs hover:bg-[#e5e9eb]"
                  title={c.name}
                >
                  {c.code}
                </Link>
              ))}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
