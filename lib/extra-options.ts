/**
 * Translation of saved `extraOptions` from Highcharts option names to ECharts.
 *
 * Dashboards saved under sdmx-dashboard-components 0.4.x carry Highcharts
 * options. 1.0 draws with ECharts and deep-merges `extraOptions` into the
 * option it builds: Highcharts keys are silently ignored (axis titles,
 * stacking are lost), arrays are concatenated (a `yAxis: [...]` adds a second,
 * broken axis), and an object `series` is merged into every series.
 *
 * Every key is either translated, kept because it is already ECharts with the
 * same meaning, or dropped and reported. No array reaches the output except
 * the colour list. Translating already-translated options is a no-op.
 *
 * In 1.0 a `bar` is horizontal with the value axis on `xAxis`, while
 * Highcharts put the value axis on `yAxis` for every chart type, so Highcharts
 * axis keys move to the other axis for `bar`.
 *
 * Used by the load-time guard (stored sessions, published dashboards, configs
 * pasted into the JSON editor) and by scripts/migrate-extra-options.mts.
 */

import type { SDMXDashboardConfig } from "./types";

type Options = Record<string, unknown>;

export interface ExtraOptionsTranslation {
  extraOptions: Options | undefined;
  /** Key paths of the input that are not in the output, e.g. "yAxis.plotLines". */
  dropped: string[];
}

/** Visual types the library draws with ECharts; the rest ignore extraOptions. */
export const ECHARTS_VISUAL_TYPES: Record<string, true> = {
  line: true,
  bar: true,
  column: true,
  lollipop: true,
  drilldown: true,
  pie: true,
  treemap: true,
};
const AXIS_TYPES: Record<string, true> = {
  line: true,
  bar: true,
  column: true,
  lollipop: true,
  drilldown: true,
};

/** Keys that only Highcharts puts on an axis; ECharts names them differently. */
const HIGHCHARTS_AXIS_KEYS: Record<string, true> = {
  title: true,
  labels: true,
  reversed: true,
  categories: true,
  plotLines: true,
  plotBands: true,
  tickInterval: true,
  tickAmount: true,
  gridLineWidth: true,
  lineWidth: true,
  opposite: true,
  allowDecimals: true,
  startOnTick: true,
  endOnTick: true,
};
const HIGHCHARTS_AXIS_TYPES: Record<string, true> = { logarithmic: true, linear: true, datetime: true };
const ECHARTS_AXIS_TYPES: Record<string, true> = { value: true, category: true, time: true, log: true };

const ECHARTS_AXIS_KEYS: Record<string, true> = {
  name: true,
  nameLocation: true,
  nameGap: true,
  nameRotate: true,
  nameTextStyle: true,
  axisLabel: true,
  axisLine: true,
  axisTick: true,
  splitLine: true,
  splitArea: true,
  splitNumber: true,
  interval: true,
  minInterval: true,
  maxInterval: true,
  inverse: true,
  scale: true,
  logBase: true,
  position: true,
  offset: true,
  show: true,
};

const ECHARTS_LEGEND_KEYS: Record<string, true> = {
  show: true,
  type: true,
  top: true,
  bottom: true,
  left: true,
  right: true,
  orient: true,
  width: true,
  height: true,
  padding: true,
  itemGap: true,
  itemWidth: true,
  itemHeight: true,
  icon: true,
  textStyle: true,
  selectedMode: true,
};

const ECHARTS_TOOLTIP_KEYS: Record<string, true> = {
  show: true,
  trigger: true,
  confine: true,
  axisPointer: true,
  backgroundColor: true,
  borderColor: true,
  borderWidth: true,
  padding: true,
  textStyle: true,
  order: true,
};

/** Top-level ECharts components with no Highcharts namesake, kept as objects. */
const ECHARTS_OBJECT_KEYS: Record<string, true> = { grid: true, toolbox: true, textStyle: true, aria: true };

/** Highcharts `step` values and their ECharts names. */
const STEP_VALUES: Record<string, string> = {
  left: "start",
  center: "middle",
  right: "end",
  start: "start",
  middle: "middle",
  end: "end",
};

/** `{value}` placeholders only: a Highcharts number format (`{value:,.0f}`) has no ECharts string form. */
const PLAIN_VALUE_FORMAT = /^[^{}]*(\{value\}[^{}]*)*$/;

