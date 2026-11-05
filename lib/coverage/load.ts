/**
 * Server-only access to `models/dataflow-coverage.json`.
 *
 * Read lazily on first use and memoised for the life of the process: the
 * explore routes and the chat tool share one parse. A missing or unreadable
 * file yields null, and callers degrade to "no coverage" rather than fail.
 */

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { buildIndicatorIndex } from "@/lib/coverage/query";
import type { CoverageArtifact } from "@/lib/coverage/types";

export const COVERAGE_PATH = join(process.cwd(), "models", "dataflow-coverage.json");

export interface LoadedCoverage {
  artifact: CoverageArtifact;
  indicatorIndex: Map<string, string[]>;
}

let cached: LoadedCoverage | null | undefined;

export function loadCoverage(): LoadedCoverage | null {
  if (cached !== undefined) return cached;
  cached = null;
  if (!existsSync(COVERAGE_PATH)) return cached;
  try {
    // Written by scripts/build-coverage.ts in exactly this shape.
    const artifact = JSON.parse(readFileSync(COVERAGE_PATH, "utf-8")) as CoverageArtifact;
    cached = { artifact, indicatorIndex: buildIndicatorIndex(artifact) };
  } catch (err) {
    console.error("[coverage] Failed to read " + COVERAGE_PATH + ":", err instanceof Error ? err.message : err);
  }
  return cached;
}
