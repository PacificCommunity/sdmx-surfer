# Technical Reference — SPC Conversational Dashboard Builder

**Version:** 0.1.0 (Phase 1 + early Phase 2)
**Last updated:** March 2026

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Technology Stack](#2-technology-stack)
3. [Module Reference](#3-module-reference)
4. [Agent Loop Architecture](#4-agent-loop-architecture)
5. [Context Architecture (Three-Tier)](#5-context-architecture)
6. [Dashboard Config Schema](#6-dashboard-config-schema)
7. [UI Architecture](#7-ui-architecture)
8. [Session Management](#8-session-management)
9. [Export System](#9-export-system)
10. [Error Handling Strategy](#10-error-handling-strategy)
11. [Design System Implementation](#11-design-system-implementation)
12. [Logging and Observability](#12-logging-and-observability)
13. [Library Patches and Workarounds](#13-library-patches-and-workarounds)
14. [Known Limitations](#14-known-limitations)
15. [Phase 2 Roadmap](#15-phase-2-roadmap)

---

## 1. System Overview

The SPC Conversational Dashboard Builder is a web application that lets users create SDMX statistical dashboards through natural-language conversation with an AI agent.

The system connects three existing components:

- **sdmx-mcp-gateway** — a Python MCP (Model Context Protocol) server providing 18 tools for progressive SDMX data discovery on SPC's .Stat platform
- **sdmx-dashboard-components** — an npm library (v0.4.5) that renders dashboards from JSON configs using Highcharts, OpenLayers, and React
- **AI SDK v6** — Vercel's TypeScript framework for building AI applications, providing the streaming chat interface and tool orchestration

The **new piece** built in this repository is the agent loop + chat UI + live preview that connects these three.

### Key Design Principle

The AI agent produces **JSON configs, not code**. The output conforms to the `sdmx-dashboard-components` schema and is validated via Zod before rendering. The agent never generates JavaScript, HTML, or CSS — it only produces data configurations that the existing library renders.

---

## 2. Technology Stack

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | 16.2.1 |
| Runtime | React | 19.2.4 |
| Language | TypeScript | 5.9.3 |
| AI | AI SDK (`ai`, `@ai-sdk/anthropic`, `@ai-sdk/mcp`, `@ai-sdk/react`) | 6.0.134 |
| LLM | Claude Sonnet 4.6 | claude-sonnet-4-6 |
| MCP | streamable-http transport to gateway | localhost:8000 |
| Dashboard | sdmx-dashboard-components | 0.4.5 |
| Charts | Highcharts | 11.4.8 |
| Styling | Tailwind CSS v4 + custom CSS properties | 4.2.2 |
| Export | html2canvas + jsPDF | 1.4.1 / 4.2.1 |
| Markdown | react-markdown | 10.1.0 |

### Why these choices

- **AI SDK v6** over LangChain/LangGraph: single-language stack (TypeScript throughout), native streaming to React, first-class MCP client support, Anthropic prompt caching built in.
- **Claude Sonnet 4.6** over Opus: same Sonnet pricing tier ($3/$15 per MTok), sufficient for 10-20 step tool-use workflows. Opus would be 2x cost for marginal quality gain in this use case.
- **Next.js 16 App Router**: server-side API route for the agent loop (keeps API keys server-side), client-side rendering for the dashboard (SDMXDashboard fetches data from .Stat directly).
- **Tailwind v4**: CSS-first approach with `@theme` blocks for design tokens — no JavaScript config file needed.

---

## 3. Module Reference

### `app/api/chat/route.ts` — Agent Loop

The core server-side module. Handles POST requests from the chat client.

**Request flow:**
1. Parse request body (Zod-validated `{ messages }`)
2. Read `x-session-id` header for logging
3. Connect to MCP gateway (cached singleton)
4. Convert UI messages to model messages via `convertToModelMessages()`
5. Extract Tier 2 knowledge from conversation history
6. Build system prompt (Tier 1 static + Tier 2 dynamic)
7. Call `streamText()` with Claude, MCP tools, and `update_dashboard`
8. Return streaming SSE response

**Key mechanisms:**

- **MCP client caching:** A module-level promise caches the MCP client connection. If the gateway is down, the promise resets and retries on next request.
- **`update_dashboard` tool:** Custom tool intercepted by the agent loop (not forwarded to MCP). Accepts a full dashboard config, validates via Zod, and returns it in the tool output so the client can extract it.
- **Step budget:** `stopWhen: stepCountIs(25)` limits total steps. `prepareStep` at step 18+ injects an urgent system message telling the AI to emit a draft dashboard immediately.
- **Prompt caching:** `providerOptions.anthropic.cacheControl` marks the system prompt for Anthropic's native ephemeral caching (~90% cost reduction on cached prefix for subsequent messages in the same session).

**Zod schemas defined here:**
- `textConfigSchema` — styled text with size, weight, align, color, font
- `legendSchema` — chart legend with concept and location
- `unitSchema` — value unit with text and location
- `visualConfigSchema` — full chart/map/value config (with `.superRefine` for conditional `xAxisConcept`/`data` requirements)
- `dashboardConfigSchema` — root dashboard with rows, columns, header, footer

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
- **Session persistence:** `useEffect` debounces saves to localStorage (1.5s) on every messages/config change.

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
3. **Config schema documentation** — JSON structure with critical rules
4. **Progressive discovery workflow** — list → structure → codes → build URL
5. **SDMX conventions** — base URL, common dimensions, key syntax
6. **Example configs** — three working dashboards (few-shot)
7. **Tool instructions** — always use `update_dashboard`, handle errors

### `lib/types.ts` — TypeScript Types

Interfaces matching `sdmx-dashboard-components` v0.4.5:
- `SDMXTextConfig` — text with optional styling
- `SDMXDashboardConfig` — root config
- `SDMXDashboardRow` — container for columns (note: uses `columns`, not `colums` from the library's buggy type defs)
- `SDMXVisualConfig` — chart/map/value with all Highcharts options
- `SDMXComponentType` — union of 10 chart types

### `lib/session.ts` — Session Persistence

localStorage-based session management:
- `SessionData` — messages, config history stack, pointer, title, timestamp
- Max 20 sessions stored; auto-prunes oldest
- `trimMessage()` strips large tool outputs (except dashboard configs) to fit 4MB quota
- Session ID: 16-char hex from `crypto.getRandomValues`

### `lib/use-config-history.ts` — Undo/Redo Hook

Custom React hook maintaining a config version stack:
- Max 50 entries
- Deduplicates by JSON comparison
- `snapshot()` / `restore()` for localStorage serialization
- Internal refs + tick counter to minimize re-renders

### `lib/tier2-knowledge.ts` — Knowledge Extraction

Scans `ModelMessage[]` for MCP tool results:
- `list_dataflows` → dataflow names
- `get_dataflow_structure` → dimension IDs
- `get_dimension_codes` → code counts per dimension
- `build_data_url` → built URLs

Formats as "Session Knowledge" markdown block (~200-500 tokens) appended to the system prompt. Tells the AI "do NOT re-query these."

### `lib/export-dashboard.ts` — Export Functions

Four export modes:
- `exportToPdf()` — SVG→canvas conversion, html2canvas at 2x, jsPDF
- `exportToHtml()` — captures live DOM innerHTML + inlined CSS from stylesheets
- `exportToHtmlLive()` — esm.sh import maps for interactive re-rendering
- `exportToJson()` — raw config download

### `lib/logger.ts` — Request Logging

Server-side JSONL logging:
- Daily rotation: `logs/chat-YYYY-MM-DD.jsonl`
- One entry per POST request
- Fields: timestamp, sessionId, requestId, userMessage, aiResponse, toolCalls[], dashboardConfigIds[], errors[], tokenUsage, durationMs, stepCount
- Tool results truncated to 300 chars
- Never crashes the request (try/catch around all writes)

### `lib/dashboard-examples.ts` — Few-Shot Examples

Three working dashboard configs using real .Stat URLs:
1. Population bar chart (DF_POP_PROJ)
2. Trade line chart (DF_IMTS, Fiji+Samoa+Tonga)
3. KPI + column chart (3-column grid)

All URLs include `dimensionAtObservation=AllDimensions`.

---

## 4. Agent Loop Architecture

### Tool orchestration

The agent has access to ~20 tools:
- **18 MCP tools** from sdmx-mcp-gateway (discovered dynamically via `mcpClient.tools()`)
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

Static content loaded once and cached via Anthropic's ephemeral prompt caching:
- Dashboard config schema documentation
- Progressive discovery workflow instructions
- SDMX conventions for SPC .Stat
- Three example dashboard configs
- Conversation strategy rules
- Tool usage guidelines

**Cache behavior:** First request in a session pays full input cost. Subsequent requests get ~90% discount on the cached prefix (Anthropic handles cache invalidation by content hash).

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

This grows with the conversation. The 1M token context window of Sonnet 4.6 provides ample room for multi-turn sessions.

---

## 6. Dashboard Config Schema

The `update_dashboard` tool accepts a JSON config conforming to `sdmx-dashboard-components` v0.4.5:

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
2. **`dimensionAtObservation=AllDimensions`** must be appended to every data URL — the library's parser requires flat observations
3. **`legend.concept` required for bar/column charts** — the library crashes with a null dereference if missing (patched but still recommended)
4. **Data URLs from `build_data_url` only** — the AI must never construct URLs manually

---

## 7. UI Architecture

### Layout

```
┌────────────────────────────────────────────────────────┐
│  Glass App Bar (glass-panel + shadow-ambient)          │
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
    │                                              └── session.saveSession()
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

## 8. Session Management

### Storage model

```
localStorage:
  spc-dashboard-current        → "a1b2c3d4e5f6g7h8"  (active session ID)
  spc-dashboard-session-{id}   → JSON SessionData
```

### SessionData structure

```typescript
{
  sessionId: string;
  messages: UIMessage[];           // Full conversation history
  configHistory: SDMXDashboardConfig[];  // Undo/redo stack
  configPointer: number;           // Current position in history
  title: string;                   // From dashboard header
  updatedAt: string;               // ISO 8601
}
```

### Space management

- Max session size: ~4MB (localStorage limit per origin is ~5MB)
- If a session exceeds 4MB, older messages' tool outputs are trimmed (except dashboard configs)
- Max 20 sessions stored; oldest pruned automatically
- Save debounced at 1.5 seconds after last change

---

## 9. Export System

### PDF Export

1. Find all `<svg>` elements in the dashboard DOM (Highcharts charts)
2. For each SVG: serialize via `XMLSerializer`, draw onto a 2x canvas via `Image.onload`
3. Replace SVG elements with canvas elements in the DOM
4. Run `html2canvas` on the container element
5. Create `jsPDF` document sized to the canvas
6. Restore original SVG elements

The SVG-to-canvas step is necessary because `html2canvas` cannot rasterize SVG directly.

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

## 10. Error Handling Strategy

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

`sdmx-dashboard-components` has a null dereference bug when `getActiveDimensions()` returns fewer dimensions than expected (e.g., single-dimension queries). The patch (`patches/sdmx-dashboard-components+0.4.5.patch`) adds a null-guard that logs a warning and skips series construction instead of crashing.

---

## 11. Design System Implementation

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

## 12. Logging and Observability

### Log format (JSONL)

Each line in `logs/chat-YYYY-MM-DD.jsonl`:

```json
{
  "timestamp": "2026-03-24T10:30:15.123Z",
  "sessionId": "a1b2c3d4e5f6g7h8",
  "requestId": "m1abc2def",
  "userMessage": "Show me population data for Fiji",
  "aiResponse": "I'll create a population bar chart for Fiji...",
  "toolCalls": [
    {
      "name": "list_dataflows",
      "args": {"keywords": ["population"]},
      "resultPreview": "{\"dataflows\":[{\"id\":\"DF_POP_PROJ\",\"name\":\"Population...",
      "stepNumber": 0
    },
    {
      "name": "update_dashboard",
      "args": {"configId": "fiji_pop"},
      "resultPreview": "{\"success\":true,\"dashboard\":{\"id\":\"fiji_pop\"...",
      "stepNumber": 3
    }
  ],
  "dashboardConfigIds": ["fiji_pop"],
  "errors": [],
  "tokenUsage": {"input": 12500, "output": 3200},
  "durationMs": 8450,
  "stepCount": 4
}
```

### What to look for

- **High step counts** with no `update_dashboard` → agent stuck in discovery loops
- **Repeated tool calls** for the same dataflow → Tier 2 knowledge not working
- **Errors with auto-fix messages** → library compatibility issues
- **Token usage trends** → cost optimization opportunities

---

## 13. Library Patches and Workarounds

### sdmx-dashboard-components v0.4.5

**Patch:** `patches/sdmx-dashboard-components+0.4.5.patch`
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
**Fix:** The MCP gateway's `build_data_url` now includes this parameter by default (patched upstream). The system prompt also instructs the AI to always append it.

---

## 14. Known Limitations

1. **Session persistence is localStorage only** — max ~4MB per session, limited to 20 sessions. Database persistence planned for Phase 2.
2. **No authentication** — anyone with access to the URL can use the tool and consume API tokens. Auth planned for Phase 3.
3. **Mobile layout not responsive** — the 420px fixed chat sidebar breaks on small screens.
4. **`sdmx-json-parser` throws on empty data** — "Series not found and observations empty" is caught by our `unhandledrejection` handler but still noisy in dev mode. Needs upstream fix.
5. **PDF export may miss some styles** — `html2canvas` doesn't capture all CSS properties (e.g., backdrop-filter). Complex dashboards may look slightly different in PDF.
6. **Live HTML export requires HTTP server** — ES module imports don't work from `file://` protocol.
7. **No rate limiting** — the agent loop has no per-user token budget.

---

## 15. Phase 2 Roadmap

| Feature | Priority | Description |
|---------|----------|-------------|
| Dashboard state feedback | High | Tell the agent what actually rendered (observation counts, errors per panel) |
| Mobile layout | High | Collapsible chat drawer for small screens |
| CSV/Excel export per panel | Medium | Tabular data export with human-readable headers |
| JSON Patch support | Medium | Incremental `update_dashboard` instead of full config replacement |
| Database persistence | Medium | PostgreSQL or similar, replacing localStorage |
| Unlisted sharing URLs | Medium | Stable URLs for read-only dashboard sharing |
| Library self-description | Low | Auto-generated schema manifest from sdmx-dashboard-components source |
| User interaction forwarding | Low | Click events on chart elements forwarded to agent as context |

---

## 16. Multi-User Architecture (Phase 3)

### Current single-user model

The app currently operates as a single-user local tool:

| Concern | Current state | Risk |
|---------|--------------|------|
| Session storage | `localStorage` (browser-scoped) | Users on different machines are isolated by default; users on the same machine share sessions |
| Server-side logs | `logs/chat-*.jsonl` (flat files, all users mixed) | Anyone with server access can read all conversations |
| Authentication | None | Anyone with the URL can use the app |
| API key | Shared `ANTHROPIC_API_KEY` in `.env.local` | One key for all users; no per-user budgets |
| MCP gateway | Per-session state via `mcp-session-id` headers | Already multi-session safe |

### What's already safe

- **Browser isolation:** `localStorage` is scoped per origin — different browsers and machines cannot see each other's sessions.
- **Server-side API keys:** The Anthropic API key never reaches the client. All LLM calls go through the Next.js API route.
- **MCP session isolation:** The sdmx-mcp-gateway supports per-session state management via HTTP session headers. Different chat sessions get independent SDMX discovery contexts.

### Migration path to multi-user

The migration follows a clear dependency chain — each step unlocks the next:

#### Step 1: Authentication (gate for everything else)

**Approach:** NextAuth.js (or Auth.js v5) with SPC's OAuth 2.0 / SSO provider.

**Changes required:**
- Add `next-auth` package and configure an OAuth provider
- Create `app/api/auth/[...nextauth]/route.ts` with SPC SSO credentials
- Wrap the builder page in a session check; redirect unauthenticated users to login
- Pass `userId` from the auth session to the API route (via cookie or header)

**Key decision:** Whether to use SPC's existing SSO (if available) or a generic OAuth provider (Google, GitHub) for initial testing. SPC SSO is preferred for production but may require coordination with SPC's IT team.

#### Step 2: Database persistence (replaces localStorage)

**Approach:** PostgreSQL with a simple schema.

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- session ID (hex string)
  user_id TEXT NOT NULL,            -- from auth provider
  title TEXT DEFAULT 'Untitled',
  messages JSONB NOT NULL,          -- UIMessage[] serialized
  config_history JSONB NOT NULL,    -- SDMXDashboardConfig[] stack
  config_pointer INT DEFAULT -1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_sessions_user ON sessions(user_id, updated_at DESC);
```

**Changes required:**
- Add a database client (e.g., `@vercel/postgres`, `drizzle-orm`, or raw `pg`)
- Create `lib/session-db.ts` implementing the same interface as `lib/session.ts` (`saveSession`, `loadSession`, `listSessions`, `deleteSession`) but against PostgreSQL
- Replace localStorage calls in `app/builder/page.tsx` with server-side API routes (`/api/sessions/[id]`)
- Keep localStorage as a fallback/cache for offline resilience

**Session scoping:** All queries include `WHERE user_id = $1` — users can only see their own sessions. The database enforces this at the query level, not the application level (defense in depth).

#### Step 3: Per-user log partitioning

**Approach:** Add `userId` to every log entry.

**Changes required:**
- Modify `lib/logger.ts` to accept and record `userId` alongside `sessionId`
- In the API route, extract `userId` from the auth session and pass to `createRequestLogger`
- For production: consider logging to a database table instead of flat files, enabling per-user analytics queries

**Log schema extension:**
```json
{
  "userId": "spc-sso:jane.doe",
  "sessionId": "a1b2c3d4e5f6g7h8",
  "timestamp": "...",
  ...
}
```

#### Step 4: Rate limiting and token budgets

**Approach:** Per-user middleware on the `/api/chat` route.

**Implementation options:**
- **Simple:** In-memory counter per `userId` with a sliding window (e.g., 50 requests/hour, 500K tokens/day). Resets on server restart — acceptable for PoC.
- **Durable:** Redis or database-backed counters. Required for production with multiple server instances.

**Changes required:**
- Create `lib/rate-limiter.ts` with a `checkRateLimit(userId): { allowed: boolean, remaining: number }` function
- Call at the top of the API route's POST handler; return 429 if exceeded
- Track cumulative `tokenUsage` per user per day (from the logger data)
- Optionally: expose remaining budget in the UI (e.g., "42 requests remaining today")

**Token budget strategy:**
| Tier | Requests/hour | Tokens/day | Users |
|------|--------------|------------|-------|
| Default | 30 | 200K | All authenticated |
| Power user | 100 | 1M | SPC statisticians |
| Admin | Unlimited | Unlimited | SPC IT / project team |

#### Step 5: Shared dashboard visibility (optional, Phase 3+)

Once sessions are in a database with user ownership, adding sharing is straightforward:

```sql
ALTER TABLE sessions ADD COLUMN visibility TEXT DEFAULT 'private';
-- 'private' = owner only
-- 'unlisted' = anyone with the URL
-- 'public' = listed in gallery
```

**Sharing flow:**
1. User clicks "Share" → generates an unlisted URL (`/dashboard/{session_id}`)
2. The URL serves a read-only view of the dashboard (no chat, no editing)
3. Public dashboards appear in a gallery page (`/gallery`)
4. Institutional curation: admins can mark dashboards as "featured"

### Security considerations

| Threat | Mitigation |
|--------|-----------|
| Prompt injection via user input | The system prompt instructs the AI to only produce JSON configs; the `update_dashboard` Zod schema validates output; dashboard configs cannot contain executable code |
| SDMX query abuse (excessively broad queries) | The MCP gateway's `validate_query` tool checks query validity; Phase 3 adds query whitelisting |
| API key exposure | Key is server-side only (`.env.local`, never sent to client); API route is the sole proxy |
| Cross-user data leakage | Database queries scoped by `user_id`; `localStorage` scoped by browser origin; logs partitioned by `userId` |
| Denial of service via token consumption | Rate limiting (Step 4); per-user daily token caps; monitoring alerts on unusual usage |
| Session hijacking | Auth session cookies with `httpOnly`, `secure`, `sameSite=strict`; session IDs are cryptographic random hex |
