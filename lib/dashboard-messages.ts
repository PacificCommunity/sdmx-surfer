import type { UIMessage } from "ai";
import type { SDMXDashboardConfig } from "@/lib/types";

/**
 * Configs larger than this are not repeated to the model. A typical
 * dashboard is 3–20K characters; the cap keeps a pathological config from
 * dominating every step of a turn.
 */
export const MAX_CURRENT_CONFIG_CHARS = 100_000;

/**
 * The config of the latest completed `update_dashboard` call in a UI message
 * list, or null when the conversation never produced one (a forked
 * dashboard, a session whose config came from the JSON editor).
 */
export function extractDashboardConfig(
  messages: readonly UIMessage[],
): SDMXDashboardConfig | null {
  for (let i = messages.length - 1; i >= 0; i--) {
    const parts = messages[i].parts;
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j];
      const isUpdateDashboard =
        part.type === "tool-update_dashboard" ||
        (part.type === "dynamic-tool" && part.toolName === "update_dashboard");
      if (!isUpdateDashboard || !("state" in part)) continue;
      if (part.state !== "output-available") continue;

      const output = part.output;
      if (typeof output !== "object" || output === null) continue;
      // Both shapes are written by our own update_dashboard tool.
      if ("dashboard" in output && typeof output.dashboard === "object" && output.dashboard !== null) {
        const dashboard = output.dashboard as SDMXDashboardConfig;
        return dashboard;
      }
      if ("rows" in output && Array.isArray(output.rows)) {
        // Legacy sessions stored the bare config as the tool output.
        const legacy = output as SDMXDashboardConfig;
        return legacy;
      }
    }
  }
  return null;
}

export interface CurrentDashboardContext {
  /** Our own guidance to the model; safe to place outside quarantine. */
  instructions: string;
  /** The user-editable config as JSON, or null when it is too large. */
  configJson: string | null;
}

/**
 * What to tell the model about the dashboard in the live preview, or null
 * when the conversation already ends on that exact config. The model
 * otherwise only knows configs it emitted itself, so a forked dashboard, a
 * reopened session, or a JSON-editor edit would be invisible to it.
 */
export function currentDashboardContext(
  currentConfig: object | undefined,
  messages: readonly UIMessage[],
): CurrentDashboardContext | null {
  if (!currentConfig) return null;

  const json = JSON.stringify(currentConfig);
  const inHistory = extractDashboardConfig(messages);
  if (inHistory && JSON.stringify(inHistory) === json) return null;

  if (json.length > MAX_CURRENT_CONFIG_CHARS) {
    return {
      instructions:
        "The live preview shows a dashboard whose config is too large to include here (" +
        String(json.length) +
        " characters). Ask the user which panels to change, and rebuild those from their data URLs.",
      configJson: null,
    };
  }

  return {
    instructions:
      "The live preview currently shows the dashboard config below. " +
      "When the user refers to the dashboard, the current one, or the one loaded, they mean this config. " +
      "To change it, edit this config and send the complete result to update_dashboard " +
      "(native passthrough is fine); keep the panels the user did not ask to change.",
    configJson: json,
  };
}
