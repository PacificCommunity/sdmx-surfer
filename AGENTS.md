# Repository Guidelines

## Project Overview
**Data Surfer** (repo/package `sdmx-surfer`, domain `sdmxsurfer.net`) is a Next.js app where users build dashboards on official SDMx statistics through conversation. An agent loop finds data via the external **sdmx-mcp-gateway** (Python, MCP over HTTP), emits a dashboard config, and the app renders it with **sdmx-dashboard-components** (ECharts). It also ships **Country Snapshots** (`/countrysnapshots`), curated Pacific country profiles with their own chat. Production is an invite-only alpha, so treat all code as live.

Write the standard as **SDMx** in prose. Identifiers keep their existing spelling (`SDMXDashboard`, `SDMX_ENDPOINT`, `SDMX-JSON`).

## Architecture & Data Flow
```mermaid
flowchart LR
  B[Browser /builder] -->|POST /api/chat| C[app/api/chat/route.ts]
  C --> CS[checkCsrf → auth() → checkChatAllowed → zod]
  CS --> T[MCP tools<br/>lib/mcp-client.ts + lib/mcp-tool-policy.ts]
  CS --> M[getModelForUser<br/>lib/model-router.ts]
  T & M --> S[streamText + update_dashboard<br/>+ get_indicator_coverage]
  S -->|authoring config| K[compileDashboardToolConfig<br/>lib/dashboard-authoring.ts]
  K --> D[(dashboard_sessions<br/>Drizzle/Neon)]
  D --> P[/dashboard/[id], /p/[id], /gallery/]
  B -->|SDMX fetch via patched window.fetch| X[/api/sdmx-proxy/]
```
- **Auth gate:** `proxy.ts` (Next 16 middleware) uses the edge-safe `lib/auth.config.ts`. Signed-out page requests are redirected to `/login?callbackUrl=…`; matched API requests get Auth.js's default handling. Every route handler still calls `auth()` itself. Matcher exclusions (public): `api/auth`, `api/public`, `api/sdmx-proxy`, `api/countrysnapshots`, `api/training`, `api/cron`, `training`, `login`, `about`, `gallery`, `p`. A new public or machine-called route must be added there.
- **Node auth:** `lib/auth.ts` (Auth.js v5, Drizzle adapter, JWT sessions). Providers are Google, Entra and GitHub (each only when its env ID is set), magic link, password, and `email-proof`. Admission goes through `lib/admission.ts`: `AUTH_BOOTSTRAP_ADMINS`, then `allowed_domains`, then `allowed_emails`. Signup policy lives in `lib/signup-policy.ts`.
- **Dashboard config:** the model writes an *intent-level* config (`lib/dashboard-authoring.ts`). It is compiled server-side to the library schema (`lib/dashboard-schema.ts`, zod) and checked by `lib/dashboard-safety.ts`. `sanitizeDashboard` is the single enforcement point: it applies the data-host allowlist, strips markup, and limits `extraOptions` to presentation-only keys (the rule lives in `lib/extra-options.ts`). It runs on `update_dashboard`, session saves and public reads. Publishing (`app/api/sessions/[id]/publish`) runs a quota check, then `dashboardReferenceProblems`. Public reads (`app/api/public/dashboards/[id]`) re-sanitise on every read and return `no-store`.
- **Security headers:** `next.config.ts` sets CSP, HSTS, `nosniff`, `Referrer-Policy` and `Permissions-Policy` through two non-overlapping header entries. `/p/:id` may be framed by SPC sites (`frame-ancestors` list, no `X-Frame-Options`); every other path gets `frame-ancestors 'self'` plus `X-Frame-Options: SAMEORIGIN`. Header values are built in `lib/content-security-policy.ts`.
- **Sessions:** JWT sessions last 7 days (`lib/auth.config.ts`). The Node `jwt` callback re-checks the user against the DB every 5 minutes (`lib/session-revalidation.ts`), signs out removed or un-admitted users, and refreshes the role.
- **Retention:** a daily Vercel Cron (`vercel.json`) calls `GET /api/cron/retention`, authenticated with `Authorization: Bearer $CRON_SECRET`. `lib/retention.ts`:
  - redacts `usage_logs` text after 3 months, keeping cost and token columns for the budget cap;
  - deletes `auth_events` after 90 days;
  - hard-deletes sessions 30 days after soft-delete;
  - clears `auth_users.deleted_email` 3 months after account deletion.

  The "What we record" section on `/about` describes this to users; keep it in sync.
