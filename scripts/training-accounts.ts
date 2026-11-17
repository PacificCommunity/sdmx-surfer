#!/usr/bin/env npx tsx
/**
 * Wind down the accounts handed out by /training.
 *
 * Two endings, because the work made during a workshop usually outlives the
 * people's access to it:
 *
 *   --park    revoke sign-in, keep every dashboard. The accounts stay as the
 *             owners of what they built, so nothing in the gallery breaks.
 *   --delete  delete the accounts the way Settings does (lib/account-deletion):
 *             dashboards unpublished and erased by the retention job after
 *             30 days, sign-in removed. Their usage_logs rows are kept, because
 *             their cost counts toward the global AI budget.
 *
 * Parking drops the allowlist row and clears the password, so no trainee can
 * sign in again. Sessions already open are re-checked against the allowlist
 * every 5 minutes (lib/session-revalidation.ts) and end within that window.
 *
 * Run it after switching TRAINING_MODE off. It only ever matches addresses on
 * the trainee subdomain, so no real account can be caught by it.
 *
 * Usage:
 *   npx tsx scripts/training-accounts.ts            # report only
 *   npx tsx scripts/training-accounts.ts --park     # revoke sign-in, keep work
 *   npx tsx scripts/training-accounts.ts --delete   # delete accounts, keep usage costs
 */

import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

import { sql } from "@vercel/postgres";
import { TRAINEE_EMAIL_DOMAIN } from "../lib/training-access";

const PATTERN = "trainee-%@" + TRAINEE_EMAIL_DOMAIN;
const park = process.argv.includes("--park");
const remove = process.argv.includes("--delete");

async function main() {
  const { rows } = await sql`
    SELECT id, email FROM auth_users WHERE email LIKE ${PATTERN}
  `;
  const dashboards = await sql`
    SELECT count(*)::int AS n FROM dashboard_sessions
    WHERE user_id IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})
  `;
  console.log("Trainee accounts: " + rows.length);
  console.log("Their dashboards: " + dashboards.rows[0].n);
  if (rows.length === 0) return;

  if (!park && !remove) {
    console.log(rows.map((r) => "  " + r.email).join("\n"));
    console.log("\n--park keeps the dashboards and revokes sign-in.");
    console.log("--delete deletes the accounts and their dashboards; usage costs are kept.");
    return;
  }

  if (park) {
    await sql`DELETE FROM allowed_emails WHERE email LIKE ${PATTERN}`;
    const cleared = await sql`
      UPDATE auth_users
      SET password_hash = NULL, failed_attempts = 0, locked_until = NULL
      WHERE email LIKE ${PATTERN}
    `;
    console.log(
      "Parked " + cleared.rowCount + " accounts: allowlist row dropped and " +
        "password cleared. Their " + dashboards.rows[0].n + " dashboards are untouched.",
    );
    console.log("Sessions already open are signed out within 5 minutes, at their next re-check.");
    return;
  }

  // Same path as self-service deletion, one account at a time. The rows stay
  // as anonymous owners of their usage_logs, so the spend they caused is never
  // lost from the budget. lib/db reads the database URL at import time, hence
  // the dynamic import after dotenv.
  const { deleteAccount } = await import("../lib/account-deletion");
  let deleted = 0;
  for (const row of rows) {
    if (await deleteAccount(row.id as string, null)) deleted += 1;
  }
  console.log(
    "Deleted " + deleted + " trainee accounts. Their dashboards are unpublished and " +
      "erased by the retention job after 30 days; their usage costs are kept.",
  );
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
