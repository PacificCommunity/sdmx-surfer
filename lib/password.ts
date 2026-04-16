/**
 * Argon2id password hashing + rate-limit helpers.
 *
 * Hashing uses @node-rs/argon2 (napi-rs binding, works on Vercel Node runtime).
 * Default params are sensible for interactive logins on modern hardware.
 *
 * Rate-limiting model:
 *   - failed_attempts increments on each bad password
 *   - after MAX_ATTEMPTS in a row, locked_until is set to now + LOCK_DURATION
 *   - a successful login resets failed_attempts and clears locked_until
 *   - admin "reset password" also clears the lockout so stuck users can recover
 */

import { hash, verify } from "@node-rs/argon2";
import { eq, sql } from "drizzle-orm";
import { db, authUsers } from "./db";

const MAX_ATTEMPTS = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes

// Argon2id parameters. Defaults from node-rs are fine; these are explicit so
// a future migration to different params is obvious at the call site.
// algorithm=2 is Argon2id (Algorithm const enum is tree-shaken under
// isolatedModules so we use the numeric value directly).
const ARGON_OPTS = {
  algorithm: 2 as const,
  memoryCost: 19456, // 19 MiB — OWASP minimum for interactive login
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(plaintext: string): Promise<string> {
  return hash(plaintext, ARGON_OPTS);
}

export async function verifyPassword(
  storedHash: string,
  plaintext: string,
): Promise<boolean> {
  try {
    return await verify(storedHash, plaintext);
  } catch {
    // malformed hash, wrong algorithm, etc. — treat as mismatch
    return false;
  }
}

export function isLocked(lockedUntil: Date | null): boolean {
  if (!lockedUntil) return false;
  return lockedUntil.getTime() > Date.now();
}

export async function recordLoginSuccess(userId: string): Promise<void> {
  await db
    .update(authUsers)
    .set({ failed_attempts: 0, locked_until: null })
    .where(eq(authUsers.id, userId));
}

/**
 * Increment failed_attempts. If we cross MAX_ATTEMPTS, set locked_until.
 * Returns the new attempt count and whether the account is now locked.
 */
export async function recordLoginFailure(userId: string): Promise<{
  attempts: number;
  locked: boolean;
}> {
  const nextAttempts = sql<number>`
    CASE
      WHEN ${authUsers.locked_until} IS NOT NULL
       AND ${authUsers.locked_until} <= NOW()
      THEN 1
      ELSE ${authUsers.failed_attempts} + 1
    END
  `;

  const [row] = await db
    .update(authUsers)
    .set({
      // Once a lock has expired, start a fresh failure window instead of
      // immediately re-locking the account on the next bad password.
      failed_attempts: nextAttempts,
      locked_until: sql`
        CASE WHEN ${nextAttempts} >= ${MAX_ATTEMPTS}
             THEN NOW() + INTERVAL '${sql.raw(String(LOCK_DURATION_MS))} milliseconds'
             WHEN ${authUsers.locked_until} IS NOT NULL
              AND ${authUsers.locked_until} <= NOW()
             THEN NULL
             ELSE ${authUsers.locked_until}
        END
      `,
    })
    .where(eq(authUsers.id, userId))
    .returning({
      attempts: authUsers.failed_attempts,
      lockedUntil: authUsers.locked_until,
    });

  return {
    attempts: row?.attempts ?? 0,
    locked: !!row?.lockedUntil && row.lockedUntil.getTime() > Date.now(),
  };
}

export const PASSWORD_POLICY = {
  minLength: 12,
  maxLength: 128,
} as const;

export function validatePasswordShape(
  plaintext: string,
): { ok: true } | { ok: false; reason: string } {
  if (plaintext.length < PASSWORD_POLICY.minLength) {
    return {
      ok: false,
      reason: "Password must be at least " + PASSWORD_POLICY.minLength + " characters.",
    };
  }
  if (plaintext.length > PASSWORD_POLICY.maxLength) {
    return {
      ok: false,
      reason: "Password must be at most " + PASSWORD_POLICY.maxLength + " characters.",
    };
  }
  return { ok: true };
}
