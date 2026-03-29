"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";

interface Category {
  scheme: string;
  id: string;
  name: string;
}

interface Dataflow {
  id: string;
  name: string;
  description?: string;
  categories?: Category[];
}

interface CountryResult {
  dataflow_id: string;
  dataflow_name: string;
  dataflow_version: string;
}

// Common Pacific country codes for the country filter
const COUNTRIES = [
  { code: "FJ", name: "Fiji" },
  { code: "PG", name: "Papua New Guinea" },
  { code: "WS", name: "Samoa" },
  { code: "SB", name: "Solomon Islands" },
  { code: "TO", name: "Tonga" },
  { code: "VU", name: "Vanuatu" },
  { code: "KI", name: "Kiribati" },
  { code: "MH", name: "Marshall Islands" },
  { code: "FM", name: "Micronesia" },
  { code: "NR", name: "Nauru" },
  { code: "PW", name: "Palau" },
  { code: "TV", name: "Tuvalu" },
  { code: "CK", name: "Cook Islands" },
  { code: "NU", name: "Niue" },
  { code: "TK", name: "Tokelau" },
  { code: "NC", name: "New Caledonia" },
  { code: "PF", name: "French Polynesia" },
  { code: "GU", name: "Guam" },
  { code: "AS", name: "American Samoa" },
  { code: "MP", name: "Northern Mariana Islands" },
  { code: "WF", name: "Wallis and Futuna" },
  { code: "PN", name: "Pitcairn Islands" },
];

// Color palette for topic categories (CAS_COM_TOPIC)
const TOPIC_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  ECO: { bg: "bg-amber-50",  text: "text-amber-700",   ring: "ring-amber-200" },
  ENV: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
  HEA: { bg: "bg-rose-50",   text: "text-rose-700",    ring: "ring-rose-200" },
  IND: { bg: "bg-slate-50",  text: "text-slate-700",   ring: "ring-slate-200" },
  POP: { bg: "bg-blue-50",   text: "text-blue-700",    ring: "ring-blue-200" },
  SOC: { bg: "bg-violet-50", text: "text-violet-700",  ring: "ring-violet-200" },
  XDO: { bg: "bg-teal-50",   text: "text-teal-700",    ring: "ring-teal-200" },
};

// Development framework grouping labels (CAS_COM_DEV)
const DEV_FRAMEWORK_LABELS: Record<string, { label: string; short: string }> = {
  SDG:  { label: "Sustainable Development Goals", short: "SDGs" },
  NMDI: { label: "National Minimum Development Indicators", short: "NMDI" },
  BP50: { label: "Blue Pacific 2050 Indicators", short: "BP2050" },
};

function getTopicColor(id: string) {
  return TOPIC_COLORS[id] || { bg: "bg-gray-50", text: "text-gray-700", ring: "ring-gray-200" };
}

function CategoryBadge({ category }: { category: Category }) {
  if (category.scheme === "CAS_COM_DEV") {
    const fw = DEV_FRAMEWORK_LABELS[category.id];
    return (
      <span className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary ring-1 ring-inset ring-primary/20">
        {fw?.short || category.name}
      </span>
    );
  }
  const colors = getTopicColor(category.id);
  return (
    <span className={"inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 ring-inset " + colors.bg + " " + colors.text + " " + colors.ring}>
      {category.name}
    </span>
  );
}

