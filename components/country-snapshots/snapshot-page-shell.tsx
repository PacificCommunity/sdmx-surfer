import Link from "next/link";

export function SnapshotPageShell({
  title,
  subtitle,
  actions,
  children,
}: {
  title: string;
  subtitle?: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="mx-auto max-w-6xl p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wide text-[#006970]">
            <Link href="/countrysnapshots" className="hover:underline">
              Country Snapshots
            </Link>
          </p>
          <h1 className="mt-1 text-2xl font-semibold text-[#181c1e]">{title}</h1>
          {subtitle ? <p className="text-sm text-neutral-600">{subtitle}</p> : null}
        </div>
        {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
      </header>
      {children}
    </div>
  );
}
