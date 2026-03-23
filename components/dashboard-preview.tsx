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
import type {
  SDMXDashboardConfig,
  SDMXDashboardRow,
  SDMXTextConfig,
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
      return (
        <div className="rounded-[var(--radius-lg)] bg-surface-high p-6">
          <p className="type-label-md text-on-surface">
            Dashboard render error
          </p>
          <p className="mt-2 text-sm text-on-surface-variant">
            {this.state.error.message}
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

const JSON_INDENT = "  ";

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

const COMPONENT_TYPES = new Set([
  "line",
  "bar",
  "column",
  "pie",
  "lollipop",
  "treemap",
  "value",
  "drilldown",
  "note",
  "map",
]);

function getKeyClassName(key: string): string {
  if (STRUCTURAL_KEYS.has(key)) {
    return "font-semibold text-primary";
  }

  if (DATA_KEYS.has(key)) {
    return "font-medium text-secondary";
  }

  if (CONTENT_KEYS.has(key)) {
    return "font-medium text-tertiary";
  }

  return "text-kelp";
}

function getStringClassName(key: string | null, value: string): string {
  if (/^https?:\/\//.test(value)) {
    return "text-primary-container";
  }

  if (key === "type" && COMPONENT_TYPES.has(value)) {
    return "font-semibold text-tertiary-container";
  }

  if (
    key === "xAxisConcept" ||
    key === "yAxisConcept" ||
    key === "concept" ||
    /^[A-Z0-9_]+$/.test(value)
  ) {
    return "font-medium text-secondary";
  }

  if (key === "id") {
    return "font-medium text-primary-container";
  }

  return "text-on-surface";
}

function formatJsonPreview(value: unknown): ReactNode[] {
  let nodeIndex = 0;

  const nextKey = (prefix: string) => prefix + String(nodeIndex++);
  const indent = (depth: number) => JSON_INDENT.repeat(depth);
  const punctuation = (value: string) => (
    <span key={nextKey("p")} className="text-outline-variant">
      {value}
    </span>
  );

  const renderPrimitive = (
    primitive: string | number | boolean | null,
    keyName: string | null,
  ) => {
    if (typeof primitive === "string") {
      return (
        <span
          key={nextKey("s")}
          className={getStringClassName(keyName, primitive)}
        >
          {JSON.stringify(primitive)}
        </span>
      );
    }

    if (typeof primitive === "number") {
      return (
        <span key={nextKey("n")} className="font-medium text-reef-teal">
          {String(primitive)}
        </span>
      );
    }

    if (typeof primitive === "boolean") {
      return (
        <span key={nextKey("b")} className="font-medium text-tertiary">
          {String(primitive)}
        </span>
      );
    }

    return (
      <span key={nextKey("null")} className="text-text-muted">
        null
      </span>
    );
  };

  const renderValue = (
    currentValue: unknown,
    depth: number,
    keyName: string | null,
  ): ReactNode[] => {
    if (
      currentValue === null ||
      typeof currentValue === "string" ||
      typeof currentValue === "number" ||
      typeof currentValue === "boolean"
    ) {
      return [
        renderPrimitive(
          currentValue as string | number | boolean | null,
          keyName,
        ),
      ];
    }

    if (Array.isArray(currentValue)) {
      if (currentValue.length === 0) {
        return [punctuation("[]")];
      }

      const nodes: ReactNode[] = [punctuation("["), "\n"];

      currentValue.forEach((item, index) => {
        nodes.push(indent(depth + 1));
        nodes.push(...renderValue(item, depth + 1, null));
        if (index < currentValue.length - 1) {
          nodes.push(punctuation(","));
        }
        nodes.push("\n");
      });

      nodes.push(indent(depth), punctuation("]"));
      return nodes;
    }

    if (typeof currentValue !== "object") {
      return [
        <span key={nextKey("unknown")} className="text-on-surface-variant">
          {JSON.stringify(currentValue)}
        </span>,
      ];
    }

    const entries = Object.entries(currentValue as Record<string, unknown>);

    if (entries.length === 0) {
      return [punctuation("{}")];
    }

    const nodes: ReactNode[] = [punctuation("{"), "\n"];

    entries.forEach(([entryKey, entryValue], index) => {
      nodes.push(indent(depth + 1));
      nodes.push(
        <span key={nextKey("k")} className={getKeyClassName(entryKey)}>
          {JSON.stringify(entryKey)}
        </span>,
      );
      nodes.push(punctuation(": "));
      nodes.push(...renderValue(entryValue, depth + 1, entryKey));
      if (index < entries.length - 1) {
        nodes.push(punctuation(","));
      }
      nodes.push("\n");
    });

    nodes.push(indent(depth), punctuation("}"));
    return nodes;
  };

  return renderValue(value, 0, null);
}

function getTextValue(value?: SDMXTextConfig): string | null {
  if (!value) {
    return null;
  }

  if (typeof value.text === "string") {
    return value.text;
  }

  const first = Object.values(value.text)[0];
  return typeof first === "string" ? first : null;
}

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
      return "border-reef-teal/30 bg-lagoon/15";
    case "map":
      return "border-lagoon/40 bg-lagoon/12";
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
        "inline-flex rounded-full px-2 py-0.5 font-[family-name:var(--font-inter)] text-[10px] font-bold uppercase tracking-[0.08em] " +
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
      <span className="font-mono text-xs font-semibold text-reef-teal">
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
  const title = getTextValue(visual.title) || visual.id;
  const subtitle = getTextValue(visual.subtitle);
  const note = getTextValue(visual.note);
  const dataValues = Array.isArray(visual.data) ? visual.data : [visual.data];
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
          <h4 className="font-[family-name:var(--font-manrope)] text-base font-semibold text-on-surface">
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
          <h3 className="mt-1 font-[family-name:var(--font-manrope)] text-lg font-semibold text-on-surface">
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
            <h3 className="font-[family-name:var(--font-manrope)] text-lg font-semibold text-on-surface">
              {getTextValue(config.header?.title) || config.id}
            </h3>
            {getTextValue(config.header?.subtitle) && (
              <p className="text-sm text-on-surface-variant">
                {getTextValue(config.header?.subtitle)}
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

/** Syntax-highlight the current raw JSON text while editing or on invalid JSON */
function highlightJson(json: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /("(?:\\.|[^"\\])*")\s*:/g;
  const keySet = new Set<number>();

  // First pass: find key positions
  let km;
  while ((km = re.exec(json)) !== null) {
    keySet.add(km.index);
  }

  // Token regex
  const tokenRe =
    /"(?:\\.|[^"\\])*"|(?:true|false|null)|\b-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?\b/g;
  let lastIndex = 0;
  let m;
  let idx = 0;
  while ((m = tokenRe.exec(json)) !== null) {
    // Text before token
    if (m.index > lastIndex) {
      nodes.push(
        <span key={"t" + String(idx++)} className="text-on-surface-variant">
          {json.slice(lastIndex, m.index)}
        </span>,
      );
    }
    const token = m[0];
    let cls: string;
    if (token.startsWith('"')) {
      cls = keySet.has(m.index)
        ? "text-primary font-medium" // keys
        : "text-secondary"; // string values
    } else if (token === "true" || token === "false" || token === "null") {
      cls = "text-tertiary";
    } else {
      cls = "text-reef-teal font-medium"; // numbers
    }
    nodes.push(
      <span key={"v" + String(idx++)} className={cls}>
        {token}
      </span>,
    );
    lastIndex = m.index + token.length;
  }
  if (lastIndex < json.length) {
    nodes.push(
      <span key={"e" + String(idx)} className="text-on-surface-variant">
        {json.slice(lastIndex)}
      </span>,
    );
  }
  return nodes;
}

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
  const preRef = useRef<HTMLPreElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
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
      JSON.parse(value);
      setParseError(null);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const handleApply = () => {
    try {
      const parsed = JSON.parse(text) as SDMXDashboardConfig;
      setParseError(null);
      setDirty(false);
      setEditing(false);
      setText(JSON.stringify(parsed, null, 2));
      onApply(parsed);
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
      const parsed = JSON.parse(text) as SDMXDashboardConfig;
      setText(JSON.stringify(parsed, null, 2));
      setParseError(null);
      setDirty(true);
    } catch (e) {
      setParseError((e as Error).message);
    }
  };

  const parsedText = (() => {
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return null;
    }
  })();

  const isPrettyFormatted =
    parsedText !== null && text === JSON.stringify(parsedText, null, 2);

  const editorContent =
    parsedText !== null && isPrettyFormatted
      ? formatJsonPreview(parsedText)
      : highlightJson(text);

  const lineCount = text.split("\n").length;

  // Sync scroll between textarea and highlighted pre
  const handleScroll = () => {
    if (textareaRef.current && preRef.current) {
      preRef.current.scrollTop = textareaRef.current.scrollTop;
      preRef.current.scrollLeft = textareaRef.current.scrollLeft;
    }
  };

  return (
    <div className="flex h-full flex-col">
      {/* Toolbar */}
      <div className="flex shrink-0 items-center justify-between bg-surface-high/50 px-4 py-2">
        <div className="flex items-center gap-2">
          {!editing && !dirty && (
            <button
              type="button"
              onClick={() => {
                setEditing(true);
                setTimeout(() => textareaRef.current?.focus(), 0);
              }}
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
              className="ocean-gradient rounded-full px-4 py-1 text-xs font-semibold text-on-primary shadow-lg shadow-primary/20 transition-transform hover:scale-105 active:scale-95 disabled:opacity-40 disabled:shadow-none disabled:hover:scale-100"
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
              "relative h-full overflow-hidden rounded-[var(--radius-lg)] bg-surface-card shadow-ambient " +
              (parseError
                ? "ring-2 ring-red-400/50"
                : dirty
                  ? "ring-2 ring-secondary/30"
                  : "")
            }
          >
            {/* Line numbers */}
            <div
              className="pointer-events-none absolute left-0 top-0 flex h-full w-10 flex-col items-end overflow-hidden bg-surface-high/30 pt-4 pr-2"
              aria-hidden
            >
              {Array.from({ length: lineCount }, (_, i) => (
                <span
                  key={i}
                  className="block h-[1.35rem] text-[10px] leading-[1.35rem] text-outline-variant"
                >
                  {i + 1}
                </span>
              ))}
            </div>

            <>
              <pre
                ref={preRef}
                className="pointer-events-none absolute inset-0 overflow-hidden pl-12 pr-4 pt-4 pb-4 font-mono text-xs leading-[1.35rem] whitespace-pre"
                aria-hidden
              >
                <code>{editorContent}</code>
              </pre>
              <textarea
                ref={textareaRef}
                value={text}
                onChange={(e) => handleChange(e.target.value)}
                onScroll={handleScroll}
                spellCheck={false}
                className="relative z-10 h-full w-full resize-none bg-transparent pl-12 pr-4 pt-4 pb-4 font-mono text-xs leading-[1.35rem] text-transparent caret-primary focus:outline-none"
              />
            </>
          </div>
        ) : (
          <button
            type="button"
            className="block h-full w-full overflow-auto rounded-[var(--radius-lg)] bg-surface-card p-4 text-left shadow-ambient transition-shadow hover:shadow-none focus:outline-none"
            onClick={() => {
              setEditing(true);
              setTimeout(() => textareaRef.current?.focus(), 0);
            }}
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

// ── Main Component ──

interface DashboardPreviewProps {
  config: SDMXDashboardConfig | null;
  onConfigEdit?: (config: SDMXDashboardConfig) => void;
  onError?: (error: string) => void;
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
}: DashboardPreviewProps) {
  const [tab, setTab] = useState<"preview" | "json">("preview");
  const [showSkeleton, setShowSkeleton] = useState(false);
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
        onError?.(allErrors.join("; "));
      }, 2000);
    },
    [onError],
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
        msg.includes("dimension")
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

  const title =
    typeof config?.header?.title?.text === "string"
      ? config.header.title.text
      : null;

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

  useEffect(() => {
    if (!config || tab !== "preview" || !hasValidRows) {
      setShowSkeleton(false);
      return;
    }

    setShowSkeleton(true);
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
            <svg
              className="h-8 w-8 text-soft-mist"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5m.75-9l3-3 2.148 2.148A12.061 12.061 0 0116.5 7.605"
              />
            </svg>
          </div>
          <h3 className="type-headline-sm text-on-surface">
            Dashboard Preview
          </h3>
          <p className="mt-3 text-sm leading-relaxed text-on-surface-variant">
            Describe the data you want to explore in the chat, and your
            dashboard will appear here.
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
            <span className="font-[family-name:var(--font-manrope)] text-sm font-semibold tracking-tight text-on-surface">
              {title}
            </span>
          )}
        </div>

        {tab === "preview" && (
          <span className="type-label-md rounded-full bg-tertiary-fixed px-2.5 py-0.5 text-tertiary-container">
            Live
          </span>
        )}
      </div>

      {/* Tab content */}
      {tab === "json" ? (
        <JsonEditor
          config={config}
          onApply={(edited) => onConfigEdit?.(edited)}
        />
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
          <div ref={dashboardRootRef} className="relative z-10">
            <DashboardErrorBoundary
              key={JSON.stringify(config)}
              onError={reportError}
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <SDMXDashboard config={config as any} lang="en" />
            </DashboardErrorBoundary>
          </div>
          {showSkeleton && (
            <div className="pointer-events-none absolute inset-6 z-20 transition-opacity duration-300">
              <DashboardSkeleton config={config} />
            </div>
          )}
        </div>
      )}
    </div>
  );
});
