/**
 * Who may sign in.
 *
 * Three rules, checked cheapest first, any one of which admits a user:
 *
 *   1. `AUTH_OPEN_SIGNUP=true` — anyone with a working provider account.
 *   2. Their email's domain is on the institutional list below.
 *   3. Their exact address is on the invite list in the database.
 *
 * The domain rule exists because the user base is institutional and invites do
 * not scale to it: a colleague at a partner statistics office should be able to
 * sign in on the strength of their work address, without someone adding them
 * one at a time. The invite list stays because it is not redundant. Plenty of
 * NSO staff in the region work from personal addresses, and a domain rule alone
 * would exclude exactly the people it is meant to include.
 *
 * The domains are only as trustworthy as the address behind them, which is why
 * this is safe here and would not be with an arbitrary provider: Google,
 * Microsoft and GitHub each verify the address they return. A provider that
 * merely echoed a claimed address would turn this into "type any institutional
 * email to get in".
 */

/** Domains whose members may sign in, from `AUTH_ALLOWED_EMAIL_DOMAINS`. */
export function allowedEmailDomains(): string[] {
  return (process.env.AUTH_ALLOWED_EMAIL_DOMAINS || "")
    .split(",")
    .map((d) => d.trim().toLowerCase().replace(/^@/, ""))
    .filter(Boolean);
}

/** The domain part of an address, lowercased. Null if it does not have one. */
function domainOf(email: string): string | null {
  const at = email.lastIndexOf("@");
  if (at < 1 || at === email.length - 1) return null;
  return email.slice(at + 1).trim().toLowerCase();
}

/**
 * Does `host` fall under `pattern`?
 *
 * Matches the domain itself and any subdomain, so `spc.int` admits
 * `mail.spc.int`. The leading dot is what makes that safe: a plain
 * `endsWith("spc.int")` would also admit `notspc.int`, which anyone can
 * register, and that is a real way in rather than a theoretical one.
 */
function underDomain(host: string, pattern: string): boolean {
  return host === pattern || host.endsWith("." + pattern);
}

/** True when the address belongs to a listed institutional domain. */
export function isInstitutionalEmail(
  email: string,
  domains: string[] = allowedEmailDomains(),
): boolean {
  const host = domainOf(email.trim().toLowerCase());
  if (!host) return false;
  return domains.some((d) => underDomain(host, d));
}

/** Whether anyone with a working provider account may sign in. */
export function openSignupEnabled(): boolean {
  return process.env.AUTH_OPEN_SIGNUP === "true";
}

/** How a user was admitted, for logging and for the admin surface. */
export type SignupBasis = "open" | "domain" | "invite" | "denied";

/**
 * Decide on everything except the invite list, which needs a database read.
 *
 * Returns `null` when the caller still has to check the invite list, so the
 * common institutional case is settled without touching the database.
 */
export function signupBasisWithoutInviteList(
  email: string,
): Exclude<SignupBasis, "invite" | "denied"> | null {
  if (openSignupEnabled()) return "open";
  if (isInstitutionalEmail(email)) return "domain";
  return null;
}
