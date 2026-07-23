/**
 * Edge-safe base Auth.js (NextAuth v5) configuration.
 *
 * This file is imported by BOTH the Node-runtime auth (`lib/auth.ts`) and the
 * edge-runtime middleware (`proxy.ts`). It must therefore stay free of any
 * Node-only dependency: no database client, no `@node-rs/argon2` (pulled in by
 * `lib/password.ts`), no `node:crypto`. The DB adapter and the real providers
 * live in `lib/auth.ts`, which runs only in the Node runtime.
 *
 * The middleware uses this config to decode the session JWT and gate routes
 * via the `authorized` callback; it never runs a provider's `authorize`.
 */

import type { NextAuthConfig, DefaultSession } from "next-auth";

// ---------------------------------------------------------------------------
// Module augmentation: extend Session / JWT with role + userId
// ---------------------------------------------------------------------------
declare module "next-auth" {
  interface Session {
    user: {
      userId: string;
      role: string;
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    userId?: string;
    role?: string;
  }
}

export const authConfig = {
  // Behind Vercel's proxy; trust the forwarded host instead of requiring
  // AUTH_URL. Read the v5 secret name, falling back to the v4 name so no
  // environment variables need renaming during the migration.
  trustHost: true,
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,

  // JWT sessions (no database session table; works in the edge middleware).
  session: { strategy: "jwt" },

  pages: {
    signIn: "/login",
    verifyRequest: "/login?verify=1",
  },

  // Real providers (email magic link, credentials) are added in lib/auth.ts.
  // The middleware only decodes the existing JWT, so it needs none here.
  providers: [],

  callbacks: {
    // Middleware gate: allow only requests carrying a valid session. The
    // matcher in proxy.ts already excludes public routes, so any matched
    // request without a user is redirected to the sign-in page (with a
    // callbackUrl) by Auth.js.
    authorized({ auth }) {
      return Boolean(auth?.user);
    },

    // Copy userId/role from the token into the session. Edge-safe (no DB):
    // the values were baked into the token at sign-in by the jwt callback
    // in lib/auth.ts.
    session({ session, token }) {
      if (token.userId) {
        session.user.userId = token.userId as string;
      }
      if (token.role) {
        session.user.role = token.role as string;
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
