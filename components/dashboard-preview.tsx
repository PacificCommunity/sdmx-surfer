"use client";

import {
  memo,
  useState,
  useEffect,
  useRef,
  useCallback,
  Component,
  type ReactNode,
} from "react";
import dynamic from "next/dynamic";
import { json as jsonLang } from "@codemirror/lang-json";
import { exportToPdf, exportToHtml, exportToHtmlLive, exportToJson } from "@/lib/export-dashboard";
import { extractDataSources, type DataSource } from "@/lib/data-explorer-url";
import { SurferLogo } from "@/components/surfer-logo";
import {
  dashboardConfigSchema,
  formatDashboardConfigError,
} from "@/lib/dashboard-schema";
import {
  getDashboardTitle,
  getTextConfigValue,
} from "@/lib/dashboard-text";
import { useHighchartsViewportReflow } from "@/lib/use-highcharts-viewport-reflow";
import type {
  SDMXDashboardConfig,
  SDMXDashboardRow,
  SDMXVisualConfig,
} from "@/lib/types";

declare module "highcharts" {
  let __errorHandlerInstalled: boolean | undefined;
}

const SDMXDashboard = dynamic(
  () =>
    Promise.all([
      import("sdmx-dashboard-components"),
      import("highcharts"),
    ]).then(([mod, hcMod]) => {
      const Highcharts = hcMod.default;
      if (Highcharts.addEvent && !Highcharts.__errorHandlerInstalled) {
        Highcharts.addEvent(Highcharts, "displayError", function (
          e: { code: number; message: string; preventDefault: () => void },
        ) {
          console.warn(
            "[Highcharts] error #" + String(e.code) + ":",
            e.message,
          );
          e.preventDefault();
        });
        Highcharts.__errorHandlerInstalled = true;
      }
      return mod.SDMXDashboard;
    }),
  { ssr: false },
);

