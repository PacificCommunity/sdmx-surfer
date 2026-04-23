/**
 * Hosts whose SDMX endpoints must be fetched server-side instead of direct from
 * the browser. Two reasons show up:
 *
 *   - "key": the host requires a subscription key on every request. The proxy
 *     reads the key from env and injects the configured header, so the key
 *     never reaches the browser bundle.
 *
 *   - "cors": the host returns no `Access-Control-Allow-Origin` header, so
 *     browsers block direct fetches. The proxy is same-origin, so the browser
 *     request succeeds; the server-to-server fetch has no CORS restriction.
 *
 * Shared by the server proxy route (which forwards the request) and the
 * client-side fetch wrapper (which rewrites matching URLs to go through the
 * proxy). The module is intentionally neutral (no process.env at import time)
 * so it can be pulled into client bundles.
 *
 * Adding a new provider means one entry here, optional env var(s), and one
 * entry in lib/endpoints-registry.ts. The path allowlist narrows what can be
 * requested so the proxy doesn't become an open forwarder for the host.
 */

export interface ProxiedHostConfig {
  reason: "key" | "cors";
  allowedPathPattern: RegExp;
  key?: {
    envVar: string;
    header: string;
  };
}

// Regex building blocks for SDMX REST resource paths.
// Keep these narrow — we're deciding what the shared proxy will forward.
const SDMX_RESOURCES =
  "data|dataflow|datastructure|codelist|conceptscheme|availableconstraint|contentconstraint|categoryscheme";

export const PROXIED_HOSTS: Record<string, ProxiedHostConfig> = {
  // StatsNZ Aotearoa Data Explorer — requires an Ocp-Apim subscription key.
  "api.data.stats.govt.nz": {
    reason: "key",
    key: {
      envVar: "SDMX_STATSNZ_KEY",
      header: "Ocp-Apim-Subscription-Key",
    },
    allowedPathPattern: new RegExp("^/rest/(" + SDMX_RESOURCES + ")/"),
  },

  // Eurostat — the dissemination API does not send CORS headers, so browser
  // fetches are blocked. Server-side fetches succeed without a key.
  "ec.europa.eu": {
    reason: "cors",
    allowedPathPattern: new RegExp(
      "^/eurostat/api/dissemination/sdmx/(2\\.1|3\\.0)/(" +
        SDMX_RESOURCES +
        ")/",
    ),
  },

  // OECD SDMX (.Stat Suite at sdmx.oecd.org) — CORS-blocked for browsers.
  "sdmx.oecd.org": {
    reason: "cors",
    allowedPathPattern: new RegExp("^/public/rest/(" + SDMX_RESOURCES + ")/"),
  },
};

export const PROXIED_HOST_NAMES: ReadonlySet<string> = new Set(
  Object.keys(PROXIED_HOSTS),
);
