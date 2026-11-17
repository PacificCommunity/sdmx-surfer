# Security Audit — sdmx/dashboarder

**Date:** 2026-11-17 (current); earlier audits 2026-05-20, 2026-06-08, 2026-06-16 below
**Stack:** Next.js 16 + React 19 + Drizzle + Auth.js v5, deployed to Vercel
**Auditor:** automated (`npm audit`, `npm outdated`) plus manual exposure review

## Current state (2026-11-17)

| Severity | Before (all deps) | After (all deps) | After (production deps, `--omit=dev`) |
|---|---|---|---|
| Critical | 6 | **0** | **0** |
| High | 13 | **0** | **0** |
| Moderate | 21 | 6 | **0** |
| Low | 11 | **0** | **0** |
| **Total** | **51** | **6** | **0** |

**Production dependencies have no known advisories.** The six remaining moderates are in development and maintenance tooling only (§A.3).

### A.1 What the November audit found

Advisories had accumulated since June, including critical ones in packages on the request path:
- `next` 16.2.7: a middleware/proxy bypass that needs Turbopack (production builds use webpack), plus several denial-of-service issues.
- `next-auth` / `@auth/core`: an email-normalisation homoglyph bypass, and existence checks that fail open on configuration errors.
- `dompurify`, through `mermaid` and `jspdf`: a cross-realm sanitisation bypass.
- `proxy-addr`: IPv4-mapped IPv6 trust bypass.
- Highs in `zod`, `postcss`, `ws`, `sharp`, `adm-zip` (via `onnxruntime-node`) and others.

### A.2 What we changed

1. `npm audit fix` (non-breaking). Resolved versions: `next` 16.4.6, `next-auth` 5.0.0-beta.32, `@auth/core` 0.41.3, `@auth/drizzle-adapter` 1.11.3, `dompurify` 3.4.18, `zod` 4.6.7, `postcss` 8.5.33, `proxy-addr` 2.0.8.
2. Removed two unused direct dependencies: `onnxruntime-node`, left over from the abandoned local embedding model, which also drops the `adm-zip` chain; and `ts-deepmerge`.
3. Upgraded `mermaid` 11 → 12.3.0, which fixes `katex`'s prototype-pollution advisory. `/explore` pins the classic look and the dagre layout. Mermaid 12's default ELK layout did not finish rendering a full dataflow structure diagram in our test; classic/dagre rendered it at once.
4. Added an npm `overrides` entry, `qs ^6.16.2`. `friendly-words` (used for generated passphrases) declares `express` as a dependency, which pulled in a vulnerable `qs`. Our code never loads `express`.

Verified: `npm run lint` (0 errors), `npm test` (577 tests, 45 files), `npm run build`. CI (`.github/workflows/ci.yml`) now runs all three on every push to `main` and on every pull request.

### A.3 Remaining advisories (dev and maintenance tooling only)

| Advisory | Chain | Why there is no production exposure |
|---|---|---|
| `esbuild ≤ 0.24.2` (GHSA-67mh-4wv8-2f99), moderate, 4 entries | `drizzle-kit` → `@esbuild-kit/*` → `esbuild` | `drizzle-kit` runs only on a maintainer's machine, to generate and apply migrations. The vulnerable code is esbuild's dev server, which is never started. The only offered fix downgrades drizzle-kit to 0.18, which is incompatible |
| `uuid < 11.1.1` (GHSA-w5hq-g745-h8pq), moderate, 2 entries | `exceljs` → `uuid` | `exceljs` is a devDependency, used only by `scripts/import-country-snapshots.ts` to read SPC's own indicator workbook. The bug needs a caller-supplied buffer to `v3`/`v5`/`v6` |

### A.4 Going forward

Run `npm audit --omit=dev` before each release; any high or critical blocks the release. The full `npm audit` should only ever list the tooling entries above.

---

## Earlier audits (kept as history)

