import { describe, it, expect, vi } from "vitest";

vi.mock("../../lib/country-snapshots/chart-types.generated", () => ({
  chartTypes: {
    "II.1": {
      TO: { type: "line", timePoints: 12, detectedAt: "2026-06-08", locked: true },
      WS: { type: "line", timePoints: 8, detectedAt: "2026-06-08", locked: true },
      VU: { type: "bar", timePoints: 2, detectedAt: "2026-06-08", locked: false },
      KI: { type: "empty", timePoints: 0, detectedAt: "2026-06-08", locked: false },
    },
    "II.2": {
      TO: { type: "bar", timePoints: 2, detectedAt: "2026-06-08", locked: false },
      WS: { type: "bar", timePoints: 1, detectedAt: "2026-06-08", locked: false },
    },
    "II.3": {
      TO: { type: "empty", timePoints: 0, detectedAt: "2026-06-08", locked: false },
    },
  },
}));

import {
  decide,
  chartTypeFor,
  chartTypeForCompare,
} from "../../lib/country-snapshots/chart-types";

describe("decide()", () => {
  it("0 → empty", () => expect(decide(0)).toBe("empty"));
  it("1 → bar", () => expect(decide(1)).toBe("bar"));
  it("2 → bar", () => expect(decide(2)).toBe("bar"));
  it("3 → line", () => expect(decide(3)).toBe("line"));
  it("100 → line", () => expect(decide(100)).toBe("line"));
});

describe("chartTypeFor (single country)", () => {
  it("returns cached type when present", () => {
    expect(chartTypeFor("II.1", "TO")).toBe("line");
    expect(chartTypeFor("II.1", "VU")).toBe("bar");
    expect(chartTypeFor("II.1", "KI")).toBe("empty");
  });
  it("falls back to line when no entry", () => {
    expect(chartTypeFor("XXX", "ZZ")).toBe("line");
    expect(chartTypeFor("II.1", "ZZ")).toBe("line");
  });
});

describe("chartTypeForCompare (multi-country)", () => {
  it("picks line if any country has line", () => {
    expect(chartTypeForCompare("II.1", ["TO", "VU", "KI"])).toBe("line");
  });
  it("picks bar if all are bar or empty", () => {
    expect(chartTypeForCompare("II.2", ["TO", "WS"])).toBe("bar");
  });
  it("picks empty if all are empty", () => {
    expect(chartTypeForCompare("II.3", ["TO"])).toBe("empty");
  });
  it("falls back to line when no entries", () => {
    expect(chartTypeForCompare("XXX", ["TO", "WS"])).toBe("line");
  });
});