- **Account deletion:** `DELETE /api/account` (strict CSRF, typed-email confirmation) runs `lib/account-deletion.ts`. It unpublishes and soft-deletes sessions and removes keys, OAuth links and tokens. The email becomes a tombstone (`deleted+<id>@invalid`), and the real address moves to `deleted_email` for misuse review. `lib/session-revalidation.ts` treats `deleted_at` as gone. There are no transactions, so the step order is what makes partial failures retry-safe; keep it.
  - **Invariant: nothing ever deletes `usage_logs` rows or their cost columns**, because the global budget sums them. Deleted `auth_users` rows stay as their anonymous owners. Any deletion path, including `scripts/training-accounts.ts --delete`, goes through `deleteAccount`, never through raw deletes.
  - Per-user caps count usage through `usageOfPerson` (`lib/usage-caps.ts`), which includes accounts the same address deleted. Re-registering therefore doesn't reset a cap.
- **SDMX relay limits:** `app/api/sdmx-proxy` rate-limits key-bearing hosts with a sliding-window counter per HMAC-hashed IP. That is one atomic CTE in `lib/rate-limit.ts` on table `rate_limit_counters`, and it fails open. Bodies are capped at 20 MB (`lib/capped-body.ts`).
- **Providers/endpoints:** `lib/endpoints-registry.ts` is the single registry. It also generates the CSP `connect-src` (`lib/content-security-policy.ts`), so adding a provider needs no CSP edit. Hosts that need keys are proxied via `lib/proxied-hosts.ts` and `app/api/sdmx-proxy/route.ts` (https only, per-host path regex). `app/sdmx-proxy-boot.tsx` patches `fetch` client-side.
- **System prompts:** `lib/system-prompt.ts` (builder) and `lib/country-snapshots/system-prompt.ts`. Call out prompt changes in PRs.
- **Indexes:** `models/dataflow-index.json` (catalogue with Gemini `gemini-embedding-001` embeddings, via `lib/embeddings.ts`) and `models/dataflow-coverage.json` (read through `lib/coverage/`). Both are committed and refreshed daily by CI. `next.config.ts` `outputFileTracingIncludes` bundles them into `/api/explore` and `/api/chat`.
- **Country Snapshots** is an isolated module behind `INCLUDE_COUNTRY_SNAPSHOTS` (default on; `"0"` rewrites its routes to 404). Its routes are `app/api/countrysnapshots/{chat,warm,fork,log}`. Fork inserts a session built with `toNativeDashboardConfig` and redirects to `/builder?session=<id>`. Seeded messages must be UIMessages with `parts`, because a bare `{role, content}` crashes the builder.

## Key Directories
- `app/`: App Router pages and `app/api/*` route handlers (`account`, `admin`, `auth`, `chat`, `countrysnapshots`, `explore`, `public`, `reference-metadata`, `sdmx-proxy`, `sessions`, `settings`, `training`).
- `components/`: client UI. PDH chrome is in `app-header.tsx`, `app-footer.tsx` and `brand-field.tsx`. Snapshot UI is in `components/country-snapshots/`.
- `lib/`: server logic, schemas, prompts. `lib/db/` holds the Drizzle schema and client, `lib/coverage/` the coverage queries, and `lib/country-snapshots/` the snapshot module.
- `drizzle/`: SQL migrations (`0000`–`0010_<drizzle-tag>.sql`, plus `meta/`).
- `models/`: generated JSON indexes (tracked). `models/granite-embedding-small-r2/` is untracked and unused.
- `data/country-snapshots/`: source XLSX, `dataflow-dimensions.json`, import reports.
- `scripts/`: ops and data tooling. Run with `npx tsx`. Excluded from `tsconfig` and from Vercel deploys.
- `tests/`: all Vitest suites.
- `docs/`: see "Important Files" for which docs to trust.

## Development Commands
```bash
npm run dev            # next dev --turbopack
npm run build          # next build --webpack: different bundler; run before calling work done
npm run lint           # eslint . (flat config)
npm test               # vitest run
npx vitest run tests/model-router.test.ts -t "Terra"   # one file / one test
npm run build-index    # rebuild models/dataflow-index.json (needs MCP gateway; -- --force-embed)
npm run build-coverage # incremental models/dataflow-coverage.json (--force, --only A,B)
npm run report:provenance            # read-only diagnostic
npx drizzle-kit generate             # new migration from lib/db/schema.ts (no npm script)
```
Country Snapshots regeneration must run in this order: `npx tsx scripts/generate-dataflow-dimensions.ts`, then `npm run import:country-snapshots`, then `npm run consolidate:country-snapshots`, then `npm run augment:country-snapshot-types`. Re-running import wipes consolidation.

