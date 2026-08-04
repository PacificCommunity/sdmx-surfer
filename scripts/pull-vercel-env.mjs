#!/usr/bin/env node
/**
 * Write .env.local from a project's Vercel environment variables.
 *
 * Used by the daily index refresh so the gateway URL, its token and the
 * embedding key have exactly one home, in Vercel, rather than a second copy in
 * GitHub secrets that goes stale the first time one is rotated.
 *
 * WHY NOT `vercel env pull`. The CLI resolves the account before it fetches
 * anything, and a project-scoped token (`vcp_`) is denied user- and team-level
 * resources by design: /v2/user returns 404 and /v2/teams returns 403, while
 * the project and its environment both return 200. The CLI reports that as
 * "Could not retrieve Project Settings", which reads like a linking problem and
 * is not one. Calling the REST API directly is what the token is scoped for.
 *
 * Values are written with JSON.stringify, so a value containing a newline is
 * emitted escaped and dotenv reads it back byte-identical. Never assemble this
 * file by hand or source it in bash: a literal \n once turned the gateway URL
 * into a path ending /mcp/n, and the failure surfaced far from its cause.
 *
 * Usage: VERCEL_TOKEN=... VERCEL_PROJECT_ID=... node scripts/pull-vercel-env.mjs
 */
import { writeFileSync } from "node:fs";

const token = process.env.VERCEL_TOKEN;
const projectId = process.env.VERCEL_PROJECT_ID;
const target = process.env.VERCEL_ENV_TARGET || "production";
const outPath = process.env.VERCEL_ENV_OUT || ".env.local";

/** Keys the caller cannot proceed without. */
const REQUIRED = (process.env.VERCEL_ENV_REQUIRED || "")
  .split(",")
  .map((k) => k.trim())
  .filter(Boolean);

if (!token || !projectId) {
  console.error("VERCEL_TOKEN and VERCEL_PROJECT_ID are both required.");
  process.exit(1);
}

const url =
  "https://api.vercel.com/v9/projects/" +
  encodeURIComponent(projectId) +
  "/env?decrypt=true";

const resp = await fetch(url, {
  headers: { Authorization: "Bearer " + token },
});
if (!resp.ok) {
  // Body may echo the token or project details, so report the status only.
  console.error("Vercel API returned " + resp.status + " for " + url);
  process.exit(1);
}

const body = await resp.json();
const all = Array.isArray(body.envs) ? body.envs : [];

// One key can exist several times with different targets. Prefer the requested
// target, and skip branch-specific overrides, which are not what a scheduled
// job on the default branch should inherit.
const chosen = new Map();
for (const e of all) {
  if (!e?.key) continue;
  const targets = Array.isArray(e.target) ? e.target : [e.target].filter(Boolean);
  if (!targets.includes(target)) continue;
  if (e.gitBranch) continue;
  if (typeof e.value !== "string") continue; // sensitive vars return no value
  chosen.set(e.key, e.value);
}

const missing = REQUIRED.filter((k) => !chosen.has(k));
if (missing.length) {
  console.error(
    "Missing required variables in the " + target + " environment: " +
      missing.join(", "),
  );
  process.exit(1);
}

const lines = [...chosen.entries()]
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([k, v]) => k + "=" + JSON.stringify(v));
writeFileSync(outPath, lines.join("\n") + "\n", "utf-8");

// Names only. Values are secrets and this log is public on a public repo.
console.log(
  "Wrote " + outPath + " with " + chosen.size + " variables from " + target,
);
console.log("Required present: " + (REQUIRED.join(", ") || "(none specified)"));
