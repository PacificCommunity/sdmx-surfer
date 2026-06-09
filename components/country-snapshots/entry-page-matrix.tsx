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
      <div className="mb-3 rounded-md bg-white p-3 shadow-sm">
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-[#181c1e]">
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
              className="rounded-full bg-[#004467] px-3 py-1 text-xs text-white hover:bg-[#003355]"
            >
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
              <Link
                href={`/countrysnapshots/regional/${t.slug}`}
                className="rounded-full bg-[#004467] px-2 py-0.5 text-xs text-white hover:bg-[#003355]"
                title={`Regional summary for ${t.title}`}
              >
                regional
              </Link>
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
