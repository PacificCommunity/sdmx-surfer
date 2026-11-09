# SDMX Surfer — integrating sdmx-dashboard-components 1.0

Nov 2, 2026 · @Giulio Valentino Dalla Riva

## Summary

Move the SDMX Surfer from its vendored fork (0.4.8) to sdmx-dashboard-components 1.0, keeping every feature the fork added and every gain of the new release. The 1.0.0-rc.1 published on 30 Oct 2026 (npm tag `next`) drops the fork's whole API, so the work is in two parts, library first: port the fork's features into the 1.0 code as pull requests to `PacificCommunity/sdmx-dashboard-components` and `sdmx-json-parser`, then switch the surfer to the resulting release. We do the library work ourselves; nothing in the surfer depends on a workaround.

**Principle: no feature lost, several gained.** The table lists what 1.0.0-rc.1 breaks for the surfer and where each item is fixed.

| # | Lost in rc.1 | Fixed in | Section |
| --- | --- | --- | --- |
| 1 | Per-visual render status and typed errors, which feed the agent's self-correction | Library: `onVisualRender`, `onRenderComplete`, `SDMXRenderError` | Library work L1 |
| 2 | ECB, IMF and BIS data: rc.1 forces an `Accept` header they reject, and parser 0.4.0 cannot read ECB and IMF answers | Library: per-request header negotiation; parser 0.4.1 with the dialect fix | Library work L2, L3 |
| 3 | Validation of ambiguous series, injectable `fetcher`, cache, retry, telemetry, slots, interaction events, hidden data table, `SDMXTheme` | Library: ported from the fork, re-targeted at ECharts where engine-bound | Library work L4–L9 |
| 4 | `xAxisTitle`, `yAxisTitle`, honoured `download` flag, KPI refetch on data change, readable `B` and `W` date axes | Library | Library work L8, L10, L12 |
| 5 | The stylesheet import path, Highcharts option keys in saved dashboards, the Highcharts-specific code in the surfer | Surfer | Surfer changes, extraOptions |
| 6 | Maps in PDF export (already broken), map colour scale and zero values (already wrong) | Library, while we are in the map component | Library work L11 |

**Path**

1. Branch `surfer-parity` from upstream `main` (239c6b6) in sdmx-dashboard-components, and `dialects-0.4` from `extend-json-dialects` in sdmx-json-parser (already based on the 0.4.0 commit).
2. Port each fork feature as its own commit with tests, in the order of the Library work section; open one PR per feature so Thomas Tilak can review them while 1.0 is still a release candidate.
3. Cut `1.0.0-rc.2` (or `1.0.0` if merged) and parser `0.4.1`. Until they are on npm, the surfer can install the branches with `npm install github:PacificCommunity/sdmx-dashboard-components#surfer-parity`, which beats a tarball because the source stays visible.
4. Switch the surfer: dependencies, Highcharts removal, compiler and prompt, saved-dashboard migration, exports.
5. Delete `vendor/`.

Everything below was read from the published rc.1 package, upstream `main` at 239c6b6, and the surfer's `main` and `dev` branches on 2 Nov 2026. Endpoint results come from live requests made the same day.

## The new release

| Item | Value |
| --- | --- |
| Version | `1.0.0-rc.1`, git tag `v1.0.0-rc.1`, commit 239c6b6 on `main` |
| Published | 30 Oct 2026; npm `next` tag (`latest` is still 0.5.1) |
| Install | `npm install sdmx-dashboard-components@next` or pin `1.0.0-rc.1` |
| Contents | `dist/index.js` (120 KB, ES module, starts with `"use client"`), `dist/style.css`, `dist/index.d.ts` |
| Entry points | `module` and `types` only; no `main`, no `exports` map, so deep imports such as `dist/style.css` resolve |
| Runtime dependencies | `jexpr` (data-expression evaluator) and `@tsdown/css` |
| ECharts parts registered | Line, Bar, Pie, Treemap, Scatter charts; Aria, Grid, Title, Toolbox, Tooltip, Legend components; Canvas renderer |

**Peer dependencies against the surfer**

| Package | rc.1 needs | Surfer has | Action |
| --- | --- | --- | --- |
| `echarts` | ^6.1.0 | not installed | Add |
| `sdmx-json-parser` | ^0.4.0 | vendored fork 0.3.2 | Conflict: see Fork features |
| `ol` | ^8.2.0 | ^8.2.0 | None |
| `react`, `react-dom` | ^19.1.0 | ^19.2.4 | None |
| `react-bootstrap` | ^2.10.10 | ^2.10.10 | None |
| `react-bootstrap-icons` | ^1.11.6 | ^1.11.6 | None |
| `react-error-boundary` | ^4.0.12 | ^4.1.2 | None |
| `html-react-parser` | ^5.2.10 | ^5.2.17 | None |
| `d3-scale-chromatic`, `proj4` | ^3.0.0, ^2.9.2 | ^3.1.0, ^2.20.4 | None |
| `highcharts`, `highcharts-react-official` | no longer used | ^11.4.8, ^3.2.3 | Remove |

**What rc.1 adds**

- Charts drawn with ECharts 6 on canvas; one builder per chart type.
- `table` visual and `SDMXTable`, with optional cell tooltips through a `formatter`.
- Bar, column, lollipop, treemap and drilldown show the latest non-empty `TIME_PERIOD` per category when the query returns several.
- Charts resize with their container (`ResizeObserver`).
- Dark theme when an ancestor has `data-bs-theme="dark"`.
- Value axes abbreviate large numbers (1.5k, 1.5M); tooltips show full values.
- ECharts accessibility (`aria`) and a save-as-image button on by default.

