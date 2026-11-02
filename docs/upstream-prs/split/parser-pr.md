With 0.4.0, a request without a caller `Accept` cannot get usable SDMX-JSON from every public provider:

- ECB and IMF answer in a root-level dialect that `getStructure()` does not read, and IMF returns XML unless asked for `application/json`;
- UNICEF and BIS serve JSON only for the v1.0 media type;
- BIS sends observation values as strings.

This PR adds the following, each with tests:

- `getDatasets` negotiates the request in up to three attempts;
- the root dialect is normalised to the enveloped shape, and a missing `keyPosition` is synthesised;
- numeric-string `OBS_VALUE`s are coerced to numbers;
- a `fetcher` option;
- a typed `NO_RECORDS` error for a .Stat `NoRecordsFound` 404;
- a `prepare` build so git installs ship `dist/`;
- the package's first test suite, with one captured response per provider.

This is the companion of the `sdmx-dashboard-components` series tracked in {{TRACKING_ISSUE}}, which relies on `fetcher` and `NO_RECORDS`, and stops sending its own `Accept` header so that this negotiation can run.

Branch `gvdr/sdmx-json-parser:dialects-0.4` (077b6ad), based on `master` 18fdcc8 (the `gitHead` of the published npm 0.4.0). 5 commits, 16 files, +425/−12.

## Commits

| SHA | Subject | Files | Tests added (as run) |
|---|---|---|---|
| 5cf95ea | Extend dialect coverage, add fetcher seam and request negotiation | 4 (README, index.js, package.json, test/parser.test.cjs) | 11 (3 of them one end-to-end test per dialect) |
| 48cc79f | Coerce numeric string OBS_VALUE to a number in getData | 2 | 1 |
| 08fbfc3 | Bump to 0.4.1 and build dist on prepare | 2 (package.json, lock) | 0 |
| b2aad46 | Add live provider fixtures and offline parse tests | 11 (10 fixtures + test file) | 11 (one per fixture, plus one BIS coercion case) |
| 077b6ad | Report 404 NoRecordsFound as NO_RECORDS error and stop negotiation | 2 | 2 |

**Version.** 08fbfc3 sets the version to 0.4.1, adds `"prepare": "npm run build"`, and changes `files` to `dist/parser.js`. If you prefer to version on your own schedule, drop the `version` line, or the whole commit if you do not want the `prepare` script either. Note that `master`'s `package.json` says **0.3.1**, although npm has **0.4.0** published from 18fdcc8.

## Behaviour changes vs 0.4.0

