# Pilot Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the SPC Dashboard Builder for invite-only pilot testing with auth, database persistence, multi-model BYOK support, and clean Vercel + Railway hosting.

**Architecture:** Vercel hosts the Next.js app with Vercel Postgres (Neon) for state. Railway hosts the stateless MCP gateway. NextAuth with Resend magic links handles invite-only auth. Gemini 3 Flash is the free-tier default; users can BYOK their own Anthropic/OpenAI/Google keys.

**Tech Stack:** Next.js 16, Auth.js v5 (NextAuth), Drizzle ORM, Vercel Postgres (Neon), Resend, AI SDK v6 (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/google`), Docker (MCP gateway)

**Spec:** `docs/superpowers/specs/2026-03-25-pilot-deployment-design.md`

---

## File Map

### New files to create

| File | Responsibility |
|------|---------------|
| `lib/db/schema.ts` | Drizzle table definitions (all tables) |
| `lib/db/index.ts` | Database client singleton |
| `lib/db/migrate.ts` | Migration runner script |
| `drizzle.config.ts` | Drizzle Kit config |
| `lib/mcp-client.ts` | Shared per-request MCP client (replaces 3 singletons) |
| `lib/auth.ts` | NextAuth config (providers, adapter, callbacks) |
| `app/api/auth/[...nextauth]/route.ts` | NextAuth route handler |
| `middleware.ts` | Auth middleware (protects all routes) |
| `app/login/page.tsx` | Login page with email input |
| `lib/encryption.ts` | AES-256-GCM encrypt/decrypt for BYOK keys |
| `lib/model-router.ts` | Provider/model selection logic |
| `app/api/sessions/route.ts` | Session list + create (GET, POST) |
| `app/api/sessions/[id]/route.ts` | Session get + update + delete (GET, PUT, DELETE) |
| `app/settings/page.tsx` | BYOK key management page |
| `app/api/settings/keys/route.ts` | BYOK key CRUD |
| `app/admin/page.tsx` | Admin dashboard page |
| `app/api/admin/users/route.ts` | List users + stats |
| `app/api/admin/users/[id]/route.ts` | Update user role |
| `app/api/admin/invites/route.ts` | List + add invites |
| `app/api/admin/invites/[email]/route.ts` | Remove invite |
| `scripts/add-pilot-user.ts` | CLI to add pilot users |

### Files to modify

| File | Change |
|------|--------|
| `package.json` | Add deps: `next-auth`, `@auth/drizzle-adapter`, `drizzle-orm`, `@vercel/postgres`, `@ai-sdk/openai`, `@ai-sdk/google`, `resend` |
| `next.config.ts` | Add `maxDuration` export, update `serverExternalPackages` |
| `app/api/chat/route.ts` | Use model router, per-request MCP, auth session, DB logger |
| `app/api/explore/route.ts` | Use shared MCP client from `lib/mcp-client.ts` |
| `app/api/explore/[id]/route.ts` | Use shared MCP client from `lib/mcp-client.ts` |
| `lib/session.ts` | Rewrite: call `/api/sessions` instead of localStorage |
| `lib/logger.ts` | Rewrite: write to `usage_logs` table instead of JSONL |
| `app/builder/page.tsx` | Remove localStorage imports, use new session API |
| `app/page.tsx` | Use new session API for listing sessions |
| `app/dashboard/[id]/page.tsx` | Use new session API |
| `.env.example` | Add all new env vars |
| `.gitignore` | No changes needed (logs already gitignored) |

---

## Phase 1: Infrastructure

### Task 1: Install dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install all new packages**

```bash
cd /home/gvdr/reps/sdmx/dashboarder
npm install next-auth@latest @auth/drizzle-adapter drizzle-orm @vercel/postgres @ai-sdk/openai @ai-sdk/google resend
npm install -D drizzle-kit
```

- [ ] **Step 2: Verify installation**

Run: `npm ls next-auth drizzle-orm @vercel/postgres @ai-sdk/openai @ai-sdk/google resend`
Expected: All packages listed without errors.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: install pilot deployment dependencies (auth, db, multi-provider)"
```

---

### Task 2: Database schema with Drizzle ORM

**Files:**
- Create: `lib/db/schema.ts`
- Create: `lib/db/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Create the Drizzle schema**

Create `lib/db/schema.ts`:

```typescript
import {
  pgTable,
  text,
  timestamp,
  integer,
  serial,
  jsonb,
  primaryKey,
  index,
} from "drizzle-orm/pg-core";

// ── Auth tables (NextAuth-compatible) ──

export const authUsers = pgTable("auth_users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").notNull().unique(),
  name: text("name"),
  emailVerified: timestamp("emailVerified", { mode: "date" }),
  image: text("image"),
  role: text("role").notNull().default("user"),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const authAccounts = pgTable("auth_accounts", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  userId: text("userId")
    .notNull()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  type: text("type").notNull(),
  provider: text("provider").notNull(),
  providerAccountId: text("providerAccountId").notNull(),
  refresh_token: text("refresh_token"),
  access_token: text("access_token"),
  expires_at: integer("expires_at"),
  token_type: text("token_type"),
  scope: text("scope"),
  id_token: text("id_token"),
  session_state: text("session_state"),
});

export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: timestamp("expires", { mode: "date" }).notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// ── Application tables ──

export const allowedEmails = pgTable("allowed_emails", {
  email: text("email").primaryKey(),
  invitedBy: text("invited_by").references(() => authUsers.id),
  createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
});

export const dashboardSessions = pgTable(
  "dashboard_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    title: text("title").notNull().default("Untitled"),
    messages: jsonb("messages").notNull().default([]),
    configHistory: jsonb("config_history").notNull().default([]),
    configPointer: integer("config_pointer").notNull().default(-1),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
  },
  (table) => [index("idx_sessions_user").on(table.userId, table.updatedAt)],
);

export const usageLogs = pgTable(
  "usage_logs",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    sessionId: text("session_id").references(() => dashboardSessions.id),
    requestId: text("request_id").notNull(),
    userMessage: text("user_message"),
    aiResponse: text("ai_response"),
    toolCalls: jsonb("tool_calls").default([]),
    dashboardConfigIds: text("dashboard_config_ids")
      .array()
      .default([]),
    errors: text("errors").array().default([]),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    model: text("model"),
    provider: text("provider"),
    durationMs: integer("duration_ms"),
    stepCount: integer("step_count"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
  },
  (table) => [index("idx_usage_user").on(table.userId, table.createdAt)],
);