> **Update 2026-06-16 — Auth.js v5 migration landed.** Migrated `next-auth 4 → 5` and removed `nodemailer` entirely (`npm ls nodemailer` → empty). This resolves §3.1 (the nodemailer chain and its low-severity `@auth/core` / `@auth/drizzle-adapter` echoes) and §3.2 (`next-auth → uuid`). The magic-link flow now uses a custom Resend `email` provider that never imports nodemailer. Remaining items are dev-tooling (`esbuild` via drizzle-kit/tsx — surfaced as high after this date by new advisories, no production runtime path) and build-time (`postcss` via next, `uuid` via exceljs). Re-run `npm audit` for the current count.

### Headline (June 2026)

| Severity | 2026-05-20 (initial) | 2026-05-20 (post-fix) | 2026-06-08 (today, pre) | 2026-06-08 (today, post) |
|---|---|---|---|---|
| High | 1 | 0 | 0 | **0** |
| Moderate | 11 | 7 | 14 | **9** |
| Low | 3 | 3 | 2 | **2** |
| **Total** | **15** | **10** | **16** | **11** |

Zero high-severity advisories remained in June. Every remaining moderate was classified by production exposure (see §3).

## 1. What changed today

The May audit had drifted upwards by the time we revisited it (new advisories in `svix`/`uuid` via Resend, and `esbuild` via drizzle-kit). Three actions taken today:

1. **Bumped `resend` from `^6.9.4` to `^6.12.4`.** Resend dropped its dependency on `svix` (now uses `standardwebhooks`), which removed the entire `svix → uuid` advisory chain.
2. **Bumped `next` from `^16.2.1` to `^16.2.7`** and **`next-auth` from `^4.24.13` to `^4.24.14`.** Both patch-level, no breaking changes.
3. **Ran `npm audit fix` (non-breaking).** Resolved the `qs` advisory propagated through `express → body-parser`.

Diff: `package.json` 3 lines changed, `package-lock.json` shrank by ~140 lines.

## 2. Verification

```
npm run build   # succeeds
npm run lint    # only pre-existing unused-var warnings in reproducer scripts
npm test        # 127 tests pass across 11 files
```

## 3. Remaining advisories, with production-exposure analysis

All four remaining issue groups are either dev-only, build-time-only, or guarded by application-level controls. None have a production runtime path that is exploitable in our deployment shape.

### 3.1 `nodemailer ≤ 8.0.4` — moderate ✅ RESOLVED 2026-06-16 (Auth.js v5 migration removed nodemailer)

- **Advisories:** GHSA-vvjj-xcjg-gr5g (CRLF in transport `name`), GHSA-c7w3-x93f-qmm8 (unsanitized `envelope.size`)
- **Chain:** direct `nodemailer ^7.0.13`, plus `next-auth 4` → `@auth/core` → `nodemailer`, plus `@auth/drizzle-adapter` → `@auth/core` → `nodemailer`
- **Production exposure:** none. Both advisories require attacker-controlled input flowing into specific transport options (`name`, `envelope.size`). In this app, `nodemailer` is only invoked through next-auth's email provider with a hard-coded Resend transport. No user input reaches transport configuration.
- **Verified by:** grep across `lib/` and `app/` for `createTransport`, `envelope`, and `transport.name` confirms no user input pathways.
- **Resolution path:** the `next-auth 4 → 5 (Auth.js)` migration removes the legacy `nodemailer` flows entirely. Tracked as a dedicated piece of work for beta.

### 3.2 `uuid < 11.1.1` via `next-auth` — moderate ✅ RESOLVED 2026-06-16 (the `next-auth → uuid` chain is gone in v5; a separate `exceljs → uuid` chain remains, dev/import-script only)

- **Advisory:** GHSA-w5hq-g745-h8pq (missing buffer bounds check in `v3`/`v5`/`v6` when an explicit `buf` is passed)
- **Chain:** `next-auth 4` → `uuid`
- **Production exposure:** none. The vulnerability only triggers when callers pass an explicit `buf` argument to `v3`/`v5`/`v6`. next-auth uses `uuid` for token generation, not with a caller-supplied buffer.
- **Resolution path:** same `next-auth 4 → 5` migration. v5 uses a current `uuid` release.

### 3.3 `esbuild ≤ 0.24.2` via `drizzle-kit` — moderate