Ops scripts that hit the real DB or external services:
- `npx tsx scripts/add-pilot-user.ts <email> [--admin]`
- `npm run set-password -- <email>` (the user must be admitted first)
- `scripts/seed-allowed-domains.mts` (dry run unless `--write`)
- `scripts/migrate-extra-options.mts` (`--inventory`, `--dry-run`, or `--apply`)
- `scripts/training-accounts.ts` (`--park` or `--delete`)
- `scripts/rotate-encryption-secret.ts` (dry run unless `--apply`): re-encrypts BYOK keys after moving the old secret to `ENCRYPTION_SECRET_PREVIOUS`
- `scripts/smoke-gateway.ts`: tests the *Vercel AI Gateway* with paid calls, not the MCP gateway.
- `scripts/setup-vercel-env.sh`: force-pushes **every** `.env.local` key to Vercel production.

Do not run any of these without being asked.

## Code Conventions & Common Patterns
- TypeScript `strict`, 2-space indent, double quotes, semicolons. Import internally via `@/` (`@/lib/...`). The exception is `next.config.ts` and its imports (`lib/content-security-policy.ts`, `lib/endpoints-registry.ts`), which must use relative paths.
- Files are kebab-case (`chat-panel.tsx`, `model-router.ts`), React exports are PascalCase, helpers camelCase. Hooks are `use-*.ts`/`useX`.
- **Route handlers:** there is no auth wrapper. Every handler follows the same order:
  1. `checkCsrf(req)` (`lib/csrf.ts`). Use `{ strict: true }` for credential, admin and signup routes.
  2. `const session = await auth()`; `session?.user?.userId`.
  3. On failure, return `Response.json({ error: "Unauthorized" }, { status: 401 })`.
  4. Validate the body with zod.
- **Error shapes:** errors are `{ error }`. Caps and quota add `message` (and `used`/`cap`). Never leak provider or LLM errors: chat returns a generic 500.
- **Bot protection:** new public `POST` endpoints in `instrumentation-client.ts`'s BotID list must call `checkBotId()`.
- **DB:** `lib/db/index.ts` uses `drizzle-orm/neon-http`, so `db.transaction` is unavailable. Use conditional updates (`where consumed_at is null`), `onConflictDoNothing`, and owner-scoped `where` clauses. Sessions soft-delete via `deleted_at`.
  - The URL is chosen in this order: `POSTGRES_URL_NON_POOLING`, then `POSTGRES_URL`, then `DATABASE_URL`. `drizzle.config.ts` reads only `DATABASE_URL` from `.env.local`.
  - Scripts must load dotenv **before** dynamically importing `lib/db`.
- **Logging/usage:** `createRequestLogger(userId, sessionId)` (`lib/logger.ts`) writes `usage_logs` and swallows its own errors. `session_id` has an FK to `dashboard_sessions`, so snapshot chat passes `"anonymous"`. Caps live in `lib/usage-caps.ts` and `lib/country-snapshots/turn-cap.ts`.
- **Secrets:** BYOK keys go through `lib/encryption.ts` (AES-256-GCM, per-provider HMAC key from `ENCRYPTION_SECRET`; decryption also tries `ENCRYPTION_SECRET_PREVIOUS`). An unreadable key logs a warning without key material and falls back to the platform key. The settings keys API flags it `unreadable`, and the builder hides its BYOK models. Read env vars from `process.env`. Never hardcode gateway URLs, and never put secrets in `NEXT_PUBLIC_*`.
- **AI Gateway options:** `providerOptionsFor` (`lib/model-router.ts`) sends `zeroDataRetention` for models flagged in `lib/platform-models.ts` and `disallowPromptTraining` on every gateway request. A new platform model needs its `zeroDataRetention` flag checked live.
- **Prompt caching:** `cacheControl` must sit on message-level `providerOptions`, because on the `streamText` call it is silently ignored. `lib/country-snapshots/chat-assembly.ts` is the single source of the snapshot cache prefix, and chat and warm must stay byte-identical.
- **Module boundary:** nothing outside `app/countrysnapshots`, `app/api/countrysnapshots`, `components/country-snapshots`, `lib/country-snapshots`, `tests/country-snapshots` and a few listed `scripts/*` may import `country-snapshots` code. This is enforced by `no-restricted-imports` in `eslint.config.mjs` and by `tests/country-snapshots/module-boundary.test.ts`. A new allowed path must be added in both places.
- **Generated files:** do not hand-edit `lib/country-snapshots/catalogue.generated.ts`, `chart-types.generated.ts` or `models/*.json`. Change the generating script instead.
- **Design tokens:** Tailwind v4 CSS-first `@theme` in `app/globals.css` (PDH identity: navy `#223b83`, turquoise `#00a6c8`, orange `#e37b0a`; Inter weights 400–800; minimum radius 0.5rem). There is no `tailwind.config.*`.
  - `lib/brand-theme.ts` mirrors the tokens for charts and export. Change both together.
  - Keep the contrast variants (`accent-on-dark`, `brand-icon`, `brand-pattern`) as they are.
  - The pattern goes around content, never under it (`brand-field.tsx` `patternArea`).
  - Ignore the "Oceanic Data-Scapes" design in `stitch_assets/` and in README.
