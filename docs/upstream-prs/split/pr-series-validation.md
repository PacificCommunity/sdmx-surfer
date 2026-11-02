This PR checks the series structure of the fetched data before the chart builders run, and fails with a message that names the problem and the fix. Two cases are covered:

- a grouping chart (bar, column, lollipop) over a query where only the x axis varies has nothing to group on;
- a query where two or more other dimensions vary and no `legend.concept` is set merges their observations into one zig-zagging series that looks like real data.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/error-contract}}. Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/error-contract...pr/series-validation

Own commit to review: 9dbd2a2 Fail with descriptive errors on ambiguous series structure (port of fork 6027f41)

## Changes

- `lib/utils/validateChartData.ts` (new):
  - `findVaryingDimensions(data, dimensions, xAxisConcept)`: the non-x dimensions with two or more distinct values in the rows, with their value counts;
  - `validateSeriesDimensions(chartType, xAxisConcept, legendConcept, data, dimensions): void`.
- `lib/components/chart/options.ts`: `createChartContext` validates each fetched dataset. The x axis defaults to `TIME_PERIOD` for `line`.

<details><summary>Messages (part of the error contract)</summary>

- `ERR_NO_SERIES_DIMENSION` (bar/column/lollipop, no other dimension varies):
  `Chart type=<t> with xAxis=<x> needs at least one other varying dimension to group bars/columns. Only <x> varies in this query. Fix: switch chart type to line or pie, widen the data query so a second dimension varies (e.g. remove lastNObservations or broaden the filter), or set legend.concept to a dimension with multiple values.`
- `ERR_AMBIGUOUS_SERIES` (any chart type, ≥ 2 other varying dimensions, no `legend.concept`):
  `Chart type=<t> with xAxis=<x> has <n> other varying dimensions: A (k values), B (m values). Their observations would be merged into a single series, rendering an artefact instead of the data. Fix: set legend.concept to one of the varying dimensions, or narrow the data query so that only one dimension besides <x> varies.`

`detail`: `{ chartType, xAxisConcept, varyingDimensions }`.
</details>

## Behaviour changes vs rc.1

- **Ambiguous series.** Charts without `legend.concept` over two or more varying non-x dimensions used to render one merged series. They now fail with `ERR_AMBIGUOUS_SERIES`.
- **Single-series grouping charts.** Bar/column/lollipop where only x varies now fail with `ERR_NO_SERIES_DIMENSION`. On rc.1 this case fails too, with `TypeError: Cannot read properties of undefined (reading 'values')`, which I checked with a probe against a stubbed response. With {{PR:pr/treemap-default-series}} merged it would build one series, and this check rejects it before the builders run.
- **When validation is skipped.** No validation runs when `xAxisConcept` is `MULTI` or missing, or when the data is empty (that case is `ERR_EMPTY`). `ERR_NO_SERIES_DIMENSION` also fires when `legend.concept` is set, if only the x axis varies.

## Tests

`npm test`: 8 files, **63 passed** (base {{PR:pr/error-contract}}: 48).

- `lib/utils/validateChartData.test.ts` (12): varying-dimension detection; `ERR_NO_SERIES_DIMENSION` for each grouping type and not for line/pie or when a second dimension varies; `ERR_AMBIGUOUS_SERIES` and its disambiguation by `legend.concept`; guards (MULTI, missing x axis, empty data).
- `lib/components/chart/errors.test.tsx` (+3, jsdom): each error in the alert panel; the same query renders once `legend.concept` is set.

## Notes

- From the downstream acceptance notes (SDMX Surfer, 11 published dashboards, 99 panels): 7 panels hit `ERR_NO_SERIES_DIMENSION`. They also fail on the pre-migration build.
- **Possible follow-up, not in this PR.** ECharts can draw a single-series grouping chart; the check was inherited from the Highcharts fork, which drew a blank panel. If you would rather render that case, the proposal is:
  - drop `ERR_NO_SERIES_DIMENSION` for it;
  - show no legend;
  - title the category axis with the varying dimension;
  - put the fixed period in the subtitle.

  `ERR_AMBIGUOUS_SERIES` would stay.
- No textual conflicts with siblings beyond those inherited from {{PR:pr/error-contract}}.
