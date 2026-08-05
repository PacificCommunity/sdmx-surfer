/**
 * Auth.js (NextAuth v5) configuration with the Drizzle adapter and Resend
 * magic links. Runs in the Node runtime only (it imports the DB client and,
 * via lib/password.ts, the native @node-rs/argon2 binding). The edge-safe
 * subset used by the middleware lives in lib/auth.config.ts.
 *
 * Magic links use a custom `email`-type provider whose sendVerificationRequest
 * calls the Resend SDK directly. We deliberately do NOT use
 * `next-auth/providers/email` / `next-auth/providers/nodemailer`, which eagerly
 * import nodemailer; avoiding them keeps nodemailer out of the dependency tree.
 */

import NextAuth from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import GoogleProvider from "next-auth/providers/google";
import GitHubProvider from "next-auth/providers/github";
import MicrosoftEntraID from "next-auth/providers/microsoft-entra-id";
import {
  emailDomain,
  githubEmailIsVerified,
  isBootstrapAdmin,
  openSignupEnabled,
} from "@/lib/signup-policy";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { authConfig } from "./auth.config";
import {
  db,
  authUsers,
  authAccounts,
  authVerificationTokens,
  authEvents,
  allowedEmails,
  allowedDomains,
} from "./db/index";
import {
  verifyPassword,
  isLocked,
  recordLoginSuccess,
  recordLoginFailure,
} from "./password";
import { isCredentialAttemptThrottled } from "./auth-throttle";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// In v5 the credentials `authorize` receives a Web `Request`, whose headers are
// a `Headers` object (not a plain map as in v4).
function extractIp(request: Request | undefined): string | null {
  const headers = request?.headers;
  if (!headers || typeof headers.get !== "function") return null;
  const raw = headers.get("x-forwarded-for") ?? headers.get("x-real-ip");
  if (!raw) return null;
  // x-forwarded-for may contain a comma-separated chain; take the first entry
  const first = raw.split(",")[0]?.trim();
  return first || null;
}

// ---------------------------------------------------------------------------
// Resend email sender
// ---------------------------------------------------------------------------
function buildMagicLinkBody(verifyUrl: string): { html: string; text: string } {
  const html =
    "<p>Hi,</p>" +
    "<p>You requested access to <strong>SDMX Surfer</strong>, " +
    "an early-alpha tool built at the Pacific Community (SPC) for exploring " +
    "SDMX data through conversation.</p>" +
    '<p><a href="' + verifyUrl + '">Click here to sign in</a></p>' +
    "<p>This link expires in 15 minutes and can only be used once. " +
    "If you did not request this, you can safely ignore this email.</p>" +
    "<p>Happy surfing,<br>Giulio Valentino Dalla Riva<br>Pacific Community (SPC)</p>";

  const text =
    "Hi,\n\n" +
    "You requested access to SDMX Surfer, an early-alpha tool built at the " +
    "Pacific Community (SPC) for exploring SDMX data through conversation.\n\n" +
    "Sign in: " + verifyUrl + "\n\n" +
    "This link expires in 15 minutes and can only be used once. " +
    "If you did not request this, you can safely ignore this email.\n\n" +
    "Happy surfing,\n" +
    "Giulio Valentino Dalla Riva\n" +
    "Pacific Community (SPC)\n";

  return { html, text };
}

async function sendMagicLink(params: {
  identifier: string;
  url: string;
}): Promise<void> {
  const { identifier, url } = params;

  // In development (no RESEND_API_KEY): log the link to the server console
  if (!process.env.RESEND_API_KEY) {
    console.log("\n" +
      "========================================\n" +
      "  MAGIC LINK for " + identifier + "\n" +
      "========================================\n" +
      "  " + url + "\n" +
      "========================================\n",
    );
    return;
  }

  // In production: send via Resend
  // Store the callback URL server-side and send only a reference ID in the email.
  // This defeats Outlook SafeLinks which extracts and pre-fetches URLs from emails,
  // consuming the single-use Auth.js token before the user clicks.
  const { Resend } = await import("resend");
  const crypto = await import("node:crypto");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM || "noreply@example.com";
  const host = new URL(url).host;
  const baseUrl =
    process.env.AUTH_URL || process.env.NEXTAUTH_URL || "https://" + host;

  // Store the callback URL in the database with a random reference ID
  const refId = crypto.randomBytes(16).toString("hex");
  try {
    const { db } = await import("./db/index");
    const { sql } = await import("drizzle-orm");
    await db.execute(
      sql`INSERT INTO auth_magic_link_refs (ref_id, callback_url, expires_at)
          VALUES (${refId}, ${url}, NOW() + INTERVAL '15 minutes')`
    );
  } catch (err) {
    // If DB storage fails, fall back to direct URL (less safe but functional)
    console.error("Failed to store magic link ref:", err);
    const verifyUrl = baseUrl + "/login/verify?url=" + encodeURIComponent(url);
    const { html, text } = buildMagicLinkBody(verifyUrl);
    const { error } = await resend.emails.send({
      from,
      to: identifier,
      subject: "Get ready to surf SDMX data",
      html,
      text,
    });
    if (error) throw new Error("Failed to send magic link: " + error.message);
    return;
  }

  // The email contains only the ref ID — no auth token or callback URL
  const verifyUrl = baseUrl + "/login/verify?ref=" + refId;
  const { html, text } = buildMagicLinkBody(verifyUrl);

  const { error } = await resend.emails.send({
    from,
    to: identifier,
    subject: "Get ready to surf SDMX data",
    html,
    text,
  });

  if (error) {
    throw new Error("Failed to send magic link: " + error.message);
  }
}

