import { tool } from "ai";
import { z } from "zod";
import { getSnapshotCatalogue, type Catalogue } from "./catalogue";

export type CatalogueAccessMode = "prompt" | "tool";

export function getMode(): CatalogueAccessMode {
  return process.env.SNAPSHOT_CATALOGUE_MODE === "tool" ? "tool" : "prompt";
}

/**
 * Compact text rendering of the catalogue for system-prompt injection. The
 * goal is to give the agent prior knowledge of every snapshot indicator so
 * it can answer questions without re-discovering dataflows via MCP.
 *
 * Format is dense but readable — themes as H2 headings, indicators as
 * "- id title [dataflow=X | no data source]" lines. Roughly ~5-8K tokens
 * for the full 102-indicator catalogue.
 */
export function renderCatalogueForPrompt(
  cat: Catalogue = getSnapshotCatalogue(),
): string {
  const lines: string[] = [];
  lines.push("# Country Snapshot Catalogue");
  lines.push(
    "Below is the COMPLETE curated catalogue of indicators MFAT cares " +
      "about across 22 PICTs. For each indicator you get the dataflow, " +
      "a URL template (with [TAG_GEO] standing in for the country code), " +
      "and a seriesConcept when the indicator combines multiple series " +
      "into one chart (e.g. M+F+_T for SEX).",
  );
  lines.push("");
  lines.push("# How to use this catalogue");
  lines.push(
    "1. For requests about MFAT-style snapshots, BUILD the dashboard " +
      "from this catalogue. Substitute [TAG_GEO] with the user's country " +
      "code(s) — for multiple countries join with '+' (e.g. TO+WS+VU). " +
      "Do NOT re-discover the SERIES codes or dimensions — they are " +
      "already encoded in the URL template.",
  );
  lines.push(
    "2. Only fall back to broader MCP discovery (list_dataflows, " +
      "get_dataflow_structure, ...) when the user's question genuinely " +
      "asks for data not in this catalogue.",
  );
  lines.push(
    "3. For consolidated indicators (those with seriesConcept), set " +
      "legend.concept=<that concept> on the chart visual so the library " +
      "groups the M/F/Total (or urban/rural, etc.) series properly.",
  );
  lines.push(
    "4. When emitting a dashboard, use kpi visuals for single-value " +
      "indicators with sparse data, line charts for time series, and " +
      "bar charts for cross-country comparisons. Avoid responding with " +
      "handmade markdown tables of figures — emit a dashboard or link " +
      "to the canonical snapshot page.",
  );
  lines.push("");
  for (const t of cat.themes) {
    lines.push(`## ${t.title} (themeId=${t.id}, themeSlug=${t.slug})`);
    const inds = cat.indicators
      .filter((i) => i.themeId === t.id)
      .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    if (inds.length === 0) {
      lines.push("_No indicators in this theme._");
      lines.push("");
      continue;
    }
    for (const i of inds) {
      lines.push(`- **${i.id}** ${i.title}`);
      if (i.apiUrlTemplate) {
        lines.push(`    url: ${i.apiUrlTemplate}`);
      } else {
        lines.push(`    url: (no data source)`);
      }
      if (i.dataflow) lines.push(`    dataflow: ${i.dataflow}`);
      if (i.seriesConcept) {
        lines.push(`    seriesConcept: ${i.seriesConcept}`);
      }
    }
    lines.push("");
  }
  lines.push("# Countries");
  lines.push("(code: name, region, mfat-priority)");
  for (const c of cat.countries) {
    lines.push(
      `- ${c.code}: ${c.name}, ${c.region}, mfat=${c.mfatRelevant ? 1 : 0}`,
    );
  }
  return lines.join("\n");
}

/**
 * Tool form of catalogue access. Registered on the snapshot chat route when
 * SNAPSHOT_CATALOGUE_MODE=tool. Lets the agent look up indicators by theme
 * slug, search term, or country code rather than carrying the whole
 * catalogue in the system prompt.
 *
 * Returns up to 50 matches per call plus a `truncated` flag so the agent
 * can narrow its query if needed.
 */
export const catalogueTool = tool({
  description:
    "Look up Country Snapshot indicators by theme, search term, or country. " +
    "Returns up to 50 matches. Use this instead of trying to recall the " +
    "catalogue from memory.",
  inputSchema: z.object({
    themeSlug: z
      .string()
      .optional()
      .describe(
        "Theme slug (kebab-case), e.g. 'health', 'education', 'climate-and-environment'. " +
          "Restricts results to indicators in that theme.",
      ),
    countryCode: z
      .string()
      .optional()
      .describe(
        "ISO-2 country code, e.g. 'TO' for Tonga. Carried back in the response " +
          "for the agent's context; does not currently filter the indicator list.",
      ),
    search: z
      .string()
      .optional()
      .describe(
        "Case-insensitive substring match against indicator id or title, " +
          "e.g. 'population', 'II.4', 'literacy'.",
      ),
  }),
  execute: async ({
    themeSlug,
    countryCode,
    search,
  }: {
    themeSlug?: string;
    countryCode?: string;
    search?: string;
  }) => {
    const cat = getSnapshotCatalogue();
    let inds = cat.indicators;
    if (themeSlug) {
      const t = cat.themes.find((th) => th.slug === themeSlug);
      if (!t) {
        return {
          error: `unknown theme slug "${themeSlug}"`,
          known_slugs: cat.themes.map((th) => th.slug),
        };
      }
      inds = inds.filter((i) => i.themeId === t.id);
    }
    if (search) {
      const q = search.toLowerCase();
      inds = inds.filter(
        (i) =>
          i.title.toLowerCase().includes(q) ||
          i.id.toLowerCase().includes(q),
      );
    }
    const total = inds.length;
    const trimmed = inds.slice(0, 50).map((i) => ({
      id: i.id,
      themeId: i.themeId,
      title: i.title,
      dataflow: i.dataflow,
      hasDataSource: Boolean(i.apiUrlTemplate),
    }));
    return {
      countryContext: countryCode ?? null,
      indicators: trimmed,
      total,
      truncated: total > trimmed.length,
    };
  },
});
