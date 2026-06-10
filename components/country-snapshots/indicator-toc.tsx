"use client";

import { useEffect, useState } from "react";

export type TocEntry = { id: string; title: string };

/**
 * In-page table of contents for the dense one-pager thematic views.
 * Desktop (xl+): sticky sidebar alongside the content, active section
 * highlighted via IntersectionObserver. Below xl: nothing — the pages
 * stay scannable on mobile and chips would crowd the header.
 */
export function IndicatorToc({ entries }: { entries: TocEntry[] }) {
  const [active, setActive] = useState<string | null>(null);

  useEffect(() => {
    const sections = entries
      .map((e) => document.getElementById(e.id))
      .filter((el): el is HTMLElement => Boolean(el));
    if (sections.length === 0) return;

    const observer = new IntersectionObserver(
      (obsEntries) => {
        // Pick the top-most visible section as active.
        const visible = obsEntries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      // Treat the upper third of the viewport as the "reading line".
      { rootMargin: "0px 0px -66% 0px" },
    );
    sections.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [entries]);

  if (entries.length < 4) return null; // short pages don't need a TOC

  return (
    <nav
      aria-label="Indicators on this page"
      className="hidden xl:block w-56 shrink-0"
    >
      <div className="sticky top-6 max-h-[calc(100vh-3rem)] overflow-y-auto rounded-md bg-white p-3 shadow-sm">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          On this page
        </p>
        <ul className="space-y-1">
          {entries.map((e) => (
            <li key={e.id}>
              <a
                href={`#${e.id}`}
                className={
                  "block truncate rounded px-2 py-1 text-xs transition-colors " +
                  (active === e.id
                    ? "bg-[#e5f2f3] font-medium text-[#006970]"
                    : "text-neutral-600 hover:bg-[#f1f4f6]")
                }
                title={e.title}
              >
                <span className="mr-1 font-mono text-[10px] text-neutral-400">
                  {e.id}
                </span>
                {e.title}
              </a>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