The map component is unchanged from 0.5.1 apart from import paths: still OpenLayers 8 with the satellite basemap, the colour-scale bug and the zero-value bug.

## Breaking changes from the surfer's 0.4.8

Compared with the vendored 0.4.8 build on `dev` (0.4.7 plus a date-axis patch).

| Area | Fork 0.4.8 | rc.1 | Surfer impact |
| --- | --- | --- | --- |
| Chart engine | Highcharts 11, SVG | ECharts 6, canvas | Every Highcharts reference in the surfer goes; exports must handle canvas |
| Stylesheet | `dist/sdmx-dashboard-components.css` | `dist/style.css`, not imported by `index.js`; class names hashed (`tgeFYG_map`) | Build fails until the import changes; selectors on library classes stop matching |
| Bootstrap | Grid classes | Also `btn`, `btn-link`, `text-danger`, `text-secondary`, `position-absolute`, `top-0`, `start-0`, `w-100`, `h-100`, `opacity-50`, `fw-semibold`, `gap-2`, `lh-1`, `table-responsive`, `text-start/center/end`, `border` | The surfer loads only `bootstrap-grid.min.css`; loading and error overlays and the drilldown Back button render unstyled |
| `extraOptions` | Highcharts options | `EChartsOption`, deep-merged last; arrays concatenated; an object `series` merged into every series | Highcharts keys are silently ignored; array values can add stray axes |
| `colorPalette` | Hex or numeric `colorIndex` | Hex only | Schema change |
| Styled mode | Supported | Removed | None in use |
| `SDMXDashboard` props | `url`, `config`, `lang`, `fetcher`, `theme`, `onVisualRender`, `onRenderComplete`, `onDataFetch`, `onUserInteraction`, `renderLoading`, `renderEmpty`, `renderError` | `url`, `config`, `lang` | Self-correction loop and stacked-treemap check lose their input |
| `SDMXChart` props | Callbacks, slots, `fetcher`, `autoResize`, `theme` object | `callback(EChartsType)`, `theme` (name of a registered ECharts theme), `placeholder` | Snapshots unaffected; they pass only `config` and `language` |
| Exports | `SDMXRenderError`, `VisualRenderStatus`, `VisualInteraction`, `SDMXFetcher`, `FetchTelemetry`, `SDMXTheme`, `SDMXDashboardRow` | None of these; adds `EChartsType`, `SDMXTableTooltipConfig` | `dashboard-preview.tsx` and `render-error-hints.ts` stop compiling |
| Config fields | `xAxisTitle`, `yAxisTitle` | Removed | Axis titles only through `extraOptions.yAxis.name` |
| Row key | `columns` (typo `colums` kept as alias) | Runtime reads `columns`; the type still declares `colums` | Keep `columns`; cast at the boundary |
| Errors | Typed `SDMXRenderError` per visual | Chart and table: in-panel text plus `console.error`. Value and map: unhandled promise rejection | Restored by L1 |
| Requests | Header negotiation per provider; injectable `fetcher`; cache, dedup, one retry | `Accept` hard-coded to SDMX-JSON 2.0; no cache or retry | Restored by L2, L3, L5 |
| KPI refresh | Refetches when its data URL changes | Value refetches only on language change | A KPI edited in the builder keeps its old number until remount |
| Validation | `ERR_NO_SERIES_DIMENSION`, `ERR_AMBIGUOUS_SERIES` | Plain `Error`s for missing concepts only; no ambiguity check | An ambiguous query draws a see-saw line without error |
| Date axes | `D`, `B`, `W` handled; missing `FREQ` tolerated | `D` formatted as a date; `B` falls back to year labels; weekly (`2024-W05`) and semester periods not parsed; missing `FREQ` tolerated | Check ECB daily and business-day series |

## Fork features and data sources

Of the sixteen items in the surfer's `docs/sdmx-dashboard-components-improvements.md`, rc.1 delivers resize handling and partly covers accessibility, theming and frequency-aware date axes (§16); the rest are absent. The fork's source is not lost, although the `dev` vendor README says so: it is on GitHub at `gvdr/sdmx-dashboard-components` (public), as a stack of three branches on upstream 0.4.6: `pr1-observability` (492ca93, 4 commits: validation, `fetcher`, typed errors, lifecycle), `pr2-rendering-transport` (aa954ef, +5: slots, resize, transport, interaction, SSR) and `pr3-api-theming-a11y` (5f8c1d1, +7: API hygiene and table visual, axis titles, theme, accessibility, the ECB `Accept` fix, config-keyed effects, Accept-keyed cache). `5f8c1d1` is the commit the vendored 0.4.7 tarball was built from; 0.4.8 adds only the date-axis bundle patch (`vendor/README.md`), which is in no branch. `fix-ecb-accept-header` (e9373d1) is an older, unsplit version of the same 14 first commits and is superseded. The stack carries 23 vitest files (`lib/**/*.test.ts(x)`). None of it was opened as a PR upstream. The parser fix is on GitHub, branch `extend-json-dialects` at 48cc79f.

