Component tests need a DOM, a canvas 2D context for ECharts, and a `ResizeObserver`; rc.1's vitest setup runs in node only. This PR adds a jsdom setup that test files opt into with `// @vitest-environment jsdom`. Existing node-environment suites are unaffected. There is no change to the library or the build output. Most of the other PRs in this series depend on it for their component tests.

Part of {{TRACKING_ISSUE}}.

**Depends on:** nothing.

Commit: 89f1853 Add a jsdom test setup for component tests

## Changes

- `package.json`: adds the devDependencies `@testing-library/react ^16.3.3`, `jsdom ^29.1.1` and `vitest-canvas-mock ^1.2.0`. No runtime dependency changes. `package-lock.json` is updated.
- `vitest.config.ts`: adds `setupFiles: ['lib/test/setup.ts']`.
- `lib/test/setup.ts`: in jsdom only (`typeof window !== 'undefined'`), it dynamically imports `vitest-canvas-mock` and installs a no-op `ResizeObserver` stub if none exists. Node suites also load the file, and it does nothing there.
- `lib/test/setup.test.tsx`: a smoke test.

## Behaviour changes vs rc.1

None for library consumers.

## Tests

`npm test`: 3 files, **10 passed** (rc.1: 2 files, 8). The 2 new tests check that ECharts can `init` and draw onto a canvas in jsdom, and that `window.ResizeObserver` exists.

## Notes

- The import is dynamic because the canvas mock patches `HTMLCanvasElement`, which does not exist in the node environment.
- If merged alone: test tooling only.
- This PR is the base of {{PR:pr/date-axes}}, {{PR:pr/chart-layout}} and {{PR:pr/error-contract}} (and, through these, of most of the series).
