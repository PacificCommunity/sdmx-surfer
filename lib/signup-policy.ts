/**
 * Who may sign in.
 *
 * Three rules, any one of which admits a user:
 *
 *   1. They arrived through a provider named in `AUTH_OPEN_SIGNUP_PROVIDERS`.
 *   2. Their email's domain is in `allowed_domains`.
 *   3. Their exact address is in `allowed_emails`.
 *
 * RULE 1 IS PER PROVIDER, NOT GLOBAL. The service is meant to be open to the
 * public through Google and Microsoft, while the paths that do not go through a
 * provider stay on the lists. A single boolean cannot express that: switched on
 * it also opens the magic link, so anyone with any working address gets an
 * account and rules 2 and 3 stop governing anything; switched off it closes the
 * public sign-in it exists to allow.
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
 * Microsoft's tenant for personal accounts, a fixed well-known id.
 *
 * A consumer account's address is its sign-in name, which Microsoft verifies by
 * sending a code to it before the account exists. That is a real check, so
 * these addresses are trustworthy without the claim below.
 */
export const MICROSOFT_CONSUMER_TENANT = "9188040d-6c67-4c5b-b112-36a304b66dad";

/**
 * Does this Microsoft token prove the address belongs to the tenant issuing it?
 *
 * NOT THE SAME QUESTION AS "DID MICROSOFT AUTHENTICATE SOMEONE". A work or
 * school account's `email` claim is filled from the `mail` attribute in its own
 * directory, which that directory's administrator sets to any string at all,
 * with nothing checking that the tenant owns the domain. Against a multi-tenant
 * app, anyone can create a free tenant, set a user's mail to an address they do
 * not own, and be handed that identity. Published as nOAuth.
 *
 * Two things make an address trustworthy. `xms_edov` is Microsoft's own answer:
 * an optional claim, enabled on the app registration, saying the email's domain
 * is verified as owned by the issuing tenant. Failing that, a consumer tenant,
 * where the address was verified at account creation.
 *
 * Everything else is refused. A tenant that has not proved it owns a domain has
 * told us nothing we can use to link an account or match a domain rule.
 *
 * Fails closed on an absent claim, so an app registration missing `xms_edov`
 * turns Microsoft sign-in off rather than trusting whatever arrives.
 */
export function entraEmailIsVerified(
  claims: Record<string, unknown> | null | undefined,
): boolean {
  if (!claims) return false;
  // Entra has emitted this as a boolean and as a string, depending on how the
  // claim was configured; both mean the same thing.
  const verified = claims.xms_edov;
  if (verified === true || verified === "true") return true;
  return claims.tid === MICROSOFT_CONSUMER_TENANT;
}

/**
 * The only providers that may ever be opened to the public.
 *
 * A hard list rather than a validation nicety. It is what stops
 * `AUTH_OPEN_SIGNUP_PROVIDERS=email` from opening the magic link to the world,
 * which would admit anyone with any working address and quietly retire both
 * lists. A typo in this variable can therefore fail to open something, and can
 * never open something that was not meant to be openable.
 *
 * Each of these is an identity provider that authenticates the person and
 * returns an address it stands behind. `email` and `credentials` are our own
 * paths into our own account table, and belong to the lists.
 */
const OPENABLE_PROVIDERS = new Set(["google", "microsoft-entra-id", "github"]);

/**
 * Providers whose users may sign in without appearing on any list.
 *
 * Empty by default, so adding a provider does not open the service as a side
 * effect: a provider must be both configured and named here. Keeping it an
 * environment variable means opening a door, and closing it again if that goes
 * badly, needs neither a code change nor a deploy. It is a list rather than a
 * boolean so the providers can be opened one at a time, which is how this is
 * meant to roll out: Google and Microsoft first, GitHub later or not at all.
 */
export function openSignupProviders(): Set<string> {
  const open = new Set<string>();
  for (const entry of (process.env.AUTH_OPEN_SIGNUP_PROVIDERS || "").split(",")) {
    const id = entry.trim().toLowerCase();
    if (!id) continue;
    if (!OPENABLE_PROVIDERS.has(id)) {
      console.warn(
        "[auth] ignoring unknown provider in AUTH_OPEN_SIGNUP_PROVIDERS: " + id,
      );
      continue;
    }
    open.add(id);
  }
  return open;
}

/**
 * Is public signup open for the provider this sign-in came through?
 *
 * A missing provider is closed. Auth.js supplies `account` on every path we
 * register, so an absent one means something unrecognised, and the lists are
 * the right place for it to land.
 */
export function signupIsOpenFor(provider: string | null | undefined): boolean {
  if (!provider) return false;
  return openSignupProviders().has(provider);
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

/**
 * Is `email` present and verified in a GitHub `/user/emails` response?
 *
 * Auth.js does not check this. Its GitHub provider takes
 * `emails.find(e => e.primary) ?? emails[0]` and uses that address whatever its
 * verification state. GitHub does require verification before an address can be
 * made primary, so the first branch is sound in practice, but the `emails[0]`
 * fallback carries no such guarantee and the whole thing rests on an
 * undocumented invariant of a third party.
 *
 * That invariant is load-bearing here in a way it is not for most apps. An
 * unverified address would let someone assert an address at a listed
 * institutional domain and be admitted by the domain rule; worse, because
 * accounts are linked on email, it would attach them to an existing account
 * that already owns that address, including an administrator's.
 *
 * So this is checked explicitly, and fails closed: a malformed response, a
 * missing address, or a match that is not verified all return false.
 */
export function githubEmailIsVerified(
  emailsPayload: unknown,
  email: string,
): boolean {
  if (!Array.isArray(emailsPayload)) return false;
  const target = email.trim().toLowerCase();
  if (!target) return false;
  return emailsPayload.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const row = entry as { email?: unknown; verified?: unknown };
    return (
      typeof row.email === "string" &&
      row.email.trim().toLowerCase() === target &&
      row.verified === true
    );
  });
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
