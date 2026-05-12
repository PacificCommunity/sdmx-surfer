"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const TABS: Array<{ href: string; label: string }> = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/users", label: "Users" },
  { href: "/admin/invites", label: "Invites" },
  { href: "/admin/dashboards", label: "Dashboards" },
  { href: "/admin/activity", label: "Activity" },
];

export function AdminTabs() {
  const pathname = usePathname();
  return (
    <nav className="mx-auto flex max-w-5xl gap-1 px-6 pt-2">
      {TABS.map((tab) => {
        // Active if this is the exact path. Overview only matches "/admin"
        // to avoid lighting up when on a child route.
        const active =
          tab.href === "/admin"
            ? pathname === "/admin"
            : pathname === tab.href || pathname.startsWith(tab.href + "/");
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={
              "rounded-t-[var(--radius-sm)] px-4 py-2 text-sm font-medium transition-colors " +
              (active
                ? "bg-surface-card text-on-surface shadow-ambient"
                : "text-on-surface-variant hover:text-on-surface hover:bg-surface-high/50")
            }
            aria-current={active ? "page" : undefined}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
