import { handlers } from "@/lib/auth";
import { NextResponse } from "next/server";

// Wrap GET to handle HEAD requests from corporate email link scanners
// (e.g., Outlook SafeLinks) which would otherwise consume the magic link token.
const originalGet = handlers.GET;

async function wrappedGet(req: Request, ctx: unknown) {
  if (req.method === "HEAD") {
    return new NextResponse(null, { status: 200 });
  }
  return (originalGet as (req: Request, ctx: unknown) => Promise<Response>)(req, ctx);
}

export const GET = wrappedGet;
export const { POST } = handlers;
