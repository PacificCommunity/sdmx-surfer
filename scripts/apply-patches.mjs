#!/usr/bin/env node
/**
 * Idempotent postinstall patches.
 *
 * We previously used `patch-package`, but its unified-diff hunks require an
 * exact context match. When Vercel reused a cached `node_modules` from a
 * previous deploy (the old patches already applied), the next deploy's hunks
 * stopped matching and the build failed. The recovery was a manual cache purge
 * each time we touched a patch — fragile.
 *
 * This script instead does literal find-and-replace per patch, guarded by a
 * sentinel that's only present in the post-patch state. Every patch is one of:
 *
 *   already patched  →  sentinel string present, skip
 *   pristine         →  `before` present, replace with `after`
 *   anything else    →  loud error (corrupted or upstream content changed)
 *
 * To add or modify a patch, encode the literal `before` and `after` strings
 * here. Keep a sentinel that is unique to the patched state (typically a piece
 * of the new content itself).
 *
 * To remove a patch when upstream catches up, delete the entry and bump the
 * lockfile so cached state with the patch applied gets rebuilt.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const ROOT = process.cwd();

/** @typedef {{ name: string, file: string, sentinel: string, before: string, after: string, reason: string }} Patch */

/** @type {Patch[]} */
const PATCHES = [
  {
    name: "sdmx-json-parser: normalise SBS SDMX-JSON v1.0 responses into v2.0 shape",
    file: "node_modules/sdmx-json-parser/dist/parser.js",
    sentinel: "SBS-v1-to-v2 normalisation",
    reason:
      "SBS endpoint downgrades to SDMX-JSON v1.0 (data.structure singular) when format=jsondata is in the URL, even with Accept v2.0.0. The bundled parser only handles v2.0; reshape on read. Remove when SBS upgrades.",
    before:
      "this.getJSON=JSON.parse(i),Object.keys(T).length>0&&(this.getJSON.data.dataSets[0].observations=T,delete this.getJSON.data.dataSets[0].series)",
    after:
      'this.getJSON=JSON.parse(i),Object.keys(T).length>0&&(this.getJSON.data.dataSets[0].observations=T,delete this.getJSON.data.dataSets[0].series),(()=>{var d=this.getJSON&&this.getJSON.data;if(!d)return;if(d.structure&&!d.structures){d.structures=[d.structure];delete d.structure;}var s=d.structures&&d.structures[0];if(s){if(s.dimensions){if(s.dimensions.dataset&&!s.dimensions.dataSet){s.dimensions.dataSet=s.dimensions.dataset;delete s.dimensions.dataset;}["dataSet","series","observation"].forEach(function(k){if(!s.dimensions[k])s.dimensions[k]=[];});}if(s.attributes){["dataSet","dimensionGroup","series","observation"].forEach(function(k){if(!s.attributes[k])s.attributes[k]=[];});}}})()/*SBS-v1-to-v2 normalisation: see scripts/apply-patches.mjs*/',
  },
  {
    name: "sdmx-dashboard-components: throw actionable error when bar/column chart has no series dim",
    file: "node_modules/sdmx-dashboard-components/dist/sdmx-dashboard-components.js",
    sentinel: 'Chart type=" + m + " with xAxis=',
    reason:
      "Library silently produced a blank panel when the bar/column branch couldn't find a series dimension distinct from xAxis. Replace with a thrown error the agent can read and self-correct from.",
    before:
      '          let Y = {};\n          U ? Y = P.find((V) => V.id === U) : Y = W.find((V) => V.id !== j);\n          const z = W.find((V) => V.id === j);\n          Y.values.sort((V, q) => V.id.localeCompare(q.id))',
    after:
      '          let Y = {};\n          U ? Y = P.find((V) => V.id === U) : Y = W.find((V) => V.id !== j);\n          const z = W.find((V) => V.id === j);\n          if (!Y || !Y.values || !z) { throw new Error("Chart type=" + m + " with xAxis=" + j + " needs at least one other varying dimension to group bars/columns. Only " + j + " varies in this query. Fix: switch chart type to line or pie, widen the data query so a second dimension varies (e.g. remove lastNObservations or broaden the filter), or set legend.concept to a dimension with multiple values."); }\n          Y.values.sort((V, q) => V.id.localeCompare(q.id))',
  },
];

let failed = 0;
let applied = 0;
let skipped = 0;

for (const patch of PATCHES) {
  const fullPath = path.join(ROOT, patch.file);
  let contents;
  try {
    contents = fs.readFileSync(fullPath, "utf8");
  } catch (err) {
    if (err && err.code === "ENOENT") {
      console.warn("[apply-patches] skip — file not present: " + patch.file);
      continue;
    }
    throw err;
  }

  if (contents.includes(patch.sentinel)) {
    console.log("[apply-patches] already applied: " + patch.name);
    skipped += 1;
    continue;
  }

  if (!contents.includes(patch.before)) {
    console.error(
      "[apply-patches] cannot apply: " + patch.name + "\n" +
        "  file " + patch.file + " is in an unexpected state.\n" +
        "  Sentinel '" + patch.sentinel + "' not present and the anchor 'before' string was not found.\n" +
        "  This usually means the upstream package was updated and the patch needs to be re-derived against the new bundle.",
    );
    failed += 1;
    continue;
  }

  const updated = contents.replace(patch.before, patch.after);
  if (updated === contents) {
    // Defensive — String.replace should have changed something, since `before` is present.
    console.error("[apply-patches] no-op replace despite anchor present: " + patch.name);
    failed += 1;
    continue;
  }

  fs.writeFileSync(fullPath, updated);
  console.log("[apply-patches] applied: " + patch.name);
  applied += 1;
}

console.log(
  "[apply-patches] done — applied=" + applied + " skipped=" + skipped + " failed=" + failed,
);

if (failed > 0) {
  process.exit(1);
}