| Fork feature (doc §) | In rc.1 | Surfer needs it for | Library work item |
| --- | --- | --- | --- |
| Typed errors, §2 | No | Agent repair hints (`render-error-hints.ts`) | L1 |
| Render lifecycle callbacks, §3 | No | Self-correction, stacked-treemap check, readiness | L1 |
| Request headers | No; `Accept` hard-coded | ECB, IMF, BIS | L2 |
| Parser dialects, §5 | No; parser 0.4.0 reads the .Stat 1.0 envelope but not the ECB root shape | ECB, IMF | L3 |
| Structural validation, §1 | No | Repair of ambiguous queries | L4 |
| Transport, dedup, retry, telemetry, §9, §10, §13 | No | Resilience to flaky endpoints | L5 |
| Slots, §14 | No (`placeholder` only) | Loading and error UI | L6 |
| Interaction callback, §6 | No | Linked views, later | L7 |
| Axis titles | No | Axis labels the agent sets | L8 |
| Theming, §15 | Partly: `theme` name on `SDMXChart`, not through the dashboard | Brand palette | L9 |
| Accessibility, §11 | Partly: ECharts `aria`; no hidden data table | SPC audit | L9 |
| Container resize, §4 | Yes | Reflow hook | Done upstream |
| Table visual | Yes, upstream's own | `kind: "table"` intent | Done upstream; `legend.concept` still sets the columns |
| SSR-safe loading, §12 | Not verified; module carries `"use client"` | Next.js | Keep the `dynamic(ssr: false)` wrappers; not in scope |

**Endpoint check, 2 Nov 2026.** One data query per provider, sent the way rc.1 sends it: parser 0.4.0 appends `format=jsondata`, and rc.1 adds `Accept: application/vnd.sdmx.data+json;version=2.0.0`. Responses were then parsed with both parsers.

| Provider | rc.1 request | Parser 0.4.0 | Fork parser 0.3.2 | Request that works |
| --- | --- | --- | --- | --- |
| SPC | 200, SDMX-JSON 1.0 | Parses | Parses | As sent |
| SBS | 200, SDMX-JSON 1.0 | Parses | Parses | As sent |
| FBOS | 200, SDMX-JSON 2.0 | Parses | Parses | As sent |
| OECD (proxied) | 200, SDMX-JSON 1.0 | Parses | Parses | As sent |
| ILO | 200, SDMX-JSON 2.0 | Parses | Parses | As sent |
| ABS | 200, SDMX-JSON 2.0 | Parses | Parses | As sent |
| UNICEF | 200, SDMX-JSON 2.0 | Parses | Parses | As sent |
| BIS | 406 | Parses the 1.0 answer, values as strings | Parses, values numeric | `Accept: …version=1.0.0` |
| ECB | 406 | Fails: "Structure not found" | Parses | No `Accept`, or `application/json` |
| IMF | 500 | Fails: "Structure not found" | Parses | `Accept: application/json` |
| Eurostat (proxied) | 406 | n/a | n/a | No JSON form found; not supported before either |
| StatsNZ (proxied) | 401 from here: the key is injected server-side | Not tested | Not tested | Expected to work through the proxy |

So the seven providers that already speak SDMX-JSON 2.0 or the .Stat 1.0 envelope work with rc.1 as published. ECB and IMF need both a header change and the fork parser; BIS needs the header change and is better with the fork parser.

**Parser peer range.** rc.1 declares `sdmx-json-parser ^0.4.0`; the fork is 0.3.2. Rebase `extend-json-dialects` onto 0.4.0 and publish 0.4.1 (L3); the surfer then installs the registry version and the parser tarball goes.

## Library work

Each item is one PR on branch `surfer-parity` in sdmx-dashboard-components (source at `lib/`, tests with vitest in `lib/**/*.test.ts`), except L3, which is a parser PR. Port each fork feature from its commit on the `gvdr/sdmx-dashboard-components` stack (above), re-targeting engine-bound code from Highcharts to ECharts; the improvement doc's acceptance criteria stay the spec. Order matters: L1 and L2 unblock the surfer; L5 gives the others a single fetch path.

**L1 — Render status and typed errors** (improvement doc §2, §3)

- Restore `lib/errors.ts`: `SDMXRenderError` with codes `ERR_FETCH`, `ERR_PARSE`, `ERR_EMPTY`, `ERR_NO_SERIES_DIMENSION`, `ERR_AMBIGUOUS_SERIES`, `ERR_CONCEPT_NOT_FOUND`, `ERR_ENGINE`, and `toSDMXRenderError(error, visualId)`, which classifies plain errors by message. rc.1 throws plain `Error`s in `chart/options.ts` (`xAxisConcept … not found in dataflow`, `legendConcept … not found`, `No other dimension than …`), `value/index.tsx` and `map/index.tsx`; convert each to a typed error. Keep the fork's messages word for word: the surfer's `render-error-hints.ts` and tests read them.
- `onVisualRender(status)` on `SDMXChart`, `SDMXTable`, `SDMXValue`, `SDMXMap`, with `status` in `loading | rendered | empty | error` and `stats` (`computeRenderStats` from the fork: observation count, series count, period range). Fire `rendered` after `setOption` completes; `error` from every catch; `empty` when the datasets have no observations.
- `onRenderComplete(all)` on `SDMXDashboard`, fired once every cell has reported. Thread the props through `cell/index.tsx`.
- `ERR_ENGINE`: wrap `setOption` in try/catch and subscribe to ECharts' `error` event.
- Value and Map must catch their promise rejections instead of leaving them unhandled.

**L2 — Request headers** (new; surfer fork behaviour)

- Remove the hard-coded `Accept: …version=2.0.0` in `chart/options.ts`, `value/index.tsx`, `map/index.tsx` and `utils/parseDataExpr.tsx`. Send only `Accept-Language` and let the parser negotiate (L3), or accept a `headers` option per visual config and dashboard prop. Verified on 2 Nov: ECB needs no `Accept` or `application/json`, IMF needs `application/json`, BIS needs `version=1.0.0`; the other seven providers accept both 1.0 and 2.0 negotiation.

