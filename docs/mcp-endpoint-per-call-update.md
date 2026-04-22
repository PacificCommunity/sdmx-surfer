# MCP Gateway Update — Per-Call `endpoint=` Parameter

**Date:** 2026-04-22
**Upstream branch:** `feat/endpoint-per-call-param` (merged to `main`)
**Scope:** behavioural change in `sdmx-mcp-gateway` that the dashboarder's agent loop and prompts should adapt to.

## Dashboarder adoption status

**Last reviewed:** 2026-04-22

### Done

- **System prompt and docs** updated to teach the new 7-step workflow (discover → `build_data_url` → `probe_data_url` → `suggest_nonempty_queries` if empty → `update_dashboard`), the `nonempty` / `empty` / `error` probe-status contract, the per-call `endpoint=` pattern including retry on mismatch hints, and the SPC sentinel-time-range nuance for empty queries. Files: `lib/system-prompt.ts`, `CLAUDE.md`, `README.md`, `docs/technical-reference.md`.
- **Step budget retuned** from `NUDGE_AT=18` to `NUDGE_AT=20` in `app/api/chat/route.ts`, leaving 5 steps of grace below the hard cap for empty-recovery calls before a draft is forced. Doc references updated in `docs/technical-reference.md`, `README.md`, `docs/architecture.mmd`.
- **Data-sources table fixed for non-SPC endpoints.** Data Explorer links for ABS, ILO, FBOS, SBS, StatsNZ, BIS were silently building with `df[ag]=SPC` because the gateway emits bare-flow URLs and our parser defaulted agency to SPC. Each endpoint in `lib/endpoints-registry.ts` now carries a canonical `agency`; `parseApiUrl` in `lib/data-explorer-url.ts` uses the detected endpoint's agency as the fallback when the URL is bare-flow. Covered by `tests/data-explorer-url.test.ts` (30 cases using real gateway URL shapes).
- **Dataflow index endpoint stamping** (additive plumbing): `scripts/build-index.ts` passes `endpoint="SPC"` explicitly on MCP calls and stamps each entry; `DataflowIndexEntry.endpoint` is populated and surfaced via `/api/explore*`. No agent-side consumer reads the field yet.
- **`switch_endpoint` purge** (follow-up after gateway removal of both `switch_endpoint` and `switch_endpoint_interactive`): removed every reference from `lib/system-prompt.ts` and `CLAUDE.md`. Both now tell the model (and Claude Code) that per-call `endpoint=` is the only way to target a specific provider and that the session default is set once at gateway startup via `SDMX_ENDPOINT` and is immutable at runtime. No code paths in the dashboarder were calling the removed tools.

### Open

- **Gateway-side URL format.** `build_data_url` emits bare-flow (`/data/<FLOW>/<KEY>`) for every probed provider except OECD (which emits comma form). The dashboarder fallback table handles this today, but self-describing comma-form URLs would remove the fallback's load-bearing role and cover future format changes — especially OECD, where the real agency is a subagency (`OECD.SDD.NAD`, `OECD.CFE`, …) that only a comma-form URL carries. Low-priority upstream request.
- **Error-handling auto-retry on mismatch hints** (action item 2 below): handled at prompt level only. A server-side parser in the chat route that catches `Pass endpoint='X' to target it directly` hints and retries before the model spends a step is a possible follow-up.
- **Step-count measurement** (action item 5 below): the `NUDGE_AT` retune is reasoned, not measured. Worth a real cross-provider probe once there is traffic.
- **STATSNZ ops-readiness** (dashboarder-specific note below): the MCP gateway logs a warning and returns 401 when `SDMX_STATSNZ_KEY` is unset. Nothing on the dashboarder surfaces this in health / readiness.
- **Non-SPC dataflow name resolution.** `resolveDataflowNamesFromConfig` reads the SPC-only index and falls back to raw IDs for non-SPC flows. Accepted gap until the catalogue goes multi-endpoint. Once that happens, the already-stamped `endpoint` field on index entries becomes load-bearing.

