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
import { DrizzleAdapter } from "@auth/drizzle-adapter";
import { eq } from "drizzle-orm";
import { db, authUsers, authAccounts, authVerificationTokens, allowedEmails } from "./db/index";

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
// Resend email sender
// ---------------------------------------------------------------------------
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
  const { Resend } = await import("resend");
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.EMAIL_FROM || "noreply@example.com";
  const host = new URL(url).host;
  const subject = "Sign in to " + host;
  const body =
    "<p>Click the link below to sign in to the SPC Dashboard Builder:</p>" +
    '<p><a href="' + url + '">Sign in</a></p>' +
    "<p>This link expires in 15 minutes and can only be used once.</p>" +
    "<p>If you did not request this, you can safely ignore this email.</p>";

  const { error } = await resend.emails.send({
    from,
    to: identifier,
    subject,
    html: body,
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
