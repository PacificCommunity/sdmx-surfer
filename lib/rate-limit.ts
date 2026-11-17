import { createHash, createHmac } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { db, rateLimitCounters } from "@/lib/db";

/**
 * Sliding-window rate limiting backed by Postgres, so the count holds across
 * stateless function instances.
 *
 * Uses the two-bucket approximation: each key keeps one counter per fixed
 * window, and a request is judged against
 *
 *   estimate = previous_count × (1 − elapsed_fraction_of_current_window)
 *              + current_count
 *
 * A plain fixed window would let a client spend its whole limit at the end of
 * one window and again at the start of the next (2× the limit in a few
 * seconds); weighting the previous window bounds any window-length span to
 * roughly the limit. The estimate assumes the previous window's requests were
 * spread evenly, which is the approximation's only error.
 *
 * Only SERVED requests are counted. Counting denials too would let a client
 * that keeps hammering push its current window past the limit, which then
 * weighs down the next window, and so on: it would never get through again.
 * Not counting them means a persistent client is held to exactly the limit,
 * while a denial still never resets anything: the served requests stay counted
 * and keep weighing on the next window.
 */

export interface RateLimitPolicy {
  /** Namespaces counters, so policies with different windows never collide. */
  bucket: string;
  /** Requests allowed per key in any span of `windowMs`. */
  limit: number;
  windowMs: number;
}

export type RateLimitDecision =
  | { allowed: true }
  | { allowed: false; retryAfterSeconds: number };

export interface SlidingWindow {
  currentStartMs: number;
  previousStartMs: number;
  /** How much of the previous window's count still falls inside the span: (0, 1]. */
  previousWeight: number;
}

// Roughly one request in this many also purges counters older than the
// previous window, at most CLEANUP_BATCH rows at a time, so the table stays
// small without a cron job and no single request pays for a large delete.
const CLEANUP_ODDS = 50;
const CLEANUP_BATCH = 500;

export function slidingWindowAt(nowMs: number, windowMs: number): SlidingWindow {
  const currentStartMs = Math.floor(nowMs / windowMs) * windowMs;
  return {
    currentStartMs,
    previousStartMs: currentStartMs - windowMs,
    previousWeight: 1 - (nowMs - currentStartMs) / windowMs,
  };
}

/**
 * Whether one more request fits, given the served counts of the previous and
 * current windows. The SQL in `consumeRateLimit` applies this same predicate
 * (`count + 1 <= limit − previous × weight`) inside the upsert, so keep the two
 * in step.
 */
export function admits(
  previous: number,
  current: number,
  previousWeight: number,
  limit: number,
): boolean {
  return current + 1 <= limit - previous * previousWeight;
}

/**
 * Seconds until `admits` would hold again, assuming nothing else is served in
 * the meantime (a denied client can't add to the count, so that holds for it).
 */
export function retryAfterSeconds(
  previous: number,
  current: number,
  policy: RateLimitPolicy,
  nowMs: number,
): number {
  const { windowMs, limit } = policy;
  const { currentStartMs } = slidingWindowAt(nowMs, windowMs);
  // Weight the previous window may carry for the next request to fit, if the
  // current window alone hasn't used the whole limit.
  const roomInCurrent = limit - current - 1;
  let readyAtMs: number;
  if (roomInCurrent >= 0 && previous > 0) {
    // previous × (1 − elapsed / windowMs) ≤ roomInCurrent
    const elapsedNeeded = windowMs * (1 - roomInCurrent / previous);
    readyAtMs = currentStartMs + elapsedNeeded;
  } else {
    // The current window is full on its own. Next window it becomes the
    // previous one: current × (1 − elapsed / windowMs) ≤ limit − 1.
    const elapsedNeeded =
      current > 0 ? windowMs * Math.max(0, 1 - (limit - 1) / current) : 0;
    readyAtMs = currentStartMs + windowMs + elapsedNeeded;
  }
  return Math.max(1, Math.ceil((readyAtMs - nowMs) / 1000));
}

/**
 * Keyed hash of the limited value (a client IP), so stored counters can't be
 * reversed by hashing all ~4 billion IPv4 addresses. Keyed with the app's
 * existing server secret (the one Auth.js signs sessions with); the label
 * separates this use from any other derived from the same secret. Rotating the
 * secret only resets everyone's counters.
 *
 * Without a secret (local dev, where requests carry no client IP anyway) it
 * falls back to plain SHA-256: still never the raw value, but brute-forceable.
 */
export function hashRateLimitKey(
  key: string,
  secret: string | undefined = process.env.AUTH_SECRET ??
    process.env.NEXTAUTH_SECRET,
): string {
  if (!secret) return createHash("sha256").update(key, "utf8").digest("hex");
  return createHmac("sha256", secret)
    .update("rate-limit:" + key, "utf8")
    .digest("hex");
}

