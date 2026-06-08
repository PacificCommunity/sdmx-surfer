import { notFound } from "next/navigation";
import { countrySnapshotsEnabled } from "@/lib/country-snapshots/feature-flag";

export default function CountrySnapshotsPlaceholder() {
  if (!countrySnapshotsEnabled) notFound();
  return (
    <main className="p-8">
      <h1 className="text-2xl font-semibold">Country Snapshots</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Coming soon. The login screen will live at /countrysnapshots/login.
      </p>
    </main>
  );
}
