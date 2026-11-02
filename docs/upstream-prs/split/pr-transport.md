The components fetch with the global `fetch`, which leaves three gaps:

- there is no way to add authentication or a proxy short of replacing `window.fetch`;
- visuals on one page fetch identical URLs separately;
- one transient 5xx fails a visual.

This PR adds an optional `fetcher` prop and wraps it, or the global `fetch`, in a transport that de-duplicates in-flight requests, caches 2xx responses, retries once, and reports telemetry through `onDataFetch`. It also keys the data effects on config content rather than object identity, so an inline `config={{…}}` re-rendered by a state-updating callback no longer re-fetches in a loop. `SDMXValue` now refetches when its data request changes.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/error-contract}} and {{PR:pr/no-accept-header}}. The latter is merged into this branch (31c9480), because both rewrite the same request pipelines. Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/error-contract...pr/transport. It also shows f300915 and the merge 31c9480.

Own commits to review:
- 1f8595e Add a transport layer: injectable fetcher, dedup, cache, retry, telemetry (port of fork ea06dbf, 3d88da5, c1702b6, 5f8c1d1)
- 5ae67a7 Refetch a value when its data request changes
- bc26ae7 Keep the transport when an inline fetcher changes identity

## Changes

```ts
export type SDMXFetcher = (url: string, init?: RequestInit) => Promise<Response>;   // exported
export type FetchTelemetry = { url: string, host: string, status: number | "network-error",
  durationMs: number, fromCache: boolean, retried: boolean };                       // exported
// SDMXVisualProps += { fetcher?: SDMXFetcher, onDataFetch?: (t: FetchTelemetry) => void }
// on SDMXChart, SDMXTable, SDMXValue, SDMXMap and SDMXDashboard
```

- `lib/utils/transport.ts` (new):
  - `createTransport(baseFetcher?, onDataFetch?): SDMXFetcher`. Requests with the same URL + `Accept` + `Accept-Language` share one exchange. 2xx responses are cached for the transport's lifetime; non-2xx responses and failures are not cached. Network errors and 5xx are retried once after 300 ms; 4xx are not. Telemetry fires once per settled call, including de-duplicated ones (`fromCache: true`). Passing an existing transport returns it unchanged.
  - `useTransport(fetcher, onDataFetch, key)`: a new transport when `key` (the component's data request) changes. The dashboard's transport is shared by its cells. The fetcher and callback are read through `useLatest` refs.
- `lib/utils/requestHeaders.ts`: `dataRequestOptions(language, fetcher?)` passes the transport to the parser as its `fetcher` option.
- `lib/utils/parseDataExpr.tsx`: `fetchDataExprOperand(…, language, fetcher?)`.
- Chart, table, map, value and dashboard effects are keyed on `JSON.stringify(config)`. The map reads its `callback` through a ref.
- The dashboard loads its `url` config through `fetcher` when given, and creates one transport per (config, language).
- `README.md`: "Custom data transport" and "Request dedup, caching, retry, and telemetry" sections.

## Behaviour changes vs rc.1

- **Shared requests.** Identical in-flight requests are shared, 2xx responses are cached while the config and language stay the same, and network errors/5xx are retried once.
- **Effect keys.** Effects are keyed on config content. A new-but-identical config object no longer re-fetches; a content change does.
- **Value refetch.** `SDMXValue` refetches when its data expression, language or `xAxisConcept` changes (rc.1: on mount and language change only). Title, unit or decimals edits re-render from the cache.
- **Inline fetchers.** An inline `fetcher` (a new function on every render) neither refetches nor drops the cache, and a replaced fetcher serves the next request.
- **Headers.** Includes the Accept-header change of {{PR:pr/no-accept-header}}.

## Tests

`npm test`: 13 files, **75 passed** (base {{PR:pr/error-contract}}: 48; 3 of the 27 new tests come with {{PR:pr/no-accept-header}}).

- `lib/utils/transport.test.ts` (9): de-duplication, cache lifetime, retry on 5xx and on network error, no retry on 4xx, failures and non-2xx not cached, cache keyed by `Accept`, no transport stacking.
- `lib/components/transport.test.tsx` (7, jsdom): two visuals sharing one URL make one request; standalone chart and value telemetry; inline-fetcher identity on chart and dashboard (no loop, no refetch); a replaced fetcher is used for the next request.
- `lib/components/chart/stableConfig.test.tsx` (3): no refetch on identical config objects; refetch on a content change; inline config + `onVisualRender` settle.
- `lib/components/value/refetch.test.tsx` (3): URL change, language change, title change from cache.
- `lib/components/dashboard.fetcher.test.tsx` (2): config URL through the fetcher, and global `fetch` as fallback.

## Notes

- **Parser version.** Routing SDMX data requests through `fetcher` requires `sdmx-json-parser` 0.4.1 ({{PARSER_PR}}). 0.4.0 ignores the `fetcher` option and uses the global `fetch`, so dedup, cache, retry and telemetry then cover only the dashboard config URL. The peer range stays `^0.4.0`.
- **Not routed.** Map GeoJSON and vector tiles are loaded by OpenLayers and do not go through `fetcher`. The README says so.
- **Responses.** Callers receive a rebuilt `Response` carrying status, status text, `content-type` and the body. Other response headers are not carried.
- **Config URL errors.** A config URL that fails to load is still only logged, as in rc.1. {{PR:pr/config-url-errors}} fixes that.
- **Conflicts.** Conflicts textually with {{PR:pr/slots}}, {{PR:pr/interaction}}, {{PR:pr/theme-a11y}} and {{PR:pr/map-fixes}}, which all extend the same component signatures. The resolutions are in `surfer-integration`.
