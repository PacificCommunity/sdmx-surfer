// What a dashboard config may make a viewer's browser do.
//
// Dashboards are written by the model, by users in the JSON editor, and
// copied from published dashboards, and every viewer's browser acts on them.
// Two rules keep a crafted config from turning that against the viewer:
//
//   1. Data references (`data`) may only fetch from the registered SDMX
//      providers (lib/endpoints-registry.ts) and the map layer hosts below.
//      Links (`dataLink`, `metadataLink`) must be plain http(s).
//   2. Text carries no HTML. The library writes map titles and tooltips with
//      innerHTML and ECharts renders tooltip formatter strings as HTML, so
//      markup in a config would run in the viewer's page.

import { z } from "zod";
import { detectEndpoint, MAP_LAYER_HOSTS } from "@/lib/endpoints-registry";

// Base for resolving relative references, so the parser tells a same-origin
// reference (host stays "relative.invalid") from one to another host.
const RELATIVE_BASE = "https://relative.invalid/";

// The URL parser drops tab, LF and CR anywhere in a URL and trims other
// control characters, so a host could hide across them. Refuse them outright
// instead of mirroring the parser.
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

// Separators of the library's data-expression grammar: ", " before a key,
// " | " before a map layer, " + - * / " between operands, hist(…)[n].
const DATA_TOKEN_SEPARATORS = /[\s,|()[\]]+/;

/** Hosts in a `data` expression that the viewer's browser must not fetch. */
export function disallowedDataHosts(expression: string): string[] {
  if (CONTROL_CHARS.test(expression)) return ["(control characters)"];
  const hosts: string[] = [];
  for (const token of expression.split(DATA_TOKEN_SEPARATORS)) {
    if (!token) continue;
    let url: URL;
    try {
      url = new URL(token, RELATIVE_BASE);
    } catch {
      continue;
    }
    // EPSG:3857, {iso_ter1}, dataflow ids: not network references.
    if (url.protocol !== "https:" && url.protocol !== "http:") continue;
    if (url.host === "relative.invalid") continue;
    if (detectEndpoint(url.href).key !== "UNKNOWN") continue;
    if (MAP_LAYER_HOSTS.includes(url.host)) continue;
    hosts.push(url.host);
  }
  return hosts;
}

const visualReferencesSchema = z.object({
  id: z.string().optional(),
  data: z.union([z.string(), z.array(z.string())]).optional(),
  dataLink: z.string().optional(),
  metadataLink: z.string().optional(),
});

type VisualReferences = z.infer<typeof visualReferencesSchema>;

// Only the fields that reach the network: stored configs from older versions
// may not satisfy the full dashboard schema and must still be checkable.
const dashboardReferencesSchema = z.object({
  rows: z.array(z.object({ columns: z.array(visualReferencesSchema) })),
});

/** Why a visual's data or links are not allowed; empty when they are. */
export function visualReferenceProblems(visual: VisualReferences): string[] {
  const label = visual.id ? "visual " + visual.id : "a visual";
  const problems: string[] = [];
  const expressions = typeof visual.data === "string" ? [visual.data] : (visual.data ?? []);
  for (const expression of expressions) {
    for (const host of disallowedDataHosts(expression)) {
      problems.push(label + " loads data from " + host + ", which is not a registered SDMX provider");
    }
  }
  for (const link of [visual.dataLink, visual.metadataLink]) {
    if (link === undefined || link === "") continue;
    let protocol = "";
    try {
      protocol = new URL(link).protocol;
    } catch {
      // not an absolute URL; reported below
    }
    if (protocol !== "https:" && protocol !== "http:") {
      problems.push(label + " has a link that is not an http(s) URL: " + link.slice(0, 80));
    }
  }
  return problems;
}

/** Why a dashboard's data or links are not allowed; empty when they are. */
export function dashboardReferenceProblems(config: unknown): string[] {
  const parsed = dashboardReferencesSchema.safeParse(config);
  if (!parsed.success) return ["the dashboard config is malformed"];
  return parsed.data.rows.flatMap((row) => row.columns.flatMap(visualReferenceProblems));
}

// "<" followed by a letter, "/", "!" or "?" opens markup in HTML; any other
// "<" (as in "aged < 15") is text there too, so it stays.
const MARKUP = /<[a-zA-Z/!?][^>]*>?/g;

/** Text with every HTML tag, comment and declaration removed. */
export function stripMarkup(text: string): string {
  let previous: string;
  let current = text;
  // Removing one tag can join two fragments into a new one ("<<b>img …>").
  do {
    previous = current;
    current = current.replace(MARKUP, "");
  } while (current !== previous);
  return current;
}

function stripMarkupDeep(value: unknown, key: string): unknown {
  // `data` holds fetch expressions, not display text.
  if (key === "data") return value;
  if (typeof value === "string") return stripMarkup(value);
  if (Array.isArray(value)) return value.map((item) => stripMarkupDeep(item, key));
  if (typeof value === "object" && value !== null) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, stripMarkupDeep(v, k)]),
    );
  }
  return value;
}

/** The config with markup removed from every text field (all but `data`). */
export function stripDashboardMarkup<T>(config: T): T {
  // Only strings are replaced, so the result has the input's shape.
  const stripped = stripMarkupDeep(config, "") as T;
  return stripped;
}
