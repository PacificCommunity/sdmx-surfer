import { getSystemPrompt as getBaseSystemPrompt } from "@/lib/system-prompt";
import { getMode, renderCatalogueForPrompt } from "./catalogue-access";

export type SnapshotContext = {
  countryCodes: string[];   // single-country page has one; compare has many
  themeSlug: string;
  indicatorIds: string[];   // ids currently visible on the page
};

/**
 * System prompt for the snapshot-area chat, split into two blocks so the
 * stable prefix can carry an Anthropic cache breakpoint:
 *
 *   stable  — base Surfer prompt + (in prompt mode) the full catalogue dump.
 *             Identical across every turn and step; cached at the provider.
 *   dynamic — the per-page snapshot context (country/theme/indicators) and
 *             scope rules. Changes between pages; never cached.
 *
 * Anthropic merges consecutive system messages into one multi-block system
 * array where each block carries its own cache_control, and the cache
 * prefix order is tools → system → messages — so a breakpoint at the end
 * of the stable block also caches the tool definitions ahead of it.
 */
export function buildSnapshotSystemPromptParts(args: {
  ctx: SnapshotContext;
  baseSystemPrompt?: string;
}): { stable: string; dynamic: string } {
  const stableParts: string[] = [];
  stableParts.push(args.baseSystemPrompt ?? getBaseSystemPrompt());
  if (getMode() === "prompt") {
    stableParts.push("");
    stableParts.push(renderCatalogueForPrompt());
  }
  // In tool mode the catalogue block is omitted; a list_catalogue_indicators
  // tool (Task C2) is registered separately on the chat route.

  return {
    stable: stableParts.join("\n"),
    dynamic: buildDynamicContext(args.ctx),
  };
}

/** Single-string form, kept for tests and non-caching callers. */
export function buildSnapshotSystemPrompt(args: {
  ctx: SnapshotContext;
  baseSystemPrompt?: string;
}): string {
  const { stable, dynamic } = buildSnapshotSystemPromptParts(args);
  return stable + "\n" + dynamic;
}

function buildDynamicContext(ctx: SnapshotContext): string {
  const parts: string[] = [];
  parts.push("# Current Snapshot Context");

  const isIndex =
    ctx.themeSlug === "index" || ctx.countryCodes.length === 0;
  if (isIndex) {
    parts.push(
      "The user is on the Country Snapshots entry page, not a specific " +
        "country/theme view. You have full agent capability here: call " +
        "update_dashboard to build the user a live dashboard in the " +
        "preview pane next to the chat. Use the indicators in this " +
        "catalogue first (they're curated and known to work); fall back " +
        "to broader SDMx discovery only when the user's question " +
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
      `Country/countries on this page: ${ctx.countryCodes.join(", ")}`,
    );
    parts.push(`Theme slug: ${ctx.themeSlug}`);
    parts.push(
      `Indicators visible: ${ctx.indicatorIds.join(", ") || "(none)"}`,
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
