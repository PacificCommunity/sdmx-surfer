import { db, usageLogs } from "@/lib/db";
import { and, eq, gte } from "drizzle-orm";

const DEFAULT_DAILY_TURNS = 10;

function dailyTurnCap(): number {
  const v = Number(process.env.SNAPSHOT_CHAT_DAILY_TURNS ?? "");
  if (!Number.isFinite(v) || v <= 0) return DEFAULT_DAILY_TURNS;
  return Math.floor(v);
}

/**
 * Count usage_logs rows attributed to a snapshot anonymous user in the last
 * 24 hours. Each completed chat turn writes one row, so this equals the
 * turn count.
 */
export async function checkTurnCap(userId: string): Promise<{
  allowed: boolean;
  used: number;
  cap: number;
}> {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ id: usageLogs.id })
    .from(usageLogs)
    .where(and(eq(usageLogs.user_id, userId), gte(usageLogs.created_at, since)));
  const used = rows.length;
  const cap = dailyTurnCap();
  return { allowed: used < cap, used, cap };
}