| Area | 0.4.0 (18fdcc8) | This PR |
|---|---|---|
| `format=jsondata` separator | always appended with `&`, which malforms a URL without a query string | `?` without a query string, `&` otherwise; unchanged for `.json` URLs or when already present |
| Request negotiation | one request, `fetch(api, options)`; with no caller `Accept`, the runtime default (`*/*` in browsers) | up to three requests, stopping at the first HTTP 200 with a JSON content type: (1) `Accept: application/vnd.sdmx.data+json;version=1.0.0`, (2) no `Accept`, (3) `Accept: application/json`. If none matches, the last response is used and the existing non-200 error applies |
| Caller-supplied `Accept` | sent as given | still sent as given, as a single request with no negotiation |
| Root dialect (ECB, IMF) | `getStructure()` throws "Structure not found"; series at `$.dataSets` are not expanded | `normalizeShape` wraps them in a `data` envelope; series are streamed from both `$.data.dataSets.*.series.*` and `$.dataSets.*.series.*` |
| `keyPosition` | required; without it `getData` attaches no dimensions | synthesised from dimension order when absent; existing values untouched |
| .Stat 1.0 (`data.structure`) / 2.0 (`data.structures[]`) | already read (PR #11) | unchanged, now covered by fixtures |
| Numeric `OBS_VALUE` | returned as delivered (`"2.41"`) | a non-empty string that parses as a finite number becomes a number; numbers, `null`, `""` and non-numeric markers unchanged |
| `fetcher` option | passed into `fetch`'s init and ignored | `options.fetcher(url, init)` is used for every request; the other keys form the init |
| 404 with "no records" | generic `Error("Error: Error while fetching data …")` | when the body matches `/NoRecordsFound\|no records found\|no results/i`: `Error("No records found for <url>")` with `code: "NO_RECORDS"`, not re-wrapped, and negotiation stops; other 404s unchanged |
| Errors in general | re-wrapped as `new Error(err)` | unchanged, except `NO_RECORDS` |
| Packaging | `files: ["./dist/parser.js"]`; `dist/` not committed, so git installs had no build | `files: ["dist/parser.js"]`, `prepare` builds |
| `test` script | `echo "Error: no test specified" && exit 1` | `webpack && node --test` |

**Points for review**

- **Extra requests.** A provider that rejects or ignores the first attempt costs extra requests; IMF takes three. Callers that know their provider can pass an `Accept` header to skip negotiation.
- **Commit message vs fixtures.** The 5cf95ea message says most providers "406 the v1.0 media type". The fixtures, captured through this negotiation, show SPC, SBS and OECD answering with a v1.0 content type, and FBOS, ILO and ABS with v2.0. Which attempt produced each response was not recorded.
- **Broad match.** `/no results/i` on a 404 body is broad: any 404 page containing that phrase becomes `NO_RECORDS`.

## Compatibility

- **Callers that pass their own `Accept`** (for example `sdmx-dashboard-components` 1.0.0-rc.1, which sends `…version=2.0.0`): unchanged single request. They get the shape normalisation and coercion, but no negotiation.
- **Callers without an `Accept`:** the first request now sends the v1.0 `Accept`, where 0.4.0 left it to the runtime default. A provider that served SDMX-JSON 2.0 to `*/*` may now return 1.0. Both shapes are read.
- **Value types.** `getData` returns numbers for numeric strings.
- **Error matching.** Callers matching the message `Error while fetching data` no longer see it for "no records" 404s. They should check `err.code === "NO_RECORDS"`.

## Tests

| | Result |
|---|---|
| `master` 18fdcc8 (0.4.0) | no tests: `npm test` prints "Error: no test specified" and exits 1 |
| `dialects-0.4` 077b6ad | `npm test` (webpack + `node --test`): **25 tests, 25 pass, 0 fail** |

The unit tests (`test/parser.test.cjs`, 14 tests) cover:

- `normalizeShape`: root wrap, `keyPosition` synthesis, idempotence;
- every negotiation path: v1.0 succeeds, the ECB 406 fall-back, and the IMF 200-but-XML fall-through;
- the caller `Accept` opt-out;
- the query separator;
- coercion;
- `NO_RECORDS` and the generic 404.

<details><summary>Provider fixtures (one real response each, captured 2 Nov 2026 through this negotiation, served offline through a mock <code>fetcher</code>)</summary>

| Provider | Query | Content type served | Shape | Notes |
|---|---|---|---|---|
| SPC (.Stat) | `DF_POP_PROJ/A.FJ.MIDYEARPOPEST._T._T` | SDMX-JSON 1.0 | `data.structure` | |
| SBS Samoa (.Stat) | `SBS,DF_CPI_TABLE1/all` | SDMX-JSON 1.0 | `data.structure` | |
| FBOS Fiji (.Stat) | `FBOS,DF_CPI_TABLE1/all` | SDMX-JSON 2.0 | `data.structures[]` | |
| OECD | `DSD_LFS@DF_IALFS_UNE_M` | SDMX-JSON 1.0 | `data.structure` | |
| ILO | `DF_UNE_DEAP_SEX_AGE_RT` | SDMX-JSON 2 | `data.structures[]` | |
| ABS | `CPI 2.0.0` | SDMX-JSON 2 | `data.structures[]` | |
| UNICEF | `CME` | `application/json` | `data.structure` | numeric-string values |
| BIS | `WS_CBPOL` | `application/json` | `data.structure` | numeric-string values; extra test asserts coercion |
| ECB | `EXR/M.USD.EUR.SP00.A` | SDMX-JSON 1.0.0-wd | root dialect, no `keyPosition` | exercises normalisation and synthesis |
| IMF | `IMF.STA,CPI` | `application/json` | root dialect (`keyPosition` present) | numeric-string values |

All queries use `lastNObservations=3`; the full URLs are in the b2aad46 commit message. Each test asserts non-empty data, dimensions found, and numeric values (`null` only for missing observations).
</details>

Downstream, SDMX Surfer renders a panel from each of these 10 providers (and StatsNZ through its proxy) with this parser and the components series.

## How to try it

```sh
npm install github:gvdr/sdmx-json-parser#dialects-0.4   # prepare builds dist/
```

```js
import { SDMXParser } from "sdmx-json-parser";
const p = new SDMXParser();
await p.getDatasets("https://data-api.ecb.europa.eu/service/data/EXR/M.USD.EUR.SP00.A?lastNObservations=3",
  { headers: { "Accept-Language": "en" }, fetcher: (url, init) => fetch(url, init) });
console.log(p.getData().slice(0, 2));
```
