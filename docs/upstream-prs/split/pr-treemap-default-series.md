On rc.1, a treemap without `legend.concept` fails when only the x axis varies in the query, for example tiles per country with one indicator and one period. The error is `Cannot read properties of undefined (reading 'values')`, because the shared column-like collection looked for the series dimension among the varying dimensions only. It now falls back to any other dimension, which then holds a single value, and draws one series of tiles. This is the same default the line chart uses. A dataflow with no dimension besides the x axis gets a descriptive error.

Part of {{TRACKING_ISSUE}}.

**Depends on:** nothing.

Commit: dd57408 Default the series dimension of a treemap without legend.concept

## Changes

- `lib/utils/chartHelpers.ts`, `collectColumnLike`. Without `legend.concept`, the series dimension is the first varying dimension other than the x axis; if there is none, it is any other dimension. If no other dimension exists at all, it throws:
  `Chart type=<type> with xAxis=<X> needs a dimension besides <X> to group its series, and the dataflow has none. Fix: set xAxisConcept to another dimension of the dataflow.`

## Behaviour changes vs rc.1

| Case | rc.1 | This PR |
|---|---|---|
| Treemap, no `legend.concept`, only x varies | throws `Cannot read properties of undefined (reading 'values')` | one series of tiles, one per x category |
| Dataflow with no dimension besides x | same `TypeError` | the descriptive message above (plain `Error`). The Chart component shows its generic failure |

`collectColumnLike` is shared by the bar/column builder, lollipop, treemap and the table model. A bar, column or lollipop in the same situation therefore also fails on rc.1 with the same `TypeError`, and on this branch it builds (one ECharts series; two for the lollipop). I checked both with a throwaway probe against the same fixture. {{PR:pr/series-validation}} then turns the bar/column/lollipop case into `ERR_NO_SERIES_DIMENSION` before the builders run.

## Tests

`npm test`: 3 files, **10 passed** (rc.1: 8). `lib/components/chart/treemap.test.ts` builds the ECharts option from a stubbed response (`loadDatasets` + `buildChartOptionFromDatasets`):

- one treemap series with tiles `[['Fiji', 900000], ['Samoa', 200000]]`;
- the descriptive error when the dataflow has no other dimension.

## Notes

- **Adapted to main.** The downstream build throws a typed `SDMXRenderError('ERR_NO_SERIES_DIMENSION', …)`. On main there are no typed errors, so this PR throws a plain `Error` with the same message, and the README row is left out.
- **Interaction with {{PR:pr/error-contract}}. Merging both needs a follow-up.** The two merge without textual conflict. However, error-contract changes `loadDatasets` to `(config, language)`, so `treemap.test.ts` fails afterwards: I checked by merging both branches without the follow-up, and both tests fail with `TypeError: Cannot read properties of undefined (reading 'forEach')`. Without the follow-up, the plain `Error` would also be classified `ERR_ENGINE` [INFERENCE from the classifier's signatures in `lib/errors.ts`]. The follow-up is commit 7eb30c2 on `surfer-integration` (3 files). It throws `ERR_NO_SERIES_DIMENSION` with `detail`, fixes the test call, and restores the 2 contract-level tests. I will open it once both PRs are merged, or add it to whichever of the two lands second.
- Independent leaf.
