import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
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
// The db handle is built lazily on first use so modules can be imported in
// test environments without a DB URL. Attempting an actual query without a
// configured URL throws with a clear message.

type Schema = typeof schema;
let cached: NeonHttpDatabase<Schema> | null = null;

function resolveDb(): NeonHttpDatabase<Schema> {
  if (cached) return cached;
  const url =
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.POSTGRES_URL ??
    process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "Database URL not configured: set POSTGRES_URL (or POSTGRES_URL_NON_POOLING) via the Vercel/Neon integration, or DATABASE_URL locally.",
    );
  }
  cached = drizzle(neon(url), { schema });
  return cached;
}

export const db = new Proxy({} as NeonHttpDatabase<Schema>, {
  get(_target, prop, receiver) {
    return Reflect.get(resolveDb(), prop, receiver);
  },
}) as NeonHttpDatabase<Schema>;

export * from "./schema";
