import NextAuth from "next-auth";
import { authConfig } from "./lib/auth.config";

// Edge middleware: decode the session JWT and gate routes via the `authorized`
// callback in authConfig. Uses ONLY the edge-safe base config (no DB adapter,
// no native crypto), so the full provider set in lib/auth.ts never reaches the
// edge bundle. Unauthenticated requests to matched routes are redirected to
// /login with a callbackUrl by Auth.js.
export default NextAuth(authConfig).auth;

export const config = {
  matcher: [
    "/((?!api/auth|api/public|api/sdmx-proxy|api/countrysnapshots|countrysnapshots|_next/static|_next/image|favicon.ico|models/|login|gallery(?:/|$)|p(?:/|$)).*)",
  ],
};
