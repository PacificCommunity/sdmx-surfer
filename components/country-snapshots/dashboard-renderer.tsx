"use client";

import { ErrorBoundary } from "react-error-boundary";
import type {
  SnapshotConfig,
  DashboardItem,
} from "@/lib/country-snapshots/config-builder";
import { SnapshotChart } from "./snapshot-chart";
import { SourceCitation } from "./source-citation";

function ItemErrorFallback({ item }: { item: DashboardItem }) {
  return (
    <div className="rounded-md bg-[#f1f4f6] p-4 text-sm">
      <p className="font-medium">Couldn&apos;t load this indicator right now.</p>
      <p className="mt-1 text-neutral-600">
        Try refreshing the page.
        {item.source?.visUrl ? (
          <>
            {" "}
            Or{" "}
            <a
              href={item.source.visUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              view on .Stat
            </a>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}

function logFailure(item: DashboardItem, err: Error) {
  void fetch("/api/countrysnapshots/log", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      indicator: item.id,
      dataflow: item.source?.dataflow,
      error: String(err?.message ?? err),
    }),
  }).catch(() => {});
}

export function DashboardRenderer({ config }: { config: SnapshotConfig }) {
  return (
    <div className="space-y-10" data-snapshot-pdf-target>
      {config.items.map((item) => (
        <section
          key={item.id}
          id={item.id}
          className="scroll-mt-16 rounded-md bg-white p-5 shadow-sm"
        >
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-lg font-semibold">
              <span className="mr-2 text-xs font-normal text-neutral-400">
                {item.id}
              </span>
              {item.title}
            </h2>
          </div>
          {item.notes ? (
            <p className="mb-2 text-xs italic text-neutral-500">{item.notes}</p>
          ) : null}

          {item.type === "text" || !item.dataUrl ? (
            <p className="rounded-md bg-[#f7fafc] p-4 text-sm italic text-neutral-500">
              No data source for this indicator yet.
            </p>
          ) : (
            <ErrorBoundary
              fallback={<ItemErrorFallback item={item} />}
              onError={(err) => logFailure(item, err as Error)}
            >
              <SnapshotChart
                config={{
                  id: item.id,
                  type: "line",
                  xAxisConcept: "TIME_PERIOD",
                  data: item.dataUrl,
                  title: { text: "" },
                }}
                language="en"
              />
            </ErrorBoundary>
          )}

          {item.source ? (
            <SourceCitation
              dataflow={item.source.dataflow}
              visUrl={item.source.visUrl}
            />
          ) : null}
        </section>
      ))}
    </div>
  );
}
