import { z } from "zod";
import {
  type DashboardConfigInput,
  dashboardConfigSchema,
  localizedStringSchema,
  textConfigSchema,
  visualConfigSchema,
} from "./dashboard-schema";

const PACIFIC_EEZ_GEOJSON_URL =
  "https://geonode.pacificdata.org/geoserver/gwc/service/tms/1.0.0/geonode%3Aglobal_eez_200nm_split@EPSG%3A3857@pbf/{z}/{x}/{-y}.pbf";
const PACIFIC_EEZ_PROJECTION = "EPSG:3857";
const PACIFIC_EEZ_JOIN_PROPERTY = "iso_ter1";
const DEFAULT_VALUE_CONCEPT = "OBS_VALUE";

const authoringTextSchema = z.union([localizedStringSchema, textConfigSchema]);

const commonVisualSchema = z.object({
  id: z.string(),
  colSize: z.number().optional(),
  title: authoringTextSchema.optional(),
  subtitle: authoringTextSchema.optional(),
  note: authoringTextSchema.optional(),
  frame: z.boolean().optional(),
  download: z.boolean().optional(),
  adaptiveTextSize: z.boolean().optional(),
  dataLink: z.string().optional(),
  metadataLink: z.string().optional(),
  extraOptions: z.record(z.string(), z.unknown()).optional(),
});

const noteIntentSchema = commonVisualSchema.extend({
  kind: z.literal("note"),
  body: authoringTextSchema,
});

const kpiIntentSchema = commonVisualSchema.extend({
  kind: z.literal("kpi"),
  dataUrl: z.string().min(1),
  valueConcept: z.string().optional(),
  unit: z
    .object({
      text: z.string(),
      location: z.enum(["prefix", "suffix", "under"]).optional(),
    })
    .optional(),
  decimals: z.union([z.number(), z.string()]).optional(),
});

const chartIntentSchema = commonVisualSchema.extend({
  kind: z.literal("chart"),
  chartType: z.enum([
    "line",
    "bar",
    "column",
    "pie",
    "lollipop",
    "treemap",
    "drilldown",
  ]),
  dataUrl: z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]),
  xAxis: z.string(),
  yAxis: z.string().optional(),
  seriesBy: z.string().optional(),
  legendLocation: z
    .enum(["top", "bottom", "left", "right", "none"])
    .optional(),
  labels: z.boolean().optional(),
  sortByValue: z.enum(["asc", "desc"]).optional(),
  colorScheme: z.string().optional(),
  colorPalette: z
    .record(
      z.string(),
      z.record(z.string(), z.union([z.string(), z.number()])),
    )
    .optional(),
  unit: z
    .object({
      text: z.string(),
      location: z.enum(["prefix", "suffix", "under"]).optional(),
    })
    .optional(),
  decimals: z.union([z.number(), z.string()]).optional(),
  drilldown: z
    .object({
      xAxis: z.string(),
      seriesBy: z.string().optional(),
      legendLocation: z
        .enum(["top", "bottom", "left", "right", "none"])
        .optional(),
    })
    .optional(),
});

const mapIntentSchema = commonVisualSchema.extend({
  kind: z.literal("map"),
  dataUrl: z.string().min(1),
  geoDimension: z.string(),
  geoPreset: z.enum(["pacific-eez"]).optional(),
  geoJsonUrl: z.string().url().optional(),
  projection: z.string().optional(),
  joinProperty: z.string().optional(),
  colorScheme: z.string().optional(),
});

const nativeVisualWrapperSchema = z.object({
  mode: z.literal("native"),
  config: visualConfigSchema,
});

export const authoringVisualSchema = z.union([
  noteIntentSchema,
  kpiIntentSchema,
  chartIntentSchema,
  mapIntentSchema,
  nativeVisualWrapperSchema,
]);

const authoringHeaderFooterSchema = z
  .object({
    title: authoringTextSchema.optional(),
    subtitle: authoringTextSchema.optional(),
  })
  .optional();

