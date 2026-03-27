# SCOPING & ARCHITECTURE DOCUMENT

## Conversational Dashboard Builder

**Pacific Community (SPC) — Statistics for Development Division**
**March 2026 · Version 0.2 — Internal Draft**

---

## 1. Executive Summary

This document scopes and specifies the architecture for a web-based product that allows users to create, edit, and interact with live SDMX data dashboards through natural-language conversation with an AI agent. Critically, three of the four core ingredients already exist as working software:

- **sdmx-mcp-gateway** (Baffelan/sdmx-mcp-gateway): a Python-based MCP server implementing progressive discovery of SDMX dataflows on SPC's .Stat platform, with tools for structure exploration, dimension browsing, data availability checking, and validated query construction.
- **sdmx-dashboard-components** (PacificCommunity/sdmx-dashboard-components): a published npm library (v0.4.5) of React components (SDMXDashboard, SDMXChart, SDMXMap, SDMXValue) that render interactive dashboards from JSON configuration files, using Highcharts for visualisation.
- **sdmx-dashboard-demo** (PacificCommunity/sdmx-dashboard-demo): a Next.js application that loads JSON config files and renders dashboards using the component library. Already Dockerised and deployed on Vercel.

The missing piece — and the scope of this project — is the **AI agent loop**: a server-side process that connects the chat interface to the MCP, produces valid dashboard JSON configs through conversation, and pushes them to the existing rendering components for live preview. The user arrives at a web interface, describes what they want to see, and watches a dashboard materialise in real time using the existing component library. They then continue the conversation to refine it. No SDMX knowledge is required.

---

## 2. Existing Codebase

Understanding the existing components in detail is essential, because the new work must integrate with them rather than replace them.

### 2.1 sdmx-mcp-gateway

**Repository:** github.com/Baffelan/sdmx-mcp-gateway
**Language:** Python 3.10+ (FastMCP SDK, httpx, XML parsing)
**Transport:** stdio (currently); HTTP transport planned for remote deployment

The gateway's key innovation is progressive discovery: instead of loading entire DSD metadata (100KB+), it uses a layered approach that reduces total data to approximately 2.5KB across a typical five-step workflow. The tools are:

| Tool | Purpose | Output Size |
|------|---------|-------------|
| `discover_dataflows_overview` | Find relevant dataflows by keyword. | ~300 bytes |
| `get_dataflow_structure` | Get dimension order and structure without full codelists. | ~1KB |
| `explore_dimension_codes` | Drill into specific dimensions with search/limit. | ~500 bytes |
| `check_data_availability` | Query ContentConstraints for actual data existence. | ~700 bytes |
| `build_data_query` | Construct validated SDMX REST data URLs. | ~200 bytes |
| `get_discovery_guide` | Interactive guide for the discovery workflow. | ~500 bytes |

The gateway also provides standard (non-progressive) tools (`discover_dataflows`, `get_structure`, `browse_codelist`, `validate_syntax`, `build_query`), MCP resources (agency directory, format guide, syntax guide), and guided prompts. It correctly handles DSD ID extraction, dimension ordering, and ContentConstraint parsing.

**Known limitation:** the gateway currently uses global state for endpoint configuration, making it single-user. For a multi-user web deployment, this must be refactored to per-session state (see Section 8).

### 2.2 sdmx-dashboard-components

**Repository:** github.com/PacificCommunity/sdmx-dashboard-components
**Language:** TypeScript / React (Vite build)
**Charting:** Highcharts (including styled mode support)
**npm package:** sdmx-dashboard-components (v0.4.5)

This library provides four main components:

- **SDMXDashboard**: accepts a JSON config URL or object and renders the full dashboard (rows, columns, panels).
- **SDMXChart**: renders a single chart (line, bar, column, pie, drilldown, lollipop) from SDMX data URLs.
- **SDMXMap**: renders a choropleth map linking SDMX data to GeoJSON geometries.
- **SDMXValue**: renders a single KPI value with optional unit and adaptive text sizing.

The components handle SDMX-JSON fetching and parsing internally. They support multi-language configs, custom color palettes, Highcharts extraOptions pass-through, data expressions (arithmetic operators, `hist`, `count`), and `sortByValue`. The download button per-chart is supported via the `download` config flag.

### 2.3 sdmx-dashboard-demo

**Repository:** github.com/PacificCommunity/sdmx-dashboard-demo
**Language:** TypeScript / Next.js
**Deployment:** Dockerised; deployed on Vercel

The demo app loads JSON config files (from local filesystem or GitHub Gists) and renders them using SDMXDashboard. It validates configs against a JSON schema. It provides a config management interface but does not include a form-based editor or a conversational interface — that is exactly what this project adds.

### 2.4 The Existing Dashboard Config Format

The config format is already defined and documented (`public/doc.md` in the demo repo). The agent must produce JSON conforming to this format. The top-level structure is:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Dashboard identifier (required). |
| `rows` | Row[] | Array of rows, each containing columns, each containing components (required). |
| `languages` | Language[] | Available languages; default is English only (optional). |
| `colCount` | number | Number of grid columns; default is 3 (optional). |
| `header` / `footer` | Text \| object | Dashboard header and footer (optional). |

Each component (cell) within a column specifies: `type` (line, bar, column, pie, drilldown, value, map, note), `data` (one or more SDMX query URLs with optional arithmetic expressions), `legend`, `xAxisConcept`, `yAxisConcept`, and styling options. This remains the runtime format used by the plotting library.

