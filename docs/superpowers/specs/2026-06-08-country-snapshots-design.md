# Country Snapshots — Design Specification

**Date:** 2026-06-08
**Status:** Design proposed, pending user review
**Scope:** A self-contained module on top of SDMX Surfer that delivers MFAT-style country snapshots, with a curated catalogue, canonical thematic pages, country compare, AI chat overlay, and a path into the existing Surfer chat flow.
**Inputs:** `country_snapshots_2025.xlsx` (151 indicators across 12 themes for 22 PICTs), brainstorming dialogue 2026-06-08.

## 1. Summary

Country Snapshots is a separate area of the Surfer app under `/countrysnapshots`, gated by a shared password. It presents 22 PICTs across 12 themes (Context, Health, Education, Economic resilience, Industry, Infrastructure, Climate, Oceans, Governance, Peace, Social inclusion, ODA). For each (country, theme) combination, a canonical page renders a dashboard composed deterministically from a curated catalogue of indicators. A second route compares up to five countries on a single theme. An AI chat overlay sits next to every page, lets users ask read-only questions, and offers a one-click handoff into a normal authenticated Surfer session ("Explore in Surfer") for users who want to customise further.

The whole module lives in four predictable directories, with strict inbound-only imports from Surfer's public modules and a build-time flag to exclude it from distribution.

## 2. Goals and non-goals

### 2.1 Goals

- Reproduce, in interactive form, the kind of country snapshot MFAT currently receives as a Python-generated report.
- Cut AI discovery cost for these indicators to near-zero by giving the agent prior knowledge of the catalogue.
- Give MFAT users a low-friction entry (shared password, no signup) while still allowing deep customisation behind a real account.
- Keep the module cleanly separable from the rest of Surfer so the host app can be distributed (or forked) without it.

### 2.2 Out of scope for v1

