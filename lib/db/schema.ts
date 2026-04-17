import {
  pgTable,
  text,
  timestamp,
  integer,
  serial,
  jsonb,
  boolean,
  index,
  primaryKey,
  numeric,
} from "drizzle-orm/pg-core";

// ---------------------------------------------------------------------------
// auth_users
// ---------------------------------------------------------------------------
export const authUsers = pgTable("auth_users", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID()),
  email: text("email").unique().notNull(),
  name: text("name"),
  emailVerified: timestamp("emailVerified"),
  image: text("image"),
  role: text("role").notNull().default("user"),
  created_at: timestamp("created_at").defaultNow(),
  // Password credentials (optional — users can also sign in via magic link)
  password_hash: text("password_hash"),
  failed_attempts: integer("failed_attempts").notNull().default(0),
  locked_until: timestamp("locked_until"),
});

// ---------------------------------------------------------------------------
// auth_events  (append-only audit log for auth-relevant actions)
// ---------------------------------------------------------------------------
export const authEvents = pgTable(
  "auth_events",
  {
    id: serial("id").primaryKey(),
    // user_id may be null for failed attempts against non-existent users
    user_id: text("user_id").references(() => authUsers.id),
    // email is always captured so we can trace activity by identifier
    email: text("email").notNull(),
    // event_type: password_set | password_cleared | login_success |
    // login_failure | account_locked | password_self_change
    event_type: text("event_type").notNull(),
    // Who performed the action (admin for set/clear, user for self-change / login)
    actor_user_id: text("actor_user_id").references(() => authUsers.id),
    ip: text("ip"),
    metadata: jsonb("metadata"),
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => [index("auth_events_email_created_idx").on(table.email, table.created_at)],
);

// ---------------------------------------------------------------------------
// auth_accounts  (NextAuth OAuth accounts — future use)
// ---------------------------------------------------------------------------
export const authAccounts = pgTable("auth_accounts", {
  id: text("id").primaryKey(),
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

// ---------------------------------------------------------------------------
// auth_verification_tokens  (NextAuth magic-link tokens)
// ---------------------------------------------------------------------------
export const authVerificationTokens = pgTable(
  "auth_verification_tokens",
  {
    identifier: text("identifier").notNull(),
    token: text("token").notNull().unique(),
    expires: timestamp("expires").notNull(),
  },
  (table) => [primaryKey({ columns: [table.identifier, table.token] })],
);

// ---------------------------------------------------------------------------
// allowed_emails  (invite allowlist)
// ---------------------------------------------------------------------------
export const allowedEmails = pgTable("allowed_emails", {
  email: text("email").primaryKey(),
  invited_by: text("invited_by").references(() => authUsers.id),
  created_at: timestamp("created_at").defaultNow(),
  invite_email_sent: boolean("invite_email_sent").default(false),
});

// ---------------------------------------------------------------------------
// dashboard_sessions
// ---------------------------------------------------------------------------
export const dashboardSessions = pgTable(
  "dashboard_sessions",
  {
    id: text("id")
      .primaryKey()
      .$defaultFn(() => crypto.randomUUID()),
    user_id: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    title: text("title").notNull().default("Untitled"),
    messages: jsonb("messages").notNull().default([]),
    config_history: jsonb("config_history").notNull().default([]),
    config_pointer: integer("config_pointer").notNull().default(-1),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
    deleted_at: timestamp("deleted_at"),
    public_title: text("public_title"),
    public_description: text("public_description"),
    author_display_name: text("author_display_name"),
    published_at: timestamp("published_at"),
  },
  (table) => [
    index("sessions_user_updated_idx").on(table.user_id, table.updated_at),
    index("sessions_published_idx").on(table.published_at),
  ],
);

// ---------------------------------------------------------------------------
// usage_logs
// ---------------------------------------------------------------------------
export const usageLogs = pgTable(
  "usage_logs",
  {
    id: serial("id").primaryKey(),
    user_id: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    session_id: text("session_id").references(() => dashboardSessions.id),
    request_id: text("request_id").notNull(),
    user_message: text("user_message"),
    ai_response: text("ai_response"),
    tool_calls: jsonb("tool_calls").default([]),
    dashboard_config_ids: text("dashboard_config_ids").array().default([]),
    errors: text("errors").array().default([]),
    input_tokens: integer("input_tokens"),
    output_tokens: integer("output_tokens"),
    duration_ms: integer("duration_ms"),
    step_count: integer("step_count"),
    model: text("model"),
    provider: text("provider"),
    // Which credential path served the request:
    //   "platform-direct"   — platform API key, direct provider SDK
    //   "platform-gateway"  — platform traffic routed through Vercel AI Gateway
    //   "byok"              — user's own API key
    key_source: text("key_source"),
    // Authoritative per-request USD cost from the AI Gateway. Null for
    // direct-SDK paths (where cost must be estimated from a pricing table).
    cost_usd: numeric("cost_usd", { precision: 12, scale: 6 }),
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => [
    index("logs_user_created_idx").on(table.user_id, table.created_at),
    // Supports the epoch-scoped aggregations in /api/admin/overview and
    // /api/admin/users (WHERE created_at >= USAGE_EPOCH). The compound index
    // above is leading on user_id, so Postgres can't use it for epoch-only
    // scans — this one covers that query shape.
    index("logs_created_at_idx").on(table.created_at),
  ],
);

// ---------------------------------------------------------------------------
// user_api_keys  (BYOK encrypted keys)
// ---------------------------------------------------------------------------
export const userApiKeys = pgTable(
  "user_api_keys",
  {
    user_id: text("user_id")
      .notNull()
      .references(() => authUsers.id),
    provider: text("provider").notNull(),
    encrypted_key: text("encrypted_key").notNull(),
    model_preference: text("model_preference"),
    created_at: timestamp("created_at").defaultNow(),
    updated_at: timestamp("updated_at").defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.user_id, table.provider] })],
);

// Magic link reference IDs — stores callback URLs server-side
// so they never appear in email links (defeats Outlook SafeLinks)
export const authMagicLinkRefs = pgTable("auth_magic_link_refs", {
  refId: text("ref_id").primaryKey(),
  callbackUrl: text("callback_url").notNull(),
  expiresAt: timestamp("expires_at").notNull(),
  usedAt: timestamp("used_at"),
});
