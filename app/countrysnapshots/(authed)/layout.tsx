import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyCookie } from "@/lib/country-snapshots/auth";

/**
 * Shared-password gate. Every page under /countrysnapshots/(authed)/* is
 * guarded by a valid cs_session cookie. The /countrysnapshots/login page
 * sits outside this group so it never triggers the redirect loop.
 */
export default async function AuthedSnapshotsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const c = await cookies();
  const valid = verifyCookie(c.get("cs_session")?.value);
  if (!valid) redirect("/countrysnapshots/login");
  return <>{children}</>;
}
