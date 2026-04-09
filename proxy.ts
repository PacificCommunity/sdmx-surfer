import { withAuth } from "next-auth/middleware";

export default withAuth({
  pages: {
    signIn: "/login",
  },
});

export const config = {
  matcher: [
    "/((?!api/auth|api/public|_next/static|_next/image|favicon.ico|models/|login|gallery(?:/|$)|p(?:/|$)).*)",
  ],
};
