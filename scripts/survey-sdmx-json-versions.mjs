#!/usr/bin/env node
// One-off survey: how does each configured SDMX endpoint respond to the
// format=jsondata URL parameter that sdmx-json-parser hardcodes, versus a
// clean URL with the SDMX-JSON v2.0 Accept header?
//
// For each endpoint: discover one dataflow via standard SDMX REST structure
// query, then request one observation of data twice and classify the shape:
//   v1.0  -> data.structure (singular)
//   v2.0  -> data.structures (array)
// Endpoints that need a subscription key read it from env (STATSNZ).

import fs from "node:fs";

const ENDPOINTS = [
  ["SPC", "https://stats-sdmx-disseminate.pacificdata.org/rest", "SPC"],
  ["FBOS", "https://data-sdmx-disseminate.statsfiji.gov.fj/rest", "FBOS"],
  ["SBS", "https://data-sdmx-disseminate.sbs.gov.ws/rest", "SBS"],
  ["ECB", "https://data-api.ecb.europa.eu/service", "ECB"],
  ["UNICEF", "https://sdmx.data.unicef.org/ws/public/sdmxapi/rest", "UNICEF"],
  ["IMF", "https://api.imf.org/external/sdmx/2.1", "IMF.STA"],
  ["OECD", "https://sdmx.oecd.org/public/rest", "OECD"],
  ["ESTAT", "https://ec.europa.eu/eurostat/api/dissemination/sdmx/2.1", "ESTAT"],
  ["ILO", "https://sdmx.ilo.org/rest", "ILO"],
  ["ABS", "https://data.api.abs.gov.au/rest", "ABS"],
  ["BIS", "https://stats.bis.org/api/v1", "BIS"],
  ["STATSNZ", "https://api.data.stats.govt.nz/rest", "STATSNZ"],
];

