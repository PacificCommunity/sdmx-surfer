#!/usr/bin/env npx tsx
/**
 * Build the semantic search index for dataflows.
 *
 * Usage:
 *   npm run build-index
 *
 * Requires:
 *   - MCP gateway running (locally or on Railway)
 *   - GOOGLE_AI_API_KEY set (for embedding via Gemini)
 *
 * This script:
 * 1. Fetches all dataflows from the MCP gateway via AI SDK's MCP client
 * 2. For each, fetches the structure (dimensions, codelists)
 * 3. Builds a rich text description for embedding
 * 4. Embeds each description with Google gemini-embedding-001
 * 5. Saves the index to models/dataflow-index.json
 */

import { config } from "dotenv";
config({ path: ".env.local" });

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";

const MCP_URL = process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp";
const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");
const STAT_BASE = "https://stats-nsi-stable.pacificdata.org/rest";

// ── Category fetching from .Stat SDMX REST API ──

interface CategoryTag {
  scheme: string;
  id: string;
  name: string;
}

/**
 * Fetch category-to-dataflow mappings from SPC .Stat category schemes.
 * Returns a map: dataflow ID → array of category tags.
 */
async function fetchCategories(): Promise<Map<string, CategoryTag[]>> {
  const map = new Map<string, CategoryTag[]>();
  const schemes = ["CAS_COM_TOPIC", "CAS_COM_DEV"];

  for (const scheme of schemes) {
    const url = STAT_BASE + "/categoryscheme/SPC/" + scheme + "/latest?references=all";
    try {
      const resp = await fetch(url, { headers: { Accept: "application/json", "Accept-Language": "en" } });
      if (!resp.ok) {
        console.warn("  Warning: could not fetch " + scheme + " (" + String(resp.status) + ")");
        continue;
      }
      const data = (await resp.json()) as {
        references?: Record<string, {
          items?: Array<{
            id: string;
            name: string;
            links?: Array<{ href: string; rel: string }>;
          }>;
        }>;
      };

      const refs = data.references || {};
      for (const ref of Object.values(refs)) {
        for (const item of ref.items || []) {
          const dfLinks = (item.links || [])
            .filter((l) => l.rel === "dataflow")
            .map((l) => {
              const m = l.href.match(/Dataflow=SPC:([^(]+)/);
              return m ? m[1] : null;
            })
            .filter((id): id is string => id !== null);

          for (const dfId of dfLinks) {
            const existing = map.get(dfId) || [];
            // Deduplicate within the same scheme+id
            if (!existing.some((t) => t.scheme === scheme && t.id === item.id)) {
              existing.push({ scheme, id: item.id, name: item.name });
            }
            map.set(dfId, existing);
          }
        }
      }
      console.log("  Fetched " + scheme + ": " + String(map.size) + " dataflows categorised so far");
    } catch (err) {
      console.warn("  Warning: failed to fetch " + scheme + ":", err instanceof Error ? err.message : err);
    }
  }

  return map;
}

// ── Main ──

interface Dataflow {
  id: string;
  name: string;
  description?: string;
}

interface Dimension {
  id: string;
  position: number;
  type: string;
  codelist: string | null;
}

interface Attribute {
  id: string;
  assignment_status: string;
}

interface StructureDetail {
  id: string;
  key_template: string;
  key_example?: string;
  dimensions: Dimension[];
  attributes: Attribute[];
  measure: string;
}

interface StructureResponse {
  dataflow?: { id: string; name: string; description?: string; version?: string };
  structure?: StructureDetail;
}

async function main() {
  console.log("Building dataflow semantic search index...\n");

  // Connect to MCP gateway
  console.log("Connecting to MCP gateway at " + MCP_URL + "...");
  const client = await createMCPClient({
    transport: {
      type: "http",
      url: MCP_URL,
    },
  });

  const tools = await client.tools();
  console.log("Connected. " + String(Object.keys(tools).length) + " tools available.\n");

  // Helper to call MCP tools — unwraps the MCP content envelope
  async function call(toolName: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = tools[toolName];
    if (!tool?.execute) throw new Error("Tool not found: " + toolName);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const raw = await (tool.execute as any)(args, { toolCallId: "idx-" + Date.now(), messages: [] });

    // MCP tools return { content: [{ type: "text", text: "..." }] }
    if (raw && typeof raw === "object" && "content" in raw) {
      const content = (raw as { content: Array<{ type: string; text: string }> }).content;
      if (content?.[0]?.type === "text" && content[0].text) {
        return JSON.parse(content[0].text);
      }
    }
    return raw;
  }

  // 1. Fetch all dataflows
  console.log("1. Fetching dataflows...");
  const allDataflows: Dataflow[] = [];
  let offset = 0;
  let hasMore = true;

  while (hasMore) {
    const result = (await call("list_dataflows", {
      limit: 50,
      offset,
    })) as { dataflows: Dataflow[]; pagination: { has_more: boolean } };

    allDataflows.push(...result.dataflows);
    hasMore = result.pagination.has_more;
    offset += 50;
    process.stdout.write("\r  Fetched " + String(allDataflows.length) + " dataflows...");
  }
  console.log("\n  Found " + String(allDataflows.length) + " dataflows\n");

  // 2. Fetch structures
  console.log("2. Fetching structures...");
  const structures = new Map<string, StructureResponse | null>();
  for (let i = 0; i < allDataflows.length; i++) {
    const df = allDataflows[i];
    process.stdout.write(
      "\r  [" +
        String(i + 1) +
        "/" +
        String(allDataflows.length) +
        "] " +
        df.id +
        "                    ",
    );
    try {
      const s = (await call("get_dataflow_structure", {
        dataflow_id: df.id,
      })) as StructureResponse;
      structures.set(df.id, s);
    } catch {
      structures.set(df.id, null);
    }
  }
  console.log("\n");

  // 3. Fetch categories from .Stat REST API
  console.log("3. Fetching categories from .Stat...");
  const categoryMap = await fetchCategories();
  const uncategorised = allDataflows.filter((df) => !categoryMap.has(df.id));
  if (uncategorised.length > 0) {
    console.log("  Uncategorised: " + uncategorised.map((d) => d.id).join(", "));
  }
  console.log("");

  // 4. Build rich texts + persist structure metadata
  console.log("4. Building rich text descriptions...");
  const entries = allDataflows.map((df) => {
    const resp = structures.get(df.id) || null;
    const struct = resp?.structure || null;
    const parts: string[] = [df.name];

    if (df.description) {
      parts.push(df.description);
    }

    if (struct?.dimensions) {
      const dimNames = struct.dimensions.map((d) => d.id);
      parts.push("Dimensions: " + dimNames.join(", "));

      const codelists = struct.dimensions
        .filter((d) => d.codelist)
        .map((d) => {
          const clName =
            (d.codelist || "").split(":").pop()?.split("(")[0] || "";
          return d.id + " (" + clName + ")";
        });
      if (codelists.length > 0) {
        parts.push("Codelists: " + codelists.join(", "));
      }
    }

    return {
      id: df.id,
      name: df.name,
      description: df.description || "",
      richText: parts.join(". "),
      categories: categoryMap.get(df.id) || [],
      structure: struct ? {
        id: struct.id,
        key_template: struct.key_template,
        dimensions: struct.dimensions,
        attributes: struct.attributes,
        measure: struct.measure,
      } : null,
    };
  });
  console.log("  Built " + String(entries.length) + " descriptions\n");

  // 5. Embed
  console.log("5. Embedding descriptions...");
  console.log("   (Loading model — first run may take a moment)\n");

  const { embedBatch } = await import("../lib/embeddings.js");
  const texts = entries.map((e) => e.richText);
  const embeddings = await embedBatch(texts);
  console.log("  Embedded " + String(embeddings.length) + " texts\n");

  // 6. Save index
  console.log("6. Saving index...");
  const index = {
    modelId: "gemini-embedding-001",
    createdAt: new Date().toISOString(),
    entries: entries.map((e, i) => ({
      ...e,
      embedding: embeddings[i],
    })),
  };

  writeFileSync(INDEX_PATH, JSON.stringify(index), "utf-8");

  const sizeMB = (JSON.stringify(index).length / 1024 / 1024).toFixed(1);
  console.log(
    "  Saved to " +
      INDEX_PATH +
      " (" +
      sizeMB +
      " MB, " +
      String(index.entries.length) +
      " entries)\n",
  );

  // Cleanup
  await client.close();
  console.log("Done! Semantic search is ready.");
  process.exit(0);
}

main().catch((err) => {
  console.error("\nFailed:", err.message || err);
  process.exit(1);
});
