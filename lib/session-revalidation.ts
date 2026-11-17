/**
 * Periodic re-check of a signed-in session against the database.
 *
 * Sessions are JWTs, so after sign-in nothing server-side is consulted: an
 * account that is deleted, dropped from every admission list (a parked trainee,
 * a withdrawn invite) or demoted would otherwise keep its access and its role
 * until the token expired. The Node `jwt` callback in lib/auth.ts runs this on
 * every `auth()`, and it reaches the database at most once per
 * SESSION_REVALIDATE_MS for a given user, so that is the revocation delay.
 * Self-service deletion (lib/account-deletion) clears the deleting browser's
 * cookie at once and forgets this instance's remembered pass; any other
 * browser signed in to the account is cut off at its next check.
 *
 * Admission is the same decision sign-in makes (lib/auth.ts `signIn`): a linked
 * account at a provider whose signup is open, or otherwise the lists in
 * lib/admission (break-glass administrators first, so they are never ejected).
 */

import { and, eq, inArray } from "drizzle-orm";
import type { JWT } from "next-auth/jwt";
import { db, authAccounts, authUsers } from "@/lib/db";
import { isEmailAdmitted } from "@/lib/admission";
import { openSignupProviders } from "@/lib/signup-policy";

export const SESSION_REVALIDATE_MS = 5 * 60 * 1000;

/** The account as revalidation needs to see it. */
export interface RevalidationUser {
  email: string;
  role: string;
  /** Set once the account has been deleted (lib/account-deletion); the row stays. */
  deletedAt: Date | null;
}

/** The account lookups, injectable so the decision can be tested without a database. */
export interface RevalidationLookups {
  /** The account behind the token, or null when it no longer exists. */
  findUser(userId: string): Promise<RevalidationUser | null>;
  /** Would this account be let in if it signed in now? */
  isAdmitted(userId: string, email: string): Promise<boolean>;
}

const databaseLookups: RevalidationLookups = {
  async findUser(userId) {
    const rows = await db
      .select({ email: authUsers.email, role: authUsers.role, deletedAt: authUsers.deleted_at })
      .from(authUsers)
      .where(eq(authUsers.id, userId))
      .limit(1);
    return rows[0] ?? null;
  },
  async isAdmitted(userId, email) {
    // Someone admitted through an open provider is on no list, so judging them
    // by the lists alone would sign every such user out within minutes.
    const open = [...openSignupProviders()];
    if (open.length > 0) {
      const linked = await db
        .select({ provider: authAccounts.provider })
        .from(authAccounts)
        .where(and(eq(authAccounts.userId, userId), inArray(authAccounts.provider, open)))
        .limit(1);
      if (linked.length > 0) return true;
    }
    return isEmailAdmitted(email);
  },
};

/** A user who passed recently, and the role they had then. */
export interface RecentPass {
  at: number;
  role: string;
}

/**
 * Passes remembered by this server instance.
 *
 * `auth()` from a route handler or server component re-signs the token but
 * never writes the cookie back, so the `checkedAt` claim only advances when the
 * browser hits /api/auth/session. Without this, every request after the first
 * five minutes of a session would cost the lookups again.
 */
const recentPasses = new Map<string, RecentPass>();

/** Enough for every concurrently active user; the bound only guards against growth. */
const MAX_REMEMBERED_PASSES = 5000;

/** Has the token gone long enough without a check to need one? */
export function revalidationDue(checkedAt: number | undefined, now: number): boolean {
  return typeof checkedAt !== "number" || now - checkedAt >= SESSION_REVALIDATE_MS;
}

function rememberPass(passes: Map<string, RecentPass>, userId: string, pass: RecentPass) {
  if (passes.size >= MAX_REMEMBERED_PASSES) {
    for (const [id, entry] of passes) {
      if (revalidationDue(entry.at, pass.at)) passes.delete(id);
    }
    if (passes.size >= MAX_REMEMBERED_PASSES) passes.clear();
  }
  passes.set(userId, pass);
}

/**
 * Drop a remembered pass so the account's next due check reaches the
 * database. Only this instance's memory: other instances still need their
 * own check, which a deleted account fails.
 */
export function forgetRecentPass(userId: string, passes: Map<string, RecentPass> = recentPasses) {
  passes.delete(userId);
}

/**
 * The token to keep, refreshed from the database when a check is due, or null
 * when the account is gone, deleted or no longer admitted. Auth.js clears the
 * session cookie when the `jwt` callback returns null, and `auth()` then
 * answers null.
 */
export async function revalidateToken(
  token: JWT,
  now: number,
  lookups: RevalidationLookups = databaseLookups,
  passes: Map<string, RecentPass> = recentPasses,
): Promise<JWT | null> {
  const userId = token.userId;
  if (!userId || !revalidationDue(token.checkedAt, now)) return token;

  const recent = passes.get(userId);
  if (recent && !revalidationDue(recent.at, now)) {
    return { ...token, role: recent.role, checkedAt: recent.at };
  }

  let user: RevalidationUser | null;
  let admitted: boolean;
  try {
    user = await lookups.findUser(userId);
    // A deleted account keeps its row (as the anonymous owner of its usage
    // records) but is as gone as a missing one; its tombstone address is
    // never admitted, and this does not rely on that.
    admitted = user && !user.deletedAt ? await lookups.isAdmitted(userId, user.email) : false;
  } catch (err) {
    // Fail open: a database outage keeps existing sessions working rather than
    // signing everyone out at once. The cost is that revocation waits for the
    // database to come back; `checkedAt` is left alone so the next request
    // tries again.
    console.warn("[auth] could not re-validate a session; keeping it for now", err);
    return token;
  }

  if (!user || user.deletedAt || !admitted) {
    passes.delete(userId);
    return null;
  }

  rememberPass(passes, userId, { at: now, role: user.role });
  return { ...token, role: user.role, checkedAt: now };
}
