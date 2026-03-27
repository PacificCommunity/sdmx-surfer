# MCP Query Probing and Visualization Guidance Design

**Date:** 2026-03-27
**Status:** Implemented with documented deviations
**Scope:** Add exact-result probing and bounded empty-query recovery to an SDMX-focused MCP server

---

## 1. Overview

This document specifies an MCP-side enhancement for SDMX data workflows where queries are often:

- syntactically valid,
- composed with valid dimension codes,
- supported by the target dataflow,
- but still empty for the exact combination requested.

The core problem is that existing availability and validation checks can confirm that a query is *allowed* without confirming that it returns any actual observations. This leads downstream systems, including LLM-driven analytical applications, to build charts, KPI cards, or maps on top of empty datasets.

This specification introduces a small set of MCP tools that answer three practical questions:

1. Does this exact SDMX query return any observations?
2. If it returns data, what is the observed shape of that result?
3. If it returns no data, what is the smallest validated change that makes the query non-empty?

The design is deliberately generic. It is written for maintainers of an SDMX-capable MCP server and does not assume familiarity with any specific client application.

## 1.1 Implementation Status

This document began as a proposal. The repository implementation now exists, but the final behavior diverged from the original plan in a few important ways:

- `probe_data_url` and `suggest_nonempty_queries` were implemented.
- `recommend_visualizations` was not implemented.
- On endpoints that support SDMX 2.1 `availableconstraint` well, especially SPC, exact availability is now used ahead of CSV probing.
- For SPC, exact availability returns a provider-specific `obs_count` annotation, which became the preferred count source.
- CSV probing remains in place as a fallback and as a way to extract sample observations and observed payload shape.

The rest of this document describes the intended design, with implementation notes where the code diverged.

## 2. Problem Statement

Many SDMX workflows already provide tooling for:

- discovering dataflows,
- listing codelists and dimension values,
- validating query syntax,
- checking broad time coverage,
- checking whether a code is used anywhere in a dataflow.

These capabilities are useful, but they do not solve the most operationally important question at chart-building time:

> Does this exact query produce observations right now?

Examples of failure cases:

- A KPI card is requested for a valid indicator, geography, and time period, but the exact slice is empty.
- A map query uses a valid geography code dimension and valid indicator, but the resulting query has zero observations for the chosen filters.
- A time series is requested for a valid set of dimensions, but the particular combination never co-occurs in the source data.

For smaller or less reliable LLMs, this gap is particularly harmful. They can produce queries that look correct and pass validation, yet still yield unusable results. The MCP should therefore expose exact-result probing as a first-class capability rather than leaving clients to infer it indirectly.

## 3. Goals

- Detect whether an exact SDMX query returns observations.
- Return compact machine-readable metadata about the observed result shape.
- Support bounded, explainable recovery from empty exact queries.
- Improve reliability for downstream charting, KPI, and mapping workflows.
- Keep outputs stable and concise enough for automated agents.
- Avoid unnecessary full-data downloads when lightweight probing is possible.

## 4. Non-Goals

- This work does not redesign existing validation or discovery tools.
- This work does not generate dashboard configuration or chart syntax.
- This work does not attempt exhaustive search over all possible dimension combinations.
- This work does not require UI-specific logic or assumptions about any one client.
- This work does not replace higher-level semantic recommendation systems, though it can support them.

## 5. Users and Use Cases

Primary users:

- LLM-driven analytical systems that construct SDMX queries programmatically.
- Interactive data exploration clients that need to check whether a query is worth rendering.
- Developer tooling that needs fast factual feedback on SDMX query viability.

Primary use cases:

- Validate a fully built data URL before rendering a chart.
- Confirm that a KPI query returns exactly one meaningful observation.
- Confirm that a would-be map query actually returns geographic observations.
- Recover from an empty query by relaxing the smallest possible number of filters.
- Rank nearby non-empty alternatives for automated or semi-automated retry.

## 6. High-Level Design

