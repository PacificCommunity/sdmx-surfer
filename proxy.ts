import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "./lib/auth.config";
import { loginPathWithCallback } from "./lib/login-redirect";

// Edge middleware: decode the session JWT and gate routes via the `authorized`
// callback in authConfig. Uses ONLY the edge-safe base config (no DB adapter,
// no native crypto), so the full provider set in lib/auth.ts never reaches the
// edge bundle.
//
// Signed-out page requests get a relative callbackUrl (pathname + search).
// Auth.js's own redirect puts the ABSOLUTE request URL there, which the login
// page rejects as off-origin, so a visitor would land on "/" after signing in
// instead of the dashboard or snapshot they asked for.
//
// API requests keep Auth.js's default handling. /api/countrysnapshots stays
// outside the matcher: its routes call auth() themselves and answer fetches
// with a JSON 401 (the fork link builds its own relative /login round-trip).
export default NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    authorized(params) {
      const { auth, request } = params;
      const { pathname, search } = request.nextUrl;
      const isApi = pathname === "/api" || pathname.startsWith("/api/");
      if (!auth?.user && !isApi) {
        return NextResponse.redirect(
          new URL(loginPathWithCallback(pathname + search), request.nextUrl),
        );
      }
      return authConfig.callbacks.authorized(params);
    },
  },
}).auth;

export const config = {
  matcher: [
    "/((?!api/auth|api/public|api/sdmx-proxy|api/countrysnapshots|api/training|training(?:/|$)|_next/static|_next/image|favicon.ico|models/|brand/|login|gallery(?:/|$)|p(?:/|$)).*)",
  ],
};
