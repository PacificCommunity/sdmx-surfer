"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";

interface Dimension {
  id: string;
  position: number;
  type: string;
  codelist: string | null;
}

interface Category {
  scheme: string;
  id: string;
  name: string;
}

interface Structure {
  dataflow: {
    id: string;
    name: string;
    description: string;
  };
  structure: {
    id: string;
    key_template: string;
    dimensions: Dimension[];
    attributes: Array<{ id: string; assignment_status: string }>;
    measure: string;
  };
}

interface DiagramData {
  mermaid_diagram: string;
  interpretation: string[];
  nodes: Array<{
    node_id: string;
    structure_type: string;
    id: string;
    name: string;
  }>;
}

interface DimensionCode {
  id: string;
  name: string;
  description?: string;
}

// Topic badge colors (same as explore page)
const TOPIC_COLORS: Record<string, { bg: string; text: string; ring: string }> = {
  ECO: { bg: "bg-amber-50",  text: "text-amber-700",   ring: "ring-amber-200" },
  ENV: { bg: "bg-emerald-50", text: "text-emerald-700", ring: "ring-emerald-200" },
  HEA: { bg: "bg-rose-50",   text: "text-rose-700",    ring: "ring-rose-200" },
  IND: { bg: "bg-slate-50",  text: "text-slate-700",   ring: "ring-slate-200" },
  POP: { bg: "bg-blue-50",   text: "text-blue-700",    ring: "ring-blue-200" },
  SOC: { bg: "bg-violet-50", text: "text-violet-700",  ring: "ring-violet-200" },
  XDO: { bg: "bg-teal-50",   text: "text-teal-700",    ring: "ring-teal-200" },
};

const DEV_FRAMEWORK_SHORT: Record<string, string> = {
  SDG: "SDGs",
  NMDI: "NMDI",
  BP50: "BP2050",
};

function CategoryBadge({ category }: { category: Category }) {
  if (category.scheme === "CAS_COM_DEV") {
    return (
      <span className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary ring-1 ring-inset ring-primary/20">
        {DEV_FRAMEWORK_SHORT[category.id] || category.name}
      </span>
    );
  }
  const colors = TOPIC_COLORS[category.id] || { bg: "bg-gray-50", text: "text-gray-700", ring: "ring-gray-200" };
  return (
    <span className={"inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset " + colors.bg + " " + colors.text + " " + colors.ring}>
      {category.name}
    </span>
  );
}

