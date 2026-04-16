#!/usr/bin/env npx tsx
/**
 * Set (or reset) a password for an invited user from the CLI.
 *
 * Usage:
 *   npx tsx scripts/set-password.ts user@example.com          # auto-generate
 *   npx tsx scripts/set-password.ts user@example.com --ask    # prompt for one
 *
 * Rules:
 *   - The email must already be on the allowlist. (Use add-pilot-user first.)
 *   - If the auth_users row doesn't exist yet, this script creates it.
 *   - Any existing password is overwritten. Failed-attempt counters and
 *     lockouts are cleared.
 *   - The plaintext password is printed to stdout ONCE. Pass it to the user
 *     over a trusted channel (Teams, work email, in person).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// @vercel/postgres looks for POSTGRES_URL, not DATABASE_URL
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { randomUUID } from "node:crypto";
import { sql } from "@vercel/postgres";
import { generatePassphrase } from "../lib/passphrase";
import { hashPassword, validatePasswordShape } from "../lib/password";

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const askForPassword = args.includes("--ask");

if (!email) {
  console.error(
    "Usage: npx tsx scripts/set-password.ts user@example.com [--ask]",
  );
  process.exit(1);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!EMAIL_RE.test(email)) {
  console.error("Error: '" + email + "' does not look like a valid email.");
  process.exit(1);
}
const normalizedEmail = email.toLowerCase();

async function readPasswordFromStdin(): Promise<string> {
  const rl = createInterface({ input, output });
  try {
    const value = await rl.question("Enter password (min 12 chars): ");
    return value;
  } finally {
    rl.close();
  }
}

async function main() {
  // 1. Check allowlist
  const allowRows = await sql`
    SELECT 1 FROM allowed_emails WHERE email = ${normalizedEmail} LIMIT 1
  `;
  if (allowRows.rows.length === 0) {
    console.error(
      "Error: " +
        normalizedEmail +
        " is not on the allowlist.\n" +
        "Add them first: npx tsx scripts/add-pilot-user.ts " +
        normalizedEmail,
    );
    process.exit(1);
  }

  // 2. Obtain a passphrase
  let passphrase: string;
  let generated = false;
  if (askForPassword) {
    passphrase = await readPasswordFromStdin();
    const shape = validatePasswordShape(passphrase);
    if (!shape.ok) {
      console.error("Error: " + shape.reason);
      process.exit(1);
    }
  } else {
    passphrase = generatePassphrase();
    generated = true;
  }

  // 3. Hash and upsert
  const userId = randomUUID();
  const hash = await hashPassword(passphrase);
  await sql`
    INSERT INTO auth_users (id, email, password_hash, failed_attempts, locked_until)
    VALUES (${userId}, ${normalizedEmail}, ${hash}, 0, NULL)
    ON CONFLICT (email) DO UPDATE SET
      password_hash = EXCLUDED.password_hash,
      failed_attempts = 0,
      locked_until = NULL
  `;

  // 4. Audit
  await sql`
    INSERT INTO auth_events (user_id, email, event_type, actor_user_id, metadata)
    SELECT id, ${normalizedEmail}, 'password_set', NULL, ${JSON.stringify({ via: "cli" })}::jsonb
    FROM auth_users WHERE email = ${normalizedEmail}
  `;

  // 5. Report
  console.log("\nPassword " + (generated ? "generated" : "set") + " for " + normalizedEmail + ":\n");
  console.log("  " + passphrase + "\n");
  console.log("Share this with the user over a trusted channel (Teams,");
  console.log("work email, in person). They sign in at /login using the");
  console.log("'Sign in with a password instead' option.\n");
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nFailed: " + message);
  process.exit(1);
});