export const dashboardAuthoringSchema = z.object({
  id: z.string().describe("Unique dashboard identifier"),
  languages: z.array(z.string()).optional(),
  colCount: z.number().optional(),
  header: authoringHeaderFooterSchema,
  footer: authoringHeaderFooterSchema,
  dataflows: z
    .record(z.string(), z.string())
    .optional()
    .describe("Map of dataflow ID → human-readable name, e.g. { DF_POP: 'Population' }"),
  rows: z.array(
    z.object({
      columns: z.array(authoringVisualSchema).min(1),
    }),
  ),
});

export const dashboardToolConfigSchema = z.union([
  dashboardAuthoringSchema,
  dashboardConfigSchema,
]);

type NativeVisualConfig = z.infer<typeof visualConfigSchema>;
type NativeDashboardConfig = z.infer<typeof dashboardConfigSchema>;
type NoteIntent = z.infer<typeof noteIntentSchema>;
type KpiIntent = z.infer<typeof kpiIntentSchema>;
type ChartIntent = z.infer<typeof chartIntentSchema>;
type MapIntent = z.infer<typeof mapIntentSchema>;
type NativeVisualWrapper = z.infer<typeof nativeVisualWrapperSchema>;
type AuthoringVisual = z.infer<typeof authoringVisualSchema>;
type NativeTextConfig = z.infer<typeof textConfigSchema>;

export type DashboardAuthoringConfig = z.infer<typeof dashboardAuthoringSchema>;
export type DashboardToolConfig = z.infer<typeof dashboardToolConfigSchema>;

function toTextConfig(
  value?: z.infer<typeof authoringTextSchema>,
): NativeTextConfig | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return { text: value };
  if ("text" in value) {
    return value as NativeTextConfig;
  }
  return { text: value };
}

function ensureAllDimensions(url: string): string {
  try {
    const parsed = new URL(url);
    if (!parsed.searchParams.has("dimensionAtObservation")) {
      parsed.searchParams.set("dimensionAtObservation", "AllDimensions");
    }
    return parsed.toString();
  } catch {
    if (url.includes("dimensionAtObservation=")) {
      return url;
    }
    return url + (url.includes("?") ? "&" : "?") + "dimensionAtObservation=AllDimensions";
  }
}

function compileNote(intent: NoteIntent): NativeVisualConfig {
  return {
    id: intent.id,
    type: "note",
    colSize: intent.colSize,
    title: toTextConfig(intent.title),
    subtitle: toTextConfig(intent.subtitle),
    note: toTextConfig(intent.body),
    frame: intent.frame,
    adaptiveTextSize: intent.adaptiveTextSize,
    download: intent.download,
    dataLink: intent.dataLink,
    metadataLink: intent.metadataLink,
    extraOptions: intent.extraOptions,
  };
}

function compileKpi(intent: KpiIntent): NativeVisualConfig {
  return {
    id: intent.id,
    type: "value",
    colSize: intent.colSize,
    title: toTextConfig(intent.title),
    subtitle: toTextConfig(intent.subtitle),
    note: toTextConfig(intent.note),
    frame: intent.frame,
    adaptiveTextSize: intent.adaptiveTextSize,
    download: intent.download,
    dataLink: intent.dataLink,
    metadataLink: intent.metadataLink,
    extraOptions: intent.extraOptions,
    xAxisConcept: intent.valueConcept ?? DEFAULT_VALUE_CONCEPT,
    data: ensureAllDimensions(intent.dataUrl),
    unit: intent.unit,
    decimals: intent.decimals,
  };
}

