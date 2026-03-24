import type { ModelMessage } from "ai";

export interface DataflowInfo {
  name: string;
  dimensions: string[];
}

export interface Tier2Knowledge {
  dataflows: Map<string, DataflowInfo>;
  dimensionCodes: Map<string, Map<string, number>>; // dataflow -> dim -> code count
  builtUrls: Array<{ dataflow: string; url: string }>;
}

/**
 * Scan conversation messages for MCP tool results and extract
 * a compact knowledge summary of what's already been discovered.
 */
export function extractKnowledgeFromMessages(
  messages: ModelMessage[],
): Tier2Knowledge {
  const knowledge: Tier2Knowledge = {
    dataflows: new Map(),
    dimensionCodes: new Map(),
    builtUrls: [],
  };

  for (const msg of messages) {
    if (msg.role !== "tool") continue;
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (part.type !== "tool-result") continue;
      const toolName = (part as { toolName?: string }).toolName || "";
      const result = (part as { result?: unknown }).result;
      if (!result || typeof result !== "object") continue;

      try {
        processToolResult(knowledge, toolName, result as Record<string, unknown>);
      } catch {
        // Defensive — never crash on unexpected result shapes
      }
    }
  }

  return knowledge;
}

function processToolResult(
  knowledge: Tier2Knowledge,
  toolName: string,
  result: Record<string, unknown>,
): void {
  if (toolName === "list_dataflows") {
    const dataflows = result.dataflows as Array<{ id: string; name: string }> | undefined;
    if (Array.isArray(dataflows)) {
      for (const df of dataflows) {
        if (df.id && !knowledge.dataflows.has(df.id)) {
          knowledge.dataflows.set(df.id, { name: df.name || df.id, dimensions: [] });
        }
      }
    }
  }

  if (toolName === "get_dataflow_structure") {
    const structure = result.structure as {
      id?: string;
      dimensions?: Array<{ id: string }>;
    } | undefined;
    const dfId = (result.dataflow as { id?: string })?.id;
    if (dfId && structure?.dimensions) {
      const dims = structure.dimensions.map((d) => d.id);
      const existing = knowledge.dataflows.get(dfId);
      if (existing) {
        existing.dimensions = dims;
      } else {
        knowledge.dataflows.set(dfId, { name: dfId, dimensions: dims });
      }
    }
  }

  if (toolName === "get_dimension_codes") {
    const dfId = result.dataflow_id as string | undefined;
    const dimId = result.dimension_id as string | undefined;
    const codes = result.codes as Array<unknown> | undefined;
    if (dfId && dimId && Array.isArray(codes)) {
      if (!knowledge.dimensionCodes.has(dfId)) {
        knowledge.dimensionCodes.set(dfId, new Map());
      }
      knowledge.dimensionCodes.get(dfId)!.set(dimId, codes.length);
    }
  }

  if (toolName === "build_data_url") {
    const url = result.url as string | undefined;
    const dfId = result.dataflow_id as string | undefined;
    if (url && dfId) {
      knowledge.builtUrls.push({ dataflow: dfId, url });
    }
  }
}

/**
 * Format knowledge into a compact text block for the system prompt.
 * Stays under ~1500 tokens even for complex sessions.
 */
export function formatKnowledgeSummary(knowledge: Tier2Knowledge): string {
  const { dataflows, dimensionCodes, builtUrls } = knowledge;

  if (dataflows.size === 0 && builtUrls.length === 0) {
    return "";
  }

  const lines: string[] = [
    "## Session Knowledge (already discovered — do NOT re-query these)",
    "",
  ];

  if (dataflows.size > 0) {
    lines.push("### Explored Dataflows:");
    for (const [id, info] of dataflows) {
      const dims = info.dimensions.length > 0
        ? " — dims: " + info.dimensions.join(", ")
        : "";
      lines.push("- " + id + ': "' + info.name + '"' + dims);

      // Add dimension code counts if available
      const codeCounts = dimensionCodes.get(id);
      if (codeCounts && codeCounts.size > 0) {
        const parts: string[] = [];
        for (const [dim, count] of codeCounts) {
          parts.push(dim + " (" + String(count) + " codes)");
        }
        lines.push("  Codes fetched: " + parts.join(", "));
      }
    }
    lines.push("");
  }

  if (builtUrls.length > 0) {
    lines.push("### Data URLs already built:");
    for (const { dataflow, url } of builtUrls) {
      // Truncate long URLs
      const shortUrl = url.length > 120 ? url.slice(0, 120) + "..." : url;
      lines.push("- " + dataflow + ": " + shortUrl);
    }
    lines.push("");
  }

  lines.push(
    "Use this knowledge to avoid redundant discovery calls. " +
    "If you need data from an already-explored dataflow, reuse the structure and codes above.",
  );

  return lines.join("\n");
}
