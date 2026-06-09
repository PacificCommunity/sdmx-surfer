import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ALLOWED_PATHS = [
  "app/countrysnapshots",
  "app/api/countrysnapshots",
  "lib/country-snapshots",
  "components/country-snapshots",
  "scripts/import-country-snapshots.ts",
  "scripts/augment-country-snapshot-types.ts",
  "scripts/consolidate-country-snapshot-indicators.ts",
  "tests/country-snapshots",
];

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (
      name === "node_modules" ||
      name.startsWith(".") ||
      name === "data" ||
      name === "patches" ||
      name === "stitch_assets" ||
      name === "models" ||
      name === "logs"
    ) {
      return [];
    }
    const s = statSync(full);
    if (s.isDirectory()) return walk(full);
    if (/\.(ts|tsx|js|jsx|mjs)$/.test(name)) return [full];
    return [];
  });
}

describe("module boundary", () => {
  it("no file outside the module paths imports from country-snapshots/", () => {
    const root = process.cwd();
    const files = walk(root);
    const violators: string[] = [];
    const importRe = /from\s+["']([^"']*country-snapshots[^"']*)["']/g;

    for (const file of files) {
      const rel = relative(root, file).replace(/\\/g, "/");
      if (
        ALLOWED_PATHS.some((p) => rel === p || rel.startsWith(p + "/"))
      ) {
        continue;
      }
      const text = readFileSync(file, "utf8");
      if (importRe.test(text)) violators.push(rel);
      importRe.lastIndex = 0;
    }

    expect(violators).toEqual([]);
  });
});
