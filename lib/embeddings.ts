/**
 * Semantic search for SDMX dataflows using Google Gemini embeddings.
 *
 * Model: gemini-embedding-001 via @ai-sdk/google (API-based, no local ONNX)
 * Index stored at models/dataflow-index.json (pre-built via scripts/build-index.ts)
 */

import { embed as aiEmbed, embedMany as aiEmbedMany } from "ai";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");

function getEmbeddingModel() {
  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    throw new Error("GOOGLE_AI_API_KEY is required for semantic search");
  }
  const google = createGoogleGenerativeAI({ apiKey });
  return google.embeddingModel("gemini-embedding-001");
}

/**
 * Embed a single text string, returning a vector.
 */
export async function embed(text: string): Promise<number[]> {
  const model = getEmbeddingModel();
  const { embedding } = await aiEmbed({ model, value: text });
  return embedding;
}

/**
 * Embed multiple texts in batch (chunks of 100 due to Google API limit).
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const model = getEmbeddingModel();
  const BATCH_SIZE = 100;
  const results: number[][] = [];

  for (let i = 0; i < texts.length; i += BATCH_SIZE) {
    const chunk = texts.slice(i, i + BATCH_SIZE);
    const { embeddings } = await aiEmbedMany({ model, values: chunk });
    results.push(...embeddings);
  }

  return results;
}

// ── Index types ──

export interface DataflowIndexEntry {
  id: string;
  name: string;
  description: string;
  richText: string;
  embedding: number[];
}

export interface DataflowIndex {
  modelId: string;
  createdAt: string;
  entries: DataflowIndexEntry[];
}

/**
 * Load the pre-built index from disk.
 */
export function loadIndex(): DataflowIndex | null {
  if (!existsSync(INDEX_PATH)) return null;
  try {
    const raw = readFileSync(INDEX_PATH, "utf-8");
    return JSON.parse(raw) as DataflowIndex;
  } catch {
    return null;
  }
}

/**
 * Cosine similarity between two vectors.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export interface SearchResult {
  id: string;
  name: string;
  description: string;
  score: number;
}

/**
 * Semantic search: embed the query via Google API, compare against the pre-built index, return top-k.
 */
export async function semanticSearch(
  query: string,
  topK: number = 10,
): Promise<SearchResult[]> {
  const index = loadIndex();
  if (!index || index.entries.length === 0) {
    return [];
  }

  const queryEmbedding = await embed(query);

  const scored = index.entries.map((entry) => ({
    id: entry.id,
    name: entry.name,
    description: entry.description,
    score: cosineSimilarity(queryEmbedding, entry.embedding),
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}
