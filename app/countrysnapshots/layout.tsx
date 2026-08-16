import { notFound } from "next/navigation";
import { countrySnapshotsEnabled } from "@/lib/country-snapshots/feature-flag";
import { AppHeader } from "@/components/app-header";
import { AppFooter } from "@/components/app-footer";

/**
 * Outer Country Snapshots layout: checks the build-time feature flag and
 * carries the chrome. The shared-password gate lives in (authed)/layout.tsx so
 * /login bypasses it.
 *
 * Country Snapshots is a sibling of Data Surfer under the Pacific Data Hub
 * rather than a section of it: separate audience, separate access, its own
 * name. So it wears the same PDH bar with its own wordmark, C⊙UNTRY
 * SNAPSHOTS, the way .STAT EXPL⊙RER and PACIFIC MΛP do, and its logo links to
 * its own home rather than to Data Surfer's.
 */
export default function CountrySnapshotsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!countrySnapshotsEnabled) notFound();
  return (
    <div className="flex min-h-screen flex-col">
      <AppHeader
        product="country-snapshots"
        home="/countrysnapshots"
        items={[]}
      />
      <div className="flex-1">{children}</div>
      <AppFooter product="country-snapshots" />
    </div>
  );
}
