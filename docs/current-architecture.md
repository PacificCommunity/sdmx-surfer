# Current Architecture

**Status:** implemented application behavior  
**Scope:** current codebase, routes, access rights, persistence model, and public/private boundaries  
**Purpose:** this document is the refactor baseline. It describes what the app does now, not the broader target-state architecture described elsewhere.

## 1. What This App Is

SDMX Surfer is a Next.js App Router application for building SDMX dashboards through chat.

At a high level, the app combines:

- a protected builder UI
- a server-side chat route that talks to an MCP gateway
- a dashboard rendering library (`sdmx-dashboard-components`)
- database-backed session persistence
- invite-only authentication
- optional publication of dashboards to a public gallery

This repository contains the production app, not only a prototype shell. Some older architecture documents still describe planned features or earlier states. This document is the source of truth for the currently implemented behavior.

## 2. Main Runtime Pieces

### Frontend surfaces

- `/` — authenticated home page showing recent sessions and entry points
- `/builder` — authenticated chat + live preview editor
- `/dashboard/[id]` — authenticated presentation view for a private session
- `/p/[id]` — public presentation view for a published dashboard
- `/gallery` — public listing of published dashboards
- `/explore` and `/explore/[id]` — authenticated dataset/dataflow exploration pages
- `/settings` — authenticated user settings and BYOK key management
- `/admin` — authenticated admin page

### Backend/API surfaces

- `/api/chat` — authenticated agent loop
- `/api/sessions` and `/api/sessions/[id]` — authenticated session CRUD, owner-scoped
- `/api/sessions/[id]/publish` — authenticated owner publish/unpublish endpoint
- `/api/public/dashboards` and `/api/public/dashboards/[id]` — public read-only published dashboard endpoints
- `/api/admin/*` — authenticated admin-only operational endpoints
- `/api/auth/*` — NextAuth endpoints

### External dependencies

- MCP gateway for SDMX discovery/query tooling
- `sdmx-dashboard-components` for dashboard rendering
- NextAuth with email magic links for authentication
- Postgres via Drizzle for persistence

## 3. Route Model and Access Rights

The route model is simple but important. Some pages look very similar in the UI while having different security semantics.

### Public routes

These routes are intentionally reachable without authentication:

- `/login`
- `/gallery`
- `/p/[id]`
- `/api/public/dashboards`
- `/api/public/dashboards/[id]`
- `/api/auth/*`

This is enforced in `proxy.ts`, which excludes `gallery`, `p(...)`, and `api/public` from auth middleware.

### Authenticated routes

These require a signed-in user:

- `/`
- `/builder`
- `/dashboard/[id]`
- `/explore`
- `/explore/[id]`
- `/settings`
- `/api/chat`
- `/api/sessions`
- `/api/sessions/[id]`
- `/api/sessions/[id]/publish`

### Admin-only routes

These require both authentication and `session.user.role === "admin"`:

- `/admin` in practice
- `/api/admin/invites`
- `/api/admin/users`
- `/api/admin/published-dashboards`

The admin restriction is enforced in the route handlers, not by middleware matcher rules alone.

## 4. Core User Flows

### 4.1 Builder flow

`/builder` is the main product surface.

The builder combines:

- a chat panel
- a dashboard preview / JSON editing panel
- autosaved session state
- model selection and BYOK support
- publish/unpublish controls

The builder persists:

- chat messages
- dashboard config history
- current config pointer
- session title
- publish metadata

The builder is the only place where dashboards are authored or edited.

### 4.2 Private presentation flow

`/dashboard/[id]` is a private presentation view backed by the owner’s session.

It is not public sharing.

It loads session data through authenticated, owner-scoped session APIs. A user can open it for their own session and export or continue editing from there.

### 4.3 Public publication flow

Publishing is an explicit state on a session.

When a user publishes from the builder:

- the session keeps its private editor/chat state internally
- `published_at` is set
- public metadata is stored on the session row
- the session becomes visible through `/p/[id]`
- the session can appear in `/gallery`

The public view is read-only and deliberately narrower than the private session view.

### 4.4 Fork flow

A public dashboard can be used as a starting point for a new private builder session.

Flow:

1. user opens `/p/[id]`
2. user clicks "Explore this data"
3. if unauthenticated, they go through login
4. they land on `/builder?fork=[id]&new=1`
5. the builder creates a new private session seeded from the public dashboard config

This is a copy/fork workflow, not collaborative editing on the published dashboard itself.

## 5. Session and Persistence Model

The main durable application object is `dashboard_sessions`.

Each row stores:

- `id`
- `user_id`
- `title`
- `messages`
- `config_history`
- `config_pointer`
- `created_at`
- `updated_at`
- `deleted_at`
- `public_title`
- `public_description`
- `author_display_name`
- `published_at`

### Session semantics

- `messages` contains the conversational history used by the builder
- `config_history` stores dashboard revisions
- `config_pointer` selects the currently active config
- `deleted_at` implements soft-delete
- `published_at` indicates whether the session is currently public

