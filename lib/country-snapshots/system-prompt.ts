import { getSystemPrompt as getBaseSystemPrompt } from "@/lib/system-prompt";
import { getMode, renderCatalogueForPrompt } from "./catalogue-access";

export type SnapshotContext = {
  countryCodes: string[];   // single-country page has one; compare has many
  themeSlug: string;
  indicatorIds: string[];   // ids currently visible on the page
};

/**
 * System prompt for the snapshot-area chat overlay. Layers on top of the
 * regular Surfer system prompt:
 *
 *   1. Base Surfer prompt (with all the SDMX/dashboard authoring rules).
 *   2. If mode === "prompt": a full-catalogue dump (see catalogue-access.ts).
 *      If mode === "tool":   no catalogue text; tools handle lookups.
 *   3. A snapshot-context block describing the country/theme/indicators
 *      currently on the page.
 *   4. A scope reminder that the snapshot is read-only — the agent can
 *      investigate via MCP tools but cannot modify the snapshot itself.
 *      Customising → "Explore in Surfer" fork.
 */
export function buildSnapshotSystemPrompt(args: {
  ctx: SnapshotContext;
  baseSystemPrompt?: string;
}): string {
  const parts: string[] = [];
  parts.push(args.baseSystemPrompt ?? getBaseSystemPrompt());

  if (getMode() === "prompt") {
    parts.push("");
    parts.push(renderCatalogueForPrompt());
  }
  // In tool mode the catalogue block is omitted; a list_catalogue_indicators
  // tool (Task C2) is registered separately on the chat route.

  parts.push("");
  parts.push("# Current Snapshot Context");

  const isIndex =
    args.ctx.themeSlug === "index" || args.ctx.countryCodes.length === 0;
  if (isIndex) {
    parts.push(
      "The user is on the Country Snapshots entry page, not a specific " +
        "country/theme view. You have full agent capability here: call " +
        "update_dashboard to build the user a live dashboard in the " +
        "preview pane next to the chat. Use the indicators in this " +
        "catalogue first (they're curated and known to work); fall back " +
        "to broader SDMX discovery only when the user's question " +
        "genuinely needs something outside the catalogue.",
    );
    parts.push(
      "When you suggest a canonical snapshot page rather than building " +
        "a new dashboard, use links of the shape " +
        "`/countrysnapshots/<COUNTRY_CODE>/<theme-slug>` " +
        "or `/countrysnapshots/compare/<theme-slug>/<CODE>/<CODE>`.",
    );
    parts.push(
      "Do not respond with handmade markdown tables of figures. If the " +
        "user wants data, either build a dashboard with update_dashboard " +
        "or link to the canonical snapshot page that already shows it.",
    );
  } else {
    parts.push(
      `Country/countries on this page: ${args.ctx.countryCodes.join(", ")}`,
    );
    parts.push(`Theme slug: ${args.ctx.themeSlug}`);
    parts.push(
      `Indicators visible: ${args.ctx.indicatorIds.join(", ") || "(none)"}`,
    );
    parts.push(
      "You are operating as a read-only assistant for this snapshot page. " +
        "You can call MCP discovery tools to investigate the data shown. " +
        "Do NOT call update_dashboard — the snapshot config is fixed. " +
        "If the user wants to add indicators, change the time range, or " +
        "otherwise customise a view, tell them to use the 'Explore in " +
        "Surfer' button to fork into an editable session.",
    );
  }

  return parts.join("\n");
}
