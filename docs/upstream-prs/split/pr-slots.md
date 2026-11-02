The built-in loading and failure states cannot be styled or replaced. This PR adds three optional render slots on every visual (chart, table, value, map) and on the dashboard. `renderLoading(visualId)` replaces the loading placeholder. `renderEmpty(visualId)` handles zero-observation results (`ERR_EMPTY`). `renderError(error)` receives the typed `SDMXRenderError` for every other failure, including render-time throws caught by the cell's error boundary. Without slots, nothing changes.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/error-contract}} (the typed error, the `SDMXVisualProps` that the slots extend, and the compact error panel). Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/error-contract...pr/slots

Own commit to review: 5bec28e Add renderLoading, renderEmpty, and renderError slots (port of fork 9dc812d)

## Changes

```ts
// SDMXVisualProps +=
renderLoading?: (visualId: string) => ReactNode,
renderEmpty?: (visualId: string) => ReactNode,      // ERR_EMPTY only
renderError?: (error: SDMXRenderError) => ReactNode, // every other failure; ERR_EMPTY too when renderEmpty is absent
```

- `lib/utils/slots.ts` (new): `failureSlot(error, visualId, { renderEmpty, renderError }): ReactNode | undefined` returns the consumer's replacement, or `undefined` to keep the built-in panel.
- Chart, table, value and map use the slots. `Cell` also passes the boundary's error to `renderError`.
- `README.md`: a "Custom loading, empty, and error states" section.

## Behaviour changes vs rc.1

None without slots, beyond those of {{PR:pr/error-contract}}. With slots:

- the chart's slot output sits in the flow below the collapsed chart box, where the compact error panel already is;
- the map has no loading presentation of its own, and shows `renderLoading` only when given.

## Tests

`npm test`: 8 files, **56 passed** (base {{PR:pr/error-contract}}: 48). `lib/components/slots.test.tsx` (8, jsdom):

- `renderLoading` replaces the loading state;
- `renderError` replaces the alert and receives the typed error;
- `renderEmpty` takes precedence over `renderError` for empty results;
- `renderError` receives `ERR_EMPTY` when there is no `renderEmpty`;
- the defaults are kept when no slot is given;
- the table uses `renderLoading`/`renderError`, and the value uses `renderLoading`/`renderEmpty`;
- the dashboard threads the slots through every cell.

## Notes

- **Adapted.** This branch has no transport layer, so the components take no `fetcher`/`onDataFetch` here.
- {{PR:pr/config-url-errors}} uses `renderError` for a dashboard config that fails to load, and merges this branch (d6b44e0).
- Conflicts textually with {{PR:pr/transport}}, {{PR:pr/interaction}}, {{PR:pr/theme-a11y}} and {{PR:pr/map-fixes}} (same component signatures). The resolutions are in `surfer-integration`.
