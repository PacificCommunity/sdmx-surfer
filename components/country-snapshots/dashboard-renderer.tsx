"use client";

import { ErrorBoundary } from "react-error-boundary";
import type {
  SnapshotConfig,
  DashboardItem,
} from "@/lib/country-snapshots/config-builder";
import { SnapshotChart, SnapshotValue } from "./snapshot-chart";
import { SnapshotTable } from "./snapshot-table";
import { SourceCitation } from "./source-citation";

function ItemErrorFallback({ item }: { item: DashboardItem }) {
  return (
    <div className="rounded-md bg-surface-low p-4 text-sm">
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

/** Items that can actually render something. The rest go to the strip. */
function isRenderable(
  item: DashboardItem,
): item is DashboardItem & { dataUrl: string } {
  return item.type !== "text" && Boolean(item.dataUrl);
}

/**
 * Compact one-strip summary for indicators we can't render — either no
 * data source in the catalogue, or the chart-type cache says the query
 * returns nothing. Full-size "no data" cards made some themes feel a
 * third empty; the strip keeps the gaps honest without the dead weight.
 */
export function UnavailableStrip({ items }: { items: DashboardItem[] }) {
  if (items.length === 0) return null;
  return (
    <section className="rounded-md bg-surface-low p-4">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-neutral-500">
        Not currently available ({items.length})
      </h2>
      <p className="mt-2 text-xs leading-relaxed text-neutral-600">
        {items.map((item, i) => (
          <span key={item.id} id={item.id} className="scroll-mt-16">
            {i > 0 ? " · " : ""}
            <span className="font-medium">{item.id}</span> {item.title}
          </span>
        ))}
      </p>
    </section>
  );
}

export function DashboardRenderer({ config }: { config: SnapshotConfig }) {
  const renderable = config.items.filter(isRenderable);
  const unavailable = config.items.filter((i) => !isRenderable(i));

  return (
    <div className="space-y-10" data-snapshot-pdf-target>
      {renderable.map((item) => (
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
          {item.missingCountries?.length ? (
            <p className="mb-2 text-xs text-amber-700">
              No data for: {item.missingCountries.join(", ")}
            </p>
          ) : null}

          {item.type === "value" ? (
            <ErrorBoundary
              fallback={<ItemErrorFallback item={item} />}
              onError={(err) => logFailure(item, err as Error)}
            >
              <SnapshotValue
                config={{
                  id: item.id,
                  type: "value",
                  xAxisConcept: "OBS_VALUE",
                  data: item.dataUrl,
                  title: { text: "" },
                }}
                language="en"
              />
            </ErrorBoundary>
          ) : item.type === "table" ? (
            <ErrorBoundary
              fallback={<ItemErrorFallback item={item} />}
              onError={(err) => logFailure(item, err as Error)}
            >
              <SnapshotTable
                dataUrl={item.dataUrl}
                seriesConcept={item.seriesConcept}
                isCompare={config.countries.length > 1}
              />
            </ErrorBoundary>
          ) : item.chartType ? (
            <ErrorBoundary
              fallback={<ItemErrorFallback item={item} />}
              onError={(err) => logFailure(item, err as Error)}
            >
              <SnapshotChart
                config={{
                  id: item.id,
                  type: item.chartType,
                  xAxisConcept: "TIME_PERIOD",
                  data: item.dataUrl,
                  title: { text: "" },
                  // The config builder's decision engine already worked out
                  // which dimension (if any) varies and should be the chart
                  // series — no page-type logic belongs here.
                  ...(item.legendConcept
                    ? {
                        legend: {
                          concept: item.legendConcept,
                          location: "bottom" as const,
                        },
                      }
                    : {}),
                }}
                language="en"
              />
            </ErrorBoundary>
          ) : null}

          {item.source ? (
            <SourceCitation
              dataflow={item.source.dataflow}
              visUrl={item.source.visUrl}
            />
          ) : null}
        </section>
      ))}
      <UnavailableStrip items={unavailable} />
    </div>
  );
}