function isPlainObject(value: unknown): value is Options {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Leaf key paths of a value; an array or an empty object is a leaf. */
export function leafPaths(value: unknown, path: string): string[] {
  if (isPlainObject(value)) {
    const keys = Object.keys(value);
    if (keys.length === 0) return [path];
    return keys.flatMap((key) => leafPaths(value[key], path + "." + key));
  }
  return [path];
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return "[" + value.map(stableStringify).join(",") + "]";
  }
  if (isPlainObject(value)) {
    return (
      "{" +
      Object.keys(value)
        .filter((key) => value[key] !== undefined)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + stableStringify(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === "string");
}

class OptionsBuilder {
  readonly out: Options = {};
  readonly dropped: string[] = [];

  drop(path: string, value: unknown): void {
    this.dropped.push(...leafPaths(value, path));
  }

  /** Set one leaf; a second value for the same leaf is dropped. */
  put(target: string[], value: unknown, source: string): void {
    let node = this.out;
    for (const key of target.slice(0, -1)) {
      const next = node[key];
      if (next === undefined) {
        const created: Options = {};
        node[key] = created;
        node = created;
      } else if (isPlainObject(next)) {
        node = next;
      } else {
        this.dropped.push(source);
        return;
      }
    }
    const leaf = target[target.length - 1];
    if (leaf in node) {
      this.drop(source, value);
      return;
    }
    node[leaf] = value;
  }

  /** Copy an ECharts value leaf by leaf, dropping arrays. */
  keep(target: string[], value: unknown, source: string): void {
    if (Array.isArray(value)) {
      this.dropped.push(source);
    } else if (isPlainObject(value) && Object.keys(value).length > 0) {
      for (const [key, child] of Object.entries(value)) {
        this.keep([...target, key], child, source + "." + key);
      }
    } else if (value !== undefined) {
      this.put(target, value, source);
    }
  }
}

function translateAxis(
  b: OptionsBuilder,
  source: "xAxis" | "yAxis",
  axis: Options,
  isBar: boolean,
): void {
  // Where a Highcharts key for this axis lands in ECharts.
  const target = isBar ? (source === "xAxis" ? "yAxis" : "xAxis") : source;
  const legacyAxis =
    Object.keys(axis).some((axisKey) => HIGHCHARTS_AXIS_KEYS[axisKey] === true) ||
    (typeof axis.type === "string" && HIGHCHARTS_AXIS_TYPES[axis.type] === true);

  for (const [key, value] of Object.entries(axis)) {
    const path = source + "." + key;
    switch (key) {
      case "title":
        if (isPlainObject(value)) {
          for (const [titleKey, titleValue] of Object.entries(value)) {
            if (titleKey === "text" && typeof titleValue === "string") {
              b.put([target, "name"], titleValue, path + ".text");
            } else {
              b.drop(path + "." + titleKey, titleValue);
            }
          }
        } else {
          b.drop(path, value);
        }
        break;
      case "labels":
        if (isPlainObject(value)) {
          for (const [labelKey, labelValue] of Object.entries(value)) {
            const labelPath = path + "." + labelKey;
            if (
              labelKey === "format" &&
              typeof labelValue === "string" &&
              PLAIN_VALUE_FORMAT.test(labelValue)
            ) {
              b.put([target, "axisLabel", "formatter"], labelValue, labelPath);
            } else if (labelKey === "rotation" && typeof labelValue === "number") {
              b.put([target, "axisLabel", "rotate"], labelValue, labelPath);
            } else {
              b.drop(labelPath, labelValue);
            }
          }
        } else {
          b.drop(path, value);
        }
        break;
      case "reversed":
        if (typeof value === "boolean") {
          b.put([target, "inverse"], value, path);
        } else {
          b.drop(path, value);
        }
        break;
      case "type":
        if (value === "logarithmic") {
          b.put([target, "type"], "log", path);
        } else if (typeof value === "string" && ECHARTS_AXIS_TYPES[value] === true) {
          b.put([source, "type"], value, path);
        } else {
          b.drop(path, value);
        }
        break;
      case "min":
      case "max":
        if (typeof value !== "number" && typeof value !== "string") {
          b.drop(path, value);
        } else if (!isBar) {
          b.put([source, key], value, path);
        } else if (source === "yAxis") {
          // The category axis of an ECharts bar has no use for a bound, so
          // this is the Highcharts value axis.
          b.put(["xAxis", key], value, path);
        } else if (legacyAxis) {
          // A Highcharts bar's xAxis is its category axis: a category index
          // window, not a value bound.
          b.drop(path, value);
        } else {
          b.put(["xAxis", key], value, path);
        }
        break;
      default:
        if (ECHARTS_AXIS_KEYS[key] === true) {
          b.keep([source, key], value, path);
        } else {
          b.drop(path, value);
        }
    }
  }
}

function translateSeriesPlotOptions(b: OptionsBuilder, options: Options, path: string): void {
  for (const [key, value] of Object.entries(options)) {
    const keyPath = path + "." + key;
    if (key === "stacking" && value === "normal") {
      b.put(["series", "stack"], "total", keyPath);
    } else if (
      key === "dataLabels" &&
      isPlainObject(value) &&
      typeof value.enabled === "boolean"
    ) {
      b.put(["series", "label", "show"], value.enabled, keyPath + ".enabled");
      for (const [labelKey, labelValue] of Object.entries(value)) {
        if (labelKey !== "enabled") b.drop(keyPath + "." + labelKey, labelValue);
      }
    } else if (
      key === "step" &&
      (value === true || (typeof value === "string" && Object.hasOwn(STEP_VALUES, value)))
    ) {
      b.put(["series", "step"], value === true ? "start" : STEP_VALUES[value as string], keyPath);
    } else if (
      key === "marker" &&
      isPlainObject(value) &&
      typeof value.enabled === "boolean"
    ) {
      b.put(["series", "showSymbol"], value.enabled, keyPath + ".enabled");
      for (const [markerKey, markerValue] of Object.entries(value)) {
        if (markerKey !== "enabled") b.drop(keyPath + "." + markerKey, markerValue);
      }
    } else {
      // Includes `stacking: "percent"`: ECharts has no percentage stack, so
      // the query has to return shares instead.
      b.drop(keyPath, value);
    }
  }
}

/**
 * Translate one visual's extraOptions for its chart type. Visual types the
 * library does not draw with ECharts (value, note, map, table) ignore
 * extraOptions and are returned unchanged.
 */
export function translateExtraOptions(
  extraOptions: unknown,
  type: string,
): ExtraOptionsTranslation {
  if (extraOptions === undefined || ECHARTS_VISUAL_TYPES[type] !== true) {
    return { extraOptions: extraOptions as Options | undefined, dropped: [] };
  }
  if (!isPlainObject(extraOptions)) {
    return { extraOptions: undefined, dropped: ["extraOptions"] };
  }

  const b = new OptionsBuilder();
  const hasAxes = AXIS_TYPES[type] === true;

  for (const [key, value] of Object.entries(extraOptions)) {
    switch (key) {
      case "xAxis":
      case "yAxis":
        if (hasAxes && isPlainObject(value)) {
          translateAxis(b, key, value, type === "bar");
        } else {
          b.drop(key, value);
        }
        break;
      case "legend":
        if (isPlainObject(value)) {
          for (const [legendKey, legendValue] of Object.entries(value)) {
            const path = "legend." + legendKey;
            if (legendKey === "enabled" && typeof legendValue === "boolean") {
              b.put(["legend", "show"], legendValue, path);
            } else if (ECHARTS_LEGEND_KEYS[legendKey] === true) {
              b.keep(["legend", legendKey], legendValue, path);
            } else {
              b.drop(path, legendValue);
            }
          }
        } else {
          b.drop(key, value);
        }
        break;
      case "plotOptions":
        if (isPlainObject(value)) {
          for (const [group, groupOptions] of Object.entries(value)) {
            if (group === "series" && isPlainObject(groupOptions)) {
              translateSeriesPlotOptions(b, groupOptions, "plotOptions.series");
            } else {
              b.drop("plotOptions." + group, groupOptions);
            }
          }
        } else {
          b.drop(key, value);
        }
        break;
      case "series":
        // The object form is ECharts (merged into every series); Highcharts
        // `series` is an array of data.
        if (isPlainObject(value)) {
          b.keep(["series"], value, key);
        } else {
          b.drop(key, value);
        }
        break;
      case "colors":
      case "color":
        if (isStringArray(value)) {
          b.put(["color"], [...value], key);
        } else {
          b.drop(key, value);
        }
        break;
      case "tooltip":
        if (isPlainObject(value)) {
          for (const [tooltipKey, tooltipValue] of Object.entries(value)) {
            const path = "tooltip." + tooltipKey;
            if (ECHARTS_TOOLTIP_KEYS[tooltipKey] === true) {
              b.keep(["tooltip", tooltipKey], tooltipValue, path);
            } else {
              b.drop(path, tooltipValue);
            }
          }
        } else {
          b.drop(key, value);
        }
        break;
      case "backgroundColor":
        if (typeof value === "string") {
          b.put([key], value, key);
        } else {
          b.drop(key, value);
        }
        break;
      case "animation":
        if (typeof value === "boolean") {
          b.put([key], value, key);
        } else {
          b.drop(key, value);
        }
        break;
      default:
        if (ECHARTS_OBJECT_KEYS[key] === true && isPlainObject(value)) {
          b.keep([key], value, key);
        } else {
          // Includes chart, credits, exporting, accessibility, title and
          // subtitle, which the library builds itself.
          b.drop(key, value);
        }
    }
  }

  const translated = Object.keys(b.out).length > 0 ? b.out : undefined;
  if (b.dropped.length === 0 && stableStringify(translated) === stableStringify(extraOptions)) {
    return { extraOptions, dropped: [] };
  }
  return { extraOptions: translated, dropped: b.dropped };
}

export interface DashboardTranslation<T> {
  config: T;
  /** "<visual id>: <key path>" for every dropped key. */
  dropped: string[];
}

/**
 * Translate the extraOptions of every visual in a dashboard config. Returns
 * the same object when nothing changes. Tolerates malformed stored configs.
 */
export function translateDashboardExtraOptions<T extends SDMXDashboardConfig>(
  config: T,
): DashboardTranslation<T> {
  if (!isPlainObject(config) || !Array.isArray(config.rows)) {
    return { config, dropped: [] };
  }

  const dropped: string[] = [];
  let changed = false;
  const rows = config.rows.map((row) => {
    if (!isPlainObject(row) || !Array.isArray(row.columns)) return row;
    let rowChanged = false;
    const columns = row.columns.map((visual) => {
      if (!isPlainObject(visual) || visual.extraOptions === undefined) return visual;
      const result = translateExtraOptions(visual.extraOptions, String(visual.type));
      if (result.extraOptions === visual.extraOptions) return visual;
      rowChanged = true;
      dropped.push(...result.dropped.map((path) => String(visual.id) + ": " + path));
      const next = { ...visual };
      if (result.extraOptions === undefined) {
        delete next.extraOptions;
      } else {
        next.extraOptions = result.extraOptions;
      }
      return next;
    });
    if (!rowChanged) return row;
    changed = true;
    return { ...row, columns };
  });

  return changed ? { config: { ...config, rows }, dropped } : { config, dropped: [] };
}

export interface StoredSessionTranslation<M> {
  configHistory: unknown[];
  messages: M[];
  /** Unique "<visual id>: <key path>" entries across history and messages. */
  dropped: string[];
  historyEntriesChanged: number;
  messageOutputsChanged: number;
}

/**
 * Translate a stored session: every `config_history` entry (so undo and redo
 * keep working) and the config in every `update_dashboard` tool output, which
 * the builder re-extracts from the messages on load and would otherwise push
 * back onto the history untranslated.
 */
export function translateStoredSession<M>(
  configHistory: unknown[],
  messages: M[],
): StoredSessionTranslation<M> {
  const dropped = new Set<string>();
  let historyEntriesChanged = 0;
  let messageOutputsChanged = 0;

  const translate = (config: unknown): unknown => {
    const result = translateDashboardExtraOptions(config as SDMXDashboardConfig);
    result.dropped.forEach((entry) => dropped.add(entry));
    return result.config;
  };

  const history = configHistory.map((entry) => {
    const next = translate(entry);
    if (next !== entry) historyEntriesChanged += 1;
    return next;
  });

  const nextMessages = messages.map((message) => {
    if (!isPlainObject(message) || !Array.isArray(message.parts)) return message;
    let messageChanged = false;
    const parts = message.parts.map((part: unknown) => {
      if (
        !isPlainObject(part) ||
        !(
          part.type === "tool-update_dashboard" ||
          (part.type === "dynamic-tool" && part.toolName === "update_dashboard")
        ) ||
        !isPlainObject(part.output)
      ) {
        return part;
      }
      const output = part.output;
      if (isPlainObject(output.dashboard)) {
        const dashboard = translate(output.dashboard);
        if (dashboard === output.dashboard) return part;
        messageChanged = true;
        messageOutputsChanged += 1;
        return { ...part, output: { ...output, dashboard } };
      }
      if (Array.isArray(output.rows)) {
        const translatedOutput = translate(output);
        if (translatedOutput === output) return part;
        messageChanged = true;
        messageOutputsChanged += 1;
        return { ...part, output: translatedOutput };
      }
      return part;
    });
    return messageChanged ? ({ ...message, parts } as M) : message;
  });

  return {
    configHistory: history,
    messages: nextMessages,
    dropped: [...dropped],
    historyEntriesChanged,
    messageOutputsChanged,
  };
}
