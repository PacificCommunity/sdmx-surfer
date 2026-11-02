# Error contract, render lifecycle, transport, theming and fixes on top of 1.0.0-rc.1

Branch `gvdr/sdmx-dashboard-components:surfer-parity` (37f543f), based on `v1.0.0-rc.1` (239c6b6), 21 commits, 67 files, +5742/−498.

## Summary

This PR ports to the ECharts-based 1.0 the features of an earlier Highcharts fork of this library (`gvdr/sdmx-dashboard-components`, branches `pr1-observability` → `pr2-rendering-transport` → `pr3-api-theming-a11y` on 0.4.6), and adds fixes found while moving a downstream application onto rc.1. The main additions are a typed error contract (`SDMXRenderError` with seven codes), render status callbacks (`onVisualRender`, `onRenderComplete`), an injectable `fetcher` with request de-duplication, caching, one retry and telemetry, render slots for loading/empty/error, an interaction callback, axis titles, an `SDMXTheme`, a hidden data table for screen readers, and map fixes.

The downstream application is SDMX Surfer, a dashboard builder in which an LLM agent writes dashboard configs. The agent reads the error codes and messages to correct its own configs, so the message texts are treated as a contract and asserted by tests. Surfer currently installs this branch from a release tarball.

All new props and config fields are optional. Without them a visual renders as in rc.1, except for the changes listed under [Behaviour changes vs rc.1](#behaviour-changes-vs-rc1).

## Review guide

"Files" is the number of files the commit touches. "Tests" counts the `it(`/`test(` lines the commit adds; parameterised cases are counted once.

| # | SHA | Subject | Item | Files | Tests |
|---|---|---|---|---|---|
| 1 | 2635b43 | Add an ESLint config so npm run lint runs | tooling | 14 | 0 |
| 2 | a92bcaa | Stop sending the SDMX-JSON 2.0 Accept header | headers (L2) | 6 | 3 |
| 3 | 8e2f19b | Report render status and typed errors from every visual | error contract + lifecycle (L1) | 27 | 23 |
| 4 | b912b68 | Fail with descriptive errors on ambiguous series structure | series validation (L4) | 4 | 13 |
| 5 | 6e47d0c | Add a transport layer: injectable fetcher, dedup, cache, retry, telemetry | transport (L5) | 17 | 18 |
| 6 | 0b39e55 | Refetch a value when its data request changes | value refetch (L10) | 2 | 3 |
| 7 | 04c44b5 | Show dates on business-day and weekly time axes | date axes (L12) | 4 | 11 |
| 8 | 5cfb710 | Add renderLoading, renderEmpty, and renderError slots | slots (L6) | 8 | 8 |
| 9 | d904419 | Expose chart interactions through onUserInteraction | interaction (L7) | 9 | 14 |
| 10 | 62c19b0 | Add axis titles, honour the download flag, type dashboard rows | config fields (L8) | 6 | 9 |
| 11 | 17e1bc0 | Add an SDMXTheme and a hidden data table under every chart | theme + a11y (L9) | 20 | 12 |
| 12 | 1e6bf32 | Fix the map colour scale, zero values, join, and export | map (L11) | 7 | 16 |
| 13 | ff27052 | Keep a top legend clear of the title; drop grid.containLabel | layout | 4 | 5 |
| 14 | 2071394 | chore(release): 1.0.0-rc.2 | release + README | 3 | 0 |
| 15 | dbcb593 | Report a 404 without records as ERR_EMPTY | error contract | 4 | 4 |
| 16 | 22d70c2 | Keep axis names inside the canvas | layout | 4 | 3 |
| 17 | 2fe8993 | Show a failed chart in a compact panel | error presentation | 2 | 2 |
| 18 | 147b2d5 | Hide overlapping time axis labels | date axes | 3 | 2 |
| 19 | 88d1d25 | Default the series dimension of a treemap without legend.concept | treemap | 3 | 2 |
| 20 | 74998d9 | Keep the transport when an inline fetcher changes identity | transport | 5 | 4 |
| 21 | 37f543f | Report a dashboard config that fails to load | error contract | 3 | 5 |

The L-numbers refer to the work items in the downstream integration plan. Commits 15–19 are fixes found during downstream acceptance testing on rc.2; commits 20–21 fix weaknesses found while preparing this PR.

**Suggested review order**

1. 2635b43 (lint config). It is mechanical, and every later commit was linted with it.
2. a92bcaa, 8e2f19b, b912b68, dbcb593, 37f543f: request headers and the error contract. `lib/errors.ts` and `lib/utils/validateChartData.ts` define the public messages.
3. 6e47d0c, 0b39e55, 74998d9: transport and refetch keys. This is the most delicate logic (`lib/utils/transport.ts`, effects keyed on config content, the fetcher read through a ref).
4. 5cfb710, 2fe8993: slots and the compact error panel.
5. The remaining commits are largely independent features: d904419, 62c19b0, 17e1bc0, 1e6bf32, 04c44b5 + 147b2d5, ff27052 + 22d70c2, 88d1d25.
6. 2071394: version bump plus 82 README lines.

**Possible splits.** Not every split was tested. Commits 3–5 introduce `SDMXVisualProps`, `Cell` prop forwarding and `toSDMXRenderError`, and later commits build on these, so a split needs 2635b43 + a92bcaa + 8e2f19b as its base.

| Candidate PR | Commits | Depends on |
|---|---|---|
| Lint config | 2635b43 | nothing |
| Accept header | a92bcaa | nothing (uses the parser's negotiation when the parser is 0.4.1) |
| Error contract + lifecycle + validation | 8e2f19b, b912b68, dbcb593, 2fe8993, 88d1d25 | a92bcaa (touches the same request helper) |
| Transport | 6e47d0c, 0b39e55, 74998d9 | error contract |
| Config URL errors | 37f543f | error contract, 5cfb710 (`renderError`), 74998d9 (same effect) |
| Slots, interaction | 5cfb710, d904419 | error contract (`SDMXVisualProps`) |
| Axis titles / download / rows | 62c19b0 | none in principle; 22d70c2 later changes the layout of the axis names it adds |
| Theme + hidden table | 17e1bc0 | `SDMXVisualProps` |
| Map | 1e6bf32 | error contract (the map pipeline is rewritten there) |
| Layout | ff27052, 22d70c2 | 22d70c2 assumes 62c19b0's axis titles |
| Date axes | 04c44b5, 147b2d5 | nothing |

Commit 2071394 is more than a version bump: it also adds the README sections for slots, interaction, axis titles, theming and maps. If you prefer to release on your own schedule, drop only its `package.json`/`package-lock.json` hunks and keep the README.

## Public API changes

All changes are additive, except the `theme` prop of `SDMXChart`, whose type is widened from `string` to `string | SDMXTheme`. Even that is compatible: a string still means a registered ECharts theme name.

**New root exports** (`lib/index.ts`): `SDMXRenderError` (class), and the types `SDMXRenderErrorCode`, `VisualRenderStatus`, `VisualInteraction`, `SDMXFetcher`, `FetchTelemetry`, `SDMXDashboardRow`, `SDMXTheme`, `SDMXMapInstance`.

`SDMXVisualProps` is declared in `lib/components/types.ts` but **not exported** from the package root. Consumers can see its fields through each component's props. Exporting it is a one-line follow-up if you want it.

**New props**

| Component | New props |
|---|---|
| `SDMXChart` | every `SDMXVisualProps` field; `theme?: string \| SDMXTheme` (was `string`) |
| `SDMXTable`, `SDMXValue` | every `SDMXVisualProps` field; `theme?: SDMXTheme` (only `numberFormat` applies) |
| `SDMXMap` | every `SDMXVisualProps` field; `callback` now receives `SDMXMapInstance` (was the OpenLayers `Map`, which is a supertype) |
| `SDMXDashboard` | every `SDMXVisualProps` field; `onRenderComplete?: (all: VisualRenderStatus[]) => void`; `theme?: SDMXTheme` |

`onUserInteraction` is accepted on every visual through `SDMXVisualProps`, but only charts emit it. Value removes it from the DOM props.

<details><summary>Type signatures (from <code>lib/components/types.ts</code>, <code>lib/errors.ts</code>, <code>lib/utils/transport.ts</code>)</summary>

```ts
export type SDMXFetcher = (url: string, init?: RequestInit) => Promise<Response>;

export type SDMXTheme = {
    palette?: string[],                  // series colours in order
    fontFamily?: { display?: string, data?: string },
    numberFormat?: { locale?: string },  // overrides the component language for numbers
}

export type VisualRenderStatus = {
    visualId: string,
    status: "loading" | "rendered" | "empty" | "error",
    error?: SDMXRenderError,             // status "error" or "empty"
    stats?: { observationCount: number, seriesCount: number, timePeriodRange?: [string, string] }
}

export type SDMXVisualProps = {
    onVisualRender?: (status: VisualRenderStatus) => void,
    fetcher?: SDMXFetcher,
    onDataFetch?: (telemetry: FetchTelemetry) => void,
    renderLoading?: (visualId: string) => ReactNode,
    renderEmpty?: (visualId: string) => ReactNode,   // ERR_EMPTY only
    renderError?: (error: SDMXRenderError) => ReactNode,
    onUserInteraction?: (interaction: VisualInteraction) => void,
}

export type VisualInteraction = {
    visualId: string,
    kind: "point-click" | "series-click" | "legend-click",
    concepts: Record<string, string>,    // dimension id -> code
    value?: number,                      // point clicks
    timePeriod?: string,                 // point clicks
}

export type SDMXMapInstance = OLMap & { toImage: () => Promise<string> }  // PNG data URL

export type SDMXDashboardRow = {
    columns?: Array<SDMXVisualConfig>,
    /** @deprecated */ colums?: Array<SDMXVisualConfig>,
}

export type FetchTelemetry = {
    url: string, host: string,
    status: number | "network-error",
    durationMs: number, fromCache: boolean, retried: boolean
}

export class SDMXRenderError extends Error {
    code: SDMXRenderErrorCode;
    visualId?: string;
    detail?: Record<string, unknown>;
    cause?: unknown;
}
```
</details>

**New config fields**

| Field | Type | Effect |
|---|---|---|
| `SDMXChartConfig.xAxisTitle` | `SDMXTextConfig` (localised, text expressions) | `xAxis.name`, centred; on a horizontal `bar` it goes on `yAxis` |
| `SDMXChartConfig.yAxisTitle` | `SDMXTextConfig` | value-axis name, rotated and centred; on a horizontal `bar` it goes on `xAxis` |
| `download` (existing field, now honoured) | `boolean` | `false` hides the save-as-image toolbox, including on drilldown children; default shown |
| `SDMXMapConfig.basemap` | `"satellite" \| "none" \| string` | `"satellite"` (default, ArcGIS World Imagery), no tiles, or an XYZ URL template |
| `SDMXDashboardConfig.rows[].columns` | `SDMXVisualConfig[]` | rc.1's type declared `colums`, but the runtime read `columns`. The type now declares `columns`, and `colums` is accepted as a deprecated alias that is normalised at load time |

`extraOptions` still overrides axis names.

**`SDMXRenderError` codes**

| Code | Fires when |
|---|---|
| `ERR_FETCH` | network failure or non-2xx response. Classified from the parser's `while fetching data` message and from browser/undici network messages |
| `ERR_PARSE` | the body is not JSON, or the parser readers fail (`Unexpected token`, `Cannot read properties of undefined`, `... not found`) |
| `ERR_EMPTY` | the query returned zero observations (every component), or the parser reports `NO_RECORDS` (a 404 whose body says NoRecordsFound, parser 0.4.1) |
| `ERR_NO_SERIES_DIMENSION` | `bar`/`column`/`lollipop` where no dimension other than the x axis varies; a treemap over a dataflow with no dimension besides the x axis |
| `ERR_AMBIGUOUS_SERIES` | any chart type without `legend.concept` where two or more non-x-axis dimensions vary |
| `ERR_CONCEPT_NOT_FOUND` | `xAxisConcept` or `legend.concept` is not in the structure; drilldown concept missing; unknown attribute in a text expression |
| `ERR_ENGINE` | an ECharts call (setOption, resize, drilldown, theme switch) threw, or the error could not be classified |

Validation is skipped when `xAxisConcept` is `MULTI` or the data is empty. `ERR_NO_SERIES_DIMENSION` also fires when `legend.concept` is set, if only the x axis varies.

## Behaviour changes vs rc.1

Each entry was checked against `git diff v1.0.0-rc.1..surfer-parity`.

| Change | Before (rc.1) | After | Why |
|---|---|---|---|
| **Accept header** (a92bcaa) | Chart, value, map and expression operands sent `Accept: application/vnd.sdmx.data+json;version=2.0.0` + `Accept-Language` | Only `Accept-Language` (`lib/utils/requestHeaders.ts`) | ECB and BIS answer 406 to the 2.0 media type, and IMF answers 500 |
| ↳ with parser **0.4.0** (the version in the current lockfile) | — | 0.4.0 calls `fetch(api, options)` with no Accept of its own (`git show 18fdcc8:index.js`). The request therefore carries the runtime's default `Accept` (`*/*` in browsers) plus `format=jsondata`, and the provider chooses the dialect. [INFERENCE from the parser 0.4.1 commit message] ECB then returns a root-dialect body and IMF returns XML, and 0.4.0 parses neither. Providers that follow `format=jsondata` work. .Stat providers that returned SDMX-JSON 2.0 under rc.1's header may now return their default JSON dialect | |
| ↳ with parser **0.4.1** | — | The parser negotiates: v1.0 Accept, then no Accept, then `application/json` | |
| **Typed errors** (8e2f19b) | Chart and table printed a fixed "Failed to load" line and logged to console. Value and map left an unhandled rejection and a permanent "Loading" placeholder | Every failure becomes an `SDMXRenderError` shown in a panel with `role="alert"` and `data-error-code`, and is reported through `onVisualRender`. Value and map end their promise chains in a catch | Consumers (and the agent) need a stable code and message, and unhandled rejections reach global handlers |
| **New validation errors** (b912b68) | A bar/column/lollipop over a query where only the x axis varies rendered. Queries with two or more varying non-x dimensions and no `legend.concept` rendered one merged, zig-zagging series | `ERR_NO_SERIES_DIMENSION` / `ERR_AMBIGUOUS_SERIES`, with messages that name the dimensions and the fixes | The merged series looks like real data. On 11 published downstream dashboards, 7 panels hit `ERR_NO_SERIES_DIMENSION` (see the single-series note below) |
| **ECharts guards** (8e2f19b) | An ECharts throw propagated | It is caught, the instance is disposed, and `ERR_ENGINE` is reported | ECharts 6 has no `error` event, and a broken instance throws again on its next frame |
| **Compact error panel** (2fe8993) | The message was laid over the full 400 px chart box | The chart box is collapsed but keeps its size, and the panel (or slot) sits in the flow at content height, min 120 px. Loading still covers the full box | An error took as much room as a chart |
| **`grid.containLabel` replaced** (ff27052, 22d70c2) | `containLabel: true`. ECharts 6 honours it only with `LegacyGridContainLabel` registered, and otherwise logs a deprecation notice | `outerBoundsMode: 'same'`, `outerBoundsContain: 'all'`, clamps 0 (`GRID_CONTAINS_AXIS_TEXT`, `chartHelpers.ts`). Axis names are contained as well as labels | Removes the notice. The rotated y-axis name could overflow the left edge with wide tick labels. Commit ff27052 states placement matches rc.1 for labels; with names now contained, a chart with axis names gets a slightly smaller plot |
| **Top legend** (ff27052) | `legend.location: "top"` sat at the top edge, over the title | A horizontal top legend sits below the title, and is repositioned on resize when the title rewraps. Legends positioned by `extraOptions` are untouched | Overlap |
| **Time-axis labels** (147b2d5) | ECharts drew every boundary label; daily axes overlapped, and narrow monthly axes ran together | `axisLabel.hideOverlap: true` on time axes | Readability |
| **B/W/S periods** (04c44b5) | `B` used `{yyyy}` labels. `parseDate` returned `null` for `2024-W05` and `2024-S1`, which were then plotted as raw strings | `parseDate` handles A, S, T, Q, M, W (Monday of the ISO week), D (day of year) and calendar forms. D/B/W get date labels, A years, S/T/Q/M month-year. Without FREQ, the frequency is read from the period format. Points are sorted by timestamp | ECB business-day and weekly series were unreadable |
| **Treemap default series** (88d1d25) | A treemap without `legend.concept` where only x varies failed with `ERR_PARSE` "Cannot read properties of undefined (reading 'values')" | It falls back to a non-varying dimension and draws one series. With no other dimension at all: `ERR_NO_SERIES_DIMENSION` | Same default as the line chart |
| **Map colour scale** (1e6bf32) | `(v − min) / max` | `(v − min) / (max − min)`; equal values take the top of the scale | Most of the scheme went unused when min ≫ 0 |
| **Map zero values** | `if (featureValue)`, so 0 was transparent | 0 is filled, and only missing values are transparent. The legend shows whenever any value joined | 0 is data |
| **Map join** | ISO3 → ISO2 lookup on the GeoJSON id | By code, then ISO alpha-3 key as alpha-2, then by label. The tooltip keeps its observation after the first draw | Features with label-only matches stayed empty |
| **Map tiles** | XYZ source without `crossOrigin` | `crossOrigin: "anonymous"`, and `basemap` chooses the source | A tainted canvas could not be exported |
| **Value refetch** (0b39e55) | `SDMXValue` fetched on mount and on language change only | Refetches when the load key (data expression, language, `xAxisConcept`) changes. Title/unit/decimals edits re-render from the transport cache | An edited KPI kept the old number until remounted |
| **Config change → new transport → refetch** (6e47d0c, 74998d9) | Effects keyed on object identity, so an inline `config={{…}}` re-fetched on every parent render | Effects keyed on `JSON.stringify(config)`. The dashboard creates one transport per (config, language), so a content change invalidates the cache and refetches. The fetcher is read through a ref, so an inline `fetcher` neither refetches nor clears the cache, and a replaced one serves the next request | Prevents fetch loops when a callback updates parent state |
| **Shared requests** (6e47d0c) | Each visual fetched separately, and one 5xx failed the visual | Identical in-flight requests (URL + Accept + Accept-Language) are shared, 2xx responses are cached for the transport's lifetime, and network errors/5xx are retried once after 300 ms | Fewer requests, tolerance of transient errors |
| **`download`** (62c19b0) | Ignored; the toolbox was always shown | `false` hides it | Config field was documented but not honoured |
| **Hidden data table** (17e1bc0) | None | Every chart renders a visually hidden `<table>` (rc.1's table pivot) captioned with the chart title | Screen-reader access |
| **Dashboard config URL** (6e47d0c, 37f543f) | Global `fetch`. A failed load was logged with `console.log` and "Loading..." stayed | `fetcher` if given, else `fetch`. A non-2xx response or network failure gives `ERR_FETCH`, a non-JSON body `ERR_PARSE` (no `visualId`, `detail: { url, status? }`), shown in place of the dashboard through `renderError` or the default alert panel and logged with `console.error` | Auth/proxy for the config too; a wrong URL was indistinguishable from a slow one |

One side effect follows from the code [INFERENCE]:

- `SDMXChart`'s `theme` merges an `SDMXTheme` under the built option. The theme is not registered with `echarts.registerTheme`.

## Dependencies and tooling

- **devDependencies added:** `@testing-library/react ^16.3.3`, `jsdom ^29.1.1`, `vitest-canvas-mock ^1.2.0`. No runtime dependency was added or changed.
- **`sdmx-json-parser`** stays a peer dependency at `^0.4.0`, as in rc.1; the lockfile resolves 0.4.0. Two features need **0.4.1** (companion PR on `PacificCommunity/sdmx-json-parser`, branch `dialects-0.4`):
  - Routing data requests through `fetcher`/transport. 0.4.0 ignores the `fetcher` key and uses the global `fetch`, so de-duplication, cache, retry and telemetry then do not apply to SDMX data requests.
  - Reading ECB/IMF/BIS responses, and `NO_RECORDS` → `ERR_EMPTY`.

  Once 0.4.1 is published, raising the range to `^0.4.1` would make this explicit. It is not done here because 0.4.1 is not yet on npm.
- **ESLint** (2635b43): `npm run lint` failed in rc.1 because no config was found. This commit adds `.eslintrc.cjs` (Vite template: typescript-eslint recommended, react-hooks, react-refresh), keeps the existing per-file `no-explicit-any` opt-outs, and fixes the existing findings (prefer-const, unused bindings, an undocumented `ts-ignore`, intentional effect deps).
- **Tests:** `vitest.config.ts` adds `setupFiles: ['lib/test/setup.ts']`, which in jsdom loads `vitest-canvas-mock` and stubs `ResizeObserver`. 13 component test files opt into jsdom with `// @vitest-environment jsdom`; the others stay in node.
- **Version:** 2071394 bumps to `1.0.0-rc.2`. Feel free to drop the bump (keep its README hunks) and version on your own schedule.

## Testing

Measured on 2026-11-02, with rc.1 in a temporary worktree sharing the branch's `node_modules`:

| | Test files | Tests | Lint | Build |
|---|---|---|---|---|
| `v1.0.0-rc.1` (239c6b6) | 2 | 8 passed | fails (no ESLint config) per 2635b43 | — |
| `surfer-parity` (37f543f) | 25 | 212 passed | `npm run lint` passes (`--max-warnings 0`) | `npm run build` completes |

Under full-suite load, a few tests in `transport`, `stableConfig` and `theme` timed out once during downstream work and passed on re-run. They passed in the run above.

**Downstream acceptance** (SDMX Surfer on this branch with parser 0.4.1, from its integration notes, 2 Nov 2026):

- Providers: a panel from each of 11 providers renders (SPC, FBOS, SBS, ECB, OECD, ILO, ABS, UNICEF, BIS, IMF, and StatsNZ through Surfer's proxy).
- Chart types: line, bar, column, pie, lollipop, treemap, drilldown, value, table, map and note each render.
- Saved dashboards: all 99 panels on the 11 published dashboards match the pre-migration baseline. The 9 panels that fail do so on both builds (7 `ERR_NO_SERIES_DIMENSION`, 2 IMF `ERR_EMPTY`).
- ECB `D` and `B` series show ISO dates. An edited KPI URL updates without remount.
- The agent receives unknown concept, unreachable URL, ambiguous series and empty query errors with visual id and code.
- Exports: the PDF and static HTML exports include charts and maps. Surfer reads chart images with `getInstanceByDom(...).getDataURL()` and map images from the OpenLayers canvases, which `crossOrigin: "anonymous"` tiles leave readable; `SDMXMapInstance.toImage()` is not used downstream. Offline, the map legend's gradient image is missing because the library loads it from `raw.githubusercontent.com` (`lib/utils/mapColors.ts`).

## Known limitations / not ported

- **Fork table visual:** not ported. rc.1 already has its own `table` / `SDMXTable`, which is kept, and the hidden data table reuses its pivot.
- **`numberFormat.decimalSeparator`** (fork `08812e3`): not ported. ECharts has no equivalent, and the locale already determines the separator.
- **`extraOptions: Record<string, unknown>`** (fork `b203443`): not ported. `SDMXMapConfig.extraOptions` is still `any`.
- **Keyboard behaviour docs** (fork `5a3f439`): not ported. rc.1 already enables ECharts `aria`.
- **Interactions** are emitted by charts only. Table, value and map accept `onUserInteraction` but never call it.
- **Map GeoJSON / vector tiles** are loaded by OpenLayers and do not go through `fetcher` (the README says so).
- **`ERR_ENGINE`** relies on try/catch guards around ECharts calls, because ECharts 6 has no `error` event. A throw inside an ECharts callback outside those calls is not caught.
- **Error classification** of non-library errors depends on message text, because parser 0.4.0 re-wraps errors with `new Error(err)` and loses the type. Parser 0.4.1 keeps `code: "NO_RECORDS"`.
- **Future design (not in this PR): single-series bar/column/lollipop.** ECharts can draw a grouping chart where only the x axis varies; the check exists because Highcharts drew a blank panel. The proposed design:
  - drop `ERR_NO_SERIES_DIMENSION` for that case only;
  - no legend or series name;
  - title the category axis with the varying dimension unless `xAxisTitle` is set;
  - append the fixed period to the subtitle ("latest available, 2015–2019" when periods differ);
  - hide other fixed dimensions.

  `ERR_AMBIGUOUS_SERIES` stays.

## Provenance

Fork: <https://github.com/gvdr/sdmx-dashboard-components>. Branches: [`pr1-observability`](https://github.com/gvdr/sdmx-dashboard-components/tree/pr1-observability), [`pr2-rendering-transport`](https://github.com/gvdr/sdmx-dashboard-components/tree/pr2-rendering-transport), [`pr3-api-theming-a11y`](https://github.com/gvdr/sdmx-dashboard-components/tree/pr3-api-theming-a11y) (Highcharts, on 0.4.6).

| This PR | Fork commit(s) | Fork branch where first present |
|---|---|---|
| a92bcaa | b6d88bf Stop sending the v2.0 Accept header that makes ECB 406 | pr3 |
| 8e2f19b | f49c3e9 typed error contract; 492ca93 onVisualRender/onRenderComplete | pr1 |
| b912b68 | 6027f41 descriptive errors on invalid series structure | pr1 |
| 6e47d0c | ea06dbf fetcher prop (pr1); 3d88da5 transport (pr2); c1702b6 effects keyed on content, 5f8c1d1 cache keyed by Accept (pr3) | pr1–pr3 |
| 0b39e55 | completes c1702b6 for the value component | pr3 |
| 04c44b5 | none: Surfer's patched 0.4.8 bundle (date-axis patch), improvements doc §16 | — |
| 5cfb710 | 9dc812d render slots | pr2 |
| d904419 | b0bfe2d onUserInteraction | pr2 |
| 62c19b0 | 5f6cec8 semantic axis titles; b203443 `columns` alias | pr3 |
| 17e1bc0 | 08812e3 theme prop; 5a3f439 hidden data table | pr3 |
| 1e6bf32, ff27052, dbcb593, 22d70c2, 2fe8993, 147b2d5, 88d1d25, 74998d9, 37f543f | new (no fork counterpart) | — |
| 2635b43, 2071394 | tooling / release | — |

## How to try it

```sh
npm install https://github.com/gvdr/sdmx-dashboard-components/releases/download/v1.0.0-rc.2-surfer/sdmx-dashboard-components-1.0.0-rc.2.tgz \
            https://github.com/gvdr/sdmx-json-parser/releases/download/v0.4.1-surfer/sdmx-json-parser-0.4.1.tgz
# or: git checkout surfer-parity && npm ci && npm run build && npm pack
```

npm 12 refuses URL dependencies unless `allow-remote` permits them.

```tsx
import { useCallback } from "react";
import { SDMXDashboard, type SDMXFetcher, type VisualRenderStatus } from "sdmx-dashboard-components";
import "sdmx-dashboard-components/dist/style.css";

const fetcher: SDMXFetcher = (url, init) => fetch(url, init); // e.g. add auth headers here

export function Demo({ config }) {
  const onDone = useCallback((all: VisualRenderStatus[]) =>
    all.filter(s => s.status === "error").forEach(s => console.warn(s.visualId, s.error?.code, s.error?.message)), []);
  return (
    <SDMXDashboard
      config={config}
      lang="en"
      fetcher={fetcher}
      theme={{ palette: ["#0b6e99", "#e07a5f", "#3d405b"], numberFormat: { locale: "en-NZ" } }}
      onRenderComplete={onDone}
      onDataFetch={(t) => console.debug(t.host, t.status, t.durationMs, t.fromCache)}
    />
  );
}
```