The MCP should expose two required tools and one optional follow-on tool:

1. `probe_data_url`
2. `suggest_nonempty_queries`
3. `recommend_visualizations` (optional but strongly desirable)

The design principle is:

- use the exact query as the source of truth,
- probe first,
- summarize observed result shape,
- recover only through bounded, validated alternatives.

## 7. Tool 1: `probe_data_url`

### 7.1 Purpose

Probe an exact SDMX query and return a compact summary of whether it contains data and what shape that data has.

This tool is the foundation for all later decisions. It must answer the question that syntax validation and code-usage checks cannot answer:

> Does this exact query return observations?

### 7.2 Accepted Inputs

Preferred input:

```json
{
  "data_url": "https://example.org/sdmx-json/data/DF_ID/....?startPeriod=2015&endPeriod=2024",
  "max_distinct_values_per_dimension": 10,
  "sample_observations_limit": 5,
  "timeout_ms": 10000
}
```

Alternative structured input, if direct URL probing is difficult internally:

```json
{
  "dataflow_id": "DF_ID",
  "filters": {
    "GEO": "FJ",
    "SEX": "T",
    "INDICATOR": "SP.POP.TOTL"
  },
  "start_period": "2015",
  "end_period": "2024",
  "format_type": "json"
}
```

The MCP may choose one canonical public contract, but the first form is recommended because many clients already build exact URLs and then need the MCP to probe them.

### 7.3 Required Output

```json
{
  "status": "nonempty",
  "observation_count": 124,
  "series_count": 3,
  "time_period_count": 12,
  "dimensions": {
    "GEO": {
      "distinct_count": 3,
      "sample_values": ["FJ", "WS", "TO"]
    },
    "TIME_PERIOD": {
      "distinct_count": 12,
      "sample_values": ["2013", "2014", "2015"]
    }
  },
  "has_time_dimension": true,
  "geo_dimension_id": "GEO",
  "sample_observations": [
    {
      "dimensions": {
        "GEO": "FJ",
        "TIME_PERIOD": "2023"
      },
      "value": 928784
    }
  ],
  "query_fingerprint": "sha256:...",
  "notes": []
}
```

Empty result example:

```json
{
  "status": "empty",
  "observation_count": 0,
  "series_count": 0,
  "time_period_count": 0,
  "dimensions": {},
  "has_time_dimension": false,
  "geo_dimension_id": null,
  "sample_observations": [],
  "query_fingerprint": "sha256:...",
  "notes": [
    "Query is syntactically valid but returned zero observations."
  ]
}
```

### 7.4 Output Semantics

- `status` must be one of `nonempty`, `empty`, `partial`, or `error`.
- `observation_count` was originally intended to mean observations directly counted from the returned data payload.
- Implemented deviation: when exact `availableconstraint` exposes a trustworthy provider count, the implementation now uses that count instead. On SPC this comes from the `obs_count` annotation and is more informative than a `firstNObservations=1` CSV probe.
- `series_count` should count distinct series if the source format and provider make that possible.
- `time_period_count` should count distinct observed time values.
- `dimensions` should summarize only dimensions observed in the result, not all theoretically available dimensions.
- `has_time_dimension` should be inferred from the actual result and, where needed, from DSD metadata.
- `geo_dimension_id` should identify the geography dimension when it can be inferred with reasonable confidence.
- `sample_observations` must be bounded and suitable for machine consumption.
- `query_fingerprint` should be derived from a normalized representation of the exact query.

### 7.5 Behavioral Requirements

- The tool must execute the exact query represented by the input.
- The tool must distinguish between syntactically valid-but-empty and transport/provider failure.
- The tool must return enough information for downstream systems to decide whether the result can drive a KPI, chart, or map.
- The tool should return compact dimension summaries rather than raw payload echoes.
- The tool should work across the common SDMX response formats already supported by the MCP.

### 7.6 Performance Requirements