**L3 — Parser 0.4.1** (improvement doc §5, branch `extend-json-dialects`)

- `extend-json-dialects` already sits on 18fdcc8, the commit npm 0.4.0 was published from, so no rebase is needed; bump `package.json` (still 0.3.1 on `master` and on the branch) to 0.4.1. The fork parser already negotiates `Accept` when the caller sends none, tries `version=1.0.0`, then no header, then `application/json`, and normalises the .Stat envelope and ECB root dialects; keep all of it. Numeric-string coercion (BIS returns `"4.25"`) is already on the branch (48cc79f). Add the fixtures captured on 2 Nov (one response per provider) to the test suite.

**L4 — Series validation** (§1)

- `utils/validateChartData.ts`: `findVaryingDimensions` and `validateSeriesDimensions(chartType, xAxisConcept, legendConcept, data, dimensions)`, called in `chart/options.ts` before the builders. Throws `ERR_NO_SERIES_DIMENSION` or `ERR_AMBIGUOUS_SERIES` with the fork's messages.

**L5 — Transport** (§9, §10, §13)

- `utils/transport.ts`: `createTransport(fetcher, onDataFetch)` with in-flight de-duplication keyed on URL + Accept + Accept-Language, a cache of 2xx responses for the transport's lifetime, one retry on network error or 5xx, and `FetchTelemetry`. `fetcher` and `onDataFetch` props on every component and the dashboard; the dashboard creates one transport per config. The parser already takes a `fetcher` option.

**L6 — Slots** (§14): `renderLoading(visualId)`, `renderEmpty(visualId)`, `renderError(error)` on every component and the dashboard, replacing the fixed "Loading..." and "Failed to load chart." nodes.

**L7 — Interaction** (§6): `onUserInteraction({ visualId, kind, concepts, value, timePeriod })` from ECharts `click` (point and series) and `legendselectchanged`, using `buildInteractionConcepts` and `buildSeriesConcepts` from the fork's `utils/interaction.ts` to turn series names back into codes.

**L8 — Config fields**: `xAxisTitle`, `yAxisTitle` (`SDMXTextConfig`, localised) compiled to `xAxis.name` and `yAxis.name`, swapped for horizontal `bar`; `download: false` sets `toolbox.show = false`; `rows[].columns` declared in `types.ts` with `colums` as a deprecated alias (the runtime already reads `columns`).

**L9 — Theme and accessibility** (§15, §11): `SDMXTheme` (`palette`, `fontFamily`, `numberFormat`) accepted on the dashboard and components, registered as an ECharts theme with `echarts.registerTheme` and applied at lowest precedence; `resolveNumberLocale` for tooltip and table formatting. `HiddenDataTable` rendered under every chart, as in the fork.

**L10 — Value refetch**: `value/index.tsx` refetches on the same `loadKey` as the chart (`data`, `language`, `xAxisConcept`), not only on language.

**L11 — Map fixes** (not fork features, but cheap while there): tile source with `crossOrigin: "anonymous"` and a `basemap` option (`satellite | none | url`); colour scale `(v − min) / (max − min)`; fill areas whose value is 0; join by code before falling back to label; a `toImage()` on the callback's map for export.

**L12 — Date axes** (§16): in rc.1 `chart/line.ts` gives `B` the yearly `{yyyy}` labels, and `utils/parseDate.tsx` returns `null` for weekly (`2024-W05`) and semester (`2024-S1`) periods, so the raw string is plotted on a `time` axis. Format `B` like `D`, parse `W` and `S`, and keep the guarded `FREQ` lookup. The fork's 0.4.8 date-axis patch (`vendor/README.md`) gives the test cases.

**Tests to carry over.** Port the fork's vitest files from `pr3-api-theming-a11y` with each feature, starting with the ones the surfer depends on: `lib/errors.test.ts` and `lib/components/chart/errors.test.tsx` (error-message contract), `lib/utils/validateChartData.test.ts`, `lib/utils/transport.test.ts` and `lib/components/transport.test.tsx` (dedup and retry), plus the parser dialect fixtures. Tests that assert Highcharts output change with the engine.

## Surfer changes, file by file

Paths are on `dev`. These assume the Library work is in the release the surfer installs; no workaround for a missing library feature is kept in the surfer.

**Dependencies and build**

1. `package.json`: `"sdmx-dashboard-components": "^1.0.0"` (or the `surfer-parity` branch until published); `"sdmx-json-parser": "^0.4.1"`; add `"echarts": "^6.1.0"`; remove `highcharts` and `highcharts-react-official`.
2. `vendor/`: delete the directory and the `file:` references. `scripts/apply-patches.mjs` no longer exists; only `vendor/README.md` (deleted with it) and the historical notes in `docs/sdmx-dashboard-components-improvements.md` still name it.
3. `app/layout.tsx`: replace `sdmx-dashboard-components/dist/sdmx-dashboard-components.css` with `sdmx-dashboard-components/dist/style.css`.
4. `app/globals.css`: add a shim for the Bootstrap utility classes rc.1 uses, scoped to the dashboard containers (list in Breaking changes), because the surfer loads only `bootstrap-grid.min.css` and several of those names clash with Tailwind if `bootstrap-utilities.css` is loaded whole. The `[class*="legendItem"] img` fix keeps working with the hashed class.

**Remove Highcharts**