// ---------------------------------------------------------------------------
// Custom email (magic link) provider.
//
// Shaped like @auth/core's HTTP email providers (resend, sendgrid, …): a plain
// `type: "email"` object with our own sendVerificationRequest. Importing
// next-auth/providers/email would pull in nodemailer, which we are removing.
// ---------------------------------------------------------------------------
const emailProvider = {
  id: "email",
  type: "email" as const,
  name: "Email",
  from: process.env.EMAIL_FROM ?? "noreply@example.com",
  maxAge: 15 * 60, // token validity: 15 minutes
  sendVerificationRequest: sendMagicLink,
  options: {},
};

// ---------------------------------------------------------------------------
/**
 * OAuth providers, each registered only when its credentials are configured.
 *
 * Conditional so the app deploys and runs before any provider app exists, and
 * so one can be added or withdrawn by changing environment variables rather
 * than code. `enabledOAuthProviders` drives the sign-in page, which offers only
 * what will actually work.
 *
 * ACCOUNT LINKING BY VERIFIED EMAIL IS DELIBERATE. Every existing account was
 * created by email sign-in and none has an OAuth link, so without linking the
 * first Google or Microsoft sign-in would create a second, empty account and
 * strand that user's dashboards and role. Auth.js calls the option "dangerous"
 * because linking on an unverified email lets someone claim an account by
 * asserting its address; Google, Microsoft and GitHub all verify the address
 * they return, so that path is closed here. It would not be safe for a provider
 * that does not.
 */
const oauthProviders = [
  process.env.AUTH_GOOGLE_ID &&
    GoogleProvider({ allowDangerousEmailAccountLinking: true }),
  process.env.AUTH_MICROSOFT_ENTRA_ID_ID &&
    MicrosoftEntraID({ allowDangerousEmailAccountLinking: true }),
  process.env.AUTH_GITHUB_ID &&
    GitHubProvider({ allowDangerousEmailAccountLinking: true }),
].filter(Boolean) as NonNullable<ReturnType<typeof GoogleProvider>>[];

/**
 * Ask GitHub whether this address is verified on the signing-in account.
 *
 * Costs one API call per GitHub sign-in, on the `user:email` scope the provider
 * already requests. Fails closed on any error: an address we could not confirm
 * is treated as unverified rather than trusted.
 */
async function githubAddressVerified(
  accessToken: unknown,
  email: string,
): Promise<boolean> {
  if (typeof accessToken !== "string" || !accessToken) return false;
  try {
    const res = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: "Bearer " + accessToken,
        Accept: "application/vnd.github+json",
        "User-Agent": "sdmx-surfer",
      },
    });
    if (!res.ok) return false;
    return githubEmailIsVerified(await res.json(), email);
  } catch {
    return false;
  }
}