- Prefer lightweight retrieval strategies over full result downloads.
- Use provider capabilities such as limited observations, series-key-only detail, or equivalent summary modes when available.
- Cache results by normalized query fingerprint.
- Support a configurable timeout.
- Avoid materializing very large result payloads solely to answer emptiness and shape questions.

### 7.8 Implemented Behavior

The final implementation is more provider-aware than the original generic plan:

- `probe_data_url` first normalizes the exact query and checks an in-memory cache.
- On endpoints whose configured single-flow constraint strategy is `availableconstraint`, it performs an exact availability preflight before any CSV request.
- If the exact availability response reports zero observations, probing returns `status = "empty"` immediately and does not fetch CSV.
- If the availability response reports a non-zero count, probing still performs a lightweight CSV fetch only when sample observations and observed shape are needed.
- On unsupported endpoints or failed availability preflight, the implementation falls back to CSV probing.

SPC-specific note:

- SPC implements `availableconstraint` and returns a non-standard `obs_count` annotation.
- Empty exact matches do not return HTTP 404. Instead, SPC returns a valid `ContentConstraint` with `obs_count = 0` and an inverted sentinel time range:
  - start `9999-01-01T00:00:00`
  - end `0001-12-31T23:59:59`
- The implementation treats that inverted range as an empty-result sentinel, not as real availability.

### 7.7 Error Handling

Use `status = "error"` when:

- the provider is unreachable,
- the remote endpoint returns a hard error,
- the response format is unsupported,
- the probe cannot be completed.

Use `status = "partial"` when:

- the tool can confirm non-emptiness or emptiness,
- but cannot reliably compute all summary fields.

Errors must be structured. Clients should not need server logs to understand what happened.

## 8. Tool 2: `suggest_nonempty_queries`

### 8.1 Purpose

Given an exact query that may be empty, suggest nearby non-empty variants by relaxing the smallest possible amount of filtering, subject to a strict probe budget.

This tool is intended to support graceful recovery instead of dead-end failure.

### 8.2 Accepted Inputs

```json
{
  "data_url": "https://example.org/sdmx-json/data/DF_ID/....",
  "relax_dimensions": ["GEO", "SEX", "AGE", "TIME_PERIOD"],
  "max_suggestions": 5,
  "max_probes": 20,
  "strategy": "least_change",
  "intent_hint": "generic"
}
```

Allowed `intent_hint` values:

- `generic`
- `kpi`
- `timeseries`
- `ranking`
- `map`

Structured query input may also be supported, but the output should remain the same.

### 8.3 Required Behavior

- Probe the original exact query first.
- If it is non-empty, return that fact and do not propose unnecessary alternatives.
- If it is empty, explore nearby candidate queries within a bounded probe budget.
- Rank suggestions by minimal deviation from the original query.
- Validate every returned suggestion by probing it before returning it.
- Explain what changed in each suggestion.

### 8.4 Allowed Relaxation Operations

- Replace one filter value with “all values” for that dimension.
- Widen a time range.
- Drop one non-essential slicer.
- If cheaply available, substitute with dimension values known to co-occur in actual data.

### 8.5 Disallowed Recovery Behavior

- Unbounded brute-force search across large codelists.
- Returning hypothetical suggestions that were not probed.
- Changing the core indicator or measure unless explicitly permitted by the input contract.
- Making large multi-dimension changes before simpler one-dimension relaxations are attempted.

### 8.6 Required Output

```json
{
  "original_status": "empty",
  "original_query_fingerprint": "sha256:...",
  "suggestions": [
    {
      "rank": 1,
      "change_summary": "Relaxed SEX from M to all values",
      "changed_dimensions": ["SEX"],
      "suggested_data_url": "https://example.org/sdmx-json/data/DF_ID/....",
      "probe_result": {
        "status": "nonempty",
        "observation_count": 24,
        "series_count": 1,
        "time_period_count": 24
      }
    }
  ],
  "probes_used": 6,
  "notes": []
}
```

### 8.7 Ranking Rules

Suggestions should be ranked to preserve user intent as much as possible.

