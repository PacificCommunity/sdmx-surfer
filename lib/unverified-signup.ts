/**
 * Password accounts created WITHOUT proving the address, for listed domains.
 *
 * Why it exists: sign-in links do not reach Microsoft 365 mailboxes, and
 * Microsoft sign-in needs the partner's IT to act. For the domains named in
 * `UNVERIFIED_SIGNUP_DOMAINS` the owner accepts the trade: anyone may register
 * any address at a listed domain with a password, first come first served. An
 * admin can delete a squatted account. The admission lists (`isEmailAdmitted`)
 * still govern; this only removes the proof step for these domains.
 *
 * It never touches an existing account: setting a password on one would hand
 * it to whoever typed the address first.
 *
 * Pure and free of server imports, so the login page can run the same
 * `unverifiedSignupAllows` check in the browser that the API runs.
 */

import {
  domainRuleAdmits,
  domainRuleProblem,
  emailDomain,
  normaliseDomain,
} from "@/lib/signup-policy";

/** `auth_events.event_type` of a successful signup; the throttle counts these rows. */
export const UNVERIFIED_SIGNUP_EVENT = "unverified_signup";
/** Successful signups allowed per client IP per hour. */
export const UNVERIFIED_SIGNUP_IP_HOURLY_LIMIT = 5;
/** Successful signups allowed across the whole service per hour. */
export const UNVERIFIED_SIGNUP_GLOBAL_HOURLY_LIMIT = 20;

// An exact host or a `.suffix`, each with at least two labels.
const DOMAIN_RULE_SHAPE = /^\.?[a-z0-9-]+(?:\.[a-z0-9-]+)+$/;

export interface ParsedDomainRules {
  rules: string[];
  dropped: { rule: string; problem: string }[];
}

/**
 * Parse a comma-separated list of `allowed_domains`-style rules. Entries that
 * are not domains, or that `domainRuleProblem` refuses (single-label suffixes,
 * personal mail providers), are dropped and reported.
 */
export function parseUnverifiedSignupDomains(raw: string | undefined): ParsedDomainRules {
  const rules: string[] = [];
  const dropped: ParsedDomainRules["dropped"] = [];
  for (const entry of (raw ?? "").split(",")) {
    const rule = normaliseDomain(entry);
    if (!rule) continue;
    const problem = DOMAIN_RULE_SHAPE.test(rule)
      ? domainRuleProblem(rule)
      : "Not a domain or .suffix rule";
    if (problem) {
      dropped.push({ rule, problem });
    } else if (!rules.includes(rule)) {
      rules.push(rule);
    }
  }
  return { rules, dropped };
}

let warnedFor: string | undefined;

/**
 * The configured rules; empty means the feature is off. Server only (reads the
 * environment). Dropped entries are logged once per distinct value.
 */
export function unverifiedSignupDomains(): string[] {
  const raw = process.env.UNVERIFIED_SIGNUP_DOMAINS;
  const { rules, dropped } = parseUnverifiedSignupDomains(raw);
  if (dropped.length > 0 && warnedFor !== raw) {
    warnedFor = raw;
    for (const { rule, problem } of dropped) {
      console.warn("[auth] ignoring UNVERIFIED_SIGNUP_DOMAINS entry " + rule + ": " + problem);
    }
  }
  return rules;
}

/** May this address register without proving it? */
export function unverifiedSignupAllows(email: string, rules: string[]): boolean {
  const host = emailDomain(email.trim().toLowerCase());
  if (!host) return false;
  return rules.some((rule) => domainRuleAdmits(host, rule));
}

/** The rules as a phrase for people: "mfat.govt.nz or any subdomain of govt.nz". */
export function describeDomainRules(rules: string[]): string {
  const exact = rules.filter((r) => !r.startsWith("."));
  const suffixes = rules.filter((r) => r.startsWith(".")).map((r) => r.slice(1));
  const parts: string[] = [];
  if (exact.length > 0) parts.push(exact.join(", "));
  if (suffixes.length > 0) parts.push("any subdomain of " + suffixes.join(", "));
  return parts.join(" or ");
}
