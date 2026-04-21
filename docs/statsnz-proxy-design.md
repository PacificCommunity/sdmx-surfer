# Keyed SDMX Providers (Stats NZ) — Proxy Design

Status: implemented 2026-04-21. See `app/api/sdmx-proxy/route.ts`,
`app/sdmx-proxy-boot.tsx`, `lib/keyed-hosts.ts`.

## Context

The dashboarder uses `sdmx-dashboard-components` to render dashboards. That library delegates SDMX data fetches to `sdmx-json-parser` (both live in `node_modules`), which issues the HTTP request from the browser. There is no existing server-side SDMX proxy (the root `proxy.ts` is `next-auth` middleware, not a data proxy).

Published dashboards at `/p/[id]` and the gallery at `/gallery` are served to unauthenticated viewers, whose browsers call the SDMX URL directly.

Stats NZ (Aotearoa Data Explorer) requires a subscription key on every request. The required header is `Ocp-Apim-Subscription-Key`; without it the API returns 401. The subscription is generous, so quota is not a concern, but the key cannot be shipped to the browser or embedded in dashboard configs:

- It would appear in the bundled JS or in the dashboard config JSON visible to any viewer.
- Leaked keys would violate the subscription terms regardless of quota.
- Rotation, while possible, is operational friction.

## Decision

Route Stats NZ fetches through a server-side proxy inside the dashboarder. The proxy injects the header from a Vercel environment variable.

### Architecture

```
Browser fetch(...) ──► window.fetch wrapper
                           │
                           ├── host in KEYED_HOSTS?  yes ──► /api/sdmx-proxy?url=…
                           │                                        │
                           │                                        ▼
                           │                         [server] inject Ocp-Apim-Subscription-Key
                           │                         from SDMX_STATSNZ_KEY env var, fetch,
                           │                         stream response back
                           │
                           └── otherwise ───────────► original fetch, direct to provider
```

### Why a `window.fetch` wrapper and not a `patch-package` patch

Two realistic interception points exist:

1. Patch `sdmx-json-parser` (single `fetch(t,e)` call in the minified bundle) via `patch-package`. This works but pins us to version 0.3.1 the same way the existing 0.4.6 patch on `sdmx-dashboard-components` does. Every upstream bump requires re-applying.

2. Wrap `window.fetch` at app bootstrap. Host-prefix check, rewrite to `/api/sdmx-proxy?url=…` on match, passthrough otherwise.

Chosen: 2. Rationale:

- Survives version bumps in either SPC library without patch maintenance.
- Single code site to extend when further keyed providers are added.
- The "global mutation" concern is modest here because the dashboard page isn't sharing `window.fetch` with third-party code paths that would conflict.

## Implementation

### 1. Shared host config — `lib/keyed-hosts.ts`

One map keyed by host, carrying `{ envVar, header, allowedPathPattern }`. The
module is neutral (no `process.env` at import time) so it's safe to import
from both the server route and the client wrapper.

### 2. Server-side proxy route — `app/api/sdmx-proxy/route.ts`

Defenses stacked in order:

- **Same-site browser-context gate** — require `Origin` or `Referer` on the
  request, and require that it matches the current app origin (or
  `NEXTAUTH_URL`; localhost/127.0.0.1 allowed in dev). Raises the bar against
  direct curl / casual scraping while also blocking arbitrary third-party
  websites from hotlinking the proxy from a browser.
- **Host allowlist** — only hosts in `KEYED_HOSTS` are forwarded; everything
  else returns 403.
- **Path allowlist per host** — for Stats NZ, only `.Stat Suite` REST
  resource paths (`/rest/data`, `/rest/dataflow`, `/rest/codelist`, …) so the
  shared key can't be used against arbitrary paths on the same host.
- **https required** on the target URL.
- **Key read per-request** from `process.env` — rotation works without
  redeploy beyond env-var update.
- **Status-gated cache headers** — 2xx gets the long cache
  (`max-age=300, s-maxage=3600`), 4xx gets a short edge cache
  (`s-maxage=60`) so a broken query doesn't hammer upstream, 5xx is
  `no-store` so transient errors don't poison the edge.
- **`Vary: Accept, Accept-Language`** — keeps edge caches from mixing content
  negotiated by different clients.
- **Streaming pass-through** of `upstream.body` avoids materialising large
  responses.
- **Structured log line** (`console.info sdmx-proxy { host, path, status, ms }`)
  on every request — lands in Vercel logs, queryable there. Sufficient for
  abuse detection at pilot scale; can be promoted to a persistent table
  later if needed.
- `Accept` and `Accept-Language` are forwarded so the library's format
  negotiation still works.

### 3. Client-side fetch wrapper — `app/sdmx-proxy-boot.tsx`

Host set imported from `lib/keyed-hosts.ts` so server and client can't drift.
When the wrapped fetch is called with a `Request` object, the wrapper
forwards `method`, `headers`, `signal`, and `credentials` to the proxy call
so properties that live on the `Request` (and not in `init`) don't get
dropped during the rewrite. Mounted once in the root `app/layout.tsx`.

`sdmx-dashboard-components` is used as a client component (builder, preview,
`/p/[id]`, gallery all render it after mount), so `window.fetch` is the only
call site. SSR data paths don't exist for dashboard fetches today; if they
are added, they will need server-side proxy use directly.

### 4. Environment

- Development: `.env.local` gains `SDMX_STATSNZ_KEY=…`.
- Vercel project env: same variable, **Production scope only**. Branch
  previews (if/when added) must not expose an unauthenticated proxy holding
  the shared key at a rotating URL that isn't covered by the Origin check.
- `.env.example` documents the variable but leaves the value blank.

### 5. Endpoints registry

`lib/endpoints-registry.ts` gains:

```ts
{
  key: "STATSNZ",
  name: "Stats NZ — Aotearoa Data Explorer",
  shortName: "Stats NZ",
  apiHosts: ["api.data.stats.govt.nz"],
  // Optionally a buildExplorerUrl — Stats NZ Data Explorer URL pattern tbc.
},
```

So the Data Sources panel recognises Stats NZ URLs and labels them correctly.

## Rejected alternatives

- **Snapshot at publish time.** Server fetches once, stores the result, dashboards reference the snapshot. Kills live-data semantics. Disqualifying for most tables.
- **Authenticated-only Stats NZ panels.** Adds friction without solving anything — quota is generous, and key exposure is the only real concern, already addressed by the server-side proxy.
- **Embed the key client-side.** Disqualified on terms-of-use grounds.

## Future providers

Adding another keyed provider means one entry in `lib/keyed-hosts.ts`
(envVar + header + allowedPathPattern), one Vercel env var, and one entry in
`endpoints-registry.ts`. Client wrapper picks up the new host automatically
via `Object.keys(KEYED_HOSTS)`. Same pattern scales.

## Explicitly rejected

- **Rate limiting.** Not imposed. Pilot traffic is low; the structured log
  line is enough to detect abuse if it ever shows up, and we can bolt a
  token bucket on later without changing the route shape.

## Follow-ups (not part of this slice)

- Confirm the Stats NZ Data Explorer deep-link URL pattern and add
  `buildExplorerUrl` to the registry entry.
- If real dashboards need paths outside the current allowlist, widen
  `allowedPathPattern` in `lib/keyed-hosts.ts`.
- Consider forwarding `user-agent` from client to the proxy for Stats NZ's
  usage telemetry.
- If `sdmx-json-parser` ever gains a configurable fetcher, switch to
  dependency injection and drop the `window.fetch` wrapper.
