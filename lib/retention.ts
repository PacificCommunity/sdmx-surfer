/**
 * Data retention, run daily by Vercel Cron (app/api/cron/retention).
 *
 * Policy (decided by the service owners, stated on /about#what-we-record):
 *   - usage_logs content (prompt/reply excerpts, tool calls, errors): 3 months,
 *     long enough for administrators to review misuse; the accounting columns
 *     stay so the global AI budget keeps counting them
 *   - auth_events: 90 days, the same review window
 *   - deleted accounts (lib/account-deletion.ts): their real address
 *     (auth_users.deleted_email) is cleared 3 months after deletion; the row
 *     stays, anonymous, as the owner of its usage records
 *   - dashboard_sessions soft-deleted (deleted_at) more than 30 days ago
 *   - one-time sign-in artefacts once they can no longer be used
 *
 * neon-http has no transactions, so every statement is idempotent and selects
 * its rows by their own state (age, expiry, deletion, content left): a run
 * that stops halfway leaves nothing inconsistent, and the next run finishes
 * whatever the failed one did not.
 */

import { createHash, timingSafeEqual } from "node:crypto";
import { and, inArray, isNotNull, lt, or } from "drizzle-orm";
import {
  db,
  authEvents,
  authMagicLinkRefs,
  authUsers,
  authVerificationTokens,
  dashboardSessions,
  emailProofs,
  usageLogs,
} from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

export const AUTH_EVENTS_RETENTION_DAYS = 90;
export const DELETED_SESSIONS_RETENTION_DAYS = 30;
export const USAGE_LOGS_RETENTION_MONTHS = 3;
export const DELETED_ACCOUNT_EMAIL_RETENTION_MONTHS = 3;

function monthsBefore(now: Date, months: number): Date {
  const date = new Date(now);
  date.setUTCMonth(date.getUTCMonth() - months);
  return date;
}

export interface RetentionCutoffs {
  usageLogs: Date;
  authEvents: Date;
  deletedAccounts: Date;
  deletedSessions: Date;
  // Proofs older than a day are past every window that reads them (TTL,
  // completion and the hourly start throttles in
  // app/api/auth/email-proof/start), which already prunes them on each start.
  emailProofs: Date;
  // Magic-link refs and verification tokens are worthless once expired.
  expiredTokens: Date;
}

export function retentionCutoffs(now: Date): RetentionCutoffs {
  return {
    usageLogs: monthsBefore(now, USAGE_LOGS_RETENTION_MONTHS),
    authEvents: new Date(now.getTime() - AUTH_EVENTS_RETENTION_DAYS * DAY_MS),
    deletedAccounts: monthsBefore(now, DELETED_ACCOUNT_EMAIL_RETENTION_MONTHS),
    deletedSessions: new Date(now.getTime() - DELETED_SESSIONS_RETENTION_DAYS * DAY_MS),
    emailProofs: new Date(now.getTime() - DAY_MS),
    expiredTokens: new Date(now),
  };
}

export interface RetentionCounts {
  emailProofs: number;
  magicLinkRefs: number;
  verificationTokens: number;
  usageLogsRedacted: number;
  deletedAccountsUnlinked: number;
  usageLogsDetached: number;
  dashboardSessions: number;
  authEvents: number;
}

export async function runRetention(now: Date = new Date()): Promise<RetentionCounts> {
  const cutoff = retentionCutoffs(now);

  const proofs = await db.delete(emailProofs).where(lt(emailProofs.created_at, cutoff.emailProofs));
  const refs = await db
    .delete(authMagicLinkRefs)
    .where(lt(authMagicLinkRefs.expiresAt, cutoff.expiredTokens));
  const tokens = await db
    .delete(authVerificationTokens)
    .where(lt(authVerificationTokens.expires, cutoff.expiredTokens));

  // Redacted, not deleted: checkGlobalBudget (lib/usage-caps.ts) sums cost_usd
  // over a window that can outlast the 3 months, so deleting rows would quietly
  // lower the measured spend and loosen the cap. Every free-text column goes;
  // ids, user, time, model, provider, tokens and cost stay. Only rows with
  // content left match, so a re-run touches nothing and the count means
  // "newly redacted".
  const logs = await db
    .update(usageLogs)
    .set({ user_message: null, ai_response: null, tool_calls: null, errors: null })
    .where(
      and(
        lt(usageLogs.created_at, cutoff.usageLogs),
        or(
          isNotNull(usageLogs.user_message),
          isNotNull(usageLogs.ai_response),
          isNotNull(usageLogs.tool_calls),
          isNotNull(usageLogs.errors),
        ),
      ),
    );

  // A deleted account's real address was kept only for misuse review; after
  // the window the row is an anonymous holder for its usage records, which
  // still point at it. Matches only rows with an address left, so a re-run
  // touches nothing; a live account (deleted_at NULL) never compares less.
  const unlinked = await db
    .update(authUsers)
    .set({ deleted_email: null })
    .where(
      and(lt(authUsers.deleted_at, cutoff.deletedAccounts), isNotNull(authUsers.deleted_email)),
    );

  // usage_logs.session_id references dashboard_sessions without a cascade, so
  // a purged session's logs must let go of it first. They are detached rather
  // than deleted: a usage record follows its own retention whatever happens
  // to the dashboard, and its cost still counts toward the budget. If the
  // purge below fails, the next run detaches and retries.
  // `deleted_at < cutoff` never matches a live session (NULL compares false),
  // so published dashboards that are not deleted are never selected.
  const purgeable = db
    .select({ id: dashboardSessions.id })
    .from(dashboardSessions)
    .where(lt(dashboardSessions.deleted_at, cutoff.deletedSessions));
  const detached = await db
    .update(usageLogs)
    .set({ session_id: null })
    .where(inArray(usageLogs.session_id, purgeable));
  const sessions = await db
    .delete(dashboardSessions)
    .where(lt(dashboardSessions.deleted_at, cutoff.deletedSessions));

  const events = await db.delete(authEvents).where(lt(authEvents.created_at, cutoff.authEvents));

  return {
    emailProofs: proofs.rowCount ?? 0,
    magicLinkRefs: refs.rowCount ?? 0,
    verificationTokens: tokens.rowCount ?? 0,
    usageLogsRedacted: logs.rowCount ?? 0,
    deletedAccountsUnlinked: unlinked.rowCount ?? 0,
    usageLogsDetached: detached.rowCount ?? 0,
    dashboardSessions: sessions.rowCount ?? 0,
    authEvents: events.rowCount ?? 0,
  };
}

/**
 * Vercel Cron sends `Authorization: Bearer ${CRON_SECRET}`. Digests are
 * compared so the check is constant-time whatever the lengths. An unset or
 * empty secret authorises nothing.
 */
export function cronAuthorized(header: string | null, secret: string | undefined): boolean {
  if (!secret) return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest("Bearer " + secret), digest(header ?? ""));
}
