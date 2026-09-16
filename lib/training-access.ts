/**
 * Temporary training-day access.
 *
 * A workshop needs ~100 people signed in within a few minutes, with no inbox
 * round trip and no shared account. One shared code, typed on /training, hands
 * each participant their own throwaway account, so everyone gets their own
 * sessions, their own turn cap, and nobody can lock anyone else out.
 *
 * Every door here stays shut unless TRAINING_MODE is switched on AND a code is
 * configured, so the route does not exist on an ordinary deployment. Turn the
 * mode off when the workshop ends; `scripts/clear-training-accounts.ts` removes
 * the accounts themselves.
 *
 * The addresses live on a subdomain that receives no mail. Nothing is ever sent
 * to them: these accounts sign in by password, never by magic link.
 */

import { createHash, timingSafeEqual } from "node:crypto";

export const TRAINEE_EMAIL_DOMAIN = "training.sdmxsurfer.net";

/**
 * Ceiling on accounts this route will ever create. A leaked code then costs at
 * most the remainder of the pool rather than an unbounded number of accounts,
 * each of which can spend model budget.
 */
export const MAX_TRAINEES = 200;

const TRAINEE_ADDRESS = new RegExp(
  "^trainee-(\\d{2,3})@" + TRAINEE_EMAIL_DOMAIN.replace(/\./g, "\\.") + "$",
);

/** Is training access switched on, with a code to check against? */
export function trainingEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.TRAINING_MODE === "1" && (env.TRAINING_ACCESS_CODE ?? "").trim() !== "";
}

/**
 * Compare a submitted code against the configured one. Comparing digests
 * rather than the strings keeps the comparison constant-time whatever the
 * lengths are, so neither the length nor a matching prefix leaks. An unset
 * code matches nothing.
 */
export function codeMatches(given: string, expected: string | undefined): boolean {
  const want = (expected ?? "").trim();
  if (want === "") return false;
  const digest = (s: string) => createHash("sha256").update(s, "utf8").digest();
  return timingSafeEqual(digest(want), digest((given ?? "").trim()));
}

/** The address for a slot, zero-padded so the list sorts and reads evenly. */
export function traineeEmail(slot: number): string {
  return "trainee-" + String(slot).padStart(2, "0") + "@" + TRAINEE_EMAIL_DOMAIN;
}

/** The slot behind an address, or null when it is not a trainee account. */
export function traineeSlot(email: string): number | null {
  const m = TRAINEE_ADDRESS.exec(email.trim().toLowerCase());
  if (!m) return null;
  const slot = Number(m[1]);
  return slot >= 1 && slot <= MAX_TRAINEES ? slot : null;
}

/**
 * A free slot, chosen at random rather than lowest-first.
 *
 * The database driver has no transactions, so two people claiming at the same
 * moment race for the same row. Spreading the choice over every free slot makes
 * that collision rare; the caller's insert is what actually settles it.
 */
export function pickFreeSlot(
  taken: Iterable<number>,
  below: (n: number) => number,
): number | null {
  const used = new Set(taken);
  const free: number[] = [];
  for (let slot = 1; slot <= MAX_TRAINEES; slot++) {
    if (!used.has(slot)) free.push(slot);
  }
  if (free.length === 0) return null;
  return free[below(free.length)];
}
