# Vendored dependency tarballs (temporary)

These are locally built `npm pack` tarballs of the **improved** SDMX libraries,
vendored so the preview/dev deployment can exercise them before the upstream
PRs land. They replace the registry versions in `package.json`
(`"sdmx-json-parser": "file:vendor/..."`, same for `sdmx-dashboard-components`).

| Tarball | Source repo | Branch @ sha | Replaces registry |
|---|---|---|---|
| `sdmx-json-parser-0.3.2.tgz` | PacificCommunity/sdmx-json-parser | `extend-json-dialects` @ 48cc79f | `^0.3.1` |
| `sdmx-dashboard-components-0.4.7.tgz` | PacificCommunity/sdmx-dashboard-components | `stable-config-effect-key` @ 5f8c1d1 | `^0.4.6` |

> **Versions are bumped on purpose (0.3.2 / 0.4.7), not just the source SHAs.**
> npm serves `file:` tarballs from its content-addressable cache keyed by the
> lockfile integrity, so a rebuilt tarball under an UNCHANGED version
> (`0.3.1`/`0.4.6`) is silently replaced by the cached pre-fix copy on the next
> `npm install`. Always bump the version when repacking a fix, or the install
> reverts it. (This is why BIS kept regressing: cache fix `5f8c1d1` + value
> coercion `48cc79f` were repacked under the old version and lost on reinstall.)

Both improved builds carry, **natively**, the fixes that
`scripts/apply-patches.mjs` used to inject as binary patches. That script now
detects the native markers (`normalizeSdmxJson`, `ERR_AMBIGUOUS`) and skips the
patches automatically, so nothing is double-applied.

## How to revert to the published registry versions

1. In `package.json`, set both deps back to their registry ranges
   (`"sdmx-json-parser": "^0.3.1"`, `"sdmx-dashboard-components": "^0.4.6"`).
2. `rm -rf vendor && npm install`.

> When repacking a NEW fix into these tarballs, bump the version in the source
> repo's `package.json` first (e.g. `0.3.2 → 0.3.3`) and update the filename
> here and in the app's `package.json`. Repacking under the same version will be
> ignored by npm's cache.

The patch script falls back to the binary patches automatically once the
registry versions (which lack the native markers) are installed again.

## When the upstream PRs are published

Replace the `file:` deps with the published versions and delete this directory.