- MFAT-branded PDF cover, multi-page report chrome (deferred to v1.1).
- Per-country static facts for indicators without a data source (e.g. Head of State).
- Country vs region/aggregate comparison.
- CSV/Excel raw-data export.
- Catalogue editing through an admin UI.
- French language UI.
- Email-link sharing of anonymous snapshot sessions (the cookie itself is the access proof; URL sharing works only within the cookie's gate).

## 3. Settled decisions

| # | Topic | Decision |
|---|---|---|
| 1 | Page model | Hybrid: canonical pre-rendered snapshot pages with a "Explore in Surfer" fork button. |
| 2 | Catalogue source of truth | Excel → import script → checked-in TypeScript catalogue. |
| 3 | Snapshot data fetching | Configs are pre-built; data is fetched at view time by sdmx-dashboard-components from the user's browser. |
| 4 | Catalogue access by the AI | Swappable interface. Two paths (system-prompt block, in-app tool) implemented behind a flag, decided by experiment. |
| 5 | Identity model | Anonymous-persisted chat overlay tied to a per-cookie identity. Real Surfer account required at the fork handoff. |
| 6 | Page composition | All indicators in the theme, dense one-pager, in catalogue order. |
| 7 | Compare page | N-country compare, default 2, up to 5. |
| 8 | Export | Whole-page PDF only, plain branding, client-side. |
| 9 | Entry page | Split: AI chat starter on top, country×theme matrix index below. |
| 10 | Packaging | Same repo, strict module boundary, public-API-only imports from Surfer, `INCLUDE_COUNTRY_SNAPSHOTS` build flag. |

## 4. Architecture

### 4.1 Surfaces

```
/countrysnapshots                                  entry page (chat + matrix)
/countrysnapshots/login                            shared-password gate
/countrysnapshots/[country]/[theme]                canonical thematic page
/countrysnapshots/compare/[theme]/[...countries]   N-country compare page

/api/countrysnapshots/chat                         chat overlay (anon-persisted)
/api/countrysnapshots/fork                         handoff to authenticated Surfer
/api/countrysnapshots/log                          partial-failure log sink
```

### 4.2 Module boundary

All Country Snapshots material lives in six paths: four code directories, one importer script, and one data folder.

Code (five paths, covered by the lint rule below):

- `app/countrysnapshots/`
- `app/api/countrysnapshots/`
- `lib/country-snapshots/`
- `components/country-snapshots/`
- `scripts/import-country-snapshots.ts`

Source data (one path, not subject to the import rule, but part of the module for distribution purposes):

- `data/country-snapshots/` (Excel source, generated import report)

Rules enforced by a lint configuration:

- `country-snapshots/*` may import from anywhere in the Surfer codebase (notably `lib/db`, `lib/auth`, `lib/model-router`, `components/`).
- Nothing outside the five code paths above may import from `country-snapshots/*`. Violations fail CI.

Build-time flag:

- `INCLUDE_COUNTRY_SNAPSHOTS=1` (default in MFAT deployment) ships the module.
- `INCLUDE_COUNTRY_SNAPSHOTS=0` excludes the route segments via Next.js's route grouping and tree-shakes the module from the bundle.
- CI runs both build modes on every PR.

The "ship Surfer without snapshots as source" recipe is either set the flag to `0` or `rm -rf` the six paths. The Surfer codebase remains buildable in both states.

### 4.3 Module dependencies on Surfer (the inbound public surface)

Country Snapshots imports the following from Surfer. These are the public API the host promises to keep stable.

- `lib/db` (Drizzle client, `dashboardSessions`, `authUsers`)
- `lib/auth` (`auth()` helper to read the current authenticated user; nothing else)
- `lib/model-router` (`getModelForUser`, BYOK and Gateway resolution)
- `lib/system-prompt` (base agent prompt, extended with a snapshot-context block)
- `components/` (chart wrappers, source citation badge, existing error boundary)
- `lib/embeddings` (only if catalogue access ever moves to RAG; not used in v1)

The module does not reach into `app/api/chat`, `app/builder`, or any private internals. The fork handoff inserts a row into `dashboardSessions` and redirects to `/builder?session=…`; from that point Surfer takes over.

## 5. The catalogue

### 5.1 Schema

```ts
// lib/country-snapshots/catalogue.ts (generated, do not edit by hand)
export type Catalogue = {
  generatedAt: string;
  sourceFile: string;
  countries: Country[];
  themes: Theme[];
  indicators: Indicator[];
};

export type Country = {
  code: string;
  name: string;
  region: "POL" | "MEL" | "MIC";
  mfatRelevant: boolean;
};

export type Theme = {
  id: string;
  slug: string;
  title: string;
  order: number;
};

export type Indicator = {
  id: string;
  themeId: string;
  title: string;
  mfatName?: string;
  rendering: "TABLE" | "CHART" | "MAP" | "TEXT";
  dataflow?: string;
  apiUrlTemplate?: string;
  visUrl?: string;
  notes?: string;
};
```

Invariants enforced at import time and re-checked by unit tests on every CI run:

- Every `Indicator.themeId` resolves to a `Theme.id`.
- An `Indicator` with `dataflow` set also has `apiUrlTemplate`.
- Every `apiUrlTemplate` contains exactly one `[TAG_GEO]` token.
- Theme slugs are unique.
- Country codes are unique.

### 5.2 Importer

A standalone Node script:

```
scripts/import-country-snapshots.ts
  --in     data/country-snapshots/country_snapshots_2025.xlsx
  --out    lib/country-snapshots/catalogue.generated.ts
  --report data/country-snapshots/import-report.md
```

Behaviour:

- Reads the `REPORTS` and `INDICATORS` sheets. Ignores `work` and review sheets unless explicitly passed.
- Validates the invariants in §5.1. Rejects the build on any violation.
- Normalises old version-pinned URLs (`SPC,DF_X,3.0/...` becomes `SPC,DF_X,/...`) per the 2026 spreadsheet update notes.
- Writes a deterministic TypeScript file: stable key ordering, no incidental timestamps in row positions, so git diffs are minimal across reruns.
- Writes a markdown import report listing: skipped rows, duplicates rejected, URL fixups applied, indicators without data sources.

Re-running the importer when MFAT sends a new spreadsheet is the standard update flow. The diff in `catalogue.generated.ts` is reviewable in the PR.

### 5.3 Catalogue access by the AI (swappable)

Two paths, both consuming the same in-process `getSnapshotCatalogue()` interface:

- **Path A: system-prompt injection.** A snapshot-scoped block is appended to the base agent prompt, listing all indicators in compact form (id, title, theme, dataflow). Costs roughly 5–10K tokens at the top of the prompt; cached for the session.
- **Path B: catalogue tool.** A new tool `list_catalogue_indicators({ theme?, country? })` returns a paged view. Implementation is intercepted in the agent loop (same pattern as `update_dashboard`); no MCP gateway change required.

Selection is via env flag (`SNAPSHOT_CATALOGUE_MODE=prompt|tool`) so we can compare cost, latency, and answer quality on a small fixture of prompts before committing. The interface is a single import; switching paths is a wiring change, not a rewrite.

## 6. The config builder

```ts
function buildSnapshotConfig(args: {
  country: Country | Country[];
  theme: Theme;
  catalogue: Catalogue;
}): SDMXDashboardConfig;
```

Behaviour:

- For each indicator in the theme (in catalogue order), produces one chart/table/text block in the JSON shape expected by `sdmx-dashboard-components`.
- Substitutes `[TAG_GEO]` with the country code, or with a comma-list when `country` is an array.
- Selects chart type from `indicator.rendering` with these defaults: CHART → time series line if the dataflow has multi-year data, else bar; TABLE → table; MAP → omitted on country pages; TEXT → text block.
- Emits source attribution metadata per block: dataflow id, source URL, retrieval intent. The PDF export reads this to render visible footnotes.
- Indicators without `apiUrlTemplate` render a placeholder block ("No data source defined for this indicator") with the catalogue's `notes` if present.

The builder is a pure function. Same inputs produce the same output. Tested with snapshot tests against a fixture catalogue.

## 7. The chat overlay

Capabilities, scoped tightly:

- **Tools available.** Read-only MCP tools (`get_dataflow_structure`, `get_codelist`, `probe_data_url`, `find_code_usage_across_dataflows`, `get_data_availability`, `compare_structures`, others as needed). The synthetic `update_dashboard` tool is not exposed; the snapshot config is fixed.
- **System prompt.** Base agent prompt plus the catalogue access mechanism from §5.3 plus a snapshot-context block describing the country/theme and the indicators currently visible.
- **Persistence.** Messages saved to `dashboard_sessions` under the snapshot-anon identity (see §9). The same table the real Surfer uses, distinguished only by the user's role.
- **Cost cap.** A per-cookie per-day token budget enforced at the chat route. Initial values: 10 turns or 50K tokens per day, whichever first. Configurable via env. When the cap is hit, the chat shows: "you've reached today's free limit; sign in to continue", which is the natural call-to-action for the fork.
- **"Explore in Surfer"** button in the overlay header. Initiates the fork handshake (§8).

The overlay UI sits as a slide-in panel from the right on desktop, and as a sheet at the bottom on mobile. It is dismissible. State persists across navigation within the snapshot area.

## 8. The fork handshake

```
POST /api/countrysnapshots/fork
body: { snapshotSessionId?, country, theme, countries? }

1. Verify snapshot cookie. Read snapshot session if `snapshotSessionId` provided.
2. Check for an authenticated Surfer user via NextAuth.
   - If absent: respond 401 with { redirectTo: "/login?next=<re-POST URL>" }.
     The "next" URL re-issues the fork with the same payload after sign-in.
   - If present: continue.
3. Build the current snapshot's dashboard config via §6.
4. Insert a new `dashboardSessions` row:
     - user_id = authenticated user
     - title = "<Country> – <Theme> (forked from snapshot)"
     - config_history = [the snapshot config]
     - config_pointer = 0
     - messages = [snapshot session messages if any, prepended with a system note:
        "This session was forked from a Country Snapshot for <country>, <theme>."]
5. Respond 200 with { sessionId, redirectTo: "/builder?session=<id>" }.
```

The original anonymous snapshot session is not mutated. The fork is a copy. The user is now in their authenticated Surfer space with the snapshot as the starting point.

## 9. The shared-password gate

- Env var `COUNTRY_SNAPSHOTS_PASSWORD`. Required in production. Defaults to `CountrySnapshots` only in development.
- `/countrysnapshots/login` is a small form POSTing the password.
- On match, set `cs_session=<signed-token>` cookie: HttpOnly, Secure, SameSite=Strict, 30-day expiry, signed with `NEXTAUTH_SECRET`. The signed payload includes a per-cookie uuid plus a token version derived from the password (so rotating the password invalidates outstanding cookies).
- On first valid login, insert a row in `authUsers`: `id = "snapshot_anon_<uuid>"`, `role = "snapshot_anon"`, `email = null` or a synthetic value, `name = null`. Bind the uuid into the cookie.
- Middleware (`proxy.ts` or a sibling Next middleware) guards every `/countrysnapshots/*` page and `/api/countrysnapshots/*` route. Unauthenticated requests redirect to the login page with `next` preserved.
- Rate-limit the login form at 5 attempts per minute per IP via the existing infrastructure.

The auth model is intentionally minimal. The shared password is access control, not identity. The per-cookie uuid is identity in the sense of "this browser keeps owning these sessions"; it does not assert anything about who is behind the browser.

## 10. Export

- "Download PDF" button on every canonical and compare page.
- Client-side, using the existing `html2canvas` + `jspdf` dependencies.
- A print stylesheet hides nav chrome and renders per-chart source citations as visible footnotes.
- Header: "SDMX Surfer — Country Snapshot — <Country> / <Theme> — <date>".
- Footer: "Data sourced from .Stat (Pacific Data Hub). Retrieved <date>."
- Compare pages export as one PDF, with all selected countries in the title.
- Failures: if any chart hasn't finished rendering when the button is clicked, show a toast ("Some charts are still loading; please wait a moment and try again") and do not generate a partial PDF.

MFAT-branded PDFs, multi-page chrome, and CSV/Excel data export are v1.1 concerns.

## 11. The entry page

Split layout (mobile: stacked; desktop: side-by-side):

- **Top: chat starter.** A prompt input and 6–8 example chips. Example chips are drawn from a curated list co-located in the module, not the catalogue:
  - "Show me Tonga education over the last decade"
  - "How does Solomon Islands fisheries compare to Vanuatu?"
  - "What's been changing in Pacific tobacco use?"
  - "Which PICTs have the most data on climate adaptation?"
  - (and so on)

  Submitting starts a new chat session in the snapshot space.

- **Bottom: matrix index.** 22 rows (countries) by 12 chips (themes). Tapping a chip navigates to the canonical thematic page. All cells are visually identical in v1: per-country availability checking would require either live probes (expensive at index render time) or a pre-computed availability map that is itself stale. A v1.1 improvement could ship the availability map as part of the catalogue, populated by a periodic offline probe job.

A small toggle pivots the matrix between "countries × themes" and "themes × countries" for users who think theme-first.

## 12. Data flow summaries

### 12.1 Canonical page view

```
GET /countrysnapshots/TO/health
  → middleware checks cs_session cookie
  → page.tsx (server component):
       country = lookup("TO")
       theme   = lookup("health")
       config  = buildSnapshotConfig({ country, theme, catalogue })
  → renders <SDMXDashboard config={...} />
  → library fetches each indicator's data from .Stat in the browser
  → error boundaries handle per-chart failures
  → "Download PDF" and "Explore in Surfer" buttons present
  → chat overlay available as a slide-in panel
```

No server-side SDMX traffic. `generateStaticParams` produces all 22 × 12 = 264 canonical pages at build time.

### 12.2 Chat turn in overlay

```
POST /api/countrysnapshots/chat
  body: { messages, snapshotContext: { country, theme, indicatorIds[] } }
  → middleware checks cs_session
  → resolve snapshot_anon identity from cookie
  → check per-day cap
  → assemble system prompt: base + catalogue block or tool (per §5.3) + snapshotContext
  → invoke agent via getModelForUser(snapshotAnonId)
  → stream response
  → persist messages to dashboard_sessions row keyed by (snapshotAnonId, sessionId)
```

### 12.3 Fork to Surfer

Sequence in §8.

### 12.4 Compare page view

```
GET /countrysnapshots/compare/health/TO+WS+VU
  → middleware checks cs_session
  → page.tsx:
       countries = ["TO", "WS", "VU"].map(lookup)
       theme     = lookup("health")
       config    = buildSnapshotConfig({ country: countries, theme, catalogue })
  → renders <SDMXDashboard config={...} />
  → comma-list geo dimension in each data URL
```

Compare pages are fully dynamic, not pre-rendered. With up to 5 countries the combination space is too large to enumerate sensibly, and the config builder is fast enough that on-demand render at request time is cheap. The page is still static-cacheable per (theme, sorted-country-list) tuple at the CDN level if we later want to.

## 13. Error handling

### 13.1 Per-indicator partial failure (the common case)

- Each chart is wrapped in an error boundary. On failure: a compact placeholder ("Couldn't load this indicator right now. Try refreshing, or view on .Stat") with a link using the catalogue's `visUrl`.
- The placeholder POSTs a small log entry to `/api/countrysnapshots/log` (existing activity-monitoring infrastructure). Fields: indicator id, country, dataflow, error type. Aggregates feed into per-endpoint reliability metrics for the production-readiness operational view.

### 13.2 Whole-page failure

- Catalogue lookup is in-process; a throw is a bug, surfaced via Next's standard error page.
- Unknown country or theme in URL: 404 page with a "Browse all snapshots" link. `generateStaticParams` ensures known combinations are pre-routed; unknown ones produce a 404 cleanly.

### 13.3 Chat overlay failures

- LLM provider error: inline message in the chat. The dashboard remains readable.
- Cost cap hit: friendly message with the "sign in to continue" CTA (which is the fork handshake).
- MCP tool failure: bubbled to the agent, which typically recovers via an alternative call. No special UI.

### 13.4 Fork handshake failures

- User not signed in: 401 with `redirectTo` pointing at `/login?next=...`. The login flow re-POSTs the fork after sign-in.
- Snapshot session not found: log and proceed with empty messages. The fork still creates a valid session, just without prior chat context.
- DB write fails: bubble to the client as "Couldn't start a Surfer session, please try again". No partial state remains.

### 13.5 Export failures

- `html2canvas` choking on a partially-rendered chart: catch, toast, do not produce a partial PDF.
- PDF generation timeout: same treatment; suggest reducing the indicators shown or trying again.

### 13.6 Auth gate failures

- Wrong password: inline error with a 5/min rate limit per IP.
- Cookie signature invalid (rotated secret, tampered cookie): treat as unauthenticated; redirect to login.

## 14. Testing

### 14.1 Unit tests (Vitest)

- **Catalogue invariants** (§5.1) on every CI run against the committed catalogue.
- **Config builder** (`buildSnapshotConfig`): given (Tonga, Health, fixture catalogue), produces the expected indicator count, correct URL substitutions, and chart types matching `rendering`. Snapshot tests.
- **Compare-mode config builder**: given (`["TO", "WS"]`, Health, fixture), produces a config with both countries in each chart's data URL.
- **Importer**: given a small fixture Excel, produces the expected catalogue TS. Tests URL normalisation, missing-theme rejection, slug uniqueness, invariant violations.
- **Module boundary**: a CI-only test (or lint rule) that walks the codebase and asserts no file outside the five code paths imports from `country-snapshots/*`.

### 14.2 Integration tests

- **Auth gate**: hit `/countrysnapshots` without cookie → redirect to login; POST password → cookie set + redirect; valid cookie + correct password → page renders; rate-limit enforced.
- **Fork handshake**: snapshot session + authenticated user → new dashboardSessions row, correctly seeded config, correctly prefixed messages, redirect to `/builder?session=…`.
- **Snapshot session persistence**: anon identity created on first login, reused on subsequent cookie-bearing visits.

### 14.3 Build-mode tests

- `INCLUDE_COUNTRY_SNAPSHOTS=0` build: no `/countrysnapshots` route appears in the build manifest; total bundle size compared to baseline shows the module is tree-shaken.
- `INCLUDE_COUNTRY_SNAPSHOTS=1` build: all 264 `generateStaticParams` routes generate.

### 14.4 Manual smoke tests (checklist)

- For one country, one theme: open the page; verify all expected indicators appear; click each chart's "view on .Stat" link to confirm `visUrl` correctness.
- Open the chat overlay on a snapshot page, ask a read-only question, verify the response references the visible indicators.
- Click "Explore in Surfer" while signed out: verify the sign-in redirect round-trips correctly and lands in `/builder` with the seeded session.
- Generate a PDF for one country/theme and verify source citations on every chart.

### 14.5 Out of scope for testing in v1

- Real SDMX endpoint reliability. Observed via the logging endpoint; addressed at the catalogue level (drop chronically broken indicators) rather than in tests.
- Visual regression on PDF output. Manual review.

## 15. Operational and security considerations

- **Cost.** Chat overlay traffic is the dominant cost line and is capped per cookie. With a 10-turn-per-day cap and ~1K snapshot users per month, expected monthly cost is bounded by the cap times the active cookie count. Worth metering and alerting on after launch.
- **Endpoint instability.** The per-indicator partial-failure pattern is the main defence; we observe via the log endpoint and react by adjusting the catalogue when an indicator becomes chronically broken.
- **Password rotation.** Rotating `COUNTRY_SNAPSHOTS_PASSWORD` invalidates all outstanding cookies. No additional code path needed.
- **Snapshot-anon cleanup.** Rows in `authUsers` with `role = "snapshot_anon"` accumulate over time. Add a small cleanup job that deletes anon users with no activity in the last 90 days, together with their orphaned `dashboardSessions`. Documented as a follow-up, not blocking v1.
- **Logging discipline.** Per-indicator failure logs must not include personal data. Cookie uuid is acceptable; IP is not.

## 16. Open questions and deferred decisions

- **§5.3 catalogue access mode (A or B).** Decided by experiment. We will run a fixture of representative prompts in both modes and compare cost, latency, and answer quality before defaulting one in production.
- **Static facts (e.g. Head of State) per country.** Deferred to v1.1. The catalogue schema reserves the right to add a per-country static-facts block without breaking changes.
- **MFAT-branded PDF cover.** Deferred to v1.1 unless MFAT raises it before launch.
- **CSV/Excel data export.** Deferred unless analysts specifically request it.
- **Country vs region/aggregate compare (Q7 option C/D).** Deferred unless MFAT asks. The compare URL pattern reserves the right to introduce synthetic "region" pseudo-countries (`MEL`, `MIC`, `POL`, `PACIFIC`) without breaking changes.
- **Snapshot session sharing across cookies.** Out of scope. Users wanting to share work cross-account use "Explore in Surfer" to fork into a real account and then use Surfer's existing sharing.

## 17. References

- Brainstorming dialogue: this conversation, 2026-06-08.
- Source catalogue: `country_snapshots_2025.xlsx`.
- Surfer current architecture: `docs/current-architecture.md`.
- Production readiness: `docs/prototype-to-production.md`.
- Security posture: `SECURITY_AUDIT.md`.
