/**
 * Who may sign in.
 *
 * Three rules, any one of which admits a user:
 *
 *   1. `AUTH_OPEN_SIGNUP=true` — anyone with a working provider account.
 *   2. Their email's domain is in `allowed_domains`.
 *   3. Their exact address is in `allowed_emails`.
 *
 * The domain rule exists because the user base is institutional and invites do
 * not scale to it: someone at a partner statistics office should be able to
 * sign in on the strength of their work address, rather than waiting for a
 * person to add them one at a time. The invite list stays because it is not
 * redundant. A good number of statistics staff in the region work from personal
 * addresses, and a domain rule alone would exclude exactly the people it exists
 * to include.
 *
 * MATCHING IS EXACT. There is no subdomain form. A subdomain grant reads
 * smaller than it is, and this list is the only thing between a stranger and an
 * account, so a domain that needs a subdomain gets its own row and someone
 * decides to put it there.
 *
 * The rule is worth exactly as much as the address behind it. It is sound with
 * Google, Microsoft and GitHub because each verifies the address it returns. A
 * provider that merely echoed a claimed address would reduce this to "type any
 * institutional email to get in", so adding one means checking that first.
 *
 * These helpers are deliberately free of database imports so they can be tested
 * directly; `lib/auth` does the lookups.
 */

/** Normalise a domain for storage and comparison. */
export function normaliseDomain(raw: string): string {
  return raw.trim().toLowerCase().replace(/^@/, "").replace(/\.$/, "");
}

/**
 * The host part of an address, lowercased, or null when there isn't one.
 *
 * Taken from after the LAST `@`, which is the part a mail system routes on.
 * Reading from the first would let `a@spc.int@evil.com` pass as SPC.
 */
export function emailDomain(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  const host = email.slice(at + 1).trim().toLowerCase();
  return host.length > 0 && !host.includes("@") ? host : null;
}

/**
 * Does this address belong to one of the listed domains?
 *
 * Exact comparison on the host. A suffix test over the whole address would
 * admit `notspc.int`, which anyone can register for a few dollars.
 */
export function isInstitutionalEmail(email: string, domains: string[]): boolean {
  const host = emailDomain(email.trim().toLowerCase());
  if (!host) return false;
  const listed = new Set(domains.map(normaliseDomain));
  return listed.has(host);
}

/**
 * Whether anyone with a working provider account may sign in.
 *
 * Off by default, so adding a provider does not open the service as a side
 * effect. Keeping it an environment switch means opening the door, and closing
 * it again if that goes badly, needs neither a code change nor a deploy.
 */
export function openSignupEnabled(): boolean {
  return process.env.AUTH_OPEN_SIGNUP === "true";
}

/**
 * Emails that are always admitted and always administrators.
 *
 * The break-glass. Everything else about this migration is recoverable: unset a
 * provider, close signup, restore a row. Losing the last administrator is not,
 * because promoting one requires an administrator to be signed in already.
 *
 * The exposure here is concrete rather than theoretical. Of the two admin
 * accounts, one is at spc.int and should federate; the other is at a personal
 * domain that may have no provider behind it at all, and would be stranded the
 * moment password sign-in is retired. This makes recovery an environment
 * variable rather than database surgery.
 *
 * It is safe to leave set. It grants nothing to anyone who cannot already prove
 * ownership of the address through a provider that verifies it.
 */
export function bootstrapAdminEmails(): string[] {
  return (process.env.AUTH_BOOTSTRAP_ADMINS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.includes("@"));
}

/** Is this address a break-glass administrator? */
export function isBootstrapAdmin(email: string): boolean {
  return bootstrapAdminEmails().includes(email.trim().toLowerCase());
}

/** Addresses that must never be admitted by domain, whatever is in the table. */
export const PERSONAL_EMAIL_DOMAINS = [
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "yahoo.com",
  "yahoo.co.uk",
  "icloud.com",
  "me.com",
  "proton.me",
  "protonmail.com",
  "aol.com",
  "gmx.com",
  "mail.com",
  "yandex.com",
  "zoho.com",
];

/**
 * Guard for the admin surface: a consumer domain admitted here would open the
 * service to everyone while looking like an ordinary row. Personal addresses
 * belong on the invite list, one at a time.
 */
export function isPersonalEmailDomain(domain: string): boolean {
  return PERSONAL_EMAIL_DOMAINS.includes(normaliseDomain(domain));
}
