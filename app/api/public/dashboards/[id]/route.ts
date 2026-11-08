import { NextResponse } from "next/server";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db, dashboardSessions } from "@/lib/db";
import { translateDashboardExtraOptions } from "@/lib/extra-options";
import { stripDashboardMarkup, visualReferenceProblems } from "@/lib/dashboard-safety";
import type { SDMXDashboardConfig } from "@/lib/types";

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
};

// ---------------------------------------------------------------------------
// GET /api/public/dashboards/[id] — load a published dashboard (no auth)
// Returns only public dashboard metadata + config. Never exposes chat messages.
// ---------------------------------------------------------------------------

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;

  try {
    const rows = await db
      .select({
        id: dashboardSessions.id,
        title: dashboardSessions.title,
        public_title: dashboardSessions.public_title,
        public_description: dashboardSessions.public_description,
        author_display_name: dashboardSessions.author_display_name,
        config_history: dashboardSessions.config_history,
        config_pointer: dashboardSessions.config_pointer,
        published_at: dashboardSessions.published_at,
      })
      .from(dashboardSessions)
      .where(
        and(
          eq(dashboardSessions.id, id),
          isNotNull(dashboardSessions.published_at),
          isNull(dashboardSessions.deleted_at),
        ),
      )
      .limit(1);

    if (rows.length === 0) {
      return NextResponse.json(
        { error: "Not found" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    const row = rows[0];
    const history = row.config_history as unknown[];
    const pointer = typeof row.config_pointer === "number" ? row.config_pointer : -1;

    if (!history || history.length === 0 || pointer < 0) {
      return NextResponse.json(
        { error: "No dashboard config" },
        { status: 404, headers: NO_STORE_HEADERS },
      );
    }

    // Dashboards published before the move to ECharts carry Highcharts
    // extraOptions.
    const { config, dropped } = translateDashboardExtraOptions(
      history[Math.min(pointer, history.length - 1)] as SDMXDashboardConfig,
    );
    if (dropped.length > 0) {
      console.warn(
        "[public-dashboard] " + row.id + ": dropped extraOptions keys with no ECharts equivalent:",
        dropped,
      );
    }

    // Dashboards published before the URL and markup rules existed are held
    // to them here: a panel fetching from an unregistered host becomes a
    // note, and markup is stripped from all text.
    const safeConfig = stripDashboardMarkup({
      ...config,
      rows: config.rows.map((row) => ({
        ...row,
        columns: row.columns.map((visual) =>
          visualReferenceProblems(visual).length === 0
            ? visual
            : {
                id: visual.id,
                type: "note" as const,
                colSize: visual.colSize,
                note: {
                  text: "This panel was removed: it loads data from outside the registered SDMX providers.",
                },
              },
        ),
      })),
    });

    return NextResponse.json(
      {
        id: row.id,
        title: row.public_title || row.title,
        description: row.public_description || null,
        config: safeConfig,
        author: row.author_display_name || null,
        publishedAt: row.published_at?.toISOString() || null,
      },
      { headers: NO_STORE_HEADERS },
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500, headers: NO_STORE_HEADERS },
    );
  }
}
