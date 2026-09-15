import { describe, expect, it } from "vitest";
import {
  describeRenderError,
  findStackedTreemaps,
} from "@/lib/render-error-hints";
import type { SDMXDashboardConfig } from "@/lib/types";

const config: SDMXDashboardConfig = {
  id: "revenue",
  rows: [
    {
      columns: [
        {
          id: "composition_treemap",
          type: "treemap",
          xAxisConcept: "TRANSACTION",
          legend: { concept: "GEO_PICT" },
        },
        {
          id: "composition_column",
          type: "column",
          xAxisConcept: "TRANSACTION",
          legend: { concept: "GEO_PICT" },
        },
      ],
    },
  ],
};

function rendered(visualId: string, seriesCount: number) {
  return {
    visualId,
    status: "rendered" as const,
    stats: { observationCount: 66, seriesCount },
  };
}

describe("findStackedTreemaps", () => {
  it("flags a treemap that rendered as more than one series", () => {
    const found = findStackedTreemaps(
      [rendered("composition_treemap", 11)],
      config,
    );

    expect(found).toHaveLength(1);
    expect(found[0].visualId).toBe("composition_treemap");
    expect(found[0].code).toBe("ERR_TREEMAP_STACKED");
    expect(found[0].message).toMatch(/11/);
    expect(found[0].message).toMatch(/GEO_PICT/);
  });

  it("accepts a treemap drawn as a single series", () => {
    expect(
      findStackedTreemaps([rendered("composition_treemap", 1)], config),
    ).toEqual([]);
  });

  it("leaves other chart types with many series alone", () => {
    expect(
      findStackedTreemaps([rendered("composition_column", 11)], config),
    ).toEqual([]);
  });

  it("ignores treemaps that have not rendered", () => {
    expect(
      findStackedTreemaps(
        [
          { visualId: "composition_treemap", status: "loading" as const },
          { visualId: "composition_treemap", status: "error" as const },
        ],
        config,
      ),
    ).toEqual([]);
  });
});

describe("describeRenderError", () => {
  it("tells the agent to pin the series or switch to a stacked bar for stacked treemaps", () => {
    const text = describeRenderError({
      visualId: "composition_treemap",
      code: "ERR_TREEMAP_STACKED",
      message: "stacked",
    });

    expect(text).toMatch(/FIX:/);
    expect(text).toMatch(/single value/);
    expect(text).toMatch(/stacking/);
  });

  it("no longer claims treemaps need a varying series dimension", () => {
    const text = describeRenderError({
      code: "ERR_NO_SERIES_DIMENSION",
      message: "no series",
    });

    expect(text).not.toMatch(/treemap/);
  });
});
