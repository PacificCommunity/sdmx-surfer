# Vendored dependency tarballs (temporary)

These are locally built `npm pack` tarballs of the **improved** SDMX libraries,
vendored so the preview/dev deployment can exercise them before the upstream
PRs land. They replace the registry versions in `package.json`
(`"sdmx-json-parser": "file:vendor/..."`, same for `sdmx-dashboard-components`).

| Tarball | Source repo | Branch @ sha | Replaces registry |
|---|---|---|---|
| `sdmx-json-parser-0.3.1.tgz` | PacificCommunity/sdmx-json-parser | `extend-json-dialects` @ 5cf95ea | `^0.3.1` |
| `sdmx-dashboard-components-0.4.6.tgz` | PacificCommunity/sdmx-dashboard-components | `stable-config-effect-key` @ c1702b6 | `^0.4.6` |

Both improved builds carry, **natively**, the fixes that
`scripts/apply-patches.mjs` used to inject as binary patches. That script now
detects the native markers (`normalizeSdmxJson`, `ERR_AMBIGUOUS`) and skips the
patches automatically, so nothing is double-applied.

## How to revert to the published registry versions

1. In `package.json`, set both deps back to their registry ranges
   (`"sdmx-json-parser": "^0.3.1"`, `"sdmx-dashboard-components": "^0.4.6"`).
2. `rm -rf vendor && npm install`.

The patch script falls back to the binary patches automatically once the
registry versions (which lack the native markers) are installed again.

## When the upstream PRs are published

Replace the `file:` deps with the published versions and delete this directory.
