/**
 * Convert an ISO-2 country code to the corresponding regional-indicator
 * flag emoji. Every code in the snapshots catalogue is a real ISO-2 code,
 * so this is a one-liner. Returns an empty string for invalid input rather
 * than throwing — the UI just shows the name without a flag in that case.
 */
export function countryFlag(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  const upper = code.toUpperCase();
  const base = 0x1f1e6 - 65; // 'A' → 🇦
  return (
    String.fromCodePoint(base + upper.charCodeAt(0)) +
    String.fromCodePoint(base + upper.charCodeAt(1))
  );
}
