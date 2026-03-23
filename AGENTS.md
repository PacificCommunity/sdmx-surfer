# Repository Guidelines

## Project Structure & Module Organization
This repository is a Next.js 16 + React 19 TypeScript app for an SDMX dashboard builder prototype. App routes live in `app/`, including the main pages and the chat API route at `app/api/chat/route.ts`. Reusable UI lives in `components/`, and shared types, prompt text, and example data live in `lib/`. Static assets belong in `public/`. Architecture and design references live in `dashboard-architecture.md`, `CLAUDE.md`, and `stitch_assets/`; treat those as supporting documentation, not runtime code.

## Build, Test, and Development Commands
- `npm run dev`: start the local Next.js dev server with Turbopack.
- `npm run build`: create a production build and catch type/app-router issues.
- `npm run start`: serve the production build locally.
- `npm run lint`: run the Next.js ESLint checks; this is the main automated gate today.

Use `.env.local` for local configuration such as `MCP_GATEWAY_URL`.

## Coding Style & Naming Conventions
Use TypeScript with `strict` mode and prefer the `@/` path alias for internal imports. Match the existing style: 2-space indentation, double quotes, semicolons, and small functional React components. Use PascalCase for component files and exports (`ChatPanel`), camelCase for helpers and variables (`getSystemPrompt`), and Next.js route conventions like `page.tsx`, `layout.tsx`, and `route.ts`. Keep Tailwind utility usage aligned with the design tokens defined in `app/globals.css`.

## Testing Guidelines
There is no committed automated test suite yet. Until one is added, run `npm run lint`, then manually verify the affected flow in `npm run dev`. For UI work, check both the landing page and `/builder`; for API work, exercise `app/api/chat/route.ts` against a working MCP gateway. If you add tests, prefer `*.test.ts` or `*.test.tsx` next to the code they cover.

## Commit & Pull Request Guidelines
Git history is not available in this workspace snapshot, so no local commit convention can be inferred. Use short imperative commit subjects, for example `Add dashboard preview loading state`. PRs should include a concise summary, linked issue or task, manual verification steps, and screenshots for visible UI changes. Call out any changes to prompts, schema shape, or environment variables explicitly.

## Security & Configuration Tips
Do not commit `.env*.local`, secrets, or generated output from `.next/` and `node_modules/`. Avoid hardcoding gateway URLs; read them from environment variables instead.
