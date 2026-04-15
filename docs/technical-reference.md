# Technical Reference — SPC Conversational Dashboard Builder

**Version:** 0.2.1 (Pilot Deployment)
**Last updated:** April 2026

> Current-state note: for the implemented route model, access rights, publication model, and public/private data boundaries, read `docs/current-architecture.md` first. This file covers lower-level technical internals (module-by-module reference, schemas, patches, deployment) and should be read alongside the current-architecture doc, not instead of it.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Module Reference](#3-module-reference)
4. [Agent Loop Architecture](#4-agent-loop-architecture)
5. [Context Architecture (Three-Tier)](#5-context-architecture)
6. [Dashboard Config Schema](#6-dashboard-config-schema)
7. [Dashboard Authoring Schema](#7-dashboard-authoring-schema)
8. [UI Architecture](#8-ui-architecture)
9. [Authentication](#9-authentication)
10. [Model Routing and BYOK](#10-model-routing-and-byok)
11. [BYOK Key Security](#11-byok-key-security)
12. [Session Management](#12-session-management)
13. [Logging and Observability](#13-logging-and-observability)
14. [Export System](#14-export-system)
15. [Error Handling Strategy](#15-error-handling-strategy)
16. [Design System Implementation](#16-design-system-implementation)
17. [Library Patches and Workarounds](#17-library-patches-and-workarounds)
18. [Multi-User Architecture](#18-multi-user-architecture)
19. [Deployment Architecture](#19-deployment-architecture)
20. [Known Limitations](#20-known-limitations)

---

## 1. System Overview

The SPC Conversational Dashboard Builder is a web application that lets users create SDMX statistical dashboards through natural-language conversation with an AI agent.

The system connects three existing components:

- **sdmx-mcp-gateway** — a Python MCP (Model Context Protocol) server providing 18+ tools for progressive SDMX data discovery on SPC's .Stat platform
- **sdmx-dashboard-components** — an npm library (currently `^0.4.6` in this repo) that renders dashboards from JSON configs using Highcharts, OpenLayers, and React
- **AI SDK v6** — Vercel's TypeScript framework for building AI applications, providing the streaming chat interface and tool orchestration

The **new piece** built in this repository is the agent loop + chat UI + live preview that connects these three, plus a full pilot deployment stack: authentication, database persistence, multi-model support, and an admin interface.

### Key Design Principle

The AI agent produces **JSON configs, not code**. The preferred output is the simplified **authoring schema** (`kpi`, `chart`, `map`, `note` intent visuals), which is compiled server-side into the native `sdmx-dashboard-components` config. Native passthrough remains available for advanced cases. The agent never generates JavaScript, HTML, or CSS — it only produces data configurations that the existing library renders.

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.1 |
| Runtime | React | 19.2.4 |
| Language | TypeScript | 5.9.3 |
| AI | AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/mcp`, `@ai-sdk/react`) | 6.0.134 |
| LLM (default) | Gemini 3 Flash (free tier) | gemini-3-flash-preview |
| LLM (BYOK) | Anthropic, OpenAI, Google | user-configurable |
| MCP | HTTP transport to gateway | configurable via `MCP_GATEWAY_URL` |
| Dashboard | sdmx-dashboard-components | ^0.4.6 |
| Charts | Highcharts | 11.4.8 |
| Auth | NextAuth v4 with Resend magic links | 4.24.13 |
| Database | Vercel Postgres (Neon) + Drizzle ORM | 0.10.0 / 0.45.1 |
| Styling | Tailwind CSS v4 + custom CSS properties | 4.2.2 |
| Embeddings | granite-embedding-small-r2 via ONNX Runtime | @huggingface/transformers 3.8.1 |
| Export | html2canvas + jsPDF | 1.4.1 / 4.2.1 |
| Markdown | react-markdown | 10.1.0 |

### Why these choices

- **AI SDK v6** over LangChain/LangGraph: single-language stack (TypeScript throughout), native streaming to React, first-class MCP client support, Anthropic prompt caching built in.
- **Gemini 3 Flash as free-tier default**: provides a zero-cost entry point for authenticated users without a BYOK key. Users who add their own Anthropic, OpenAI, or Google API key immediately unlock their preferred model.
- **NextAuth v4** over Auth.js v5: v4 is stable and battle-tested. The App Router compatibility shim (`{ GET, POST }` from the handler) works cleanly. v5 migration can follow once it reaches GA.
- **Drizzle ORM**: lightweight, type-safe, no runtime overhead. Paired with `@vercel/postgres` for the managed Neon connection pool on Vercel.
- **Next.js 16 App Router**: server-side API route for the agent loop (keeps API keys server-side), client-side rendering for the dashboard (SDMXDashboard fetches data from .Stat directly).
- **Tailwind v4**: CSS-first approach with `@theme` blocks for design tokens — no JavaScript config file needed.

---

## 3. Module Reference

### `app/api/chat/route.ts` — Agent Loop

The core server-side module. Handles POST requests from the chat client.

**Request flow:**
1. Authenticate via `auth()` (NextAuth session check); return 401 if not logged in
2. Parse request body (Zod-validated `{ messages, previewError?, modelOverride? }`)
3. Read `x-session-id` header for logging
4. Resolve model via `getModelForUser(userId, modelOverride)` from `lib/model-router.ts`
5. Connect to MCP gateway (per-request client via `createMCPClient`)
6. Convert UI messages to model messages via `convertToModelMessages()`
7. Extract Tier 2 knowledge from conversation history
8. Build system prompt (Tier 1 static + Tier 2 dynamic + optional preview repair context)
9. Call `streamText()` with the resolved model, MCP tools, and `update_dashboard`
10. Return streaming SSE response via `toUIMessageStreamResponse()`

**Key mechanisms:**

- **Per-request MCP client:** Each request creates a fresh `MCPClient` instance via `createMCPClient`. The client is closed in `onFinish` (or on error). This is safe for multi-user because there is no shared module-level singleton.
- **`update_dashboard` tool:** Custom tool intercepted by the agent loop (not forwarded to MCP). Accepts either a simplified authoring config or a native config. The authoring config is compiled to native via `compileDashboardToolConfig()` before being returned in the tool output for the client to extract.
- **Step budget:** `stopWhen: stepCountIs(25)` limits total steps. `prepareStep` at step 18+ injects an urgent system message telling the AI to emit a draft dashboard immediately.
- **Prompt caching:** `providerOptions.anthropic.cacheControl` marks the system prompt for Anthropic's native ephemeral caching (~90% cost reduction on the cached prefix for subsequent messages in the same session). Only active when the resolved model is an Anthropic model.

**Zod schemas consumed here:**
- `chatRequestSchema` — `{ messages, previewError?, modelOverride? }`
- `dashboardToolConfigSchema` — union of authoring schema and native schema (from `lib/dashboard-authoring.ts`)

### `app/builder/page.tsx` — Main Page

Client component managing the entire builder UI.

**State:**
- `sessionId` — current session identifier
- `configHistory` — undo/redo stack via `useConfigHistory` hook
- `messages` / `status` / `sendMessage` / `setMessages` — from `useChat`

**Key patterns:**
- **Stable transport:** `DefaultChatTransport` created once in a `useRef`, with `prepareSendMessagesRequest` reading session ID from a ref (avoids recreating transport on session change).
- **Config extraction:** `extractDashboardConfig()` walks messages in reverse, finding the latest `update_dashboard` tool output with `state === "output-available"`.
- **Message sync:** `syncDashboardConfigIntoMessages()` patches the latest `update_dashboard` tool output when the user edits config manually via the JSON tab or undo/redo.
- **Stable callbacks:** All callbacks passed to child components use refs internally to avoid breaking `React.memo` on `DashboardPreview`.
- **Session persistence:** `useEffect` debounces saves to the DB via `/api/sessions` (1.5s) on every messages/config change.
- **Model picker:** A `modelOverride` state (`{ provider, model }`) is sent with every request in the `prepareSendMessagesRequest` body, letting users switch models per chat without restarting.

### `components/dashboard-preview.tsx` — Preview + Editor

The largest client component (~800+ lines). Manages:

**Tabs:**
- **Preview** — dynamic import of `SDMXDashboard` with error boundary and loading skeleton
- **JSON** — syntax-highlighted editor with line numbers, edit/apply/reset workflow

**Sub-components:**
- `DashboardErrorBoundary` — React error boundary catching render failures
- `JsonEditor` — layered `pre` (highlighted) + `textarea` (editable) with synchronized scroll
- `DashboardSkeleton` — shimmer animation matching the config's grid layout
- `highlightJson()` — tokenizer producing colored spans for keys, strings, numbers, booleans

**Error handling:**
- Highcharts `displayError` interceptor prevents error #14 (string data) from throwing
- `unhandledrejection` listener catches async fetch failures from `sdmx-json-parser`
- Errors deduplicated and debounced (2s) before reporting to parent

**Export dropdown:** PDF, HTML (static), HTML (live), JSON — each with descriptive label and icon.

**Undo/redo buttons** in the header bar alongside the tab switcher.

### `components/chat-panel.tsx` — Chat Interface

- Message list with auto-scroll
- Suggestion buttons (Population, Trade, Health)
- Textarea input with Enter-to-send (Shift+Enter for newline)
- Streaming indicator (bouncing dots in secondary-container teal)
- Error display for failed submissions

### `components/message-bubble.tsx` — Message Rendering

- **User messages:** ocean-gradient background, right-aligned
- **AI messages:** secondary-container (#8aeff9) with avatar, "AI NAVIGATOR" label
- **Tool call indicators:** labeled pills with pulse animation → checkmark on completion
- **Markdown rendering:** custom `MarkdownContent` with table parser, code blocks, lists, links

### `lib/system-prompt.ts` — AI System Prompt

~15K tokens total (with examples). Structured as:

1. **Role definition** — "You are conversational and collaborative"
2. **Conversation strategy** — propose first, build incrementally, ask when ambiguous, offer next steps, pacing rule (max 5-6 tool calls between user interactions)
3. **Config schema documentation** — JSON structure with critical rules; documents the authoring schema (intent visuals) as the preferred output format
4. **Probe workflow** — agent must call `probe_data_url` before emitting a dashboard; probe shape drives viz type guidance (e.g., single-observation → KPI, time-series → line chart, cross-section → bar/column)
5. **Progressive discovery workflow** — list → structure → codes → probe → build URL
6. **SDMX conventions** — base URL, common dimensions, key syntax
7. **Example configs** — three working dashboards (few-shot)
8. **Tool instructions** — always use `update_dashboard`, handle errors

### `lib/types.ts` — TypeScript Types

Interfaces matching the `sdmx-dashboard-components` contract currently used by this app (`^0.4.6` dependency, with a local compatibility patch):
- `SDMXTextConfig` — text with optional styling
- `SDMXDashboardConfig` — root config
- `SDMXDashboardRow` — container for columns (note: uses `columns`, not `colums` from the library's buggy type defs)
- `SDMXVisualConfig` — chart/map/value with all Highcharts options
- `SDMXComponentType` — union of 10 chart types

### `lib/session.ts` — Session Client

Database-backed session management (replaced the old localStorage implementation). All operations call the `/api/sessions` REST API routes:
- `saveSession()` — POST to create if the session is not yet known locally, otherwise PUT to update
- `loadSession(id?)` — GET by id, or GET list and return the most recent
- `listSessions()` — GET `/api/sessions`, returns `SessionSummary[]`
- `deleteSession(id)` — DELETE `/api/sessions/[id]`
- Session ID: 16-char hex from `crypto.getRandomValues`

The `SessionData` interface now includes publication metadata (`publishedAt`, `publicTitle`, `publicDescription`, `authorDisplayName`) in addition to the session editing state. The storage backend switched from `localStorage` to PostgreSQL.

### `lib/model-router.ts` — Model Resolution

Resolves which LLM model to use per request. See [Section 10](#10-model-routing-and-byok) for full details.

### `lib/encryption.ts` — BYOK Key Encryption

AES-256-GCM encryption for BYOK API keys at rest. See [Section 11](#11-byok-key-security) for full details.

### `lib/csrf.ts` — CSRF Protection

Origin-header check for mutating API routes:
- Reads the `Origin` header from the incoming request
- Compares against `new URL(NEXTAUTH_URL).origin`
- Returns `null` (OK) or a `Response` with status 403
- Allows requests with no `Origin` (same-origin fetch, curl, server-side)

### `lib/mcp-client.ts` — MCP Client Factory

Per-request MCP client utilities:
- `withMCPClient(fn)` — creates a fresh `MCPClient`, runs `fn(client)`, closes the client afterward (safe for multi-user; no shared singleton)
- `mcpTransportConfig()` — builds the HTTP transport config from `MCP_GATEWAY_URL` and optional `MCP_AUTH_TOKEN` Bearer header
- `callMcpTool(client, toolName, args)` — convenience wrapper that unwraps the MCP response envelope

### `lib/auth.ts` — NextAuth Configuration

NextAuth v4 configuration. See [Section 9](#9-authentication) for full details.

### `lib/db/schema.ts` — Database Schema

Drizzle ORM table definitions. See [Section 18](#18-multi-user-architecture) for the full schema.

### `lib/dashboard-authoring.ts` — Authoring Schema Compiler

Intent-based authoring schema and server-side compiler. See [Section 7](#7-dashboard-authoring-schema) for full details.

### `lib/logger.ts` — Request Logging

Database-backed logging (replaced the old JSONL file rotation):
- `createRequestLogger(userId, sessionId)` — returns a logger bound to a request
- Methods: `setUserMessage()`, `setModelInfo()`, `recordToolCall()`, `recordError()`, `setAiResponse()`
- `flush(tokenUsage?)` — inserts one row into `usage_logs` via Drizzle; never throws (all errors are console-warned)
- Fields: `userId`, `sessionId`, `requestId`, `userMessage`, `aiResponse`, `toolCalls[]`, `dashboardConfigIds[]`, `errors[]`, `inputTokens`, `outputTokens`, `durationMs`, `stepCount`, `model`, `provider`

### `lib/use-config-history.ts` — Undo/Redo Hook

Custom React hook maintaining a config version stack:
- Max 50 entries
- Deduplicates by JSON comparison
- `snapshot()` / `restore()` for serialization
- Internal refs + tick counter to minimize re-renders

### `lib/tier2-knowledge.ts` — Knowledge Extraction

Scans `ModelMessage[]` for MCP tool results:
- `list_dataflows` → dataflow names
- `get_dataflow_structure` → dimension IDs
- `get_dimension_codes` → code counts per dimension
- `build_data_url` → built URLs

Formats as "Session Knowledge" markdown block (~200-500 tokens) appended to the system prompt. Tells the AI "do NOT re-query these."

### `lib/dashboard-examples.ts` — Few-Shot Examples

Three working dashboard configs using real .Stat URLs:
1. Population bar chart (DF_POP_PROJ)
2. Trade line chart (DF_IMTS, Fiji+Samoa+Tonga)
3. KPI + column chart (3-column grid)

All URLs include `dimensionAtObservation=AllDimensions`.

### `lib/export-dashboard.ts` — Export Functions

Four export modes:
- `exportToPdf()` — SVG→canvas conversion, html2canvas at 2x, jsPDF
- `exportToHtml()` — captures live DOM innerHTML + inlined CSS from stylesheets
- `exportToHtmlLive()` — esm.sh import maps for interactive re-rendering
- `exportToJson()` — raw config download

### `proxy.ts` — Auth Middleware

Next.js middleware (`withAuth`) protecting all routes except the public surfaces and static assets. Unauthenticated requests to protected routes are redirected to `/login`.

Matcher exclusions:

- `/api/auth/**` — NextAuth endpoints
- `/api/public/**` — public dashboard read API
- `/_next/static`, `/_next/image`, `/favicon.ico`, `/models/**` — static assets and the ONNX model bundle
- `/login` — sign-in page
- `/gallery` — public listing of published dashboards
- `/p/**` — public presentation view for published dashboards

All other routes (including `/`, `/builder`, `/dashboard/[id]`, `/explore`, `/settings`, `/admin`, and the authenticated API routes under `/api/sessions`, `/api/chat`, `/api/admin`) require a signed-in session. See `docs/current-architecture.md` section 3 for the full access-rights model.

### `app/dashboard/[id]/page.tsx` — Private Presentation View

Authenticated, owner-scoped presentation of a single session's current dashboard. Loads the session via `loadSession(id)` from the owner-scoped session API, renders via `SDMXDashboard`, and exposes the full export dropdown (PDF / HTML static / HTML live / JSON). The header has an "Edit via Chat" button that routes back to `/builder?session={id}`. Not a public sharing surface — the equivalent public view is `/p/[id]`.

### `app/p/[id]/page.tsx` — Public Presentation View

Public, unauthenticated presentation view for a published dashboard. Reads from `/api/public/dashboards/[id]`, which only returns sessions where `published_at IS NOT NULL AND deleted_at IS NULL`, projected down to the public fields (id, public_title, public_description, author_display_name, published_at, current config). No chat, no edit controls, no session internals. Includes an "Explore this data" entry point that seeds a new builder session (fork flow — see current-architecture.md section 4.4).

### `app/gallery/page.tsx` — Public Gallery

Public listing of all published dashboards. Backed by `GET /api/public/dashboards`, returns only the public summary fields. Excludes soft-deleted and unpublished sessions at the API layer.

### `app/api/sessions/[id]/publish/route.ts` — Publish / Unpublish

Owner-only mutating endpoint that toggles a session between private and public. Sets `published_at`, `public_title`, `public_description`, and `author_display_name` on publish; clears `published_at` on unpublish. CSRF-checked.

### `app/api/public/dashboards/route.ts` and `app/api/public/dashboards/[id]/route.ts` — Public Read API

Unauthenticated read-only endpoints serving the gallery and the public presentation view. Both filter on `published_at IS NOT NULL AND deleted_at IS NULL` and return only the public projection (never messages, config_history, or owner email).

### `app/api/admin/invites/route.ts`, `app/api/admin/users/route.ts`, `app/api/admin/published-dashboards/route.ts` — Admin API

Admin-only (require `session.user.role === "admin"`) endpoints backing `/admin`: invite allowlist management, user list with usage stats, and moderation view over published dashboards (including the ability to unpublish on behalf of a user).

### `lib/endpoints-registry.ts` — SDMX Endpoint Registry

Single source of truth mapping each supported SDMX endpoint (SPC, OECD, UNICEF, IMF, ECB, ESTAT, ILO, ABS, BIS, FBOS, SBS) to a display name, API host(s), and an optional Data Explorer deep-link builder. Exports `detectEndpoint(apiUrl)` used by the data-source table and PDF export to resolve which endpoint served each component's data. Endpoints without a Data Explorer (UNICEF, IMF, ECB) are API-only.

### `lib/data-explorer-url.ts` — Data Source Extraction

Walks a dashboard config and produces a flat `DataSource[]` list with per-component metadata: component id and title, dataflow name, endpoint key / name / short name, API URL, and an optional Data Explorer URL. Handles the compound data string used by map components (`{apiUrl}, {GEO_PICT} | {geoJsonUrl}, ...`) via `extractSdmxUrl()`, so the map's GeoJSON reference is never mistaken for an SDMX URL.

### `lib/dashboard-text.ts` — Dashboard Text Helpers

Shared helpers that extract the current title and subtitle from either an authoring or native dashboard config, used by the private view, public view, and builder header to keep header text consistent across surfaces.

### `lib/use-highcharts-viewport-reflow.ts` — Highcharts Reflow Hook

Custom React hook that observes the layout-driving container via `ResizeObserver` (the parent scroll shell when present, otherwise the root itself), plus `window.resize` and `window.visualViewport.resize`, and calls `chart.reflow()` on every live Highcharts instance after a debounced measure change. Used by all three rendering surfaces (`/builder` preview, `/dashboard/[id]`, `/p/[id]`) so charts track window resize and browser zoom.

### `lib/brand-theme.ts` — Design Tokens

Oceanic Data-Scapes color palette and typography exports consumed by PDF export, HTML export, and other non-Tailwind render paths that need the brand tokens at runtime.

### `lib/dataflow-names.ts` — Dataflow Name Cache

Cached lookup for human-readable dataflow names, used by the data-source extraction and export paths.

### `lib/embeddings.ts` — Semantic Search Embeddings

Client-side ONNX inference wrapper around `granite-embedding-small-r2` used by `/explore` for semantic dataflow search. See Section 19 (Deployment) for the build-time index.

### `lib/sanitize-messages.ts` — Message Sanitization

Strips message fields that must not be echoed into system prompts or logs (e.g. raw tool-output payloads beyond configured size limits).

### `app/explore/page.tsx` and `app/explore/[id]/page.tsx` — Data Catalogue

- `/explore` — lists all dataflows from the MCP gateway with keyword search and country filter. Semantic search uses the granite-embedding-small-r2 ONNX model to rank results by query similarity.
- `/explore/[id]` — drills into a single dataflow, showing dimensions, code lists, and data availability.

### `app/admin/page.tsx` — Admin Interface

Protected to users with `role === "admin"`. Features:
- Invite management: add emails to the `allowed_emails` allowlist, remove pending invites
- User list: see all users, their request count, total tokens consumed, and session count
- Role toggle: promote/demote users between `user` and `admin`

### `app/settings/page.tsx` — User Settings

BYOK key management per provider:
- Add or update API keys for Anthropic, OpenAI, or Google
- Keys are encrypted client-side–to–server and stored encrypted in `user_api_keys`
- Users can also set a model preference per provider

### `app/login/page.tsx` — Login Page

Magic link authentication flow:
- Email input form that calls `/api/auth/signin/email`
- After submission, shows a "Check your email" confirmation
- In development (no `RESEND_API_KEY`), the magic link is printed to the server console

---

## 4. Agent Loop Architecture

### Tool orchestration

The agent has access to ~20 tools:
- **18+ MCP tools** from sdmx-mcp-gateway (discovered dynamically via `mcpClient.tools()`)
- **1 custom tool:** `update_dashboard` (intercepted by the route handler)

The MCP tools are "dynamic" tools in AI SDK v6 terms — their schemas come from the MCP server at runtime. The `update_dashboard` tool is a "static" tool defined inline with a Zod schema.

### Progressive discovery workflow

```
list_dataflows("population")
  → DF_POP_PROJ: "Population projections"

get_dataflow_structure("DF_POP_PROJ")
  → dimensions: FREQ, GEO_PICT, INDICATOR, SEX, AGE

get_dimension_codes("DF_POP_PROJ", "GEO_PICT")
  → FJ, WS, TO, PG, ... (22 codes)

build_data_url("DF_POP_PROJ", filters: {FREQ: "A", ...})
  → https://stats-sdmx-disseminate.pacificdata.org/rest/data/DF_POP_PROJ/A..MIDYEARPOPEST._T._T?dimensionAtObservation=AllDimensions

probe_data_url(url)
  → { shape: "time-series", observationCount: 420, ... }
  → viz type guidance: "use line chart; xAxis=TIME_PERIOD"

update_dashboard({ config: { id: "pop", rows: [...] } })
  → dashboard rendered in preview
```

### Step budget management

- **Total limit:** 25 steps (`stepCountIs(25)`)
- **Nudge threshold:** Step 18 — if no `update_dashboard` has been called, the system prompt is augmented with an urgent message telling the AI to emit a draft immediately
- **Rationale:** Complex requests (multi-dataflow dashboards) can consume 15-20 discovery steps. The nudge ensures the user always sees something, even if incomplete.

### Streaming response

`streamText().toUIMessageStreamResponse()` produces an SSE stream with:
- `text-start` / `text-delta` / `text-end` — AI text output
- `tool-input-available` / `tool-output-available` — tool call lifecycle
- The client's `useChat` hook reconstructs `UIMessage[]` from these events

---

## 5. Context Architecture (Three-Tier)

### Tier 1: Cached System Prompt (~15K tokens)

Static content loaded once and cached via Anthropic's ephemeral prompt caching (active only for Anthropic BYOK users):
- Dashboard config schema documentation (authoring schema + native schema)
- Probe workflow instructions
- Progressive discovery workflow instructions
- SDMX conventions for SPC .Stat
- Three example dashboard configs
- Conversation strategy rules
- Tool usage guidelines

**Cache behavior:** First request in a session pays full input cost. Subsequent requests get ~90% discount on the cached prefix (Anthropic handles cache invalidation by content hash). Non-Anthropic models (Google, OpenAI) do not benefit from this caching.

### Tier 2: Session Knowledge (0-2K tokens)

Dynamic content extracted from conversation history:
- Explored dataflow names and dimension structures
- Dimension code counts
- Already-built data URLs

Injected into the system prompt on every request, after the Tier 1 content. Reduces redundant MCP calls when the user asks follow-up questions about the same data.

**Cache impact:** Tier 2 changes per turn, so the Anthropic cache covers Tier 1 only. Tier 2 is appended after the cacheable prefix.

### Tier 3: Per-Turn Context (variable)

The conversation messages themselves, including:
- User messages
- AI responses
- Tool call inputs and results (including full MCP response payloads)

This grows with the conversation. The large context windows of supported models provide ample room for multi-turn sessions.

---

## 6. Dashboard Config Schema

The `update_dashboard` tool accepts either the **authoring schema** (preferred, see Section 7) or the **native config** format conforming to the `sdmx-dashboard-components` contract used by this app (`^0.4.6` dependency):

```typescript
{
  id: string;                     // Unique identifier
  colCount?: number;              // Grid columns (default 3)
  header?: {
    title?: { text: string };
    subtitle?: { text: string };
  };
  rows: Array<{
    columns: Array<{
      id: string;
      type: "line" | "bar" | "column" | "pie" | "value" | "note" | "map" | ...;
      colSize?: number;           // Grid span
      title?: { text: string };
      xAxisConcept: string;       // SDMX dimension ID
      yAxisConcept?: string;      // Usually "OBS_VALUE"
      data: string | string[];    // SDMX REST URL(s)
      legend?: { concept: string; location: "top" | "bottom" | ... };
      labels?: boolean;
      download?: boolean;
      sortByValue?: "asc" | "desc";
      unit?: { text: string; location: "prefix" | "suffix" | "under" };
      decimals?: number;
    }>;
  }>;
}
```

### Critical schema rules

1. **`columns` not `colums`** — the library's TypeScript types have a typo (`colums`), but the compiled JavaScript expects `columns`
2. **`dimensionAtObservation=AllDimensions`** must be appended to every data URL — the library's parser requires flat observations; the authoring compiler does this automatically via `ensureAllDimensions()`
3. **`legend.concept` required for bar/column charts** — the library crashes with a null dereference if missing (patched but still recommended)
4. **Data URLs from `build_data_url` only** — the AI must never construct URLs manually

---

## 7. Dashboard Authoring Schema

The authoring schema is a simplified, intent-based layer that the agent uses to express dashboard visuals without needing to know the full native config structure. The server compiles it to the native format via `compileDashboardToolConfig()` in `lib/dashboard-authoring.ts`.

### Intent visual types

**`note`** — static text panel:
```json
{ "kind": "note", "id": "intro", "body": "Pacific population data" }
```

**`kpi`** — single value display:
```json
{
  "kind": "kpi", "id": "total_pop",
  "dataUrl": "https://...?dimensionAtObservation=AllDimensions",
  "unit": { "text": "M", "location": "suffix" },
  "decimals": 1
}
```

**`chart`** — data chart with explicit chart type:
```json
{
  "kind": "chart", "id": "pop_trend",
  "chartType": "line",
  "dataUrl": "https://...",
  "xAxis": "TIME_PERIOD",
  "seriesBy": "GEO_PICT"
}
```
Supported `chartType` values: `line`, `bar`, `column`, `pie`, `lollipop`, `treemap`, `drilldown`. For `bar`, `column`, `lollipop`, and `treemap`, `seriesBy` is required.

**`map`** — choropleth map with Pacific EEZ preset:
```json
{
  "kind": "map", "id": "pop_map",
  "dataUrl": "https://...",
  "geoDimension": "GEO_PICT",
  "geoPreset": "pacific-eez"
}
```

**`{ mode: "native", config: ... }`** — passthrough to native config for edge cases.

### Probe-driven viz selection

Before emitting a dashboard, the agent calls `probe_data_url` on each data URL. The probe result's `shape` field informs the recommended visualization:
- `"single-observation"` → `kpi`
- `"time-series"` → `line` chart with `xAxis: "TIME_PERIOD"`
- `"cross-section"` → `bar` or `column` chart
- `"multi-series"` → `line` chart with `seriesBy` set to the series dimension

### Compiler behavior

- `ensureAllDimensions(url)` — appends `?dimensionAtObservation=AllDimensions` if not already present
- `compileChart()` — validates `seriesBy` presence for bar-family charts; maps `xAxis`/`seriesBy` to `xAxisConcept`/`legend.concept`
- `compileMap()` — defaults to Pacific EEZ GeoJSON and EPSG:3832 projection; constructs the library's map data string format
- `isNativeDashboardConfig()` — detects whether the config uses native or authoring format (by checking for `type` fields in columns)

---

## 8. UI Architecture

### Layout

```
┌────────────────────────────────────────────────────────┐
│  Glass App Bar (glass-panel + shadow-ambient)          │
│  [logo] [session title]         [model picker] [user]  │
├───────────────┬────────────────────────────────────────┤
│               │                                        │
│  Chat Panel   │  Dashboard Preview                     │
│  420px fixed  │  flex-1                                │
│  bg-surface-  │  bg-surface                            │
│  low          │                                        │
│               │  ┌──────────────────────────────────┐  │
│  Messages     │  │  [Preview] [JSON] | Undo Redo    │  │
│  + Markdown   │  │  [Live]           | [Export v]   │  │
│               │  ├──────────────────────────────────┤  │
│               │  │                                  │  │
│  Suggestions  │  │  SDMXDashboard / JSON Editor     │  │
│               │  │                                  │  │
│  Input Area   │  │                                  │  │
│  + Send       │  └──────────────────────────────────┘  │
└───────────────┴────────────────────────────────────────┘
```

### State flow

```
useChat (messages, status, sendMessage)
    │
    ├── extractDashboardConfig(messages) ──→ configHistory.push()
    │                                              │
    │                                              ├── DashboardPreview (memo'd)
    │                                              │     ├── SDMXDashboard
    │                                              │     ├── JsonEditor
    │                                              │     └── Export dropdown
    │                                              │
    │                                              └── session.saveSession() → /api/sessions
    │
    ├── ChatPanel (messages, status, sendMessage)
    │
    └── Error feedback loop:
          DashboardPreview.onError
            → handlePreviewError
              → forwardPreviewError (when status === "ready")
                → sendMessage("[SYSTEM: error...]")
```

### Memo strategy

`DashboardPreview` is wrapped in `React.memo` to prevent re-renders during chat streaming. All callback props (`onConfigEdit`, `onUndo`, `onRedo`, `onError`) are stabilized via refs with empty dependency arrays.

---

## 9. Authentication

The app uses **NextAuth v4** with an email magic link provider backed by **Resend** for transactional email delivery.

### Flow

1. User visits any protected route → middleware (`proxy.ts`) redirects to `/login`
2. User enters their email address
3. NextAuth checks the email against the `allowed_emails` table via the `signIn` callback
4. If allowed, NextAuth generates a one-time token and calls `sendMagicLink()`
5. `sendMagicLink()` sends the link via the Resend SDK (or logs it to the console in development when `RESEND_API_KEY` is absent)
6. User clicks the link → NextAuth verifies the token, creates or retrieves the user in `auth_users`, issues a JWT session cookie
7. The JWT callback fetches `userId` and `role` from `auth_users` and stores them in the token
8. The session callback copies `userId` and `role` into the session object for downstream use

### Session strategy

JWT sessions (no database sessions table). `getServerSession(authOptions)` is called at the top of every protected API route handler via the `auth()` helper exported from `lib/auth.ts`.

### Role model

| Role | Access |
|------|--------|
| `user` | Builder, settings, explore, own sessions |
| `admin` | All of the above + `/admin` (invite management, user list, role toggle, usage stats) |

The role is stored in `auth_users.role` and propagated into every JWT/session token on sign-in.

### Invite allowlist

New users can only sign in if their email is in the `allowed_emails` table. Admins add emails via `/admin`. There is no self-registration.

### Environment variables required

| Variable | Purpose |
|----------|---------|
| `NEXTAUTH_URL` | Full URL of the deployed app (e.g., `https://dashboard.spc.int`) |
| `NEXTAUTH_SECRET` | JWT signing secret (generate with `openssl rand -base64 32`) |
| `RESEND_API_KEY` | Resend API key for magic link emails (optional in dev) |
| `EMAIL_FROM` | From address for magic link emails (e.g., `noreply@spc.int`) |

---

## 10. Model Routing and BYOK

`lib/model-router.ts` exports `getModelForUser(userId, override?)` which resolves the LLM model for each request.

### Resolution priority

1. **UI override with BYOK key** — if the user selected a specific provider+model in the model picker AND has a BYOK key for that provider, use it
2. **UI override with platform key (Google)** — if the user selected Google and no BYOK key is present, use the platform `GOOGLE_AI_API_KEY`
3. **Most recently updated BYOK key** — if no override, query `user_api_keys` for the user's keys ordered by `updated_at desc`, use the first valid one
4. **Platform free tier** — if no BYOK keys exist, use `GOOGLE_AI_API_KEY` with `gemini-3-flash-preview`
5. **Development fallback** — if no platform key either, use `ANTHROPIC_API_KEY` from the environment with `claude-sonnet-4-6`

### Default models per provider

| Provider | Default model |
|----------|--------------|
| `anthropic` | `claude-sonnet-4-6` |
| `openai` | `gpt-4.1-mini` |
| `google` | `gemini-3-flash-preview` |

Users can override the default via `model_preference` stored in `user_api_keys`.

### Prompt caching

Anthropic prompt caching (`providerOptions.anthropic.cacheControl`) is only added for Anthropic model configs. Google and OpenAI configs do not include this option.

### `ModelConfig` interface

```typescript
interface ModelConfig {
  model: LanguageModel;     // AI SDK model instance
  modelId: string;          // e.g. "claude-sonnet-4-6"
  providerId: string;       // "anthropic" | "openai" | "google"
  providerOptions?: ProviderOptions;  // Anthropic cache control if applicable
}
```

---

## 11. BYOK Key Security

`lib/encryption.ts` provides AES-256-GCM encryption for BYOK API keys stored in `user_api_keys`.

### Encryption scheme

- **Algorithm:** AES-256-GCM (authenticated encryption — provides both confidentiality and integrity)
- **IV:** 12 random bytes per encryption operation (GCM standard)
- **Auth tag:** 16 bytes (GCM standard)
- **Key derivation:** HMAC-SHA256 of `ENCRYPTION_SECRET` with per-provider salt `"byok-{provider}"` — equivalent to HKDF-Extract, providing domain separation between providers
- **Wire format:** `base64(iv || ciphertext || tag)` — all three concatenated and base64-encoded as a single string

### What is stored in the database

The `encrypted_key` column in `user_api_keys` contains only the base64-encoded ciphertext blob. The plaintext API key never touches the database. Decryption requires `ENCRYPTION_SECRET` from the server environment.

### Environment variable required

| Variable | Purpose |
|----------|---------|
| `ENCRYPTION_SECRET` | Master secret for key derivation (generate with `openssl rand -base64 32`) |

### Key rotation

If `ENCRYPTION_SECRET` is rotated, all existing `encrypted_key` values become unreadable. A migration script must re-encrypt existing keys with the new secret before rotating the environment variable.

---

## 12. Session Management

Sessions are persisted in PostgreSQL via the `dashboard_sessions` table. The `lib/session.ts` client talks to the `/api/sessions` REST API.

### `dashboard_sessions` table

```sql
id                   TEXT PRIMARY KEY   -- random hex id
user_id              TEXT NOT NULL      -- FK to auth_users.id
title                TEXT DEFAULT 'Untitled'
messages             JSONB DEFAULT []   -- UIMessage[] serialized
config_history       JSONB DEFAULT []   -- SDMXDashboardConfig[] undo stack
config_pointer       INTEGER DEFAULT -1
created_at           TIMESTAMP
updated_at           TIMESTAMP
deleted_at           TIMESTAMP          -- soft-delete marker (NULL = live)
published_at         TIMESTAMP          -- publication marker (NULL = private)
public_title         TEXT               -- public-facing title (publish-only)
public_description   TEXT               -- public description (publish-only)
author_display_name  TEXT               -- public author attribution
INDEX sessions_user_updated_idx ON (user_id, updated_at DESC)
```

The `deleted_at` and `published_at` fields encode the two main session state transitions:

- `deleted_at IS NULL` — live session
- `published_at IS NOT NULL AND deleted_at IS NULL` — publicly visible
- both public and private routes must exclude rows with `deleted_at IS NOT NULL`
- public APIs additionally require `published_at IS NOT NULL`

Publication is a state on the session, not a separate table. The public projection of a session returns only `id`, `public_title`, `public_description`, `author_display_name`, `published_at`, and the current dashboard config — never `messages`, `config_history`, or owner email. See `docs/current-architecture.md` sections 5–6 for the public/private boundary and the owner/admin/public authorization model.

### API routes

| Method | Path | Description |
|--------|------|-------------|
| GET | `/api/sessions` | List user's sessions (summary: id, title, updatedAt) |
| POST | `/api/sessions` | Create a new session |
| GET | `/api/sessions/[id]` | Get full session data (owner-scoped) |
| PUT | `/api/sessions/[id]` | Update session (messages, config, title) |
| DELETE | `/api/sessions/[id]` | Soft-delete session (sets `deleted_at`) |
| POST | `/api/sessions/[id]/publish` | Publish a session and set public metadata (owner-only) |
| DELETE | `/api/sessions/[id]/publish` | Unpublish a session (owner-only) |
| GET | `/api/public/dashboards` | Public list of published dashboards (gallery backing) |
| GET | `/api/public/dashboards/[id]` | Public read of one published dashboard |

All `/api/sessions/*` routes require authentication and scope queries to the authenticated user's `userId`. Cross-user access is filtered out at query time and returns 404 rather than exposing the existence of another user's session. The `/api/public/dashboards*` routes are unauthenticated and only return the public projection of sessions where `published_at IS NOT NULL AND deleted_at IS NULL`.

### Client behavior

- `saveSession()` tries POST first for sessions not yet known client-side; if the session already exists it falls through to PUT
- Network or server errors are silently swallowed — the same graceful-degradation approach as the former localStorage version
- Save is debounced at 1.5 seconds after the last change

---

## 13. Logging and Observability

Logs are stored in the `usage_logs` PostgreSQL table (replaced the former JSONL file rotation).

### `usage_logs` table

```sql
id            SERIAL PRIMARY KEY
user_id       TEXT NOT NULL      -- FK to auth_users.id
session_id    TEXT               -- FK to dashboard_sessions.id (nullable)
request_id    TEXT NOT NULL      -- random per-request ID
user_message  TEXT               -- truncated to 500 chars
ai_response   TEXT               -- truncated to 1000 chars
tool_calls    JSONB DEFAULT []   -- array of {name, args, resultPreview, stepNumber}
dashboard_config_ids TEXT[]      -- IDs of dashboards emitted this turn
errors        TEXT[]             -- errors encountered this turn
input_tokens  INTEGER
output_tokens INTEGER
duration_ms   INTEGER
step_count    INTEGER
model         TEXT               -- model ID used (e.g. "claude-sonnet-4-6")
provider      TEXT               -- provider ID (e.g. "anthropic")
created_at    TIMESTAMP
INDEX logs_user_created_idx ON (user_id, created_at DESC)
```

### What to look for

- **High step counts** with no `update_dashboard` → agent stuck in discovery loops
- **Repeated tool calls** for the same dataflow → Tier 2 knowledge not working
- **Errors with auto-fix messages** → library compatibility issues
- **Token usage by model/provider** → cost tracking by model type
- **Per-user token totals** → displayed in the admin panel

### Admin access to logs

The `/admin` page aggregates usage data per user (request count, total tokens, session count) by querying `usage_logs`. Raw log rows are accessible directly via the database for deeper analysis.

---

## 14. Export System

### PDF Export

1. Find all `<svg>` elements in the dashboard DOM (Highcharts charts)
2. For each SVG: serialize via `XMLSerializer`, draw onto a 2x canvas via `Image.onload`
3. Replace SVG elements with canvas elements in the DOM
4. Run `html2canvas` on the container element
5. Create `jsPDF` document sized to the canvas
6. Restore original SVG elements
7. If the config references SDMX data sources, append a **Data Sources page** rendered natively with jsPDF (not via html2canvas)

The SVG-to-canvas step is necessary because `html2canvas` cannot rasterize SVG directly.

#### Data Sources page

The appended page is generated via `extractDataSources(config)` (in `lib/data-explorer-url.ts`) and rendered with jsPDF text/line primitives. It contains:

- a heading and subtitle
- a five-column table: **Component**, **Dataflow**, **Source**, **Type**, **Links**
- per-row clickable **API** and **Data Explorer** URLs (where the endpoint registry supports a Data Explorer deep link)
- a footer crediting the distinct endpoint names contributing data to the dashboard

The endpoint registry that powers the Source column and Data Explorer link generation lives in `lib/endpoints-registry.ts`.

### Static HTML Export

1. Capture `element.innerHTML` (includes rendered Highcharts SVGs)
2. Walk all loaded `CSSStyleSheet`s, collecting rules that match elements in the dashboard
3. Combine into a self-contained HTML document with inlined CSS
4. Include Google Fonts links (online) with system font fallbacks
5. Add "Show/hide JSON config" toggle at the bottom

### Live HTML Export

1. Embed the dashboard config as inline JSON
2. Use `<script type="importmap">` mapping `react` and `react-dom` to esm.sh CDN URLs
3. Import `sdmx-dashboard-components` from esm.sh with `?deps=react@19,react-dom@19`
4. `createRoot().render(createElement(SDMXDashboard, { config, lang: 'en' }))`
5. Requires HTTP server (not `file://`) due to ES module import restrictions

---

## 15. Error Handling Strategy

### Highcharts errors

Highcharts fires a `displayError` event before throwing. We install a global listener that calls `event.preventDefault()` to suppress the throw, converting errors into console warnings. This prevents error #14 (string data in numeric chart) and similar issues from crashing the app.

### SDMX fetch errors

`sdmx-json-parser` throws "Series not found and observations empty" in a Promise chain that the dashboard component doesn't catch. We listen for `unhandledrejection` on the window, filter for SDMX/Highcharts-related error messages, call `event.preventDefault()` to suppress the dev overlay, and forward to the error reporter.

### Error feedback loop

```
SDMXDashboard render error
  → DashboardErrorBoundary.componentDidCatch()
    → reportError(msg)

OR

Unhandled promise rejection (fetch failure)
  → window.unhandledrejection handler
    → reportError(msg)

reportError(msg):
  → deduplicate via Set
  → debounce 2 seconds
  → onError(allErrors.join("; "))
    → handlePreviewError (builder page)
      → wait for status === "ready"
        → sendMessage("[SYSTEM: error: ...]")
          → AI receives error, fixes config, calls update_dashboard again
```

### Library patch

`sdmx-dashboard-components` has a null dereference bug when `getActiveDimensions()` returns fewer dimensions than expected (e.g., single-dimension queries). The local patch file remains named `patches/sdmx-dashboard-components+0.4.5.patch`, but the dependency currently resolves from `^0.4.6` in this repo. The patch adds a null-guard that logs a warning and skips series construction instead of crashing.

---

## 16. Design System Implementation

Based on the **Oceanic Data-Scapes** spec (`stitch_assets/stitch/oceanic_logic/DESIGN.md`).

### Color tokens

| Token | Hex | Usage |
|-------|-----|-------|
| `primary` | #004467 | CTAs, primary elements (Deep Sea) |
| `primary-container` | #005c8a | Gradient target |
| `secondary` | #006970 | AI avatar, accents (Reef Teal) |
| `secondary-container` | #8aeff9 | AI message bubbles |
| `tertiary` | #244445 | Kelp accents |
| `tertiary-fixed` | #c6e9e9 | Preview badge |
| `surface` | #f7fafc | Base background |
| `surface-low` | #f1f4f6 | Chat panel, sidebars |
| `surface-card` | #ffffff | Cards, inputs |
| `surface-high` | #e5e9eb | Active overlays, table headers |
| `on-surface` | #181c1e | Primary text (never pure black) |
| `outline-variant` | #c0c7d0 | Ghost borders at 20% opacity |

### Typography

| Class | Font | Size | Weight | Usage |
|-------|------|------|--------|-------|
| `type-display-lg` | Manrope | 3.5rem | 800 | Hero stats |
| `type-headline-sm` | Manrope | 1.25rem | 700 | Section titles |
| `type-label-md` | Inter | 0.6875rem | 700 uppercase | Badges, labels |
| `type-body-sm` | Inter | 0.75rem | 400 | Data tables |

### Key rules

- **No 1px borders:** Use tonal surface shifts (`bg-surface-low` vs `bg-surface`) or `ghost-border` (outline-variant at 20% opacity)
- **Ambient shadow:** `0 12px 40px rgba(24,28,30,0.06)` for floating elements
- **Glassmorphism:** `background: rgba(255,255,255,0.85); backdrop-filter: blur(20px)` for the app bar
- **Ocean gradient:** `linear-gradient(135deg, #004467, #005c8a)` for primary CTAs (Send button, logo)
- **Corner radius:** minimum `0.5rem`; pills use `border-radius: 9999px`
- **Submerged overlay:** `surface-tint` (#146492) at 5% opacity for empty states

---

## 17. Library Patches and Workarounds

### sdmx-dashboard-components compatibility patch

**Dependency:** `sdmx-dashboard-components@^0.4.6`  
**Patch file:** `patches/sdmx-dashboard-components+0.4.5.patch`
**Issue:** Null dereference when `getActiveDimensions()` returns fewer dimensions than expected for bar/column/lollipop/treemap charts.
**Fix:** Added null-guard before `Y.values.sort(...)` — skips series construction with a console warning instead of crashing.

### Highcharts error interception

**Issue:** Highcharts throws `Error("Highcharts error #14")` synchronously during render when data contains string values where numbers are expected.
**Fix:** Global `displayError` event listener on the Highcharts object, installed during dynamic import. Calls `e.preventDefault()` to suppress the throw.

### `columns` vs `colums` type mismatch

**Issue:** The library's TypeScript type definitions use `colums` (typo), but the compiled JavaScript runtime uses `columns` (correct spelling).
**Fix:** All code in this project uses `columns`. The TypeScript types in `lib/types.ts` use the correct spelling.

### `dimensionAtObservation=AllDimensions`

**Issue:** Without this query parameter, the SDMX API returns data in series format. The library's `getActiveDimensions()` in `sdmx-json-parser` doesn't correctly identify active dimensions in series format, leading to crashes.
**Fix:** The authoring compiler's `ensureAllDimensions()` appends this parameter automatically to every data URL. The MCP gateway's `build_data_url` also includes it by default. The system prompt instructs the AI to always use `build_data_url` rather than constructing URLs manually.

---

## 18. Multi-User Architecture

The pilot deployment implements a full multi-user architecture. What was previously documented as a planned migration is now the production state.

### Production multi-user model

| Concern | Implementation |
|---------|---------------|
| Authentication | NextAuth v4 magic links; email allowlist enforced at sign-in |
| Session storage | PostgreSQL `dashboard_sessions`; all queries scoped to `user_id` |
| Logging | PostgreSQL `usage_logs`; every row has `user_id` |
| API keys | Platform Google key for free tier; BYOK per user, AES-256-GCM encrypted at rest |
| Model selection | Per-user BYOK keys + UI model picker; falls back to free-tier Google |
| MCP gateway | Per-request `MCPClient` (no shared singleton) |
| CSRF protection | Origin-header check on all mutating routes (`lib/csrf.ts`) |
| Route protection | `proxy.ts` middleware redirects unauthenticated users to `/login` |

### Database schema summary

```
auth_users            — user accounts (id, email, name, role, emailVerified)
auth_accounts         — OAuth provider accounts (future use)
auth_verification_tokens — NextAuth magic link tokens
allowed_emails        — invite allowlist (email, invited_by)
dashboard_sessions    — chat sessions (messages, config_history, user_id)
usage_logs            — per-request AI usage (tokens, model, provider, user_id)
user_api_keys         — BYOK keys (encrypted_key, provider, model_preference, user_id)
```

### Security properties

| Threat | Mitigation |
|--------|-----------|
| Unauthenticated access | Middleware redirects all non-auth routes; API routes check `auth()` and return 401 |
| Cross-user data access | DB queries always include `WHERE user_id = $userId`; 403 returned on mismatch |
| BYOK key exposure | AES-256-GCM encryption at rest; plaintext never written to DB or logs |
| CSRF attacks | Origin-header check on all mutating API routes |
| Prompt injection | System prompt instructs AI to produce only JSON configs; `update_dashboard` Zod schema validates output |
| API key exposure | All AI API keys are server-side only; the API route is the sole proxy |
| Session hijacking | HttpOnly JWT session cookies via NextAuth; session IDs are cryptographic random |

### What remains for Phase 3

- **SPC SSO integration** — currently using magic links; SPC OAuth 2.0 / SAML SSO would allow single sign-on with SPC credentials
- **Rate limiting** — per-user token budgets and request throttling (currently no per-user limits)
- **Institutional curation** — the public gallery exists; editorial review / featured-dashboard workflow does not
- **Per-user MCP state** — the MCP gateway already supports per-session state; wiring this to user auth context is a future step
- **Query whitelisting** — restricting which SDMX dataflows each user can access

Public dashboards and the public gallery itself are no longer Phase 3 items — they are implemented and documented in `docs/current-architecture.md` (publication flow and gallery model).

---

## 19. Deployment Architecture

### Services

| Service | Platform | Notes |
|---------|----------|-------|
| Next.js app | Vercel | App Router; `maxDuration = 300` requires Vercel Pro |
| PostgreSQL database | Vercel Postgres (Neon) | Connection pooling via `@vercel/postgres` |
| MCP gateway | Railway | Docker container from `sdmx-mcp-gateway` repo |
| Email delivery | Resend | Transactional magic link emails |

### Vercel configuration

The agent loop route sets `export const maxDuration = 300` — this is a 5-minute timeout to accommodate long multi-step discovery workflows. Vercel Pro or Enterprise is required for `maxDuration > 60`.

Vercel environment variables required for production:

```
NEXTAUTH_URL=https://your-app.vercel.app
NEXTAUTH_SECRET=<openssl rand -base64 32>
POSTGRES_URL=<from Vercel Postgres dashboard>
GOOGLE_AI_API_KEY=<platform free-tier key>
RESEND_API_KEY=<from resend.com>
EMAIL_FROM=noreply@yourdomain.com
ENCRYPTION_SECRET=<openssl rand -base64 32>
MCP_GATEWAY_URL=https://your-gateway.railway.app/mcp
MCP_AUTH_TOKEN=<shared secret for gateway auth>
```

### Railway (MCP gateway)

The `sdmx-mcp-gateway` runs as a Docker container on Railway. It exposes `/mcp` as the HTTP MCP endpoint. The `MCP_AUTH_TOKEN` environment variable on the Vercel side is sent as a `Authorization: Bearer` header on every MCP request; the gateway must validate this token.

### Build commands

```bash
npm run build          # Next.js production build (uses --webpack, not turbopack)
npm run build-index    # Build semantic search index for explore page
```

### Semantic search index

The explore page uses a local ONNX embedding model (`granite-embedding-small-r2`) to provide semantic search over dataflows. The embedding index is pre-built at deploy time via `scripts/build-index.ts` and served from `public/models/`. It does not require a separate service.

---

## 20. Known Limitations

1. **No rate limiting** — the agent loop has no per-user token budget or request throttling. A single user can consume unlimited tokens. Rate limiting is planned for Phase 3.
2. **Mobile layout not responsive** — the 420px fixed chat sidebar breaks on small screens.
3. **`sdmx-json-parser` throws on empty data** — "Series not found and observations empty" is caught by our `unhandledrejection` handler but still noisy in dev mode. Needs upstream fix.
4. **PDF export may miss some styles** — `html2canvas` doesn't capture all CSS properties (e.g., backdrop-filter). Complex dashboards may look slightly different in PDF.
5. **Live HTML export requires HTTP server** — ES module imports don't work from `file://` protocol.
6. **Prompt caching only for Anthropic** — Gemini and OpenAI users pay full input token cost on every request turn, making long conversations proportionally more expensive.
7. **No institutional curation of public dashboards** — sessions can be published to `/p/[id]` and appear in `/gallery`, but there is no editorial review, featured-status workflow, or moderation queue. Admins can inspect and unpublish via `/admin` but cannot promote/demote dashboards within the gallery.
8. **ENCRYPTION_SECRET rotation requires migration** — rotating the master encryption secret invalidates all stored BYOK keys. There is no automated migration path yet.
9. **No undo/redo persistence across page loads** — the undo stack is in memory (React state); it is not serialized to the database session. Reloading the page clears the undo history (the latest config is preserved).
