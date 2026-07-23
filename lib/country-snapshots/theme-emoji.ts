// Theme emoji map. Kept here so the catalogue stays a pure data artefact
// and UI affordances live with the rest of the UI.
const THEME_EMOJI: Record<string, string> = {
  I: "🌐",          // Context
  II: "🏥",         // Health
  III: "📚",        // Education
  IV: "📈",         // Economic resilience
  V: "💡",          // Industry & Innovation
  VI: "⚡",         // Infrastructure & energy
  VII: "🌿",        // Climate & environment
  VIII: "🐟",       // Oceans & fisheries
  IX: "⚖️",         // Governance & Institutions
  X: "🕊️",          // Peace & security
  XI: "🤝",         // Social inclusion
  XII: "🌍",        // Official Development Assistance
};

export function themeEmoji(themeId: string): string {
  return THEME_EMOJI[themeId] ?? "";
}
