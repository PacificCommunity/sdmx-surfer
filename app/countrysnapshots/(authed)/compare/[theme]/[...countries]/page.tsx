import { notFound } from "next/navigation";
import {
  getSnapshotCatalogue,
  getCountry,
  getThemeBySlug,
  type Country,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { DashboardRenderer } from "@/components/country-snapshots/dashboard-renderer";
import { ComparePicker } from "@/components/country-snapshots/compare-picker";
import { ExportButton } from "@/components/country-snapshots/export-button";
import { ChatOverlay } from "@/components/country-snapshots/chat-overlay";
import { themeEmoji } from "@/lib/country-snapshots/theme-emoji";

const MAX_COMPARE = 5;
const MIN_COMPARE = 2;

// Compare combinations are open-ended; rendering is dynamic and cheap because
// the config builder is pure and the library fetches data client-side.
export const dynamic = "force-dynamic";

export default async function ComparePage({
  params,
}: {
  params: Promise<{ theme: string; countries: string[] }>;
}) {
  const { theme: themeSlug, countries: countryParam } = await params;
  const theme = getThemeBySlug(themeSlug);
  if (!theme) notFound();

  // URL accepts both /compare/health/TO+WS+VU and /compare/health/TO/WS/VU.
  const codes = countryParam.flatMap((c) => c.split("+")).filter(Boolean);
  if (codes.length < MIN_COMPARE || codes.length > MAX_COMPARE) notFound();

  const resolved = codes.map(getCountry);
  if (resolved.some((c) => !c)) notFound();
  const safeCountries: Country[] = resolved.filter(
    (c): c is Country => Boolean(c),
  );

  const cat = getSnapshotCatalogue();
  const config = buildSnapshotConfig({
    country: safeCountries,
    theme,
    catalogue: cat,
  });

  return (
    <SnapshotPageShell
      title={`${safeCountries.map((c) => c.name).join(" vs ")} — ${themeEmoji(theme.id)} ${theme.title}`}
      subtitle={`Compare across ${codes.length} countries — ${config.items.length} indicators`}
      actions={
        <ExportButton
          filenameStem={`${safeCountries.map((c) => c.name).join("_vs_")}_${theme.title}`}
        />
      }
    >
      <ComparePicker theme={theme} countries={cat.countries} selected={codes} />
      <DashboardRenderer config={config} />
      <ChatOverlay
        snapshotContext={{
          countryCodes: safeCountries.map((c) => c.code),
          themeSlug: theme.slug,
          indicatorIds: config.items.map((i) => i.id),
        }}
      />
    </SnapshotPageShell>
  );
}