### 2.5 App-Level Dashboard Authoring Layer

The application now inserts a translation layer between the agent and the plotting library:

- The **LLM-facing contract** is a simplified authoring schema with intent visuals such as `kpi`, `chart`, `map`, and `note`.
- The **runtime-facing contract** remains the native `sdmx-dashboard-components` config.
- A **server-side compiler** turns authoring specs into native dashboard config before anything reaches the preview.
- A **native passthrough mode** is retained for advanced cases, so library capabilities are not lost.

This architecture deliberately moves brittle syntax out of the model's prompt burden and into code:

- KPI cards compile to the correct native `value` visual automatically.
- Maps no longer require the model to handcraft the packed `data` string.
- Safer defaults and invariants live in the app compiler instead of only in prompt prose.

---

## 3. What Needs To Be Built

Given the existing codebase, the new work reduces to three deliverables:

### 3.1 The Agent Loop (Server-Side)

A server-side process that manages conversation state, calls the Anthropic API, executes MCP tool calls against the sdmx-mcp-gateway, and produces valid dashboard JSON configs. This is the core of the product and the primary engineering effort.

### 3.2 The Chat-to-Dashboard Web Interface

A web application with a split-pane layout: chat on one side, live dashboard preview on the other. The dashboard preview uses the existing SDMXDashboard component from sdmx-dashboard-components. When the agent produces or updates a config, it is passed directly to SDMXDashboard as a prop (or via a config URL) and the dashboard re-renders live.

### 3.3 The MCP Transport Bridge

The sdmx-mcp-gateway currently uses stdio transport, designed for local CLI use (e.g., Claude Desktop). For a web deployment, it needs to be accessible from the agent loop running on a server. Options include: running the gateway as a subprocess with stdio piping (simplest for PoC), adding HTTP transport to the gateway (already planned per the repo, and natively supported by both AI SDK v6's `@ai-sdk/mcp` and LangGraph's `langchain-mcp-adapters`), or wrapping the gateway's tools as plain HTTP endpoints that the agent loop calls directly.

---

## 4. Architecture

### 4.1 High-Level Data Flow

1. The user types a message in the chat interface (e.g., "Show me trade balance by country for Pacific Island states").
2. The frontend sends the message to the agent loop endpoint via SSE.
3. The agent loop calls the Anthropic API with conversation history, MCP tool definitions, and the `update_dashboard` tool.
4. The API returns `tool_use` requests. The agent loop executes these against the MCP gateway (e.g., `discover_dataflows_overview` with `keywords=["trade"]`, then `get_dataflow_structure`, then `explore_dimension_codes`, then `build_data_query`).
5. The API eventually invokes `update_dashboard` with either an authoring spec (preferred) or a native dashboard config.
6. The agent loop validates and compiles authoring specs into native `sdmx-dashboard-components` config.
7. The agent loop streams the text response and pushes the compiled config as a separate SSE event to the frontend.
8. The frontend passes the compiled config to the SDMXDashboard component, which renders the dashboard and fetches SDMX data from .Stat directly.
9. The dashboard reports its render state back to the agent loop (see Section 6), closing the feedback loop.

### 4.2 Component Architecture

```
Browser
┌─────────────────┬────────────────────────────┐
│   Chat UI        │   SDMXDashboard component   │
│   (SSE client)   │   [EXISTING] Highcharts     │
│                  │   + state reporting [NEW]   │
│                  │   + interaction events [NEW]│
└───────┬─────────┴─────────┬──────────────────┘
        │  SSE stream       │  SDMX REST queries
        │  + render state   │
Server  │                   │
┌───────┴─────────────────┐ │  ┌───────────┐
│ Agent Loop [NEW]        │ │  │ .Stat API │
│ Conversation + Tools    │ │  │ (SDMX)    │
│ Authoring → Native      │ │  └───────────┘
│ Config Compilation      │ │
│ Cached system prompt    │ │
└────┬──────────┬─────────┘ │
     │ API call │ stdio/HTTP│
     ↓          ↓           │
 Anthropic   sdmx-mcp-gateway
   API       [EXISTING] Python
```

---

## 5. Agent Loop Specification

The agent loop is the only component that is entirely new. It must:

