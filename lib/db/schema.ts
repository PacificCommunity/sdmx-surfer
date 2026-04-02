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
});

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
  },
  (table) => [index("sessions_user_updated_idx").on(table.user_id, table.updated_at)],
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
    created_at: timestamp("created_at").defaultNow(),
  },
  (table) => [index("logs_user_created_idx").on(table.user_id, table.created_at)],
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
