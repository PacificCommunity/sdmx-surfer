import { z } from "zod";
import { getDashboardTitle } from "./dashboard-text";

export const localizedStringSchema = z.union([
  z.string(),
  z.record(z.string(), z.string()),
]);

export const textConfigSchema = z
  .object({
    text: localizedStringSchema,
    size: z.string().optional(),
    weight: z.string().optional(),
    align: z.enum(["center", "left", "right"]).optional(),
    color: z.string().optional(),
    font: z.string().optional(),
    style: z.string().optional(),
  })
  .passthrough();

export const legendSchema = z
  .object({
    concept: z.string().optional(),
    location: z.enum(["top", "bottom", "left", "right", "none"]).optional(),
  })
  .passthrough();

export const unitSchema = z
  .object({
    text: z.string(),
    location: z.enum(["prefix", "suffix", "under"]).optional(),
  })
  .passthrough();

export const visualConfigSchema = z
  .object({
    id: z.string(),
    type: z.enum([
      "line",
      "bar",
      "column",
      "pie",
      "lollipop",
      "treemap",
      "value",
      "drilldown",
      "note",
      "map",
    ]),
    colSize: z.number().optional(),
    title: textConfigSchema.optional(),
    subtitle: textConfigSchema.optional(),
    note: textConfigSchema.optional(),
    xAxisConcept: z.string().optional(),
    yAxisConcept: z.string().optional(),
    data: z.union([z.string(), z.array(z.string())]).optional(),
    legend: legendSchema.optional(),
    labels: z.boolean().optional(),
    download: z.boolean().optional(),
    sortByValue: z.enum(["asc", "desc"]).optional(),
    unit: unitSchema.optional(),
    decimals: z.union([z.number(), z.string()]).optional(),
    colorScheme: z.string().optional(),
    frame: z.boolean().optional(),
    adaptiveTextSize: z.boolean().optional(),
    dataLink: z.string().optional(),
    metadataLink: z.string().optional(),
    extraOptions: z.record(z.string(), z.unknown()).optional(),
    colorPalette: z
      .record(
        z.string(),
        z.record(z.string(), z.union([z.string(), z.number()])),
      )
      .optional(),
    drilldown: z
      .object({
        xAxisConcept: z.string(),
        legend: legendSchema.optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough()
  .superRefine((config, ctx) => {
    if (config.type !== "note") {
      if (!config.xAxisConcept) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "xAxisConcept is required for non-note visuals",
          path: ["xAxisConcept"],
        });
      }

      if (!config.data) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "data is required for non-note visuals",
          path: ["data"],
        });
      }
    }
  });

export const dashboardConfigSchema = z
  .object({
    id: z.string().describe("Unique dashboard identifier"),
    languages: z.array(z.string()).optional(),
    colCount: z.number().optional().describe("Number of grid columns, default 3"),
    header: z
      .object({
        title: textConfigSchema.optional(),
        subtitle: textConfigSchema.optional(),
      })
      .passthrough()
      .optional(),
    footer: z
      .object({
        title: textConfigSchema.optional(),
        subtitle: textConfigSchema.optional(),
      })
      .passthrough()
      .optional(),
    dataflows: z
      .record(z.string(), z.string())
      .optional()
      .describe("Map of dataflow ID → human-readable name, e.g. { DF_POP: 'Population' }"),
    rows: z.array(
      z
        .object({
          columns: z.array(visualConfigSchema),
        })
        .passthrough(),
    ),
  })
  .passthrough();

export type DashboardConfigInput = z.infer<typeof dashboardConfigSchema>;

export function formatDashboardConfigError(error: z.ZodError): string {
  const issue = error.issues[0];

  if (!issue) {
    return "Dashboard config is invalid.";
  }

  const path =
    issue.path.length > 0
      ? issue.path
          .map((segment) =>
            typeof segment === "number" ? `[${String(segment)}]` : String(segment),
          )
          .join(".")
          .replace(/\.\[/g, "[")
      : "config";

  return `${path}: ${issue.message}`;
}

export function getConfigTitle(config: DashboardConfigInput): string {
  return getDashboardTitle(config);
}