// STATSNZ subscription key from .env.local when present
let statsNzKey = process.env.SDMX_STATSNZ_KEY ?? "";
if (!statsNzKey) {
  try {
    const env = fs.readFileSync(".env.local", "utf8");
    const m = env.match(/^SDMX_STATSNZ_KEY=['"]?([^'"\n]+)/m);
    if (m) statsNzKey = m[1];
  } catch {}
}

function headersFor(key, accept) {
  const h = { Accept: accept, "User-Agent": "sdmx-surfer-probe/1" };
  if (key === "STATSNZ" && statsNzKey) h["Ocp-Apim-Subscription-Key"] = statsNzKey;
  return h;
}

// .Stat NSI hosts 500 on Node fetch (undici) where curl succeeds — observed
// repeatedly on this project. Shell out to curl for transport parity with
// browsers and the earlier manual verification.
import { execFile } from "node:child_process";
async function fetchWithTimeout(url, headers, ms = 20000) {
  const args = ["-sL", "--max-time", String(Math.ceil(ms / 1000)), "-w", "\n%{http_code}\t%{content_type}"];
  for (const [k, v] of Object.entries(headers)) args.push("-H", k + ": " + v);
  args.push(url);
  const { stdout } = await new Promise((resolve) => {
    execFile("curl", args, { maxBuffer: 64 * 1024 * 1024 }, (err, stdout) =>
      resolve({ stdout: stdout ?? "" }),
    );
  });
  const nl = stdout.lastIndexOf("\n");
  const [code, ctype] = stdout.slice(nl + 1).split("\t");
  const body = stdout.slice(0, nl);
  const status = Number(code) || 0;
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => body,
    headers: { get: (h) => (h.toLowerCase() === "content-type" ? ctype ?? null : null) },
  };
}

function classify(text, contentType) {
  try {
    const j = JSON.parse(text);
    const d = j.data ?? {};
    if (Array.isArray(d.structures)) return "v2.0 (structures[])";
    if (d.structure && !Array.isArray(d.structure)) return "v1.0 (structure)";
    return "JSON, unknown shape: " + Object.keys(d).join(",");
  } catch {
    if ((contentType ?? "").includes("xml") || text.trimStart().startsWith("<")) return "XML";
    return "not JSON: " + text.replace(/\s+/g, " ").slice(0, 60);
  }
}

// Known-good flows for providers whose listings are slow or quirky.
const SEED_FLOWS = {
  SPC: { agency: "SPC", id: "DF_KEYFACTS", version: "" },
  SBS: { agency: "SBS", id: "DF_CPI", version: "1.0" },
  ECB: { agency: "ECB", id: "EXR", version: "1.0" },
  UNICEF: { agency: "UNICEF", id: "GLOBAL_DATAFLOW", version: "1.0" },
  ESTAT: { agency: "ESTAT", id: "NAMA_10_GDP", version: "1.0" },
  BIS: { agency: "BIS", id: "WS_CBPOL_D", version: "1.0" },
};

function parseFlowFromXml(text) {
  const el = text.match(/<[a-zA-Z]*:?Dataflow\b[^>]*>/);
  if (!el) return null;
  const attr = (n) => (el[0].match(new RegExp('\\b' + n + '="([^"]+)"')) ?? [])[1];
  const id = attr("id");
  if (!id) return null;
  return { agency: attr("agencyID") ?? "all", id, version: attr("version") ?? "latest" };
}

async function firstDataflow(key, base) {
  if (SEED_FLOWS[key]) return SEED_FLOWS[key];
  const variants = [
    ["/dataflow/all/all/latest?format=json-structure-2.0.0", "application/json"],
    ["/dataflow/all/all/latest?detail=allstubs", "application/vnd.sdmx.structure+json;version=1.0"],
    ["/dataflow/all/all/latest", "application/vnd.sdmx.structure+json;version=1.0"],
    ["/dataflow/all/all/latest", "application/vnd.sdmx.structure+xml;version=2.1"],
    ["/dataflow", "application/vnd.sdmx.structure+xml;version=2.1"],
  ];
  for (const [path, accept] of variants) {
    try {
      const r = await fetchWithTimeout(base + path, headersFor(key, accept));
      if (!r.ok) continue;
      const text = await r.text();
      try {
        const j = JSON.parse(text);
        const flows = j.data?.dataflows ?? j.references ?? [];
        const f = Array.isArray(flows) ? flows[0] : null;
        if (f?.id) return { agency: f.agencyID ?? f.agency ?? "all", id: f.id, version: f.version ?? "latest" };
      } catch {
        const f = parseFlowFromXml(text);
        if (f) return f;
      }
    } catch {}
  }
  return null;
}

const ACCEPT_V2 = "application/vnd.sdmx.data+json;version=2.0.0";

async function probe(key, base, flow) {
  const dataBase =
    base + "/data/" + flow.agency + "," + flow.id + "," + flow.version + "/all?lastNObservations=1&dimensionAtObservation=AllDimensions";
  const out = {};
  for (const [label, url, accept] of [
    ["jsondata_param", dataBase + "&format=jsondata", ACCEPT_V2],
    ["accept_v2_only", dataBase, ACCEPT_V2],
  ]) {
    try {
      const r = await fetchWithTimeout(url, headersFor(key, accept));
      const text = await r.text();
      out[label] = r.ok ? classify(text, r.headers.get("content-type")) : "HTTP " + r.status;
    } catch (e) {
      out[label] = "fetch failed: " + (e?.name === "AbortError" ? "timeout" : e?.message ?? e);
    }
  }
  return out;
}

const results = [];
await Promise.all(
  ENDPOINTS.map(async ([key, base]) => {
    const flow = await firstDataflow(key, base);
    if (!flow) {
      results.push({ key, flow: "(no dataflow discovered)", jsondata_param: "untested", accept_v2_only: "untested" });
      return;
    }
    const r = await probe(key, base, flow);
    results.push({ key, flow: flow.agency + "," + flow.id + "," + flow.version, ...r });
  }),
);

results.sort((a, b) => a.key.localeCompare(b.key));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad("ENDPOINT", 9) + pad("format=jsondata (+v2 Accept)", 34) + pad("clean URL + v2 Accept", 28) + "test flow");
for (const r of results) {
  console.log(pad(r.key, 9) + pad(r.jsondata_param, 34) + pad(r.accept_v2_only, 28) + r.flow);
}
