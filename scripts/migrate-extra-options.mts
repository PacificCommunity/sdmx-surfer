/**
 * Translate saved dashboards' `extraOptions` from Highcharts to ECharts.
 *
 * sdmx-dashboard-components 1.0 draws with ECharts; dashboards saved under
 * 0.4.x carry Highcharts option keys that 1.0 ignores or misreads. This runs
 * lib/extra-options.ts over every `dashboard_sessions` row, deleted and
 * published ones included:
 *   - every `config_history` entry, so undo and redo keep working;
 *   - the config in every `update_dashboard` tool output in `messages`, which
 *     the builder re-extracts on load and would otherwise push back onto the
 *     history untranslated.
 * The app runs the same translator when a session loads, so this is a
 * clean-up, not a precondition. Re-running it after --apply changes nothing.
 *
 * Usage:  npx tsx scripts/migrate-extra-options.mts --inventory [--json]
 *           Read-only. Every distinct extraOptions key path across all
 *           config_history entries, with counts and what the translator does
 *           with it.
 *         npx tsx scripts/migrate-extra-options.mts --dry-run
 *           Read-only. Per-session changes and dropped keys.
 *         npx tsx scripts/migrate-extra-options.mts --apply
 *           Copies dashboard_sessions (id, config_history, messages) into a
 *           timestamped backup table, then rewrites the changed rows.
 *           `updated_at` is left alone so session lists keep their order. A
 *           row edited between read and write is skipped and reported; run
 *           again to pick it up.
 */
import { config } from "dotenv";
config({ path: ".env.local" });

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import {
  ECHARTS_VISUAL_TYPES,
  leafPaths,
  translateExtraOptions,
  translateStoredSession,
} from "../lib/extra-options";

// Imported dynamically, after dotenv has run: `lib/db` reads DATABASE_URL at
// module load, and ESM evaluates static imports before any statement here.
const { db, dashboardSessions } = await import("../lib/db");

/** Rows per query; messages can be large. */
const BATCH = 20;

type Mode = "inventory" | "dry-run" | "apply";

interface PathStats {
  path: string;
  /** "translated", "kept" or "dropped" by the translator, per visual type. */
  outcome: Record<string, number>;
  occurrences: number;
  sessions: Set<string>;
  types: Set<string>;
}

function parseMode(argv: string[]): Mode {
  const modes = (["inventory", "dry-run", "apply"] as const).filter((mode) =>
    argv.includes("--" + mode),
  );
  if (modes.length !== 1) {
    console.error(
      "Pass exactly one of --inventory, --dry-run, --apply.\n" +
        "Usage: npx tsx scripts/migrate-extra-options.mts --inventory [--json]",
    );
    process.exit(1);
  }
  return modes[0];
}

async function sessionIds(): Promise<string[]> {
  const rows = await db
    .select({ id: dashboardSessions.id })
    .from(dashboardSessions)
    .orderBy(asc(dashboardSessions.id));
  return rows.map((row) => row.id);
}

/** Visuals of a stored config entry, tolerating malformed JSON. */
function visualsOf(entry: unknown): Array<Record<string, unknown>> {
  if (typeof entry !== "object" || entry === null || !("rows" in entry)) return [];
  const rows = entry.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row: unknown) => {
    if (typeof row !== "object" || row === null || !("columns" in row)) return [];
    const columns = row.columns;
    return Array.isArray(columns)
      ? columns.filter(
          (visual): visual is Record<string, unknown> =>
            typeof visual === "object" && visual !== null,
        )
      : [];
  });
}

async function inventory(asJson: boolean): Promise<void> {
  const stats = new Map<string, PathStats>();
  let sessions = 0;
  let entries = 0;
  let visualsWithOptions = 0;

  const ids = await sessionIds();
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows = await db
      .select({ id: dashboardSessions.id, config_history: dashboardSessions.config_history })
      .from(dashboardSessions)
      .where(inArray(dashboardSessions.id, ids.slice(i, i + BATCH)));
    for (const row of rows) {
      sessions += 1;
      const history = Array.isArray(row.config_history) ? row.config_history : [];
      for (const entry of history) {
        entries += 1;
        for (const visual of visualsOf(entry)) {
          if (visual.extraOptions === undefined) continue;
          visualsWithOptions += 1;
          const type = String(visual.type);
          const { dropped } = translateExtraOptions(visual.extraOptions, type);
          const droppedPaths = new Set(dropped);
          const options = visual.extraOptions;
          const paths =
            typeof options === "object" && options !== null && !Array.isArray(options)
              ? Object.entries(options).flatMap(([key, value]) => leafPaths(value, key))
              : ["extraOptions"];
          for (const path of paths) {
            const stat = stats.get(path) ?? {
              path,
              outcome: {},
              occurrences: 0,
              sessions: new Set<string>(),
              types: new Set<string>(),
            };
            const outcome = droppedPaths.has(path)
              ? "dropped"
              : ECHARTS_VISUAL_TYPES[type] === true
                ? "translated or kept"
                : "ignored by " + type;
            stat.outcome[outcome] = (stat.outcome[outcome] ?? 0) + 1;
            stat.occurrences += 1;
            stat.sessions.add(row.id);
            stat.types.add(type);
            stats.set(path, stat);
          }
        }
      }
    }
  }

  const report = [...stats.values()]
    .sort((a, b) => b.occurrences - a.occurrences || a.path.localeCompare(b.path))
    .map((stat) => ({
      path: stat.path,
      occurrences: stat.occurrences,
      sessions: stat.sessions.size,
      types: [...stat.types].sort(),
      outcome: stat.outcome,
    }));

  if (asJson) {
    console.log(
      JSON.stringify({ sessions, entries, visualsWithOptions, paths: report }, null, 2),
    );
    return;
  }

  console.log(
    String(sessions) + " sessions, " + String(entries) + " config_history entries, " +
      String(visualsWithOptions) + " visuals with extraOptions, " +
      String(report.length) + " distinct key paths\n",
  );
  console.log("occurrences  sessions  path  [types]  outcome");
  for (const row of report) {
    console.log(
      String(row.occurrences).padStart(11) + "  " + String(row.sessions).padStart(8) + "  " +
        row.path + "  [" + row.types.join(", ") + "]  " +
        Object.entries(row.outcome).map(([k, n]) => k + " " + String(n)).join(", "),
    );
  }
}

