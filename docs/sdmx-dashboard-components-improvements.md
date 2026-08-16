# sdmx-dashboard-components: proposed library improvements

Giulio Valentino Dalla Riva · SDD - SPC · 12 June 2026

**Audience:** the sdmx-dashboard-components maintainers, and anyone preparing PRs against `PacificCommunity/sdmx-dashboard-components` or `PacificCommunity/sdmx-json-parser`.

**Purpose:** specify the interface gaps that Data Surfer currently works around with binary patches and engine reach-arounds, so they can be closed in the library itself. Each item states the problem, the evidence from production use, a proposed API, and acceptance criteria. Items are independent; any subset can be picked up.

**Status of each item:** `P1` blocks removing a production workaround today. `P2` removes a class of consumer-side complexity. `P3` is hygiene and future-proofing, valuable to batch into a planned major version.

---

## Context: the library now has a machine as a consumer

Data Surfer drives this library from an AI agent loop: the agent emits dashboard configs, the library renders them, and the agent needs to know what happened so it can self-correct. This adds two requirements that a human-only consumer never exercised:

1. **Failures must be observable and descriptive.** A blank panel is acceptable to a patient human; to an agent it is indistinguishable from success. Error messages are read by the model and become the correction prompt, so their wording has direct product value.
2. **Render state must be reported, not inferred.** Surfer currently detects render completion by polling the DOM for engine-specific class names. That breaks the moment the internal charting engine changes.

Both consumers of the library at SPC (the Surfer builder and the Country Snapshots module) hit these limits in production. The workarounds in place today:

| Workaround | Where it lives in sdmx-surfer | What it compensates for |
|---|---|---|
| Binary patch on the dist bundle: throw a descriptive error when a bar/column chart has no second varying dimension | `scripts/apply-patches.mjs`, patch 2 | silent blank panel (§1) |
| Binary patch on sdmx-json-parser dist: reshape SDMX-JSON v1.0 responses into v2.0 | `scripts/apply-patches.mjs`, patch 1 | parser requests v1.0 (`format=jsondata`) yet reads v2.0 (§5) |
| Global Highcharts `displayError` handler installed at import time | `components/sdmx-dashboard-dynamic.tsx`, `components/country-snapshots/snapshot-chart.tsx` | no error contract (§2) |
| DOM polling for `.highcharts-container` to detect render completion | `components/dashboard-preview.tsx` | no render lifecycle API (§3) |
| Direct `highcharts` import to call `chart.reflow()` on container resize | `lib/use-highcharts-viewport-reflow.ts` | no resize handling (§4) |
| Global `window.fetch` wrapper rewriting SDMx hosts to a server-side proxy | `app/sdmx-proxy-boot.tsx` | no fetch injection (§9) |
| Every component wrapped in `dynamic(ssr: false)` | `components/sdmx-dashboard-dynamic.tsx`, `components/country-snapshots/snapshot-chart.tsx` | browser globals touched at import time (§12) |

Binary patches anchor on exact strings in the minified bundle. Every upstream release invalidates them and breaks the consumer's build until the patch is re-derived. The point of this document is to delete that table.

---

## 1. Structural validation with descriptive errors (P1)

### Problem

The charting model supports series on at most one varying non-time dimension. Today the library handles violations of that rule in two silent ways:

- A bar or column chart whose query has **no** varying dimension besides the x-axis renders a blank panel (the internal series lookup returns `undefined` and downstream code no-ops).
- A chart whose query has **two or more** varying dimensions merges the extra dimension's observations into one series, producing a zig-zag line that looks like data but is an artefact ("see-saw" plots).

Both states look like rendering succeeded. Surfer patches the first case to throw; the second case can only be avoided by consumer-side query modelling (Surfer built a decision engine for this, `lib/country-snapshots/config-builder.ts`).

### Proposal

Before rendering, count the non-x-axis dimensions that vary in the fetched data (more than one distinct value). Then:

- chart types that require a grouping dimension (`bar`, `column`, `lollipop`) with zero varying dimensions: fail with `ERR_NO_SERIES_DIMENSION`;
- any chart type with two or more varying dimensions and no `legend.concept` disambiguation: fail with `ERR_AMBIGUOUS_SERIES`;
- in both cases the error message must name the chart type, the x-axis concept, the dimensions that vary with their value counts, and the concrete fixes (switch chart type, widen or narrow the query, set `legend.concept`).

The message Surfer ships today in its patch, kept verbatim because agents already self-correct from it:

