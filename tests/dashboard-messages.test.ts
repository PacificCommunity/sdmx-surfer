import { describe, expect, it } from "vitest";
import type { UIMessage } from "ai";
import {
  MAX_CURRENT_CONFIG_CHARS,
  currentDashboardContext,
  extractDashboardConfig,
} from "@/lib/dashboard-messages";

const forked = { id: "ecb_key_rates", rows: [{ columns: [{ id: "kpi", type: "value" }] }] };
const edited = { id: "ecb_key_rates", rows: [] };

function userText(text: string): UIMessage {
  return { id: "u-" + text, role: "user", parts: [{ type: "text", text }] };
}

function updateDashboard(config: object): UIMessage {
  return {
    id: "a-" + JSON.stringify(config).length,
    role: "assistant",
    parts: [
      {
        type: "tool-update_dashboard",
        toolCallId: "call-1",
        state: "output-available",
        input: { config },
        output: { success: true, dashboard: config, message: "Dashboard updated." },
      },
    ],
  };
}

describe("currentDashboardContext", () => {
  it("shows a forked dashboard that no message ever emitted", () => {
    const ctx = currentDashboardContext(forked, [userText("filter to the last 5 days")]);
    expect(ctx?.configJson).toBe(JSON.stringify(forked));
  });

  it("stays silent when the conversation already ends on the preview config", () => {
    const messages = [userText("make a dashboard"), updateDashboard(forked), userText("tweak it")];
    expect(currentDashboardContext(forked, messages)).toBeNull();
  });

  it("shows the preview config when the user edited or undid past the last tool output", () => {
    const messages = [updateDashboard(forked), userText("now change it")];
    expect(currentDashboardContext(edited, messages)?.configJson).toBe(JSON.stringify(edited));
  });

  it("omits the JSON but still tells the model about an oversized config", () => {
    const huge = { id: "big", rows: [{ note: "x".repeat(MAX_CURRENT_CONFIG_CHARS) }] };
    const ctx = currentDashboardContext(huge, []);
    expect(ctx?.configJson).toBeNull();
    expect(ctx?.instructions).toMatch(/too large/);
  });

  it("adds nothing for an empty preview", () => {
    expect(currentDashboardContext(undefined, [updateDashboard(forked)])).toBeNull();
  });
});

describe("extractDashboardConfig", () => {
  it("returns the latest completed update_dashboard output", () => {
    expect(extractDashboardConfig([updateDashboard(forked), updateDashboard(edited)])).toEqual(edited);
  });

  it("reads legacy sessions whose tool output is the bare config", () => {
    const legacy: UIMessage = {
      id: "legacy",
      role: "assistant",
      parts: [
        {
          type: "tool-update_dashboard",
          toolCallId: "call-legacy",
          state: "output-available",
          input: {},
          output: forked,
        },
      ],
    };
    expect(extractDashboardConfig([legacy])).toEqual(forked);
  });
});
