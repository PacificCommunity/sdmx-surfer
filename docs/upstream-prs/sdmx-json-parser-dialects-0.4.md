# Dialect normalisation, request negotiation, `fetcher` option and provider fixtures (0.4.1)

Branch `gvdr/sdmx-json-parser:dialects-0.4` (077b6ad), based on `master` 18fdcc8, which is the `gitHead` of the published npm `0.4.0`. 5 commits, 16 files, +425/−12.

## Summary

With 0.4.0, a request without a caller `Accept` cannot get usable SDMX-JSON from every public provider:

- ECB and IMF answer in a root-level dialect that `getStructure()` does not read, and IMF returns XML unless asked for `application/json`;
- UNICEF and BIS serve JSON only for the v1.0 media type;
- BIS sends observation values as strings.

This PR adds the following, each with tests:

- `getDatasets` tries up to three request mechanisms;
- the root dialect is normalised to the enveloped shape, and a missing `keyPosition` is synthesised;
- numeric-string `OBS_VALUE`s are coerced to numbers;
- a non-standard `fetcher` option;
- a typed `NO_RECORDS` error for a .Stat `NoRecordsFound` 404;
- a `prepare` build so git installs ship `dist/`;
- the package's first test suite, including one captured response per provider.

The companion PR to `sdmx-dashboard-components` (branch `surfer-parity`) relies on `fetcher` and `NO_RECORDS`. That PR stops sending its own `Accept` header so this negotiation can run.

## Commits

| SHA | Subject | Files | Tests added |
|---|---|---|---|
| 5cf95ea | Extend dialect coverage, add fetcher seam and request negotiation | 4 (README, index.js, package.json, test/parser.test.cjs) | 9 |
| 48cc79f | Coerce numeric string OBS_VALUE to a number in getData | 2 | 1 |
| 08fbfc3 | Bump to 0.4.1 and build dist on prepare | 2 (package.json, lock) | 0 |
| b2aad46 | Add live provider fixtures and offline parse tests | 11 (10 fixtures + test file) | 2 (the provider test runs once per fixture: 10 cases + 1 BIS case) |
| 077b6ad | Report 404 NoRecordsFound as NO_RECORDS error and stop negotiation | 2 | 2 |

The 0.4.1 version bump (08fbfc3) can be dropped if you prefer to version on your own schedule. Note that `master`'s `package.json` says **0.3.1**, although npm has **0.4.0** published from 18fdcc8. The bump goes 0.3.1 → 0.4.1 in the file.

## Behaviour changes vs 0.4.0