### Important consequence

Public dashboards are not stored in a separate table. A published dashboard is still the same underlying session; publication is a state transition on that session.

That keeps authoring and publication linked, but it also means refactors must preserve the difference between:

- private session data
- public dashboard projection of that session

## 6. Public vs Private Data Boundaries

This is the most important architecture boundary in the app.

### Private session surface

Private session APIs and pages can access:

- chat history
- full config history
- current editing state
- owner-specific controls

Examples:

- `/builder`
- `/dashboard/[id]`
- `/api/sessions/[id]`

### Public dashboard surface

Public published-dashboard APIs intentionally return a reduced projection:

- `id`
- public-facing title
- public description
- compiled/current dashboard config
- public author display name
- publication timestamp

They do **not** expose:

- chat messages
- full edit history
- owner email
- BYOK data
- session internals beyond the active config

The current public detail API is `GET /api/public/dashboards/[id]`. It only serves dashboards where:

- `published_at IS NOT NULL`
- `deleted_at IS NULL`

This projection boundary must be preserved in any cleanup or component extraction work.

## 7. Authentication and Authorization Model

Authentication is invite-only and email-link based.

### Auth model

- NextAuth v4
- EmailProvider / magic-link flow
- allowlist check against `allowed_emails`
- session enriched with:
  - `userId`
  - `role`

### Authorization model

- ordinary authenticated routes require a session
- session CRUD is owner-scoped by `dashboard_sessions.user_id`
- admin routes check `role === "admin"`
- public routes do not require auth, but only expose published data

### Important distinction

Authentication answers "who is this user?"

Authorization is handled per route and is where the important ownership/admin/public rules live. Any refactor that centralizes page shells or shared loaders must preserve those checks.

## 8. Chat and Dashboard Generation Architecture

The app generates dashboards through a server-side chat loop.

### Request path

1. builder sends chat messages to `/api/chat`
2. server authenticates the user
3. server resolves the model to use
4. server creates a per-request MCP client
5. LLM can call MCP tools plus the synthetic `update_dashboard` tool
6. the app compiles authoring-schema output into native dashboard config
7. the builder extracts the latest dashboard config from tool output and renders it

### Authoring layer

The app does not require the model to emit raw `sdmx-dashboard-components` config for every case.

Instead, it prefers a simpler authoring schema with intent visuals such as:

- `kpi`
- `chart`
- `map`
- `note`

The server compiles this into the native rendering-library config. Native passthrough still exists for advanced cases.

This matters for maintainability because there are effectively two config layers:

- LLM-facing authoring contract
- runtime-facing dashboard-library contract

## 9. Rendering Surfaces

Three surfaces render dashboards from config:

- builder preview
- private `/dashboard/[id]` page
- public `/p/[id]` page

They are visually similar, but they are not equivalent.

### Builder preview

- interactive editing context
- tabbed preview/JSON editor
- error capture and repair loop
- autosave-oriented

### Private dashboard page

- authenticated
- session-backed
- includes edit/export path

### Public dashboard page

- public
- published dashboards only
- no chat or edit controls
- includes export and fork/explore entry point

Any shared component extraction should treat these as related renderers with different access and control semantics, not as identical pages.

## 10. Publication and Gallery Model

Publication is session-scoped.

### Publish metadata

Publication currently stores:

- `published_at`
- `public_title`
- `public_description`
- `author_display_name`

This metadata lives on the session row and is used by the public API and gallery.

### Public gallery

`/gallery` is a public listing of published dashboards.

Its backing API:

- reads only sessions where `published_at IS NOT NULL`
- excludes soft-deleted sessions
- returns public summary fields only

### Admin moderation

Admins can inspect published dashboards through admin APIs and can unpublish them. That admin view is intentionally broader and includes internal owner information needed for moderation.

## 11. Operational Notes for Refactoring

Before general cleanup or deduplication work, these invariants should be treated as non-negotiable:

- `/p/[id]` is public and must stay public
- `/dashboard/[id]` is private and owner-scoped
- public APIs must never expose chat history
- admin routes are broader than owner routes
- publication is a state on `dashboard_sessions`, not a separate entity
- the builder remains the only editing surface

### Current maintainability hotspots

- `app/dashboard/[id]/page.tsx` and `app/p/[id]/page.tsx` are structurally similar but differ in access rights and controls
- `components/dashboard-preview.tsx` carries many concerns in one component
- `app/builder/page.tsx` holds significant orchestration state
- older docs do not cleanly distinguish target-state architecture from implemented behavior

These are good refactor candidates, but only after the route/access model above is treated as fixed behavior to preserve.

## 12. Relationship to Other Docs

This document is intentionally narrower than the other architecture files.

- `dashboard-architecture.md` describes the broader product architecture and target design
- `docs/technical-reference.md` describes technical internals in more detail, but parts of it reflect earlier states or planned behavior
- this file describes the implemented app behavior that refactors must preserve

When the three documents disagree, treat this file as the source of truth for current route semantics, persistence shape, and access rights.