## TL;DR

Every endpoint-scoped MCP tool now accepts an optional `endpoint=<key>` argument.

**Update 2026-04-22 (follow-up):** `switch_endpoint` and `switch_endpoint_interactive` have now been **removed** from the gateway. The stateless per-call pattern is the only supported way to target a provider. The session default endpoint is set once at server startup from `SDMX_ENDPOINT` (env var) and is immutable at runtime. If you want a different provider for a specific call, pass `endpoint=<KEY>`; if you want to change the session default, restart the server with a different `SDMX_ENDPOINT`.

**Backward compatibility:** Every existing agent that calls tools without `endpoint=` continues to work unchanged (tools still fall back to the session default). Agents that were calling `switch_endpoint` must migrate to `endpoint=` per-call — the dashboarder already did this in the initial round of adoption, so no action is needed here.

## What changed upstream

1. **16 endpoint-scoped tools gained an optional `endpoint: str | None = None` kwarg:**
   `list_dataflows`, `get_dataflow_structure`, `get_codelist`, `get_dimension_codes`, `get_code_usage`, `check_time_availability`, `find_code_usage_across_dataflows`, `get_data_availability`, `validate_query`, `build_key`, `build_data_url`, `probe_data_url`, `suggest_nonempty_queries`, `get_structure_diagram`, `compare_structures`, `compare_dataflow_dimensions` (the last already had `endpoint_a` / `endpoint_b`; still supported).

2. **`switch_endpoint` removed (follow-up).** Initially rewritten as a cheap pointer flip. Later removed entirely once per-call `endpoint=` was confirmed to be the only pattern in use. Session defaults are now set once at server startup from the `SDMX_ENDPOINT` env var and are immutable thereafter. `switch_endpoint_interactive` (elicitation) is also gone.

3. **Per-session client pool.** Each MCP session owns a dict of `SDMXProgressiveClient` keyed by endpoint. Repeated calls into the same endpoint reuse the same HTTP client (and therefore the same connection pool + version cache).

4. **Mismatch hints in error responses.** When a call fails because the dataflow doesn't exist on the targeted endpoint, error-field text now includes guidance like:

   > `Dataflow 'DF_CPI' not found on endpoint 'ECB'. Known on: ['SPC']. Pass endpoint='SPC' to target it directly.`

   The gateway remembers which dataflow IDs have been seen on which endpoints per session and uses that to sharpen the hint when possible. For genuinely unknown dataflows it falls back to a generic list of registered endpoints.

5. **`list_available_endpoints` note** points at the per-call pattern and explicitly states the session default is set at startup and not mutable at runtime.

## What the agent loop should change

### Prompt / system message updates

Any agent prompt that still mentions `switch_endpoint` is referring to a removed tool and should be purged. Replace with:

> **Only pattern for multi-provider work:** Pass `endpoint=<KEY>` directly on each tool call that needs a specific provider. The session's default endpoint is set at server startup and does not change during the session. You can gather data from two different providers in the same conversation turn by calling `list_dataflows(endpoint='SPC')` and `list_dataflows(endpoint='ECB')` in sequence (or in parallel if your agent runtime supports it) and each resolves to the right provider.
>
> There is no longer a `switch_endpoint` tool. If you need a specific provider to be the default for a whole conversation, set `SDMX_ENDPOINT` at server startup.

### Handling mismatch hints in tool errors

When a tool response's error field or `next_steps` list contains text like "Pass endpoint='X' to target it directly", the agent should:

- Parse the suggested endpoint key out of the hint.
- Retry the same call with `endpoint='X'` before asking the user anything.
- Surface the retry path in the user-facing explanation only if it matters ("I checked ECB first, then found this data on SPC").

This turns what used to be multi-turn dead-end interactions into single-turn self-corrections.

### Agent loop expectations

