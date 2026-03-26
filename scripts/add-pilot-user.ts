#!/usr/bin/env npx tsx
/**
 * Add a pilot user to the allowlist (and optionally as an admin).
 *
 * Usage:
 *   npx tsx scripts/add-pilot-user.ts user@example.com [--admin]
 *
 * Reads DATABASE_URL from .env.local and maps it to POSTGRES_URL
 * (which is what @vercel/postgres expects).
 */

import { config } from "dotenv";
config({ path: ".env.local" });

// @vercel/postgres looks for POSTGRES_URL, not DATABASE_URL
if (!process.env.POSTGRES_URL && process.env.DATABASE_URL) {
  process.env.POSTGRES_URL = process.env.DATABASE_URL;
}

import { sql } from "@vercel/postgres";

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

const args = process.argv.slice(2);
const email = args.find((a) => !a.startsWith("--"));
const isAdmin = args.includes("--admin");

if (!email) {
  console.error(
    "Usage: npx tsx scripts/add-pilot-user.ts user@example.com [--admin]",
  );
  process.exit(1);
}

// Basic email validation
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
if (!EMAIL_RE.test(email)) {
  console.error("Error: '" + email + "' does not look like a valid email address.");
  process.exit(1);
}

const normalizedEmail = email.toLowerCase();

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("Adding pilot user: " + normalizedEmail + (isAdmin ? " (admin)" : "") + "\n");

  // 1. Insert into allowed_emails (allowlist)
  await sql`
    INSERT INTO allowed_emails (email)
    VALUES (${normalizedEmail})
    ON CONFLICT DO NOTHING
  `;
  console.log("  allowed_emails: " + normalizedEmail + " added (or already present).");

  // 2. If --admin, upsert into auth_users with role='admin'
  if (isAdmin) {
    await sql`
      INSERT INTO auth_users (id, email, role)
      VALUES (gen_random_uuid(), ${normalizedEmail}, 'admin')
      ON CONFLICT (email) DO UPDATE SET role = 'admin'
    `;
    console.log("  auth_users:     " + normalizedEmail + " role set to admin.");
  }

  console.log("\nDone.");
  process.exit(0);
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.message : String(err);
  console.error("\nFailed: " + message);
  process.exit(1);
});