export const userApiKeys = pgTable(
  "user_api_keys",
  {
    userId: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    provider: text("provider").notNull(),
    encryptedKey: text("encrypted_key").notNull(),
    modelPreference: text("model_preference"),
    createdAt: timestamp("created_at", { mode: "date" }).defaultNow(),
    updatedAt: timestamp("updated_at", { mode: "date" }).defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId, table.provider] })],
);
```

- [ ] **Step 2: Create the database client**

Create `lib/db/index.ts`:

```typescript
import { drizzle } from "drizzle-orm/vercel-postgres";
import { sql } from "@vercel/postgres";
import * as schema from "./schema";

export const db = drizzle(sql, { schema });

export * from "./schema";
```

- [ ] **Step 3: Create Drizzle config**

Create `drizzle.config.ts`:

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./lib/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
```

- [ ] **Step 4: Update .env.example**

Replace `.env.example` content:

```bash
# LLM — platform key for free tier
GOOGLE_AI_API_KEY=

# LLM — optional, for development with Claude
ANTHROPIC_API_KEY=

# MCP Gateway
MCP_GATEWAY_URL=http://localhost:8000/mcp

# Database (Vercel Postgres / Neon)
DATABASE_URL=postgresql://...

# Auth (NextAuth)
NEXTAUTH_SECRET=generate-a-random-secret
NEXTAUTH_URL=http://localhost:3000

# Email (Resend)
RESEND_API_KEY=re_...
EMAIL_FROM=noreply@yourdomain.com

# BYOK key encryption
ENCRYPTION_SECRET=generate-a-random-32-char-secret
```

- [ ] **Step 5: Verify schema compiles**

Run: `npx drizzle-kit generate`
Expected: SQL migration files generated in `drizzle/` directory without errors.

- [ ] **Step 6: Commit**

```bash
git add lib/db/ drizzle.config.ts .env.example drizzle/
git commit -m "feat: add Drizzle ORM schema for auth, sessions, logs, and BYOK keys"
```

---

### Task 3: Shared per-request MCP client

**Files:**
- Create: `lib/mcp-client.ts`
- Modify: `app/api/chat/route.ts`
- Modify: `app/api/explore/route.ts`
- Modify: `app/api/explore/[id]/route.ts`

- [ ] **Step 1: Create the shared MCP client helper**

Create `lib/mcp-client.ts`:

```typescript
import { createMCPClient, type MCPClient } from "@ai-sdk/mcp";

const MCP_URL = process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp";

/**
 * Execute a function with a fresh MCP client.
 * Creates a new MCP session per request (safe for multi-user).
 * The client is automatically closed after the function completes.
 */
export async function withMCPClient<T>(
  fn: (client: MCPClient) => Promise<T>,
): Promise<T> {
  const client = await createMCPClient({
    transport: { type: "http", url: MCP_URL },
  });
  try {
    return await fn(client);
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * Call a single MCP tool and unwrap the response.
 * MCP tools return { content: [{ type: "text", text: "..." }] }.
 */
export async function callMcpTool(
  client: MCPClient,
  toolName: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  const tools = await client.tools();
  const tool = tools[toolName];
  if (!tool?.execute) {
    throw new Error("MCP tool not found: " + toolName);
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = await (tool.execute as any)(args, {
    toolCallId: "mcp-" + Date.now(),
    messages: [],
  });

  if (raw && typeof raw === "object" && "content" in raw) {
    const content = (raw as { content: Array<{ type: string; text: string }> })
      .content;
    if (content?.[0]?.type === "text" && content[0].text) {
      return JSON.parse(content[0].text);
    }
  }
  return raw;
}
```

- [ ] **Step 2: Update `app/api/chat/route.ts` to use per-request MCP client**

Remove the singleton `mcpClientPromise` / `getMCPClient()` block (lines 21-36). Replace the MCP usage in the POST handler:

In the POST handler, replace:
```typescript
const mcpClient = await getMCPClient();
const mcpTools = await mcpClient.tools();
```
with:
```typescript
const mcpClient = await createMCPClient({
  transport: { type: "http", url: process.env.MCP_GATEWAY_URL || "http://localhost:8000/mcp" },
});
const mcpTools = await mcpClient.tools();
```

And add cleanup in a `finally` block after returning the stream:
```typescript
// After the streamText result is returned, the client stays open for the stream duration.
// Cleanup happens when the stream ends via onFinish.
```

Note: For the chat route, we can't close the client immediately because `streamText` uses MCP tools during streaming. The client must stay alive for the duration of the stream. We'll handle this by creating the client at request start and relying on Vercel's function lifecycle to clean up. This is acceptable because each Vercel function invocation is isolated.

- [ ] **Step 3: Update `app/api/explore/route.ts`**

Replace the singleton `getMCPClient()` and `callMcpTool()` functions with imports from `lib/mcp-client.ts`:

```typescript
import { withMCPClient, callMcpTool } from "@/lib/mcp-client";
```

Wrap all MCP calls with `withMCPClient`:

```typescript
// Example: listing dataflows
const allDataflows = await withMCPClient(async (client) => {
  const result: unknown[] = [];
  let offset = 0;
  let hasMore = true;
  while (hasMore) {
    const page = (await callMcpTool(client, "list_dataflows", { limit: 50, offset })) as {
      dataflows: unknown[];
      pagination: { has_more: boolean };
    };
    result.push(...page.dataflows);
    hasMore = page.pagination.has_more;
    offset += 50;
  }
  return result;
});
```

- [ ] **Step 4: Update `app/api/explore/[id]/route.ts`**

Same pattern — replace singleton with `withMCPClient` + `callMcpTool` imports.

- [ ] **Step 5: Verify the app builds**

Run: `npx next build 2>&1 | tail -15`
Expected: Build succeeds, all routes listed.

- [ ] **Step 6: Commit**

```bash
git add lib/mcp-client.ts app/api/chat/route.ts app/api/explore/route.ts app/api/explore/\[id\]/route.ts
git commit -m "feat: shared per-request MCP client (fix multi-user singleton bug)"
```

---

### Task 4: Vercel configuration

**Files:**
- Modify: `next.config.ts`
- Modify: `app/api/chat/route.ts` (add maxDuration)

- [ ] **Step 1: Add maxDuration to chat route**