export default function DataflowDetailPage() {
  const params = useParams();
  const dataflowId = params.id as string;

  const [structure, setStructure] = useState<Structure | null>(null);
  const [categories, setCategories] = useState<Category[]>([]);
  const [availability, setAvailability] = useState<{
    obsCount: number;
    timeStart: string | null;
    timeEnd: string | null;
    frequencies: string[];
    dimensions: Array<{ id: string; values: string[] }>;
    countries: Array<{ code: string; obsCount: number; timeStart: string | null; timeEnd: string | null }>;
  } | null>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dimension codes (lazy-loaded per dimension)
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [dimCodes, setDimCodes] = useState<Record<string, DimensionCode[]>>({});
  const [codesLoading, setCodesLoading] = useState<string | null>(null);

  // Collapsible sections
  const [showTechnical, setShowTechnical] = useState(false);
  const [showDiagram, setShowDiagram] = useState(false);

  useEffect(() => {
    fetch("/api/explore/" + dataflowId)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStructure(data.structure);
        setCategories(data.categories || []);
        setAvailability(data.availability || null);
        setDiagram(data.diagram);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dataflowId]);

  const toggleDimension = (dimId: string) => {
    if (expandedDim === dimId) {
      setExpandedDim(null);
      return;
    }
    setExpandedDim(dimId);

    if (dimCodes[dimId]) return;

    setCodesLoading(dimId);
    fetch("/api/explore/" + dataflowId + "?codes=" + dimId)
      .then((r) => r.json())
      .then((data) => {
        const codes = data.codes || data.values || [];
        setDimCodes((prev) => ({ ...prev, [dimId]: codes }));
      })
      .catch(() => {
        setDimCodes((prev) => ({ ...prev, [dimId]: [] }));
      })
      .finally(() => setCodesLoading(null));
  };

  if (loading) {
    return (
      <div className="min-h-screen bg-surface">
        <Header dataflowId={dataflowId} />
        <main className="mx-auto max-w-4xl px-6 py-8">
          <div className="space-y-6">
            <div className="shimmer h-8 w-96 rounded-[var(--radius-md)]" />
            <div className="shimmer h-4 w-full rounded-[var(--radius-sm)]" />
            <div className="shimmer h-4 w-2/3 rounded-[var(--radius-sm)]" />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 4 }, (_, i) => (
                <div key={i} className="shimmer h-20 rounded-[var(--radius-xl)]" />
              ))}
            </div>
          </div>
        </main>
      </div>
    );
  }

  if (error || !structure) {
    return (
      <div className="min-h-screen bg-surface">
        <Header dataflowId={dataflowId} />
        <main className="mx-auto max-w-4xl px-6 py-8">
          <div className="submerged-overlay rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
            <p className="text-sm text-on-surface-variant">
              {error || "Dataflow not found"}
            </p>
          </div>
        </main>
      </div>
    );
  }

  const dims = structure.structure.dimensions.filter(
    (d) => d.type !== "TimeDimension",
  );
  const timeDim = structure.structure.dimensions.find(
    (d) => d.type === "TimeDimension",
  );

  return (
    <div className="min-h-screen bg-surface">
      <Header dataflowId={dataflowId} name={structure.dataflow.name} />

      <main className="mx-auto max-w-4xl px-6 py-8">
        {/* Title + description + categories */}
        <div className="mb-8">
          {categories.length > 0 && (
            <div className="mb-3 flex flex-wrap gap-1.5">
              {categories.map((c) => (
                <CategoryBadge key={c.scheme + ":" + c.id} category={c} />
              ))}
            </div>
          )}

          <p className="type-label-md mb-1 text-on-tertiary-fixed-variant">
            {dataflowId}
          </p>
          <h2 className="font-[family-name:var(--font-display)] text-2xl font-extrabold tracking-tight text-on-surface">
            {structure.dataflow.name}
          </h2>
          {structure.dataflow.description && (
            <p className="mt-3 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
              {structure.dataflow.description}
            </p>
          )}

          <div className="mt-5 flex gap-2">
            <button
              type="button"
              onClick={() => {
                // Short, natural user message
                const prompt = "Build me a dashboard exploring " +
                  structure.dataflow.name + ".";

                // Structured context injected into system prompt (user doesn't see this)
                const topicCats = categories
                  .filter((c) => c.scheme === "CAS_COM_TOPIC")
                  .map((c) => c.name);
                const devCats = categories
                  .filter((c) => c.scheme === "CAS_COM_DEV")
                  .map((c) => c.name);

                const codelistHints = dims
                  .filter((d) => d.codelist)
                  .map((d) => {
                    const clName = (d.codelist || "").split(":").pop()?.split("(")[0] || "";
                    return d.id + " (" + clName + ")";
                  });

                const contextLines: string[] = [
                  "## Dataflow Context (pre-loaded from catalogue)",
                  "",
                  "The user wants to explore **" + dataflowId + "** (" + structure.dataflow.name + ").",
                ];

                if (structure.dataflow.description) {
                  contextLines.push("", "**Description:** " + structure.dataflow.description);
                }

                if (topicCats.length > 0 || devCats.length > 0) {
                  contextLines.push("", "**Categories:** " + [...topicCats, ...devCats].join(", "));
                }

                if (codelistHints.length > 0) {
                  contextLines.push("", "**Dimensions:** " + codelistHints.join(", ") +
                    (timeDim ? ", " + timeDim.id + " (time)" : ""));
                }

                contextLines.push(
                  "",
                  "**Key template:** " + structure.structure.key_template,
                );

                // Availability — crucial for avoiding empty queries
                if (availability) {
                  contextLines.push(
                    "",
                    "**Data availability:**",
                    "- Total observations: " + String(availability.obsCount),
                    "- Time range: " + (availability.timeStart || "?") + " to " + (availability.timeEnd || "?"),
                    "- Frequency: " + (availability.frequencies.join(", ") || "unknown"),
                  );

                  if (availability.countries.length > 0) {
                    contextLines.push(
                      "- Countries with data (" + String(availability.countries.length) + "):",
                    );
                    for (const c of availability.countries) {
                      if (c.obsCount > 0) {
                        contextLines.push(
                          "  - " + c.code + ": " + String(c.obsCount) + " obs, " +
                          (c.timeStart || "?") + "-" + (c.timeEnd || "?"),
                        );
                      }
                    }
                  }
                }

                contextLines.push(
                  "",
                  "**Strategy:** Start with a headline KPI for the most recent data point, " +
                  "then show the trend over time, " +
                  "then break down by geography or the most interesting categorical dimension. " +
                  "Aim for a 3-4 panel dashboard that tells the story of this data. " +
                  "Use the availability data above to pick countries and time periods that actually have data.",
                );

                const dfContext = contextLines.join("\n");

                window.location.href =
                  "/builder?new=1" +
                  "&prompt=" + encodeURIComponent(prompt) +
                  "&dfContext=" + encodeURIComponent(dfContext);
              }}
              className="brand-gradient rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
            >
              Explore in Builder
            </button>
            <Link
              href="/explore"
              className="ghost-border rounded-full bg-surface-card px-4 py-2 text-sm font-semibold text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
            >
              Back to Catalogue
            </Link>
          </div>
        </div>

        {/* At a glance — availability stats */}
        {availability && (
          <section className="mb-6">
            <h3 className="mb-3 font-[family-name:var(--font-display)] text-sm font-bold text-on-surface">
              At a glance
            </h3>
            <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-4 shadow-ambient">
                <p className="type-label-md text-on-tertiary-fixed-variant">Observations</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-on-surface">
                  {availability.obsCount.toLocaleString()}
                </p>
              </div>
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-4 shadow-ambient">
                <p className="type-label-md text-on-tertiary-fixed-variant">Time range</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-on-surface">
                  {availability.timeStart || "?"} - {availability.timeEnd || "?"}
                </p>
              </div>
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-4 shadow-ambient">
                <p className="type-label-md text-on-tertiary-fixed-variant">Countries</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-on-surface">
                  {availability.countries.length > 0
                    ? availability.countries.filter((c) => c.obsCount > 0).length
                    : availability.dimensions.find((d) => d.id === "GEO_PICT")?.values.length || "-"}
                </p>
              </div>
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-4 shadow-ambient">
                <p className="type-label-md text-on-tertiary-fixed-variant">Frequency</p>
                <p className="mt-1 font-[family-name:var(--font-display)] text-2xl font-extrabold text-on-surface">
                  {availability.frequencies.length > 0
                    ? availability.frequencies.map((f) =>
                        f === "A" ? "Annual" : f === "Q" ? "Quarterly" : f === "M" ? "Monthly" : f
                      ).join(", ")
                    : "-"}
                </p>
              </div>
            </div>

            {/* Country coverage table */}
            {availability.countries.length > 0 && (
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
                <h4 className="type-label-md mb-3 text-on-tertiary-fixed-variant">
                  Country coverage
                </h4>
                <div className="max-h-80 overflow-y-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-surface-high text-left">
                        <th className="px-2 py-1.5 font-semibold text-on-surface-variant">Country</th>
                        <th className="px-2 py-1.5 text-right font-semibold text-on-surface-variant">Obs</th>
                        <th className="px-2 py-1.5 font-semibold text-on-surface-variant">Period</th>
                        <th className="px-2 py-1.5 font-semibold text-on-surface-variant">Coverage</th>
                      </tr>
                    </thead>
                    <tbody>
                      {availability.countries
                        .filter((c) => c.obsCount > 0)
                        .sort((a, b) => b.obsCount - a.obsCount)
                        .map((c) => {
                          // Compute coverage bar width relative to the max obs count
                          const maxObs = Math.max(...availability.countries.map((x) => x.obsCount));
                          const pct = maxObs > 0 ? (c.obsCount / maxObs) * 100 : 0;
                          return (
                            <tr key={c.code} className="transition-colors hover:bg-surface-low">
                              <td className="px-2 py-1.5 font-mono font-semibold text-primary">{c.code}</td>
                              <td className="px-2 py-1.5 text-right tabular-nums text-on-surface">{c.obsCount}</td>
                              <td className="px-2 py-1.5 tabular-nums text-on-surface-variant">
                                {c.timeStart || "?"} - {c.timeEnd || "?"}
                              </td>
                              <td className="px-2 py-1.5">
                                <div className="h-2 w-full rounded-full bg-surface-high">
                                  <div
                                    className="h-2 rounded-full bg-primary/60"
                                    style={{ width: pct + "%" }}
                                  />
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </section>
        )}

        {/* Dimensions — expandable codelists */}
        <section className="mb-6">
          <h3 className="mb-3 font-[family-name:var(--font-display)] text-sm font-bold text-on-surface">
            Dimensions
          </h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {dims.map((dim) => {
              const isExpanded = expandedDim === dim.id;
              const codelistName = dim.codelist
                ? dim.codelist.split(":").pop()?.split("(")[0] || ""
                : "";
              return (
                <div
                  key={dim.id}
                  className={"rounded-[var(--radius-xl)] bg-surface-card shadow-ambient transition-all " +
                    (isExpanded ? "sm:col-span-2 lg:col-span-3" : "")}
                >
                  <button
                    type="button"
                    onClick={() => dim.codelist ? toggleDimension(dim.id) : undefined}
                    className={"flex w-full items-center justify-between p-4 text-left " +
                      (dim.codelist ? "cursor-pointer" : "cursor-default")}
                  >
                    <div>
                      <span className="text-sm font-semibold text-on-surface">
                        {dim.id}
                      </span>
                      {codelistName && (
                        <p className="mt-0.5 text-xs text-on-surface-variant">
                          {codelistName}
                        </p>
                      )}
                    </div>
                    {dim.codelist && (
                      <svg
                        className={"h-4 w-4 shrink-0 text-on-surface-variant transition-transform " +
                          (isExpanded ? "rotate-180" : "")}
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
                      </svg>
                    )}
                  </button>

                  {isExpanded && (
                    <div className="border-t border-surface-high px-4 pb-4 pt-2">
                      {codesLoading === dim.id ? (
                        <div className="space-y-1.5 py-2">
                          {Array.from({ length: 5 }, (_, i) => (
                            <div key={i} className="shimmer h-3 w-full rounded-[var(--radius-sm)]" />
                          ))}
                        </div>
                      ) : dimCodes[dim.id]?.length ? (
                        <div className="max-h-72 overflow-y-auto">
                          <table className="w-full text-xs">
                            <tbody>
                              {dimCodes[dim.id].map((code) => (
                                <tr key={code.id} className="transition-colors hover:bg-surface-low">
                                  <td className="px-2 py-1 font-mono font-semibold text-primary">
                                    {code.id}
                                  </td>
                                  <td className="px-2 py-1 text-on-surface-variant">
                                    {code.name}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <p className="py-2 text-xs text-on-surface-variant">
                          No codes available
                        </p>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Time dimension */}
            {timeDim && (
              <div className="flex items-center gap-2 rounded-[var(--radius-xl)] bg-surface-card p-4 shadow-ambient">
                <span className="text-sm font-semibold text-on-surface">
                  {timeDim.id}
                </span>
                <span className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold text-on-secondary-container">
                  Time
                </span>
              </div>
            )}
          </div>
        </section>

        {/* Structure diagram — collapsible */}
        {diagram && (
          <section className="mb-6">
            <button
              onClick={() => setShowDiagram((v) => !v)}
              className="mb-3 flex items-center gap-2"
            >
              <svg
                className={"h-4 w-4 shrink-0 text-on-surface-variant transition-transform " + (showDiagram ? "rotate-90" : "")}
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
              </svg>
              <h3 className="font-[family-name:var(--font-display)] text-sm font-bold text-on-surface">
                Structure Diagram
              </h3>
            </button>
            {showDiagram && (
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient">
                <MermaidDiagram code={diagram.mermaid_diagram} />
              </div>
            )}
          </section>
        )}

        {/* Technical details — collapsible */}
        <section className="mb-6">
          <button
            onClick={() => setShowTechnical((v) => !v)}
            className="mb-3 flex items-center gap-2"
          >
            <svg
              className={"h-4 w-4 shrink-0 text-on-surface-variant transition-transform " + (showTechnical ? "rotate-90" : "")}
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 4.5l7.5 7.5-7.5 7.5" />
            </svg>
            <h3 className="font-[family-name:var(--font-display)] text-sm font-bold text-on-surface">
              Technical Details
            </h3>
          </button>
          {showTechnical && (
            <div className="space-y-4">
              {/* Key template */}
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
                <h4 className="type-label-md mb-2 text-on-tertiary-fixed-variant">
                  Key Structure
                </h4>
                <code className="block rounded-[var(--radius-md)] bg-surface-high/50 px-3 py-2 text-xs text-on-surface">
                  {structure.structure.key_template}
                </code>
              </div>

              {/* Attributes */}
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
                <h4 className="type-label-md mb-2 text-on-tertiary-fixed-variant">
                  Attributes ({structure.structure.attributes.length})
                </h4>
                <div className="space-y-1">
                  {structure.structure.attributes.map((attr) => (
                    <div
                      key={attr.id}
                      className="flex items-center justify-between rounded-[var(--radius-md)] px-3 py-1.5"
                    >
                      <span className="text-xs font-semibold text-on-surface">
                        {attr.id}
                      </span>
                      <span className="rounded-full bg-surface-high px-2 py-0.5 text-[10px] text-on-surface-variant">
                        {attr.assignment_status}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center rounded-[var(--radius-md)] px-3 py-1.5">
                    <span className="text-xs font-semibold text-on-surface">
                      {structure.structure.measure}
                    </span>
                    <span className="ml-2 rounded-full bg-tertiary-fixed px-2 py-0.5 text-[10px] font-semibold text-tertiary-container">
                      Measure
                    </span>
                  </div>
                </div>
              </div>

              {/* DSD ID */}
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
                <h4 className="type-label-md mb-2 text-on-tertiary-fixed-variant">
                  Data Structure Definition
                </h4>
                <code className="text-xs text-on-surface">{structure.structure.id}</code>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

// ── Sub-components ──

function Header({
  dataflowId,
  name,
}: {
  dataflowId: string;
  name?: string;
}) {
  return (
    <header className="glass-panel shadow-ambient sticky top-0 z-50 px-6 py-3">
      <div className="mx-auto flex max-w-4xl items-center justify-between">
        <div className="flex items-center gap-3">
          <Link
            href="/explore"
            className="rounded-full p-1.5 text-on-surface-variant transition-colors hover:text-primary"
            title="Back to catalogue"
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
              />
            </svg>
          </Link>
          <div>
            <h1 className="font-[family-name:var(--font-display)] text-base font-bold tracking-tight text-primary">
              {name || dataflowId}
            </h1>
            <p className="type-label-md text-on-tertiary-fixed-variant">
              Dataflow Explorer
            </p>
          </div>
        </div>
      </div>
    </header>
  );
}

function MermaidDiagram({ code }: { code: string }) {
  const [svg, setSvg] = useState<string | null>(null);
  const [mermaidError, setMermaidError] = useState(false);

  useEffect(() => {
    let cancelled = false;

    import("mermaid")
      .then(async (mod) => {
        const mermaid = mod.default;
        mermaid.initialize({
          startOnLoad: false,
          theme: "base",
          themeVariables: {
            primaryColor: "#e3f2fd",
            primaryTextColor: "#004467",
            primaryBorderColor: "#1565c0",
            secondaryColor: "#e8f5e9",
            secondaryTextColor: "#006970",
            secondaryBorderColor: "#2e7d32",
            tertiaryColor: "#fff3e0",
            tertiaryTextColor: "#181c1e",
            fontFamily: "Inter, system-ui, sans-serif",
            fontSize: "12px",
          },
          securityLevel: "loose",
        });
        const { svg: rendered } = await mermaid.render(
          "mermaid-" + Date.now(),
          code,
        );
        if (!cancelled) setSvg(rendered);
      })
      .catch(() => {
        if (!cancelled) setMermaidError(true);
      });

    return () => {
      cancelled = true;
    };
  }, [code]);

  if (mermaidError) {
    return (
      <div className="rounded-[var(--radius-md)] bg-surface-low p-4">
        <p className="type-label-md mb-2 text-on-surface-variant">
          Diagram source (Mermaid)
        </p>
        <pre className="max-h-96 overflow-auto text-xs text-on-surface-variant">
          {code}
        </pre>
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="flex h-48 items-center justify-center">
        <div className="flex gap-1">
          <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:0ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:150ms]" />
          <span className="h-2 w-2 animate-bounce rounded-full bg-secondary [animation-delay:300ms]" />
        </div>
      </div>
    );
  }

  return (
    <div
      className="overflow-auto [&_svg]:max-w-full"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
