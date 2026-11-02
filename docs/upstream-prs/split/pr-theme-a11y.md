This PR adds two things:

- **`SDMXTheme`.** An engine-neutral theme (palette, display and data font families, number locale) applied once on the dashboard or on a standalone visual, at the lowest precedence.
- **Hidden data table.** Every chart renders a visually hidden data table holding the same observations, captioned with the chart title, so a screen reader can read the data where ECharts' aria description falls short.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/error-contract}} (`SDMXVisualProps`, `Cell` forwarding, and the compact error panel that the hidden table follows). Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/error-contract...pr/theme-a11y

Own commit to review: 198e7e3 Add an SDMXTheme and a hidden data table under every chart (port of fork 08812e3, 5a3f439)

## Changes

```ts
export type SDMXTheme = {                       // exported from the root
  palette?: string[],                            // series colours in order
  fontFamily?: { display?: string, data?: string }, // titles/subtitles; axes, labels, legends, tooltips
  numberFormat?: { locale?: string },            // overrides the component language for numbers
}
// SDMXChart:      theme?: string | SDMXTheme     (rc.1: string, a registered ECharts theme name)
// SDMXTable, SDMXValue: theme?: SDMXTheme         (only numberFormat applies)
// SDMXDashboard:  theme?: SDMXTheme               (threaded to every chart, table and value)
```

- `lib/utils/theme.ts` (new):
  - `themeChartOptions(theme)` maps the theme to ECharts `color`, `textStyle.fontFamily` and the title/subtitle fonts;
  - `resolveNumberLocale(theme, language)` returns the theme's locale, or the language when none is set.
- `lib/components/chart/*`: the theme is merged *under* the built option. A visual's `colorPalette`, the title config and `extraOptions` take precedence, and the active ECharts theme (dark mode under `data-bs-theme="dark"` included) fills in what the theme leaves unset. Drilldown children keep the palette and font. The builders format numbers with `numberLocale`.
- `lib/components/hiddenDataTable.tsx` (new): an inline-styled screen-reader-only `<table>`, using rc.1's table pivot (`lib/components/table/model.ts`).
- `README.md`: "Global theming" and a hidden-data-table paragraph.

## Behaviour changes vs rc.1

- **Theme type.** `SDMXChart`'s `theme` is widened; a string still means a registered ECharts theme.
- **Hidden table.** Every chart adds a visually hidden `<table>` to the DOM.
- **Number locale.** `numberFormat.locale` changes number formatting in tooltips, data labels, table cells and the value visual. Translated text stays on the component language.

## Tests

`npm test`: 9 files, **60 passed** (base {{PR:pr/error-contract}}: 48).

- `lib/components/chart/theme.test.tsx` (7, jsdom):
  - palette and fonts;
  - `colorPalette` overrides the theme palette;
  - dark mode kept under an `SDMXTheme`;
  - an ECharts theme name still accepted;
  - the dashboard threads the theme;
  - the theme locale in the chart's data table and the table visual;
  - the hidden table holds every observation.
- `lib/utils/theme.test.ts` (5): locale resolution and option mapping.

## Notes

- **Not ported.** The fork's `numberFormat.decimalSeparator`: ECharts has no equivalent, and the locale already determines the separator.
- **Not registered.** The `SDMXTheme` is merged into the option, not registered with `echarts.registerTheme` [INFERENCE from the code].
- **Adapted.** This branch lacks transport, slots, interaction, date-axis formats and typed rows, so the theme props are added to the existing signatures and effect dependencies. The chart render effect keys the theme on `sdmxThemeKey`, with an `exhaustive-deps` opt-out.
- **Conflicts.** This PR touches the most shared files. It conflicts textually with:
  - {{PR:pr/date-axes}} (`line.ts`);
  - {{PR:pr/chart-layout}} and {{PR:pr/axis-titles}} (`drilldown.ts`, `chart/index.tsx`);
  - {{PR:pr/transport}}, {{PR:pr/slots}}, {{PR:pr/config-url-errors}} and {{PR:pr/interaction}};
  - {{PR:pr/map-fixes}} (`lib/index.ts`).

  The resolutions are in `surfer-integration` (merge ab00476). Landing it near the end of the series keeps the rebases small.
