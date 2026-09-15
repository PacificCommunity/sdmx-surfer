import { describe, expect, it } from "vitest";
import { getSystemPrompt } from "@/lib/system-prompt";

describe("system prompt treemap rules", () => {
  const prompt = getSystemPrompt();

  it("does not group treemap with the charts whose series must vary", () => {
    expect(prompt).not.toMatch(/`lollipop`, and `treemap`/);
    expect(prompt).not.toMatch(/bar\/column\/lollipop\/treemap/);
  });

  it("tells the agent to pin a treemap's series to a single value", () => {
    expect(prompt).toMatch(/`treemap`[^\n]*pin `seriesBy` to a single value/);
  });

  it("offers a stacked bar for comparing composition across countries", () => {
    expect(prompt).toMatch(/"stacking": "normal"/);
  });
});
