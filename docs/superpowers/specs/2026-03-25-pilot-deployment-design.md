# Pilot Deployment Design — SPC Conversational Dashboard Builder

**Date:** 2026-03-25
**Status:** Approved
**Scope:** Deploy the dashboard builder for invite-only pilot testing with real users

---

## 1. Overview

Prepare the SPC Conversational Dashboard Builder for pilot testing with 20-50 invited users. The deployment must support:

- **Invite-only access** with email allowlisting
- **Server-side session persistence** (replace localStorage)
- **Multi-model support** with a cheap free tier (Gemini 3 Flash) and BYOK for premium models
- **Clean two-service deployment** on Vercel (app) + Railway (MCP gateway)

## 2. Infrastructure

```
Users (browser)
     │
     ▼
┌──────────────────────────────────────────┐
│  Vercel                                  │
│  ┌────────────────────────────────────┐  │
│  │  Next.js App                       │  │
│  │  - Pages: /, /builder, /explore,   │  │
│  │    /dashboard/[id], /explore/[id]  │  │
│  │  - API: /api/chat, /api/explore,   │  │
│  │    /api/auth, /api/sessions        │  │
│  │  - Auth: NextAuth.js (magic links) │  │
│  │  - Model routing (free / BYOK)     │  │
│  └──────────┬──────────┬──────────────┘  │
│             │          │                 │
│  ┌──────────▼───────┐  │                 │
│  │  Vercel Postgres  │  │                 │
│  │  (Neon)           │  │                 │
│  │  - users          │  │                 │
│  │  - allowed_emails │  │                 │
│  │  - sessions       │  │                 │
│  │  - usage_logs     │  │                 │
│  │  - user_api_keys  │  │                 │
│  └──────────────────┘  │                 │
└──────────────────────────┼─────────────────┘
                           │ HTTPS
                           ▼
               ┌────────────────────────┐
               │  Railway               │
               │  MCP Gateway (Python)  │
               │  - Stateless           │
               │  - No user awareness   │
               │  - Per-request session │
               └────────────┬───────────┘
                            │
                            ▼
                      .Stat SDMX API
```

### Separation of concerns

- **Vercel** owns everything user-facing: auth, sessions, AI model routing, UI
- **Railway** owns SDMX data access: stateless MCP gateway, no user data
- **Vercel Postgres** owns all persistent state: users, sessions, logs, API keys
- The MCP gateway is a shared data service — other apps or users could point at it in future

## 3. Authentication — Invite-Only with Magic Links

### Approach

NextAuth.js (Auth.js v5) with email magic links (passwordless). No external OAuth provider needed for the pilot — reduces setup complexity and SPC IT coordination.

### User flow

1. Admin adds user's email to `allowed_emails` table
2. User visits the app → redirected to login page
3. User enters email → receives magic link via email
4. User clicks link → authenticated, session cookie set
5. All routes protected by middleware — unauthenticated requests redirect to login

### Why magic links over OAuth

- No third-party dependency (no Google/GitHub/SPC SSO needed)
- Works for both SPC and external users (anyone with an email)
- Admin controls exactly who has access via the allowlist
- Easy to add OAuth providers later as additional sign-in options

### Email delivery

