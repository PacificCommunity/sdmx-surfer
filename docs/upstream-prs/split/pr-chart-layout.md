Two layout fixes for cartesian charts:

- With `legend.location: "top"`, the legend sits at the top edge, over the chart title. It now goes below the title, and moves again on resize when the title rewraps.
- `grid.containLabel` is honoured by ECharts 6 only when `LegacyGridContainLabel` is registered, and otherwise logs a deprecation notice. The grids now use ECharts 6's outer bounds. This is the layout ECharts 6 already falls back to, so charts are placed as in rc.1, without the notice.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/test-setup}} (jsdom for the layout tests). Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/test-setup...pr/chart-layout

Own commit to review: 0180a9f Keep a top legend clear of the title; drop grid.containLabel

## Changes

- `lib/utils/chartHelpers.ts`: new `GRID_CONTAINS_LABELS = { outerBoundsMode: 'same', outerBoundsContain: 'axisLabel', outerBoundsClampWidth: 0, outerBoundsClampHeight: 0 }`, which replaces `containLabel: true` in `buildCartesianGrid`.
- `lib/components/chart/drilldown.ts`: the drilldown child grid uses the same constant.
- `lib/components/chart/index.tsx`: `reserveTopSpace(chart, option, explicitLegendTop)` also measures the legend. A horizontal top legend is placed `TITLE_LEGEND_GAP` (8 px) below the title, and the grid below both. `hasExplicitLegendTop(config)` leaves alone a legend whose `extraOptions.legend` sets `top` or `bottom`.

## Behaviour changes vs rc.1

| | rc.1 | This PR |
|---|---|---|
| Top legend with a title | overlaps the title | below the title, and repositioned on resize |
| Top legend without a title | at the top | unchanged |
| Legend positioned by `extraOptions` | as given | unchanged |
| Cartesian grid | `containLabel: true` + ECharts deprecation log | outer bounds, same placement, no log |

## Tests

`npm test`: 4 files, **15 passed** (base {{PR:pr/test-setup}}: 10). `lib/components/chart/layout.test.tsx` (5 tests, jsdom):

- the new grid draws exactly like `containLabel: true` and logs no deprecation;
- the grid sits where ECharts 6 put a `containLabel` grid;
- a top legend below the title, and the plot below both;
- a top legend without a title stays at the top;
- `extraOptions`-positioned legends are untouched.

## Notes

- **Adapted to main.** The downstream build also wraps these calls in the error-contract engine guards and interaction handlers. Here only the `reserveTopSpace` calls gain the legend argument, and the drilldown tooltip keeps main's `language` argument.
- {{PR:pr/axis-titles}} builds on this PR and extends the constant to contain axis names (`outerBoundsContain: 'all'`, renamed `GRID_CONTAINS_AXIS_TEXT`).
- Conflicts textually in `chart/index.tsx` with {{PR:pr/error-contract}} and every PR built on it, and in `drilldown.ts` with {{PR:pr/theme-a11y}}. The resolutions are in `surfer-integration` (merges b621379 onwards).