- **Commits:** short imperative, sentence-case subjects with no prefix, for example `Centre Pacific maps on the Pacific (EPSG:3832)`. Call out prompt, schema, migration and env changes.

## Important Files
- `app/api/chat/route.ts`: the builder agent loop.
- `lib/model-router.ts`: platform, BYOK and AI Gateway model choice.
- `lib/mcp-client.ts`: the MCP client.
- `lib/mcp-tool-policy.ts`: tool allowlist (`MCP_TOOL_ALLOWLIST`).
- `lib/dashboard-authoring.ts`, `lib/dashboard-schema.ts`, `lib/dashboard-safety.ts`: config pipeline and safety checks.
- `lib/auth.ts`, `lib/auth.config.ts`, `proxy.ts`, `lib/admission.ts`, `lib/csrf.ts`: authentication and access.
- `lib/endpoints-registry.ts`, `lib/proxied-hosts.ts`, `lib/content-security-policy.ts`, `next.config.ts`: providers, proxying and CSP (`serverExternalPackages: ["@ai-sdk/mcp"]`).
- `lib/db/schema.ts`: the Drizzle schema.
- `.env.example`: env reference. Also read but missing there: `AUTH_SECRET`, `AUTH_URL`, `POSTGRES_URL*`, `TRAINING_MODE`, `TRAINING_ACCESS_CODE`. Only `.env*.local` is gitignored, so never create a plain `.env`.
- Docs you can trust:
  - `docs/current-architecture.md`: routes, access, persistence, publication. It does not cover Country Snapshots; for that see `docs/superpowers/specs/2026-06-08-country-snapshots-design.md`.
  - `docs/technical-reference.md`
  - `docs/sdmx-dashboard-components-1.0-integration.md`
  - `docs/sdmx-dashboard-components-improvements.md`: library debt written up for upstreaming.
  - `docs/pdh-visual-alignment.md`
- Historical or stale docs: `dashboard-architecture.md`, `stitch_assets/`, `docs/superpowers/plans/`, and README's design and layout sections. README also wrongly calls the embedding model granite.
- `CLAUDE.md` still mentions `vendor/` tarballs. Those are gone; `sdmx-dashboard-components@1.0.0-rc.2` now comes from npm.

## Runtime/Tooling Preferences
- Node with **npm** (`package-lock.json` v3; CI uses Node 22). Do not use Bun, pnpm or yarn.
- Next 16.2 / React 19.2 / AI SDK 6 / Auth.js v5 / Drizzle 0.45 / Tailwind 4 / Vitest 4.
- Dev (Turbopack) and build (webpack) use different bundlers, so passing dev does not mean the build passes. `turbopack.root` is pinned because of a stray parent lockfile.
- **Build cache trap:** webpack and Vercel's build cache key packages by version. When a dependency changes contents under the same version, delete `.next` locally, or deploy once with `VERCEL_FORCE_NO_BUILD_CACHE=1`.
- Migrations are inconsistent. README uses `drizzle-kit push`, some docs use `migrate` or manual SQL. Check `drizzle/meta/_journal.json` against the target DB before deploying a schema change.
- Deploys go to Vercel. Treat functions as stateless; use `waitUntil` for post-response work, and AI Gateway model strings (`USE_AI_GATEWAY=1`). Check current model IDs at `https://ai-gateway.vercel.sh/v1/models` rather than from memory.
- Server functions are pinned to Sydney (`"regions": ["syd1"]` in `vercel.json`) next to the Neon database (`ap-southeast-2`); the MCP gateway runs on Railway in Singapore (`asia-southeast1`). Keep new data services in the same area, or every query crosses an ocean.

