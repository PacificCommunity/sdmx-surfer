Every data request (chart, table, value, map, and the operands of data expressions) sends `Accept: application/vnd.sdmx.data+json;version=2.0.0`. ECB and BIS answer 406 to it, and IMF answers 500. This PR sends only `Accept-Language`, from one helper, and leaves `Accept` to `sdmx-json-parser`. The parser already appends `format=jsondata`, and from 0.4.1 it negotiates the dialect ({{PARSER_PR}}).

Part of {{TRACKING_ISSUE}}.

**Depends on:** nothing.

Commit: f300915 Stop sending the SDMX-JSON 2.0 Accept header (port of fork commit b6d88bf)

## Changes

- `lib/utils/requestHeaders.ts` (new): `dataRequestHeaders(language: string): Headers`, which sets `Accept-Language` only.
- The four call sites use it: `chart/options.ts` (`loadDatasets`, also used by the table), `map/index.tsx`, `value/index.tsx` and `utils/parseDataExpr.tsx` (`fetchDataExprOperand`).

## Behaviour changes vs rc.1

| | rc.1 | This PR |
|---|---|---|
| Request headers | `Accept: …version=2.0.0` + `Accept-Language` | `Accept-Language` only |
| With parser **0.4.0** (the version in the lockfile) | — | 0.4.0 calls `fetch(api, options)` and sets no `Accept` of its own. The request therefore carries the runtime default (`*/*` in browsers) plus `format=jsondata`, and the provider chooses the dialect. Providers that honour `format=jsondata` work. .Stat providers that returned SDMX-JSON 2.0 under rc.1's header may now return their default JSON dialect. [INFERENCE from the parser 0.4.1 commit] ECB then returns a root-level dialect and IMF returns XML, and 0.4.0 parses neither |
| With parser **0.4.1** | — | The parser tries the v1.0 `Accept`, then no `Accept`, then `application/json`, and reads the root dialect |

## Tests

`npm test`: 3 files, **11 passed** (rc.1: 8). `lib/utils/requestHeaders.test.ts` (3 tests, with a mocked parser):

- the helper sets `Accept-Language` and no `Accept`;
- chart and table loads send no `Accept`;
- expression operands send no `Accept`.

## Notes

- ECB, IMF and BIS work end to end only with the parser PR ({{PARSER_PR}}). This PR alone removes the header that makes them fail.
- **Interaction with {{PR:pr/error-contract}}.** That PR (and every PR built on it) keeps rc.1's inline headers, because it rewrites the same four request pipelines. The two conflict textually in `chart/options.ts`, `map/index.tsx` and `value/index.tsx`. {{PR:pr/transport}} already contains this PR, merged into the error-contract pipeline (merge 31c9480), so it resolves the conflict.
- Also conflicts with {{PR:pr/eslint-config}} in `parseDataExpr.tsx` (lint-only hunk).
- Independent leaf.