// NextAuth v5 — handlers + auth() + signIn/signOut, all from one call
// ---------------------------------------------------------------------------
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,

  // Drizzle adapter — map to our custom table names
  adapter: DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    verificationTokensTable: authVerificationTokens,
  }),

  providers: [
    ...oauthProviders,
    emailProvider,

    // Admin-provisioned password sign-in. Users do not self-register here;
    // passwords are set by an admin via the admin panel or CLI, and the user
    // signs in with their email + that password. Allowlist is enforced in
    // the signIn callback (same gate as magic-link).
    CredentialsProvider({
      id: "credentials",
      name: "Password",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials, request) {
        // Generic failure — never signals which part mismatched, to avoid
        // account enumeration and password-oracle attacks.
        const fail = async (
          reason: string,
          email: string | null,
          userId: string | null,
        ): Promise<null> => {
          try {
            await db.insert(authEvents).values({
              user_id: userId,
              email: email ?? "",
              event_type: "login_failure",
              ip: extractIp(request),
              metadata: { reason },
            });
          } catch {
            // audit logging must never block the auth path
          }
          return null;
        };

        const email =
          typeof credentials?.email === "string"
            ? credentials.email.toLowerCase().trim()
            : "";
        const password =
          typeof credentials?.password === "string"
            ? credentials.password
            : "";
        if (!email || !password) return fail("missing_fields", null, null);

        if (await isCredentialAttemptThrottled(email)) {
          return fail("rate_limited", email, null);
        }

        // Same allowlist gate as magic-link sign-in
        const allow = await db
          .select({ email: allowedEmails.email })
          .from(allowedEmails)
          .where(eq(allowedEmails.email, email))
          .limit(1);
        if (allow.length === 0) return fail("not_allowlisted", email, null);

        const rows = await db
          .select()
          .from(authUsers)
          .where(eq(authUsers.email, email))
          .limit(1);
        const user = rows[0];
        if (!user) return fail("no_user", email, null);
        if (!user.password_hash) return fail("no_password_set", email, user.id);

        if (isLocked(user.locked_until)) {
          return fail("locked", email, user.id);
        }

        const ok = await verifyPassword(user.password_hash, password);
        if (!ok) {
          const { locked } = await recordLoginFailure(user.id);
          if (locked) {
            try {
              await db.insert(authEvents).values({
                user_id: user.id,
                email,
                event_type: "account_locked",
                ip: extractIp(request),
              });
            } catch {
              // ignore audit failures
            }
          }
          return fail("bad_password", email, user.id);
        }

        await recordLoginSuccess(user.id);
        try {
          await db.insert(authEvents).values({
            user_id: user.id,
            email,
            event_type: "login_success",
            ip: extractIp(request),
          });
        } catch {
          // ignore audit failures
        }

        return {
          id: user.id,
          email: user.email,
          name: user.name ?? undefined,
        };
      },
    }),
  ],

  callbacks: {
    ...authConfig.callbacks,

    // Admit on any of three grounds: open signup, an institutional domain, or
    // an invite. See lib/signup-policy.
    //
    // A provider can return no email (a GitHub account with every address
    // private). We reject that rather than admitting an identity we cannot
    // link, deduplicate, or contact.
    async signIn({ user, account }) {
      if (!user.email) return false;

      const normalizedEmail = user.email.trim().toLowerCase();

      // GitHub's address is not trustworthy until we check it ourselves. Auth.js
      // uses whatever GitHub returns without inspecting `verified`, and both the
      // domain rule and account linking treat the address as proof of identity.
      // Verified before any rule below, including the break-glass list, so an
      // unverified address cannot reach any of them.
      if (account?.provider === "github") {
        if (!(await githubAddressVerified(account.access_token, normalizedEmail))) {
          return false;
        }
      }

      // Break-glass first, so a locked-out administrator is never gated by a
      // list they can no longer edit.
      if (isBootstrapAdmin(normalizedEmail)) return true;
      if (openSignupEnabled()) return true;

      // Institutional domain, matched exactly against allowed_domains.
      const host = emailDomain(normalizedEmail);
      if (host) {
        const byDomain = await db
          .select({ domain: allowedDomains.domain })
          .from(allowedDomains)
          .where(eq(allowedDomains.domain, host))
          .limit(1);
        if (byDomain.length > 0) return true;
      }

      // Otherwise an individual invite, which is how personal addresses get in.
      const rows = await db
        .select({ email: allowedEmails.email })
        .from(allowedEmails)
        .where(eq(allowedEmails.email, normalizedEmail))
        .limit(1);
      return rows.length > 0;
    },

    // On first sign-in (user object is present), fetch role from DB and store
    // it in the token. Runs in the Node runtime only.
    async jwt({ token, user }) {
      if (user && user.email) {
        const email = user.email.toLowerCase();
        const rows = await db
          .select({ id: authUsers.id, role: authUsers.role })
          .from(authUsers)
          .where(eq(authUsers.email, email))
          .limit(1);
        if (rows.length > 0) {
          token.userId = rows[0].id;
          token.role = rows[0].role;

          // Restore the role on a break-glass account. This covers the case
          // the migration is most likely to produce: a provider returning a
          // slightly different address, so the adapter creates a fresh row
          // with the default role and the administrator quietly becomes an
          // ordinary user with no way back.
          if (isBootstrapAdmin(email) && rows[0].role !== "admin") {
            await db
              .update(authUsers)
              .set({ role: "admin" })
              .where(eq(authUsers.id, rows[0].id));
            token.role = "admin";
          }
        }
      }
      return token;
    },
  },
});