async function purgeExpiredWindows(
  policy: RateLimitPolicy,
  previousWindowStartMs: number,
): Promise<void> {
  // The previous window still feeds the estimate, so only older rows go.
  const expiredBefore = new Date(previousWindowStartMs);
  try {
    // Postgres DELETE has no LIMIT; bounding through ctid keeps it cheap.
    await db.execute(sql`
      DELETE FROM ${rateLimitCounters}
      WHERE ctid IN (
        SELECT ctid FROM ${rateLimitCounters}
        WHERE ${and(
          eq(rateLimitCounters.bucket, policy.bucket),
          lt(rateLimitCounters.window_start, expiredBefore),
        )}
        LIMIT ${CLEANUP_BATCH}
      )
    `);
  } catch (err) {
    console.error(
      "rate-limit purge failed",
      policy.bucket,
      err instanceof Error ? err.message : String(err),
    );
  }
}

// Integer columns arrive as numbers from neon, but the COALESCE results are
// coerced with Number() anyway in case a driver returns them as text.
type ConsumeRow = {
  served: number | string | null;
  previous: number | string;
  current: number | string;
};

/**
 * Count one request for `key` under `policy` and say whether to serve it.
 *
 * One statement, one round trip: it reads the previous window's count, then
 * upserts the current window's counter only if the request fits. The fit check
 * sits in the INSERT's own SELECT (no counter yet) and in the ON CONFLICT
 * UPDATE's WHERE (counter exists), where Postgres evaluates it against the
 * locked, latest row, so concurrent requests can't both take the last slot.
 * That matters because the neon-http driver has no transactions.
 *
 * Fails OPEN: if the database is unreachable the request is allowed and the
 * failure logged. The limiter guards a quota, not data, and a DB outage must not
 * take down public dashboards with it.
 */
export async function consumeRateLimit(
  policy: RateLimitPolicy,
  key: string,
  now: Date = new Date(),
): Promise<RateLimitDecision> {
  const nowMs = now.getTime();
  const window = slidingWindowAt(nowMs, policy.windowMs);

  const purge =
    Math.random() * CLEANUP_ODDS < 1
      ? purgeExpiredWindows(policy, window.previousStartMs)
      : Promise.resolve();

  const keyHash = hashRateLimitKey(key);
  // ISO strings, like drizzle's own timestamp mapping, so the timestamp
  // (without time zone) column holds UTC wall-clock time either way.
  const currentStart = new Date(window.currentStartMs).toISOString();
  const previousStart = new Date(window.previousStartMs).toISOString();

  try {
    const query = db.execute<ConsumeRow>(sql`
      WITH prev_window AS (
        SELECT COALESCE((
          SELECT count FROM rate_limit_counters
          WHERE bucket = ${policy.bucket}::text
            AND key_hash = ${keyHash}::text
            AND window_start = ${previousStart}::timestamp
        ), 0) AS n
      ),
      cur_window AS (
        SELECT COALESCE((
          SELECT count FROM rate_limit_counters
          WHERE bucket = ${policy.bucket}::text
            AND key_hash = ${keyHash}::text
            AND window_start = ${currentStart}::timestamp
        ), 0) AS n
      ),
      budget AS (
        SELECT ${policy.limit}::float8 - n * ${window.previousWeight}::float8 AS left_for_current
        FROM prev_window
      ),
      served AS (
        INSERT INTO rate_limit_counters AS c (bucket, key_hash, window_start, count)
        SELECT ${policy.bucket}::text, ${keyHash}::text, ${currentStart}::timestamp, 1
        FROM budget
        WHERE 1 <= budget.left_for_current
        ON CONFLICT (bucket, window_start, key_hash) DO UPDATE
          SET count = c.count + 1
          WHERE c.count + 1 <= (SELECT left_for_current FROM budget)
        RETURNING c.count
      )
      SELECT
        (SELECT count FROM served) AS served,
        (SELECT n FROM prev_window) AS previous,
        (SELECT n FROM cur_window) AS current
    `);
    const [result] = await Promise.all([query, purge]);
    const row = result.rows[0];
    if (!row || row.served !== null) return { allowed: true };
    return {
      allowed: false,
      retryAfterSeconds: retryAfterSeconds(
        Number(row.previous),
        Number(row.current),
        policy,
        nowMs,
      ),
    };
  } catch (err) {
    console.error(
      "rate-limit check failed; allowing request",
      policy.bucket,
      err instanceof Error ? err.message : String(err),
    );
    return { allowed: true };
  }
}
