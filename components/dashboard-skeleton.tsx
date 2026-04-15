"use client";

import type { SDMXDashboardConfig } from "@/lib/types";

export function DashboardSkeleton({ config }: { config: SDMXDashboardConfig }) {
  const colCount = config.colCount || 3;

  return (
    <div className="animate-pulse space-y-6">
      {config.header && (
        <div className="space-y-2">
          {config.header.title && (
            <div className="shimmer h-7 w-64 rounded-[var(--radius-md)]" />
          )}
          {config.header.subtitle && (
            <div className="shimmer h-4 w-96 rounded-[var(--radius-sm)]" />
          )}
        </div>
      )}

      {config.rows.map((row, ri) => (
        <div
          key={ri}
          className="grid gap-6"
          style={{
            gridTemplateColumns: "repeat(" + String(colCount) + ", minmax(0, 1fr))",
          }}
        >
          {row.columns.map((col, ci) => {
            const span = col.colSize || 1;
            const isValue = col.type === "value";
            const isNote = col.type === "note";

            return (
              <div
                key={ci}
                className="rounded-[var(--radius-lg)] bg-surface-card p-6 shadow-ambient"
                style={{ gridColumn: "span " + String(span) }}
              >
                {col.title && (
                  <div className="mb-4 space-y-1.5">
                    <div className="shimmer h-4 w-40 rounded-[var(--radius-sm)]" />
                    {col.subtitle && (
                      <div className="shimmer h-3 w-56 rounded-[var(--radius-sm)]" />
                    )}
                  </div>
                )}

                {isValue ? (
                  <div className="flex flex-col items-center gap-2 py-6">
                    <div className="shimmer h-10 w-28 rounded-[var(--radius-md)]" />
                    <div className="shimmer h-3 w-16 rounded-[var(--radius-sm)]" />
                  </div>
                ) : isNote ? (
                  <div className="space-y-2">
                    <div className="shimmer h-3 w-full rounded-[var(--radius-sm)]" />
                    <div className="shimmer h-3 w-4/5 rounded-[var(--radius-sm)]" />
                  </div>
                ) : (
                  <div className="space-y-2">
                    <div className="flex gap-3">
                      <div className="shimmer h-3 w-16 rounded-full" />
                      <div className="shimmer h-3 w-16 rounded-full" />
                    </div>
                    <div className="flex h-48 items-end gap-2 pt-4">
                      {Array.from({ length: 7 }, (_, i) => (
                        <div
                          key={i}
                          className="shimmer flex-1 rounded-t-[var(--radius-sm)]"
                          style={{
                            height: String(30 + Math.abs(Math.sin(i * 1.8) * 70)) + "%",
                          }}
                        />
                      ))}
                    </div>
                    <div className="flex justify-between">
                      {Array.from({ length: 7 }, (_, i) => (
                        <div
                          key={i}
                          className="shimmer h-2 w-6 rounded-[var(--radius-sm)]"
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
