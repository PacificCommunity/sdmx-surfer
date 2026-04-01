/**
 * TypeScript types matching sdmx-dashboard-components v0.4.5.
 * NOTE: The library's type definitions use "colums" but the runtime uses "columns".
 */

export type SDMXLocalizedText = string | Record<string, string>;

export interface SDMXTextConfig {
  text: SDMXLocalizedText;
  size?: string;
  weight?: string;
  align?: "center" | "left" | "right";
  color?: string;
  font?: string;
  style?: string;
}

export interface SDMXDashboardConfig {
  id: string;
  rows: SDMXDashboardRow[];
  languages?: string[];
  colCount?: number;
  /** Map of dataflow ID → human-readable name, e.g. { DF_POP: "Population" } */
  dataflows?: Record<string, string>;
  header?: {
    title?: SDMXTextConfig;
    subtitle?: SDMXTextConfig;
  };
  footer?: {
    title?: SDMXTextConfig;
    subtitle?: SDMXTextConfig;
  };
}

export interface SDMXDashboardRow {
  columns: SDMXVisualConfig[];
}

export type SDMXComponentType =
  | "line"
  | "bar"
  | "column"
  | "pie"
  | "lollipop"
  | "treemap"
  | "value"
  | "drilldown"
  | "note"
  | "map";

export interface SDMXVisualConfig {
  id: string;
  type: SDMXComponentType;
  colSize?: number;
  title?: SDMXTextConfig;
  subtitle?: SDMXTextConfig;
  note?: SDMXTextConfig;
  frame?: boolean;
  unit?: {
    text: string;
    location?: "prefix" | "suffix" | "under";
  };
  adaptiveTextSize?: boolean;
  decimals?: number | string;
  labels?: boolean;
  download?: boolean;
  dataLink?: string;
  metadataLink?: string;
  xAxisConcept?: string;
  yAxisConcept?: string;
  data?: string | string[];
  sortByValue?: "asc" | "desc";
  legend?: {
    concept?: string;
    location?: "top" | "bottom" | "left" | "right" | "none";
  };
  colorPalette?: Record<string, Record<string, string | number>>;
  colorScheme?: string;
  extraOptions?: Record<string, unknown>;
  drilldown?: {
    xAxisConcept: string;
    legend?: {
      concept?: string;
      location?: "top" | "bottom" | "left" | "right" | "none";
    };
  };
}