5. `components/sdmx-dashboard-dynamic.tsx`: drop the `highcharts` import and the `displayError` handler; keep the `dynamic(..., { ssr: false })` wrapper.
6. `components/country-snapshots/snapshot-chart.tsx`: same for `SnapshotChart`; `SnapshotValue` is unchanged.
7. `lib/use-highcharts-viewport-reflow.ts`: delete, with its calls in `app/p/[id]/page.tsx`, `app/dashboard/[id]/page.tsx` and `components/dashboard-preview.tsx`. 1.0 resizes charts itself.

**Builder preview**

8. `components/dashboard-preview.tsx`: `onRenderComplete` and `VisualRenderStatus` stay as they are once L1 lands. Drop `.highcharts-container` from `LOAD_COMPLETE_SELECTOR` (`canvas` and `.ol-viewport` remain). In the `unhandledrejection` filter, replace `"Highcharts"` with `"ECharts"`; with L1 the library catches its own errors, so the filter becomes a safety net. `findStackedTreemaps` in `render-error-hints.ts` already flags a rendered treemap with `seriesCount > 1`; only its doc comment and message change: in 1.0 a varying `seriesBy` puts every series into one treemap with repeated tile names rather than stacking panels.
9. `lib/render-error-hints.ts`: the codes and messages are the same as the fork's, but the `ERR_TREEMAP_STACKED` hint teaches the Highcharts `"plotOptions": { "series": { "stacking": "normal" } }`; replace it with `stacked: true`.

**Data requests**

10. `app/sdmx-proxy-boot.tsx` and `app/api/sdmx-proxy/route.ts`: unchanged. With L2 the library no longer forces an `Accept` header, so the proxy's default of `version=1.0.0` and the parser's negotiation (L3) handle ECB, IMF and BIS. Keep the per-provider endpoint check (Fork features section) as a test.

**Types and schema**

11. `lib/types.ts`: match 1.0; `colorPalette` values become `string`; `extraOptions` stays `Record<string, unknown>` at the surfer boundary; add `xAxisTitle` and `yAxisTitle`.
12. `lib/dashboard-schema.ts`, `lib/dashboard-authoring.ts`: `colorPalette` drops the `z.number()` branch; `axisTitle` compiles to `yAxisTitle` (L8) instead of `extraOptions`; the rest is in the next sections.

**Tests** — three suites pin Highcharts output and change with the code: `tests/dashboard-authoring.test.ts` (the `compileTreemap` cases expect `plotOptions.treemap` from `withTreemapDefaults`), `tests/render-error-hints.test.ts` (expects `/stacking/` in the treemap hint) and `tests/system-prompt.test.ts` (expects `"stacking": "normal"`).

**Exports** — `lib/export-dashboard.ts`, covered in Export to PDF and HTML.

**Docs** — `dashboard-architecture.md` and `stitch_assets/dashboard_architecture.md` say "Highcharts extraOptions pass-through"; update to ECharts. Highcharts is also named in `CLAUDE.md`, `README.md`, `docs/technical-reference.md`, `stitch_assets/stitch/oceanic_logic/DESIGN.md`, the chart-palette comment in `app/globals.css` and `scripts/repro_chart.mjs`; update them or the "No Highcharts" check fails. `SECURITY_AUDIT.md` is a dated record and stays.

## extraOptions and saved dashboards

Every saved dashboard lives in `dashboard_sessions.config_history` (a JSON array, with `config_pointer` marking the current entry; published dashboards are rows with `published_at` set). Translate all entries, not only the current one, so undo and redo keep working.

1. **Inventory first.** Count the distinct `extraOptions` key paths across all `config_history` entries, so the translator covers what the agent actually wrote.
2. **One-off migration** with a backup of the table: translate each visual's `extraOptions`, then write back.
3. **Load-time guard:** run the same translator when a config is loaded, and log any Highcharts key it cannot place. This covers configs created between the migration and the deploy, and configs pasted into the JSON editor.
4. **Delete the compiler's Highcharts output:** `withTreemapDefaults` in `lib/dashboard-authoring.ts` injects `plotOptions.treemap` into every treemap. ECharts already colours each tile and uses a squarified layout by default, so the function can go.

**Translation table.** In rc.1 a `bar` chart is horizontal with the value axis on `xAxis`, while Highcharts put the value axis on `yAxis` for every chart type; the axis rows flip for `bar`.

| Highcharts key | ECharts key (`column`, `line`, `lollipop`) | For `bar` | Notes |
| --- | --- | --- | --- |
| `yAxis.title.text` | `yAxis.name` | `xAxis.name` | The form the system prompt teaches today; rc.1 centres and rotates the y-axis name itself |
| `xAxis.title.text` | `xAxis.name` | `yAxis.name` |  |
| `yAxis.min`, `yAxis.max` | `yAxis.min`, `yAxis.max` | `xAxis.min`, `xAxis.max` |  |
| `yAxis.type: "logarithmic"` | `yAxis.type: "log"` | `xAxis.type: "log"` |  |
| `yAxis.reversed` | `yAxis.inverse` | `xAxis.inverse` |  |
| `yAxis.labels.format: "{value}%"` | `yAxis.axisLabel.formatter: "{value}%"` | `xAxis.axisLabel.formatter` | Highcharts number formats such as `{value:,.0f}` have no string equivalent: drop them |
| `xAxis.labels.rotation` | `xAxis.axisLabel.rotate` | `yAxis.axisLabel.rotate` |  |
| `legend.enabled: false` | `legend.show: false` | same |  |
| `plotOptions.series.stacking: "normal"` | `series: { stack: "total" }` | same | The object form of `series` is merged into every series |
| `plotOptions.series.stacking: "percent"` | none | none | Drop and log; needs a percentage query instead |
| `plotOptions.series.dataLabels.enabled` | `series: { label: { show: true } }` | same | Or use the config's own `labels: true` |
| `plotOptions.treemap.*` | drop | n/a | ECharts defaults already match |
| `colors: [...]` | `color: [...]` | same |  |
| `tooltip.valueSuffix`, `tooltip.valuePrefix` | drop | drop | `valueFormatter` is a function and cannot be stored as JSON; `unit` and `decimals` cover it |
| `chart`, `credits`, `exporting`, `accessibility`, `title`, `subtitle` | drop | drop | The library builds these |

