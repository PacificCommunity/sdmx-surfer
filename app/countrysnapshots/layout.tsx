import { notFound } from "next/navigation";
import { countrySnapshotsEnabled } from "@/lib/country-snapshots/feature-flag";

/**
 * Outer Country Snapshots layout: only checks the build-time feature flag.
 * The shared-password gate lives in (authed)/layout.tsx so /login bypasses it.
 */
export default function CountrySnapshotsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!countrySnapshotsEnabled) notFound();
  return <div className="min-h-screen bg-surface">{children}</div>;
}
