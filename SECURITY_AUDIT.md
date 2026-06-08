# Security Audit — sdmx/dashboarder

**Date:** 2026-06-08
**Stack:** Next.js 16 + React 19 + Drizzle + next-auth 4, deployed to Vercel
**Auditor:** automated (`npm audit`, `npm outdated`) plus manual exposure review

## Headline

| Severity | 2026-05-20 (initial) | 2026-05-20 (post-fix) | 2026-06-08 (today, pre) | 2026-06-08 (today, post) |
|---|---|---|---|---|
| High | 1 | 0 | 0 | **0** |
| Moderate | 11 | 7 | 14 | **9** |
| Low | 3 | 3 | 2 | **2** |
| **Total** | **15** | **10** | **16** | **11** |

Zero high-severity advisories remain. Every remaining moderate has been classified by production exposure (see §3). Build, lint, and tests verified clean.

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

### 3.1 `nodemailer ≤ 8.0.4` — moderate, no upstream fix

- **Advisories:** GHSA-vvjj-xcjg-gr5g (CRLF in transport `name`), GHSA-c7w3-x93f-qmm8 (unsanitized `envelope.size`)
- **Chain:** direct `nodemailer ^7.0.13`, plus `next-auth 4` → `@auth/core` → `nodemailer`, plus `@auth/drizzle-adapter` → `@auth/core` → `nodemailer`
- **Production exposure:** none. Both advisories require attacker-controlled input flowing into specific transport options (`name`, `envelope.size`). In this app, `nodemailer` is only invoked through next-auth's email provider with a hard-coded Resend transport. No user input reaches transport configuration.
- **Verified by:** grep across `lib/` and `app/` for `createTransport`, `envelope`, and `transport.name` confirms no user input pathways.
- **Resolution path:** the `next-auth 4 → 5 (Auth.js)` migration removes the legacy `nodemailer` flows entirely. Tracked as a dedicated piece of work for beta.

### 3.2 `uuid < 11.1.1` via `next-auth` — moderate

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