Add at the top of `app/api/chat/route.ts`, after imports:

```typescript
export const maxDuration = 300;
```

- [ ] **Step 2: Update next.config.ts**

```typescript
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: [
    "@ai-sdk/mcp",
    "onnxruntime-node",
    "@huggingface/transformers",
  ],
};

export default nextConfig;
```

(No changes needed — the existing config is already correct for Vercel.)

- [ ] **Step 3: Commit**

```bash
git add app/api/chat/route.ts next.config.ts
git commit -m "feat: add maxDuration for Vercel Pro streaming support"
```

---

## Phase 2: Authentication

### Task 5: NextAuth configuration

**Files:**
- Create: `lib/auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`

- [ ] **Step 1: Create auth configuration**

Create `lib/auth.ts`:

```typescript
import NextAuth from "next-auth";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import Resend from "next-auth/providers/resend";
import { db } from "@/lib/db";
import {
  authUsers,
  authAccounts,
  authVerificationTokens,
  allowedEmails,
} from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    verificationTokensTable: authVerificationTokens,
  }),
  session: { strategy: "jwt" },
  providers: [
    Resend({
      apiKey: process.env.RESEND_API_KEY,
      from: process.env.EMAIL_FROM || "noreply@example.com",
      maxAge: 15 * 60, // 15 minutes — shorter than default 24h
    }),
  ],
  pages: {
    signIn: "/login",
    verifyRequest: "/login?verify=1",
  },
  callbacks: {
    async signIn({ user }) {
      // Check if user's email is in the allowlist
      if (!user.email) return false;
      const allowed = await db
        .select()
        .from(allowedEmails)
        .where(eq(allowedEmails.email, user.email))
        .limit(1);
      return allowed.length > 0;
    },
    async jwt({ token, user }) {
      if (user) {
        // Fetch role from the database
        const dbUser = await db
          .select({ role: authUsers.role })
          .from(authUsers)
          .where(eq(authUsers.id, user.id!))
          .limit(1);
        token.role = dbUser[0]?.role || "user";
        token.userId = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        session.user.id = token.userId as string;
        (session.user as { role?: string }).role = token.role as string;
      }
      return session;
    },
  },
});
```

- [ ] **Step 2: Create the route handler**

Create `app/api/auth/[...nextauth]/route.ts`:

```typescript
import { handlers } from "@/lib/auth";

export const { GET, POST } = handlers;
```

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -15`
Expected: Build succeeds (auth routes may warn about missing env vars in build — that's OK).

- [ ] **Step 4: Commit**

```bash
git add lib/auth.ts app/api/auth/
git commit -m "feat: add NextAuth with Resend magic links + allowlist"
```

---

### Task 6: Auth middleware

**Files:**
- Create: `middleware.ts` (project root)

- [ ] **Step 1: Create middleware**

Create `middleware.ts` at the project root:

```typescript
export { auth as middleware } from "@/lib/auth";

export const config = {
  matcher: [
    /*
     * Match all routes except:
     * - api/auth (NextAuth endpoints)
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public files
     */
    "/((?!api/auth|_next/static|_next/image|favicon.ico|models/).*)",
  ],
};
```

Note: This uses NextAuth's built-in middleware export which redirects unauthenticated users to the `signIn` page configured in `lib/auth.ts` (`/login`).

- [ ] **Step 2: Verify build**

Run: `npx next build 2>&1 | tail -15`
Expected: Build succeeds with middleware listed.

- [ ] **Step 3: Commit**

```bash
git add middleware.ts
git commit -m "feat: add auth middleware protecting all routes"
```

---

### Task 7: Login page

**Files:**
- Create: `app/login/page.tsx`

- [ ] **Step 1: Create login page**

Create `app/login/page.tsx`:

```typescript
"use client";

