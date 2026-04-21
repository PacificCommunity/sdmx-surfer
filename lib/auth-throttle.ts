import { and, count, eq, gte } from "drizzle-orm";
import { db, authEvents } from "./db";

export const CREDENTIAL_FAILURE_LIMIT = 10;
export const CREDENTIAL_FAILURE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Throttle credential attempts for unknown / not-allowlisted emails too.
 * We use the append-only auth_events table to avoid adding new infra.
 */
export async function isCredentialAttemptThrottled(
  email: string,
  options?: { limit?: number; windowMs?: number },
): Promise<boolean> {
  const limit = options?.limit ?? CREDENTIAL_FAILURE_LIMIT;
  const windowMs = options?.windowMs ?? CREDENTIAL_FAILURE_WINDOW_MS;
  const normalizedEmail = email.toLowerCase();
  const windowStart = new Date(Date.now() - windowMs);

  const [row] = await db
    .select({ count: count(authEvents.id) })
    .from(authEvents)
    .where(
      and(
        eq(authEvents.event_type, "login_failure"),
        eq(authEvents.email, normalizedEmail),
        gte(authEvents.created_at, windowStart),
      ),
    );

  return Number(row?.count ?? 0) >= limit;
}
