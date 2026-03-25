#!/usr/bin/env npx tsx
/**
 * Build the semantic search index for dataflows.
 *
 * Usage:
 *   npm run build-index
 *
 * Requires the MCP gateway running on localhost:8000.
 *
 * This script:
 * 1. Fetches all dataflows from the MCP gateway via AI SDK's MCP client
 * 2. For each, fetches the structure (dimensions, codelists)
 * 3. Builds a rich text description for embedding
 * 4. Embeds each description with granite-embedding-small-r2
 * 5. Saves the index to models/dataflow-index.json
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { createMCPClient } from "@ai-sdk/mcp";

const MCP_URL = process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp";
const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");

// ── Main ──

interface Dataflow {
  id: string;
  name: string;
  description?: string;
}

interface Structure {
  structure?: {
    dimensions?: Array<{ id: string; codelist?: string | null }>;
    attributes?: Array<{ id: string }>;
  };
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
  const structures = new Map<string, Structure | null>();
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
      })) as Structure;
      structures.set(df.id, s);
    } catch {
      structures.set(df.id, null);
    }
  }
  console.log("\n");

  // 3. Build rich texts
  console.log("3. Building rich text descriptions...");
  const entries = allDataflows.map((df) => {
    const structure = structures.get(df.id) || null;
    const parts: string[] = [df.name];

    if (df.description) {
      parts.push(df.description);
    }

    if (structure?.structure?.dimensions) {
      const dimNames = structure.structure.dimensions.map((d) => d.id);
      parts.push("Dimensions: " + dimNames.join(", "));

      const codelists = structure.structure.dimensions
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
    };
  });
  console.log("  Built " + String(entries.length) + " descriptions\n");

  // 4. Embed
  console.log("4. Embedding descriptions...");
  console.log("   (Loading model — first run may take a moment)\n");

  const { embedBatch } = await import("../lib/embeddings.js");
  const texts = entries.map((e) => e.richText);
  const embeddings = await embedBatch(texts);
  console.log("  Embedded " + String(embeddings.length) + " texts\n");

  // 5. Save index
  console.log("5. Saving index...");
  const index = {
    modelId: "granite-embedding-small-english-r2 (quantized ONNX)",
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
