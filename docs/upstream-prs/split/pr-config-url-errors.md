On rc.1, a dashboard given a `url` whose config fails to load logs the error with `console.log` and shows "Loading..." forever, so a wrong URL looks like a slow one. This PR turns the failure into a typed `SDMXRenderError` without `visualId`, shown in place of the dashboard (through `renderError` when given, else the default alert panel) and logged with `console.error`.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/transport}} (the same config-URL effect, now going through `fetcher`) and {{PR:pr/slots}} (`renderError`, merged into this branch as d6b44e0). Through them, it also depends on {{PR:pr/error-contract}}, {{PR:pr/no-accept-header}} and {{PR:pr/test-setup}}. Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/transport...pr/config-url-errors. It also shows 5bec28e (slots) and the merge.

Own commit to review: fb73948 Report a dashboard config that fails to load

## Changes

- `lib/components/dashboard.tsx`: the config-URL effect classifies failures:
  - a non-2xx response gives `ERR_FETCH`, naming the URL and the HTTP status;
  - a body that is not JSON gives `ERR_PARSE`;
  - a network failure gives `ERR_FETCH`.

  `detail` is `{ url, status? }`. A new `url` clears the error.
- `README.md`: a paragraph in the error-contract section.

## Behaviour changes vs rc.1

| Config `url` | rc.1 | This PR |
|---|---|---|
| 404/500 | `response.json()` runs whatever the status; a failure is logged and "Loading..." stays | `ERR_FETCH` panel (or `renderError`) |
| Not JSON | logged; "Loading..." stays | `ERR_PARSE` panel |
| Network failure | logged; "Loading..." stays | `ERR_FETCH` panel |

## Tests

`npm test`: 14 files, **88 passed** (base {{PR:pr/transport}}: 75; 8 come with {{PR:pr/slots}}). `lib/components/dashboard.fetcher.test.tsx` (+5, jsdom):

- non-2xx as `ERR_FETCH` naming the URL and the status;
- non-JSON as `ERR_PARSE`;
- network failure as `ERR_FETCH`;
- the `renderError` slot;
- a new URL clears the error and loads.

## Notes

- **Adapted.** {{PR:pr/axis-titles}} (with `normalizeConfig`) is not in this branch, and `SDMXDashboardConfig` there still spells the field `colums`. A loaded config therefore gets the existing `colCount`/`colSize` defaults inline, with its rows read through a local cast. The resolution on `surfer-integration` calls `normalizeConfig` instead.
- `onRenderComplete` is not fired for a config that fails to load; only the error is reported.
- Conflicts textually with {{PR:pr/interaction}}, {{PR:pr/theme-a11y}} and {{PR:pr/map-fixes}}, beyond those inherited from {{PR:pr/transport}}. The resolutions are in `surfer-integration`.