Keys that are already valid ECharts with the same meaning (`grid`, `legend.top`) pass through. Anything else is dropped and logged. Never pass an array value through: rc.1 concatenates arrays, so a Highcharts `yAxis: [...]` would add a second, broken axis.

## AI prompt and authoring schema

Give the agent schema fields for what it actually needs and let the compiler write the ECharts options, so the next engine change touches the compiler only.

**New intent fields** (`lib/dashboard-authoring.ts`, chart intent)

| Field | Compiles to | Replaces |
| --- | --- | --- |
| `axisTitle` (string or localised text) | `yAxisTitle` (L8); the library swaps axes for `bar` | `extraOptions.yAxis.title.text` |
| `categoryAxisTitle` (optional) | `xAxisTitle` | `extraOptions.xAxis.title.text` |
| `stacked: true` | `extraOptions.series.stack = "total"` | `extraOptions.plotOptions.series.stacking: "normal"` |

**System prompt** (`lib/system-prompt.ts`, lines 202–205 on `dev`)

- "ALWAYS set `unit` — the library uses it for the y-axis label": no longer true. Keep the rule, with the reason rc.1 gives it: `unit` appears in tooltips, table headers and KPI values. Point to `axisTitle` for the axis label.
- Replace the `extraOptions.yAxis.title` example with `axisTitle`.
- Stacked-bar recipe: replace the `plotOptions.series.stacking` snippet with `stacked: true`.
- Treemap rule: keep "pin `seriesBy` to one value"; update the reason. In rc.1 a varying `seriesBy` puts every series into one treemap with repeated tile names instead of stacking panels.
- `colorPalette`: hex colours only.
- `extraOptions`: say it takes ECharts option names, objects only, and is a last resort. Remove any remaining Highcharts vocabulary.

**Brand palette** — rc.1 uses ECharts 6's default palette, and the surfer's seven `--color-chart-*` tokens in `globals.css` were never applied to charts under Highcharts either. With L9, pass `theme={{ palette: [...] }}` to `SDMXDashboard` from the brand tokens; `colorPalette` on a visual still wins. Decide whether the brand palette or ECharts' default is wanted.

**Unchanged:** the authoring intents, the native schema shape, the map intent and its compiled packed string, the few-shot examples in `lib/dashboard-examples.ts` (none use `extraOptions`), and the MCP gateway.

## Export to PDF and HTML

All three export paths in `lib/export-dashboard.ts` were written for Highcharts SVG; under rc.1 charts are canvas. The static HTML export breaks outright, the PDF needs one adjustment, and the live HTML export needs new URLs.

| Export | Today | Under 1.0 | Change |
| --- | --- | --- | --- |
| PDF (`exportToPdf`) | Converts Highcharts SVGs to canvases, then html2canvas | html2canvas copies same-origin canvases, so charts appear, but with the save-as-image icon drawn into them | Swap each chart for a clean image before capture (below) |
| Static HTML (`exportToHtml`) | Copies `innerHTML`, so the SVG charts come along | `innerHTML` carries empty `<canvas>` tags: every chart is blank | Swap each chart for an image before reading `innerHTML` |
| Live HTML (`exportToHtmlLive`) | Loads 0.4.6 and `dist/index.css` from esm.sh | Wrong version and a stylesheet path that does not exist | Load the released 1.0 and `dist/style.css`; add the Bootstrap utilities |
| Maps, all paths | Satellite tiles taint the canvas; dropped from the PDF | Fixed by L11 (`crossOrigin`, `basemap: "none"`, `toImage()`) | Swap each map for `toImage()` output before capture, like charts |

**Chart-to-image swap.** ECharts marks each chart container with the `_echarts_instance_` attribute. Before capture, for each such element under the dashboard root:

1. `const chart = getInstanceByDom(el)` from `echarts/core`. The surfer must import it from the same `echarts` package the library uses; the peer dependency guarantees a single copy.
2. `chart.getDataURL({ pixelRatio: 2, backgroundColor: "#fff", excludeComponents: ["toolbox"] })`.
3. Insert an `<img>` with that URL and the container's size, hide the container, and restore both after capture, as the SVG swap does today.

The SVG-to-canvas step can then shrink to icon SVGs only. In `collectStyles`, drop the `highcharts` selector checks.

**Per-chart download.** rc.1 ignores the `download` config flag and shows the save-as-image button on every chart; L8 restores the flag. No compiler change.

**Live HTML export limits**: the file loads the registry parser and has no fetch wrapper or proxy, so ECB, IMF, BIS, OECD, Eurostat and StatsNZ panels do not load in it.

## Integration order and checks

Library first, then the surfer. Each step leaves both repositories building.

