On rc.1, business-day (`B`) series get year-only labels, so a few weeks of ECB rates read "2024 2024 2024". `parseDate` returns `null` for weekly (`2024-W05`) and semester (`2024-S1`) periods, which are then plotted as raw strings on a time axis. Daily axes also print boundary labels on top of regular ones. This PR parses every SDMX reporting period, chooses the label format from the frequency, orders points by timestamp, and hides overlapping time-axis labels.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/test-setup}} (jsdom for the label-rendering test). Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/test-setup...pr/date-axes

Own commits to review:
- 10f94fb Show dates on business-day and weekly time axes
- 432e106 Hide overlapping time axis labels

## Changes

- `lib/utils/parseDate.tsx`: `parseDate` handles `A`, `S`, `T`, `Q`, `M`, `W` (the Monday of the ISO week), `D` (day of the year, `2024-D032`), and the calendar forms. New `periodFrequency(period)` reads the frequency from the period format.
- `lib/components/chart/line.ts`: label format per frequency (`TIME_LABEL_FORMATS`):

  | FREQ | rc.1 label | This PR |
  |---|---|---|
  | A | `{yyyy}` | `{yyyy}` |
  | S, T | `{yyyy}` | `{MMM} {yyyy}` |
  | Q, M | `{MMM} {yyyy}` | `{MMM} {yyyy}` |
  | W | `{MMM} {yyyy}` | `{yyyy}-{MM}-{dd}` |
  | D | `{yyyy}-{MM}-{dd}` | `{yyyy}-{MM}-{dd}` |
  | B | `{yyyy}` | `{yyyy}-{MM}-{dd}` |
  | unknown | `{yyyy}` | ECharts' auto-scaled labels (tooltips show the full date) |

  The FREQ lookup stays guarded. Without a FREQ dimension, the frequency comes from the first period's format. On a time axis, points are sorted by timestamp, and `axisLabel.hideOverlap: true` is set.

## Behaviour changes vs rc.1

- Weekly and semester periods are plotted at their first day instead of as raw strings.
- `B`, `W`, `S`, `T` and unknown frequencies get different labels (table above).
- Periods within a year are ordered chronologically. Before, the period sort compared years only.
- Time axes drop labels that would overlap one already shown (for example `2026-07-01` over `2026-07-03`, or `Nov 2025Dec 2025` in a narrow column).

## Tests

`npm test`: 6 files, **60 passed** (base {{PR:pr/test-setup}}: 10). Most of the 50 new tests are parameterised:

- `lib/utils/parseDate.test.ts`: every period form, invalid inputs (`''`, `latest`, `2023-X1`, …) returning `null`, and `periodFrequency`;
- `lib/components/chart/line.test.ts`: W/S plotted at their first day, chronological order within a year, no FREQ dimension, unknown frequency;
- `lib/components/chart/timeAxisLabels.test.tsx` (jsdom): `hideOverlap` set for each frequency.

## Notes

- Origin: the date-axis patch of the downstream app's patched 0.4.8 bundle, carried over to the ECharts line builder. `timeAxisLabels.test.tsx` is a new suite here; on the single-PR branch the test sat in `layout.test.tsx`.
- Conflicts textually with {{PR:pr/theme-a11y}} in `line.ts` (that PR renames `language` to `numberLocale` in the builder). The resolution is in `surfer-integration` (merge ab00476).
- If merged without siblings: self-contained.
