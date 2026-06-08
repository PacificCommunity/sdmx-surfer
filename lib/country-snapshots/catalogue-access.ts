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
    "You have prior knowledge of the following curated indicators, themes, " +
      "and dataflows. Use these directly to answer questions about Country " +
      "Snapshots without re-discovering dataflows.",
  );
  lines.push("");
  for (const t of cat.themes) {
    lines.push(`## ${t.title} (id=${t.id}, slug=${t.slug})`);
    const inds = cat.indicators
      .filter((i) => i.themeId === t.id)
      .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
    if (inds.length === 0) {
      lines.push("_No indicators in this theme yet._");
      lines.push("");
      continue;
    }
    for (const i of inds) {
      const src = i.dataflow
        ? ` [dataflow=${i.dataflow}]`
        : " [no data source]";
      lines.push(`- ${i.id} ${i.title}${src}`);
    }
    lines.push("");
  }
  lines.push("Countries (code: name, region, mfat=1|0):");
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
