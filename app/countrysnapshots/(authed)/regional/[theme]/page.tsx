import { notFound } from "next/navigation";
import Link from "next/link";
import {
  getSnapshotCatalogue,
  getThemeBySlug,
  type Country,
} from "@/lib/country-snapshots/catalogue";
import { buildSnapshotConfig } from "@/lib/country-snapshots/config-builder";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { RegionalRenderer } from "@/components/country-snapshots/regional-renderer";
import { ExportButton } from "@/components/country-snapshots/export-button";
import { ChatOverlay } from "@/components/country-snapshots/chat-overlay";
import { IndicatorToc } from "@/components/country-snapshots/indicator-toc";
import { RegionalSwitcher } from "@/components/country-snapshots/page-switcher";
import { themeEmoji } from "@/lib/country-snapshots/theme-emoji";

export const dynamic = "force-dynamic";

type Scope = "mfat" | "all";

function pickScope(raw: string | undefined): Scope {
  return raw === "all" ? "all" : "mfat";
}

export default async function RegionalPage({
  params,
  searchParams,
}: {
  params: Promise<{ theme: string }>;
  searchParams: Promise<{ scope?: string }>;
}) {
  const { theme: themeSlug } = await params;
  const { scope: rawScope } = await searchParams;
  const scope = pickScope(rawScope);

  const theme = getThemeBySlug(themeSlug);
  if (!theme) notFound();

  const cat = getSnapshotCatalogue();
  const countries: Country[] =
    scope === "all"
      ? cat.countries
      : cat.countries.filter((c) => c.mfatRelevant);

  // Build a snapshot config with N countries — same machinery as the compare
  // page, just with the full MFAT-15 (or all-22) set. The regional renderer
  // then groups the items by what's combinable vs. not.
  const config = buildSnapshotConfig({
    country: countries,
    theme,
    catalogue: cat,
  });

  const otherScope: Scope = scope === "all" ? "mfat" : "all";
  const otherScopeLabel =
    scope === "all" ? "MFAT-priority only (15)" : "all PICTs (22)";

  return (
    <SnapshotPageShell
      title={`${themeEmoji(theme.id)} ${theme.title} — regional summary`}
      subtitle={`${countries.length} countries · ${config.items.length} indicators`}
      actions={
        <ExportButton filenameStem={`Regional_${theme.title}`} />
      }
    >
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md bg-white p-3 shadow-sm">
        <RegionalSwitcher
          themes={cat.themes}
          currentTheme={theme.slug}
          scope={scope}
        />
        <div className="flex items-center gap-3">
          <span className="text-xs text-neutral-600">
            Showing {scope === "mfat" ? "MFAT-priority" : "all"} countries.
          </span>
          <Link
            href={`/countrysnapshots/regional/${theme.slug}?scope=${otherScope}`}
            className="text-xs text-[#006970] underline"
          >
            Switch to {otherScopeLabel}
          </Link>
        </div>
      </div>

      <div className="flex gap-6">
        <div className="min-w-0 flex-1">
          <RegionalRenderer config={config} />
        </div>
        <IndicatorToc
          entries={config.items.map((i) => ({ id: i.id, title: i.title }))}
        />
      </div>

      <ChatOverlay
        snapshotContext={{
          countryCodes: countries.map((c) => c.code),
          themeSlug: theme.slug,
          indicatorIds: config.items.map((i) => i.id),
        }}
      />
    </SnapshotPageShell>
  );
}
