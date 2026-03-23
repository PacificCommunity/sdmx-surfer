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
**Transport:** stdio (currently); SSE planned for remote deployment

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

**Known limitation:** the gateway currently uses global state for endpoint configuration, making it single-user. For a multi-user web deployment, this must be refactored to per-session state (see Section 7).

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

Each component (cell) within a column specifies: `type` (line, bar, column, pie, drilldown, value, map, note), `data` (one or more SDMX query URLs with optional arithmetic expressions), `legend`, `xAxisConcept`, `yAxisConcept`, and styling options. This is the target output format for the agent's `update_dashboard` tool.

---

## 3. What Needs To Be Built

Given the existing codebase, the new work reduces to three deliverables:

### 3.1 The Agent Loop (Server-Side)

A server-side process that manages conversation state, calls the Anthropic API, executes MCP tool calls against the sdmx-mcp-gateway, and produces valid dashboard JSON configs. This is the core of the product and the primary engineering effort.

### 3.2 The Chat-to-Dashboard Web Interface

A web application with a split-pane layout: chat on one side, live dashboard preview on the other. The dashboard preview uses the existing SDMXDashboard component from sdmx-dashboard-components. When the agent produces or updates a config, it is passed directly to SDMXDashboard as a prop (or via a config URL) and the dashboard re-renders live.

### 3.3 The MCP Transport Bridge

The sdmx-mcp-gateway currently uses stdio transport, designed for local CLI use (e.g., Claude Desktop). For a web deployment, it needs to be accessible from the agent loop running on a server. Options include: running the gateway as a subprocess with stdio piping (simplest for PoC), adding SSE transport to the gateway (already planned per the repo), or wrapping the gateway's tools as plain HTTP endpoints that the agent loop calls directly.

---

## 4. Architecture

### 4.1 High-Level Data Flow

1. The user types a message in the chat interface (e.g., "Show me trade balance by country for Pacific Island states").
2. The frontend sends the message to the agent loop endpoint via SSE.
3. The agent loop calls the Anthropic API with conversation history, MCP tool definitions, and the `update_dashboard` tool.
4. The API returns `tool_use` requests. The agent loop executes these against the MCP gateway (e.g., `discover_dataflows_overview` with `keywords=["trade"]`, then `get_dataflow_structure`, then `explore_dimension_codes`, then `build_data_query`).
5. The API eventually invokes `update_dashboard` with a JSON config conforming to the sdmx-dashboard-components schema.
6. The agent loop streams the text response and pushes the config as a separate SSE event to the frontend.
7. The frontend passes the config to the SDMXDashboard component, which renders the dashboard and fetches SDMX data from .Stat directly.

### 4.2 Component Architecture

```
Browser
┌─────────────────┬────────────────────────────┐
│   Chat UI        │   SDMXDashboard component   │
│   (SSE client)   │   [EXISTING] Highcharts     │
│                  │   + data export (CSV/XLSX)  │
└───────┬─────────┴─────────┬──────────────────┘
        │  SSE stream       │  SDMX REST queries
        │                   │
Server  │                   │
┌───────┴─────────────────┐ │  ┌───────────┐
│ Agent Loop [NEW]        │ │  │ .Stat API │
│ Conversation + Tools    │ │  │ (SDMX)    │
│ Config Gen / Patching   │ │  └───────────┘
└────┬──────────┬─────────┘ │
     │ API call │ stdio/SSE │
     ↓          ↓           │
 Anthropic   sdmx-mcp-gateway
   API       [EXISTING] Python
```

---

## 5. Agent Loop Specification

The agent loop is the only component that is entirely new. It must:

