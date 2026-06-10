"use client";

import Link from "next/link";
import { ErrorBoundary } from "react-error-boundary";
import type {
  SnapshotConfig,
  DashboardItem,
} from "@/lib/country-snapshots/config-builder";
import { SnapshotChart } from "./snapshot-chart";
import { SourceCitation } from "./source-citation";
import { UnavailableStrip } from "./dashboard-renderer";

/**
 * Can we render this indicator as one chart across all selected countries?
 *
 * The config builder's decision engine already modelled which dimensions
 * vary and split consolidated indicators into per-stratum charts, so by
 * the time items arrive here "combinable" simply means "the builder
 * decided a chart works". Non-chart outcomes (value/table for sparse
 * single-country data, text for no data) get a per-country drill-in card
 * instead — 15-22 KPI cards per indicator would be noise.
 */
function canCombine(item: DashboardItem): boolean {
  return item.type === "chart" && Boolean(item.dataUrl);
}

function ItemErrorFallback({ item }: { item: DashboardItem }) {
  return (
    <div className="rounded-md bg-[#f1f4f6] p-4 text-sm">
      <p className="font-medium">Couldn&apos;t load this indicator.</p>
      <p className="mt-1 text-neutral-600">
        {item.title}.
        {item.source?.visUrl ? (
          <>
            {" "}
            <a
              href={item.source.visUrl}
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              View on .Stat
            </a>
            .
          </>
        ) : null}
      </p>
    </div>
  );
}

function NotCombinable({
  item,
  countryCodes,
  themeSlug,
}: {
  item: DashboardItem;
  countryCodes: string[];
  themeSlug: string;
}) {
  // Show a few representative country links so the user can drill in.
  const sampleLinks = countryCodes.slice(0, 6);
  return (
    <div className="rounded-md bg-[#f7fafc] p-4 text-sm">
      <p className="text-xs text-neutral-500">
        Regional combined view isn&apos;t available for this indicator
        {item.seriesConcept
          ? " (already broken down by " + item.seriesConcept + ")"
          : item.type === "value"
            ? " (data is too sparse to plot as a multi-country line chart)"
            : item.type === "table"
              ? " (table indicator)"
              : ""}
        . Open it on a per-country page:
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {sampleLinks.map((c) => (
          <Link
            key={c}
            href={`/countrysnapshots/${c}/${themeSlug}#${item.id}`}
            className="rounded-full bg-[#f1f4f6] px-2 py-0.5 font-mono text-xs hover:bg-[#e5e9eb]"
          >
            {c}
          </Link>
        ))}
        {countryCodes.length > sampleLinks.length ? (
          <span className="self-center text-xs text-neutral-400">
            +{countryCodes.length - sampleLinks.length} more
          </span>
        ) : null}
      </div>
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

export function RegionalRenderer({ config }: { config: SnapshotConfig }) {
  const countryCodes = config.countries.map((c) => c.code);

  // Indicators with no data source at all go to the compact strip — a
  // per-country drill-in card is pointless when there's nothing to drill
  // into anywhere. Items WITH data but not combinable keep their card
  // (its country links are genuinely useful there).
  const withData = config.items.filter((i) => Boolean(i.dataUrl));
  const unavailable = config.items.filter((i) => !i.dataUrl);

  return (
    <div className="space-y-10" data-snapshot-pdf-target>
      {withData.map((item) => (
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

          {canCombine(item) && item.dataUrl ? (
            <ErrorBoundary
              fallback={<ItemErrorFallback item={item} />}
              onError={(err) => logFailure(item, err as Error)}
            >
              <SnapshotChart
                config={{
                  id: item.id,
                  type: item.chartType ?? "line",
                  xAxisConcept: "TIME_PERIOD",
                  data: item.dataUrl,
                  title: { text: "" },
                  // The builder's decision engine resolved which dimension
                  // varies (GEO for combined views, post-split strata never
                  // reach here with their own concept).
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
          ) : (
            <NotCombinable
              item={item}
              countryCodes={countryCodes}
              themeSlug={config.theme.slug}
            />
          )}

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