function compileChart(intent: ChartIntent): NativeVisualConfig {
  if (
    ["bar", "column", "lollipop", "treemap"].includes(intent.chartType) &&
    !intent.seriesBy
  ) {
    throw new Error(
      "chart `" +
        intent.id +
        "` requires `seriesBy` for " +
        intent.chartType +
        " visuals.",
    );
  }

  const data = Array.isArray(intent.dataUrl)
    ? intent.dataUrl.map(ensureAllDimensions)
    : ensureAllDimensions(intent.dataUrl);

  return {
    id: intent.id,
    type: intent.chartType,
    colSize: intent.colSize,
    title: toTextConfig(intent.title),
    subtitle: toTextConfig(intent.subtitle),
    note: toTextConfig(intent.note),
    frame: intent.frame,
    adaptiveTextSize: intent.adaptiveTextSize,
    download: intent.download,
    dataLink: intent.dataLink,
    metadataLink: intent.metadataLink,
    extraOptions: intent.extraOptions,
    xAxisConcept: intent.xAxis,
    yAxisConcept: intent.yAxis ?? DEFAULT_VALUE_CONCEPT,
    data,
    legend: intent.seriesBy
      ? {
          concept: intent.seriesBy,
          location: intent.legendLocation,
        }
      : intent.legendLocation
        ? { location: intent.legendLocation }
        : undefined,
    labels: intent.labels,
    sortByValue: intent.sortByValue,
    colorScheme: intent.colorScheme,
    colorPalette: intent.colorPalette,
    unit: intent.unit,
    decimals: intent.decimals,
    drilldown: intent.drilldown
      ? {
          xAxisConcept: intent.drilldown.xAxis,
          legend: intent.drilldown.seriesBy
            ? {
                concept: intent.drilldown.seriesBy,
                location: intent.drilldown.legendLocation,
              }
            : intent.drilldown.legendLocation
              ? { location: intent.drilldown.legendLocation }
              : undefined,
        }
      : undefined,
  };
}

function compileMap(intent: MapIntent): NativeVisualConfig {
  const geoJsonUrl = intent.geoJsonUrl ?? PACIFIC_EEZ_GEOJSON_URL;
  const projection = intent.projection ?? PACIFIC_EEZ_PROJECTION;
  const joinProperty = intent.joinProperty ?? PACIFIC_EEZ_JOIN_PROPERTY;
  const mapData =
    ensureAllDimensions(intent.dataUrl) +
    ", {" +
    intent.geoDimension +
    "} | " +
    geoJsonUrl +
    ", " +
    projection +
    ", {" +
    joinProperty +
    "}";

  return {
    id: intent.id,
    type: "map",
    colSize: intent.colSize,
    title: toTextConfig(intent.title),
    subtitle: toTextConfig(intent.subtitle),
    note: toTextConfig(intent.note),
    frame: intent.frame,
    adaptiveTextSize: intent.adaptiveTextSize,
    download: intent.download,
    dataLink: intent.dataLink,
    metadataLink: intent.metadataLink,
    extraOptions: intent.extraOptions,
    xAxisConcept: intent.geoDimension,
    colorScheme: intent.colorScheme ?? "Blues",
    data: mapData,
  };
}

function compileVisual(visual: AuthoringVisual): NativeVisualConfig {
  if ("mode" in visual && visual.mode === "native") {
    return visual.config as NativeVisualConfig;
  }

  const intentVisual = visual as Exclude<AuthoringVisual, NativeVisualWrapper>;

  switch (intentVisual.kind) {
    case "note":
      return compileNote(intentVisual);
    case "kpi":
      return compileKpi(intentVisual);
    case "chart":
      return compileChart(intentVisual);
    case "map":
      return compileMap(intentVisual);
  }

  throw new Error("Unsupported authoring visual.");
}

function isNativeDashboardConfig(
  config: DashboardToolConfig,
): config is NativeDashboardConfig {
  return config.rows.every((row) =>
    row.columns.every(
      (column) => typeof column === "object" && column !== null && "type" in column,
    ),
  );
}

export function compileDashboardToolConfig(
  config: DashboardToolConfig,
): DashboardConfigInput {
  if (isNativeDashboardConfig(config)) {
    return config as DashboardConfigInput;
  }

  const rows = config.rows.map((row) => ({
    columns: row.columns.map(compileVisual),
  }));

  return {
    id: config.id,
    languages: config.languages,
    colCount: config.colCount,
    dataflows: config.dataflows,
    header: config.header
      ? {
          title: toTextConfig(config.header.title),
          subtitle: toTextConfig(config.header.subtitle),
        }
      : undefined,
    footer: config.footer
      ? {
          title: toTextConfig(config.footer.title),
          subtitle: toTextConfig(config.footer.subtitle),
        }
      : undefined,
    rows,
  };
}
