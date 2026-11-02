Clicks on chart elements stay inside the library, which blocks flows where selecting a point or series opens further exploration of that slice of data. This PR reports chart clicks through an optional `onUserInteraction` callback, on `SDMXChart` and on the dashboard. The payload maps each dimension id to its code at the clicked point, which is enough to rebuild the SDMX query for that slice without knowing ECharts.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/error-contract}} (`SDMXVisualProps`, `Cell` prop forwarding). Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/error-contract...pr/interaction

Own commit to review: 9e1ebda Expose chart interactions through onUserInteraction (port of fork b0bfe2d)

## Changes

```ts
export type VisualInteraction = {          // exported from the root
  visualId: string,
  kind: "point-click" | "series-click" | "legend-click",
  concepts: Record<string, string>,        // dimension id -> code
  value?: number,                          // point clicks
  timePeriod?: string,                     // point clicks, when the observation has one
}
// SDMXVisualProps += { onUserInteraction?: (interaction: VisualInteraction) => void }
```

- `lib/components/chart/index.tsx`: handlers for ECharts `click` on data items (`point-click`), for `click` on the line of a line series (`series-click`), and for `legendselectchanged` (`legend-click`).
- `lib/components/chart/line.ts`: line series set `triggerEvent: 'line'`.
- `lib/utils/interaction.ts` (new):
  - `findInteractionRow(rows, dimensions, target)` matches a clicked point back to its observation by series name, category, timestamp and value;
  - `buildInteractionConcepts(row, dimensions)` and `buildSeriesConcepts(seriesName, dimensions)` translate names to codes.
- Table and value drop `onUserInteraction` from the props they spread onto the DOM.
- `README.md`: an "Interaction callback" section.

## Behaviour changes vs rc.1

None without the callback, apart from line series now emitting click events on the line (`triggerEvent: 'line'`).

## Tests

`npm test`: 9 files, **62 passed** (base {{PR:pr/error-contract}}: 48).

- `lib/components/chart/interaction.test.tsx` (6, jsdom): a point on a multi-series line gives the full coordinate; a bar gives its category and series; a line click gives `series-click`; a legend toggle gives `legend-click`; no behaviour without the callback; the dashboard threads the callback.
- `lib/utils/interaction.test.ts` (8): code mapping, raw value fallback, series matching, and row lookup on time and category axes.

## Notes

- Only charts emit interactions. Table, value and map accept the prop through `SDMXVisualProps` but never call it.
- **Adapted.** This branch has no transport layer or render slots, so only `onUserInteraction` is added to the component signatures, and the chart render effect keeps its `config` dependency.
- Conflicts textually with {{PR:pr/transport}}, {{PR:pr/slots}}, {{PR:pr/config-url-errors}} and {{PR:pr/theme-a11y}}. The resolutions are in `surfer-integration`.