Ranking priority:

1. Fewer changed dimensions.
2. Narrower changes before broader changes.
3. Preserve the originally requested indicator or measure.
4. Preserve geography for map-like use cases.
5. Preserve time variation for time-series use cases.
6. Prefer suggestions whose resulting shape is still useful for the hinted intent.

### 8.8 Probe Budget

The implementation must be bounded.

Requirements:

- Honor `max_probes`.
- Stop early once the maximum number of sufficiently good suggestions is found.
- Prefer one-dimension relaxations before trying two-dimension relaxations.
- Keep the algorithm explainable and deterministic.

### 8.9 Implemented Behavior

The final implementation diverged from the original plan in one important way:

- `suggest_nonempty_queries` now evaluates the original query and each relaxation candidate through exact `availableconstraint` first when the endpoint supports it.
- This means empty SPC candidates can be rejected without any CSV download.
- For non-empty candidates, the returned `probe_result.observation_count` can come from exact availability rather than from CSV row counting.
- `series_count` and `time_period_count` are filled conservatively from exact availability metadata when they can be inferred without guessing.
- CSV is still used as a fallback when exact availability is unavailable.

## 9. Optional Tool 3: `recommend_visualizations`

### 9.1 Purpose

Given a non-empty exact query, return machine-readable guidance about which broad visualization families fit the observed result shape.

This is especially useful for smaller LLMs that struggle to infer chart semantics from raw SDMX results.

### 9.2 Example Output

```json
{
  "status": "ok",
  "suitable_visualizations": [
    {
      "kind": "kpi",
      "confidence": "high",
      "reason": "Exactly one observation returned."
    },
    {
      "kind": "timeseries",
      "confidence": "high",
      "reason": "TIME_PERIOD varies across 24 values."
    },
    {
      "kind": "map",
      "confidence": "medium",
      "reason": "A geography dimension is present with multiple geographies."
    }
  ],
  "dimension_roles": {
    "TIME_PERIOD": "time",
    "GEO": "geo",
    "OBS_VALUE": "measure",
    "SEX": "series"
  }
}
```

### 9.3 Notes

This tool should be derived from:

- actual observed result shape,
- DSD metadata,
- lightweight heuristics grounded in the actual query result.

It should not be based purely on prompt-like rules or naming conventions when better evidence is available.

## 10. Query Normalization and Fingerprinting

Both required tools should normalize equivalent queries before caching or fingerprinting.

Normalization should account for:

- equivalent parameter ordering,
- default format parameters,
- semantically identical empty query-string permutations,
- redundant parameters that do not alter the result.

The goal is that semantically identical queries generate the same `query_fingerprint`.

## 11. Implementation Guidance

The MCP implementation may use any internal strategy that satisfies the external contract.

Preferred implementation order:

1. Parse and normalize the exact query.
2. Probe via the cheapest available provider-supported mechanism.
3. Compute observation count and lightweight dimension summaries.
4. Infer time and geography roles from the observed result plus DSD metadata.
5. Cache the probe result.
6. For recovery, generate a bounded list of nearby candidates and probe them in rank order.

Preferred internal techniques:

- limited-observation requests,
- provider-specific “series key only” or similar detail modes,
- partial parsing sufficient for counting and summarization,
- reuse of existing DSD and codelist metadata helpers.

### 11.1 Where Implementation Diverged

The implemented system reused more of the existing constraint infrastructure than this proposal originally assumed.

What changed:

- Exact availability was integrated into `get_data_availability`, `probe_data_url`, and `suggest_nonempty_queries`.
- The implementation now relies on endpoint-specific constraint strategy metadata already present in the repository configuration.
- Ordered SDMX key construction for structured probing was fixed to use DSD dimension order, not alphabetical filter order.
- Probe caching was adjusted to include shape-affecting parameters such as sample limits.
- Suggestion generation preserves non-time query parameters when relaxing candidates.

What was not implemented:

