import { describe, it, expect } from "vitest";
import {
  snapshotContextSchema,
  chatRequestSchema,
} from "../../lib/country-snapshots/chat-assembly";

// Regression guard for the demo-breaking bug where countryCodes was capped
// at 5 (the compare-page limit) while the regional summary page sends every
// country in scope — 15 MFAT or all 22 — making every regional-page chat
// turn fail validation with a 500.
describe("snapshotContextSchema", () => {
  const codes22 = [
    "AS", "CK", "FJ", "FM", "GU", "KI", "MH", "MP", "NC", "NR", "NU",
    "PF", "PG", "PN", "PW", "SB", "TK", "TO", "TV", "VU", "WF", "WS",
  ];

  it("accepts the regional page's full 22-country context", () => {
    const parsed = snapshotContextSchema.safeParse({
      countryCodes: codes22,
      themeSlug: "health",
      indicatorIds: ["II.1", "II.3"],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts the entry page's empty index context", () => {
    const parsed = snapshotContextSchema.safeParse({
      countryCodes: [],
      themeSlug: "index",
      indicatorIds: [],
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects absurdly long country lists", () => {
    const parsed = snapshotContextSchema.safeParse({
      countryCodes: Array.from({ length: 50 }, (_, i) => "C" + i),
      themeSlug: "health",
      indicatorIds: [],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("chatRequestSchema", () => {
  it("accepts a uuid sessionId and rejects arbitrary strings", () => {
    const base = {
      messages: [],
      snapshotContext: {
        countryCodes: ["TO"],
        themeSlug: "health",
        indicatorIds: [],
      },
    };
    expect(
      chatRequestSchema.safeParse({
        ...base,
        sessionId: "0c5532cc-92f5-4bd0-bd0e-6f5f6da757f1",
      }).success,
    ).toBe(true);
    expect(
      chatRequestSchema.safeParse({ ...base, sessionId: "not-a-uuid" })
        .success,
    ).toBe(false);
    expect(chatRequestSchema.safeParse(base).success).toBe(true);
  });
});
