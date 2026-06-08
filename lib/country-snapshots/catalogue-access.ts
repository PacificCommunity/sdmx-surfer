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
