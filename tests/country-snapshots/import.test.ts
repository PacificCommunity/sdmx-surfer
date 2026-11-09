import { describe, it, expect } from "vitest";
import ExcelJS from "exceljs";
import {
  importExcel,
  renderCatalogueTs,
  renderReportMd,
  tidyTitle,
} from "../../scripts/import-country-snapshots";

describe("tidyTitle", () => {
  it("normalises the spacing of the SDG target code", () => {
    expect(tidyTitle("SDG 3.2 .1 - Infant mortality rate")).toBe("SDG 3.2.1 - Infant mortality rate");
    expect(tidyTitle("SDG 3. 4. 1 - Mortality rate")).toBe("SDG 3.4.1 - Mortality rate");
    expect(tidyTitle("SDG  1.5.2, 11.5.2 - Direct economic loss")).toBe("SDG 1.5.2, 11.5.2 - Direct economic loss");
    expect(tidyTitle("SDG 3.b.1 - Coverage")).toBe("SDG 3.b.1 - Coverage");
  });

  it("leaves titles without an SDG code alone", () => {
    expect(tidyTitle("Total fertility rate. 2020 - 2025")).toBe("Total fertility rate. 2020 - 2025");
  });
});

const SDG_URL =
  "https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_SDG_03,4.3/A.G.SP_DYN_ADKL.[TAG_GEO].F.Y15T19.........?dimensionAtObservation=AllDimensions";
const NO_GEO_URL =
  "https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_EDUCATION,/A...M._T._T._T.?dimensionAtObservation=AllDimensions";

function indicatorRow(
  rid: number,
  type: string,
  id: string,
  title: string,
  rendering: string,
  api: string,
  dataflow: string,
  comment2026 = "",
): (string | number)[] {
  return [rid, 1, type, id, title, "", rendering, "-", api, "-", dataflow, "", "", comment2026, "", ""];
}

async function buildFixtureWorkbook(): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();

  const reports = wb.addWorksheet("REPORTS");
  reports.addRow(["DO", "MFAT", "CD", "EN", "REG"]);
  reports.addRow([0, 1, "TO", "Tonga", "POL"]);
  reports.addRow([0, 1, "WS", "Samoa", "POL"]);
  reports.addRow([0, 0, "WF", "Wallis and Futuna", "POL"]);

  const work = wb.addWorksheet("work");
  work.addRow([
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
    "Comment 2026 exercise",
    "link",
    "2050 Dashboard",
  ]);
  work.addRow([1, 1, "HEADING", "I", "Context", "", "-", "-", "-", "-", "-", "", "", "", "", ""]);
  work.addRow(
    indicatorRow(
      2,
      "INDICATOR",
      "I.1",
      "Population",
      "TABLE",
      "https://stats-nsi-stable.pacificdata.org/rest/data/SPC,DF_POP,3.0/A.[TAG_GEO].MIDYEAR._T._T?dimensionAtObservation=AllDimensions",
      "DF_POP",
      "cross checked URLs",
    ),
  );
  work.addRow(indicatorRow(3, "PICTURE", "I.23", "Population pyramid", "PP", "-", "-"));
  work.addRow(indicatorRow(4, "SUMMARY", "I.S", "Summary Table Context Indicators", "SUMMARY", "", ""));
  work.addRow([5, 1, "HEADING", "II", "Health", "", "-", "-", "-", "-", "-", "", "", "", "", ""]);
  work.addRow(
    indicatorRow(
      6,
      "INDICATOR",
      "II.1",
      "Life expectancy",
      "CHART",
      "https://example.org/rest/data/SPC,DF_LIFE,/A.[TAG_GEO].LIFE?dimensionAtObservation=AllDimensions",
      "DF_LIFE",
    ),
  );
  work.addRow(indicatorRow(7, "INDICATOR", "II.2", "Static fact (no API)", "TEXT", "-", "-"));
  work.addRow(indicatorRow(8, "INDICATOR", "II.3", "Adolescent birth rate", "CHART", SDG_URL, "DF_SDG_03"));
  work.addRow(indicatorRow(9, "INDICATOR", "II.4", "Educational attainment (males)", "CHART", NO_GEO_URL, "DF_EDUCATION"));
  work.addRow(indicatorRow(10, "SUMMARY", "II.S", "Summary Table Health Indicators", "SUMMARY", "-", "-"));

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

  it("drops version pins and migrates the legacy host", async () => {
    const { catalogue, report } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    const popInd = catalogue.indicators.find((i) => i.id === "I.1");
    expect(popInd?.apiUrlTemplate).toBe(
      "https://stats-sdmx-disseminate.pacificdata.org/rest/data/SPC,DF_POP,/A.[TAG_GEO].MIDYEAR._T._T?dimensionAtObservation=AllDimensions",
    );
    expect(report.urlFixups.some((f) => f.startsWith("I.1:"))).toBe(true);
  });

  it("imports SDG rows written for the 2026 layout", async () => {
    const { catalogue } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    const sdg = catalogue.indicators.find((i) => i.id === "II.3");
    expect(sdg?.dataflow).toBe("DF_SDG_03");
    expect(sdg?.apiUrlTemplate).toContain("SPC,DF_SDG_03,/A.G.SP_DYN_ADKL.[TAG_GEO].F.Y15T19");
  });

  it("reports rows without [TAG_GEO] instead of importing them", async () => {
    const { catalogue, report } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    expect(catalogue.indicators.find((i) => i.id === "II.4")).toBeUndefined();
    expect(report.missingCountryPlaceholder).toHaveLength(1);
    expect(report.missingCountryPlaceholder[0]).toContain("II.4");
    expect(report.missingCountryPlaceholder[0]).toContain(NO_GEO_URL);
    expect(renderReportMd(report, "fixture.xlsx")).toContain(
      "### Rows without a country placeholder (1)",
    );
  });

  it("ignores SUMMARY and PICTURE rows without reporting them", async () => {
    const { catalogue, report } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    expect(catalogue.indicators.map((i) => i.id)).toEqual(["I.1", "II.1", "II.2", "II.3"]);
    expect(report.skippedRows).toEqual([]);
  });

  it("keeps the 2026 exercise comment in notes only", async () => {
    const { catalogue } = await importExcel(await buildFixtureWorkbook(), "fixture.xlsx");
    expect(catalogue.indicators.find((i) => i.id === "I.1")?.notes).toBe("cross checked URLs");
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