> Chart type={type} with xAxis={xAxisConcept} needs at least one other varying dimension to group bars/columns. Only {xAxisConcept} varies in this query. Fix: switch chart type to line or pie, widen the data query so a second dimension varies (e.g. remove lastNObservations or broaden the filter), or set legend.concept to a dimension with multiple values.

### Acceptance criteria

- A bar chart over a single-series query produces a caught, surfaced error, never a blank panel.
- A line chart over a query with two varying non-time dimensions produces `ERR_AMBIGUOUS_SERIES`, never a see-saw render.
- The error text includes every element listed above. A unit test asserts on the message content, treating it as a public contract.

---

## 2. Error contract (P1)

### Problem

Errors currently escape in three inconsistent ways: synchronous engine throws (Highcharts error #14 on string data), unhandled promise rejections from the parser ("Series not found and observations empty"), and silent no-ops (§1). Consumers cannot distinguish "data problem", "config problem", and "engine problem", and cannot rely on any of them being catchable in one place.

### Proposal

All failures funnel through one typed error with a stable code:

```ts
export type SDMXRenderErrorCode =
  | "ERR_FETCH"               // data URL unreachable or non-2xx
  | "ERR_PARSE"               // response is not parseable SDMX-JSON
  | "ERR_EMPTY"               // query returned zero observations
  | "ERR_NO_SERIES_DIMENSION" // §1
  | "ERR_AMBIGUOUS_SERIES"    // §1
  | "ERR_CONCEPT_NOT_FOUND"   // xAxisConcept / legend.concept not in the structure
  | "ERR_ENGINE";             // anything escaping the charting engine

export class SDMXRenderError extends Error {
  code: SDMXRenderErrorCode;
  visualId: string;
  detail?: Record<string, unknown>; // e.g. { concept: "REF_AREA", available: ["GEO_PICT", ...] }
}
```

Engine-internal errors (the current `displayError` cases) are caught inside the library and re-thrown as `ERR_ENGINE` with the original attached as `cause`. Consumers stop installing global handlers on the engine object.

`ERR_CONCEPT_NOT_FOUND` deserves a note: Surfer hit this as a stream of raw console errors ("legendConcept REF_AREA not found") when a config assumed the wrong geography dimension. The structured `detail` with the list of available concepts is what allows an agent, or a helpful UI, to fix the config in one step.

### Acceptance criteria

- Every failure path in chart, value, and map rendering produces an `SDMXRenderError` with the correct code.
- No code path writes raw engine errors to the console without also surfacing the typed error.
- The error class and codes are exported from the package root and documented in the README.

---

## 3. Render lifecycle callbacks (P1)

### Problem

`SDMXDashboard` accepts `{url, config, lang}` and reports nothing back. Consumers needing render state (Surfer's live preview decides when the dashboard is stable; its PDF export must wait for every chart) poll the DOM for engine class names, which couples them to the engine and breaks on a future engine swap.

### Proposal

```ts
type VisualRenderStatus = {
  visualId: string;
  status: "loading" | "rendered" | "empty" | "error";
  error?: SDMXRenderError;            // when status === "error"
  stats?: {                            // when status === "rendered"
    observationCount: number;
    seriesCount: number;
    timePeriodRange?: [string, string];
  };
};

<SDMXDashboard
  config={...}
  lang="en"
  onVisualRender={(s: VisualRenderStatus) => void}   // fires per visual, every state change
  onRenderComplete={(all: VisualRenderStatus[]) => void} // fires once per config when no visual is loading
/>
```

The `stats` block is what makes the callback useful to an agent: "rendered, but 1 series and 2 observations" tells it the chart is technically fine and substantively weak, which is exactly the feedback loop described in `dashboard-architecture.md` (the `onRenderComplete` integration this proposal makes concrete).

The same callbacks belong on the standalone `SDMXChart`, `SDMXValue`, and `SDMXMap` components.

### Acceptance criteria

- `onRenderComplete` fires exactly once per config change, after the last visual settles, including the all-error case.
- A consumer can implement "export when ready" with no DOM inspection.
- Callbacks are optional; existing consumers compile unchanged.

---

## 4. Container resize handling (P2)

### Problem

Charts do not re-measure when their container resizes without a window resize (sidebars opening, preview panes dragging, CSS transitions). Surfer imports the engine directly and calls `chart.reflow()` from a `ResizeObserver` (`lib/use-highcharts-viewport-reflow.ts`), reaching through the library's interface.

### Proposal

Each visual observes its own container with a `ResizeObserver` and re-measures on change, debounced (~150 ms). No new API surface; the behaviour becomes automatic. If automatic observation is undesirable for some embedding, an opt-out prop (`autoResize?: boolean`, default `true`) preserves choice.

### Acceptance criteria

- A chart inside a panel that animates from 0 to full width ends correctly sized with no consumer code.
- Surfer deletes `use-highcharts-viewport-reflow.ts`.

---

## 5. sdmx-json-parser: tolerate both SDMX-JSON 1.0 dialects on read (P1)

Targets `PacificCommunity/sdmx-json-parser`, the parsing dependency.

### Problem

The parser appends `format=jsondata` to every data URL it fetches and sends no SDMx Accept header. On the current .Stat NSI stack that query parameter selects SDMX-JSON v1.0 and takes precedence over any Accept header, which follows SDMx REST precedence rules. Verified on 2026-06-12 against both the SPC endpoint (`stats-sdmx-disseminate.pacificdata.org`) and the SBS endpoint (`data-sdmx-disseminate.sbs.gov.ws`): with `format=jsondata` both return the v1.0 shape (`data.structure`, singular) regardless of Accept; with a clean URL and `Accept: application/vnd.sdmx.data+json;version=2.0.0` both return v2.0 (`data.structures`, array).

The parser's reading code expects the v2.0 shape. The parser therefore requests, on every fetch, a format it cannot parse, and every up-to-date .Stat instance obliges. Data Surfer ships a dist-bundle patch normalising v1.0 responses into the v2.0 shape on read; without it the primary SPC endpoint fails. This was originally diagnosed as an SBS-side misbehaviour; the live verification shows the behaviour is uniform .Stat semantics and the request itself is the bug.

A survey across all twelve providers configured in Data Surfer (2026-06-12, `scripts/survey-sdmx-json-versions.mjs` in the sdmx-surfer repo) widens the blast radius:

| Provider(s) | Response to `format=jsondata` |
|---|---|
| SPC, SBS | SDMX-JSON v1.0, `data.structure` envelope shape |
| ABS, FBOS, ILO, STATSNZ, OECD | SDMX-JSON v2.0 today; the .Stat instances among them are expected to flip to v1.0 as their NSI upgrades to the build SPC and SBS already run |
| ECB | SDMX-JSON v1.0 in the original root-level shape: `structure` and `dataSets` at the document root, no `data` envelope |
| ESTAT, UNICEF, BIS, IMF | XML or errors under this request shape; out of scope for a JSON normaliser |

The ECB row matters: it is a second v1.0 dialect, and a normaliser keyed only on `data.structure` misses it entirely.

The three shapes side by side (sketches; full fixtures in the test suite):

```jsonc
// SDMX-JSON 2.0 — what the reading code expects
{ "data": { "structures": [ { "names": {...}, "dimensions": { "dataSet": [], "series": [], "observation": [...] } } ],
            "dataSets": [ { "observations": {...} } ] } }

// 1.0 envelope dialect (.Stat: SPC, SBS) — singular structure, lowercase
// `dataset` group, groups may be absent
{ "data": { "structure": { "names": {...}, "dimensions": { "dataset": [], "observation": [...] } },
            "dataSets": [ { "observations": {...} } ] } }

// 1.0 root dialect (ECB) — no `data` envelope, `name` without `names`
{ "header": {...},
  "structure": { "name": "...", "dimensions": { "series": [...], "observation": [...] } },
  "dataSets": [ { "series": {...} } ] }
```

Failure signatures on the unpatched 0.3.1 reader: the envelope dialect crashes with `Cannot read properties of undefined (reading '0')` in `getDimensions()` (it reads `data.structures[0]`); the root dialect throws `Name not found` from `getName()` (no `data` at all, and no `names`).

Thirty-second reproduction of the two dialects:

```bash
# .Stat envelope dialect (data.structure, singular):
curl -s 'https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_KEYFACTS,/A.FJ.GOV?dimensionAtObservation=AllDimensions&format=jsondata' \
  | python3 -c 'import json,sys; print(list(json.load(sys.stdin)["data"].keys()))'
# -> ['dataSets', 'structure']   (2.0 would be ['dataSets', 'structures'])

# ECB root dialect (structure and dataSets at the top level):
curl -s 'https://data-api.ecb.europa.eu/service/data/ECB,EXR,1.0/D.USD.EUR.SP00.A?lastNObservations=1&format=jsondata' \
  | python3 -c 'import json,sys; print(list(json.load(sys.stdin).keys()))'
# -> ['header', 'dataSets', 'structure']   (no data envelope)
```

### Considered and rejected: requesting v2.0 via the Accept header

The obvious fix is to stop sending `format=jsondata` and negotiate v2.0 through the Accept header. Live testing (2026-06-12) rules it out: ECB returns XML when offered a standards-correct multi-value Accept list (`v2.0, v1.0;q=0.9, application/json;q=0.8`), 406s the plain v1.0 media type, and only serves JSON for `application/json` or the antique `1.0.0-wd` media type. Accept-based negotiation trades two known response shapes for a per-provider negotiation lottery. Keeping the request exactly as it is and tolerating every observed response shape carries zero regression risk for providers that work today.

### Proposal

All changes on the read side; the request stays as it is:

1. **Normalise both v1.0 dialects after `JSON.parse`,** before any structural access, idempotently (2.0 responses pass through untouched):
   1. Root-level v1.0 (the ECB dialect): wrap into the envelope, `data = { dataSets: root.dataSets, structure: root.structure }`.
   2. `data.structure` (singular object) becomes `data.structures = [structure]`.
   3. Singular-only `name`/`description` gain their localised plural (`names = { en: name }`); the readers (`getName`, `getDescription`) gate on the plural.
   4. `structure.dimensions.dataset` (lowercase `s`) becomes `dimensions.dataSet`.
   5. Missing dimension groups (`dataSet`, `series`, `observation`) default to `[]`.
   6. Missing attribute groups (`dataSet`, `dimensionGroup`, `series`, `observation`) default to `[]`.
2. **Stream series from both locations.** The series-expansion pre-pass reads `$.data.dataSets.*.series.*` only; the root dialect needs `$.dataSets.*.series.*` as well, because the pre-pass runs on the raw response text before normalisation.
3. **Fix the query-separator bug:** appending `&format=jsondata` to a URL with no query string produces an invalid URL; use `?` in that case.

Rules 1.2 and 1.4 through 1.6 are exactly the reshaping Surfer applies today as a dist-bundle patch (`scripts/apply-patches.mjs`, patch 1), in production against the SPC endpoint. Rules 1.1 and 1.3 and change 2 are new, and are what make ECB data parseable at all.

An implementation with tests exists on the Surfer side (local branch `normalise-sdmx-json-v1` against this repo): `normalizeSdmxJson()` as a static method, the package's first test suite (`node --test`, fetch stubbed, fixtures for all three shapes), and the source renamed to `index.mjs` so tests can import it without changing the package's module semantics. Setting `type: "module"` instead was tried and rejected: it makes Node and bundlers read the UMD `dist/parser.js` as ESM, where the wrapper breaks.

### Acceptance criteria

- A captured v1.0 fixture in each dialect parses to the same internal representation as its v2.0 equivalent.
- v2.0 responses pass through the normaliser untouched (idempotence test).
- Live checks through the public API of the built bundle: ECB `EXR` (root dialect) and an SPC .Stat flow (envelope dialect) both yield name, dimensions, and observations. Both verified 2026-06-12.

---

## 6. Interaction callback (P2)

### Problem

Click and hover events on chart elements stay inside the library. Surfer's roadmap has an "explore this" flow where selecting a series or point in a rendered dashboard seeds a new agent conversation scoped to that slice of data; without an interaction callback that flow cannot be built.

### Proposal

```ts
type VisualInteraction = {
  visualId: string;
  kind: "point-click" | "series-click" | "legend-click";
  concepts: Record<string, string>;   // dimension id -> code at the interaction point
  value?: number;
  timePeriod?: string;
};

<SDMXDashboard onUserInteraction={(e: VisualInteraction) => void} ... />
```

The `concepts` map is the payload that matters: it is enough to reconstruct the SDMx query for the clicked slice without any engine knowledge on the consumer side.

### Acceptance criteria

- Clicking a point on a multi-series line chart yields the full dimension coordinate of that observation.
- The callback is optional and adds no behaviour when absent.

---

## 7. Engine neutrality as policy (P3)

### Problem

A charting-engine swap is under consideration (Highcharts carries a commercial licence; the realistic alternatives are permissively licensed). Most of the config schema is already engine-neutral. Three things are not, and each will silently break consumers during a swap unless addressed first:

- **`extraOptions`** is typed `any` and passes raw Highcharts options through. Consumers (including Surfer's agent, which persists dashboards to a database) have engine-dialect JSON stored in long-lived data.
- **The render target (SVG) is undocumented.** Surfer's PDF export converts the chart SVGs to canvas; an engine that renders to `<canvas>` changes that contract invisibly.
- **Internal class names leak** (`.highcharts-container` et al.) and consumers use them because no alternative exists (§3 fixes the legitimate need).

### Proposal

1. Document `extraOptions` as engine-bound and unsupported across major versions. Add semantic config fields for the handful of uses that recur (axis titles first: `yAxisTitle?: SDMXTextConfig`, `xAxisTitle?: SDMXTextConfig`), so common customisation survives an engine swap.
2. State the render target in the README as part of the public contract. If a swap changes it, that is a major-version note, not a surprise.
3. Treat §1, §2, and §3 of this document as the engine-swap enablers they are: once errors, render state, and resize are library API, no consumer has a reason to know which engine is underneath.

### Acceptance criteria

- A consumer using only documented API (no `extraOptions`, no engine class names) runs unmodified against a build with a different charting engine.

---

## 8. API hygiene for the next major version (P3)

Collected small items, each breaking on its own, cheap to batch:

- `SDMXDashboardConfig.rows[].colums` is misspelled in the public type. Accept `columns`, keep `colums` as a deprecated alias for one major version.
- `extraOptions: any` becomes `extraOptions?: Record<string, unknown>` (no behaviour change, restores type checking around it).
- A native `table` visual type. Both SPC consumers needed tabular output for sparse or stratified indicators and built their own (Surfer's snapshot table pivots one stratifier concept against time); a `type: "table"` with `xAxisConcept` as rows and an optional `legend.concept` as columns would cover both.
- Export `SDMXDashboardConfig` and friends from the package root (currently reachable only via deep import paths).

---

## 9. Pluggable data transport (P2)

### Problem

The components fetch their `data` URLs directly with the global `fetch`. Consumers have no way to add authentication (subscription keys for endpoints like Stats NZ), route around CORS restrictions, or apply caching. Surfer's workaround replaces `window.fetch` for the whole page with a wrapper that rewrites SDMx hosts to a server-side proxy (`app/sdmx-proxy-boot.tsx`). It works, and it is the riskiest pattern in the integration: any other script taking the same liberty, or a future library moving off `fetch`, breaks it silently.

### Proposal

```ts
type SDMXFetcher = (url: string, init?: RequestInit) => Promise<Response>;

<SDMXDashboard fetcher={mySDMXFetcher} ... />
```

Every data and structure request inside the library goes through the provided `fetcher`, defaulting to the global `fetch` when absent. The same prop belongs on the standalone components.

### Acceptance criteria

- With a `fetcher` that rewrites hosts, no request from the library reaches the network on the original host.
- Surfer deletes the `window.fetch` wrapper and passes its proxy logic as a `fetcher`.

---

## 10. Request dedup and retry (P2)

### Problem

SDMx endpoint instability is the dominant operational pain in the region. The library amplifies it in two ways: visuals on the same page fetch identical or overlapping URLs with no sharing (a comparison dashboard with ten indicators can issue dozens of requests where a handful would do), and a single transient 5xx fails the visual outright with no second attempt.

### Proposal

- Deduplicate identical in-flight URLs across all visuals of a dashboard: one network request, fan the response out.
- Cache responses for the lifetime of the rendered config (a config change invalidates).
- Retry once with short backoff on network errors and 5xx responses; 4xx fails immediately.

All three behaviours sit naturally inside the transport layer of §9, behind the `fetcher` seam.

### Acceptance criteria

- Two visuals with the same `data` URL produce one network request.
- A request that fails once with a 503 and succeeds on retry renders normally, with the retry visible in the §13 telemetry.

---

## 11. Accessibility (P2)

### Problem

Anything launched under SPC branding must meet WCAG 2.1 AA, and Pacific users include people on assistive technology. The charts currently expose no accessible alternative to the rendered SVG: no programmatic description, no data-table fallback, no documented keyboard behaviour. Retrofitting after a failed audit costs more than specifying now.

### Proposal

- Enable the charting engine's accessibility module (Highcharts ships one) or its equivalent after an engine swap.
- Render a visually hidden data table per chart (`<table>` with the same observations), so screen readers get the data even where the chart vocabulary falls short.
- Document keyboard behaviour (focus, series navigation) in the README as part of the public contract.
- Title and unit config fields flow into `aria-label`s.

### Acceptance criteria

- An axe scan of a rendered dashboard reports no critical or serious violations attributable to the library.
- A screen reader can read every observation of a line chart via the fallback table.

---

## 12. SSR-safe module loading (P2)

### Problem

The library touches browser globals at import time, so any server-rendered framework must wrap every component in a client-only dynamic import. Surfer carries two such wrapper layers (`components/sdmx-dashboard-dynamic.tsx` and the snapshots module's `snapshot-chart.tsx`), and every future consumer on Next.js or similar will rebuild the same boilerplate.

### Proposal

Make module scope side-effect-free: no `window`, `document`, or engine access until first render (inside `useEffect` or lazy initialisation). Components render a placeholder on the server and hydrate into charts on the client.

### Acceptance criteria

- `import { SDMXDashboard } from "sdmx-dashboard-components"` succeeds in a Node.js process with no DOM.
- A Next.js page using the component directly, with no `dynamic()` wrapper, server-renders and hydrates without errors.

---

## 13. Fetch telemetry callback (P3)

### Problem

Consumers operating a service want to know how the SDMx endpoints behave under real traffic: which hosts are slow, which fail, how often retries save a render. Today that information dies inside the library. Surfer's production plan includes a per-endpoint SDMx health surface that would otherwise need synthetic probing.

### Proposal

```ts
type FetchTelemetry = {
  url: string;
  host: string;
  status: number | "network-error";
  durationMs: number;
  fromCache: boolean;
  retried: boolean;
};

<SDMXDashboard onDataFetch={(t: FetchTelemetry) => void} ... />
```

Fires once per settled request, including deduplicated cache hits (`fromCache: true`).

### Acceptance criteria

- Every network interaction of a dashboard render is observable through the callback, with no double counting of deduplicated requests.

---

## 14. Custom loading, empty, and error slots (P3)

### Problem

The built-in loading and failure states cannot be styled or replaced. Both SPC consumers built branded fallback cards by wrapping every visual in their own error boundary and detecting states from the outside. With the §2 error contract and §3 lifecycle in place, the remaining gap is presentational.

### Proposal

```ts
<SDMXDashboard
  renderLoading={(visualId: string) => ReactNode}
  renderEmpty={(visualId: string) => ReactNode}
  renderError={(e: SDMXRenderError) => ReactNode}
  ...
/>
```

Defaults reproduce current behaviour; provided slots replace it per state.

### Acceptance criteria

- A consumer can ship fully branded loading, empty, and error cards without wrapping the components.

---

## 15. Global theming contract (P3)

### Problem

Styling happens per visual (`colorPalette`) or through CSS overrides targeting internal class names; Surfer maintains a palette as CSS variables in `app/globals.css` and depends on engine class names to apply it. Institutional branding (the SPC and Pacific Data Hub visual alignment required for public launch) currently means repeating configuration on every visual or overriding internals that may change.

### Proposal

```ts
type SDMXTheme = {
  palette?: string[];                 // series colours in order
  fontFamily?: { display?: string; data?: string };
  numberFormat?: { locale?: string; decimalSeparator?: string };
};

<SDMXDashboard theme={spcTheme} ... />
```

Per-visual `colorPalette` keeps precedence over the theme. The theme is the engine-neutral styling surface; internal class names stop being a styling API.

### Acceptance criteria

- One theme object applied at the dashboard level restyles every visual with no per-visual config and no CSS targeting internal class names.

---

## What Data Surfer commits to once items land

For each landed item, Surfer deletes the corresponding workaround within one release cycle: both entries in `scripts/apply-patches.mjs` (and eventually the patch infrastructure), the two global error handlers, the DOM-polling render detection, the reflow hook, the `window.fetch` proxy wrapper, the `dynamic(ssr: false)` wrapper components, and the CSS overrides targeting engine class names. Surfer also offers fixtures from production use: the SBS v1.0 response captures, the golden configs that exercise every chart type, and the catalogue of error situations its agent has hit.

PRs for §1, §5, and §9 can come from the Surfer side with tests included; the patches and the proxy wrapper are the spec. §3, §6, §10, and §12 touch component architecture and are better designed by the maintainers, with Surfer as the first integration tester. §11 (accessibility) is worth scheduling against SPC's launch-gate audit so the work happens once.
