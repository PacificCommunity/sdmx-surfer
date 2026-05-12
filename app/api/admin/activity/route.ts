import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { USAGE_EPOCH } from "@/lib/admin-epoch";
import { extractDataSources } from "@/lib/data-explorer-url";

// ---------------------------------------------------------------------------
// GET /api/admin/activity — usage analytics for the Activity admin tab.
//
// All aggregates are scoped to USAGE_EPOCH (matches /api/admin/overview), so
// pre-cost-tracking traffic doesn't skew the numbers.
// ---------------------------------------------------------------------------

interface RankedRow {
  key: string;
  count: number;
  /** Optional longer label shown as a tooltip in the UI. */
  tooltip?: string;
}

interface SessionRow {
  sessionId: string;
  userEmail: string | null;
  startedAt: string | null;
  lastAt: string | null;
  turns: number;
  toolCalls: number;
  dashboardsEmitted: number;
  errorCount: number;
  durationMs: number;
  firstPrompt: string | null;
}

interface ActivityResponse {
  epoch: string;
  tiles: {
    prompts: number;
    sessions: number;
    sessionsWithDashboard: number;
    successRate: number; // sessionsWithDashboard / sessions, 0..1
    avgTurnsPerSession: number;
    medianSessionDurationMs: number;
  };
  topDataflows: RankedRow[];
  topEndpoints: RankedRow[];
  topTools: RankedRow[];
  sessions: SessionRow[];
}

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (session.user.role !== "admin") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const epoch = USAGE_EPOCH;

  // ── Tile aggregates ──
  const tilesResult = await db.execute(sql`
    WITH per_session AS (
      SELECT
        session_id,
        COUNT(*) AS turns,
        SUM(COALESCE(duration_ms, 0)) AS total_duration_ms,
        BOOL_OR(COALESCE(array_length(dashboard_config_ids, 1), 0) > 0)
          AS produced_dashboard
      FROM usage_logs
      WHERE created_at >= ${epoch}
        AND session_id IS NOT NULL
      GROUP BY session_id
    )
    SELECT
      (SELECT COUNT(*)::bigint FROM usage_logs WHERE created_at >= ${epoch}) AS prompts,
      (SELECT COUNT(*)::bigint FROM per_session) AS sessions,
      (SELECT COUNT(*)::bigint FROM per_session WHERE produced_dashboard) AS sessions_with_dashboard,
      (SELECT COALESCE(AVG(turns), 0) FROM per_session) AS avg_turns,
      (SELECT COALESCE(percentile_cont(0.5) WITHIN GROUP (ORDER BY total_duration_ms), 0) FROM per_session) AS median_duration_ms
  `);

  const tilesRow = (tilesResult.rows?.[0] ?? {}) as Record<string, unknown>;
  const prompts = Number(tilesRow.prompts ?? 0);
  const sessions = Number(tilesRow.sessions ?? 0);
  const sessionsWithDashboard = Number(tilesRow.sessions_with_dashboard ?? 0);
  const avgTurns = Number(tilesRow.avg_turns ?? 0);
  const medianDuration = Number(tilesRow.median_duration_ms ?? 0);

  // ── Top dataflows / endpoints from each session's current dashboard config ──
  // We use `extractDataSources` (the same helper that powers the data-sources
  // panel at the bottom of every dashboard) on the active config of each
  // session with activity in-epoch. Counts are per-session (deduped within a
  // session), so a single dashboard that uses DF_CPI in three panels still
  // contributes one to DF_CPI's count. This measures "how many produced
  // dashboards use this dataflow", which is more meaningful than raw
  // exploratory tool-call counts.
  const sessionConfigsResult = await db.execute(sql`
    SELECT s.config_history -> s.config_pointer AS current_config
    FROM dashboard_sessions s
    WHERE s.config_pointer >= 0
      AND s.deleted_at IS NULL
      AND EXISTS (
        SELECT 1 FROM usage_logs l
        WHERE l.session_id = s.id
          AND l.created_at >= ${epoch}
      )
  `);

  // Dataflow IDs are unique only within an endpoint (DF_CPI exists at SPC and
  // SBS as totally different objects), so we key the aggregation on
  // "<endpoint>:<id>" and display "<id> · <endpoint>". The descriptive name
  // (when registered in the config's `dataflows` map) is carried as a tooltip.
  interface DataflowAcc { id: string; endpoint: string; name: string; count: number; }
  const dataflowAcc = new Map<string, DataflowAcc>();
  const endpointCounts = new Map<string, number>();

  for (const row of (sessionConfigsResult.rows ?? []) as Record<string, unknown>[]) {
    const cfg = row.current_config as Parameters<typeof extractDataSources>[0] | null;
    if (!cfg || !cfg.rows) continue;
    const sources = extractDataSources(cfg);
    const dfSeen = new Set<string>();
    const epSeen = new Set<string>();
    for (const s of sources) {
      if (s.dataflowId && s.endpointKey) {
        const key = s.endpointKey + ":" + s.dataflowId;
        if (!dfSeen.has(key)) {
          dfSeen.add(key);
          const cur = dataflowAcc.get(key) ?? {
            id: s.dataflowId,
            endpoint: s.endpointShortName || s.endpointKey,
            name: s.dataflowName,
            count: 0,
          };
          cur.count += 1;
          dataflowAcc.set(key, cur);
        }
      }
      if (s.endpointShortName) epSeen.add(s.endpointShortName);
    }
    for (const ep of epSeen) endpointCounts.set(ep, (endpointCounts.get(ep) ?? 0) + 1);
  }

  const topDataflows: RankedRow[] = [...dataflowAcc.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 15)
    .map((d) => ({
      key: d.id + " · " + d.endpoint,
      count: d.count,
      // Only include the descriptive name when it actually differs from the id
      // (extractDataSources falls back to id when no dataflows map is present).
      tooltip: d.name && d.name !== d.id ? d.name : undefined,
    }));

  const topEndpoints: RankedRow[] = [...endpointCounts.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 15);

  // ── Tool-call distribution from the chat-route logger ──
  const toolsResult = await db.execute(sql`
    SELECT
      tc.call->>'name' AS key,
      COUNT(*)::bigint AS count
    FROM usage_logs l,
         jsonb_array_elements(l.tool_calls) AS tc(call)
    WHERE l.created_at >= ${epoch}
      AND tc.call->>'name' IS NOT NULL
    GROUP BY tc.call->>'name'
    ORDER BY count DESC
    LIMIT 25
  `);

  const toRanked = (rows: Record<string, unknown>[] | undefined): RankedRow[] =>
    (rows ?? []).map((r) => ({
      key: String(r.key ?? ""),
      count: Number(r.count ?? 0),
    }));

  // ── Recent sessions (one row per session_id) ──
  const sessionsResult = await db.execute(sql`
    SELECT
      l.session_id AS session_id,
      MAX(u.email) AS user_email,
      MIN(l.created_at) AS started_at,
      MAX(l.created_at) AS last_at,
      COUNT(*)::bigint AS turns,
      COALESCE(SUM(jsonb_array_length(l.tool_calls)), 0)::bigint AS tool_calls,
      COALESCE(SUM(COALESCE(array_length(l.dashboard_config_ids, 1), 0)), 0)::bigint
        AS dashboards_emitted,
      COALESCE(SUM(COALESCE(array_length(l.errors, 1), 0)), 0)::bigint AS error_count,
      COALESCE(SUM(l.duration_ms), 0)::bigint AS duration_ms,
      (
        ARRAY_AGG(l.user_message ORDER BY l.created_at)
          FILTER (WHERE l.user_message IS NOT NULL AND l.user_message <> '')
      )[1] AS first_prompt
    FROM usage_logs l
    LEFT JOIN auth_users u ON u.id = l.user_id
    WHERE l.created_at >= ${epoch}
      AND l.session_id IS NOT NULL
    GROUP BY l.session_id
    ORDER BY started_at DESC
    LIMIT 100
  `);

  const sessionRows: SessionRow[] = (sessionsResult.rows ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      sessionId: String(row.session_id ?? ""),
      userEmail: row.user_email == null ? null : String(row.user_email),
      startedAt: row.started_at == null ? null : String(row.started_at),
      lastAt: row.last_at == null ? null : String(row.last_at),
      turns: Number(row.turns ?? 0),
      toolCalls: Number(row.tool_calls ?? 0),
      dashboardsEmitted: Number(row.dashboards_emitted ?? 0),
      errorCount: Number(row.error_count ?? 0),
      durationMs: Number(row.duration_ms ?? 0),
      firstPrompt: row.first_prompt == null ? null : String(row.first_prompt),
    };
  });

  const response: ActivityResponse = {
    epoch: epoch.toISOString(),
    tiles: {
      prompts,
      sessions,
      sessionsWithDashboard,
      successRate: sessions === 0 ? 0 : sessionsWithDashboard / sessions,
      avgTurnsPerSession: avgTurns,
      medianSessionDurationMs: medianDuration,
    },
    topDataflows,
    topEndpoints,
    topTools: toRanked(toolsResult.rows as Record<string, unknown>[]),
    sessions: sessionRows,
  };

  return NextResponse.json(response);
}