- **Advisory:** GHSA-67mh-4wv8-2f99 (esbuild dev server can be queried cross-origin)
- **Chain:** `drizzle-kit 0.31.10` → `@esbuild-kit/esm-loader` → `@esbuild-kit/core-utils` → `esbuild`
- **Production exposure:** none. `drizzle-kit` is a dev/migration tool. It runs locally for schema editing and in CI for migration generation. It never runs as part of a deployed Vercel function or container. The vulnerable code path is esbuild's dev server, which we never start.
- **Resolution path:** wait for `drizzle-kit` to update its `@esbuild-kit/*` toolchain. The advised "fix" (`npm audit fix --force`) would downgrade to drizzle-kit 0.18.1, which is incompatible with our current schema syntax. Not a real option.

### 3.4 `postcss < 8.5.10` nested under `next` — moderate

- **Advisory:** GHSA-qx2v-qp2m-jg93 (XSS via unescaped `</style>` in CSS stringify)
- **Chain:** `next 16.2.7` bundles `postcss 8.4.31` in its private `node_modules`. The top-level `postcss` in our tree is already at a fixed version.
- **Production exposure:** none in our deployment. The bundled `postcss` only runs at build time inside Next's CSS pipeline, processing our own stylesheets. Exploitation would require us to compile attacker-controlled CSS into the production bundle. We don't.
- **Resolution path:** Next.js 16.3 stable will ship a patched nested `postcss`. Apply `npm update next` when 16.3 is released. The `--force` fix (downgrading to next 9.3.3) is not viable.

### 3.5 Transitive echoes

The remaining low-severity entries (`@auth/core`, `@auth/drizzle-adapter`) are the dependency tree echoing §3.1 through their parents. They resolve together when the underlying `nodemailer` chain is replaced via the next-auth 5 migration.

## 4. Risk summary in one paragraph

After today's remediation, zero high-severity advisories and zero moderate advisories with a production runtime exposure path remain. The nine moderate items in the audit report are either tool-chain bloat (drizzle-kit's esbuild), build-time bloat (next's bundled postcss), or part of the `next-auth 4 → 5` migration backlog (the nodemailer and uuid chains). This is the same residual shape we had after the May audit; the additions since May have been addressed.

## 5. Recommended next actions

1. Commit `package.json` and `package-lock.json` as a single security-bumps commit.
2. Schedule the `next-auth 4 → 5 (Auth.js)` migration before public beta. This closes §3.1 and §3.2 in one move.
3. Watch for Next.js 16.3 stable release; bump promptly to close §3.4.
4. Re-run `npm audit` weekly or monthly, depending on tolerance. Recommended: monthly, with an alert if the high count is non-zero.

## 6. Outdated packages still worth tracking

| Package | Current | Latest | Note |
|---|---|---|---|
| `ai` (AI SDK) | 6.0.159 | check | apply current patch in next sweep |
| `nodemailer` | 7.0.13 | 8.0.7 | major bump; verify if 8.x ships fixes for §3.1 |
| `highcharts` | 11.4.8 | 12.6.0 | major bump; visual regression risk |
| `ol` (OpenLayers) | 8.2.0 | 10.9.0 | 2 majors behind |
| `react-error-boundary` | 4.1.2 | 6.1.1 | 2 majors behind |
| `html-react-parser` | 5.2.17 | 6.1.1 | major bump |
| `typescript` | 5.9.3 | 6.0.3 | major bump |
| `eslint` | 9.39.4 | 10.4.0 | major bump |

None of these are security-blocking.

## 7. History

- **2026-05-20** — Initial audit. Closed 1 high (npm audit fix). Documented 10 residual issues with mitigations.
- **2026-06-08** — Drift sweep. Reduced from 16 to 11 via patch bumps to `resend`, `next`, `next-auth`, and the qs autofix. Classified all remaining items by production exposure. Verified clean build, lint, tests.
- **2026-06-16** — Auth.js v5 migration removed `nodemailer` and the `next-auth → uuid` chain.
- **2026-11-17** — Drift sweep. 51 → 6 (0 in production dependencies) via `npm audit fix`, removal of unused `onnxruntime-node` and `ts-deepmerge`, `mermaid` 12.3, and a `qs` override. Verified lint, tests and build; CI now enforces them.
