/**
 * Seed `allowed_domains`.
 *
 * Idempotent: existing rows are left alone, so it is safe to re-run after
 * adding entries below or editing them in the admin panel.
 *
 * Usage:  npx tsx scripts/seed-allowed-domains.mts          (dry run)
 *         npx tsx scripts/seed-allowed-domains.mts --write
 *
 * TWO RULES FOR ANYTHING ADDED HERE.
 *
 * Verify the domain before adding it. Every entry below is either observed in
 * the existing user and invite tables, or is the well-known primary domain of
 * the organisation named. A guessed domain is worse than a missing one: it
 * either does nothing, or it admits a domain somebody else owns.
 *
 * Enumerate rather than react. Adding domains as requests arrive produces a
 * list shaped by who asked first, which across 22 PICTs reads as favouritism
 * whatever the intent. The unverified block at the bottom names the gaps so
 * they stay visible instead of being quietly absent.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { isPersonalEmailDomain, normaliseDomain } from "../lib/signup-policy";

// Imported dynamically, after dotenv has run. `lib/db` reads DATABASE_URL at
// module load, and ESM evaluates every static import before any statement in
// this file, so a static import here would initialise the client against the
// placeholder URL and fail with a bare "fetch failed". The dry-run path never
// touches the database, so it would keep reporting success while --write broke.
const { db, allowedDomains } = await import("../lib/db");

interface Seed {
  domain: string;
  organisation: string;
  note: string;
}

/**
 * Observed in this deployment's own users and invites, so these are known to
 * be real and in use rather than inferred.
 */
const OBSERVED: Seed[] = [
  { domain: "spc.int", organisation: "Pacific Community (SPC)", note: "observed: 39 users/invites" },
  { domain: "statsfiji.gov.fj", organisation: "Fiji Bureau of Statistics", note: "observed: 12" },
  { domain: "oecd.org", organisation: "OECD", note: "observed: 8" },
  { domain: "un.org", organisation: "United Nations", note: "observed: 8" },
  { domain: "stats.govt.nz", organisation: "Stats NZ", note: "observed: 6" },
  { domain: "statec.etat.lu", organisation: "STATEC Luxembourg", note: "observed: 4" },
  { domain: "ilo.org", organisation: "International Labour Organization", note: "observed: 3" },
  { domain: "abs.gov.au", organisation: "Australian Bureau of Statistics", note: "observed: 2" },
  { domain: "bis.org", organisation: "Bank for International Settlements", note: "observed: 2" },
  { domain: "unicef.org", organisation: "UNICEF", note: "observed: 2" },
];

/**
 * Partner governments and regional and international organisations, by their
 * well-known primary domain. Named in the brief or adjacent to it.
 */
const PARTNERS: Seed[] = [
  { domain: "mfat.govt.nz", organisation: "New Zealand Ministry of Foreign Affairs and Trade", note: "partner: named in scope" },
  { domain: "dfat.gov.au", organisation: "Australian Department of Foreign Affairs and Trade", note: "partner: named in scope" },
  { domain: "forumsec.org", organisation: "Pacific Islands Forum Secretariat", note: "regional organisation (CROP)" },
  { domain: "sprep.org", organisation: "Secretariat of the Pacific Regional Environment Programme", note: "regional organisation (CROP)" },
  { domain: "usp.ac.fj", organisation: "University of the South Pacific", note: "regional institution" },
  { domain: "adb.org", organisation: "Asian Development Bank", note: "international financial institution" },
  { domain: "worldbank.org", organisation: "World Bank", note: "international financial institution" },
  { domain: "imf.org", organisation: "International Monetary Fund", note: "international financial institution" },
  { domain: "who.int", organisation: "World Health Organization", note: "UN agency" },
  { domain: "fao.org", organisation: "Food and Agriculture Organization", note: "UN agency" },
  { domain: "undp.org", organisation: "United Nations Development Programme", note: "UN agency" },
  { domain: "unfpa.org", organisation: "United Nations Population Fund", note: "UN agency" },
  { domain: "unesco.org", organisation: "UNESCO", note: "UN agency" },
  { domain: "unwomen.org", organisation: "UN Women", note: "UN agency" },
  { domain: "iom.int", organisation: "International Organization for Migration", note: "UN-related organisation" },
  { domain: "unhcr.org", organisation: "UN Refugee Agency", note: "UN agency" },
  { domain: "wfp.org", organisation: "World Food Programme", note: "UN agency" },
];

/**
 * Member NSOs whose mail domain this script does NOT assert.
 *
 * Listed so the gaps are visible and someone can fill them from a source
 * rather than from memory. Confirm each against the office's own site or an
 * address you have received mail from, then move it into OBSERVED with a note
 * saying how it was confirmed.
 *
 * Fiji is absent because it is already confirmed above.
 */
const NEEDS_CONFIRMATION = [
  "American Samoa", "Cook Islands", "Federated States of Micronesia",
  "French Polynesia", "Guam", "Kiribati", "Marshall Islands", "Nauru",
  "New Caledonia", "Niue", "Northern Mariana Islands", "Palau",
  "Papua New Guinea", "Pitcairn Islands", "Samoa", "Solomon Islands",
  "Tokelau", "Tonga", "Tuvalu", "Vanuatu", "Wallis and Futuna",
];

async function main() {
  const write = process.argv.includes("--write");
  const seeds = [...OBSERVED, ...PARTNERS];

  // A consumer domain here would open the service to everyone while looking
  // like an ordinary row.
  const personal = seeds.filter((s) => isPersonalEmailDomain(s.domain));
  if (personal.length) {
    console.error("Refusing to seed personal domains: " +
      personal.map((s) => s.domain).join(", "));
    process.exit(1);
  }

  const duplicates = seeds
    .map((s) => normaliseDomain(s.domain))
    .filter((d, i, all) => all.indexOf(d) !== i);
  if (duplicates.length) {
    console.error("Duplicate domains in the seed: " + duplicates.join(", "));
    process.exit(1);
  }

  console.log(String(seeds.length) + " domains to seed (" +
    String(OBSERVED.length) + " observed, " + String(PARTNERS.length) + " partner)");
  for (const s of seeds) {
    console.log("  " + s.domain.padEnd(22) + s.organisation);
  }

  if (!write) {
    console.log("\nDry run. Re-run with --write to apply.");
  } else {
    // onConflictDoNothing: never overwrite a row someone curated by hand.
    await db
      .insert(allowedDomains)
      .values(seeds.map((s) => ({
        domain: normaliseDomain(s.domain),
        organisation: s.organisation,
        note: s.note,
      })))
      .onConflictDoNothing();
    const rows = await db.select({ domain: allowedDomains.domain }).from(allowedDomains);
    console.log("\nWrote. allowed_domains now holds " + String(rows.length) + " rows.");
  }

  console.log("\nStill to confirm, one NSO mail domain each (" +
    String(NEEDS_CONFIRMATION.length) + "):");
  console.log("  " + NEEDS_CONFIRMATION.join(", "));
  console.log(
    "\nThese are not guesses waiting to be approved; nothing is asserted for\n" +
    "them. Confirm from the office's own site or from mail you have received,\n" +
    "then add via the admin panel or move into OBSERVED in this file.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
