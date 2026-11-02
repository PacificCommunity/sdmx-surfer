On rc.1, visual failures surface in different ways depending on the component:

- chart and table print a fixed "Failed to load chart." / "Failed to load table." and log to the console;
- value and map leave an unhandled promise rejection and a "Loading" placeholder that never goes away;
- nothing tells a consumer when a dashboard has finished rendering.

This PR routes every failure through one typed error, `SDMXRenderError`, with seven codes. The error is shown in a panel with `role="alert"` and `data-error-code`, and is reported through new `onVisualRender` / `onRenderComplete` callbacks. The downstream app (SDMX Surfer) has an LLM agent that reads these codes and messages to correct the dashboard configs it writes, so the message texts are asserted by tests. This is the base of most of the remaining PRs.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/test-setup}}. Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/test-setup...pr/error-contract

Own commits to review:
- 71c6d8d Report render status and typed errors from every visual (port of fork f49c3e9 + 492ca93)
- df06139 Report a 404 without records as ERR_EMPTY
- 6c855cf Show a failed chart in a compact panel

## Changes

<details><summary>Public API (all additive)</summary>

```ts
// lib/errors.ts, exported from the root: SDMXRenderError, SDMXRenderErrorCode
export type SDMXRenderErrorCode = "ERR_FETCH" | "ERR_PARSE" | "ERR_EMPTY"
  | "ERR_NO_SERIES_DIMENSION" | "ERR_AMBIGUOUS_SERIES" | "ERR_CONCEPT_NOT_FOUND" | "ERR_ENGINE";
export class SDMXRenderError extends Error {
  code: SDMXRenderErrorCode; visualId?: string; detail?: Record<string, unknown>; cause?: unknown;
}

// lib/components/types.ts, VisualRenderStatus exported from the root
export type VisualRenderStatus = {
  visualId: string,
  status: "loading" | "rendered" | "empty" | "error",
  error?: SDMXRenderError,                       // "error" and "empty"
  stats?: { observationCount: number, seriesCount: number, timePeriodRange?: [string, string] } // "rendered"
}
export type SDMXVisualProps = { onVisualRender?: (status: VisualRenderStatus) => void } // not exported from the root

// SDMXChart, SDMXTable, SDMXValue, SDMXMap: + SDMXVisualProps
// SDMXDashboard: + SDMXVisualProps + onRenderComplete?: (all: VisualRenderStatus[]) => void
```
</details>

- `lib/errors.ts` (new): the class. `toSDMXRenderError(error, visualId)` classifies parser and network errors by message, because the parser re-wraps errors with `new Error(err)`, and falls back to `ERR_ENGINE` with the original error as `cause`. Also new: `emptyDataError` (the same message in every component) and `engineError`.
- The plain `Error`s thrown while building charts are now typed: concept not found (with the available concepts in `detail`), the line chart's "No other dimension", a missing drilldown concept, and an unknown attribute in a text expression.
- `ERR_ENGINE`: every ECharts call (setOption, resize, drilldown, theme switch) runs inside a guard, and an instance that threw is disposed. ECharts 6 has no `error` event, and a broken instance throws again on its next frame.
- Value and map run their whole pipeline in one promise chain that ends in a `catch`.
- `Cell` forwards visual props unchanged, and its error boundary reports render-time throws. `SDMXDashboard` forwards `onVisualRender` from every cell and fires `onRenderComplete` once per config and language, after every data visual has settled (`[]` when there are none).
- `lib/utils/renderStats.ts`: `computeRenderStats(data, seriesCount)`. `lib/utils/useLatest.ts`: callbacks are read through a ref, so inline callbacks do not re-trigger fetching.
- `loadDatasets` (internal) takes `(config, language)` instead of `(data, xAxisConcept, language)`.
- `README.md`: "Error contract" and "Render lifecycle" sections.

## Behaviour changes vs rc.1

| | rc.1 | This PR |
|---|---|---|
| Chart/table failure | fixed "Failed to load …" text | the typed message in an alert panel with `data-error-code` |
| Value/map failure | unhandled rejection, permanent "Loading" | typed error panel, no unhandled rejection |
| Zero observations | per component | `ERR_EMPTY` in every component; the status is `empty`, not `error` |
| 404 whose body reports no records (parser 0.4.1 `NO_RECORDS`) | generic fetch error | `ERR_EMPTY`; other 404s stay `ERR_FETCH` |
| ECharts throws | propagates | caught, instance disposed, `ERR_ENGINE` |
| Failed chart size | message laid over the full 400 px box | chart box collapsed (kept at its size, so no resize is needed when it recovers); the panel sits in the flow at content height, min 120 px. Loading still covers the full box |

## Tests

`npm test`: 7 files, **48 passed** (base {{PR:pr/test-setup}}: 10).

- `lib/errors.test.ts` (19, most of them parameterised signature cases): classification, including `NO_RECORDS` by code and by message, a plain 404 kept as `ERR_FETCH`, the `ERR_ENGINE` fallback with `cause`, and non-Error throwables.
- `lib/components/chart/errors.test.tsx` (8, jsdom): `ERR_FETCH`; `ERR_CONCEPT_NOT_FOUND` for x axis and legend; `ERR_EMPTY` for an empty 200 and for `NO_RECORDS`; `ERR_ENGINE` on an engine throw; compact panel vs full height.
- `lib/components/lifecycle.test.tsx` (9, jsdom): loading then rendered with stats; error with the typed error; `onRenderComplete` exactly once, including when everything fails and for a dashboard without data visuals; value/map/table statuses; dashboard forwarding.
- `lib/utils/renderStats.test.ts` (2).

## Notes

- **Adapted.** This branch keeps rc.1's inline `Accept: …version=2.0.0` headers, because the header removal is the separate {{PR:pr/no-accept-header}}. The two conflict textually in `chart/options.ts`, `map/index.tsx` and `value/index.tsx`, and {{PR:pr/transport}} contains the merged result. The lint-only edits of {{PR:pr/eslint-config}} are not carried.
- On this branch alone, `ERR_NO_SERIES_DIMENSION` comes only from the line builder, and `ERR_AMBIGUOUS_SERIES` is declared but not yet thrown. The validation that raises both is {{PR:pr/series-validation}}. The README table already lists both.
- `NO_RECORDS` needs parser 0.4.1 ({{PARSER_PR}}). With 0.4.0 such a 404 stays `ERR_FETCH`.
- **With {{PR:pr/treemap-default-series}}:** the two merge without textual conflict, but `treemap.test.ts` must switch to the new `loadDatasets(config, language)` signature. The follow-up commit is 7eb30c2 on `surfer-integration`; see the tracking issue.
- Also conflicts textually with {{PR:pr/eslint-config}}, {{PR:pr/chart-layout}} and {{PR:pr/axis-titles}}. The resolutions are in `surfer-integration`.
