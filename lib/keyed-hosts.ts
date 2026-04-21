/**
 * Hosts whose SDMX endpoints require a subscription key on every request.
 * Shared by the server proxy route (which injects the key from env) and the
 * client-side fetch wrapper (which rewrites matching URLs to go through the
 * proxy). The module is intentionally neutral — no process.env at import time —
 * so it can be pulled into client bundles.
 *
 * Adding a new keyed provider means one entry here, one Vercel env var, and
 * one entry in lib/endpoints-registry.ts. The path allowlist narrows what can
 * be requested through the proxy so the shared key can't be abused against
 * non-data endpoints of the same host.
 */

export interface KeyedHostConfig {
  envVar: string;
  header: string;
  allowedPathPattern: RegExp;
}

export const KEYED_HOSTS: Record<string, KeyedHostConfig> = {
  "api.data.stats.govt.nz": {
    envVar: "SDMX_STATSNZ_KEY",
    header: "Ocp-Apim-Subscription-Key",
    // .Stat Suite REST resource paths. Widen if real dashboards need more.
    allowedPathPattern:
      /^\/rest\/(data|dataflow|datastructure|codelist|conceptscheme|availableconstraint|contentconstraint|categoryscheme)\//,
  },
};

export const KEYED_HOST_NAMES: ReadonlySet<string> = new Set(
  Object.keys(KEYED_HOSTS),
);
