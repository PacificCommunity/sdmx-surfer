# Repository Guidelines

## Project Structure & Module Organization
This repository is a Next.js 16 + React 19 TypeScript app for the SDMX Surfer conversational dashboard builder (pilot deployment). App routes live in `app/`, including the main pages (`/`, `/builder`, `/dashboard/[id]`, `/p/[id]`, `/gallery`, `/explore`, `/settings`, `/admin`, `/login`) and the chat API route at `app/api/chat/route.ts`. Reusable UI lives in `components/`, and shared types, prompt text, and example data live in `lib/`. Static assets belong in `public/`. Architecture and design references live in `docs/current-architecture.md` (implemented behavior — source of truth for route/access/publication semantics), `docs/technical-reference.md` (lower-level technical internals), `dashboard-architecture.md` (broader target-state scoping), `CLAUDE.md`, and `stitch_assets/`; treat those as supporting documentation, not runtime code.

## Build, Test, and Development Commands
- `npm run dev`: start the local Next.js dev server with Turbopack.
- `npm run build`: create a production build and catch type/app-router issues.
- `npm run start`: serve the production build locally.
- `npm run lint`: run the Next.js ESLint checks; this is the main automated gate today.
- `npm test`: run the committed Vitest suite.

Use `.env.local` for local configuration such as `MCP_GATEWAY_URL`.

## Coding Style & Naming Conventions
Use TypeScript with `strict` mode and prefer the `@/` path alias for internal imports. Match the existing style: 2-space indentation, double quotes, semicolons, and small functional React components. Use PascalCase for component files and exports (`ChatPanel`), camelCase for helpers and variables (`getSystemPrompt`), and Next.js route conventions like `page.tsx`, `layout.tsx`, and `route.ts`. Keep Tailwind utility usage aligned with the design tokens defined in `app/globals.css`.

## Testing Guidelines
Run `npm run lint` and `npm test` for normal changes, then manually verify the affected flow in `npm run dev` when UI or routing is involved. For UI work, check the relevant route directly, especially `/`, `/builder`, `/dashboard/[id]`, `/p/[id]`, and `/gallery` when publication or presentation behavior is touched. For API work, exercise `app/api/chat/route.ts` and the relevant session/public/admin endpoints against a working MCP gateway and authenticated session context. Prefer `*.test.ts` or `*.test.tsx` next to the code they cover.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so no local commit convention can be inferred. Use short imperative commit subjects, for example `Add dashboard preview loading state`. PRs should include a concise summary, linked issue or task, manual verification steps, and screenshots for visible UI changes. Call out any changes to prompts, schema shape, or environment variables explicitly.

## Security & Configuration Tips
Do not commit `.env*.local`, secrets, or generated output from `.next/` and `node_modules/`. Avoid hardcoding gateway URLs; read them from environment variables instead.

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
- For durable agent loops or untrusted code: use Workflow (pause/resume/state) + Sandbox; use Vercel MCP for secure infra access
<!-- VERCEL BEST PRACTICES END -->
