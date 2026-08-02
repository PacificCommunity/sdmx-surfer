import { describe, expect, it } from "vitest";
import {
  lookupProvenance,
  indexedEndpoints,
  provenanceCoverage,
  provenanceIndexBuiltAt,
} from "@/lib/provenance-index";

/**
 * These assert against the committed sweep, so they double as a check that the
 * index is present and structurally sound after a rebuild. They deliberately
 * avoid asserting exact coverage counts, which move whenever SPC publishes
 * more metadata; they assert the properties the UI depends on.
 */
describe("provenance index", () => {
  it("ships a dated SPC sweep", () => {
    expect(indexedEndpoints()).toContain("SPC");
    expect(provenanceIndexBuiltAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(provenanceCoverage("SPC").total).toBeGreaterThan(100);
  });

  it("resolves a well-documented flow without a gateway call", () => {
    const p = lookupProvenance("DF_CPI");
    expect(p?.available).toBe(true);
    expect(p?.fields.length).toBeGreaterThan(0);
    expect(p?.fields.every((f) => f.text.length > 0)).toBe(true);
  });

  it("records absence rather than omitting the flow", () => {
    // DF_SDG publishes nothing displayable. It must resolve to a known
    // negative, not to null, or the UI would fall back to a live lookup and
    // offer a control that opens onto nothing.
    const p = lookupProvenance("DF_SDG");
    expect(p).not.toBeNull();
    expect(p?.available).toBe(false);
  });

  it("returns null for flows and endpoints it does not cover", () => {
    expect(lookupProvenance("DF_NOT_A_REAL_FLOW")).toBeNull();
    expect(lookupProvenance("DF_CPI", "ABS")).toBeNull();
  });

  it("defaults an unqualified lookup to SPC", () => {
    expect(lookupProvenance("DF_CPI", "")).toEqual(lookupProvenance("DF_CPI"));
    expect(lookupProvenance("DF_CPI", "SPC")).toEqual(lookupProvenance("DF_CPI"));
  });

  it("carries no half-built entries", () => {
    const coverage = provenanceCoverage("SPC");
    expect(coverage.withProvenance).toBeGreaterThan(0);
    expect(coverage.withProvenance).toBeLessThanOrEqual(coverage.total);
  });
});
