/**
 * Memorable passphrase generator, Glitch-URL flavour.
 *
 * Shape: {predicate}{sep}{predicate}{sep}{object}{NN}{symbol}
 *   e.g. cheerful-plaintive-otter42!
 *        swift_amber_brochure17#
 *        fuzzy.indigo.axolotl83?
 *
 * Both the separator and the trailing symbol are chosen at random per call,
 * so bulk brute-forcing across the allowlist cannot assume a fixed template.
 *
 * Entropy (with friendly-words):
 *   predicates (~1450) ≈ 10.5 bits × 2
 *   objects    (~3064) ≈ 11.6 bits
 *   2 digits 10..99    ≈  6.6 bits
 *   separator (4)      ≈  2.0 bits
 *   symbol (7)         ≈  2.8 bits
 *   total              ≈ 44 bits
 *
 * This is well above what is needed given login rate-limiting, allowlist
 * gating, and the attacker having to guess a valid email too.
 */

import { predicates, objects } from "friendly-words";
import { randomInt } from "node:crypto";

const SEPARATORS = ["-", "_", ".", "+"] as const;
const SYMBOLS = ["!", "@", "#", "*", "?", "&", "$"] as const;

function pick<T>(arr: readonly T[]): T {
  return arr[randomInt(0, arr.length)];
}

export function generatePassphrase(): string {
  const sep = pick(SEPARATORS);
  const adj1 = pick(predicates);
  const adj2 = pick(predicates);
  const obj = pick(objects);
  const digits = String(randomInt(10, 100)); // 10..99
  const symbol = pick(SYMBOLS);
  return adj1 + sep + adj2 + sep + obj + digits + symbol;
}
