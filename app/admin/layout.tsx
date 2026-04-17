import Link from "next/link";
import { auth } from "@/lib/auth";
import { AdminTabs } from "./_components/AdminTabs";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await auth();
  const isAdmin = session?.user?.role === "admin";

  if (!isAdmin) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-surface">
        <div className="ghost-border shadow-ambient rounded-[var(--radius-xl)] bg-surface-card p-10 text-center">
          <div className="brand-gradient mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full opacity-60">
            <svg
              className="h-7 w-7 text-white"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636"
              />
            </svg>
          </div>
          <h1 className="type-headline-sm mb-2 text-on-surface">Access denied</h1>
          <p className="type-label-md mb-6 text-on-surface-variant">
            You do not have permission to view this page.
          </p>
          <Link
            href="/"
            className="brand-gradient inline-block rounded-full px-6 py-2 text-sm font-semibold text-white transition-opacity hover:opacity-90"
          >
            Go home
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-surface">
      <header className="glass-panel shadow-ambient sticky top-0 z-50">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <Link
            href="/"
            className="ghost-border flex h-9 w-9 items-center justify-center rounded-full bg-surface-card text-on-surface-variant transition-transform hover:scale-105 hover:text-primary"
            title="Back to home"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={2}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 19.5L8.25 12l7.5-7.5"
              />
            </svg>
          </Link>
          <div>
            <h1 className="type-headline-sm text-on-surface">Admin Dashboard</h1>
            <p className="type-label-md text-on-surface-variant">
              User and invite management
            </p>
          </div>
        </div>
        <AdminTabs />
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
