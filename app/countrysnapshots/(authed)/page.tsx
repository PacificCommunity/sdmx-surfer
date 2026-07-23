import { getSnapshotCatalogue } from "@/lib/country-snapshots/catalogue";
import { SnapshotPageShell } from "@/components/country-snapshots/snapshot-page-shell";
import { EntryPageMatrix } from "@/components/country-snapshots/entry-page-matrix";
import { ChatStarter } from "@/components/country-snapshots/chat-starter";

export default function CountrySnapshotsEntry() {
  const cat = getSnapshotCatalogue();

  return (
    <SnapshotPageShell
      title="Country Snapshots"
      subtitle={`Curated indicators across ${cat.countries.length} Pacific Island Countries and Territories.`}
    >
      <p className="text-sm text-neutral-700">
        Pick a country and theme to browse, compare countries side by side, or
        ask the assistant to point you somewhere.
      </p>
      <ChatStarter />
      <EntryPageMatrix countries={cat.countries} themes={cat.themes} />
    </SnapshotPageShell>
  );
}
