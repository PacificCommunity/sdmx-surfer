// Reproduce the dashboard render in node by mocking DOM/React/highcharts deps,
// then importing the bundle and instantiating the Chart with each panel's config.
import fs from "node:fs";

// Map URLs to local files so the parser uses cached fixtures.
const URL_TO_FIXTURE = {
  "https://data-sdmx-disseminate.sbs.gov.ws/rest/data/DF_CPI/M.WS.ALLCPI.IDX._T.N":
    "/tmp/sbs_cpi.json",
  "https://data-sdmx-disseminate.sbs.gov.ws/rest/data/DF_CPI/M.WS.ALLCPI.IDX.ITEM_01+ITEM_02+ITEM_03+ITEM_04+ITEM_05+ITEM_06+ITEM_07+ITEM_08+ITEM_09+ITEM_10+ITEM_11+ITEM_12.N":
    null, // chosen below by query
};

global.fetch = async (url) => {
  const u = String(url);
  let file = null;
  if (u.startsWith("https://data-sdmx-disseminate.sbs.gov.ws/rest/data/DF_CPI/M.WS.ALLCPI.IDX._T.N")) {
    file = "/tmp/sbs_cpi.json";
  } else if (u.includes("ITEM_01+") && u.includes("lastNObservations=1")) {
    file = "/tmp/sbs_latest.json";
  } else if (u.includes("ITEM_01+")) {
    file = "/tmp/sbs_groups.json";
  }
  if (!file) throw new Error("No fixture for " + u);
  const text = fs.readFileSync(file, "utf8");
  return {
    status: 200,
    text: async () => text,
  };
};

// Drive the SDMXParser path that the chart component uses, and reproduce the chart-build
// algorithm inline. We re-implement the line/bar logic from the bundle, calling the same
// helpers, so we can see exactly which step throws.
const { SDMXParser } = await import("sdmx-json-parser");

function parseDate(n) {
  if (n.match(/^\d{4}-[Mm]\d{2}$/))
    return Date.UTC(parseInt(n.split("-")[0]), parseInt(n.split("-")[1].replace(/[Mm]/, "")) - 1, 1);
  if (n.match(/^\d{4}$/)) return Date.UTC(parseInt(n), 0, 1);
  if (n.match(/^\d{4}-\d{2}$/))
    return Date.UTC(parseInt(n.split("-")[0]), parseInt(n.split("-")[1]) - 1, 1);
  if (n.match(/^\d{4}-\d{2}-\d{2}$/))
    return Date.UTC(parseInt(n.split("-")[0]), parseInt(n.split("-")[1]) - 1, parseInt(n.split("-")[2]));
  if (n.match(/^\d{4}-[Qq]\d$/))
    return Date.UTC(parseInt(n.split("-")[0]), (parseInt(n.split("-")[1].replace(/[Qq]/, "")) - 1) * 3, 1);
  return null;
}

const sortBy = (rows, m) =>
  rows.sort((a, b) =>
    m === "TIME_PERIOD" ? parseInt(a[m]) - parseInt(b[m]) : a[m].localeCompare(b[m])
  );

async function tryPanel(panel) {
  console.log("\n=== Panel: " + panel.id + " (type=" + panel.type + ") ===");
  const parser = new SDMXParser();
  await parser.getDatasets(panel.data, {
    headers: new Headers({
      Accept: "application/vnd.sdmx.data+json;version=2.0.0",
      "Accept-Language": "en",
    }),
  });
  const D = parser.getData();
  const P = parser.getDimensions();
  const W = parser.getActiveDimensions();
  console.log("  rows=" + D.length + " all-dims=" + P.map((d) => d.id).join(",") + " active=" + W.map((d) => d.id).join(","));

  let j = panel.xAxisConcept;
  let U = panel.legend?.concept || "";
  const m = panel.type;

  // Validation from line 25-31
  if (panel.xAxisConcept && panel.xAxisConcept !== "MULTI" && !P.find((z) => z.id === panel.xAxisConcept))
    throw new Error("xAxisConcept " + panel.xAxisConcept + " not found");
  if (panel.legend?.concept && panel.legend.concept !== "MULTI" && !P.find((z) => z.id === panel.legend.concept))
    throw new Error("legendConcept " + panel.legend.concept + " not found");

  try {
    if (m === "line") {
      j = j || "TIME_PERIOD";
      U = U || P.find((z) => z.id !== j).id;
      if (!U) throw new Error("No other dimension than " + j);
      const Y = P.find((z) => z.id === U);
      console.log("  line: j=" + j + " U=" + U + " Y.values.len=" + Y.values.length);

      if (j === "TIME_PERIOD") {
        const z = P.find(($) => $.id === "FREQ");
        console.log("    FREQ.values[0].id=" + z.values[0].id);
      }

      Y.values
        .sort((z, V) => z.name.localeCompare(V.name))
        .forEach((z) => {
          const V = D.filter((Z) => Z[U || ""] === z.name);
          if (V.length == 0) return;
          const sorted = sortBy(V, j);
          const $ = sorted.map((Z) => ({ ...Z, y: Z.value, x: parseDate(Z[j]) }));
          console.log("    series " + z.name + ": " + $.length + " points; first x=" + $[0].x + " y=" + $[0].y);
        });
    } else if (m === "column" || m === "bar" || m === "lollipop" || m === "treemap") {
      if (!j) throw new Error("No xAxis concept found");
      let Y = {};
      if (U) Y = P.find((V) => V.id === U);
      else Y = W.find((V) => V.id !== j);
      const z = W.find((V) => V.id === j);
      console.log("  bar: j=" + j + " U=" + U + " Y=" + (Y?.id ?? "UNDEF") + " z=" + (z?.id ?? "UNDEF"));
      if (!Y || !Y.values || !z) {
        console.log("    DEFENSIVE BAIL: missing dimension. Would console.warn and skip.");
        return;
      }
      Y.values
        .sort((V, q) => V.id.localeCompare(q.id))
        .forEach((V) => {
          const q = D.filter((H) => H[Y.id] === V.name);
          const $ = sortBy(q, j);
          console.log("    bar group " + V.name + ": " + $.length + " rows");
        });
    }
  } catch (e) {
    console.error("  CRASH:", e.message);
    console.error("  ", e.stack.split("\n").slice(0, 6).join("\n  "));
  }
}

const config = JSON.parse(fs.readFileSync("/tmp/samoa_cpi_config.json", "utf8"));
for (const row of config.rows) {
  for (const col of row.columns) {
    await tryPanel(col);
  }
}
