# MCP Gateway Update — Per-Call `endpoint=` Parameter

**Date:** 2026-04-22
**Upstream branch:** `feat/endpoint-per-call-param` (merged to `main`)
**Scope:** behavioural change in `sdmx-mcp-gateway` that the dashboarder's agent loop and prompts should adapt to.

## TL;DR

Every endpoint-scoped MCP tool now accepts an optional `endpoint=<key>` argument. Agents no longer need to call `switch_endpoint` before a per-call provider switch. `switch_endpoint` still exists, but is now a pointer flip (cheap, non-destructive) and is only needed when the agent wants the session's default endpoint to change for subsequent untargeted calls.

**Fully backward compatible.** Every existing agent that calls tools without `endpoint=` continues to work unchanged.

## What changed upstream

1. **16 endpoint-scoped tools gained an optional `endpoint: str | None = None` kwarg:**
   `list_dataflows`, `get_dataflow_structure`, `get_codelist`, `get_dimension_codes`, `get_code_usage`, `check_time_availability`, `find_code_usage_across_dataflows`, `get_data_availability`, `validate_query`, `build_key`, `build_data_url`, `probe_data_url`, `suggest_nonempty_queries`, `get_structure_diagram`, `compare_structures`, `compare_dataflow_dimensions` (the last already had `endpoint_a` / `endpoint_b`; still supported).

2. **`switch_endpoint` is a pointer flip.** Previously it tore down the session's HTTP client and rebuilt it. Now it just rewrites `SessionState.default_endpoint_key` and keeps the pooled client for the old endpoint warm. Switching back is free.

3. **Per-session client pool.** Each MCP session owns a dict of `SDMXProgressiveClient` keyed by endpoint. Repeated calls into the same endpoint reuse the same HTTP client (and therefore the same connection pool + version cache).

4. **Mismatch hints in error responses.** When a call fails because the dataflow doesn't exist on the targeted endpoint, error-field text now includes guidance like:

   > `Dataflow 'DF_CPI' not found on endpoint 'ECB'. Known on: ['SPC']. Pass endpoint='SPC' to target it directly.`

   The gateway remembers which dataflow IDs have been seen on which endpoints per session and uses that to sharpen the hint when possible. For genuinely unknown dataflows it falls back to a generic list of registered endpoints.

5. **`switch_endpoint` result hint** now includes an informational line reminding agents they can pass `endpoint=` per call.

## What the agent loop should change

### Prompt / system message updates

The current implicit pattern in most agent prompts is: *"To query a different provider, call `switch_endpoint` first, then your tool."* That's now the slow path. Replace with:

> **Preferred pattern for multi-provider work:** Pass `endpoint=<KEY>` directly on each tool call that needs a specific provider. The session's default endpoint stays put unless you explicitly call `switch_endpoint`. You can gather data from two different providers in the same conversation turn without any switching: call `list_dataflows(endpoint='SPC')` and `list_dataflows(endpoint='ECB')` in sequence (or in parallel if your agent runtime supports it) and each resolves to the right provider.
>
> **When to use `switch_endpoint`:** when the user has settled on a provider for the rest of the conversation and you want subsequent untargeted calls to default to it. Think of it as changing the focus of the session, not as a prerequisite to each call.

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

| Behaviour | Before | After |
|---|---|---|
| `tool_name(...)` (no `endpoint=`) | Uses session default | Unchanged |
| `switch_endpoint('X')` then `tool_name(...)` | Targets X | Targets X (unchanged) |
| `tool_name(..., endpoint='X')` | N/A (error: unexpected kwarg) | Targets X for this call only |
| `compare_dataflow_dimensions(..., endpoint_a='X', endpoint_b='Y')` | Creates + tears down temp clients | Uses pool (no tear-down) |
| Switch, call, switch back, call | 4 HTTP client builds | 2 HTTP client builds; pool reuse |

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
