"use client";

import { type ReactNode } from "react";
import {
  getDashboardTitle,
  getTextConfigValue,
} from "@/lib/dashboard-text";
import type {
  SDMXDashboardConfig,
  SDMXDashboardRow,
  SDMXVisualConfig,
} from "@/lib/types";

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

export function ConfigInspector({ config }: { config: SDMXDashboardConfig }) {
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
