# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This repository contains the **scoping and architecture documents** for SPC's Conversational Dashboard Builder — a web product that lets users create SDMX data dashboards through natural-language conversation with an AI agent. No code has been implemented yet; the repo holds architecture specs, UI mockups, and design system assets.

The product integrates three existing repositories (none of which live here):
- **sdmx-mcp-gateway** (Python, Baffelan/sdmx-mcp-gateway) — MCP server for progressive SDMX discovery on SPC's .Stat platform
- **sdmx-dashboard-components** (TypeScript/React, PacificCommunity/sdmx-dashboard-components) — npm library (v0.4.5) rendering dashboards from JSON configs via Highcharts
- **sdmx-dashboard-demo** (TypeScript/Next.js, PacificCommunity/sdmx-dashboard-demo) — existing Next.js app that loads and renders dashboard JSON configs

The **new deliverable** is the AI agent loop: a server-side process that connects a chat interface to the MCP gateway, produces valid dashboard JSON configs through conversation, and pushes them to the existing SDMXDashboard component for live preview.

## Repository Structure

- `dashboard-architecture.md` — primary architecture document (Version 0.2, March 2026). Covers all components, the agent loop spec, context/prompt caching strategy, technology choices, persistence model, and phased delivery plan.
- `stitch_assets/dashboard_architecture.md` — earlier version of the same architecture document.
- `stitch_assets/stitch/` — UI mockup screens (HTML + PNG) for: welcome page, conversational builder, dimension explorer, dashboard preview, multi-dataflow dashboards. Desktop and mobile variants.
- `stitch_assets/stitch/oceanic_logic/DESIGN.md` — "Oceanic Data-Scapes" design system: color palette, typography (Manrope + Inter), elevation/depth rules, component styling, Highcharts-compatible chart palette.

## Key Architecture Decisions

- **Agent produces dashboard specs, not code.** Preferred output is the app-level authoring schema (`kpi`, `chart`, `map`, `note` intent visuals), which is compiled server-side into the native sdmx-dashboard-components config. Native passthrough remains available for advanced cases.
- **Recommended stack:** AI SDK v6 (TypeScript) with the agent loop as a Next.js API route inside sdmx-dashboard-demo. Alternative: LangGraph + FastAPI (Python) as a separate backend service.
- **MCP transport:** stdio subprocess for Phase 1 PoC; HTTP transport (planned in gateway roadmap) for Phase 2+.
- **`update_dashboard` synthetic tool** — intercepted by the agent loop (not forwarded to MCP), accepts either authoring specs or native config passthrough and compiles authoring specs before preview.
- **Three-tier context architecture:** Tier 1 (cached system prompt: library docs, SDMX conventions, dataflow catalogue, example configs ~10-15K tokens), Tier 2 (session-level: discovered dataflow summaries), Tier 3 (per-turn: fresh MCP calls).
- **Dashboard-agent communication:** `onRenderComplete` and `onUserInteraction` callbacks feed structured state back to the agent loop.

## Development Phases

- **Phase 1 (PoC):** Chat + live preview, agent loop with MCP via stdio, `update_dashboard` (full config only), basic render state feedback. No auth, no persistence.
- **Phase 2:** HTTP transport for MCP, JSON Patch support, full state reporting, user interaction forwarding, session persistence, export (CSV/Excel/PDF), undo/redo.
- **Phase 3:** Auth (SPC SSO/OAuth), per-session MCP state, rate limiting, public gallery, institutional curation, monitoring.

## SDMX MCP Tools Available

This project has an active MCP connection to sdmx-mcp-gateway. The progressive discovery workflow is: `list_dataflows` → `get_dataflow_structure` → `get_dimension_codes` → `check_time_availability` / `get_data_availability` → `build_data_url`. Additional tools: `get_codelist`, `validate_query`, `compare_structures`, `find_code_usage_across_dataflows`, `switch_endpoint`.

## Design System Quick Reference

"Oceanic Data-Scapes" / "The Modern Navigator" theme:
- **No 1px borders.** Separate regions via tonal surface shifts.
- **Surface hierarchy:** base `#f7fafc` → container_low `#f1f4f6` → white cards `#ffffff` → high `#e5e9eb`
- **Primary palette:** Deep Sea `#004467`, Reef Teal `#006970`, Lagoon `#6fd6df`, Kelp `#244445`, Soft Mist `#abcdcd`
- **Typography:** Manrope (display/headlines), Inter (interface/data)
- **Corners:** minimum 0.5rem radius everywhere
- **Text color:** `#181c1e` (never pure black)
- **Glassmorphism:** 85% opacity surface + 20px backdrop-blur for floating panels
