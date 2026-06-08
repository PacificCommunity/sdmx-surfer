import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  importExcel,
  renderCatalogueTs,
} from "../../scripts/import-country-snapshots";

async function buildFixtureWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const reports = wb.addWorksheet("REPORTS");
  reports.addRow(["DO", "MFAT", "CD", "EN", "REG"]);
  reports.addRow([0, 1, "TO", "Tonga", "POL"]);
  reports.addRow([0, 1, "WS", "Samoa", "POL"]);
  reports.addRow([0, 0, "WF", "Wallis and Futuna", "POL"]);

  const indicators = wb.addWorksheet("INDICATORS");
  indicators.addRow([
    "RID",
    "DO",
    "TYPE",
    "ID",
    "EN",
    "MFAT Indicator Name",
    "RENDERING",
    "DE",
    "API",
    "COMMENT",
    "DF",
    "COMMENT",
    "comment 2025",
  ]);
  indicators.addRow([1, 1, "HEADING", "I", "Context", "", "-", "-", "-", "-", "-", "", ""]);
  indicators.addRow([
    2,
    1,
    "INDICATOR",
    "I.1",
    "Population",
    "Pop.",
    "TABLE",
    "-",
    "https://example.org/rest/data/SPC,DF_POP,3.0/A..MIDYEAR._T._T?dimensionAtObservation=AllDimensions",
    "-",
    "DF_POP",
    "",
    "",
  ]);
  indicators.addRow([3, 1, "HEADING", "II", "Health", "", "-", "-", "-", "-", "-", "", ""]);
  indicators.addRow([
    4,
    1,
    "INDICATOR",
    "II.1",
    "Life expectancy",
    "",
    "CHART",
    "-",
    "https://example.org/rest/data/SPC,DF_LIFE,/A.[TAG_GEO].LIFE?dimensionAtObservation=AllDimensions",
    "-",
    "DF_LIFE",
    "",
    "",
  ]);
  indicators.addRow([
    5,
    1,
    "INDICATOR",
    "II.2",
    "Static fact (no API)",
    "",
    "TEXT",
    "-",
    "-",
    "-",
    "-",
    "",
    "",
  ]);

  const buffer = await wb.xlsx.writeBuffer();
  return Buffer.from(buffer);
}

describe("importExcel", () => {
  it("parses countries with regions and MFAT flag", async () => {
    const { catalogue } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    expect(catalogue.countries).toHaveLength(3);
    expect(catalogue.countries.find((c) => c.code === "TO")?.mfatRelevant).toBe(true);
    expect(catalogue.countries.find((c) => c.code === "WF")?.mfatRelevant).toBe(false);
  });

  it("groups indicators under their preceding heading", async () => {
    const { catalogue } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    const popInd = catalogue.indicators.find((i) => i.id === "I.1");
    expect(popInd?.themeId).toBe("I");
    const lifeInd = catalogue.indicators.find((i) => i.id === "II.1");
    expect(lifeInd?.themeId).toBe("II");
  });

  it("normalises versioned URLs and inserts [TAG_GEO] when absent", async () => {
    const { catalogue, report } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    const popInd = catalogue.indicators.find((i) => i.id === "I.1");
    expect(popInd?.apiUrlTemplate).toContain("SPC,DF_POP,/");
    expect(popInd?.apiUrlTemplate).toContain("[TAG_GEO]");
    expect(report.urlFixups.length).toBeGreaterThan(0);
  });

  it("records indicators with no data source", async () => {
    const { catalogue, report } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    const statics = catalogue.indicators.filter((i) => !i.apiUrlTemplate);
    expect(statics.map((i) => i.id)).toContain("II.2");
    expect(report.missingDataSources).toContain("II.2");
  });

  it("emits deterministic JSON across runs", async () => {
    const ts1 = renderCatalogueTs(
      (await importExcel(await buildFixtureWorkbook(), "fixture.xlsx")).catalogue,
    );
    const ts2 = renderCatalogueTs(
      (await importExcel(await buildFixtureWorkbook(), "fixture.xlsx")).catalogue,
    );
    expect(ts1).toBe(ts2);
  });
});
