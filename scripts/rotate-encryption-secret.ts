/**
 * Re-encrypt stored BYOK keys under the current ENCRYPTION_SECRET.
 *
 * Rotation:
 *   1. Set ENCRYPTION_SECRET_PREVIOUS to the old secret and ENCRYPTION_SECRET
 *      to a new one (openssl rand -hex 32), in Vercel and in .env.local, and
 *      redeploy. The app now writes with the new secret and still reads keys
 *      written with the old one.
 *   2. Run this script with --apply. Every user_api_keys row that only the
 *      previous secret opens is decrypted and encrypted again with the
 *      current one. Rows already on the current secret are left as they are.
 *   3. When a dry run reports no rows on the previous secret, remove
 *      ENCRYPTION_SECRET_PREVIOUS and redeploy.
 *
 * Rows neither secret opens are reported and left alone: nothing can recover
 * them, and the settings page already asks their owners to re-enter the key.
 * A row changed between read and write (the user saved a new key) is skipped
 * and reported; run again to pick it up. Key material is never printed.
 *
 * Usage:  npx tsx scripts/rotate-encryption-secret.ts           (dry run)
 *         npx tsx scripts/rotate-encryption-secret.ts --apply
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, eq } from "drizzle-orm";
import {
  decryptApiKeyWithGeneration,
  encryptApiKey,
} from "../lib/encryption";

async function main() {
  const apply = process.argv.includes("--apply");

  if (!process.env.ENCRYPTION_SECRET) {
    console.error("ENCRYPTION_SECRET is not set.");
    process.exit(1);
  }
  if (!process.env.ENCRYPTION_SECRET_PREVIOUS) {
    console.log(
      "ENCRYPTION_SECRET_PREVIOUS is not set: only rows readable with the current secret " +
        "can be checked, and none need re-encrypting.",
    );
  }

  // Imported dynamically, after dotenv has run: `lib/db` reads the database
  // URL at module load, and static imports are evaluated before config().
  const { db, userApiKeys } = await import("../lib/db");

  const rows = await db
    .select({
      user_id: userApiKeys.user_id,
      provider: userApiKeys.provider,
      encrypted_key: userApiKeys.encrypted_key,
    })
    .from(userApiKeys);

  let current = 0;
  const previous: typeof rows = [];
  const unreadable: string[] = [];
  for (const row of rows) {
    try {
      const { generation } = decryptApiKeyWithGeneration(row.encrypted_key, row.provider);
      if (generation === "current") current += 1;
      else previous.push(row);
    } catch {
      unreadable.push(row.user_id + " / " + row.provider);
    }
  }

  console.log(
    String(rows.length) + " keys: " + String(current) + " on the current secret, " +
      String(previous.length) + " on the previous secret, " +
      String(unreadable.length) + " unreadable.",
  );
  if (unreadable.length > 0) {
    console.log("Unreadable (owner must re-enter):\n  " + unreadable.join("\n  "));
  }

  if (!apply) {
    if (previous.length > 0) console.log("\nDry run. Re-run with --apply to re-encrypt.");
    return;
  }

  let written = 0;
  const skipped: string[] = [];
  for (const row of previous) {
    const { plaintext } = decryptApiKeyWithGeneration(row.encrypted_key, row.provider);
    const reEncrypted = encryptApiKey(plaintext, row.provider);
    // Optimistic check: skip a row the user replaced since it was read.
    // updated_at is left alone; the key itself has not changed.
    const updated = await db
      .update(userApiKeys)
      .set({ encrypted_key: reEncrypted })
      .where(
        and(
          eq(userApiKeys.user_id, row.user_id),
          eq(userApiKeys.provider, row.provider),
          eq(userApiKeys.encrypted_key, row.encrypted_key),
        ),
      )
      .returning({ user_id: userApiKeys.user_id });
    if (updated.length === 1) {
      written += 1;
    } else {
      skipped.push(row.user_id + " / " + row.provider);
    }
  }

  console.log("\nRe-encrypted " + String(written) + " keys.");
  if (skipped.length > 0) {
    console.log("Skipped, changed since read (run again):\n  " + skipped.join("\n  "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
