// Content-Security-Policy for every response (set in next.config.ts).
//
// Its main job is connect-src: pages may only talk to this site, the
// registered SDMX providers and the map layer hosts. A dashboard config or
// injected script then has nowhere else to send data, and a viewer's browser
// cannot be made to fetch from arbitrary hosts.
//
// Imported by next.config.ts, which does not resolve the "@/" alias, so this
// file and its imports use relative paths.

import { ENDPOINTS, MAP_LAYER_HOSTS } from "./endpoints-registry";

export function contentSecurityPolicy(isDevelopment: boolean): string {
  const dataOrigins = [...ENDPOINTS.flatMap((e) => e.apiHosts), ...MAP_LAYER_HOSTS]
    .map((host) => "https://" + host)
    .join(" ");
  return [
    "default-src 'self'",
    // Next.js inlines its bootstrap scripts, and nonces would force every
    // page to render dynamically. Development adds eval for React Refresh.
    "script-src 'self' 'unsafe-inline'" + (isDevelopment ? " 'unsafe-eval'" : ""),
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "font-src 'self' data: https://fonts.gstatic.com",
    // Satellite basemap tiles and the chart library's colour-scheme previews.
    "img-src 'self' data: blob: https://server.arcgisonline.com https://services.arcgisonline.com https://raw.githubusercontent.com",
    "connect-src 'self' " + dataOrigins,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
  ].join("; ");
}