1. **Branches.** `surfer-parity` from components `main` at 239c6b6; `dialects-0.4` in the parser from `extend-json-dialects` (already on the 0.4.0 commit). Gate: both build; the components' vitest suite passes.
2. **L3 parser.** Dialect fixtures from the 2 Nov captures; publish `0.4.1`. Gate: all eleven provider fixtures parse with numeric values.
3. **L2 + L1.** Headers, typed errors, render status. Gate: the surfer's `render-error-hints.ts` test strings match the library's messages; a dashboard with one panel each from SPC, ECB, IMF and BIS reports four `rendered` statuses.
4. **L4, L5, L6, L10.** Validation, transport, slots, value refetch. Gate: dedup and retry tests; an ambiguous query throws `ERR_AMBIGUOUS_SERIES`.
5. **L8, L9, L7, L11, L12.** Config fields, theme and hidden table, interaction, map fixes, date axes. Gate: map exports with basemap; value 0 is filled; `B` and `W` series show dates.
6. **Release.** Open the PRs upstream; tag `1.0.0-rc.2` on the branch for the surfer to install in the meantime.
7. **Surfer swap.** Dependencies, CSS, Highcharts removal, preview, types, compiler and prompt. Gate: `npm run build`, `tests/dashboard-authoring.test.ts`, no `highcharts` in source or lockfile.
8. **Saved dashboards.** Inventory, migration with backup, load-time guard. Gate: inventory shows no untranslated keys.
9. **Exports.** Chart and map image swap, live HTML URLs. Gate: export checks below.
10. **Clean-up.** Delete `vendor/`; update `dashboard-architecture.md` and `docs/sdmx-dashboard-components-improvements.md` to say which items shipped in 1.0.

**Acceptance checks**

| Check | Pass when |
| --- | --- |
| Fork API parity | The surfer on `dev` type-checks against the new release with only the changes in Surfer changes |
| Error contract | The surfer's `render-error-hints.ts` strings match the library's messages; each code can be triggered from a config |
| Chart types | line, bar, column, pie, lollipop, treemap, drilldown, value, table, map and note each render from a surfer example config |
| Providers | A panel from each of the 11 reachable providers renders; StatsNZ through the proxy |
| Daily data | An ECB daily (`D`) and business-day (`B`) series shows readable dates, not epoch numbers |
| Self-correction | Unknown concept, empty query, unreachable URL and ambiguous series each reach the agent with the panel id and code |
| Edits | Changing a KPI's data URL in the builder updates the number |
| Saved dashboards | A sample of published dashboards renders with axis titles and stacking preserved |
| Country snapshots | Entry, thematic and regional pages render; the snapshot PDF export completes |
| PDF export | Charts and maps present, no toolbox icon |
| Static HTML export | Charts and maps visible when opened offline |
| Live HTML export | SPC panels load from a local HTTP server |
| No Highcharts | No `highcharts` string in either repository's source or lockfile |
| Bundle size | Measured before and after; record the change |

## Risks and open questions

| Risk | Likelihood | Mitigation |
| --- | --- | --- |
| Upstream 1.0.0 final ships before the parity PRs merge, and later refactors conflict with them | High | Open the PRs early and small; rebase `surfer-parity` on `main` weekly; the surfer installs the branch, not `main` |
| A ported feature behaves differently once re-targeted at ECharts | Medium | Port the fork's own tests with each feature and make them pass; the surfer's error-message tests go first |
| Saved dashboards lose options the inventory did not foresee | Medium | Inventory before migrating; the load-time guard logs what it drops |
| ECB, IMF or BIS change content negotiation again | Medium | The parser's negotiation order is data; keep the eleven fixtures as a live smoke test |
| The release candidate changes again before 1.0 final | High | Pin the exact version; re-run the acceptance checks on each candidate |
| Bundle grows or renders slower | Low | Measure; rc.1 registers only the ECharts parts it uses |

**Open questions**

- Does Thomas Tilak want the parity work as PRs against `main` now, or against a `1.0` maintenance branch once final is cut?
- Who publishes `sdmx-json-parser` 0.4.1 to npm?
- Brand palette or ECharts default for charts?
- Is `dev` the branch that ships to production? `main` is an ancestor of `dev` (`dev` is 40 commits ahead, 0 behind on 2 Nov), so promoting `dev` is a fast-forward.
- Multi-level maps (separate spec) build on L11's `basemap` and `toImage()`; should L11 go in with the same PR or wait?

## Local checkouts (checked 2 Nov 2026)

| Checkout | State | Left behind |
| --- | --- | --- |
| `../sdmx-surfer.pdh-visual` | Branch `pdh-visual` at 3f12479, clean, in sync with `origin`; vendors the older `sdmx-dashboard-components-0.4.7.tgz` | Nothing: `origin/pdh-visual` is fully merged into `dev`. Its `.env.local` has the same keys as this checkout; only `NEXTAUTH_URL` differs |
| `../sdmx-dashboard-components` | `main` at b3b661f (0.5.1), cloned 18 Aug from `PacificCommunity`, clean, no local branches or stray objects | Not the fork, which lives on GitHub at `gvdr/sdmx-dashboard-components` (branches above). After `git fetch`, `origin/main` is 239c6b6 (`v1.0.0-rc.1`), the base for `surfer-parity`. Add the fork as a second remote to cherry-pick from |
| `../sdmx-json-parser` | `master` at 18fdcc8, clean | Nothing local. `origin/extend-json-dialects` (48cc79f) is two commits on 18fdcc8, the commit npm `0.4.0` was published from (its `gitHead`), so L3 needs no rebase, only a version bump: `master`'s `package.json` still says 0.3.1. `origin/normalise-sdmx-json-v1` and `origin/pluggable-fetcher` are earlier iterations whose dialect normalisation, `fetcher` option and ECB `keyPosition` synthesis are all in `extend-json-dialects` |

Other branches of this repository: `origin/country-snapshots` shows 11 commits ahead of `dev`, but `git cherry` finds every one already in `dev`; `treemap-single-series`, `next-auth-v5` and `main` are ancestors of `dev`.