async function migrate(apply: boolean): Promise<void> {
  let changedSessions = 0;
  let historyEntries = 0;
  let messageOutputs = 0;
  let written = 0;
  const skipped: string[] = [];
  const allDropped = new Map<string, number>();

  // Back up lazily, right before the first write, so a re-run with nothing
  // left to translate leaves no extra backup table behind.
  let backupMade = false;
  async function ensureBackup(): Promise<void> {
    if (backupMade) return;
    backupMade = true;
    const stamp = new Date().toISOString().replace(/\D/g, "").slice(0, 14);
    const backup = "dashboard_sessions_backup_extra_options_" + stamp;
    await db.execute(
      sql.raw(
        "CREATE TABLE " + backup +
          " AS SELECT id, config_history, messages FROM dashboard_sessions",
      ),
    );
    const counted = await db.execute(sql.raw("SELECT count(*)::int AS n FROM " + backup));
    console.log("Backup: " + backup + " (" + String(counted.rows[0]?.n) + " rows)\n");
  }

  const ids = await sessionIds();
  for (let i = 0; i < ids.length; i += BATCH) {
    const rows = await db
      .select({
        id: dashboardSessions.id,
        config_history: dashboardSessions.config_history,
        messages: dashboardSessions.messages,
      })
      .from(dashboardSessions)
      .where(inArray(dashboardSessions.id, ids.slice(i, i + BATCH)));

    for (const row of rows) {
      const history = Array.isArray(row.config_history) ? row.config_history : [];
      const messages = Array.isArray(row.messages) ? row.messages : [];
      const result = translateStoredSession(history, messages);
      if (result.historyEntriesChanged === 0 && result.messageOutputsChanged === 0) continue;

      changedSessions += 1;
      historyEntries += result.historyEntriesChanged;
      messageOutputs += result.messageOutputsChanged;
      for (const entry of result.dropped) {
        const path = entry.slice(entry.indexOf(": ") + 2);
        allDropped.set(path, (allDropped.get(path) ?? 0) + 1);
      }
      console.log(
        row.id + ": " + String(result.historyEntriesChanged) + "/" + String(history.length) +
          " history entries, " + String(result.messageOutputsChanged) + " message outputs" +
          (result.dropped.length > 0 ? "\n    dropped: " + result.dropped.join("; ") : ""),
      );

      if (!apply) continue;
      await ensureBackup();
      // Optimistic check: skip a row someone saved since it was read.
      const updated = await db
        .update(dashboardSessions)
        .set({ config_history: result.configHistory, messages: result.messages })
        .where(
          and(
            eq(dashboardSessions.id, row.id),
            sql`${dashboardSessions.config_history} = ${JSON.stringify(row.config_history)}::jsonb`,
            sql`${dashboardSessions.messages} = ${JSON.stringify(row.messages)}::jsonb`,
          ),
        )
        .returning({ id: dashboardSessions.id });
      if (updated.length === 1) {
        written += 1;
      } else {
        skipped.push(row.id);
      }
    }
  }

  console.log(
    "\n" + String(changedSessions) + " of " + String(ids.length) + " sessions change: " +
      String(historyEntries) + " history entries, " + String(messageOutputs) +
      " message outputs.",
  );
  if (allDropped.size > 0) {
    console.log("Dropped key paths (visuals, counted once per session):");
    for (const [path, count] of [...allDropped].sort((a, b) => b[1] - a[1])) {
      console.log("  " + String(count).padStart(4) + "  " + path);
    }
  }
  if (apply) {
    console.log("\nWrote " + String(written) + " sessions.");
    if (skipped.length > 0) {
      console.log("Skipped, edited since read (run again): " + skipped.join(", "));
    }
  } else {
    console.log("\nDry run. Re-run with --apply to write.");
  }
}

async function main() {
  const mode = parseMode(process.argv.slice(2));
  if (mode === "inventory") {
    await inventory(process.argv.includes("--json"));
  } else {
    await migrate(mode === "apply");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
