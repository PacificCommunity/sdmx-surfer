import { notFound } from "next/navigation";
import {
  getSnapshotCatalogue,
  getCountry,
  getThemeBySlug,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { DashboardRenderer } from "@/components/country-snapshots/dashboard-renderer";
import { ExportButton } from "@/components/country-snapshots/export-button";
import { ChatOverlay } from "@/components/country-snapshots/chat-overlay";
import { themeEmoji } from "@/lib/country-snapshots/theme-emoji";
import { countryFlag } from "@/lib/country-snapshots/country-flag";

export async function generateStaticParams() {
  const cat = getSnapshotCatalogue();
  const params: { country: string; theme: string }[] = [];
  for (const c of cat.countries) {
    for (const t of cat.themes) {
      params.push({ country: c.code, theme: t.slug });
    }
  }
  return params;
}

export default async function Page({
  params,
}: {
  params: Promise<{ country: string; theme: string }>;
}) {
  const { country: countryCode, theme: themeSlug } = await params;
  const country = getCountry(countryCode);
  const theme = getThemeBySlug(themeSlug);
  if (!country || !theme) notFound();

  const config = buildSnapshotConfig({
    country,
    theme,
    catalogue: getSnapshotCatalogue(),
  });

  return (
    <SnapshotPageShell
      title={`${countryFlag(country.code)} ${country.name} — ${themeEmoji(theme.id)} ${theme.title}`}
      subtitle={`Snapshot of ${config.items.length} indicators`}
      actions={
        <ExportButton filenameStem={`${country.name}_${theme.title}`} />
      }
    >
      <DashboardRenderer config={config} />
      <ChatOverlay
        snapshotContext={{
          countryCodes: [country.code],
          themeSlug: theme.slug,
          indicatorIds: config.items.map((i) => i.id),
        }}
      />
    </SnapshotPageShell>
  );
}
