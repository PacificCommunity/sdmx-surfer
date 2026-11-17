/**
 * Self-service account deletion (DELETE /api/account, from Settings).
 *
 * Policy (decided by the service owners, stated on /about#what-we-record):
 *   - at once: the user's dashboards are unpublished and soft-deleted (the
 *     retention job erases them 30 days later), and their API keys, OAuth
 *     links, pending sign-in tokens, email proofs, invite, password, name and
 *     picture are removed;
 *   - the auth_users row stays, as the anonymous owner of its usage_logs: the
 *     global AI budget (lib/usage-caps.ts) sums their cost, so they are never
 *     deleted, only unlinked from the person;
 *   - the address is freed for a future registration: `email` becomes a
 *     tombstone no provider can return, and the real one moves to
 *     `deleted_email`, kept for the 3-month misuse-review window and then
 *     cleared by lib/retention.ts.
 *
 * neon-http has no transactions, so the statements are ordered to make a
 * partial run safe and a re-run complete it. Everything that could sign in
 * to the row or identify the person goes first; the single update to
 * auth_users that sets `deleted_at` comes last and is the point of no return.
 * Until it lands the account is intact (if emptied) and the user can simply
 * retry; once it lands, nothing is left that could reach the row. Every step
 * selects its rows by owner and state, so repeating it is harmless.
 */

import { and, eq, isNotNull, isNull, sql } from "drizzle-orm";
import {
  db,
  allowedEmails,
  authAccounts,
  authEvents,
  authMagicLinkRefs,
  authUsers,
  authVerificationTokens,
  dashboardSessions,
  emailProofs,
  userApiKeys,
} from "@/lib/db";
import { forgetRecentPass } from "@/lib/session-revalidation";

/**
 * The address a deleted account is left with. Unique because the id is, so
 * the unique constraint on auth_users.email is released for the real address.
 * `.invalid` is reserved (RFC 2606): no identity provider will ever assert it
 * and no mail can be delivered to it, so no sign-in path can match the row.
 */
export function tombstoneEmail(userId: string): string {
  return "deleted+" + userId + "@invalid";
}

/** Did the user type their own address to confirm? Case and surrounding spaces do not count. */
export function deletionConfirmed(typed: string, accountEmail: string): boolean {
  const expected = accountEmail.trim().toLowerCase();
  return expected !== "" && typed.trim().toLowerCase() === expected;
}

/**
 * How a magic-link ref's stored callback URL ends for this address.
 *
 * The refs table keeps no address column. Auth.js builds the callback as
 * `…/callback/email?callbackUrl=…&token=…&email=…` (@auth/core
 * send-token.js), so the address is always the last parameter, encoded by
 * URLSearchParams exactly as here. Matching the whole suffix, `&` included,
 * keeps `bob@x.org` from matching `jimbob@x.org`.
 */
export function magicLinkRefSuffix(email: string): string {
  return "&" + new URLSearchParams({ email }).toString();
}

/**
 * The address admin views show for an account: the real one, marked, while it
 * is kept for misuse review; afterwards the tombstone, which says enough.
 */
export function adminAccountEmail(email: string, deletedEmail: string | null): string {
  return deletedEmail ? deletedEmail + " (deleted)" : email;
}

export interface AccountDeletionResult {
  /** True when an earlier run had already reached the final step. */
  alreadyDeleted: boolean;
}

/**
 * Delete the account `userId`. Returns null when no such account exists.
 * Safe to call again on an account already (or partly) deleted.
 */
export async function deleteAccount(
  userId: string,
  ip: string | null,
  now: Date = new Date(),
): Promise<AccountDeletionResult | null> {
  const [user] = await db
    .select({
      email: authUsers.email,
      deletedEmail: authUsers.deleted_email,
      deletedAt: authUsers.deleted_at,
    })
    .from(authUsers)
    .where(eq(authUsers.id, userId))
    .limit(1);
  if (!user) return null;

  const alreadyDeleted = user.deletedAt !== null;
  // After the final step the real address survives only in deleted_email (and
  // not at all once the review window has passed).
  const email = alreadyDeleted ? user.deletedEmail : user.email;

  // Recorded before anything is removed, so a run that fails halfway is on
  // record too; a retry after such a failure records its own attempt. An
  // audit failure must not stop someone leaving: deleted_at and
  // deleted_email record the deletion regardless.
  if (!alreadyDeleted) {
    try {
      await db.insert(authEvents).values({
        user_id: userId,
        email: user.email,
        event_type: "account_deleted",
        actor_user_id: userId,
        ip,
      });
    } catch (err) {
      console.error(
        "[account] could not record an account deletion event",
        err instanceof Error ? err.message : "unknown",
      );
    }
  }

  // Dashboards leave the gallery and /p/ at once; the retention job erases
  // them 30 days after deleted_at. A dashboard the user had already deleted
  // keeps its own deleted_at, so its 30 days are not restarted. These also run
  // on a repeat call, which sweeps up anything a session still open on
  // another device created after the first run.
  await db
    .update(dashboardSessions)
    .set({ published_at: null, deleted_at: now })
    .where(and(eq(dashboardSessions.user_id, userId), isNull(dashboardSessions.deleted_at)));
  await db
    .update(dashboardSessions)
    .set({ published_at: null })
    .where(and(eq(dashboardSessions.user_id, userId), isNotNull(dashboardSessions.published_at)));

  await db.delete(userApiKeys).where(eq(userApiKeys.user_id, userId));

  // Before the final step: Auth.js looks a returning OAuth user up by the
  // provider's account id before any address, so a surviving link would sign
  // straight into the deleted row.
  await db.delete(authAccounts).where(eq(authAccounts.userId, userId));

  if (email) {
    // Leaving consumes the invite; a domain rule or open provider still
    // admits the address to register again.
    await db.delete(allowedEmails).where(eq(allowedEmails.email, email));
    await db
      .delete(authVerificationTokens)
      .where(eq(authVerificationTokens.identifier, email));
    const suffix = magicLinkRefSuffix(email);
    await db
      .delete(authMagicLinkRefs)
      .where(sql`right(${authMagicLinkRefs.callbackUrl}, ${suffix.length}) = ${suffix}`);
    await db.delete(emailProofs).where(eq(emailProofs.email, email));
  }

  // The point of no return. Conditional on deleted_at, so a repeat never
  // overwrites deleted_email with the tombstone or restarts the review window.
  // The role goes back to "user" so a deleted administrator no longer counts
  // as one (the last-admin guard in app/api/admin/users/[id]).
  await db
    .update(authUsers)
    .set({
      email: tombstoneEmail(userId),
      deleted_email: user.email,
      deleted_at: now,
      name: null,
      image: null,
      password_hash: null,
      role: "user",
      failed_attempts: 0,
      locked_until: null,
    })
    .where(and(eq(authUsers.id, userId), isNull(authUsers.deleted_at)));

  forgetRecentPass(userId);
  return { alreadyDeleted };
}
