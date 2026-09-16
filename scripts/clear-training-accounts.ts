#!/usr/bin/env npx tsx
/**
 * Remove the accounts handed out by /training, and everything they made.
 *
 * Run this when the workshop is over, after switching TRAINING_MODE off. It
 * only ever touches addresses on the trainee subdomain, so no real account can
 * be caught by it.
 *
 * Usage:
 *   npx tsx scripts/clear-training-accounts.ts            # count only
 *   npx tsx scripts/clear-training-accounts.ts --yes      # delete
 */

import { config } from "dotenv";
config({ path: ".env.local" });

if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

import { sql } from "@vercel/postgres";
import { TRAINEE_EMAIL_DOMAIN } from "../lib/training-access";

const PATTERN = "trainee-%@" + TRAINEE_EMAIL_DOMAIN;
const confirmed = process.argv.includes("--yes");

async function main() {
  const { rows } = await sql`
    SELECT id, email FROM auth_users WHERE email LIKE ${PATTERN}
  `;
  console.log("Trainee accounts found: " + rows.length);
  if (rows.length === 0) return;

  if (!confirmed) {
    console.log(rows.map((r) => "  " + r.email).join("\n"));
    console.log("\nRe-run with --yes to delete these and their dashboards.");
    return;
  }

  // Dependents first: every table that points at auth_users.id.
  await sql`DELETE FROM usage_logs WHERE user_id IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})`;
  await sql`DELETE FROM dashboard_sessions WHERE user_id IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})`;
  await sql`DELETE FROM user_api_keys WHERE user_id IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})`;
  await sql`DELETE FROM auth_accounts WHERE "userId" IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})`;
  await sql`DELETE FROM auth_events WHERE user_id IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})
              OR actor_user_id IN (SELECT id FROM auth_users WHERE email LIKE ${PATTERN})`;
  await sql`DELETE FROM allowed_emails WHERE email LIKE ${PATTERN}`;
  const deleted = await sql`DELETE FROM auth_users WHERE email LIKE ${PATTERN}`;

  console.log("Deleted " + deleted.rowCount + " trainee accounts and their dashboards.");
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
