import type { SDMXDashboardConfig, SDMXTextConfig } from "./types";

export function getLocalizedTextValue(
  value: string | Record<string, string> | null | undefined,
  preferredLang?: string,
): string | null {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (preferredLang) {
    const preferred = value[preferredLang];
    if (typeof preferred === "string" && preferred.trim().length > 0) {
      return preferred;
    }
  }

  for (const text of Object.values(value)) {
    if (typeof text === "string" && text.trim().length > 0) {
      return text;
    }
  }

  return null;
}

export function getTextConfigValue(
  value: SDMXTextConfig | null | undefined,
  preferredLang?: string,
): string | null {
  return getLocalizedTextValue(value?.text, preferredLang);
}

export function getDashboardTitle(
  config: Pick<SDMXDashboardConfig, "header" | "id" | "languages">,
  preferredLang?: string,
): string {
  return (
    getTextConfigValue(config.header?.title, preferredLang ?? config.languages?.[0]) ??
    config.id
  );
}

export function getDashboardSubtitle(
  config: Pick<SDMXDashboardConfig, "header" | "languages">,
  preferredLang?: string,
): string | null {
  return getTextConfigValue(
    config.header?.subtitle,
    preferredLang ?? config.languages?.[0],
  );
}
