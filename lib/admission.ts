/**
 * Is an address admitted to the service by the lists, whatever proved it?
 *
 * The one admission decision shared by every sign-in path: the Auth.js
 * `signIn` callback (after any provider-specific verification and the
 * open-provider rule), the password `authorize`, and the email-proof flow at
 * both its start and its completion. Callers must already have proved the
 * caller owns the address; this only says whether that address may come in.
 *
 * Three grounds, cheapest first: a break-glass administrator, an
 * institutional domain in `allowed_domains`, or an individual invite in
 * `allowed_emails`. See lib/signup-policy for the rules themselves.
 */

import { eq, inArray } from "drizzle-orm";
import { db, allowedDomains, allowedEmails } from "@/lib/db";
import {
  domainRuleCandidates,
  emailDomain,
  isBootstrapAdmin,
} from "@/lib/signup-policy";

/** The two list lookups, injectable so the decision can be tested without a database. */
export interface AdmissionLookups {
  /** Does any of these `allowed_domains` rule strings exist? May throw if the table is unreadable. */
  anyDomainRule(candidates: string[]): Promise<boolean>;
  /** Is this exact (normalised) address on the invite list? */
  isInvited(email: string): Promise<boolean>;
}

const databaseLookups: AdmissionLookups = {
  async anyDomainRule(candidates) {
    // One indexed IN lookup over the host and each `.suffix` covering it.
    const rows = await db
      .select({ domain: allowedDomains.domain })
      .from(allowedDomains)
      .where(inArray(allowedDomains.domain, candidates))
      .limit(1);
    return rows.length > 0;
  },
  async isInvited(email) {
    const rows = await db
      .select({ email: allowedEmails.email })
      .from(allowedEmails)
      .where(eq(allowedEmails.email, email))
      .limit(1);
    return rows.length > 0;
  },
};

export async function isEmailAdmitted(
  email: string,
  lookups: AdmissionLookups = databaseLookups,
): Promise<boolean> {
  const normalizedEmail = email.trim().toLowerCase();

  // Break-glass first, so a locked-out administrator is never gated by a list
  // they can no longer edit.
  if (isBootstrapAdmin(normalizedEmail)) return true;

  // Institutional domain. Degrades to the invite list if that table cannot be
  // read, rather than taking sign-in down with it: shipping code that queries
  // it ahead of its migration would otherwise lock every user out at once.
  // Failing this way only ever removes a way in, never adds one.
  const host = emailDomain(normalizedEmail);
  if (host) {
    try {
      if (await lookups.anyDomainRule(domainRuleCandidates(host))) return true;
    } catch (err) {
      console.error(
        "[auth] allowed_domains unreadable, falling back to the invite " +
          "list. Has migration 0007 been applied?",
        err,
      );
    }
  }

  // Otherwise an individual invite, which is how personal addresses get in.
  return lookups.isInvited(normalizedEmail);
}