- Maintain conversation history for the current session.
- Call the Anthropic API with conversation history, MCP tool definitions (mirroring the gateway's progressive discovery tools), and the `update_dashboard` synthetic tool.
- Execute the tool-use loop: when the API returns `tool_use` blocks, dispatch them to the MCP gateway (via stdio subprocess or SSE), feed results back, and re-call the API.
- Stream the agent's text response to the browser via SSE.
- Emit dashboard config events (separate from the text stream) when the agent invokes `update_dashboard`.
- Provide the agent with the sdmx-dashboard-components config schema (via system prompt or a dedicated tool) so it produces valid JSON.

### 5.1 The update_dashboard Tool

This synthetic tool is intercepted by the agent loop, not forwarded to the MCP. It accepts a full dashboard JSON config (conforming to the existing schema) or a JSON Patch array for incremental edits. When invoked, the loop validates the config against the JSON schema that sdmx-dashboard-demo already uses, and pushes it to the frontend.

### 5.2 Teaching the Agent the Config Format

The agent must understand the sdmx-dashboard-components config format well enough to produce valid JSON. The recommended approach is to include the config documentation (`public/doc.md` from the demo repo) in the system prompt, along with 2–3 example configs. This gives the model the schema, field semantics, and concrete examples. Additionally, a `get_config_schema` tool could return the JSON schema on demand if the system prompt budget is tight.

### 5.3 Implementation Options

**Option A — Vercel AI SDK:** Built-in Anthropic streaming, automatic tool-use loop, MCP integration, and `useChat` React hook. Since the demo app is already Next.js, this is a natural fit. Fastest path to prototype.

**Option B — Anthropic TypeScript SDK:** Manual tool-use loop (~50–80 lines). More control over how MCP responses are processed and how configs are validated before emission. Recommended if the Vercel AI SDK's MCP integration doesn't cleanly support the Python gateway's stdio transport.

---

## 6. Technology Stack

The stack is largely determined by the existing codebase. New additions are marked.

| Layer | Technology | Status |
|-------|-----------|--------|
| MCP server | sdmx-mcp-gateway (Python, FastMCP) | Exists. Needs per-session state + SSE transport. |
| Dashboard components | sdmx-dashboard-components (React, Highcharts, Vite) | Exists (npm v0.4.5). May need export enhancements. |
| Dashboard app shell | sdmx-dashboard-demo (Next.js, Docker) | Exists. Will be extended with chat UI + agent route. |
| Agent loop | Node.js / Bun + Anthropic SDK or Vercel AI SDK | **NEW.** Core deliverable. |
| Chat UI | React + useChat (Vercel AI SDK) or custom SSE client | **NEW.** Integrates into the Next.js app. |
| AI API | Anthropic Messages API (Claude Sonnet 4) | External service. Native MCP + streaming. |
| MCP transport bridge | stdio subprocess or SSE bridge to Python gateway | **NEW.** Connects JS agent loop to Python MCP. |
| Config patching | fast-json-patch (RFC 6902) | **NEW.** For incremental edits. |
| Data export (CSV/XLSX) | SheetJS or Highcharts export module | Partial (download flag exists). May need enhancement. |
| PDF export | Puppeteer (server-side) or html2canvas + jsPDF | **NEW.** Publication-quality dashboard snapshots. |
| Persistence | PostgreSQL + Drizzle ORM (or GitHub Gists) | Partially exists (Gist storage). Expand for sessions. |
| Authentication | SPC SSO / OAuth 2.0 (Phase 3) | **NEW.** Required for production. |
| Rate limiting | Token-bucket middleware + per-session LLM cost caps | **NEW.** Required for production. |

---

## 7. Key Design Decisions

### 7.1 Extend, Don't Replace

The existing dashboard components and demo app are mature (130+ commits, 159+ commits respectively). The architecture must add the conversational layer without forking or substantially rewriting these projects. The chat UI and agent loop should be added as new routes and components within the existing Next.js app, importing SDMXDashboard directly.

### 7.2 The Agent Produces Configs, Not Code

The agent's output is a JSON config conforming to the existing schema. It never writes React code, Highcharts options, or SDMX parsing logic. This means the agent's correctness can be validated mechanically (JSON schema validation) before the config reaches the renderer.

### 7.3 Progressive Discovery Is Already Solved

The MCP gateway's progressive discovery workflow (overview → structure → dimension codes → availability → query) is exactly what the agent needs to go from a user's natural-language request to a valid SDMX data URL. The agent loop does not need its own SDMX logic; it delegates entirely to the MCP tools. The system prompt should instruct the agent to follow the progressive discovery workflow.

### 7.4 MCP Gateway Needs Per-Session State

The gateway currently uses global state for endpoint configuration, which is unsuitable for multi-user deployment. Before production, this must be refactored. Options: run a separate gateway subprocess per user session (simple but resource-heavy), implement per-session state via MCP context (as noted in the repo's own roadmap), or extract the gateway's logic into a stateless HTTP API called by the agent loop.

### 7.5 Dedicated Tool for Config Emission

The agent communicates config changes via the `update_dashboard` synthetic tool rather than embedding JSON in its text output. This keeps the conversational response clean and makes config updates programmatically interceptable, validatable, and pushable to the frontend on a separate channel.

### 7.6 Data Export Strategy

The existing component library already supports a per-chart download flag (Highcharts' built-in export). For full dashboard data export (multi-sheet Excel) and PDF export, new functionality will need to be added — either as enhancements to sdmx-dashboard-components or as features in the host application. Highcharts' server-side export module or client-side html2canvas + jsPDF are the main options for PDF.

---

## 8. Development Phases

### 8.1 Phase 1: Proof of Concept

**Goal:** User can chat and see a dashboard appear, using all existing components.

- Add a new route to sdmx-dashboard-demo with split-pane layout: chat panel + SDMXDashboard component.
- Implement the agent loop as a Next.js API route using the Vercel AI SDK (or Anthropic SDK).
- Connect the agent loop to the MCP gateway via stdio subprocess.
- Include the config schema documentation in the agent's system prompt with example configs.
- Implement the `update_dashboard` synthetic tool with full-config mode only (no patching yet).
- Dashboard re-renders live when the agent produces a config.
- No authentication; single-user; no persistence.

**Estimated effort:** 2–3 weeks for 1–2 developers.

### 8.2 Phase 2: Iterative Editing, Multi-Dataflow, Export

**Goal:** Multi-turn editing; multi-dataflow dashboards; data export.

- Add JSON Patch support to `update_dashboard` for incremental edits.
- Config schema validation at the agent loop level, with errors fed back to the agent for self-correction.
- Test and refine multi-dataflow dashboards (panels referencing different .Stat dataflows).
- Enhance per-panel CSV/Excel download (human-readable headers using codelist labels).
- Add full dashboard Excel export (multi-sheet workbook).
- Add PDF export for the rendered dashboard.
- Session persistence (PostgreSQL or extended Gist storage).
- Undo/redo via config version history.

**Estimated effort:** 4–6 weeks.

### 8.3 Phase 3: Production, Security, Multi-User

**Goal:** Authenticated, abuse-resistant, multi-user deployment.

- Refactor sdmx-mcp-gateway for per-session state (eliminate global endpoint config).
- User authentication: SPC SSO or OAuth 2.0.
- Per-user and per-session token budgets; rate limiting on the agent loop endpoint.
- Input sanitisation: validate all agent-produced configs against JSON schema; prevent prompt injection from reaching SDMX queries.
- SDMX query safety: whitelist allowed .Stat endpoints; reject excessively broad queries.
- Dashboard sharing (read-only links).
- SPC branding and theming (Highcharts styled mode).
- Monitoring: agent loop telemetry, token usage, error rates, latency.

**Estimated effort:** 6–10 weeks.

---

## 9. Risks and Open Questions

| Risk / Question | Impact | Mitigation / Notes |
|----------------|--------|-------------------|
| Agent produces invalid dashboard configs | High — dashboard breaks. | Validate against the existing JSON schema before pushing to frontend; feed errors back to agent. |
| Agent produces invalid SDMX data URLs | High — panels fail to load. | The MCP's `build_data_query` already validates queries. Include `build_data_query` in the agent's workflow; never let the agent guess URLs. |
| Python–JS bridge complexity | Medium — the MCP is Python, the agent loop is JS. | PoC uses stdio subprocess. If unreliable, add SSE transport to the gateway or wrap tools as HTTP. |
| MCP global state (multi-user) | High for production — endpoint switching affects all users. | Must refactor before Phase 3. Per-session subprocess is a stopgap. |
| Token cost per session | Medium — progressive discovery helps, but multi-turn editing still consumes tokens. | JSON patches reduce output; cache MCP responses within session; per-session token caps. |
| LLM resource abuse | High in production. | Authentication required; rate limits; monitoring. Not needed for PoC. |
| Config format evolution | Low–Medium — the existing format may gain new features. | Version the agent's system prompt alongside component library releases. |
| Highcharts licensing | Medium — Highcharts is not free for commercial use. | Verify SPC's Highcharts license covers this deployment. |

---

## 10. Scope Boundaries

### 10.1 In Scope

- Agent loop (server-side) with MCP tool integration.
- Chat UI integrated into the existing Next.js app.
- Live dashboard preview using existing SDMXDashboard component.
- Config generation conforming to the existing JSON schema.
- Iterative editing via multi-turn conversation.
- Data export: per-panel CSV/Excel, full dashboard Excel, formatted PDF.
- MCP transport bridge (stdio or SSE) for web deployment.
- Session persistence.
- Authentication, rate limiting, and abuse prevention (Phase 3).

### 10.2 Out of Scope

- Rewriting sdmx-dashboard-components or replacing Highcharts.
- Rewriting sdmx-mcp-gateway or changing its Python implementation.
- Direct manipulation of dashboards (drag-and-drop). Natural Phase 3+ feature.
- Data ingestion or ETL. The product reads from .Stat; it does not write to it.
- Custom panel types or plugin system.
- Mobile-native applications.
- Multi-user real-time collaboration on a single dashboard.
- Integration with data sources other than SPC .Stat.

---

## 11. Appendix: Glossary

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
| SSE | Server-Sent Events. A protocol for streaming data from server to client over HTTP. |
| JSON Patch (RFC 6902) | A standard format for describing incremental changes to a JSON document. |

---

## 12. Appendix: Repository References

| Repository | URL | Role |
|-----------|-----|------|
| sdmx-mcp-gateway | github.com/Baffelan/sdmx-mcp-gateway | MCP server for SDMX progressive discovery (Python) |
| sdmx-dashboard-components | github.com/PacificCommunity/sdmx-dashboard-components | React component library for SDMX dashboards (npm) |
| sdmx-dashboard-demo | github.com/PacificCommunity/sdmx-dashboard-demo | Next.js demo app for loading/rendering dashboard configs |
