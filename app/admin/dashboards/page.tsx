"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { SortableHeader } from "../SortableHeader";
import {
  dateValue,
  useSortableTable,
  type SortableColumn,
} from "../useSortableTable";
import { formatShortDate } from "../_components/format";

interface PublishedDashboardRecord {
  id: string;
  ownerUserId: string;
  ownerEmail: string;
  ownerName: string | null;
  title: string;
  description: string | null;
  author: string | null;
  publishedAt: string | null;
}

type DashboardSortKey = "title" | "author" | "owner" | "published";

const DASHBOARD_COLUMNS: SortableColumn<PublishedDashboardRecord, DashboardSortKey>[] = [
  { key: "title", getValue: (d) => d.title, defaultDir: "asc" },
  { key: "author", getValue: (d) => d.author, defaultDir: "asc" },
  { key: "owner", getValue: (d) => d.ownerEmail, defaultDir: "asc" },
  { key: "published", getValue: (d) => dateValue(d.publishedAt), defaultDir: "desc" },
];

const dashboardSearchText = (d: PublishedDashboardRecord): string =>
  d.title +
  " " +
  (d.description ?? "") +
  " " +
  (d.author ?? "") +
  " " +
  d.ownerEmail +
  " " +
  (d.ownerName ?? "");

export default function DashboardsPage() {
  const [publishedDashboards, setPublishedDashboards] = useState<
    PublishedDashboardRecord[]
  >([]);
  const [loading, setLoading] = useState(true);
  const [unpublishingDashboardId, setUnpublishingDashboardId] = useState<
    string | null
  >(null);

  const dashboardsTable = useSortableTable<PublishedDashboardRecord, DashboardSortKey>({
    rows: publishedDashboards,
    columns: DASHBOARD_COLUMNS,
    initialSort: { key: "published", dir: "desc" },
    searchText: dashboardSearchText,
  });

  async function fetchPublishedDashboards() {
    const res = await fetch("/api/admin/published-dashboards");
    if (!res.ok) return;
    const data = (await res.json()) as { dashboards: PublishedDashboardRecord[] };
    setPublishedDashboards(data.dashboards);
  }

  useEffect(() => {
    void (async () => {
      await fetchPublishedDashboards();
      setLoading(false);
    })();
  }, []);

  async function handleUnpublishDashboard(dashboardId: string) {
    setUnpublishingDashboardId(dashboardId);
    try {
      await fetch("/api/admin/published-dashboards/" + dashboardId, {
        method: "DELETE",
      });
      await fetchPublishedDashboards();
    } finally {
      setUnpublishingDashboardId(null);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="shimmer ghost-border h-24 rounded-[var(--radius-lg)]"
          />
        ))}
      </div>
    );
  }

  return (
    <section>
      <h2 className="font-[family-name:var(--font-display)] mb-1 text-xl font-bold text-on-surface">
        Published Dashboards
      </h2>
      <p className="type-label-md mb-4 text-on-surface-variant">
        Review public dashboards and unpublish them if needed.
      </p>

      {publishedDashboards.length === 0 ? (
        <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
          <p className="type-label-md text-on-surface-variant">
            No public dashboards right now.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3 px-1">
            <input
              type="search"
              value={dashboardsTable.query}
              onChange={(e) => dashboardsTable.setQuery(e.target.value)}
              placeholder="Search title, author, owner..."
              className="focus-architectural ghost-border w-64 rounded-[var(--radius-sm)] bg-surface-low px-3 py-1.5 text-xs text-on-surface placeholder:text-text-muted hover:bg-surface-high"
            />
            <span className="type-label-md text-on-surface-variant">
              {dashboardsTable.query.trim()
                ? dashboardsTable.matchedCount + " of " + dashboardsTable.totalCount
                : dashboardsTable.totalCount + " total"}
            </span>
          </div>

          {dashboardsTable.displayRows.length === 0 ? (
            <div className="ghost-border rounded-[var(--radius-lg)] bg-surface-card px-6 py-8 text-center">
              <p className="type-label-md text-on-surface-variant">
                No dashboards match &ldquo;{dashboardsTable.query}&rdquo;.
              </p>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[var(--radius-xl)] bg-surface-card shadow-ambient">
              <div className="grid grid-cols-12 gap-3 bg-surface-high/50 px-6 py-3">
                <SortableHeader
                  label="Dashboard"
                  className="col-span-4"
                  {...dashboardsTable.getSortProps("title")}
                />
                <SortableHeader
                  label="Author"
                  className="col-span-2"
                  {...dashboardsTable.getSortProps("author")}
                />
                <SortableHeader
                  label="Owner"
                  className="col-span-2"
                  {...dashboardsTable.getSortProps("owner")}
                />
                <SortableHeader
                  label="Published"
                  className="col-span-2"
                  {...dashboardsTable.getSortProps("published")}
                />
                <div className="type-label-md col-span-2 text-right text-on-surface">
                  Actions
                </div>
              </div>

              {dashboardsTable.displayRows.map((dashboard) => (
                <div
                  key={dashboard.id}
                  className="grid grid-cols-12 items-center gap-3 border-t border-surface-high/30 px-6 py-4 transition-colors hover:bg-surface-low"
                >
                  <div className="col-span-4 min-w-0">
                    <p className="truncate text-sm font-medium text-on-surface">
                      {dashboard.title}
                    </p>
                    {dashboard.description && (
                      <p className="mt-1 truncate text-xs text-on-surface-variant">
                        {dashboard.description}
                      </p>
                    )}
                  </div>

                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {dashboard.author || "Anonymous"}
                  </div>

                  <div className="col-span-2 min-w-0 text-xs text-on-surface-variant">
                    <p className="truncate">{dashboard.ownerEmail}</p>
                    {dashboard.ownerName && (
                      <p className="truncate">{dashboard.ownerName}</p>
                    )}
                  </div>

                  <div className="col-span-2 text-xs text-on-surface-variant">
                    {formatShortDate(dashboard.publishedAt)}
                  </div>

                  <div className="col-span-2 flex justify-end gap-2">
                    <Link
                      href={"/p/" + dashboard.id}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-primary transition-colors hover:bg-surface-high"
                    >
                      Open
                    </Link>
                    <button
                      type="button"
                      onClick={() => void handleUnpublishDashboard(dashboard.id)}
                      disabled={unpublishingDashboardId === dashboard.id}
                      className="ghost-border rounded-full px-3 py-1 text-xs font-semibold text-red-500 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      {unpublishingDashboardId === dashboard.id
                        ? "..."
                        : "Unpublish"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </section>
  );
}
