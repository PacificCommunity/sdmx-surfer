This PR adds three config-level features:

- **Axis titles.** New optional `xAxisTitle` and `yAxisTitle` fields, localised and supporting text expressions.
- **`download` flag.** The documented field is now honoured: `false` hides the save-as-image toolbox.
- **Dashboard rows.** rc.1 types `rows[].colums`, while the runtime reads `columns`. The type is corrected, and the old spelling is accepted as a deprecated alias.

A second commit keeps axis names inside the canvas when the tick labels are wide.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/chart-layout}} (its grid constant is extended here), and through it {{PR:pr/test-setup}}. Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/chart-layout...pr/axis-titles

Own commits to review:
- 83e3dee Add axis titles, honour the download flag, type dashboard rows (axis titles and the alias are ported from fork commits 5f6cec8, b203443)
- 3343b0d Keep axis names inside the canvas

## Changes

- `lib/components/types.ts`:
  - `SDMXChartConfig.xAxisTitle?: SDMXTextConfig`: the axis of `xAxisConcept`;
  - `SDMXChartConfig.yAxisTitle?: SDMXTextConfig`: the value axis;
  - new `SDMXDashboardRow = { columns?: SDMXVisualConfig[]; /** @deprecated */ colums?: SDMXVisualConfig[] }`. `SDMXDashboardConfig.rows` is `SDMXDashboardRow[]`. `SDMXDashboardRow` is exported from `lib/index.ts`.
- `lib/components/chart/options.ts`: `withAxisTitles` sets `xAxis.name` (centred) and `yAxis.name`, swapped for `type: 'bar'`, whose category axis is ECharts' `yAxis`. `toolbox.show = config.download !== false`. `extraOptions` still override the names. Left unset, the axes stay unnamed.
- `lib/utils/chartHelpers.ts`: `GRID_CONTAINS_LABELS` becomes `GRID_CONTAINS_AXIS_TEXT` with `outerBoundsContain: 'all'`. `applyYAxisTitleLayout(option)` now only sets the middle position and rotation, and ECharts moves the name clear of the labels (`nameMoveOverlap`). The category-label wrap budget counts the name's extent.
- `lib/components/dashboard.tsx`: `normalizeConfig` fills `colCount`/`colSize` defaults (as before) and copies `colums` to `columns` when `columns` is missing. It is used for both `url` and `config`.
- `README.md`: a section on axis titles, `download` and dashboard rows.

## Behaviour changes vs rc.1

- `download: false` hides the toolbox, including on drilldown children. Before, the flag was ignored.
- A config written with the typed spelling `colums` now renders its cells. Before, `row.columns.forEach` threw on it.
- Axis names, whether from the new fields or from `extraOptions`, are contained in the grid. A chart with an axis name gets a slightly smaller plot, and the rotated y name no longer runs off the left edge. Without axis names, the layout test still matches legacy `containLabel`.

## Tests

`npm test`: 6 files, **27 passed** (base {{PR:pr/chart-layout}}: 15).

- `lib/components/chart/configFields.test.tsx` (6): names on x/value axes without replacing the time axis; title in the component language; horizontal-bar swap; unset titles and `extraOptions` override; toolbox shown by default; hidden for `download: false`.
- `lib/components/columnsAlias.test.tsx` (3): cells under `colums`, under `columns`, and a row with neither.
- `lib/components/chart/layout.test.tsx` (+3): rotated y name between the left edge and wide tick labels; both names of a horizontal bar inside the canvas; the left inset grows with name gap and font size.

## Notes

- **Adapted to main.** `normalizeConfig` is applied to main's `dashboard.tsx`, which has no render tracking or fetcher. The drilldown child tooltip keeps main's `language` argument.
- Conflicts textually with {{PR:pr/error-contract}} and every PR built on it, in `README.md`, `chart/index.tsx`, `dashboard.tsx` and `lib/index.ts`, and also in `drilldown.ts` with {{PR:pr/theme-a11y}}. The resolutions are in `surfer-integration`.
- {{PR:pr/config-url-errors}} was written without `normalizeConfig` (it reads rows through a local cast). Once both are in, that code can call `normalizeConfig`, as the single-PR branch did.