- Maintain conversation history for the current session.
- Call the Anthropic API with conversation history, MCP tool definitions (mirroring the gateway's progressive discovery tools), and the `update_dashboard` synthetic tool.
- Execute the tool-use loop: when the API returns `tool_use` blocks, dispatch them to the MCP gateway (via stdio subprocess for PoC, HTTP transport for production), feed results back, and re-call the API.
- Stream the agent's text response to the browser via SSE.
- Emit dashboard config events (separate from the text stream) when the agent invokes `update_dashboard`.
- Compile authoring specs into native `sdmx-dashboard-components` config before emitting them.
- Receive structured render state and user interaction events from the dashboard component (see Section 6) and include them as context in subsequent API calls.
- Provide the agent with both the simplified authoring schema and the native config escape hatch (via cached system prompt).

### 5.1 The update_dashboard Tool

This synthetic tool is intercepted by the agent loop, not forwarded to the MCP. It accepts either:

- an **authoring spec** using intent visuals (`kpi`, `chart`, `map`, `note`)
- or a **native dashboard config** for passthrough use

When invoked, the loop validates the payload, compiles authoring specs into native dashboard config, validates the compiled result, and pushes the compiled config to the frontend.

### 5.2 Context Architecture and Prompt Caching

The agent's context window is a constrained resource shared between three kinds of knowledge: the dashboard library's capabilities, SDMX conventions and metadata, and the live conversation. A layered caching strategy ensures the right knowledge is available without crowding out what actually changes per turn.

#### 5.2.1 Three Knowledge Tiers

**Tier 1 — Stable knowledge (cached system prompt prefix):** Knowledge that changes on the order of weeks or months. This tier sits at the front of the system prompt and is marked for Anthropic's prompt caching (`cache_control`). After the first turn in a session, subsequent turns hit the cache at ~90% token cost reduction. This tier includes:

- **Dashboard library self-description**: a compact machine-readable manifest of component types, their props, the layout model, the data expression syntax, and the config validation rules. Since SPC owns the library, this can be generated directly from source code (e.g., a static `SDMXDashboard.describe()` method or a build-time script), ensuring it never drifts from the implementation. Target: ~4–6K tokens.
- **SDMX conventions and .Stat patterns**: how SDMX keys work, what `dimensionAtObservation=AllDimensions` means, .Stat base URL patterns, frequency codes (A, Q, M), common dimension roles (`GEO_PICT` for geography, `TIME_PERIOD` for time, `OBS_VALUE` for observation values), and the progressive discovery workflow the agent should follow.
- **Dataflow catalogue summary**: a concise directory of all dataflows available on .Stat — ID, name, theme, and rough coverage (e.g., "DF_TRADE: Merchandise trade, 22 Pacific Island countries, 2000–2024, annual/quarterly"). This can be auto-generated by a nightly job that runs `discover_dataflows_overview` across all dataflows. Target: ~2–4K tokens depending on number of dataflows.
- **2–3 complete example configs**: working dashboard JSON files that demonstrate line charts, bar charts, multi-dataflow layouts, drilldowns, maps, and data expressions. These serve as few-shot examples for the agent.

Total stable tier: approximately 10–15K tokens, cached after the first turn of each session.

**Tier 2 — Session knowledge (accumulated in conversation history):** Dataflow structures the agent has discovered during this session via MCP calls — DSDs, codelists, availability constraints. This knowledge grows as the user explores but does not need to be re-fetched for follow-up questions about the same dataflow. The agent loop should maintain a session-level summary object ("dataflows explored so far: DF_TRADE with dimensions [FREQ, TIME_PERIOD, GEO_PICT, COMMODITY], DF_CPI with dimensions [...]") injected alongside conversation history. This prevents the agent from re-calling the MCP for structures it has already seen.

**Tier 3 — Per-turn knowledge (fresh MCP calls):** Only what is genuinely new: exploring a dimension the agent hasn't seen yet, checking availability for a new filter combination, building a specific query URL. The MCP gateway's progressive discovery keeps each response small (~300–700 bytes). This tier is where the context budget should be maximally available.

#### 5.2.2 Making the Dashboard Library Self-Describing

Since SPC develops sdmx-dashboard-components, the library can be enhanced to support LLM consumption directly. Recommended enhancements:

- Enrich the existing JSON schema files (`dashboard.schema.json`, `visual.chart.schema.json`, etc.) with LLM-oriented descriptions: not just validation rules, but field-level explanations, common patterns, gotchas, and example fragments embedded as `description` or `$comment` properties.
- Add a build-time script that generates a consolidated capability manifest from the component source code — what types exist, what props they accept, what combinations are valid, what the data expression syntax supports. This manifest is the source of truth for the agent's stable knowledge tier.
- Optionally, adopt an `llms.txt` convention: a compact, structured description of the library's capabilities in a format designed for system prompts.

The key principle is that the library's LLM documentation is generated from code, not maintained manually. This eliminates documentation drift and means every new component type or config option is automatically available to the agent after the next build.

#### 5.2.3 Curating the Stable SDMX Knowledge

Some stable SDMX knowledge can be auto-generated (the nightly dataflow catalogue). Some is editorial: conventions, best practices, which dataflows are most commonly requested by Pacific Island NSOs, which dimension combinations produce the most useful visualisations, how to handle dataflows with sparse data. This is where SDD's domain expertise becomes a product input. A curated knowledge document — maintained by the team and versioned alongside the system prompt — dramatically improves the agent's quality from the first turn of every session.

### 5.3 Implementation: TypeScript (AI SDK v6) vs. Python (LangGraph)

The agent loop's implementation language is the most consequential architectural choice in this project. There are two mature, production-ready options — both with strong MCP support — and the decision turns on how to handle the cross-language boundary between the Next.js frontend and the Python MCP gateway.

#### 5.3.1 Option A: Vercel AI SDK v6 (TypeScript)

**Architecture:** Agent loop runs as a Next.js API route inside the existing sdmx-dashboard-demo app. Single project, single deployment, single language on the frontend side.

AI SDK v6 (released 2026) is the current major version and represents a significant upgrade over v5. Key features directly relevant to this project:

- **Stable MCP support** (`@ai-sdk/mcp` package): HTTP transport, OAuth, resources, prompts, and elicitation — all production-ready. The MCP client can connect to the Python gateway over HTTP without subprocess hacking.
- **Agent abstraction** with `ToolLoopAgent`: composable agents with configurable stop conditions (e.g., after N steps) and automatic tool-use loop handling.
- **Tool execution approval** (human-in-the-loop): a `needsApproval` flag per tool, with UI integration via `useChat`. Useful for gating expensive or sensitive MCP calls.
- **Automatic tool input streaming**: partial tool call inputs stream to the UI as the model generates them, providing real-time feedback during progressive discovery steps.
- **Type-safe tool definitions** with `inputSchema` and `outputSchema`: end-to-end type safety between the agent and the MCP tools.
- **DevTools**: full visibility into multi-step agent flows, token usage, and tool call chains. Critical for debugging the progressive discovery workflow.
- **`useChat` React hook**: handles streaming, message state, and tool invocation lifecycle on the frontend with minimal code.

**MCP bridge:** For Phase 1, connect to the Python gateway via stdio subprocess (supported but not recommended for production). For Phase 2+, add HTTP transport to the gateway (already on its roadmap) and connect via `@ai-sdk/mcp`'s HTTP client — clean, no subprocess.

**Strengths:** Single-project architecture with the existing Next.js app; seamless chat UI integration; type safety across the stack; excellent streaming UX; AI SDK v6's MCP client handles the transport cleanly once the gateway supports HTTP.

**Weaknesses:** Cross-language bridge to the Python MCP (the main friction point); the team must be comfortable writing TypeScript; the gateway needs HTTP transport added (a prerequisite, but one already planned).

#### 5.3.2 Option B: LangGraph + FastAPI (Python)

**Architecture:** Agent loop runs as a Python backend (FastAPI or similar), separate from the Next.js frontend. Two services, two deployments.

LangGraph (v1.0, stable since October 2025) provides graph-based agent orchestration in Python. The `langchain-mcp-adapters` package (v0.2.2, March 2026) connects LangGraph agents to MCP servers. Key features:

- **Native Python MCP integration**: `MultiServerMCPClient` connects to MCP servers via stdio or HTTP. Since the gateway is also Python, the connection is frictionless — no cross-language bridge at all.
- **Graph-based control flow**: if the agent workflow becomes more complex than a simple tool-use loop (e.g., branching logic based on dataflow type, parallel MCP queries), LangGraph models this naturally as a state graph.
- **Built-in checkpointing and state persistence**: conversation state can be persisted and resumed natively, which simplifies the session model (Section 9).
- **LangSmith observability**: trace every tool call, LLM response, and state transition. Useful for debugging and for the monitoring requirements of Phase 3.
- **Interceptors**: middleware that can modify MCP tool calls in-flight, inject per-user context, or enforce rate limits at the tool level.

**Frontend integration:** The Next.js app becomes a thin client that calls the Python backend's SSE endpoint. AI SDK v6 provides a `@ai-sdk/langchain` adapter that converts LangGraph event streams to UI messages, with support for tool calling, streaming, and human-in-the-loop via LangGraph interrupts. The frontend chat UI can still use `useChat` with a custom API route that proxies to the Python backend.

**Strengths:** No cross-language bridge to the MCP; the team can work in Python throughout the backend; LangGraph's graph model and checkpointing are powerful if the agent workflow grows in complexity; LangSmith gives production observability out of the box.

**Weaknesses:** Two-service architecture (Python backend + Next.js frontend) increases deployment complexity; the chat UI integration is less seamless than AI SDK's native `useChat`; an additional dependency (FastAPI) must be maintained; the existing demo app's deployment story (Docker, Vercel) becomes more complex with a Python sidecar.

#### 5.3.3 Comparison

| Criterion | AI SDK v6 (TypeScript) | LangGraph (Python) |
|-----------|----------------------|-------------------|
| MCP bridge to Python gateway | Requires HTTP transport on gateway (planned). stdio subprocess as stopgap. | No bridge needed. Python-to-Python, native. |
| Frontend integration | Seamless. `useChat` + Next.js API route, single project. | Proxied. Next.js calls Python backend via SSE. Adapter available. |
| Deployment complexity | Single service (Next.js). | Two services (Next.js + FastAPI). |
| Agent workflow flexibility | Tool-use loop with configurable stops. Adequate for this use case. | Full state graph. More powerful if workflow grows complex. |
| Observability | AI SDK DevTools (new in v6). | LangSmith (mature, production-grade). |
| Human-in-the-loop | `needsApproval` flag per tool, native UI integration. | LangGraph interrupts, supported via AI SDK adapter. |
| State persistence | Must be implemented (database + custom code). | Built-in checkpointing. |
| Team language requirement | TypeScript for backend + frontend. | Python for backend; TypeScript for frontend only. |

#### 5.3.4 Recommendation

For this project, **AI SDK v6 (TypeScript) is recommended as the primary path**, for two reasons. First, the existing demo app is Next.js, and embedding the agent loop as a Next.js API route avoids introducing a second service, a second deployment pipeline, and a second runtime. Second, AI SDK v6's stable MCP-over-HTTP support means the cross-language bridge to the Python gateway becomes clean as soon as HTTP transport is added to the gateway — a change already planned in its roadmap.

However, **if the development team is primarily Python-skilled**, or if the agent workflow grows significantly more complex than a simple progressive-discovery-then-emit-config loop, **LangGraph + FastAPI is a strong alternative**. The AI SDK v6 LangGraph adapter means this choice is not all-or-nothing: the frontend can use AI SDK's `useChat` with either backend.

In either case, the **MCP gateway should be extended with HTTP transport as a Phase 2 priority**, since both options benefit from it and the current stdio-based approach is explicitly not recommended for production by MCP documentation.

---

## 6. Dashboard-Agent Communication

For the agent to iteratively improve a dashboard, it needs to know what the dashboard looks like and what the user is doing with it. A screenshot-based approach is passive and non-interactive. Since SPC develops the dashboard library, a richer model is possible: the rendered dashboard becomes a live participant in the conversation, reporting its state and forwarding user interactions to the agent.

### 6.1 Structured State Reporting

After every render cycle, the SDMXDashboard component emits a machine-readable state object to the agent loop. This is far more useful than a screenshot — it is structured, queryable, and token-efficient. The state object includes:

- **Per-panel render status**: which panels rendered successfully, which failed (with the SDMX error message or HTTP status), and which are still loading.
- **Data summaries**: number of observations per panel, actual time range, geographic coverage, dimension values present in the data.
- **Filter state**: current values of all global and panel-local filters.
- **Layout metadata**: which panels are visible in the viewport, whether any panels are empty or have only a single data point (which may indicate a query that's too narrow).

This state object is sent to the agent loop after each config update. The agent can then reason about the result: "The DF_TRADE panel returned 0 observations — the filter combination may be too restrictive" or "The bar chart has 22 categories, which is likely too many for readability." The agent can proactively suggest fixes without the user having to describe the problem.

### 6.2 User Interaction Forwarding

When the user interacts with the dashboard — clicking on a bar, hovering over a data point, selecting a country on the map — the dashboard captures the interaction and forwards it to the agent as structured context. Highcharts already provides comprehensive event callbacks (`point.events.click`, `series.events.click`, `chart.events.selection`) that can be hooked into with minimal new code.

The interaction events are appended to the conversation as structured user messages:

- "User clicked on Fiji in the trade balance bar chart (value: -42.3M USD, 2023)"
- "User selected the time range 2018–2023 on the CPI line chart"
- "User clicked the 'download' button on panel inflation_rate"

The agent can then respond contextually: offer to drill down into Fiji's trade data, add a time series comparison, or explain the data point. The user doesn't have to describe what they're looking at — they just interact with the visualisation, and the agent knows what they pointed at.

### 6.3 Implementation in sdmx-dashboard-components

Both capabilities require enhancements to the dashboard library. The recommended approach is to add an event emitter interface to SDMXDashboard:

- An `onRenderComplete` callback that receives the structured state object after all panels have rendered (or timed out).
- An `onUserInteraction` callback that receives structured interaction events (panel ID, interaction type, data point context).
- An optional `onError` callback for SDMX fetch failures with parsed error details.

These callbacks are opt-in: the existing demo app and any other consumer of the library are unaffected unless they register the callbacks. The chat-to-dashboard interface registers them and pipes the events into the agent loop's conversation context.

### 6.4 Agent-to-Dashboard Commands (Future)

Beyond config emission, the agent could trigger dashboard commands: highlight a specific panel, scroll to a section, apply a temporary visual annotation, or trigger an animation. This is speculative but architecturally clean: an event bus from the agent loop to the dashboard component, where the agent emits commands and the dashboard executes them. This would make the agent feel like it is collaborating on the visual artifact rather than producing JSON and hoping for the best. This is a Phase 3+ consideration.

---

## 7. Technology Stack

The stack is largely determined by the existing codebase. New additions are marked.

| Layer | Technology | Status |
|-------|-----------|--------|
| MCP server | sdmx-mcp-gateway (Python, FastMCP) | Exists. Needs per-session state + HTTP transport. |
| Dashboard components | sdmx-dashboard-components (React, Highcharts, Vite) | Exists (npm v0.4.5). Needs event callbacks for agent communication. |
| Dashboard app shell | sdmx-dashboard-demo (Next.js, Docker) | Exists. Will be extended with chat UI + agent route. |
| Agent loop (recommended) | AI SDK v6 (TypeScript) in Next.js | **NEW.** Core deliverable. Single-project architecture. |
| Agent loop (alternative) | LangGraph v1 + FastAPI (Python) | **NEW.** Two-service architecture. Eliminates MCP bridge. |
| Chat UI | React + useChat (AI SDK v6) | **NEW.** Works with either backend via adapter. |
| AI API | Anthropic Messages API (Claude Sonnet 4) | External service. Native MCP + streaming. |
| MCP transport | @ai-sdk/mcp over HTTP (TS) or langchain-mcp-adapters (Python) | **NEW.** HTTP transport on gateway needed for production. |
| Context / prompt caching | Anthropic prompt caching (`cache_control`) | **NEW.** Amortises stable knowledge cost across turns. |
| Library self-description | Build-time manifest generator in sdmx-dashboard-components | **NEW.** Enhancement to existing library. Auto-generated from source. |
| Dashboard state reporting | `onRenderComplete` / `onUserInteraction` callbacks | **NEW.** Enhancement to existing library. Feeds agent loop. |
| Config patching | fast-json-patch (RFC 6902) | **NEW.** For incremental edits. |
| Data export (CSV/XLSX) | SheetJS or Highcharts export module | Partial (download flag exists). May need enhancement. |
| PDF export | Puppeteer (server-side) or html2canvas + jsPDF | **NEW.** Publication-quality dashboard snapshots. |
| Persistence | PostgreSQL + Drizzle ORM (or GitHub Gists) | Partially exists (Gist storage). Expand for sessions. |
| Authentication | SPC SSO / OAuth 2.0 (Phase 3) | **NEW.** Required for production. |
| Rate limiting | Token-bucket middleware + per-session LLM cost caps | **NEW.** Required for production. |

---

## 8. Key Design Decisions

### 8.1 Extend, Don't Replace

The existing dashboard components and demo app are mature (130+ commits, 159+ commits respectively). The architecture must add the conversational layer without forking or substantially rewriting these projects. The chat UI and agent loop should be added as new routes and components within the existing Next.js app, importing SDMXDashboard directly.

### 8.2 The Agent Produces Configs, Not Code

The agent's output is a JSON config conforming to the existing schema. It never writes React code, Highcharts options, or SDMX parsing logic. This means the agent's correctness can be validated mechanically (JSON schema validation) before the config reaches the renderer.

### 8.3 Progressive Discovery Is Already Solved

The MCP gateway's progressive discovery workflow (overview → structure → dimension codes → availability → query) is exactly what the agent needs to go from a user's natural-language request to a valid SDMX data URL. The agent loop does not need its own SDMX logic; it delegates entirely to the MCP tools. The system prompt should instruct the agent to follow the progressive discovery workflow.

### 8.4 MCP Gateway Needs Per-Session State

The gateway currently uses global state for endpoint configuration, which is unsuitable for multi-user deployment. Before production, this must be refactored. Options: run a separate gateway subprocess per user session (simple but resource-heavy), implement per-session state via MCP context (as noted in the repo's own roadmap), or extract the gateway's logic into a stateless HTTP API called by the agent loop.

### 8.5 Dedicated Tool for Config Emission

The agent communicates config changes via the `update_dashboard` synthetic tool rather than embedding JSON in its text output. This keeps the conversational response clean and makes config updates programmatically interceptable, validatable, and pushable to the frontend on a separate channel.

### 8.6 Data Export Strategy

The existing component library already supports a per-chart download flag (Highcharts' built-in export). For full dashboard data export (multi-sheet Excel) and PDF export, new functionality will need to be added — either as enhancements to sdmx-dashboard-components or as features in the host application. Highcharts' server-side export module or client-side html2canvas + jsPDF are the main options for PDF.

---

## 9. Persistence, Sessions, and Sharing

The persistence model shapes decisions across all phases. The demo app already supports GitHub Gists for config storage, which provides a foundation, but a multi-user product with public dashboards requires a more considered approach across three layers: where configs live, how sessions bind to them, and how sharing works.

### 9.1 Config Storage Options

Three realistic options exist given the current stack:

**Option A — GitHub Gists (extend existing):** Each saved dashboard becomes a Gist. The demo app already has this wiring (`GIST_TOKEN` and `GIST_PUBLIC` environment variables). The agent loop saves the final config to a Gist when the user requests it. Public dashboards are public Gists; versioning comes for free via Gist revisions; and no database is required. For multi-user support, per-user GitHub OAuth lets each user's dashboards live under their own GitHub account, giving them ownership of their data outside the system. Downside: dependency on GitHub availability; limited metadata and query capabilities.

**Option B — PostgreSQL:** A `dashboards` table with columns such as `id`, `user_id`, `config` (JSONB), `title`, `is_public`, `status`, `created_at`, and `updated_at`. A `sessions` table links conversation history to dashboards. This is the conventional choice and gives full control over access patterns, sharing, search, and analytics. Downside: new infrastructure dependency.

**Option C — Hybrid:** Use the database for user accounts, sessions, and metadata (title, visibility, status, timestamps), but store the actual config JSON as Gists. Configs remain portable and visible on GitHub, while the application controls access and discovery. This combines the strengths of both approaches.

The recommended path is: Gists in Phase 1 (already working), database for session persistence in Phase 2, and the hybrid model in Phase 3 when public sharing and curation matter.

### 9.2 Session Model

A session produces two artifacts with different lifecycles: the dashboard config (the valuable output) and the conversation history (the process that produced it). These should be stored together but treated differently.

Each dashboard has a unique ID (UUID). While the user is chatting, the current config lives in React state. When they click "Save" or when auto-save triggers, the config is persisted (to Gist or database). The conversation history is stored alongside it as associated metadata. When the user returns, they see a list of their dashboards; clicking one loads the config into SDMXDashboard and restores the conversation history into the chat panel, ready to resume editing.

The data model is:

| Entity | Key Fields | Notes |
|--------|-----------|-------|
| Dashboard | `id` (UUID), `user_id`, `title`, `config` (JSON), `status`, `visibility`, `created_at`, `updated_at` | Primary artifact. Config conforms to sdmx-dashboard-components schema. |
| Session | `id` (UUID), `dashboard_id`, `messages` (JSON array), `token_count`, `created_at`, `updated_at` | Conversation history. One active session per dashboard; older sessions retained for audit. |
| User | `id`, `display_name`, `auth_provider`, `auth_id`, `created_at` | Phase 3. Linked to sessions and dashboards. |

### 9.3 Visibility and Sharing

Dashboards have a `visibility` field with three values:

- **Private** (default): only the owner can view and edit. Requires authentication.
- **Unlisted**: accessible by anyone with the direct link (`/dashboard/{id}`), but not discoverable through search or gallery. Useful for sharing with colleagues without making the dashboard fully public.
- **Public**: visible in a gallery or search interface. Anyone can view; only the owner can edit (by opening the chat).

Public and unlisted dashboards are rendered read-only for viewers: the SDMXDashboard component loads the config and fetches live data from .Stat, but the chat panel is hidden. The owner sees an "Edit" button that opens the chat and resumes the session.

### 9.4 Institutional Curation

For SPC specifically, a layer above user-level sharing may be desirable: curated dashboards promoted to a "featured" or "official" status, implying editorial review. The data model supports this via a `status` field on the Dashboard entity (e.g., `draft`, `public`, `featured`). Curation workflows (submission, review, approval) are out of scope for the initial release but the schema should accommodate them from the start.

### 9.5 Persistence by Phase

| Phase | Config Storage | Session Storage | Sharing |
|-------|---------------|-----------------|---------|
| Phase 1 (PoC) | React state only (no save). Optionally: Gist export via existing demo app code. | None. Conversation lost on page refresh. | None. |
| Phase 2 | Gists (leveraging existing infrastructure) or PostgreSQL JSONB. | PostgreSQL: conversation history linked to dashboard ID. | Unlisted links (share config URL). |
| Phase 3 | Hybrid: PostgreSQL metadata + Gist config, or full PostgreSQL. | PostgreSQL with token usage tracking. | Private / Unlisted / Public. Gallery. Institutional curation. |

---

## 10. Development Phases

### 10.1 Phase 1: Proof of Concept

**Goal:** User can chat and see a dashboard appear, using all existing components.

- Add a new route to sdmx-dashboard-demo with split-pane layout: chat panel + SDMXDashboard component.
- Implement the agent loop: if using AI SDK v6 (recommended), add a Next.js API route with the agent loop and MCP client. If using LangGraph, stand up a FastAPI service alongside the Next.js app.
- Connect the agent loop to the MCP gateway via stdio subprocess.
- Include the config schema documentation in the agent's system prompt with example configs.
- Set up the cached system prompt prefix (Tier 1): dashboard library docs, SDMX conventions, dataflow catalogue summary, and example configs. Use Anthropic's prompt caching to amortise cost across turns (see Section 5.2).
- Implement the `update_dashboard` synthetic tool with full-config mode only (no patching yet).
- Dashboard re-renders live when the agent produces a config.
- Add basic `onRenderComplete` callback to SDMXDashboard: emit per-panel render status (success/failure) and feed it back to the agent so it can detect broken panels (see Section 6.1).
- No authentication; single-user. No persistence by default; optionally expose a "Save to Gist" button using the existing demo app's Gist integration (see Section 9.5).

**Estimated effort:** 2–3 weeks for 1–2 developers.

### 10.2 Phase 2: Iterative Editing, Multi-Dataflow, Export

**Goal:** Multi-turn editing; multi-dataflow dashboards; data export; dashboard-agent communication.

- Add HTTP transport to sdmx-mcp-gateway, replacing the stdio subprocess bridge. This is a prerequisite for production and benefits both the AI SDK and LangGraph paths.
- Add JSON Patch support to `update_dashboard` for incremental edits.
- Config schema validation at the agent loop level, with errors fed back to the agent for self-correction.
- Build the library self-description manifest: a build-time script in sdmx-dashboard-components that generates a compact capability manifest from source code (see Section 5.2.2). Replace the manual doc excerpt in the system prompt with this auto-generated manifest.
- Full structured state reporting: extend `onRenderComplete` with data summaries (observation counts, time ranges, geographic coverage per panel), filter state, and layout metadata (see Section 6.1).
- User interaction forwarding: add `onUserInteraction` callbacks to SDMXDashboard, capturing click events on chart elements and forwarding them as structured context to the agent (see Section 6.2).
- Implement session-level knowledge summary: the agent loop tracks which dataflows have been explored and injects a compact summary alongside conversation history, avoiding redundant MCP calls (see Section 5.2, Tier 2).
- Test and refine multi-dataflow dashboards (panels referencing different .Stat dataflows).
- Enhance per-panel CSV/Excel download (human-readable headers using codelist labels).
- Add full dashboard Excel export (multi-sheet workbook).
- Add PDF export for the rendered dashboard.
- Session persistence: dashboard configs and conversation history saved to PostgreSQL (or Gists); users can resume editing saved dashboards (see Section 9.2).
- Unlisted sharing: saved dashboards get a stable URL that can be shared as a read-only view.
- Undo/redo via config version history.

**Estimated effort:** 4–6 weeks.

### 10.3 Phase 3: Production, Security, Multi-User

**Goal:** Authenticated, abuse-resistant, multi-user deployment.

- Refactor sdmx-mcp-gateway for per-session state (eliminate global endpoint config).
- User authentication: SPC SSO or OAuth 2.0.
- Per-user and per-session token budgets; rate limiting on the agent loop endpoint.
- Input sanitisation: validate all agent-produced configs against JSON schema; prevent prompt injection from reaching SDMX queries.
- SDMX query safety: whitelist allowed .Stat endpoints; reject excessively broad queries.
- Dashboard visibility model: private / unlisted / public (see Section 9.3). Public dashboards appear in a gallery.
- Institutional curation: featured/official status for editorially reviewed dashboards (see Section 9.4).
- SPC branding and theming (Highcharts styled mode).
- Nightly dataflow catalogue generation: automated job that refreshes the Tier 1 dataflow directory in the cached system prompt.
- Agent-to-dashboard commands (experimental): allow the agent to highlight panels, annotate trends, or scroll to sections (see Section 6.4).
- Monitoring: agent loop telemetry, token usage, error rates, latency.

**Estimated effort:** 6–10 weeks.

---

## 11. Risks and Open Questions

| Risk / Question | Impact | Mitigation / Notes |
|----------------|--------|-------------------|
| Agent produces invalid dashboard configs | High — dashboard breaks. | Validate against the existing JSON schema before pushing to frontend; feed errors back to agent. |
| Agent produces invalid SDMX data URLs | High — panels fail to load. | The MCP's `build_data_query` already validates queries. Include `build_data_query` in the agent's workflow; never let the agent guess URLs. |
| Python–JS bridge complexity | Medium — the MCP is Python, the recommended agent loop is JS. | PoC uses stdio subprocess. Phase 2 adds HTTP transport. If bridge remains problematic, the LangGraph (Python) alternative eliminates it entirely. |
| MCP global state (multi-user) | High for production — endpoint switching affects all users. | Must refactor before Phase 3. Per-session subprocess is a stopgap. |
| Token cost per session | Medium — progressive discovery helps, but multi-turn editing still consumes tokens. | Prompt caching for stable knowledge (Tier 1); JSON patches reduce output; session-level knowledge summaries avoid redundant MCP calls; per-session token caps. |
| LLM resource abuse | High in production. | Authentication required; rate limits; monitoring. Not needed for PoC. |
| Config format evolution | Low–Medium — the existing format may gain new features. | Auto-generated library manifest (Section 5.2.2) stays in sync with code. Version the curated SDMX knowledge alongside the system prompt. |
| Highcharts licensing | Medium — Highcharts is not free for commercial use. | Verify SPC's Highcharts license covers this deployment. |

---

## 12. Scope Boundaries

### 12.1 In Scope

- Agent loop (server-side) with MCP tool integration.
- Chat UI integrated into the existing Next.js app.
- Live dashboard preview using existing SDMXDashboard component.
- Config generation conforming to the existing JSON schema.
- Iterative editing via multi-turn conversation.
- Context architecture: cached stable knowledge, session-level summaries, per-turn MCP calls.
- Dashboard-agent communication: structured state reporting and user interaction forwarding.
- Enhancements to sdmx-dashboard-components: event callbacks, self-description manifest.
- Data export: per-panel CSV/Excel, full dashboard Excel, formatted PDF.
- MCP transport: HTTP transport for the gateway (replacing stdio for production).
- Session persistence: saved dashboards with resumable conversations.
- Dashboard sharing: unlisted links (Phase 2), public gallery and institutional curation (Phase 3).
- Authentication, rate limiting, and abuse prevention (Phase 3).

### 12.2 Out of Scope

- Rewriting sdmx-dashboard-components or replacing Highcharts.
- Rewriting sdmx-mcp-gateway or changing its Python implementation.
- Direct manipulation of dashboards (drag-and-drop). Natural Phase 3+ feature.
- Data ingestion or ETL. The product reads from .Stat; it does not write to it.
- Custom panel types or plugin system.
- Mobile-native applications.
- Multi-user real-time collaboration on a single dashboard.
- Integration with data sources other than SPC .Stat.

---

## 13. Appendix: Glossary

| Term | Definition |
|------|-----------|
| MCP | Model Context Protocol. An open protocol for connecting AI models to external tools and data sources. |
| SDMX | Statistical Data and Metadata eXchange. An international standard for exchanging statistical data, used by .Stat. |
| .Stat | SPC's implementation of the .Stat Suite (OECD), an SDMX-based platform for disseminating official statistics. |
| Progressive discovery | The MCP gateway's approach to SDMX metadata: layered, lightweight calls (~2.5KB total) instead of loading full DSDs (100KB+). |
| DSD | Data Structure Definition. Describes the dimensions, attributes, and measures of an SDMX dataflow. |
| Codelist | An enumerated set of allowed values for an SDMX dimension, each with a code and a human-readable label. |
| Dashboard config | A JSON document conforming to the sdmx-dashboard-components schema, specifying rows, columns, component types, SDMX data URLs, and styling. |
| Agent loop | The server-side process that manages conversation, calls the LLM API, executes MCP tools, and produces dashboard configs. |
| update_dashboard | A synthetic tool (not part of the MCP) used by the agent to emit dashboard configs to the frontend. |
| AI SDK v6 | Vercel's TypeScript toolkit for AI applications (current major version). Provides agent abstractions, MCP support, streaming, and React hooks. |
| LangGraph | LangChain's Python framework for graph-based agent orchestration (v1.0). Alternative backend for the agent loop. |
| Prompt caching | Anthropic API feature that caches stable system prompt prefixes, reducing token cost by ~90% for repeated content across turns. |
| SSE | Server-Sent Events. A protocol for streaming data from server to client over HTTP. |
| JSON Patch (RFC 6902) | A standard format for describing incremental changes to a JSON document. |

---

## 14. Appendix: Repository References

| Repository | URL | Role |
|-----------|-----|------|
| sdmx-mcp-gateway | github.com/Baffelan/sdmx-mcp-gateway | MCP server for SDMX progressive discovery (Python) |
| sdmx-dashboard-components | github.com/PacificCommunity/sdmx-dashboard-components | React component library for SDMX dashboards (npm) |
| sdmx-dashboard-demo | github.com/PacificCommunity/sdmx-dashboard-demo | Next.js demo app for loading/rendering dashboard configs |