- Parallel cross-endpoint calls are now safe. Two `get_dataflow_structure` calls with different `endpoint=` values in the same `Promise.all` / `asyncio.gather` resolve to the correct provider each. The old behaviour silently targeted whichever endpoint was last switched-to.
- Step-count budgeting: the spec's measurements suggest cross-provider tasks that used to take 15-20 steps with `switch_endpoint` interleaving complete in ~8 steps with `endpoint=` per call. Worth revisiting any `NUDGE_AT` / step-cap thresholds in the loop.

## Dashboarder-specific notes

### `update_dashboard` authoring schema

Nothing to change. Dashboard specs don't carry endpoint information directly — the URLs produced by `build_data_url` encode it. Just make sure the agent calls `build_data_url` with the right `endpoint=` when the dataflow lives on a non-default provider.

### Tier 1 cached system prompt

If the cached prompt includes a section on "switching between providers", replace it with the per-call guidance above. This shrinks token usage on every turn.

### Tier 2 dataflow catalogue

The gateway's per-session registry is separate from the dashboard's own catalogue. If the dashboarder caches a dataflow catalogue across sessions (e.g. for search suggestions), annotate each entry with the endpoint it came from so the agent can pass `endpoint=` later without re-discovering.

### STATSNZ specifically

The STATSNZ integration (added in the same branch) requires a per-call subscription key on every request. The gateway handles this server-side via the `SDMX_STATSNZ_KEY` environment variable — the agent does not need to thread the key through. Just use `endpoint='STATSNZ'` and the gateway attaches the `Ocp-Apim-Subscription-Key` header automatically. If the key isn't set at startup the gateway logs a warning and requests will 401; surface that failure mode in the dashboarder's ops-readiness checks.

## Backward-compatibility matrix

| Behaviour | Original | After first round | After removal (2026-04-22) |
|---|---|---|---|
| `tool_name(...)` (no `endpoint=`) | Uses session default | Unchanged | Unchanged (session default is startup-time immutable) |
| `switch_endpoint('X')` then `tool_name(...)` | Targets X | Still works (pointer flip) | **Tool no longer exists** |
| `tool_name(..., endpoint='X')` | Error: unexpected kwarg | Targets X for this call only | Unchanged |
| `compare_dataflow_dimensions(..., endpoint_a='X', endpoint_b='Y')` | Creates + tears down temp clients | Uses pool (no tear-down) | Unchanged |
| Session default set at runtime | Yes, via `switch_endpoint` | Yes, via `switch_endpoint` | No. Set via `SDMX_ENDPOINT` env at startup only |

## Reference

- Spec: `../sdmx/MCP/docs/superpowers/specs/2026-04-17-endpoint-per-call-param-design.md`
- Plan: `../sdmx/MCP/docs/superpowers/plans/2026-04-21-endpoint-per-call-param.md`
- Smoke: `../sdmx/MCP/sdmx-mcp-gateway/tests/e2e/test_multiendpoint_smoke.py` and `test_multiendpoint_smoke_extended.py` — 41 live scenarios passing against SPC, ECB, UNICEF, IMF, BIS, ABS, ILO, OECD, FBOS, SBS (STATSNZ covered conditionally on key presence).
- Multi-user audit (not yet fixed): `../sdmx/MCP/docs/multi-user-session-isolation-audit.md` — relevant if the dashboarder plans to serve multiple concurrent users on one gateway instance. Three High-severity items to review before production.

## Action items for the dashboarder team

1. Update system prompt(s) to teach the agent the per-call `endpoint=` pattern.
2. Update error-handling to parse mismatch hints and auto-retry on the suggested endpoint.
3. Remove any "you must call `switch_endpoint` before …" language from cached prompts.
4. Update `CLAUDE.md` § *SDMX MCP Tools Available* to list `endpoint=` as a parameter on each endpoint-scoped tool.
5. Re-measure agent step count on cross-provider tasks; consider raising the NUDGE threshold if you had compensated for the old stateful churn.
6. If serving multiple concurrent users: read the multi-user audit doc before Phase 3.