function DataflowCard({ df }: { df: Dataflow }) {
  const topics = (df.categories || []).filter((c) => c.scheme === "CAS_COM_TOPIC");
  const devFrameworks = (df.categories || []).filter((c) => c.scheme === "CAS_COM_DEV");

  return (
    <Link
      href={"/explore/" + df.id}
      className="group flex flex-col rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient transition-all hover:shadow-lg hover:shadow-primary/5"
    >
      {/* Category badges */}
      {(topics.length > 0 || devFrameworks.length > 0) && (
        <div className="mb-2.5 flex flex-wrap gap-1">
          {topics.map((c) => (
            <CategoryBadge key={c.scheme + ":" + c.id} category={c} />
          ))}
          {devFrameworks.map((c) => (
            <CategoryBadge key={c.scheme + ":" + c.id} category={c} />
          ))}
        </div>
      )}

      <div className="mb-1.5 flex items-start justify-between gap-2">
        <h3 className="font-[family-name:var(--font-manrope)] text-sm font-bold leading-snug text-on-surface group-hover:text-primary">
          {df.name}
        </h3>
        <svg
          className="mt-0.5 h-4 w-4 shrink-0 text-on-surface-variant opacity-0 transition-opacity group-hover:opacity-100"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3" />
        </svg>
      </div>
      <p className="type-label-md mb-1.5 text-on-tertiary-fixed-variant">
        {df.id}
      </p>
      {df.description && (
        <p className="line-clamp-2 text-xs leading-relaxed text-on-surface-variant">
          {df.description}
        </p>
      )}
    </Link>
  );
}

