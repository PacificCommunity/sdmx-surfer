This PR fixes four problems in `SDMXMap` and adds a basemap option and an image export:

- **Colour scale.** rc.1 scales colours by `(v − min) / max`, which leaves most of the scheme unused when `min ≫ 0`.
- **Zero values.** `if (featureValue)` leaves areas with value 0 transparent.
- **Join.** Features whose observation only matches by label stay empty.
- **Export.** The tile layer taints the canvas, so the map cannot be exported.

Part of {{TRACKING_ISSUE}}.

**Depends on:** {{PR:pr/error-contract}} (the map pipeline is rewritten there into a single promise chain with typed errors). Incremental diff: https://github.com/gvdr/sdmx-dashboard-components/compare/pr/error-contract...pr/map-fixes

Own commit to review: 6ae5696 Fix the map colour scale, zero values, join, and export

## Changes

```ts
// SDMXMapConfig += basemap?: "satellite" | "none" | (string & {})   // XYZ template, {z}/{x}/{y}
export type SDMXMapInstance = OLMap & { toImage: () => Promise<string> } // exported; PNG data URL
// SDMXMap callback: (map: SDMXMapInstance) => void   (rc.1: OpenLayers Map, a supertype)
```

- `lib/utils/basemap.ts` (new):
  - `createBasemapLayer(basemap)`: `"satellite"` (default, ArcGIS World Imagery), `"none"`, or an XYZ template, always with `crossOrigin: "anonymous"`;
  - `mapToImage(map)`: composes the layer canvases after `rendercomplete`. The HTML legend and tooltip are not drawn.
- `lib/utils/mapData.ts` (new):
  - `normaliseMapValue(v, min, max)` returns `(v − min) / (max − min)`, and 1 when all values are equal;
  - `isMapValue` (0 counts as a value);
  - `buildGeoLookup` (by code and by label, with min/max);
  - `findGeoRow` (by code, then an ISO alpha-3 key as alpha-2, then by label).
- `lib/components/map/index.tsx` uses them. The tooltip keeps its observation after the first draw.
- `README.md`: a "Maps" section.

## Behaviour changes vs rc.1

| | rc.1 | This PR |
|---|---|---|
| Colour position | `(v − min) / max` | `(v − min) / (max − min)`; equal values at the top of the scale |
| Value 0 | transparent | filled; only missing values are transparent; the legend shows when any value joined |
| Join | ISO3 → ISO2 lookup on the GeoJSON id | code, then alpha-3 → alpha-2, then label |
| Tiles | XYZ without `crossOrigin` | `crossOrigin: "anonymous"`; a tile server without CORS headers will not show its tiles |
| Basemap | fixed | `basemap` config |

## Tests

`npm test`: 9 files, **64 passed** (base {{PR:pr/error-contract}}: 48).

- `lib/utils/mapData.test.ts` (12): scale formula, negative ranges and clamping, equal values, zero as a value, lookup by code/label with range, alpha-3 → alpha-2, label fallback, code preferred over label, missing keys.
- `lib/utils/basemap.test.ts` (4): satellite default with CORS, custom template with CORS, `"none"`, and canvas composition after `rendercomplete`.

## Notes

- **Downstream use.** SDMX Surfer's PDF/HTML export reads the OpenLayers canvases directly (made readable by the CORS tiles). It does not use `toImage()`.
- **Known gap.** Offline, the map legend's gradient image is missing, because `lib/utils/mapColors.ts` loads it from `raw.githubusercontent.com`. That is unchanged here.
- **Adapted.** This branch has no transport or slots, so the map keeps its existing props and data request.
- **Conflicts.** Conflicts textually with {{PR:pr/transport}}, {{PR:pr/slots}} and {{PR:pr/config-url-errors}} (`map/index.tsx`, `types.ts`), and with {{PR:pr/theme-a11y}} (`lib/index.ts`). The resolutions are in `surfer-integration`.
