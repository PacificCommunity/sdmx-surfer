/**
 * Semantic search for SDMX dataflows using local embeddings.
 *
 * Model: ibm-granite/granite-embedding-small-english-r2 (47M params, 384 dims, 8K tokens)
 * ONNX quantized version from sirasagi62/granite-embedding-small-english-r2-ONNX
 * Stored locally in models/granite-embedding-small-r2/
 */

import { pipeline, type FeatureExtractionPipeline, env } from "@huggingface/transformers";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// Point transformers.js to our local model files, not HuggingFace CDN
env.localModelPath = join(process.cwd(), "models");
env.allowRemoteModels = false;

const INDEX_PATH = join(process.cwd(), "models", "dataflow-index.json");
const MODEL_ID = "granite-embedding-small-r2";

// Singleton pipeline
let pipelinePromise: Promise<FeatureExtractionPipeline> | null = null;

function getEmbedder(): Promise<FeatureExtractionPipeline> {
  if (!pipelinePromise) {
    pipelinePromise = pipeline("feature-extraction", MODEL_ID, {
      dtype: "q8",
      device: "cpu",
    } as Record<string, unknown>).catch((err: Error) => {
      pipelinePromise = null;
      throw err;
    });
  }
  return pipelinePromise;
}

/**
 * Embed a single text string, returning a normalized 384-dim vector.
 */
export async function embed(text: string): Promise<number[]> {
  const extractor = await getEmbedder();
  const output = await extractor(text, {
    pooling: "mean",
    normalize: true,
  });
  return Array.from(output.data as Float32Array).slice(0, 384);
}

/**
 * Embed multiple texts in batch.
 */
export async function embedBatch(texts: string[]): Promise<number[][]> {
  const extractor = await getEmbedder();
  const results: number[][] = [];

  // Process in batches of 8 to avoid memory issues
  for (let i = 0; i < texts.length; i += 8) {
    const batch = texts.slice(i, i + 8);
    for (const text of batch) {
      const output = await extractor(text, {
        pooling: "mean",
        normalize: true,
      });
      results.push(Array.from(output.data as Float32Array).slice(0, 384));
    }
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
 * Cosine similarity between two normalized vectors.
 * Since both are already normalized (from the embed function), dot product = cosine.
 */
function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

export interface SearchResult {
  id: string;
  name: string;
  description: string;
  score: number;
}

/**
 * Semantic search: embed the query, compare against the index, return top-k.
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
