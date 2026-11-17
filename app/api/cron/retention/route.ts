import { NextResponse } from "next/server";
import { cronAuthorized, runRetention } from "@/lib/retention";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// ---------------------------------------------------------------------------
// GET /api/cron/retention — daily purge, triggered by Vercel Cron (vercel.json)
// ---------------------------------------------------------------------------
// Outside the proxy.ts matcher and the CSRF/auth() pattern: the caller is
// Vercel Cron, not a signed-in browser, so the CRON_SECRET bearer is the gate.

export async function GET(req: Request) {
  if (!cronAuthorized(req.headers.get("authorization"), process.env.CRON_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const deleted = await runRetention();
    // Counts only: nothing that identifies a person reaches the logs.
    console.log("[cron/retention] done:", JSON.stringify(deleted));
    return NextResponse.json({ deleted });
  } catch (err) {
    // Postgres keeps row values in the error's detail, not its message.
    console.error("[cron/retention] failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