**Resend** for transactional magic link emails:
- Free tier: 100 emails/day — more than enough for pilot
- First-party NextAuth/Auth.js integration
- Simple API key setup, no SMTP configuration needed
- Requires a verified domain (or use Resend's test domain during development)

### What changes

- Add `next-auth` package + email provider config
- Create `app/api/auth/[...nextauth]/route.ts`
- Add auth middleware (`middleware.ts`) protecting all routes except `/api/auth`
- Login page at `/login` with email input
- Pass `userId` from auth session to API routes via cookie

## 4. Database — Vercel Postgres (Neon)

### Schema

NextAuth.js with the Drizzle adapter expects specific table names and columns for auth (`auth_users`, `auth_accounts`, `auth_sessions`, `auth_verification_tokens`). Our application tables use separate names to avoid collisions. NextAuth uses **JWT sessions** (not database sessions) to avoid requiring an `auth_sessions` table.

```sql
-- Users (NextAuth-compatible via Drizzle adapter)
CREATE TABLE auth_users (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  "emailVerified" TIMESTAMPTZ,
  image TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- NextAuth accounts (for future OAuth providers)
CREATE TABLE auth_accounts (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "userId" TEXT NOT NULL REFERENCES auth_users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  "providerAccountId" TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT
);

-- NextAuth verification tokens (for magic links)
CREATE TABLE auth_verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- Invite allowlist
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  invited_by TEXT REFERENCES auth_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Dashboard sessions (application data — separate from auth sessions)
CREATE TABLE dashboard_sessions (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  role TEXT DEFAULT 'user' CHECK (role IN ('admin', 'user')),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Invite allowlist
CREATE TABLE allowed_emails (
  email TEXT PRIMARY KEY,
  invited_by TEXT REFERENCES auth_users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Dashboard sessions (replaces localStorage)
CREATE TABLE dashboard_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  title TEXT DEFAULT 'Untitled',
  messages JSONB NOT NULL DEFAULT '[]',
  config_history JSONB NOT NULL DEFAULT '[]',
  config_pointer INT DEFAULT -1,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_sessions_user ON dashboard_sessions(user_id, updated_at DESC);

-- Usage logs (replaces JSONL files)
CREATE TABLE usage_logs (
  id SERIAL PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  session_id TEXT REFERENCES dashboard_sessions(id),
  request_id TEXT NOT NULL,
  user_message TEXT,
  ai_response TEXT,
  tool_calls JSONB DEFAULT '[]',
  dashboard_config_ids TEXT[] DEFAULT '{}',
  errors TEXT[] DEFAULT '{}',
  input_tokens INT,
  output_tokens INT,
  model TEXT,
  provider TEXT,
  duration_ms INT,
  step_count INT,
  created_at TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX idx_usage_user ON usage_logs(user_id, created_at DESC);

-- BYOK API keys (encrypted)
CREATE TABLE user_api_keys (
  user_id TEXT NOT NULL REFERENCES auth_users(id),
  provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai', 'google')),
  encrypted_key TEXT NOT NULL,
  model_preference TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, provider)
);
```

### Session storage

- All sessions stored server-side in PostgreSQL from the start — no localStorage
- `lib/session.ts` interface stays the same but the implementation calls `/api/sessions` instead of localStorage
- localStorage code removed entirely (no fallback, no migration — pilot users are all new)

### API key encryption

- BYOK keys encrypted at rest using **AES-256-GCM**
- Key derived from `ENCRYPTION_SECRET` env var via **HKDF** with a per-provider salt
- Random 12-byte IV stored as prefix to the ciphertext in the `encrypted_key` column
- Decrypted only in the API route when creating the AI provider
- Never sent to the client — the settings page only shows "Key set for Anthropic ✓"
- If `ENCRYPTION_SECRET` is rotated, all existing BYOK keys become unreadable (documented for admins, users must re-enter keys)

## 5. Model Routing — Free Tier + BYOK

### Default free tier

**Gemini 3 Flash** via a platform Google AI API key stored in Vercel env vars.

- Cost: ~$0.05 per session (negligible)
- 1M context window
- Tool use support
- Free tier from Google may cover initial pilot volume entirely

### BYOK (Bring Your Own Key)

Users can provide their own API keys for:

| Provider | AI SDK package | Models available |
|----------|---------------|-----------------|
| Anthropic | `@ai-sdk/anthropic` (already installed) | Haiku 4.5, Sonnet 4.6, Opus 4.6 |
| OpenAI | `@ai-sdk/openai` (to install) | GPT-4.1 Mini/Nano, GPT-5.4 |
| Google | `@ai-sdk/google` (to install) | Gemini 2.5/3 Pro, Flash |

### Model routing logic in `/api/chat`

```
1. Get authenticated user from session
2. Check user_api_keys for a stored key:
   a. If user has BYOK key → create provider with user's key + preferred model
   b. If no BYOK key → create Google provider with platform key + Gemini 3 Flash
3. Pass provider to streamText() — everything else (MCP tools, system prompt,
   update_dashboard) stays the same regardless of provider
```

### Settings page

New page at `/settings` (auth-protected):
- **API Keys section:** Add/remove keys for Anthropic, OpenAI, Google
  - Input field + save button per provider
  - Shows "✓ Key configured" / "No key" status
  - Key value never displayed after saving (encrypted in DB)
- **Model preference:** Dropdown to pick preferred model for the selected provider
- **Usage section:** Token usage summary for current billing period

### What changes

- Install `@ai-sdk/openai` and `@ai-sdk/google` packages
- Create `lib/model-router.ts` — given a user, returns the correct AI SDK provider + model
- Modify `app/api/chat/route.ts` — replace hardcoded `anthropic("claude-sonnet-4-6")` with the model router
- Create `/settings` page for BYOK key management
- Create `/api/settings/keys` route for CRUD on user_api_keys

## 6. MCP Gateway on Railway

### Containerization

```dockerfile
FROM python:3.12-slim
WORKDIR /app
RUN pip install uv
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen
COPY . .
EXPOSE 8000
CMD ["uv", "run", "python", "main_server.py", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8000"]
```

### Railway deployment

- Connect the `sdmx-mcp-gateway` GitHub repo to Railway
- Railway auto-deploys on push to main
- Set health check to `GET /mcp` (or a dedicated `/health` endpoint if available)
- Railway provides a public URL: `https://sdmx-mcp-gateway-production.up.railway.app/mcp`
- **Gateway authentication:** Set a shared secret via `MCP_AUTH_TOKEN` env var on Railway. The Next.js app sends this as a Bearer token in the `Authorization` header on every MCP request. The gateway rejects requests without a valid token. This prevents public abuse of the gateway URL.

### Per-request MCP client (fix singleton bug)

Currently the Next.js app caches a single MCP client as a module-level singleton. All users share one MCP session, risking endpoint conflicts.

**Fix:** Create a new MCP client per API request instead of caching:

```typescript
// Before (broken for multi-user):
let mcpClientPromise = null;
function getMCPClient() { ... singleton ... }

// After (safe):
async function withMCPClient<T>(fn: (tools: ToolSet) => Promise<T>): Promise<T> {
  const client = await createMCPClient({
    transport: { type: "http", url: process.env.MCP_GATEWAY_URL },
  });
  try {
    const tools = await client.tools();
    return await fn(tools);
  } finally {
    await client.close();
  }
}
```

Cost: ~50ms extra per request for MCP session establishment — negligible vs LLM latency.

The `withMCPClient` helper should live in a shared module (`lib/mcp-client.ts`) — currently the singleton pattern is duplicated across three files (`app/api/chat/route.ts`, `app/api/explore/route.ts`, `app/api/explore/[id]/route.ts`).

### Environment variables

Set `MCP_GATEWAY_URL` in Vercel env vars to the Railway URL.

## 7. Deployment Workflow

### Initial setup

```bash
# 1. Railway: Deploy MCP gateway
#    - Connect sdmx-mcp-gateway repo
#    - Auto-deploys from GitHub
#    - Note the public URL

# 2. Vercel: Deploy Next.js app
#    - Connect dashboarder repo
#    - Set env vars:
#      GOOGLE_AI_API_KEY=...          # Platform Gemini key for free tier
#      MCP_GATEWAY_URL=https://...    # Railway MCP URL
#      DATABASE_URL=...               # Vercel Postgres connection string (auto-set)
#      NEXTAUTH_SECRET=...            # Random secret for session signing
#      NEXTAUTH_URL=https://...       # App URL
#      ENCRYPTION_SECRET=...          # For BYOK key encryption
#      RESEND_API_KEY=re_...           # Resend API key for magic links
#      EMAIL_FROM=noreply@yourdomain.com

# 3. Run database migrations
#    npx drizzle-kit push (or manual SQL)

# 4. Seed admin user
#    INSERT INTO users (email, role) VALUES ('admin@spc.int', 'admin');
#    INSERT INTO allowed_emails (email) VALUES ('admin@spc.int');
```

### Adding pilot users

```sql
INSERT INTO allowed_emails (email) VALUES ('user@example.com');
-- User can now log in via magic link
```

### Ongoing deployment

- Push to `main` on either repo → auto-deploys
- Database migrations via Drizzle Kit or raw SQL
- Logs viewable in Vercel dashboard + usage_logs table

## 8. What Changes in the Codebase

### New files

| File | Purpose |
|------|---------|
| `middleware.ts` | Auth middleware protecting all routes |
| `app/login/page.tsx` | Login page with email input |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth config |
| `app/settings/page.tsx` | BYOK key management + usage |
| `app/api/settings/keys/route.ts` | CRUD for user API keys |
| `app/api/sessions/route.ts` | Session CRUD (replaces localStorage) |
| `app/api/sessions/[id]/route.ts` | Single session operations |
| `lib/model-router.ts` | Provider/model selection logic |
| `lib/db.ts` | Database client (Vercel Postgres / Drizzle) |
| `app/admin/page.tsx` | Admin dashboard (invite users, view usage) |
| `app/api/admin/*/route.ts` | Admin API routes (users, invites) |
| `lib/encryption.ts` | API key encrypt/decrypt (AES-256-GCM) |
| `lib/mcp-client.ts` | Shared per-request MCP client helper |
| `scripts/add-pilot-user.ts` | CLI script: `npx tsx scripts/add-pilot-user.ts user@example.com` |
| `Dockerfile` (in MCP gateway repo) | Railway deployment |

### Modified files

| File | Change |
|------|--------|
| `app/api/chat/route.ts` | Model router instead of hardcoded Anthropic; per-request MCP client; user from auth session |
| `app/api/explore/route.ts` | Per-request MCP client |
| `app/api/explore/[id]/route.ts` | Per-request MCP client |
| `app/builder/page.tsx` | Server-side session persistence via API routes instead of localStorage |
| `lib/logger.ts` | Write to database instead of JSONL files; include user_id, model, provider |
| `lib/session.ts` | New implementation calling API routes instead of localStorage |
| `package.json` | Add `@ai-sdk/openai`, `@ai-sdk/google`, `next-auth`, `@vercel/postgres`, `drizzle-orm` |
| `next.config.ts` | Any Vercel-specific config |

### Removed (replaced)

| Item | Replaced by |
|------|------------|
| localStorage sessions | PostgreSQL `sessions` table |
| JSONL log files | PostgreSQL `usage_logs` table |
| Hardcoded Anthropic provider | Model router with BYOK support |
| Singleton MCP client | Per-request MCP client |

## 9. Security Considerations

| Concern | Mitigation |
|---------|-----------|
| Unauthorized access | Email allowlist + auth middleware on all routes |
| API key exposure | Keys encrypted at rest, decrypted only server-side, never sent to client |
| Cross-user session access | All DB queries scoped by `user_id` from auth session |
| MCP gateway abuse | Gateway is stateless, no user data; rate limiting on Vercel API routes |
| Token consumption | Usage logged per user; admin can review in `usage_logs`; rate limits planned as follow-up |
| Magic link interception | Links are single-use, time-limited to 15 minutes (override NextAuth's 24h default via `maxAge` on the email provider) |
| CSRF on settings routes | NextAuth CSRF token required for all POST/PUT/DELETE to `/api/settings/keys` |
| Database transport encryption | Vercel Postgres (Neon) enforces SSL by default; verify `?sslmode=require` in connection string |

## 10. Admin Page (`/admin`)

Auth-protected page visible only to users with `role = 'admin'`.

### Features

- **Invited users:** Table of `allowed_emails` with email, invited date, and remove button
- **Active users:** Table of `auth_users` with email, name, role, last login, session count
- **Add invite:** Email input + "Invite" button (validates with Zod `z.string().email()`)
- **Usage overview:** Per-user token consumption (from `usage_logs`), total sessions, last active
- **Promote/demote:** Toggle user role between `admin` and `user`

### API routes

- `GET /api/admin/users` — list users + usage stats (admin only)
- `POST /api/admin/invites` — add email to allowlist (admin only)
- `DELETE /api/admin/invites/[email]` — remove from allowlist (admin only)
- `PATCH /api/admin/users/[id]` — update role (admin only)

### Security

All admin API routes enforce:
1. **Auth check:** request must have a valid NextAuth session
2. **Role check:** `session.user.role === 'admin'` — returns 403 otherwise
3. **Input validation:** Zod schema on all inputs (`z.string().email()` for invites)
4. **Parameterized queries:** Drizzle ORM — SQL injection structurally impossible
5. **CSRF:** NextAuth CSRF token on all mutating requests
6. **No XSS surface:** React auto-escapes all rendered text; no `dangerouslySetInnerHTML`

### New files

| File | Purpose |
|------|---------|
| `app/admin/page.tsx` | Admin dashboard UI |
| `app/api/admin/users/route.ts` | List users + stats |
| `app/api/admin/users/[id]/route.ts` | Update user role |
| `app/api/admin/invites/route.ts` | List + add invites |
| `app/api/admin/invites/[email]/route.ts` | Remove invite |

## 11. BYOK Key Security

### Threat model

Pilot users are trusted colleagues and partners. The encryption is defense-in-depth against accidental exposure (database dumps, logs), not against a determined attacker with full server access. For production, migrate to a proper secrets manager (AWS KMS, HashiCorp Vault).

### Key lifecycle

```
User types key in browser
  → HTTPS (Vercel enforces TLS)
    → POST /api/settings/keys (server-side only)
      → Zod validates key format
        → AES-256-GCM encrypt (HKDF-derived key from ENCRYPTION_SECRET, random 12-byte IV)
          → Ciphertext stored in user_api_keys table
            → On /api/chat: decrypt in memory → pass to AI SDK → discard after request
```

### Exposure points and mitigations

| Vector | Risk | Mitigation |
|--------|------|-----------|
| In transit | Low | HTTPS enforced by Vercel |
| In server memory | Low | Exists only during API request (~30-120s); Vercel functions are ephemeral |
| In database | Medium | AES-256-GCM encrypted; attacker needs both DB access AND ENCRYPTION_SECRET |
| Database backups | Medium | Backups contain ciphertext only, useless without ENCRYPTION_SECRET |
| ENCRYPTION_SECRET leak | High | Single point of failure. Vercel env vars encrypted at rest, decrypted only at function runtime, never in build logs. Limit Vercel team membership. |
| Server-side logging | Medium | `lib/model-router.ts` MUST NOT log the decrypted key. Code review enforced. Error handlers must sanitize stack traces. |
| Admin access | Medium | Vercel dashboard / Neon dashboard access limited to project admins |
| AI SDK misdirection | Low | SDK sends key only to hardcoded provider URLs (api.anthropic.com, etc.) |

### Implementation rules for `lib/encryption.ts`

- Algorithm: AES-256-GCM
- Key derivation: HKDF from `ENCRYPTION_SECRET` with per-provider salt
- IV: Random 12 bytes, stored as prefix to ciphertext
- No key logging: the `encrypt()` and `decrypt()` functions must never log inputs or outputs
- Key rotation: if `ENCRYPTION_SECRET` changes, existing keys become unreadable (documented for admins; users re-enter keys)

## 12. Vercel Configuration

### Function timeouts

The multi-step agent loop can take 30-120 seconds (15-25 tool calls). Vercel's default function timeout is 10s (Free) / 60s (Pro). **A Vercel Pro plan is required** for the pilot.

Set `maxDuration` on the streaming API routes:

```typescript
// app/api/chat/route.ts
export const maxDuration = 300; // 5 minutes — streaming responses exempt from timeout
                                // once the first byte is sent, but we need headroom
                                // for the initial MCP connection + first LLM call
```

Vercel supports streaming responses (`toUIMessageStreamResponse()` returns SSE) which keep the connection alive. The `maxDuration` primarily covers the time before the first byte is sent.

### Semantic search index

Vercel's filesystem is read-only at runtime. The semantic search index (`models/dataflow-index.json`, ~1MB) must be built at **build time** and bundled with the deployment:

- Add `npm run build-index` to the Vercel build command: `npm run build-index && npm run build`
- This requires the MCP gateway to be running during build (Railway must be deployed first)
- Alternatively, commit the pre-built index to the repo (it's only 1MB) and rebuild manually when dataflows change

## 11. Model Compatibility Notes

The system prompt and agent behavior were tuned for Claude. When using Gemini 3 Flash as the free-tier default:

- **Prompt caching:** The `providerOptions.anthropic.cacheControl` block is provider-specific — it will be ignored by Gemini (harmless). The `lib/model-router.ts` should only include provider-specific options for the active provider.
- **Tool-use protocol:** Gemini's tool-calling behavior may differ from Claude's. The dimension pinning rule, pacing rule, and map syntax instructions in the system prompt are model-agnostic, but their effectiveness may vary. Plan for A/B testing during the pilot.
- **Step budget:** The nudge-at-18 / limit-25 step budget may need different thresholds for Gemini. Start with the same values and adjust based on pilot feedback.
- **Quality expectations:** The free tier is explicitly "good enough" — BYOK users get premium models. The settings page should note this: "Free tier uses Gemini 3 Flash. For best results with complex dashboards, add your own API key."

## 12. Local Development Setup

After the migration, local development requires:

```bash
# .env.local additions:
DATABASE_URL=postgresql://...        # Local Postgres or Neon dev branch
NEXTAUTH_SECRET=dev-secret-change-me
NEXTAUTH_URL=http://localhost:3000
ENCRYPTION_SECRET=dev-encryption-key
GOOGLE_AI_API_KEY=...                # For testing free tier locally
MCP_GATEWAY_URL=http://localhost:8000/mcp  # Local MCP gateway (unchanged)

# For magic links in development:
# NextAuth can log the magic link URL to the console instead of sending email.
# Set EMAIL_SERVER to a dummy value and check the server console for the link.
```

Running locally:
```bash
# Terminal 1: MCP gateway
cd ../MCP/sdmx-mcp-gateway && uv run python main_server.py --transport streamable-http --host 0.0.0.0 --port 8000

# Terminal 2: Next.js
cd dashboarder && npm run dev
```

## 13. Monitoring

For the pilot:
- **Vercel dashboard:** Function invocations, errors, latency — check daily
- **Railway dashboard:** MCP gateway uptime, request volume
- **`usage_logs` table:** Weekly query for per-user token consumption, error rates, session counts
- **Alerting:** Not automated for pilot — admin checks dashboards manually. Consider adding a Vercel cron job that emails a daily summary if usage exceeds thresholds.

## 14. Out of Scope for Pilot

- Rate limiting (monitor usage manually, add limits if needed)
- OAuth providers (can add Google/GitHub later alongside magic links)
- Public dashboard gallery (sharing requires visibility model)
- Mobile responsive layout
- Automated CI/CD testing pipeline
- Semantic search index auto-rebuild (manual `npm run build-index` for now)
