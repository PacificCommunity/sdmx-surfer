import type { SDMXTheme } from "sdmx-dashboard-components";

/**
 * Mirror of the CSS tokens in globals.css, for contexts that cannot read them:
 * the dashboard component theme and PDF/image export. Keep the two in step.
 *
 * Inter for display as well as body, because that is what the PDH website uses
 * (guidelines p26, p27). Trade Gothic is the logotype and print face and is a
 * licensed Linotype family, so it is not served here; the wordmark ships as
 * outlined SVG instead.
 */
export const BRAND_THEME = {
  fonts: {
    body: "Inter",
    display: "Inter",
  },
  colors: {
    primary: "#223b83",
    secondary: "#00a6c8",
    secondaryContainer: "#bcecfc",
    onSecondaryContainer: "#005e78",
    tertiary: "#e37b0a",
    tertiaryContainer: "#fbdab2",
    primaryContainer: "#355a92",
    surface: "#f9fafb",
    surfaceLow: "#f2f3f5",
    surfaceHigh: "#e8eaed",
    onSurface: "#1a1d2e",
    onSurfaceVariant: "#4c4c4c",
    textMuted: "#6f6f6f",
  },
} as const;

/** Mirror of the `--color-chart-*` tokens in globals.css, in order. */
export const BRAND_CHART_PALETTE = [
  "#031f79",
  "#11a2dc",
  "#e37019",
  "#52c9d6",
  "#ffc72e",
  "#03689a",
  "#668aad",
] as const;

/**
 * Default theme for every library chart. A visual's own `colorPalette` still
 * wins over the palette.
 */
export const BRAND_CHART_THEME: SDMXTheme = {
  palette: [...BRAND_CHART_PALETTE],
};

export const BRAND_GOOGLE_FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap";