class DashboardErrorBoundary extends Component<
  { children: ReactNode; onError?: (error: string) => void },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error) {
    this.props.onError?.(error.message);
  }

  render() {
    if (this.state.error) {
      const rawMsg = this.state.error.message;
      const isDataError = rawMsg.includes("toFixed") ||
        rawMsg.includes("Cannot read properties of undefined") ||
        rawMsg.includes("Cannot read properties of null");
      const friendlyMsg = isDataError
        ? "Some data points are missing or in an unexpected format. The AI will try to fix this."
        : rawMsg;
      return (
        <div className="rounded-[var(--radius-lg)] bg-surface-high p-6">
          <p className="type-label-md text-on-surface">
            Dashboard render error
          </p>
          <p className="mt-2 text-sm text-on-surface-variant">
            {friendlyMsg}
          </p>
          <button
            type="button"
            className="mt-3 rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary shadow-ambient transition-transform hover:scale-105 active:scale-95"
            onClick={() => this.setState({ error: null })}
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ── JSON Editor Tab ──

const STRUCTURAL_KEYS = new Set([
  "id",
  "rows",
  "columns",
  "header",
  "footer",
  "colCount",
  "type",
  "colSize",
]);

const DATA_KEYS = new Set([
  "data",
  "xAxisConcept",
  "yAxisConcept",
  "legend",
  "concept",
  "location",
  "sortByValue",
  "colorScheme",
  "colorPalette",
  "dataLink",
  "metadataLink",
  "drilldown",
  "extraOptions",
]);

const CONTENT_KEYS = new Set([
  "title",
  "subtitle",
  "note",
  "text",
  "unit",
  "decimals",
  "labels",
  "download",
  "frame",
  "adaptiveTextSize",
]);

// getKeyClassName, getStringClassName, formatJsonPreview removed — CodeMirror handles editing

function getKeyTone(key: string): string {
  if (STRUCTURAL_KEYS.has(key)) {
    return "bg-primary/8 text-primary";
  }

  if (DATA_KEYS.has(key)) {
    return "bg-secondary/10 text-secondary";
  }

  if (CONTENT_KEYS.has(key)) {
    return "bg-tertiary-fixed/50 text-tertiary";
  }

  return "bg-surface-high text-on-surface-variant";
}

function getVisualTone(type: SDMXVisualConfig["type"]): string {
  switch (type) {
    case "line":
      return "border-secondary/35 bg-secondary-container/15";
    case "bar":
    case "column":
    case "lollipop":
      return "border-primary/30 bg-primary/6";
    case "pie":
    case "treemap":
      return "border-tertiary/30 bg-tertiary-fixed/35";
    case "value":
      return "border-secondary/30 bg-accent-light/15";
    case "map":
      return "border-accent-light/40 bg-accent-light/12";
    case "note":
      return "border-outline-variant bg-surface-high/50";
    case "drilldown":
      return "border-primary-container/30 bg-primary-container/8";
    default:
      return "border-outline-variant bg-surface-high/35";
  }
}

function InspectorKey({ name }: { name: string }) {
  return (
    <span
      className={
        "inline-flex rounded-full px-2 py-0.5 font-[family-name:var(--font-body)] text-[10px] font-bold uppercase tracking-[0.08em] " +
        getKeyTone(name)
      }
    >
      {name}
    </span>
  );
}

function InspectorPrimitive({
  value,
  keyName,
}: {
  value: string | number | boolean | null;
  keyName?: string;
}) {
  if (value === null) {
    return <span className="font-mono text-xs text-text-muted">null</span>;
  }

  if (typeof value === "boolean") {
    return (
      <span
        className={
          "inline-flex rounded-full px-2 py-0.5 font-mono text-xs font-semibold " +
          (value
            ? "bg-secondary/12 text-secondary"
            : "bg-surface-high text-on-surface-variant")
        }
      >
        {String(value)}
      </span>
    );
  }

  if (typeof value === "number") {
    return (
      <span className="font-mono text-xs font-semibold text-secondary">
        {String(value)}
      </span>
    );
  }

  if (/^https?:\/\//.test(value)) {
    return (
      <span className="block break-all rounded-[var(--radius-md)] bg-primary/6 px-3 py-2 font-mono text-[11px] text-primary-container">
        {value}
      </span>
    );
  }

  if (
    keyName === "type" ||
    keyName === "xAxisConcept" ||
    keyName === "yAxisConcept" ||
    keyName === "concept" ||
    /^[A-Z0-9_]+$/.test(value)
  ) {
    return (
      <span className="inline-flex rounded-full bg-secondary/10 px-2 py-0.5 font-mono text-xs font-semibold text-secondary">
        {value}
      </span>
    );
  }

  if (keyName === "id") {
    return (
      <span className="font-mono text-xs font-medium text-primary-container">
        {value}
      </span>
    );
  }

  return <span className="text-sm text-on-surface">{value}</span>;
}

function InspectorField({
  name,
  children,
}: {
  name: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <InspectorKey name={name} />
      <div>{children}</div>
    </div>
  );
}

function GenericInspectorValue({
  value,
  keyName,
}: {
  value: unknown;
  keyName?: string;
}) {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return (
      <InspectorPrimitive
        keyName={keyName}
        value={value as string | number | boolean | null}
      />
    );
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <span className="font-mono text-xs text-text-muted">[]</span>;
    }

    return (
      <div className="space-y-2">
        {value.map((item, index) => (
          <div
            key={index}
            className="rounded-[var(--radius-md)] bg-surface-low px-3 py-2"
          >
            <GenericInspectorValue value={item} />
          </div>
        ))}
      </div>
    );
  }

  if (typeof value === "object") {
    return (
      <div className="space-y-2 rounded-[var(--radius-md)] bg-surface-low px-3 py-3">
        {Object.entries(value as Record<string, unknown>).map(
          ([entryKey, entryValue]) => (
            <InspectorField key={entryKey} name={entryKey}>
              <GenericInspectorValue
                keyName={entryKey}
                value={entryValue}
              />
            </InspectorField>
          ),
        )}
      </div>
    );
  }

  return (
    <span className="font-mono text-xs text-on-surface-variant">
      {String(value)}
    </span>
  );
}

function VisualCard({
  visual,
  index,
}: {
  visual: SDMXVisualConfig;
  index: number;
}) {
  const title = getTextConfigValue(visual.title) || visual.id;
  const subtitle = getTextConfigValue(visual.subtitle);
  const note = getTextConfigValue(visual.note);
  const dataValues = (Array.isArray(visual.data) ? visual.data : [visual.data]).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  const topLevelFields = ([
    ["id", visual.id],
    ["colSize", visual.colSize],
    ["xAxisConcept", visual.xAxisConcept],
    ["yAxisConcept", visual.yAxisConcept],
    ["legend", visual.legend],
    ["data", visual.data],
    ["sortByValue", visual.sortByValue],
    ["unit", visual.unit],
    ["decimals", visual.decimals],
    ["labels", visual.labels],
    ["download", visual.download],
    ["frame", visual.frame],
    ["colorScheme", visual.colorScheme],
    ["colorPalette", visual.colorPalette],
    ["dataLink", visual.dataLink],
    ["metadataLink", visual.metadataLink],
    ["drilldown", visual.drilldown],
    ["extraOptions", visual.extraOptions],
  ] as Array<[string, unknown]>).filter(([, value]) => value !== undefined);

  return (
    <section
      className={
        "space-y-4 rounded-[var(--radius-xl)] border p-4 shadow-ambient " +
        getVisualTone(visual.type)
      }
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <span className="type-label-md text-on-surface-variant">
              Plot {index + 1}
            </span>
            <span className="inline-flex rounded-full bg-surface-card px-2.5 py-0.5 font-mono text-xs font-semibold text-secondary shadow-sm">
              {visual.type}
            </span>
          </div>
          <h4 className="font-[family-name:var(--font-display)] text-base font-semibold text-on-surface">
            {title}
          </h4>
          {subtitle && (
            <p className="text-sm text-on-surface-variant">{subtitle}</p>
          )}
        </div>
        <span className="inline-flex rounded-full bg-surface-card px-2 py-1 font-mono text-[11px] text-primary-container shadow-sm">
          {dataValues.length} data source{dataValues.length === 1 ? "" : "s"}
        </span>
      </div>

      {note && (
        <div className="rounded-[var(--radius-lg)] bg-surface-card/70 px-4 py-3 text-sm italic text-on-surface-variant">
          {note}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        {topLevelFields.map(([fieldName, fieldValue]) => (
          <InspectorField key={fieldName} name={fieldName}>
            <GenericInspectorValue keyName={fieldName} value={fieldValue} />
          </InspectorField>
        ))}
      </div>
    </section>
  );
}

function RowCard({ row, index }: { row: SDMXDashboardRow; index: number }) {
  return (
    <section className="space-y-4 rounded-[var(--radius-2xl)] bg-surface-low p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <span className="type-label-md text-on-surface-variant">
            Row {index + 1}
          </span>
          <h3 className="mt-1 font-[family-name:var(--font-display)] text-lg font-semibold text-on-surface">
            {row.columns.length} panel{row.columns.length === 1 ? "" : "s"}
          </h3>
        </div>
        <span className="inline-flex rounded-full bg-surface-card px-2.5 py-1 font-mono text-xs text-secondary shadow-sm">
          columns[{row.columns.length}]
        </span>
      </div>

      <div className="space-y-4">
        {row.columns.map((visual, visualIndex) => (
          <VisualCard
            key={visual.id || `visual-${visualIndex}`}
            visual={visual}
            index={visualIndex}
          />
        ))}
      </div>
    </section>
  );
}

function ConfigInspector({ config }: { config: SDMXDashboardConfig }) {
  return (
    <div className="space-y-4">
      <section className="space-y-4 rounded-[var(--radius-2xl)] bg-surface-low p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="space-y-1">
            <span className="type-label-md text-on-surface-variant">
              Dashboard Config
            </span>
            <h3 className="font-[family-name:var(--font-display)] text-lg font-semibold text-on-surface">
              {getDashboardTitle(config)}
            </h3>
            {getTextConfigValue(config.header?.subtitle) && (
              <p className="text-sm text-on-surface-variant">
                {getTextConfigValue(config.header?.subtitle)}
              </p>
            )}
          </div>
          <span className="inline-flex rounded-full bg-surface-card px-2.5 py-1 font-mono text-xs text-primary-container shadow-sm">
            rows[{config.rows.length}]
          </span>
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          <InspectorField name="id">
            <GenericInspectorValue keyName="id" value={config.id} />
          </InspectorField>
          <InspectorField name="colCount">
            <GenericInspectorValue
              keyName="colCount"
              value={config.colCount ?? 3}
            />
          </InspectorField>
          {config.header && (
            <InspectorField name="header">
              <GenericInspectorValue keyName="header" value={config.header} />
            </InspectorField>
          )}
          {config.footer && (
            <InspectorField name="footer">
              <GenericInspectorValue keyName="footer" value={config.footer} />
            </InspectorField>
          )}
        </div>
      </section>

      {config.rows.map((row, index) => (
        <RowCard key={`row-${index}`} row={row} index={index} />
      ))}
    </div>
  );
}


const LazyCodeMirror = dynamic(() => import("@uiw/react-codemirror"), {
  ssr: false,
  loading: () => <div className="shimmer h-full w-full rounded-[var(--radius-lg)]" />,
});

function JsonEditor({
  config,
  onApply,
}: {
  config: SDMXDashboardConfig;
  onApply: (config: SDMXDashboardConfig) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(config, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const prettyConfigText = JSON.stringify(config, null, 2);

  // Sync when external config changes (new AI output)
  useEffect(() => {
    if (!dirty) {
      setText(prettyConfigText);
    }
  }, [prettyConfigText, dirty]);

  const handleChange = (value: string) => {
    setText(value);
    setDirty(true);
    try {
      const parsed = JSON.parse(value) as unknown;
      const validation = dashboardConfigSchema.safeParse(parsed);
      setParseError(
        validation.success ? null : formatDashboardConfigError(validation.error),
      );
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const validation = dashboardConfigSchema.safeParse(parsed);
      if (!validation.success) {
        setParseError(formatDashboardConfigError(validation.error));
        return;
      }
      setParseError(null);
      setDirty(false);
      setEditing(false);
      setText(JSON.stringify(validation.data, null, 2));
      onApply(validation.data as SDMXDashboardConfig);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleReset = () => {
    setText(prettyConfigText);
    setParseError(null);
    setDirty(false);
    setEditing(false);
  };

  const handleFormat = () => {
    try {
      const parsed = JSON.parse(text) as unknown;
      const validation = dashboardConfigSchema.safeParse(parsed);
      if (!validation.success) {
        setParseError(formatDashboardConfigError(validation.error));
        return;
      }
      setText(JSON.stringify(validation.data, null, 2));
      setParseError(null);
      setDirty(true);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const isPrettyFormatted = (() => {
    try {
      return text === JSON.stringify(JSON.parse(text), null, 2);
    } catch {
      return false;
    }
  })();

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between bg-surface-high/50 px-4 py-2">
        <div className="flex items-center gap-2">
          {!editing && !dirty && (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="ghost-border rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
            >
              Edit
            </button>
          )}
          {dirty && (
            <span className="type-label-md text-secondary">Modified</span>
          )}
          {parseError && (
            <span className="text-xs text-red-600">
              {parseError.split(" at ")[0]}
            </span>
          )}
        </div>
        <div className="flex gap-2">
          {dirty && !parseError && !isPrettyFormatted && (
            <button
              type="button"
              onClick={handleFormat}
              className="rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-secondary transition-transform hover:scale-105 active:scale-95"
            >
              Format
            </button>
          )}
          {(editing || dirty) && (
            <button
              type="button"
              onClick={handleReset}
              className="rounded-full bg-surface-card px-3 py-1 text-xs font-medium text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
            >
              {dirty ? "Reset" : "Cancel"}
            </button>
          )}
          {dirty && (
            <button
              type="button"
              onClick={handleApply}
              disabled={!!parseError}
              className="brand-gradient rounded-full px-4 py-1 text-xs font-semibold text-on-primary shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
            >
              Apply
            </button>
          )}
        </div>
      </div>

      {/* Code view */}
      <div className="flex-1 overflow-hidden bg-surface-low p-4">
        {editing || dirty ? (
          <div
            className={
              "h-full overflow-hidden rounded-[var(--radius-lg)] bg-surface-card shadow-ambient " +
              (parseError
                ? "ring-2 ring-red-400/50"
                : dirty
                  ? "ring-2 ring-secondary/30"
                  : "")
            }
          >
            <LazyCodeMirror
              value={text}
              onChange={(val) => handleChange(val)}
              extensions={[jsonLang()]}
              theme="light"
              basicSetup={{
                lineNumbers: true,
                foldGutter: true,
                highlightActiveLine: true,
                bracketMatching: true,
                closeBrackets: true,
                autocompletion: false,
              }}
              height="100%"
              style={{ height: "100%", fontSize: "12px" }}
            />
          </div>
        ) : (
          <button
            type="button"
            className="block h-full w-full overflow-auto rounded-[var(--radius-lg)] bg-surface-card p-4 text-left shadow-ambient transition-shadow hover:shadow-none focus:outline-none"
            onClick={() => setEditing(true)}
          >
            <ConfigInspector config={config} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── Loading Skeleton ──

function DashboardSkeleton({ config }: { config: SDMXDashboardConfig }) {
  const colCount = config.colCount || 3;

  return (
    <div className="animate-pulse space-y-6">
      {/* Header skeleton */}
      {config.header && (
        <div className="space-y-2">
          {config.header.title && (
            <div className="shimmer h-7 w-64 rounded-[var(--radius-md)]" />
          )}
          {config.header.subtitle && (
            <div className="shimmer h-4 w-96 rounded-[var(--radius-sm)]" />
          )}
        </div>
      )}

      {/* Row skeletons matching the actual grid */}
      {config.rows.map((row, ri) => (
        <div
          key={ri}
          className="grid gap-6"
          style={{
            gridTemplateColumns: "repeat(" + String(colCount) + ", minmax(0, 1fr))",
          }}
        >
          {row.columns.map((col, ci) => {
            const span = col.colSize || 1;
            const isValue = col.type === "value";
            const isNote = col.type === "note";

            return (
              <div
                key={ci}
                className="rounded-[var(--radius-lg)] bg-surface-card p-6 shadow-ambient"
                style={{ gridColumn: "span " + String(span) }}
              >
                {/* Component title */}
                {col.title && (
                  <div className="mb-4 space-y-1.5">
                    <div className="shimmer h-4 w-40 rounded-[var(--radius-sm)]" />
                    {col.subtitle && (
                      <div className="shimmer h-3 w-56 rounded-[var(--radius-sm)]" />
                    )}
                  </div>
                )}

                {/* Chart area */}
                {isValue ? (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <div className="shimmer h-10 w-28 rounded-[var(--radius-md)]" />
                    <div className="shimmer h-3 w-16 rounded-[var(--radius-sm)]" />
                  </div>
                ) : isNote ? (
                  <div className="space-y-2">
                    <div className="shimmer h-3 w-full rounded-[var(--radius-sm)]" />
                    <div className="shimmer h-3 w-4/5 rounded-[var(--radius-sm)]" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    {/* Legend placeholder */}
                    <div className="flex gap-3">
                      <div className="shimmer h-3 w-16 rounded-full" />
                      <div className="shimmer h-3 w-16 rounded-full" />
                    </div>
                    {/* Chart placeholder — bars or lines */}
                    <div className="flex h-48 items-end gap-2 pt-4">
                      {Array.from({ length: 7 }, (_, i) => (
                        <div
                          key={i}
                          className="shimmer flex-1 rounded-t-[var(--radius-sm)]"
                          style={{
                            height: String(30 + Math.abs(Math.sin(i * 1.8) * 70)) + "%",
                          }}
                        />
                      ))}
                    </div>
                    {/* X-axis labels */}
                    <div className="flex justify-between">
                      {Array.from({ length: 7 }, (_, i) => (
                        <div
                          key={i}
                          className="shimmer h-2 w-6 rounded-[var(--radius-sm)]"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// ── Data Sources Table ──

const TYPE_ICONS: Record<string, string> = {
  line: "M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605",
  bar: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  column: "M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z",
  pie: "M10.5 6a7.5 7.5 0 107.5 7.5h-7.5V6z M13.5 10.5H21A7.5 7.5 0 0013.5 3v7.5z",
  value: "M7.5 14.25v2.25m3-4.5v4.5m3-6.75v6.75m3-9v9M6 20.25h12A2.25 2.25 0 0020.25 18V6A2.25 2.25 0 0018 3.75H6A2.25 2.25 0 003.75 6v12A2.25 2.25 0 006 20.25z",
  map: "M9 6.75V15m0 0l-3-3m3 3l3-3m-8.25 6a4.5 4.5 0 01-1.41-8.775 5.25 5.25 0 0110.233-2.33 3 3 0 013.758 3.848A3.752 3.752 0 0118 19.5H6.75z",
};

function DataSourcesTable({ config }: { config: SDMXDashboardConfig }) {
  const sources = extractDataSources(config);
  if (sources.length === 0) return null;

  return (
    <div className="mt-6 rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
      <div className="px-6 py-4">
        <h4 className="type-label-md text-on-tertiary-fixed-variant">
          Data Sources
        </h4>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-high/40">
              <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">
                Component
              </th>
              <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">
                Dataflow
              </th>
              <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">
                Source
              </th>
              <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">
                Type
              </th>
              <th className="px-6 py-2 text-left font-semibold text-on-surface-variant">
                Links
              </th>
            </tr>
          </thead>
          <tbody>
            {sources.map((src) => (
              <DataSourceRow key={src.componentId + "-" + src.apiUrl} source={src} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function DataSourceRow({ source }: { source: DataSource }) {
  const iconPath = TYPE_ICONS[source.componentType] || TYPE_ICONS.line;

  return (
    <tr className="transition-colors hover:bg-surface-low">
      <td className="px-6 py-3">
        <div className="flex items-center gap-2">
          <svg
            className="h-4 w-4 shrink-0 text-on-surface-variant"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={1.5}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d={iconPath} />
          </svg>
          <span className="font-medium text-on-surface">
            {source.componentTitle}
          </span>
        </div>
      </td>
      <td className="px-6 py-3 text-on-surface">
        {source.dataflowName}
      </td>
      <td className="px-6 py-3">
        <span
          className="rounded-full bg-secondary-container px-2 py-0.5 text-[10px] font-semibold uppercase text-on-secondary-container"
          title={source.endpointName}
        >
          {source.endpointShortName}
        </span>
      </td>
      <td className="px-6 py-3">
        <span className="rounded-full bg-surface-high px-2 py-0.5 text-[10px] font-semibold uppercase text-on-surface-variant">
          {source.componentType}
        </span>
      </td>
      <td className="px-6 py-3">
        <div className="flex items-center gap-3">
          <a
            href={source.apiUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-primary hover:underline"
            title="Open raw SDMX API query"
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
            </svg>
            API
          </a>
          {source.explorerUrl && (
            <a
              href={source.explorerUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-secondary hover:underline"
              title="Open in Pacific Data Explorer"
            >
              <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Data Explorer
            </a>
          )}
        </div>
      </td>
    </tr>
  );
}

// ── Main Component ──

interface DashboardPreviewProps {
  config: SDMXDashboardConfig | null;
  onConfigEdit?: (config: SDMXDashboardConfig) => void;
  onError?: (error: string) => void;
  onUndo?: () => void;
  onRedo?: () => void;
  canUndo?: boolean;
  canRedo?: boolean;
  presentUrl?: string;
  isPublished?: boolean;
  onPublish?: () => void;
  onEditPublishDetails?: () => void;
  onUnpublish?: () => void;
  publicUrl?: string;
}

const LOAD_COMPLETE_SELECTOR = [
  ".highcharts-container",
  ".ol-viewport",
  "svg",
  "canvas",
].join(", ");

function dashboardNeedsGraphicSignal(config: SDMXDashboardConfig): boolean {
  return config.rows.some((row) =>
    row.columns.some((column) => column.type !== "note" && column.type !== "value"),
  );
}

export const DashboardPreview = memo(function DashboardPreview({
  config,
  onConfigEdit,
  onError,
  onUndo,
  onRedo,
  canUndo,
  canRedo,
  presentUrl,
  isPublished,
  onPublish,
  onEditPublishDetails,
  onUnpublish,
  publicUrl,
}: DashboardPreviewProps) {
  const [tab, setTab] = useState<"preview" | "json">("preview");
  const [showSkeleton, setShowSkeleton] = useState(false);
  const [animateDashboardEnter, setAnimateDashboardEnter] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [exportMenu, setExportMenu] = useState(false);
  const errorsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skeletonTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dashboardRootRef = useRef<HTMLDivElement>(null);

  const reportError = useCallback(
    (msg: string) => {
      if (errorsRef.current.has(msg)) return;
      errorsRef.current.add(msg);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        const allErrors = Array.from(errorsRef.current);
        // Enrich with component context so the AI knows which panels to investigate
        let context = allErrors.join("; ");
        if (config) {
          const components = config.rows.flatMap((r) =>
            r.columns.map((c) => {
              const title = getTextConfigValue(c.title) || c.id;
              const url = typeof c.data === "string" ? c.data : Array.isArray(c.data) ? c.data[0] : "";
              // Truncate URL for readability
              const shortUrl = url && url.length > 80 ? url.slice(0, 80) + "..." : url;
              return title + " (" + c.type + ", url: " + shortUrl + ")";
            }),
          );
          context +=
            ". Dashboard components: " + components.join("; ") +
            ". Check that each data URL returns valid data with observations. " +
            "Try the URL in a browser to verify. If a URL returns no data, " +
            "broaden the query (fewer dimension filters, wider time range) or use a different dataflow.";
        }
        onError?.(context);
      }, 2000);
    },
    [onError, config],
  );

  useEffect(() => {
    if (!config) return;
    const handler = (event: PromiseRejectionEvent) => {
      const msg =
        event.reason?.message || String(event.reason) || "Unknown error";
      if (
        msg.includes("fetching data") ||
        msg.includes("Highcharts") ||
        msg.includes("not found in dataflow") ||
        msg.includes("observations empty") ||
        msg.includes("dimension") ||
        msg.includes("toFixed") ||
        msg.includes("Cannot read properties of undefined") ||
        msg.includes("Cannot read properties of null")
      ) {
        event.preventDefault();
        reportError(msg);
      }
    };
    window.addEventListener("unhandledrejection", handler);
    return () => window.removeEventListener("unhandledrejection", handler);
  }, [config, reportError]);

  useEffect(() => {
    errorsRef.current = new Set();
    if (debounceRef.current) clearTimeout(debounceRef.current);
  }, [config]);

  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
      }
    };
  }, []);

  const title = config ? getDashboardTitle(config) : null;

  const hasValidRows = Boolean(
    config?.id &&
      Array.isArray(config.rows) &&
      config.rows.length > 0 &&
      config.rows.every(
        (row) => row && Array.isArray(row.columns) && row.columns.length > 0,
      ),
  );
  const needsGraphicSignal = config
    ? dashboardNeedsGraphicSignal(config)
    : false;

  useHighchartsViewportReflow(Boolean(config && tab === "preview" && hasValidRows));

  useEffect(() => {
    if (!config || tab !== "preview" || !hasValidRows) {
      setShowSkeleton(false);
      return;
    }

    setShowSkeleton(true);
  }, [config, hasValidRows, tab]);

  useEffect(() => {
    if (!config || tab !== "preview" || !hasValidRows) {
      setAnimateDashboardEnter(false);
      return;
    }

    setAnimateDashboardEnter(false);
    const frame = window.requestAnimationFrame(() => {
      setAnimateDashboardEnter(true);
    });
    const timeout = window.setTimeout(() => {
      setAnimateDashboardEnter(false);
    }, 400);

    return () => {
      window.cancelAnimationFrame(frame);
      window.clearTimeout(timeout);
    };
  }, [config, hasValidRows, tab]);

  useEffect(() => {
    if (!config || !showSkeleton || tab !== "preview" || !hasValidRows) {
      return;
    }

    const root = dashboardRootRef.current;

    if (!root) {
      return;
    }

    const hideSkeleton = () => {
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
        skeletonTimeoutRef.current = null;
      }
      setShowSkeleton(false);
    };

    const hasRenderedContent = () => {
      if (root.querySelector(LOAD_COMPLETE_SELECTOR)) {
        return true;
      }

      if (!needsGraphicSignal) {
        return (
          root.textContent?.trim().length !== 0 ||
          root.querySelectorAll("div, p, span, h1, h2, h3, h4, h5, h6").length > 4
        );
      }

      return false;
    };

    if (hasRenderedContent()) {
      hideSkeleton();
      return;
    }

    const observer = new MutationObserver(() => {
      if (hasRenderedContent()) {
        observer.disconnect();
        hideSkeleton();
      }
    });

    observer.observe(root, { childList: true, subtree: true });
    skeletonTimeoutRef.current = setTimeout(hideSkeleton, 6000);

    return () => {
      observer.disconnect();
      if (skeletonTimeoutRef.current) {
        clearTimeout(skeletonTimeoutRef.current);
        skeletonTimeoutRef.current = null;
      }
    };
  }, [config, needsGraphicSignal, showSkeleton, tab, hasValidRows]);

  if (!config) {
    return (
      <div className="flex h-full items-center justify-center p-12">
        <div className="submerged-overlay max-w-md rounded-[var(--radius-2xl)] bg-surface-low p-12 text-center">
          <div className="mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-[var(--radius-xl)] bg-surface-high">
            <SurferLogo className="h-8 w-8 text-accent-muted" />
          </div>
          <h3 className="type-headline-sm text-on-surface">
            Your exploration appears here
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            Start surfing in the chat — charts, maps, and data views
            will build up as you go.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* Header with tabs */}
      <div className="flex shrink-0 items-center justify-between bg-surface px-6 py-3">
        <div className="flex items-center gap-3">
          {/* Tab switcher */}
          <div className="flex rounded-full bg-surface-low p-0.5">
            <button
              type="button"
              onClick={() => setTab("preview")}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold transition-all " +
                (tab === "preview"
                  ? "bg-surface-card text-primary shadow-ambient"
                  : "text-on-surface-variant hover:text-on-surface")
              }
            >
              Preview
            </button>
            <button
              type="button"
              onClick={() => setTab("json")}
              className={
                "rounded-full px-3 py-1 text-xs font-semibold transition-all " +
                (tab === "json"
                  ? "bg-surface-card text-primary shadow-ambient"
                  : "text-on-surface-variant hover:text-on-surface")
              }
            >
              JSON
            </button>
          </div>

          {title && (
            <span className="font-[family-name:var(--font-display)] text-sm font-semibold tracking-tight text-on-surface">
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-2">
          {/* Undo / Redo */}
          <div className="flex rounded-full bg-surface-low p-0.5">
            <button
              type="button"
              onClick={onUndo}
              disabled={!canUndo}
              title="Undo"
              className="rounded-full p-1 text-on-surface-variant transition-colors hover:text-primary disabled:opacity-25"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 15L3 9m0 0l6-6M3 9h12a6 6 0 010 12h-3" />
              </svg>
            </button>
            <button
              type="button"
              onClick={onRedo}
              disabled={!canRedo}
              title="Redo"
              className="rounded-full p-1 text-on-surface-variant transition-colors hover:text-primary disabled:opacity-25"
            >
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 15l6-6m0 0l-6-6m6 6H9a6 6 0 000 12h3" />
              </svg>
            </button>
          </div>

          {/* Present (full-screen view) */}
          {presentUrl && config && (
            <a
              href={presentUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="Open full-screen presentation"
              className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
            >
              <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.5 6H5.25A2.25 2.25 0 003 8.25v10.5A2.25 2.25 0 005.25 21h10.5A2.25 2.25 0 0018 18.75V10.5m-10.5 6L21 3m0 0h-5.25M21 3v5.25" />
              </svg>
              Present
            </a>
          )}

          {/* Publish / Unpublish */}
          {config && (onPublish || onUnpublish) && (
            <div className="flex items-center gap-1.5">
              {isPublished ? (
                <>
                  {publicUrl && (
                    <button
                      type="button"
                      title="Copy public link"
                      onClick={() => {
                        const url = window.location.origin + publicUrl;
                        void navigator.clipboard.writeText(url);
                      }}
                      className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-secondary transition-transform hover:scale-105 active:scale-95"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.86-2.56a4.5 4.5 0 00-1.242-7.244l-4.5-4.5a4.5 4.5 0 00-6.364 6.364L4.757 8.81" />
                      </svg>
                      Copy Link
                    </button>
                  )}
                  {onEditPublishDetails && (
                    <button
                      type="button"
                      onClick={onEditPublishDetails}
                      title="Edit publish details"
                      className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95"
                    >
                      <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487a2.125 2.125 0 113.005 3.005L7.5 19.86 3 21l1.14-4.5 12.722-12.013z" />
                      </svg>
                      Edit Details
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={onUnpublish}
                    title="Unpublish dashboard"
                    className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-on-surface-variant transition-transform hover:scale-105 active:scale-95"
                  >
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.45 10.45 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
                    </svg>
                    Unpublish
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={onPublish}
                  title="Publish dashboard — makes it publicly viewable via a link"
                  className="brand-gradient flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95"
                >
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                  </svg>
                  Publish
                </button>
              )}
            </div>
          )}

          {/* Export dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setExportMenu((v) => !v)}
              disabled={exporting}
              className="ghost-border flex items-center gap-1.5 rounded-full bg-surface-card px-3 py-1 text-xs font-semibold text-primary transition-transform hover:scale-105 active:scale-95 disabled:opacity-50"
            >
              {exporting ? (
                <>
                  <span className="h-3 w-3 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                  Exporting...
                </>
              ) : (
                <>
                  <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
                  </svg>
                  Export
                </>
              )}
            </button>

            {exportMenu && (
              <>
                {/* Backdrop to close menu */}
                <div
                  className="fixed inset-0 z-20"
                  onClick={() => setExportMenu(false)}
                />
                <div className="absolute right-0 z-30 mt-1 w-48 rounded-[var(--radius-lg)] bg-surface-card p-1 shadow-ambient">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs font-medium text-on-surface transition-colors hover:bg-surface-low"
                    onClick={async () => {
                      setExportMenu(false);
                      if (!dashboardRootRef.current || !config) return;
                      setExporting(true);
                      try {
                        await exportToPdf(dashboardRootRef.current, config);
                      } finally {
                        setExporting(false);
                      }
                    }}
                  >
                    <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
                    </svg>
                    <div>
                      <div>PDF</div>
                      <div className="text-[10px] text-on-surface-variant">Snapshot of current view</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs font-medium text-on-surface transition-colors hover:bg-surface-low"
                    onClick={() => {
                      setExportMenu(false);
                      if (config && dashboardRootRef.current)
                        exportToHtml(dashboardRootRef.current, config);
                    }}
                  >
                    <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M17.25 6.75L22.5 12l-5.25 5.25m-10.5 0L1.5 12l5.25-5.25m7.5-3l-4.5 16.5" />
                    </svg>
                    <div>
                      <div>HTML (static)</div>
                      <div className="text-[10px] text-on-surface-variant">Snapshot — works offline, from file://</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs font-medium text-on-surface transition-colors hover:bg-surface-low"
                    onClick={() => {
                      setExportMenu(false);
                      if (config) exportToHtmlLive(config);
                    }}
                  >
                    <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5a17.92 17.92 0 01-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
                    </svg>
                    <div>
                      <div>HTML (live)</div>
                      <div className="text-[10px] text-on-surface-variant">Interactive — needs HTTP server + internet</div>
                    </div>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-3 py-2 text-left text-xs font-medium text-on-surface transition-colors hover:bg-surface-low"
                    onClick={() => {
                      setExportMenu(false);
                      if (config) exportToJson(config);
                    }}
                  >
                    <svg className="h-4 w-4 text-on-surface-variant" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 9.776c.112-.017.227-.026.344-.026h15.812c.117 0 .232.009.344.026m-16.5 0a2.25 2.25 0 00-1.883 2.542l.857 6a2.25 2.25 0 002.227 1.932H19.05a2.25 2.25 0 002.227-1.932l.857-6a2.25 2.25 0 00-1.883-2.542m-16.5 0V6A2.25 2.25 0 016 3.75h3.879a1.5 1.5 0 011.06.44l2.122 2.12a1.5 1.5 0 001.06.44H18A2.25 2.25 0 0120.25 9v.776" />
                    </svg>
                    <div>
                      <div>JSON Config</div>
                      <div className="text-[10px] text-on-surface-variant">Raw dashboard config</div>
                    </div>
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tab content */}
      {tab === "json" ? (
        <div className="flex-1 min-h-0">
          <JsonEditor
            config={config}
            onApply={(edited) => onConfigEdit?.(edited)}
          />
        </div>
      ) : !hasValidRows ? (
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="max-w-lg rounded-[var(--radius-xl)] bg-surface-low p-8 text-center">
            <p className="type-label-md text-on-surface-variant">
              Config received but rows are malformed
            </p>
            <pre className="mt-3 max-h-60 overflow-auto rounded-[var(--radius-md)] bg-surface-high p-4 text-left text-xs text-on-surface-variant">
              {JSON.stringify(config, null, 2)}
            </pre>
            <button
              type="button"
              onClick={() => setTab("json")}
              className="mt-3 rounded-full bg-surface-card px-4 py-1.5 text-xs font-semibold text-primary shadow-ambient transition-transform hover:scale-105 active:scale-95"
            >
              Edit JSON
            </button>
          </div>
        </div>
      ) : (
        <div className="relative flex-1 overflow-auto p-6">
          {/* Dashboard renders on top */}
          <div className="overflow-x-auto">
            <div
              ref={dashboardRootRef}
              className={
                "relative z-10 w-full min-w-[1024px] " +
                (animateDashboardEnter ? "dashboard-enter" : "")
              }
            >
              <DashboardErrorBoundary
                onError={reportError}
              >
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                <SDMXDashboard config={config as any} lang="en" />
              </DashboardErrorBoundary>
            </div>
          </div>
          {showSkeleton && (
            <div className="pointer-events-none absolute inset-6 z-20 transition-opacity duration-300">
              <DashboardSkeleton config={config} />
            </div>
          )}

          {/* Data sources table */}
          <DataSourcesTable config={config} />
        </div>
      )}
    </div>
  );
});
