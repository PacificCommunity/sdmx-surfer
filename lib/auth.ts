/**
 * NextAuth v4 configuration with Drizzle adapter and Resend magic links.
 *
 * NOTE: This project uses next-auth v4 (not Auth.js v5).
 * - No built-in Resend provider in v4; we use EmailProvider with a custom
 *   sendVerificationRequest that calls the Resend SDK directly.
 * - NextAuth() in v4 returns a handler function, not { handlers, auth, signIn, signOut }.
 *   We expose a `handlers` object shaped { GET, POST } for App Router compatibility,
 *   plus re-export authOptions for getServerSession() calls elsewhere.
 */

import NextAuth, { type NextAuthOptions, type DefaultSession } from "next-auth";
import { getServerSession } from "next-auth/next";
import EmailProvider from "next-auth/providers/email";
import CredentialsProvider from "next-auth/providers/credentials";
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import {
  db,
  authUsers,
  authAccounts,
  authVerificationTokens,
  authEvents,
  allowedEmails,
} from "./db/index";
import {
  verifyPassword,
  isLocked,
  recordLoginSuccess,
  recordLoginFailure,
} from "./password";

// ---------------------------------------------------------------------------
// Module augmentation: extend Session / JWT types with role + userId
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    user: {
      userId: string;
      role: string;
    } & DefaultSession["user"];
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    role?: string;
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type MaybeHeaders = Record<string, string | string[] | undefined> | undefined;

function extractIp(
  req: { headers?: MaybeHeaders } | undefined,
): string | null {
  const headers = req?.headers;
  if (!headers) return null;
  const raw =
    headers["x-forwarded-for"] ??
    headers["x-real-ip"] ??
    headers["X-Forwarded-For"];
  if (!raw) return null;
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str) return null;
  // x-forwarded-for may contain a comma-separated chain; take the first entry
  const first = str.split(",")[0]?.trim();
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
  provider: { from: string };
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
  // consuming the single-use NextAuth token before the user clicks.
  const { Resend } = await import("resend");
  const crypto = await import("node:crypto");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM || "noreply@example.com";
  const host = new URL(url).host;
  const baseUrl = process.env.NEXTAUTH_URL || "https://" + host;

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
// Auth options
// ---------------------------------------------------------------------------
export const authOptions: NextAuthOptions = {
  // Drizzle adapter — map to our custom table names
  adapter: DrizzleAdapter(db, {
    usersTable: authUsers,
    accountsTable: authAccounts,
    verificationTokensTable: authVerificationTokens,
  }),

  // JWT sessions (no database sessions table required)
  session: {
    strategy: "jwt",
  },

  // Custom pages
  pages: {
    signIn: "/login",
    verifyRequest: "/login?verify=1",
  },

  providers: [
    EmailProvider({
      from: process.env.EMAIL_FROM ?? "noreply@example.com",
      maxAge: 15 * 60, // 15 minutes
      sendVerificationRequest: sendMagicLink,
    }),

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
      async authorize(credentials, req) {
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
              ip: extractIp(req),
              metadata: { reason },
            });
          } catch {
            // audit logging must never block the auth path
          }
          return null;
        };

        const email = credentials?.email?.toLowerCase().trim();
        const password = credentials?.password;
        if (!email || !password) return fail("missing_fields", null, null);

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
                ip: extractIp(req),
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
            ip: extractIp(req),
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
    // Block sign-in for emails not in the allowlist
    async signIn({ user }) {
      if (!user.email) return false;
      const normalizedEmail = user.email.toLowerCase();
      const rows = await db
        .select({ email: allowedEmails.email })
        .from(allowedEmails)
        .where(eq(allowedEmails.email, normalizedEmail))
        .limit(1);
      return rows.length > 0;
    },

    // On first sign-in (user object is present), fetch role from DB and store in token
    async jwt({ token, user }) {
      if (user && user.email) {
        const rows = await db
          .select({ id: authUsers.id, role: authUsers.role })
          .from(authUsers)
          .where(eq(authUsers.email, user.email.toLowerCase()))
          .limit(1);
        if (rows.length > 0) {
          token.userId = rows[0].id;
          token.role = rows[0].role;
        }
      }
      return token;
    },

    // Copy userId and role from token into session
    async session({ session, token }) {
      if (token.userId) {
        session.user.userId = token.userId;
      }
      if (token.role) {
        session.user.role = token.role;
      }
      return session;
    },
  },
};

// ---------------------------------------------------------------------------
// NextAuth handler and convenience exports
//
// next-auth v4: NextAuth(options) returns a single handler function that
// handles both GET and POST.  Wrap it into a { GET, POST } shape so the
// App Router route file can do:
//   export const { GET, POST } = handlers;
// ---------------------------------------------------------------------------
const handler = NextAuth(authOptions);

export const handlers = {
  GET: handler,
  POST: handler,
} as const;

// Re-export a typed getServerSession helper bound to authOptions
export const auth = () => getServerSession(authOptions);

// Stub exports for sign-in / sign-out (callers can use next-auth/react or
// redirect to /api/auth/signin / /api/auth/signout directly in v4).
export { signIn, signOut } from "next-auth/react";