| Area | 0.4.0 (18fdcc8) | This PR |
|---|---|---|
| **`format=jsondata` separator** | Always appended with `&`, which malforms a URL that has no query string | `?` when the URL has no query string, `&` otherwise; unchanged for `.json` URLs or URLs that already contain `format=jsondata` |
| **Request negotiation** | One request, `fetch(api, options)`. With no caller `Accept`, the runtime default (`*/*` in browsers) is sent | Up to three requests, stopping at the first HTTP 200 with a JSON content type: (1) `Accept: application/vnd.sdmx.data+json;version=1.0.0`, (2) no `Accept` set by the parser, (3) `Accept: application/json`. If none matches, the last response is used and the existing non-200 error applies |
| **Caller-supplied `Accept`** | Sent as given | Still sent as given, as a single request with no negotiation |
| **Root dialect** (ECB, IMF) | `structure`/`dataSets` at the document root: `getStructure()` throws "Structure not found", and series at `$.dataSets` are not expanded | `normalizeShape` moves them into a `data` envelope. Series are streamed from both `$.data.dataSets.*.series.*` and `$.dataSets.*.series.*` |
| **`keyPosition`** | Required in the response; without it `getData` attaches no dimensions | When it is absent, it is synthesised from dimension order (series, then observation). Existing values are untouched |
| **.Stat 1.0 envelope** (`data.structure`) and **2.0** (`data.structures[]`) | Already read by `getStructure()` (PR #11) | Unchanged: `normalizeShape` passes them through. They are now covered by fixtures |
| **Numeric `OBS_VALUE`** | Returned as delivered (`"2.41"` stays a string) | A non-empty string that parses as a finite number becomes a number. Numbers, `null`, `""` and non-numeric markers are unchanged |
| **`fetcher` option** | Any extra key is passed into `fetch`'s init, where `fetcher` is ignored | `options.fetcher(url, init)` is used for every request; the other keys form the init |
| **404 with "no records"** | Generic `Error("Error: Error while fetching data …")` | When the 404 body matches `/NoRecordsFound|no records found|no results/i`: `Error("No records found for <url>")` with `code: "NO_RECORDS"`, thrown without re-wrapping, and negotiation stops. Other 404s keep the generic error |
| **Errors in general** | Re-wrapped as `new Error(err)` | Unchanged, except `NO_RECORDS` |
| **Packaging** | `files: ["./dist/parser.js"]`. `dist/` is not committed, so git installs had no build | `files: ["dist/parser.js"]` and `"prepare": "npm run build"` (webpack on git install, pack and publish) |
| **`test` script** | `echo "Error: no test specified" && exit 1` | `webpack && node --test` |

**Points for review**

- **Extra requests.** A provider that rejects or ignores the first mechanism costs extra requests. In the worst case (IMF) a response takes three requests. Consumers that know their provider can pass an `Accept` header to skip negotiation.
- **Commit message vs fixtures.** The 5cf95ea commit message says most providers "406 the v1.0 media type". The fixtures, captured through this negotiation, show SPC, SBS and OECD answering with a v1.0 content type, and FBOS, ILO and ABS with v2.0. Which of the three attempts produced each response was not recorded.
- **Broad match.** `/no results/i` on a 404 body is broad; any 404 page containing that phrase becomes `NO_RECORDS`.

## Provider fixture tests

One real data response per provider, captured on 2 Nov 2026 through the parser's own negotiation (`Accept-Language: en`, no caller `Accept`). Each test serves the fixture through a mock `fetcher`, then asserts non-empty data, dimensions found, and numeric values (`null` only for missing observations). Shape and value columns were read from the fixture files.

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
| ECB | `EXR/M.USD.EUR.SP00.A` | SDMX-JSON 1.0.0-wd | root dialect, no `keyPosition` | exercises normalisation and `keyPosition` synthesis |
| IMF | `IMF.STA,CPI` | `application/json` | root dialect (`keyPosition` present) | numeric-string values |

All queries use `lastNObservations=3`. Full URLs are in the b2aad46 commit message.

The parser unit tests (`test/parser.test.cjs`, the remaining 14 of the 25 tests) cover:

- `normalizeShape`: root wrap, `keyPosition` synthesis, idempotence;
- each negotiation path: v1.0 succeeds; the ECB 406 fall-back; the IMF 200-but-XML fall-through;
- caller `Accept` opt-out;
- the query separator;
- coercion;
- `NO_RECORDS` and the generic 404.

## Compatibility

- **Callers that pass their own `Accept`** (for example `sdmx-dashboard-components` 1.0.0-rc.1, which sends `…version=2.0.0`): unchanged single request. They get the new shape normalisation and coercion, but not negotiation.
- **Callers that pass no `Accept`:** request headers change. The parser now sends `Accept: …version=1.0.0` first, where 0.4.0 left `Accept` to the runtime default. A provider that served SDMX-JSON 2.0 to `*/*` may now return 1.0. Both shapes are read.
- **`getData` value types:** numeric strings become numbers. A caller that relied on string values would see a change.
- **Error handling:** callers matching on the message `Error while fetching data` no longer see it for "no records" 404s. They should check `err.code === "NO_RECORDS"`.

## Testing

| | Tests |
|---|---|
| `master` 18fdcc8 (0.4.0) | none: `npm test` prints "Error: no test specified" and exits 1 |
| `dialects-0.4` 077b6ad | `npm test` (webpack + `node --test`): **25 tests, 25 pass, 0 fail** |

Downstream, SDMX Surfer renders a panel from each of these 10 providers (and StatsNZ through its proxy) with this parser and the companion components PR.

## How to try it

```sh
npm install https://github.com/gvdr/sdmx-json-parser/releases/download/v0.4.1-surfer/sdmx-json-parser-0.4.1.tgz
# or install from git (the prepare script builds dist/): npm install github:gvdr/sdmx-json-parser#dialects-0.4
```

```js
import { SDMXParser } from "sdmx-json-parser";
const p = new SDMXParser();
await p.getDatasets("https://data-api.ecb.europa.eu/service/data/EXR/M.USD.EUR.SP00.A?lastNObservations=3",
  { headers: { "Accept-Language": "en" }, fetcher: (url, init) => fetch(url, init) });
console.log(p.getData().slice(0, 2));
```
