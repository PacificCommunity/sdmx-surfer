#!/usr/bin/env npx tsx
/**
 * Wind down the accounts handed out by /training.
 *
 * Two endings, because the work made during a workshop usually outlives the
 * people's access to it:
 *
 *   --park    revoke sign-in, keep every dashboard. The accounts stay as the
 *             owners of what they built, so nothing in the gallery breaks.
 *   --delete  remove the accounts and everything they made.
 *
 * Parking drops the allowlist row and clears the password, so no trainee can
 * sign in again. It does NOT end sessions already open in a browser: nothing
 * re-checks the allowlist after sign-in, so a tab left open keeps working
 * until its cookie expires. Rotate NEXTAUTH_SECRET to cut those too.
 *
 * Run it after switching TRAINING_MODE off. It only ever matches addresses on
 * the trainee subdomain, so no real account can be caught by it.
 *
 * Usage:
 *   npx tsx scripts/training-accounts.ts            # report only
 *   npx tsx scripts/training-accounts.ts --park     # revoke sign-in, keep work
 *   npx tsx scripts/training-accounts.ts --delete   # remove accounts and work
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
    console.log("--delete removes the accounts and the dashboards.");
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
    console.log(
      "Sessions already open keep working until their cookie expires; " +
        "rotate NEXTAUTH_SECRET to end those now.",
    );
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
