import { getSnapshotCatalogue } from "@/lib/country-snapshots/catalogue";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { EntryPageMatrix } from "@/components/country-snapshots/entry-page-matrix";

export default function CountrySnapshotsEntry() {
  const cat = getSnapshotCatalogue();

  return (
    <SnapshotPageShell
      title="Country Snapshots"
      subtitle={`Curated indicators across ${cat.countries.length} Pacific Island Countries and Territories.`}
    >
      <p className="text-sm text-neutral-700">
        Pick a country and theme to browse, or compare countries side by side.
        An AI assistant will be added shortly to help you explore further.
      </p>
      <EntryPageMatrix countries={cat.countries} themes={cat.themes} />
    </SnapshotPageShell>
  );
}