## Testing & QA
- Vitest config: `environment: "node"`, `globals: true`, `include: ["tests/**/*.test.ts"]`, `@` alias set to the repo root.
  - Put tests in `tests/<lib-module-name>.test.ts`, not next to the code. Snapshot tests go in `tests/country-snapshots/`.
  - `.tsx` tests and DOM tests are not collected; components need a config change first.
  - Run from the repo root, because the boundary test walks `process.cwd()`.
- Patterns:
  - Import `describe/it/expect/vi` from `"vitest"` explicitly.
  - Mock the DB with `vi.mock("@/lib/db", ...)`, chaining `select→from→where→orderBy→limit` exactly as the production query does (see `tests/model-router.test.ts`).
  - Stub env with `vi.stubEnv`/`vi.unstubAllEnvs()`, and fetch with `vi.stubGlobal("fetch", ...)`/`vi.unstubAllGlobals()`.
  - No real network, DB or MCP calls.
- Coverage is mostly `lib/` logic, `lib/coverage`, `lib/country-snapshots` and the snapshot import scripts. A few route handlers are tested by calling the exported handler with mocked `@/lib/auth`/`@/lib/db`: `sdmx-proxy`, `cron/retention`, `settings/keys` and `countrysnapshots/fork`. There are no component, DB-integration or e2e tests.
  - `tests/auth-logic.test.ts` re-implements its logic inline and does not cover `lib/auth.ts`.
  - When generated-catalogue shapes change, update the inline mocks in `tests/country-snapshots/*`.
- CI (`.github/workflows/refresh-index.yml`) only refreshes `models/*.json` daily and commits them. Nothing runs lint, tests or build automatically. Before calling work done, run `npm run lint`, `npm test` and `npm run build` yourself. For UI changes, also check the affected route in `npm run dev`: `/`, `/builder`, `/dashboard/[id]`, `/p/[id]`, `/gallery`, `/countrysnapshots`.
- There is no coverage threshold. Add tests for consumer-visible logic in `lib/`, especially auth/admission, safety, caps and config compilation.

<!-- VERCEL BEST PRACTICES START -->
## Best practices for developing on Vercel

These defaults are optimized for AI coding agents (and humans) working on apps that deploy to Vercel.

- Treat Vercel Functions as stateless + ephemeral (no durable RAM/FS, no background daemons), use Blob or marketplace integrations for preserving state
- Edge Functions (standalone) are deprecated; prefer Vercel Functions
- Don't start new projects on Vercel KV/Postgres (both discontinued); use Marketplace Redis/Postgres instead
- Store secrets in Vercel Env Variables; not in git or `NEXT_PUBLIC_*`
- Provision Marketplace native integrations with `vercel integration add` (CI/agent-friendly)
- Sync env + project settings with `vercel env pull` / `vercel pull` when you need local/offline parity
- Use `waitUntil` for post-response work; avoid the deprecated Function `context` parameter
- Set Function regions near your primary data source; avoid cross-region DB/service roundtrips
- Tune Fluid Compute knobs (e.g., `maxDuration`, memory/CPU) for long I/O-heavy calls (LLMs, APIs)
- Use Runtime Cache for fast **regional** caching + tag invalidation (don't treat it as global KV)
- Use Cron Jobs for schedules; cron runs in UTC and triggers your production URL via HTTP GET
- Use Vercel Blob for uploads/media; Use Edge Config for small, globally-read config
- If Enable Deployment Protection is enabled, use a bypass secret to directly access them
- Add OpenTelemetry via `@vercel/otel` on Node; don't expect OTEL support on the Edge runtime
- Enable Web Analytics + Speed Insights early
- Use AI Gateway for model routing, set AI_GATEWAY_API_KEY, using a model string (e.g. 'anthropic/claude-sonnet-4.6'), Gateway is already default in AI SDK
  needed. Always curl https://ai-gateway.vercel.sh/v1/models first; never trust model IDs from memory
<!-- VERCEL BEST PRACTICES END -->

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