## Status (2 Nov 2026)

Steps 1–10 of the integration order are done, step 6 on the forks only (no upstream PRs yet). `--apply` ran on 2 Nov against the database in `.env.local` and rewrote 19 sessions; the original data is in `dashboard_sessions_backup_extra_options_20261102024218`. `…_20261102024236` is a redundant copy of the already-migrated table, made by a second run before the script learned to back up only when it writes; it can be dropped. Charts default to the brand palette (`BRAND_CHART_THEME` in `lib/brand-theme.ts`, mirroring `--color-chart-*`).

| Piece | Where |
| --- | --- |
| Library | `gvdr/sdmx-dashboard-components`, branch `surfer-parity` (88d1d25): rc.1 plus L1, L2, L4–L12, an ESLint config, and fixes from the acceptance run (ERR_EMPTY for .Stat 404s, axis names inside the canvas, compact error panel, non-overlapping time labels, treemap default series). Version `1.0.0-rc.2`, 203 vitest tests |
| Parser | `gvdr/sdmx-json-parser`, branch `dialects-0.4` (077b6ad): 0.4.1 with `prepare` build, ten provider fixtures, and `NO_RECORDS` for a .Stat `NoRecordsFound` 404 |
| Install | The published npm releases `sdmx-dashboard-components@1.0.0-rc.2` (tag `next`, equal to upstream `main` after PRs #31–#49) and `sdmx-json-parser@^0.4.2`, since 9 Nov 2026. From 6 to 9 Nov `package.json` named the npm version but `package-lock.json` still resolved it to the fork's `v1.0.0-rc.2-surfer` tarball, which carries the same version number, so npm never fetched the registry build. The fork tarballs and `.npmrc` are gone. `vendor/` is gone |
| Surfer | Branch `echarts-1.0`: Highcharts removed; `extraOptions` translator (`lib/extra-options.ts`) applied on load, on publish reads and in the JSON editor; `scripts/migrate-extra-options.mts` (`--inventory`, `--dry-run`, `--apply`); `axisTitle`, `categoryAxisTitle`, `stacked` intent fields; image-swap exports, also used by the country-snapshot PDF |

**Inventory:** 307 sessions, 553 history entries, 16 distinct `extraOptions` key paths. The dry run changes 19 sessions; dropped keys are `chart.inverted` (6 visuals, one session), `chart.stacking`, percent stacking, `seriesMapping`, `plotOptions.treemap.*`, `yAxis.plotLines`, `xAxis.categories` and a stored formatter string.

**Acceptance results**

| Check | Result |
| --- | --- |
| Saved dashboards | All 99 panels on the 11 published dashboards match the baseline; the 9 panels that fail do so on both builds (7 `ERR_NO_SERIES_DIMENSION`, 2 IMF `ERR_EMPTY`) |
| Chart types | All 11 render |
| Providers | 11 of 11, StatsNZ through the proxy |
| Daily data | `D` and `B` show ISO dates |
| Self-correction | Unknown concept, unreachable URL, ambiguous series and empty query reach the agent with id and code |
| Edits | KPI updates without remount |
| Country snapshots | Pages render; PDF completes, now without toolbox icons |
| PDF, static HTML | Charts and map present; offline the map legend's gradient image (loaded from GitHub by the library) is missing |
| Live HTML | Works with SPC panels, pinned to the published `1.0.0-rc.2` and parser `0.4.2` (with an import-map shim for `ol/ol.css` and the CommonJS parser); re-checked 6 Nov 2026 |
| No Highcharts | None in source or lockfile, apart from the translator and its migration script, whose input is Highcharts options |
| Bundle size | Client JS 7,494,052 → 7,677,073 bytes (+2.4%); gzip 2,184,870 → 2,268,340 (+3.8%) |

**Still to do**

- Upstream review: done. All library PRs (#31–#49) and parser PR #12 are merged, and upstream published `1.0.0-rc.2` and parser `0.4.2` on npm, which the surfer installs (see Install above for the lockfile slip). Upstream handled the treemap glue differently: a dataflow with no dimension besides the x axis throws a plain `Error`, not `ERR_NO_SERIES_DIMENSION`. `surfer-parity`, `surfer-integration` and the `pr/*` branches on `gvdr/sdmx-dashboard-components` are no longer used.
- Library suite: a few transport, `stableConfig` and theme tests timed out once under full-suite load and passed on re-run.
- The release assets were replaced once under the same versions (after the acceptance fixes). Next's build cache then served the old library code until `.next` was deleted. Bump the version for every future re-release instead of replacing an asset.
- Where the implementation differs from the plan above: the `SDMXTheme` is merged under the built option, not registered with `echarts.registerTheme` (L9); `ERR_ENGINE` comes from guards around ECharts calls, since ECharts 6 has no `error` event (L1); the parser has ten provider fixtures, not eleven (StatsNZ has none). Upstream PR descriptions are drafted in `docs/upstream-prs/`.

**Single-series bar, column and lollipop charts** (done upstream, PR #47)

A grouping chart whose query varies only along the x axis renders when `legend.concept` names the series, even if that dimension holds a single value: a ranking of countries for one year is `xAxis: GEO_PICT`, `legend.concept: TIME_PERIOD`, query pinned to that year. Without `legend.concept` it still fails with `ERR_NO_SERIES_DIMENSION`. The agent's prompt (`lib/system-prompt.ts`), the render-error hint and the authoring compiler's message teach this shape. Still open from the original design: hiding the one-entry legend and putting the period in the subtitle.