import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const searchParams = useSearchParams();
  const isVerify = searchParams.get("verify") === "1";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || loading) return;

    setLoading(true);
    setError(null);

    try {
      const result = await signIn("resend", {
        email: email.trim(),
        redirect: false,
      });

      if (result?.error) {
        if (result.error === "AccessDenied") {
          setError(
            "This email is not on the invite list. Contact the admin for access.",
          );
        } else {
          setError("Failed to send magic link. Please try again.");
        }
      } else {
        setSent(true);
      }
    } catch {
      setError("Something went wrong. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <div className="ocean-gradient mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-[var(--radius-lg)]">
            <svg
              className="h-6 w-6 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5"
              />
            </svg>
          </div>
          <h1 className="font-[family-name:var(--font-manrope)] text-2xl font-bold tracking-tight text-primary">
            SPC Dashboard Builder
          </h1>
          <p className="mt-1 text-sm text-on-surface-variant">
            Sign in to build Pacific data dashboards
          </p>
        </div>

        {isVerify || sent ? (
          <div className="rounded-[var(--radius-xl)] bg-surface-card p-8 text-center shadow-ambient">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-secondary/10">
              <svg
                className="h-6 w-6 text-secondary"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M21.75 6.75v10.5a2.25 2.25 0 01-2.25 2.25h-15a2.25 2.25 0 01-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0019.5 4.5h-15a2.25 2.25 0 00-2.25 2.25m19.5 0v.243a2.25 2.25 0 01-1.07 1.916l-7.5 4.615a2.25 2.25 0 01-2.36 0L3.32 8.91a2.25 2.25 0 01-1.07-1.916V6.75"
                />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-on-surface">
              Check your email
            </h2>
            <p className="mt-2 text-sm text-on-surface-variant">
              We sent a magic link to your email. Click the link to sign in.
              The link expires in 15 minutes.
            </p>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="rounded-[var(--radius-xl)] bg-surface-card p-8 shadow-ambient"
          >
            <label className="type-label-md mb-2 block text-on-tertiary-fixed-variant">
              Email address
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              required
              className="focus-architectural ghost-border mb-4 w-full rounded-[var(--radius-xl)] bg-surface px-4 py-3 text-sm text-on-surface placeholder:text-on-surface-variant/50"
              disabled={loading}
            />
            {error && (
              <p className="mb-4 text-xs text-red-600">{error}</p>
            )}
            <button
              type="submit"
              disabled={loading || !email.trim()}
              className="ocean-gradient w-full rounded-full py-3 text-sm font-semibold text-white shadow-lg shadow-primary/20 transition-transform hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50"
            >
              {loading ? "Sending..." : "Send magic link"}
            </button>
            <p className="mt-4 text-center text-xs text-on-surface-variant">
              Invite-only access. Contact the admin if you need an invitation.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/login/
git commit -m "feat: add login page with magic link flow"
```

---

## Phase 3: Sessions + Logging

### Task 8: Session API routes

**Files:**
- Create: `app/api/sessions/route.ts`
- Create: `app/api/sessions/[id]/route.ts`

- [ ] **Step 1: Create session list + create route**

Create `app/api/sessions/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";
import { eq, desc } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sessions = await db
    .select({
      id: dashboardSessions.id,
      title: dashboardSessions.title,
      updatedAt: dashboardSessions.updatedAt,
    })
    .from(dashboardSessions)
    .where(eq(dashboardSessions.userId, session.user.id))
    .orderBy(desc(dashboardSessions.updatedAt))
    .limit(20);

  return Response.json({ sessions });
}

const createSchema = z.object({
  id: z.string().optional(),
  title: z.string().optional(),
  messages: z.unknown().optional(),
  configHistory: z.unknown().optional(),
  configPointer: z.number().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = createSchema.parse(await req.json());

  const [created] = await db
    .insert(dashboardSessions)
    .values({
      id: body.id || crypto.randomUUID(),
      userId: session.user.id,
      title: body.title || "Untitled",
      messages: body.messages || [],
      configHistory: body.configHistory || [],
      configPointer: body.configPointer ?? -1,
    })
    .returning({ id: dashboardSessions.id });

  return Response.json({ id: created.id }, { status: 201 });
}
```

- [ ] **Step 2: Create single session route**

Create `app/api/sessions/[id]/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, dashboardSessions } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  const [found] = await db
    .select()
    .from(dashboardSessions)
    .where(
      and(
        eq(dashboardSessions.id, id),
        eq(dashboardSessions.userId, session.user.id),
      ),
    )
    .limit(1);

  if (!found) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return Response.json(found);
}

const updateSchema = z.object({
  title: z.string().optional(),
  messages: z.unknown().optional(),
  configHistory: z.unknown().optional(),
  configPointer: z.number().optional(),
});

export async function PUT(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const body = updateSchema.parse(await req.json());

  const values: Record<string, unknown> = { updatedAt: new Date() };
  if (body.title !== undefined) values.title = body.title;
  if (body.messages !== undefined) values.messages = body.messages;
  if (body.configHistory !== undefined) values.configHistory = body.configHistory;
  if (body.configPointer !== undefined) values.configPointer = body.configPointer;

  await db
    .update(dashboardSessions)
    .set(values)
    .where(
      and(
        eq(dashboardSessions.id, id),
        eq(dashboardSessions.userId, session.user.id),
      ),
    );

  return Response.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;

  await db
    .delete(dashboardSessions)
    .where(
      and(
        eq(dashboardSessions.id, id),
        eq(dashboardSessions.userId, session.user.id),
      ),
    );

  return Response.json({ ok: true });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/sessions/
git commit -m "feat: add session CRUD API routes (database-backed)"
```

---

### Task 9: Rewrite session client library

**Files:**
- Modify: `lib/session.ts`

- [ ] **Step 1: Rewrite `lib/session.ts` to use API routes**

Replace the entire file. Keep the same exported interface (`SessionData`, `SessionSummary`, `generateSessionId`, `saveSession`, `loadSession`, `listSessions`, `deleteSession`) but call `/api/sessions` instead of localStorage:

```typescript
import type { UIMessage } from "ai";
import type { SDMXDashboardConfig } from "./types";

export interface SessionData {
  sessionId: string;
  messages: UIMessage[];
  configHistory: SDMXDashboardConfig[];
  configPointer: number;
  title: string;
  updatedAt: string;
}

export interface SessionSummary {
  sessionId: string;
  title: string;
  updatedAt: string;
}

export function generateSessionId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function saveSession(data: SessionData): Promise<void> {
  try {
    // Try PUT (update existing), fall back to POST (create new)
    const res = await fetch("/api/sessions/" + data.sessionId, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.title,
        messages: data.messages,
        configHistory: data.configHistory,
        configPointer: data.configPointer,
      }),
    });

    if (res.status === 404) {
      // Session doesn't exist yet — create it
      await fetch("/api/sessions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: data.sessionId,
          title: data.title,
          messages: data.messages,
          configHistory: data.configHistory,
          configPointer: data.configPointer,
        }),
      });
    }
  } catch {
    // Silently fail — same behavior as localStorage version
  }
}

export async function loadSession(
  sessionId?: string,
): Promise<SessionData | null> {
  try {
    if (sessionId) {
      const res = await fetch("/api/sessions/" + sessionId);
      if (!res.ok) return null;
      const data = await res.json();
      return {
        sessionId: data.id,
        messages: data.messages || [],
        configHistory: data.configHistory || [],
        configPointer: data.configPointer ?? -1,
        title: data.title || "Untitled",
        updatedAt: data.updatedAt || new Date().toISOString(),
      };
    }

    // No specific session — return the most recent
    const res = await fetch("/api/sessions");
    if (!res.ok) return null;
    const { sessions } = await res.json();
    if (!sessions?.length) return null;

    // Load the most recent session's full data
    return loadSession(sessions[0].id);
  } catch {
    return null;
  }
}

