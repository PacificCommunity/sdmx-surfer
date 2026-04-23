import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import * as schema from "./schema";

// Neon HTTP driver: every query is a stateless HTTPS request to Neon's SQL
// proxy, so there are no long-lived TCP connections to leak. The previous
// @vercel/postgres setup used a pg-style Pool per Fluid Compute instance,
// which, under concurrent autosave load, drove Neon's pooler to 900+ open
// connections and produced 300-second function timeouts on PUTs that were
// waiting for a free connection.
//
// Tradeoff: drizzle-orm/neon-http does NOT support multi-statement
// transactions. The app has zero `db.transaction(...)` call sites today; if
// that changes, switch affected code paths to `drizzle-orm/neon-serverless`
// (WebSocket-pooled) for just those paths rather than regressing the whole
// module back to the TCP pool.
//
// Initialization is eager. A Proxy-based lazy wrapper was attempted first to
// let the module import cleanly in test environments, but `@auth/drizzle-adapter`
// calls drizzle's `is(db, PgDatabase)` at module load to pick a dialect, and
// `is()` walks `Object.getPrototypeOf(db).constructor` — a Proxy target of
// `{}` yields `Object`, so the adapter rejects the db with "Unsupported
// database type (object)". Constructing drizzle eagerly preserves the
// prototype chain; the `neon()` client is itself lazy (no network until a
// query actually runs), so construction with a placeholder URL at build time
// is harmless.

const databaseUrl =
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.POSTGRES_URL ??
  process.env.DATABASE_URL ??
  // Placeholder so module load succeeds during `next build` page-data
  // collection and in test environments. Any real query without a real URL
  // will fail at fetch time with a clear network error.
  "postgresql://placeholder:placeholder@placeholder.invalid/placeholder";

const client = neon(databaseUrl);
export const db = drizzle(client, { schema });

export * from "./schema";