export default function ExplorePage() {
  const [dataflows, setDataflows] = useState<Dataflow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [selectedCountry, setSelectedCountry] = useState<string | null>(null);
  const [countryDataflows, setCountryDataflows] = useState<Set<string> | null>(null);
  const [countryLoading, setCountryLoading] = useState(false);
  const [semanticResults, setSemanticResults] = useState<Dataflow[] | null>(null);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [selectedTopic, setSelectedTopic] = useState<string | null>(null);
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

  // Load all dataflows on mount
  useEffect(() => {
    fetch("/api/explore")
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setDataflows(data.dataflows);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

  // Load country-specific dataflows when a country is selected
  useEffect(() => {
    if (!selectedCountry) {
      setCountryDataflows(null);
      return;
    }
    setCountryLoading(true);
    fetch("/api/explore?country=" + selectedCountry)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const ids = new Set<string>(
          (data.dataflows_with_data || []).map(
            (d: CountryResult) => d.dataflow_id,
          ),
        );
        setCountryDataflows(ids);
      })
      .catch(() => setCountryDataflows(null))
      .finally(() => setCountryLoading(false));
  }, [selectedCountry]);

  // Debounced semantic search when text is long enough
  useEffect(() => {
    const words = searchText.trim().split(/\s+/).filter(Boolean);
    if (words.length < 3) {
      setSemanticResults(null);
      setSemanticLoading(false);
      return;
    }

    setSemanticLoading(true);

    const controller = new AbortController();
    const timer = setTimeout(() => {
      fetch("/api/explore?q=" + encodeURIComponent(searchText.trim()), {
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((data) => {
          if (data.searchType === "semantic" && Array.isArray(data.dataflows) && data.dataflows.length > 0) {
            setSemanticResults(data.dataflows);
          } else {
            setSemanticResults(null);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSemanticResults(null);
          }
        })
        .finally(() => {
          if (!controller.signal.aborted) {
            setSemanticLoading(false);
          }
        });
    }, 600);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [searchText]);

  const isSemanticQuery = searchText.trim().split(/\s+/).filter(Boolean).length >= 3;

  // Collect available topic filters from loaded data
  const availableTopics = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const df of dataflows) {
      for (const c of df.categories || []) {
        if (c.scheme === "CAS_COM_TOPIC") {
          const existing = counts.get(c.id);
          if (existing) {
            existing.count++;
          } else {
            counts.set(c.id, { name: c.name, count: 1 });
          }
        }
      }
    }
    return Array.from(counts.entries())
      .map(([id, { name, count }]) => ({ id, name, count }))
      .sort((a, b) => b.count - a.count);
  }, [dataflows]);

  // Filter dataflows
  const filtered = useMemo(() => {
    let result: Dataflow[];

    if (semanticResults) {
      result = semanticResults;
    } else if (isSemanticQuery && semanticLoading) {
      return [];
    } else {
      result = dataflows;

      if (searchText.trim()) {
        const q = searchText.toLowerCase();
        result = result.filter(
          (df) =>
            df.id.toLowerCase().includes(q) ||
            df.name.toLowerCase().includes(q) ||
            (df.description || "").toLowerCase().includes(q),
        );
      }
    }

    if (countryDataflows) {
      result = result.filter((df) => countryDataflows.has(df.id));
    }

    if (selectedTopic) {
      result = result.filter((df) =>
        (df.categories || []).some(
          (c) => c.scheme === "CAS_COM_TOPIC" && c.id === selectedTopic,
        ),
      );
    }

    return result;
  }, [dataflows, searchText, countryDataflows, semanticResults, semanticLoading, isSemanticQuery, selectedTopic]);

  // Group filtered dataflows by development framework (CAS_COM_DEV)
  const grouped = useMemo(() => {
    const groups: Array<{ key: string; label: string; dataflows: Dataflow[] }> = [];
    const used = new Set<string>();

    // Group by each dev framework in order
    for (const fwId of ["SDG", "NMDI", "BP50"]) {
      const fw = DEV_FRAMEWORK_LABELS[fwId];
      const members = filtered.filter((df) =>
        (df.categories || []).some(
          (c) => c.scheme === "CAS_COM_DEV" && c.id === fwId,
        ),
      );
      if (members.length > 0) {
        groups.push({ key: fwId, label: fw.label, dataflows: members });
        for (const df of members) used.add(df.id);
      }
    }

    // Remaining dataflows not in any dev framework — kept separate
    const remaining = filtered.filter((df) => !used.has(df.id));

    return { groups, remaining };
  }, [filtered]);

  // Determine if we should show grouped view (not during search)
  const showGrouped = !searchText.trim() && !semanticResults;

  return (
    <div className="min-h-screen bg-surface">
      {/* Header */}
      <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-3">
        <div className="mx-auto flex max-w-6xl items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              href="/"
              className="ocean-gradient flex h-9 w-9 items-center justify-center rounded-[var(--radius-md)] transition-transform hover:scale-105"
              title="Back to home"
            >
              <svg
                className="h-5 w-5 text-white"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
                />
              </svg>
            </Link>
            <div>
              <h1 className="font-[family-name:var(--font-manrope)] text-base font-bold tracking-tight text-primary">
                Data Catalogue
              </h1>
              <p className="type-label-md text-on-tertiary-fixed-variant">
                {dataflows.length} dataflows on Pacific Data Hub
              </p>
            </div>
          </div>
          <Link
            href="/builder"
            className="ghost-border rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
          >
            Open Builder
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Search + filter bar */}
        <div className="mb-4 flex flex-col gap-4 sm:flex-row">
          {/* Text search */}
          <div className="flex-1">
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Search dataflows by name, ID, or description..."
              className="focus-architectural ghost-border w-full rounded-[var(--radius-xl)] bg-surface-card px-4 py-3 text-sm text-on-surface shadow-ambient placeholder:text-on-surface-variant/50"
            />
          </div>

          {/* Country filter */}
          <div className="relative">
            <select
              value={selectedCountry || ""}
              onChange={(e) =>
                setSelectedCountry(e.target.value || null)
              }
              className="ghost-border appearance-none rounded-[var(--radius-xl)] bg-surface-card px-4 py-3 pr-10 text-sm text-on-surface shadow-ambient"
            >
              <option value="">All countries</option>
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name} ({c.code})
                </option>
              ))}
            </select>
            <svg
              className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
            </svg>
          </div>
        </div>

        {/* Topic filter chips */}
        {availableTopics.length > 0 && (
          <div className="mb-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedTopic(null)}
              className={"rounded-full px-3 py-1 text-xs font-medium transition-colors " +
                (selectedTopic === null
                  ? "bg-primary text-white"
                  : "bg-surface-card text-on-surface-variant shadow-ambient hover:text-on-surface")}
            >
              All
            </button>
            {availableTopics.map((t) => {
              const colors = getTopicColor(t.id);
              const active = selectedTopic === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setSelectedTopic(active ? null : t.id)}
                  className={"rounded-full px-3 py-1 text-xs font-medium transition-colors ring-1 ring-inset " +
                    (active
                      ? colors.bg + " " + colors.text + " " + colors.ring + " ring-2"
                      : "bg-surface-card text-on-surface-variant ring-transparent shadow-ambient hover:text-on-surface hover:" + colors.ring)}
                >
                  {t.name}
                  <span className="ml-1 opacity-60">{t.count}</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Status bar */}
        <div className="mb-4 flex items-center gap-2 text-xs text-on-surface-variant">
          {(countryLoading || semanticLoading) && (
            <span className="flex items-center gap-1">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-secondary" />
              {semanticLoading ? "Semantic search..." : "Searching for " + selectedCountry + "..."}
            </span>
          )}
          {semanticResults && !semanticLoading && (
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
              Semantic search
            </span>
          )}
          {!loading && (
            <span>
              {filtered.length === dataflows.length
                ? filtered.length + " dataflows"
                : filtered.length + " of " + dataflows.length + " dataflows"}
            </span>
          )}
          {selectedCountry && countryDataflows && (
            <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold text-on-secondary-container">
              {COUNTRIES.find((c) => c.code === selectedCountry)?.name || selectedCountry}: {countryDataflows.size} dataflows with data
            </span>
          )}
        </div>

        {/* Loading state */}
        {loading && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 9 }, (_, i) => (
              <div
                key={i}
                className="rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient"
              >
                <div className="shimmer mb-3 h-4 w-20 rounded-full" />
                <div className="shimmer mb-2 h-4 w-48 rounded-[var(--radius-sm)]" />
                <div className="shimmer mb-2 h-3 w-full rounded-[var(--radius-sm)]" />
                <div className="shimmer h-3 w-2/3 rounded-[var(--radius-sm)]" />
              </div>
            ))}
          </div>
        )}

        {/* Error state */}
        {error && (
          <div className="rounded-[var(--radius-xl)] bg-surface-low p-8 text-center">
            <p className="text-sm text-on-surface-variant">
              Failed to load dataflows: {error}
            </p>
            <p className="mt-2 text-xs text-on-surface-variant">
              Make sure the MCP gateway is running on{" "}
              <code className="rounded bg-surface-high px-1 py-0.5 text-xs">
                localhost:8000
              </code>
            </p>
          </div>
        )}

        {/* Dataflow grid — grouped or flat */}
        {!loading && !error && showGrouped && (
          <div className="space-y-8">
            {grouped.groups.map((group) => {
              const isExpanded = expandedGroups.has(group.key);
              return (
                <section key={group.key}>
                  <button
                    onClick={() => setExpandedGroups((prev) => {
                      const next = new Set(prev);
                      if (next.has(group.key)) next.delete(group.key);
                      else next.add(group.key);
                      return next;
                    })}
                    className="mb-3 flex w-full items-center gap-2 text-left"
                  >
                    <svg
                      className={"h-4 w-4 shrink-0 text-on-surface-variant transition-transform " + (isExpanded ? "rotate-90" : "")}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
                    </svg>
                    <h2 className="font-[family-name:var(--font-manrope)] text-sm font-bold text-on-surface">
                      {group.label}
                    </h2>
                    <span className="rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-medium text-on-surface-variant">
                      {group.dataflows.length}
                    </span>
                  </button>
                  {isExpanded && (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {group.dataflows.map((df) => (
                        <DataflowCard key={df.id} df={df} />
                      ))}
                    </div>
                  )}
                </section>
              );
            })}

            {/* Ungrouped dataflows — flat list, no "Other" heading */}
            {grouped.remaining.length > 0 && (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {grouped.remaining.map((df) => (
                  <DataflowCard key={df.id} df={df} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* Flat grid for search results */}
        {!loading && !error && !showGrouped && (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {filtered.map((df) => (
              <DataflowCard key={df.id} df={df} />
            ))}
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && filtered.length === 0 && (
          <div className="submerged-overlay rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
            <p className="text-sm text-on-surface-variant">
              No dataflows match your search.
            </p>
            {(selectedCountry || selectedTopic) && (
              <p className="mt-2 text-xs text-on-surface-variant">
                Try removing filters or searching with different terms.
              </p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
