import { redirect } from "next/navigation";
import { cookies } from "next/headers";
import { verifyCookie } from "@/lib/country-snapshots/auth";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const c = await cookies();
  const params = await searchParams;
  if (verifyCookie(c.get("cs_session")?.value)) {
    redirect(params.next ?? "/countrysnapshots");
  }

  return (
    <main className="mx-auto max-w-sm p-8">
      <h1 className="text-xl font-semibold">Country Snapshots</h1>
      <p className="mt-2 text-sm text-neutral-600">
        Enter the access password to continue.
      </p>
      <form method="POST" action="/api/countrysnapshots/auth" className="mt-6 space-y-4">
        <input type="hidden" name="next" value={params.next ?? ""} />
        <input
          type="password"
          name="password"
          required
          autoFocus
          className="w-full rounded-md border border-neutral-300 px-3 py-2"
        />
        <button
          type="submit"
          className="w-full rounded-md bg-primary px-3 py-2 text-white"
        >
          Enter
        </button>
        {params.error ? (
          <p className="text-sm text-red-700">Incorrect password.</p>
        ) : null}
      </form>
    </main>
  );
}