- `recommend_visualizations`
- a fully provider-neutral exact availability abstraction with identical semantics across all endpoints
- a pure no-data-download probing mode for non-empty queries that still returns sample observations

## 12. Safety and Robustness Requirements

- Tools must never claim non-emptiness unless actual observations were confirmed.
- Recovery suggestions must never be returned unprobed.
- The implementation must degrade gracefully when a provider does not support an optimization.
- Result summaries must stay bounded even for large result sets.
- Output should remain stable enough for deterministic downstream use.

## 13. Acceptance Criteria

The implementation is acceptable when all of the following are true:

1. A syntactically valid but empty query is reported as `status = "empty"`.
2. A non-empty exact query returns actual observation counts.
3. The probe output is sufficient to distinguish likely KPI, map, and time-series cases.
4. Recovery suggestions are based on actual successful probes, not guesses.
5. Suggestion ranking preserves the original query intent as much as possible.
6. The recovery algorithm respects a strict probe budget.
7. The implementation does not rely on brute-force cartesian search.
8. The tools are usable by automated agents without hidden conventions.

### 13.1 Acceptance Status

Current status against the criteria:

1. Met: exact empty queries are reported as `empty`.
2. Met with deviation: non-empty exact queries can return provider-reported observation counts from exact availability.
3. Partially met: `probe_data_url` returns enough shape information for KPI, map, and time-series decisions, but no dedicated visualization recommender exists.
4. Met: recovery suggestions are validated before being returned.
5. Met: ranking preserves intent by preferring small relaxations and deferring geography or time relaxations when hinted.
6. Met: strict probe budget is enforced.
7. Met: no brute-force cartesian search is used.
8. Met: the tools are MCP-usable without hidden state once the server is restarted after code changes.

## 14. Test Plan

At minimum, add coverage for:

- exact non-empty query,
- exact empty query with fully valid codes,
- one-dimension relaxation producing a non-empty result,
- no viable non-empty suggestion within the probe budget,
- time-range widening producing a non-empty result,
- map-like query where geography is preserved,
- KPI-like query where the exact result contains exactly one observation,
- transport or provider failure,
- partial-result handling,
- repeated identical probes hitting the cache.

If the MCP already has multiple providers or multiple SDMX formats, include representative tests across those paths where feasible.

## 15. Rollout Plan

Recommended rollout:

1. Implement `probe_data_url`.
2. Add query normalization and caching.
3. Implement `suggest_nonempty_queries`.
4. Integrate exact `availableconstraint` into availability and probing paths for supported endpoints.
5. Update MCP tool documentation with examples aimed at agentic clients.
6. Optionally add `recommend_visualizations` later.

### 15.1 Actual Rollout

What was actually done:

1. Implemented `probe_data_url` with CSV probing, normalization, and caching.
2. Implemented `suggest_nonempty_queries`.
3. Fixed structured probing to build keys using DSD order.
4. Integrated exact `availableconstraint` into `get_data_availability` for supported endpoints.
5. Integrated exact `availableconstraint` into `probe_data_url`.
6. Integrated exact `availableconstraint` into `suggest_nonempty_queries`.
7. Documented the SPC-specific `obs_count` and empty sentinel behavior.

What remains open:

- optional visualization recommendation
- deciding whether non-empty probing should gain a count-only mode that skips CSV entirely when callers do not need sample observations

## 16. Rationale

This work addresses a failure mode that sits between query validation and chart rendering:

- validation can say “the query is allowed,”
- but only probing can say “the query actually returns data.”

Adding exact-result probing and bounded recovery at the MCP layer gives every downstream client a reusable, provider-aware truth source for non-empty data selection. It is a better architectural fit than forcing every application to rediscover emptiness handling independently.

## 17. Summary

The MCP should expose:

- a probe tool for exact-query observation checks,
- a bounded recovery tool for empty exact queries,
- and optionally a visualization-guidance tool based on observed result shape.

This will materially improve reliability for SDMX-driven analytical systems, especially those that rely on LLMs to compose queries automatically.
