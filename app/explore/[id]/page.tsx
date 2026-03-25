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

export default function DataflowDetailPage() {
  const params = useParams();
  const dataflowId = params.id as string;

  const [structure, setStructure] = useState<Structure | null>(null);
  const [diagram, setDiagram] = useState<DiagramData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dimension codes (lazy-loaded per dimension)
  const [expandedDim, setExpandedDim] = useState<string | null>(null);
  const [dimCodes, setDimCodes] = useState<Record<string, DimensionCode[]>>({});
  const [codesLoading, setCodesLoading] = useState<string | null>(null);

  // Load structure + diagram on mount
  useEffect(() => {
    fetch("/api/explore/" + dataflowId)
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        setStructure(data.structure);
        setDiagram(data.diagram);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [dataflowId]);

  // Load dimension codes when expanded
  const toggleDimension = (dimId: string) => {
    if (expandedDim === dimId) {
      setExpandedDim(null);
      return;
    }
    setExpandedDim(dimId);

    if (dimCodes[dimId]) return; // already loaded

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
        <main className="mx-auto max-w-6xl px-6 py-8">
          <div className="space-y-6">
            <div className="shimmer h-8 w-96 rounded-[var(--radius-md)]" />
            <div className="shimmer h-4 w-full rounded-[var(--radius-sm)]" />
            <div className="shimmer h-64 w-full rounded-[var(--radius-xl)]" />
          </div>
        </main>
      </div>
    );
  }

  if (error || !structure) {
    return (
      <div className="min-h-screen bg-surface">
        <Header dataflowId={dataflowId} />
        <main className="mx-auto max-w-6xl px-6 py-8">
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

      <main className="mx-auto max-w-6xl px-6 py-8">
        {/* Title + actions */}
        <div className="mb-8">
          <p className="type-label-md mb-1 text-on-tertiary-fixed-variant">
            {dataflowId}
          </p>
          <h2 className="font-[family-name:var(--font-manrope)] text-2xl font-extrabold tracking-tight text-on-surface">
            {structure.dataflow.name}
          </h2>
          {structure.dataflow.description && (
            <p className="mt-2 max-w-3xl text-sm leading-relaxed text-on-surface-variant">
              {structure.dataflow.description}
            </p>
          )}
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              onClick={() => {
                const dimList = dims.map((d) => d.id).join(", ");
                const desc = structure.dataflow.description
                  ? " Description: " + structure.dataflow.description + "."
                  : "";
                const prompt =
                  "I'd like to explore the " +
                  dataflowId +
                  " dataflow (" +
                  structure.dataflow.name +
                  ")." +
                  desc +
                  " Dimensions: " +
                  dimList +
                  (timeDim ? ", " + timeDim.id : "") +
                  ".";
                window.location.href =
                  "/builder?new=1&prompt=" + encodeURIComponent(prompt);
              }}
              className="ocean-gradient rounded-full px-5 py-2 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
            >
              Explore
            </button>
            <Link
              href="/explore"
              className="ghost-border rounded-full bg-surface-card px-4 py-2 text-sm font-semibold text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
            >
              Back to Catalogue
            </Link>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Left: Dimensions + Attributes */}
          <div className="space-y-4 lg:col-span-1">
            {/* Key template */}
            <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
              <h3 className="type-label-md mb-3 text-on-tertiary-fixed-variant">
                Key Structure
              </h3>
              <code className="block rounded-[var(--radius-md)] bg-surface-high/50 px-3 py-2 text-xs text-on-surface">
                {structure.structure.key_template}
              </code>
            </div>

            {/* Dimensions */}
            <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
              <h3 className="type-label-md mb-3 text-on-tertiary-fixed-variant">
                Dimensions ({dims.length + (timeDim ? 1 : 0)})
              </h3>
              <div className="space-y-1">
                {dims.map((dim) => (
                  <div key={dim.id}>
                    <button
                      type="button"
                      onClick={() =>
                        dim.codelist ? toggleDimension(dim.id) : undefined
                      }
                      className={
                        "flex w-full items-center justify-between rounded-[var(--radius-md)] px-3 py-2 text-left transition-colors " +
                        (expandedDim === dim.id
                          ? "bg-primary/5 text-primary"
                          : "text-on-surface hover:bg-surface-low") +
                        (dim.codelist ? " cursor-pointer" : " cursor-default")
                      }
                    >
                      <div>
                        <span className="text-xs font-semibold">
                          [{dim.position}] {dim.id}
                        </span>
                        {dim.codelist && (
                          <span className="ml-2 text-[10px] text-on-surface-variant">
                            {dim.codelist.split(":").pop()?.split("(")[0]}
                          </span>
                        )}
                      </div>
                      {dim.codelist && (
                        <svg
                          className={
                            "h-3 w-3 transition-transform " +
                            (expandedDim === dim.id ? "rotate-180" : "")
                          }
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                          strokeWidth={2}
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M19.5 8.25l-7.5 7.5-7.5-7.5"
                          />
                        </svg>
                      )}
                    </button>

                    {/* Expanded codes */}
                    {expandedDim === dim.id && (
                      <div className="ml-3 mt-1 max-h-60 overflow-y-auto rounded-[var(--radius-md)] bg-surface-low p-2">
                        {codesLoading === dim.id ? (
                          <div className="space-y-1 p-2">
                            {Array.from({ length: 5 }, (_, i) => (
                              <div
                                key={i}
                                className="shimmer h-3 w-full rounded-[var(--radius-sm)]"
                              />
                            ))}
                          </div>
                        ) : dimCodes[dim.id]?.length ? (
                          <table className="w-full text-xs">
                            <tbody>
                              {dimCodes[dim.id].map((code) => (
                                <tr
                                  key={code.id}
                                  className="transition-colors hover:bg-surface-card"
                                >
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
                        ) : (
                          <p className="p-2 text-xs text-on-surface-variant">
                            No codes available
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                ))}

                {/* Time dimension */}
                {timeDim && (
                  <div className="flex items-center rounded-[var(--radius-md)] px-3 py-2 text-on-surface">
                    <span className="text-xs font-semibold">
                      [{timeDim.position}] {timeDim.id}
                    </span>
                    <span className="ml-2 rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold text-on-secondary-container">
                      Time
                    </span>
                  </div>
                )}
              </div>
            </div>

            {/* Attributes */}
            <div className="rounded-[var(--radius-xl)] bg-surface-card p-5 shadow-ambient">
              <h3 className="type-label-md mb-3 text-on-tertiary-fixed-variant">
                Attributes ({structure.structure.attributes.length})
              </h3>
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
          </div>

          {/* Right: Structure diagram + interpretation */}
          <div className="space-y-4 lg:col-span-2">
            {/* Mermaid diagram */}
            {diagram && (
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient">
                <h3 className="type-label-md mb-4 text-on-tertiary-fixed-variant">
                  Structure Diagram
                </h3>
                <MermaidDiagram code={diagram.mermaid_diagram} />
              </div>
            )}

            {/* Interpretation */}
            {diagram && diagram.interpretation.length > 0 && (
              <div className="rounded-[var(--radius-xl)] bg-surface-card p-6 shadow-ambient">
                <h3 className="type-label-md mb-3 text-on-tertiary-fixed-variant">
                  Structure Summary
                </h3>
                <div className="space-y-1 text-xs leading-relaxed text-on-surface-variant">
                  {diagram.interpretation.map((line, i) => {
                    if (!line.trim()) return <div key={i} className="h-2" />;
                    if (line.startsWith("**")) {
                      return (
                        <p key={i} className="font-semibold text-on-surface">
                          {line.replace(/\*\*/g, "")}
                        </p>
                      );
                    }
                    return <p key={i}>{line.replace(/^\s+-\s/, "  ")}</p>;
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
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
      <div className="mx-auto flex max-w-6xl items-center justify-between">
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
            <h1 className="font-[family-name:var(--font-manrope)] text-base font-bold tracking-tight text-primary">
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