export async function listSessions(): Promise<SessionSummary[]> {
  try {
    const res = await fetch("/api/sessions");
    if (!res.ok) return [];
    const { sessions } = await res.json();
    return (sessions || []).map(
      (s: { id: string; title: string; updatedAt: string }) => ({
        sessionId: s.id,
        title: s.title || "Untitled",
        updatedAt: s.updatedAt || "",
      }),
    );
  } catch {
    return [];
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  try {
    await fetch("/api/sessions/" + sessionId, { method: "DELETE" });
  } catch {
    // Silently fail
  }
}
```

Note: The interface is now async (`saveSession`, `loadSession`, `listSessions`, `deleteSession` return Promises). The `builder/page.tsx` calls these functions — it already uses `await` in some places but not all. The builder page will need updates in Task 10 to handle the async interface.

- [ ] **Step 2: Commit**

```bash
git add lib/session.ts
git commit -m "feat: rewrite session lib to use database API routes"
```

---

### Task 10: Update builder page for async sessions

**Files:**
- Modify: `app/builder/page.tsx`

- [ ] **Step 1: Update session operations to be async**

The main changes needed in `app/builder/page.tsx`:

1. The mount `useEffect` that calls `loadSession()` — this already uses `setSessionLoaded` after loading, but `loadSession` is now async. Wrap in an async IIFE.

2. `doSave()` — now needs to `await saveSession(data)`.

3. `handleLoadSession()` — `loadSession(targetId)` is now async.

4. `listSessions()` — now async, used in session menu `onClick`.

5. Remove the `getCurrentSessionId` import (no longer exists).

Key pattern: replace synchronous calls with async versions inside `useCallback` and `useEffect` hooks.

The session restore effect becomes:

```typescript
useEffect(() => {
  (async () => {
    const params = new URLSearchParams(window.location.search);
    const targetSession = params.get("session");
    const initialPrompt = params.get("prompt");
    const forceNew = params.get("new") === "1";

    if (targetSession || initialPrompt || forceNew) {
      window.history.replaceState({}, "", "/builder");
    }

    if (forceNew) {
      setSessionId(generateSessionId());
      setMessages([]);
      configHistory.restore([], -1);
      configJsonRef.current = "";
      setSessionLoaded(true);
      if (initialPrompt) {
        setTimeout(() => sendMessageRef.current({ text: initialPrompt }), 500);
      }
      return;
    }

    if (targetSession) {
      const saved = await loadSession(targetSession);
      if (saved) {
        setSessionId(saved.sessionId);
        setMessages(saved.messages);
        if (saved.configHistory.length > 0) {
          configHistory.restore(saved.configHistory, saved.configPointer);
        }
        setSessionLoaded(true);
        return;
      }
    }

    const saved = await loadSession();
    if (saved) {
      setSessionId(saved.sessionId);
      setMessages(saved.messages);
      if (saved.configHistory.length > 0) {
        configHistory.restore(saved.configHistory, saved.configPointer);
      }
    } else {
      setSessionId(generateSessionId());
    }
    setSessionLoaded(true);
  })();
}, []);
```

The `doSave` becomes:

```typescript
const doSave = useCallback(async () => {
  if (!sessionIdRef.current) return;
  setSaveState("saving");
  const { history, pointer } = configHistoryRef.current.snapshot();
  const currentConfig = configHistoryRef.current.current;
  await saveSession({
    sessionId: sessionIdRef.current,
    messages: messagesRef.current,
    configHistory: history,
    configPointer: pointer,
    title: currentConfig ? getDashboardTitle(currentConfig) : "Untitled",
    updatedAt: new Date().toISOString(),
  });
  setSaveState("saved");
  setTimeout(() => setSaveState("idle"), 2000);
}, []);
```

The session menu `onClick` becomes:

```typescript
onClick={async () => {
  setSessions(await listSessions());
  setSessionMenu((v) => !v);
}}
```

- [ ] **Step 2: Also update `app/page.tsx` and `app/dashboard/[id]/page.tsx`**

These pages call `listSessions()` and `loadSession()` — update them to handle the async interface the same way (wrap in async IIFE inside useEffect).

- [ ] **Step 3: Verify build**

Run: `npx next build 2>&1 | tail -15`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add app/builder/page.tsx app/page.tsx app/dashboard/
git commit -m "feat: update all pages for async database-backed sessions"
```

---

### Task 11: Rewrite logger to use database

**Files:**
- Modify: `lib/logger.ts`

- [ ] **Step 1: Rewrite logger to insert into usage_logs table**

Replace `lib/logger.ts`:

```typescript
import { db, usageLogs } from "@/lib/db";

export interface ChatLogEntry {
  userId: string;
  sessionId: string;
  requestId: string;
  userMessage: string;
  aiResponse: string;
  toolCalls: Array<{
    name: string;
    args: Record<string, unknown>;
    resultPreview: string;
    stepNumber: number;
  }>;
  dashboardConfigIds: string[];
  errors: string[];
  tokenUsage?: { input: number; output: number };
  model: string;
  provider: string;
  durationMs: number;
  stepCount: number;
}

function preview(value: unknown, maxLen = 300): string {
  const s = typeof value === "string" ? value : JSON.stringify(value);
  if (s.length <= maxLen) return s;
  return s.slice(0, maxLen) + "...";
}

export async function logChatEntry(entry: ChatLogEntry): Promise<void> {
  try {
    await db.insert(usageLogs).values({
      userId: entry.userId,
      sessionId: entry.sessionId || null,
      requestId: entry.requestId,
      userMessage: preview(entry.userMessage, 500),
      aiResponse: preview(entry.aiResponse, 1000),
      toolCalls: entry.toolCalls,
      dashboardConfigIds: entry.dashboardConfigIds,
      errors: entry.errors,
      inputTokens: entry.tokenUsage?.input,
      outputTokens: entry.tokenUsage?.output,
      model: entry.model,
      provider: entry.provider,
      durationMs: entry.durationMs,
      stepCount: entry.stepCount,
    });
  } catch (err) {
    console.warn("[logger] Failed to write log entry:", err);
  }
}

export function createRequestLogger(userId: string, sessionId: string) {
  const requestId =
    Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const startTime = Date.now();
  const toolCalls: ChatLogEntry["toolCalls"] = [];
  const dashboardConfigIds: string[] = [];
  const errors: string[] = [];
  let userMessage = "";
  let aiResponse = "";
  let stepCount = 0;
  let model = "unknown";
  let provider = "unknown";

  return {
    requestId,

    setUserMessage(msg: string) {
      userMessage = msg;
    },

    setModelInfo(m: string, p: string) {
      model = m;
      provider = p;
    },

    recordToolCall(
      name: string,
      args: Record<string, unknown>,
      result: unknown,
      step: number,
    ) {
      toolCalls.push({
        name,
        args: JSON.parse(preview(args, 500)),
        resultPreview: preview(result),
        stepNumber: step,
      });
      stepCount = Math.max(stepCount, step + 1);

      if (name === "update_dashboard") {
        const r = result as { dashboard?: { id?: string } } | null;
        if (r?.dashboard?.id) {
          dashboardConfigIds.push(r.dashboard.id);
        }
      }
    },

    recordError(error: string) {
      errors.push(error);
    },

    setAiResponse(text: string) {
      aiResponse = text;
    },

    async flush(
      tokenUsage?: { input: number; output: number },
    ): Promise<void> {
      await logChatEntry({
        userId,
        sessionId,
        requestId,
        userMessage,
        aiResponse,
        toolCalls,
        dashboardConfigIds,
        errors,
        tokenUsage,
        model,
        provider,
        durationMs: Date.now() - startTime,
        stepCount,
      });
    },
  };
}
```

- [ ] **Step 2: Update `app/api/chat/route.ts` to pass userId and model info to logger**

Change the logger creation line:

```typescript
// Before:
const logger = createRequestLogger(sessionId);

// After:
const logger = createRequestLogger(userId, sessionId);
```

And after the model is resolved, call:

```typescript
logger.setModelInfo("gemini-3-flash", "google"); // or whatever the model router returns
```

(This will be fully wired up in Phase 4 when we add the model router.)

- [ ] **Step 3: Commit**

```bash
git add lib/logger.ts app/api/chat/route.ts
git commit -m "feat: rewrite logger to insert into database usage_logs table"
```

---

## Phase 4: Model Routing

### Task 12: Encryption module

**Files:**
- Create: `lib/encryption.ts`

- [ ] **Step 1: Create encryption module**

Create `lib/encryption.ts`:

```typescript
import { createCipheriv, createDecipheriv, randomBytes, createHmac } from "node:crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

/**
 * Derive an encryption key from the master secret using HKDF-like approach.
 * Uses HMAC-SHA256 with a per-provider salt for domain separation.
 */
function deriveKey(provider: string): Buffer {
  const secret = process.env.ENCRYPTION_SECRET;
  if (!secret) {
    throw new Error("ENCRYPTION_SECRET environment variable is not set");
  }
  return createHmac("sha256", secret)
    .update("byok-" + provider)
    .digest();
}

/**
 * Encrypt a plaintext API key.
 * Returns a base64 string containing: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export function encryptApiKey(plaintext: string, provider: string): string {
  const key = deriveKey(provider);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();

  // Format: IV + ciphertext + tag
  return Buffer.concat([iv, encrypted, tag]).toString("base64");
}

/**
 * Decrypt an encrypted API key.
 * Expects a base64 string in the format: IV (12 bytes) + ciphertext + auth tag (16 bytes).
 */
export function decryptApiKey(encrypted: string, provider: string): string {
  const key = deriveKey(provider);
  const data = Buffer.from(encrypted, "base64");

  const iv = data.subarray(0, IV_LENGTH);
  const tag = data.subarray(data.length - TAG_LENGTH);
  const ciphertext = data.subarray(IV_LENGTH, data.length - TAG_LENGTH);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return decipher.update(ciphertext) + decipher.final("utf8");
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/encryption.ts
git commit -m "feat: add AES-256-GCM encryption for BYOK API keys"
```

---

### Task 13: Model router

**Files:**
- Create: `lib/model-router.ts`

- [ ] **Step 1: Create the model router**

Create `lib/model-router.ts`:

```typescript
import { anthropic } from "@ai-sdk/anthropic";
import { google } from "@ai-sdk/google";
import { openai } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";
import { db, userApiKeys } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { decryptApiKey } from "@/lib/encryption";

interface ModelConfig {
  model: LanguageModel;
  modelId: string;
  providerId: string;
  providerOptions?: Record<string, unknown>;
}

const DEFAULT_MODELS: Record<string, string> = {
  anthropic: "claude-sonnet-4-6",
  openai: "gpt-4.1-mini",
  google: "gemini-3-flash",
};

/**
 * Get the AI model for a user.
 * If the user has a BYOK key, use their key + preferred model.
 * Otherwise, use the platform Gemini key (free tier).
 */
export async function getModelForUser(userId: string): Promise<ModelConfig> {
  // Check for BYOK keys (in preference order)
  const keys = await db
    .select()
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, userId));

  for (const key of keys) {
    try {
      const apiKey = decryptApiKey(key.encryptedKey, key.provider);
      const modelId = key.modelPreference || DEFAULT_MODELS[key.provider] || "";

      switch (key.provider) {
        case "anthropic": {
          const provider = createAnthropic({ apiKey });
          return {
            model: provider(modelId),
            modelId,
            providerId: "anthropic",
            providerOptions: {
              anthropic: { cacheControl: { type: "ephemeral" } },
            },
          };
        }
        case "openai": {
          const provider = createOpenAI({ apiKey });
          return {
            model: provider(modelId),
            modelId,
            providerId: "openai",
          };
        }
        case "google": {
          const provider = createGoogleGenerativeAI({ apiKey });
          return {
            model: provider(modelId),
            modelId,
            providerId: "google",
          };
        }
      }
    } catch {
      // Decryption failed or key invalid — skip to next
      continue;
    }
  }

  // No BYOK key — use platform free tier (Gemini 3 Flash)
  const platformKey = process.env.GOOGLE_AI_API_KEY;
  if (platformKey) {
    const provider = createGoogleGenerativeAI({ apiKey: platformKey });
    return {
      model: provider("gemini-3-flash"),
      modelId: "gemini-3-flash",
      providerId: "google",
    };
  }

  // Fallback: use Anthropic from env (for development)
  return {
    model: anthropic("claude-sonnet-4-6"),
    modelId: "claude-sonnet-4-6",
    providerId: "anthropic",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral" } },
    },
  };
}
```

- [ ] **Step 2: Update `app/api/chat/route.ts` to use the model router**

Replace the hardcoded model:

```typescript
// Before:
import { anthropic } from "@ai-sdk/anthropic";
// ...
const result = streamText({
  model: anthropic("claude-sonnet-4-6"),
  // ...
  providerOptions: {
    anthropic: { cacheControl: { type: "ephemeral" } },
  },

// After:
import { getModelForUser } from "@/lib/model-router";
// ...
const modelConfig = await getModelForUser(userId);
logger.setModelInfo(modelConfig.modelId, modelConfig.providerId);

const result = streamText({
  model: modelConfig.model,
  // ...
  providerOptions: modelConfig.providerOptions || {},
```

- [ ] **Step 3: Commit**

```bash
git add lib/model-router.ts app/api/chat/route.ts
git commit -m "feat: add model router with BYOK support (Gemini free tier default)"
```

---

### Task 14: Settings page + BYOK API routes

**Files:**
- Create: `app/settings/page.tsx`
- Create: `app/api/settings/keys/route.ts`

- [ ] **Step 1: Create BYOK key API route**

Create `app/api/settings/keys/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, userApiKeys } from "@/lib/db";
import { eq, and } from "drizzle-orm";
import { z } from "zod";
import { encryptApiKey } from "@/lib/encryption";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const keys = await db
    .select({
      provider: userApiKeys.provider,
      modelPreference: userApiKeys.modelPreference,
      updatedAt: userApiKeys.updatedAt,
    })
    .from(userApiKeys)
    .where(eq(userApiKeys.userId, session.user.id));

  return Response.json({ keys });
}

const upsertSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
  apiKey: z.string().min(1),
  modelPreference: z.string().optional(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = upsertSchema.parse(await req.json());
  const encrypted = encryptApiKey(body.apiKey, body.provider);

  await db
    .insert(userApiKeys)
    .values({
      userId: session.user.id,
      provider: body.provider,
      encryptedKey: encrypted,
      modelPreference: body.modelPreference || null,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [userApiKeys.userId, userApiKeys.provider],
      set: {
        encryptedKey: encrypted,
        modelPreference: body.modelPreference || null,
        updatedAt: new Date(),
      },
    });

  return Response.json({ ok: true });
}

const deleteSchema = z.object({
  provider: z.enum(["anthropic", "openai", "google"]),
});

export async function DELETE(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = deleteSchema.parse(await req.json());

  await db
    .delete(userApiKeys)
    .where(
      and(
        eq(userApiKeys.userId, session.user.id),
        eq(userApiKeys.provider, body.provider),
      ),
    );

  return Response.json({ ok: true });
}
```

- [ ] **Step 2: Create settings page**

Create `app/settings/page.tsx` — a client component with:
- Three provider sections (Anthropic, OpenAI, Google)
- Each shows: status badge (configured/not), model dropdown, key input, save/delete buttons
- Fetches current key status from `GET /api/settings/keys`
- Submits new keys via `POST /api/settings/keys`
- Deletes keys via `DELETE /api/settings/keys`
- Note at top: "Free tier uses Gemini 3 Flash. Add your own API key for premium models."
- Link back to builder in the header

(Full component code follows the Oceanic design system — glass header, ghost-border cards, ocean-gradient buttons. Similar pattern to the admin page in Task 16.)

- [ ] **Step 3: Commit**

```bash
git add app/settings/ app/api/settings/
git commit -m "feat: add settings page with BYOK key management"
```

---

## Phase 5: Admin

### Task 15: Admin API routes

**Files:**
- Create: `app/api/admin/users/route.ts`
- Create: `app/api/admin/users/[id]/route.ts`
- Create: `app/api/admin/invites/route.ts`
- Create: `app/api/admin/invites/[email]/route.ts`

- [ ] **Step 1: Create admin auth guard helper**

Add to each admin route file:

```typescript
import { auth } from "@/lib/auth";

async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id) {
    return { error: "Unauthorized", status: 401 };
  }
  if ((session.user as { role?: string }).role !== "admin") {
    return { error: "Forbidden", status: 403 };
  }
  return { userId: session.user.id };
}
```

- [ ] **Step 2: Create users list route**

Create `app/api/admin/users/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, authUsers, dashboardSessions, usageLogs } from "@/lib/db";
import { eq, count, sum, desc } from "drizzle-orm";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const users = await db
    .select({
      id: authUsers.id,
      email: authUsers.email,
      name: authUsers.name,
      role: authUsers.role,
      createdAt: authUsers.createdAt,
    })
    .from(authUsers)
    .orderBy(desc(authUsers.createdAt));

  // Get usage stats per user
  const stats = await db
    .select({
      userId: usageLogs.userId,
      requestCount: count(usageLogs.id),
      totalInputTokens: sum(usageLogs.inputTokens),
      totalOutputTokens: sum(usageLogs.outputTokens),
    })
    .from(usageLogs)
    .groupBy(usageLogs.userId);

  const sessionCounts = await db
    .select({
      userId: dashboardSessions.userId,
      sessionCount: count(dashboardSessions.id),
    })
    .from(dashboardSessions)
    .groupBy(dashboardSessions.userId);

  const statsMap = new Map(stats.map((s) => [s.userId, s]));
  const sessionMap = new Map(sessionCounts.map((s) => [s.userId, s]));

  const enriched = users.map((u) => ({
    ...u,
    requestCount: statsMap.get(u.id)?.requestCount || 0,
    totalInputTokens: statsMap.get(u.id)?.totalInputTokens || 0,
    totalOutputTokens: statsMap.get(u.id)?.totalOutputTokens || 0,
    sessionCount: sessionMap.get(u.id)?.sessionCount || 0,
  }));

  return Response.json({ users: enriched });
}
```

- [ ] **Step 3: Create user role update route**

Create `app/api/admin/users/[id]/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, authUsers } from "@/lib/db";
import { eq } from "drizzle-orm";
import { z } from "zod";

const updateSchema = z.object({
  role: z.enum(["admin", "user"]),
});

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = await params;
  const body = updateSchema.parse(await req.json());

  await db
    .update(authUsers)
    .set({ role: body.role })
    .where(eq(authUsers.id, id));

  return Response.json({ ok: true });
}
```

- [ ] **Step 4: Create invites routes**

Create `app/api/admin/invites/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, allowedEmails } from "@/lib/db";
import { desc } from "drizzle-orm";
import { z } from "zod";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const invites = await db
    .select()
    .from(allowedEmails)
    .orderBy(desc(allowedEmails.createdAt));

  return Response.json({ invites });
}

const createSchema = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const body = createSchema.parse(await req.json());

  await db
    .insert(allowedEmails)
    .values({
      email: body.email.toLowerCase(),
      invitedBy: session.user.id,
    })
    .onConflictDoNothing();

  return Response.json({ ok: true }, { status: 201 });
}
```

Create `app/api/admin/invites/[email]/route.ts`:

```typescript
import { auth } from "@/lib/auth";
import { db, allowedEmails } from "@/lib/db";
import { eq } from "drizzle-orm";

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ email: string }> },
) {
  const session = await auth();
  if (!session?.user?.id || (session.user as { role?: string }).role !== "admin") {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }

  const { email } = await params;

  await db
    .delete(allowedEmails)
    .where(eq(allowedEmails.email, decodeURIComponent(email).toLowerCase()));

  return Response.json({ ok: true });
}
```

- [ ] **Step 5: Commit**

```bash
git add app/api/admin/
git commit -m "feat: add admin API routes (users, invites, role management)"
```

---

### Task 16: Admin page

**Files:**
- Create: `app/admin/page.tsx`

- [ ] **Step 1: Create admin dashboard page**

Create `app/admin/page.tsx` — a client component with:
- Glass header with "Admin" title and back link
- "Invite User" section: email input + invite button
- "Invited Emails" table: email, date, remove button
- "Active Users" table: email, role, sessions, tokens used, role toggle
- All data fetched from admin API routes
- Oceanic design system styling (ghost-border cards, shadow-ambient, type-label-md headers)
- Role check: if user is not admin, show "Access denied" message

(Full component code is ~200 lines following the same patterns as other pages in the app.)

- [ ] **Step 2: Commit**

```bash
git add app/admin/
git commit -m "feat: add admin dashboard page (invite users, view usage)"
```

---

### Task 17: Add pilot user CLI script

**Files:**
- Create: `scripts/add-pilot-user.ts`

- [ ] **Step 1: Create the script**

Create `scripts/add-pilot-user.ts`:

```typescript
#!/usr/bin/env npx tsx
/**
 * Add a pilot user to the allowlist.
 * Usage: npx tsx scripts/add-pilot-user.ts user@example.com [--admin]
 */

import { sql } from "@vercel/postgres";

async function main() {
  const email = process.argv[2];
  const isAdmin = process.argv.includes("--admin");

  if (!email || !email.includes("@")) {
    console.error("Usage: npx tsx scripts/add-pilot-user.ts email@example.com [--admin]");
    process.exit(1);
  }

  const normalizedEmail = email.toLowerCase();

  // Add to allowlist
  await sql`
    INSERT INTO allowed_emails (email)
    VALUES (${normalizedEmail})
    ON CONFLICT DO NOTHING
  `;
  console.log("Added to allowlist: " + normalizedEmail);

  // If admin flag, also create the user with admin role
  if (isAdmin) {
    await sql`
      INSERT INTO auth_users (id, email, role)
      VALUES (gen_random_uuid()::text, ${normalizedEmail}, 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin'
    `;
    console.log("Set as admin: " + normalizedEmail);
  }

  console.log("Done.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err.message);
  process.exit(1);
});
```

- [ ] **Step 2: Commit**

```bash
git add scripts/add-pilot-user.ts
git commit -m "feat: add CLI script for inviting pilot users"
```

---

## Phase 6: MCP Gateway Containerization

### Task 18: Dockerfile for Railway

**Files:**
- Create: `/home/gvdr/reps/sdmx/MCP/sdmx-mcp-gateway/Dockerfile`

- [ ] **Step 1: Create Dockerfile**

Create `Dockerfile` in the MCP gateway repo:

```dockerfile
FROM python:3.12-slim

WORKDIR /app

# Install uv
RUN pip install --no-cache-dir uv

# Copy dependency files first (for layer caching)
COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

# Copy application code
COPY . .

EXPOSE 8000

CMD ["uv", "run", "python", "main_server.py", "--transport", "streamable-http", "--host", "0.0.0.0", "--port", "8000"]
```

- [ ] **Step 2: Create .dockerignore**

Create `.dockerignore` in the MCP gateway repo:

```
.git
.ruff_cache
__pycache__
*.pyc
.pytest_cache
.venv
```

- [ ] **Step 3: Verify Docker build locally (optional)**

Run: `cd /home/gvdr/reps/sdmx/MCP/sdmx-mcp-gateway && docker build -t sdmx-mcp-gateway .`
Expected: Image builds successfully.

- [ ] **Step 4: Commit**

```bash
cd /home/gvdr/reps/sdmx/MCP/sdmx-mcp-gateway
git add Dockerfile .dockerignore
git commit -m "feat: add Dockerfile for Railway deployment"
```

---

## Phase 7: Final Integration

### Task 19: Wire auth into chat route

**Files:**
- Modify: `app/api/chat/route.ts`

- [ ] **Step 1: Add auth check and user context to POST handler**

Add at the top of the POST handler:

```typescript
import { auth } from "@/lib/auth";

export async function POST(req: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }
  const userId = session.user.id;
  const sessionId = req.headers.get("x-session-id") || "anonymous";
  const logger = createRequestLogger(userId, sessionId);
  // ... rest of handler uses userId and model router
```

- [ ] **Step 2: Add navigation links to settings and admin**

Add links in `app/builder/page.tsx` header (session picker area) — a gear icon linking to `/settings`, and if admin, a shield icon linking to `/admin`.

- [ ] **Step 3: Full integration test**

Run: `npx next build 2>&1 | tail -15`
Expected: Build succeeds with all routes:
```
┌ ○ /
├ ○ /_not-found
├ ƒ /api/auth/[...nextauth]
├ ƒ /api/chat
├ ƒ /api/explore
├ ƒ /api/explore/[id]
├ ƒ /api/admin/users
├ ƒ /api/admin/users/[id]
├ ƒ /api/admin/invites
├ ƒ /api/admin/invites/[email]
├ ƒ /api/sessions
├ ƒ /api/sessions/[id]
├ ƒ /api/settings/keys
├ ○ /admin
├ ○ /builder
├ ○ /explore
├ ƒ /explore/[id]
├ ○ /login
├ ○ /settings
└ ƒ /dashboard/[id]
```

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete pilot deployment (auth, db sessions, model routing, admin)"
```

---

## Deployment Checklist

After all tasks are complete:

- [ ] Deploy MCP gateway to Railway (push to main, auto-deploy)
- [ ] Note the Railway URL
- [ ] Create Vercel Postgres database in Vercel dashboard
- [ ] Set all env vars in Vercel:
  - `GOOGLE_AI_API_KEY`, `MCP_GATEWAY_URL`, `DATABASE_URL`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `ENCRYPTION_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM`
- [ ] Push to main to trigger Vercel deploy
- [ ] Run migrations: `npx drizzle-kit push`
- [ ] Seed admin user: `npx tsx scripts/add-pilot-user.ts admin@spc.int --admin`
- [ ] Test: visit app URL → redirected to login → enter admin email → receive magic link → log in → see builder
- [ ] Test: create a dashboard → verify it saves to database
- [ ] Test: go to `/admin` → invite a pilot user
- [ ] Test: go to `/settings` → add BYOK Anthropic key → build a dashboard with Claude
