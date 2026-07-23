import { tool } from "ai";
import { z } from "zod";
import {
  compileDashboardToolConfig,
  dashboardToolConfigSchema,
} from "@/lib/dashboard-authoring";
import { resolveDataflowNamesFromConfig } from "@/lib/dataflow-names";
import { getConfigTitle } from "@/lib/dashboard-schema";
import { getMode, catalogueTool } from "./catalogue-access";
import {
  buildSnapshotSystemPromptParts,
  type SnapshotContext,
} from "./system-prompt";

/**
 * Shared request assembly for the snapshot chat — used by BOTH the chat
 * route and the cache-warm route. The Anthropic prompt cache is keyed on
 * the byte-exact prefix (tools → system up to the breakpoint), so the two
 * routes must assemble tools and the stable system message identically or
 * warming silently stops working. Keep every prefix-affecting decision in
 * this module.
 */

export type SnapshotChatMode = "index" | "page";

export function modeFor(ctx: SnapshotContext): SnapshotChatMode {
  return ctx.themeSlug === "index" || ctx.countryCodes.length === 0
    ? "index"
    : "page";
}

// Request shape for /api/countrysnapshots/chat. Lives here (not in the
// route file) so tests can exercise it directly.
//
// countryCodes upper bound must fit the LARGEST surface that mounts a chat:
// the regional summary passes every country in scope (22 when ?scope=all).
// It was previously max(5) — the compare-page limit — which made every
// regional-page chat turn fail validation with a 500.
const MAX_COUNTRY_CODES = 30;
const MAX_INDICATOR_IDS = 100;
const MAX_MESSAGES = 200;

export const snapshotContextSchema = z.object({
  countryCodes: z.array(z.string()).max(MAX_COUNTRY_CODES),
  themeSlug: z.string(),
  indicatorIds: z.array(z.string()).max(MAX_INDICATOR_IDS),
});

export const chatRequestSchema = z.object({
  messages: z.array(z.unknown()).max(MAX_MESSAGES),
  snapshotContext: snapshotContextSchema,
  sessionId: z.string().uuid().optional(),
});

/**
 * The system messages for a snapshot chat: a stable block carrying the
 * Anthropic cache breakpoint, then the per-page dynamic context. The cache
 * prefix order is tools → system → messages, so the one breakpoint also
 * caches the MCP tool definitions ahead of it.
 *
 * NOTE: cache_control must sit on MESSAGE-level providerOptions — the
 * provider silently ignores it at the streamText call level.
 */
export function buildSystemMessages(ctx: SnapshotContext) {
  const { stable, dynamic } = buildSnapshotSystemPromptParts({ ctx });
  return [
    {
      role: "system" as const,
      content: stable,
      providerOptions: {
        anthropic: { cacheControl: { type: "ephemeral" as const } },
      },
    },
    { role: "system" as const, content: dynamic },
  ];
}

/** The stable system message alone — the minimal prefix a warm needs. */
export function buildStableSystemMessage(ctx: SnapshotContext) {
  return buildSystemMessages(ctx)[0];
}

export function buildUpdateDashboardTool() {
  return tool({
    description:
      "Send a dashboard configuration to the live preview. " +
      "Prefer the simplified authoring schema (intent visuals like kpi, chart, map, note). " +
      "Always send the complete config, not just changed parts.",
    inputSchema: z.object({ config: dashboardToolConfigSchema }),
    execute: async ({
      config,
    }: {
      config: z.infer<typeof dashboardToolConfigSchema>;
    }) => {
      const compiled = compileDashboardToolConfig(config);
      compiled.dataflows = resolveDataflowNamesFromConfig(compiled);
      return {
        success: true,
        dashboard: compiled,
        message:
          "Dashboard updated. The preview now shows: " +
          getConfigTitle(compiled),
      };
    },
  });
}

/**
 * Assemble the tool set for a snapshot chat mode from the live MCP tools.
 *
 *   index — full agent: all MCP tools + update_dashboard (+ catalogue tool
 *           in tool mode).
 *   page  — read-only: MCP tools minus update_dashboard (+ catalogue tool
 *           in tool mode).
 *
 * Tool identity, ordering, and JSON schemas are part of the cache prefix;
 * any change here invalidates existing cache entries (harmless, just a
 * cold turn) but a DIFFERENCE between chat and warm assembly would break
 * warming permanently — which is why both call this.
 */
export function buildSnapshotTools(
  mcpTools: Record<string, unknown>,
  mode: SnapshotChatMode,
): Record<string, unknown> {
  if (mode === "index") {
    return {
      ...mcpTools, // index mode is allowed to mutate
      ...(getMode() === "tool"
        ? { list_catalogue_indicators: catalogueTool }
        : {}),
      update_dashboard: buildUpdateDashboardTool(),
    };
  }
  const safeMcpTools = Object.fromEntries(
    Object.entries(mcpTools).filter(([name]) => name !== "update_dashboard"),
  );
  return getMode() === "tool"
    ? { ...safeMcpTools, list_catalogue_indicators: catalogueTool }
    : safeMcpTools;
}
