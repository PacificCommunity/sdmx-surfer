// Charts render to ECharts canvases and maps to OpenLayers canvases. Canvas
// pixels are not part of innerHTML, and html2canvas would also capture the
// ECharts save-as-image toolbox, so both PDF and static HTML export first swap
// every chart and map canvas for an <img> holding its pixels (see
// swapCanvasesForImages) and restore the live DOM afterwards.
//
// NOTE: a map canvas is only readable when its tiles were loaded with CORS
// (crossOrigin="anonymous"). A map whose tile server does not send CORS
// headers taints its canvas; toDataURL() then throws, the map is skipped,
// and PDF capture (allowTaint:false) leaves it blank. The library sets
// crossOrigin on its tile sources; a custom basemap URL must allow CORS.
// Track in: PacificCommunity/sdmx-dashboard-components

import { getInstanceByDom } from "echarts/core";
import type { SDMXDashboardConfig } from "./types";
import {
  getDashboardSubtitle,
  getDashboardTitle,
} from "./dashboard-text";
import {
  extractDataSources,
  type DataSource,
} from "./data-explorer-url";
import {
  BRAND_GOOGLE_FONTS_HREF,
  BRAND_THEME,
} from "./brand-theme";

const EXPORT_THEME_CSS = `
    :root {
      --font-headline: '${BRAND_THEME.fonts.display}', system-ui, sans-serif;
      --font-body: '${BRAND_THEME.fonts.body}', system-ui, sans-serif;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: var(--font-body);
      background: ${BRAND_THEME.colors.surface};
      color: ${BRAND_THEME.colors.onSurface};
      padding: 2rem;
      -webkit-font-smoothing: antialiased;
    }
    h1, h2, h3, h4, h5, h6 { font-family: var(--font-headline); }
`;

const EXPORT_LAYOUT_CSS = `
    .dashboard-header,
    .header {
      margin-bottom: 1.5rem;
    }
    .dashboard-header h1,
    .header h1 {
      font-size: 1.75rem;
      font-weight: 800;
      color: ${BRAND_THEME.colors.primary};
      letter-spacing: -0.01em;
    }
    .dashboard-header p,
    .header p {
      font-size: 0.875rem;
      color: ${BRAND_THEME.colors.onSurfaceVariant};
      margin-top: 0.25rem;
    }
    .export-badge,
    .badge {
      display: inline-block;
      font-size: 0.625rem;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      background: ${BRAND_THEME.colors.secondaryContainer};
      color: ${BRAND_THEME.colors.onSecondaryContainer};
      padding: 0.125rem 0.5rem;
      border-radius: 1rem;
      margin-bottom: 0.75rem;
    }
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      font-size: 0.75rem;
      color: ${BRAND_THEME.colors.textMuted};
    }
    .footer a { color: ${BRAND_THEME.colors.secondary}; }
`;

/**
 * Swap each ECharts chart and each readable OpenLayers map canvas under
 * `root` for an <img> with the same pixels, hiding the original. Returns a
 * function that removes the images and shows the originals again.
 *
 * Charts are found by the `_echarts_instance_` attribute ECharts puts on its
 * container; `getInstanceByDom` must come from the same `echarts` copy the
 * library uses (single copy via the peer dependency). Map canvases that are
 * tainted by cross-origin tiles cannot be read and stay as they are.
 */
export async function swapCanvasesForImages(
  root: HTMLElement,
): Promise<() => void> {
  const restoreFns: (() => void)[] = [];
  const images: HTMLImageElement[] = [];

  const swap = (target: HTMLElement, img: HTMLImageElement) => {
    const previousDisplay = target.style.display;
    target.parentNode?.insertBefore(img, target);
    target.style.display = "none";
    images.push(img);
    restoreFns.push(() => {
      img.remove();
      target.style.display = previousDisplay;
    });
  };

  for (const el of Array.from(
    root.querySelectorAll<HTMLElement>("[_echarts_instance_]"),
  )) {
    const chart = getInstanceByDom(el);
    if (!chart) continue;
    const width = el.offsetWidth;
    const height = el.offsetHeight;
    if (width === 0 || height === 0) continue;
    const img = document.createElement("img");
    img.src = chart.getDataURL({
      type: "png",
      pixelRatio: 2,
      backgroundColor: "#fff",
      excludeComponents: ["toolbox"],
    });
    img.alt = "";
    img.width = width;
    img.height = height;
    img.style.cssText = "display:block;max-width:100%;height:auto;";
    swap(el, img);
  }

  for (const canvas of Array.from(
    root.querySelectorAll<HTMLCanvasElement>(".ol-viewport canvas"),
  )) {
    let dataUrl: string;
    try {
      dataUrl = canvas.toDataURL("image/png");
    } catch {
      continue; // tainted by cross-origin tiles
    }
    // OpenLayers draws at devicePixelRatio and scales the canvas back down
    // with a CSS transform; size the image to the rendered box instead, so
    // `max-width: 100%` from the page CSS cannot shrink it before the
    // transform applies.
    const rect = canvas.getBoundingClientRect();
    const img = document.createElement("img");
    img.src = dataUrl;
    img.alt = "";
    img.className = canvas.className;
    img.style.cssText = canvas.style.cssText;
    img.style.transform = "none";
    img.style.maxWidth = "none";
    img.style.width = rect.width + "px";
    img.style.height = rect.height + "px";
    swap(canvas, img);
  }

  // Images with data URLs decode asynchronously; wait so captures see pixels.
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));

  return () => {
    for (let i = restoreFns.length - 1; i >= 0; i--) restoreFns[i]();
  };
}

/**
 * html2canvas draws inline SVG poorly, so the remaining SVGs (icons such as
 * react-bootstrap-icons; charts are canvases) are rasterised to canvases
 * for the PDF. Returns a function that puts the SVGs back.
 */
async function replaceIconSvgsWithCanvases(
  element: HTMLElement,
): Promise<() => void> {
  const restoreFns: (() => void)[] = [];

  await Promise.all(
    Array.from(element.querySelectorAll("svg")).map(async (svg) => {
      const rect = svg.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) return;

      const scale = 2;
      const canvas = document.createElement("canvas");
      canvas.width = rect.width * scale;
      canvas.height = rect.height * scale;
      canvas.style.width = rect.width + "px";
      canvas.style.height = rect.height + "px";
      canvas.style.verticalAlign = getComputedStyle(svg).verticalAlign;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      // Icons paint with currentColor, which a detached SVG image loses.
      const clone = svg.cloneNode(true) as SVGSVGElement;
      clone.setAttribute("width", String(rect.width));
      clone.setAttribute("height", String(rect.height));
      clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
      clone.style.color = getComputedStyle(svg).color;
      const url = URL.createObjectURL(
        new Blob([new XMLSerializer().serializeToString(clone)], {
          type: "image/svg+xml;charset=utf-8",
        }),
      );

      const img = new Image();
      await new Promise<void>((resolve) => {
        img.onload = () => {
          ctx.scale(scale, scale);
          ctx.drawImage(img, 0, 0, rect.width, rect.height);
          resolve();
        };
        img.onerror = () => resolve();
        img.src = url;
      });
      URL.revokeObjectURL(url);

      const parent = svg.parentNode;
      if (!parent) return;
      const nextSibling = svg.nextSibling;
      parent.replaceChild(canvas, svg);
      restoreFns.push(() => {
        parent.insertBefore(svg, nextSibling);
        canvas.remove();
      });
    }),
  );

  return () => {
    for (let i = restoreFns.length - 1; i >= 0; i--) restoreFns[i]();
  };
}

/**
 * Capture the rendered dashboard DOM as a PDF.
 * Swaps chart and map canvases for images and icon SVGs for canvases so
 * html2canvas captures them, then places the result into a jsPDF document.
 */
export async function exportToPdf(
  element: HTMLElement,
  config: SDMXDashboardConfig,
) {
  console.log("[PDF] starting export…");

  let html2canvasFn: (el: HTMLElement, opts: Record<string, unknown>) => Promise<HTMLCanvasElement>;
  let JsPDF: typeof import("jspdf").jsPDF;

  try {
    const [h2cMod, jspdfMod] = await Promise.all([
      import("html2canvas"),
      import("jspdf"),
    ]);
    // html2canvas ships as CJS — .default may or may not exist
    html2canvasFn = (typeof h2cMod.default === "function" ? h2cMod.default : h2cMod) as typeof html2canvasFn;
    JsPDF = jspdfMod.jsPDF;
    console.log("[PDF] libs loaded. html2canvas type:", typeof html2canvasFn, "jsPDF type:", typeof JsPDF);
  } catch (err) {
    console.error("[PDF] failed to load libs:", err);
    throw err;
  }

  const title = getDashboardTitle(config);
  const sources = extractDataSources(config);

  let restoreCanvases: () => void = () => {};
  let restoreSvgs: () => void = () => {};

  try {
    console.log("[PDF] swapping charts and maps for images, icons for canvases…");
    restoreCanvases = await swapCanvasesForImages(element);
    restoreSvgs = await replaceIconSvgsWithCanvases(element);

    console.log("[PDF] calling html2canvas…");
    const canvas = await html2canvasFn(element, {
      scale: 2,
      useCORS: true,
      allowTaint: false,
      backgroundColor: BRAND_THEME.colors.surface,
      logging: false,
    });
    console.log("[PDF] canvas created:", canvas.width, "x", canvas.height);

    if (canvas.width === 0 || canvas.height === 0) {
      throw new Error("html2canvas produced a 0×0 canvas — element may be hidden or empty");
    }

    const imgData = canvas.toDataURL("image/png");
    const pageW = canvas.width / 2;
    const pageH = canvas.height / 2;

    const pdf = new JsPDF({
      orientation: pageW > pageH ? "landscape" : "portrait",
      unit: "px",
      format: [pageW, pageH],
    });

    pdf.addImage(imgData, "PNG", 0, 0, pageW, pageH);

    // ── Native Data Sources table on a second page ──
    if (sources.length > 0) {
      renderDataSourcesPage(pdf, sources, pageW);
    }

    const blob = pdf.output("blob");
    console.log("[PDF] blob size:", blob.size);

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = slugify(title) + ".pdf";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    console.log("[PDF] download triggered");
  } finally {
    restoreSvgs();
    restoreCanvases();
  }
}

/**
 * Render a "Data Sources" page with native PDF text and clickable links.
 * Uses jsPDF text/link primitives — no raster, fully selectable and searchable.
 */
function renderDataSourcesPage(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pdf: any,
  sources: DataSource[],
  pageW: number,
) {
  const margin = 40;
  const lineH = 16;
  const contentW = pageW - margin * 2;
  const pageH = 600; // fixed height for the data sources page

  pdf.addPage([pageW, pageH], pageW > pageH ? "landscape" : "portrait");

  let y = margin;

  // Heading
  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(14);
  pdf.setTextColor(BRAND_THEME.colors.primary);
  pdf.text("Data Sources", margin, y);
  y += lineH * 1.5;

  // Subtitle
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(8);
  pdf.setTextColor(BRAND_THEME.colors.textMuted);
  pdf.text("SDMx data queries used in this dashboard. Links open the originating source's Data Explorer when available.", margin, y);
  y += lineH * 1.5;

  // Table column layout
  const col1X = margin + 4;               // Component
  const col2X = margin + contentW * 0.20; // Dataflow
  const col3X = margin + contentW * 0.46; // Source
  const col4X = margin + contentW * 0.56; // Type
  const col5X = margin + contentW * 0.66; // Links
  const headerY = y;

  pdf.setFillColor(242, 243, 245); // surface-low
  pdf.rect(margin, headerY - 10, contentW, lineH + 4, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.setTextColor(BRAND_THEME.colors.onSurfaceVariant);
  pdf.text("COMPONENT", col1X, headerY);
  pdf.text("DATAFLOW", col2X, headerY);
  pdf.text("SOURCE", col3X, headerY);
  pdf.text("TYPE", col4X, headerY);
  pdf.text("LINKS", col5X, headerY);
  // Extra gap between the header fill rectangle and the first row's text
  y = headerY + lineH + 4;

  // Table rows
  pdf.setFontSize(8);

  for (const src of sources) {
    // Check if we need a new page
    if (y + lineH * 2 > pageH - margin) {
      pdf.addPage([pageW, pageH], pageW > pageH ? "landscape" : "portrait");
      y = margin;
    }

    const rowY = y;

    // Component name
    pdf.setFont("helvetica", "normal");
    pdf.setTextColor(BRAND_THEME.colors.onSurface);
    const nameText = src.componentTitle.length > 25
      ? src.componentTitle.slice(0, 23) + "…"
      : src.componentTitle;
    pdf.text(nameText, col1X, rowY);

    // Dataflow name
    pdf.setTextColor(BRAND_THEME.colors.onSurface);
    const dfText = src.dataflowName.length > 30
      ? src.dataflowName.slice(0, 28) + "…"
      : src.dataflowName;
    pdf.text(dfText, col2X, rowY);

    // Source
    pdf.setTextColor(BRAND_THEME.colors.onSurfaceVariant);
    pdf.text(src.endpointShortName, col3X, rowY);

    // Type
    pdf.setTextColor(BRAND_THEME.colors.onSurfaceVariant);
    pdf.text(src.componentType.toUpperCase(), col4X, rowY);

    // Links
    pdf.setTextColor(BRAND_THEME.colors.primary);
    pdf.textWithLink("API", col5X, rowY, { url: src.apiUrl });
    if (src.explorerUrl) {
      pdf.setTextColor(BRAND_THEME.colors.secondary);
      pdf.textWithLink("Data Explorer", col5X + 30, rowY, { url: src.explorerUrl });
    }

    // Separator line — centered in the gap between rows
    // (jsPDF text y is the baseline, so the rule must clear the next row's
    // ascender as well as the current row's descender)
    y = rowY + lineH;
    const ruleY = rowY + lineH / 2 + 2;
    pdf.setDrawColor(238, 238, 238); // outline-variant
    pdf.setLineWidth(0.5);
    pdf.line(margin, ruleY, margin + contentW, ruleY);
  }

  // Footer
  y += lineH;
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(7);
  pdf.setTextColor(BRAND_THEME.colors.textMuted);
  const uniqueSourceNames = Array.from(
    new Set(sources.map((s) => s.endpointName)),
  );
  const footerText = "Exported from Data Surfer on " +
    new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) +
    "  ·  Data from " + uniqueSourceNames.join(", ");
  pdf.text(footerText, margin, y);
}

/**
 * Export the dashboard as a self-contained static HTML file.
 * Captures the live rendered DOM as a snapshot, with charts and maps swapped
 * for images of their canvases.
 * Works offline, from file://, email attachments — no JS or network needed.
 */
export async function exportToHtml(
  element: HTMLElement,
  config: SDMXDashboardConfig,
) {
  const title = getDashboardTitle(config);
  const subtitle = getDashboardSubtitle(config);

  // Canvases serialise empty, so read innerHTML while charts and maps are
  // swapped for images. Collect the stylesheet rules that affect the
  // dashboard (Bootstrap grid + component styles) against the same DOM.
  const restoreCanvases = await swapCanvasesForImages(element);
  let dashboardHtml: string;
  let collectedCss: string;
  try {
    dashboardHtml = element.innerHTML;
    collectedCss = collectStyles(element);
  } finally {
    restoreCanvases();
  }

  const configJson = JSON.stringify(config, null, 2);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Data Surfer</title>
  <style>
    ${EXPORT_THEME_CSS}
    ${EXPORT_LAYOUT_CSS}
    .footer {
      margin-top: 2rem;
      padding-top: 1rem;
      font-size: 0.75rem;
    }
    .config-toggle {
      display: inline-block;
      margin-top: 0.75rem;
      font-size: 0.75rem;
      color: ${BRAND_THEME.colors.primary};
      cursor: pointer;
      text-decoration: underline;
    }
    .config-block {
      display: none;
      margin-top: 0.75rem;
      background: ${BRAND_THEME.colors.surfaceLow};
      border-radius: 0.5rem;
      padding: 1rem;
      font-size: 0.7rem;
      font-family: monospace;
      white-space: pre;
      overflow-x: auto;
      max-height: 400px;
    }
    @media print {
      body { padding: 0.5rem; }
      .footer, .config-toggle, .config-block { display: none !important; }
    }
    /* Inlined component styles */
    ${collectedCss}
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${BRAND_GOOGLE_FONTS_HREF}" rel="stylesheet">
</head>
<body>
  <div class="dashboard-header">
    <span class="export-badge">Exported Dashboard</span>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? "<p>" + escapeHtml(subtitle) + "</p>" : ""}
  </div>

  <div id="dashboard-content">
    ${dashboardHtml}
  </div>

  <div class="footer">
    Exported from Data Surfer on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
    &middot; Data from <a href="https://stats.pacificdata.org">Pacific Data Hub</a>
    <br>
    <span class="config-toggle" onclick="var b=document.getElementById('config-json');b.style.display=b.style.display==='block'?'none':'block'">
      Show/hide JSON config
    </span>
    <pre class="config-block" id="config-json">${escapeHtml(configJson)}</pre>
  </div>
</body>
</html>`;

  downloadFile(html, slugify(title) + ".html", "text/html");
}

/**
 * Library release the live HTML export loads from esm.sh, with the ECharts
 * major and parser release it is built against. These must be published on
 * npm (esm.sh 404s otherwise); keep them equal to the package.json versions.
 */
const LIVE_EXPORT_DASHBOARD_VERSION = "1.0.0-rc.2";
const LIVE_EXPORT_ECHARTS_VERSION = "6";
const LIVE_EXPORT_PARSER_VERSION = "0.4.2";

/**
 * Export the dashboard as a live interactive HTML file.
 * Loads sdmx-dashboard-components from esm.sh CDN and re-renders with live data.
 * Requires: HTTP server (not file://) + internet connection.
 * Charts are fully interactive (tooltips, hover, zoom).
 * Uses the registry parser with no proxy, so providers that need the app's
 * SDMX proxy (ECB, IMF, BIS, OECD, Eurostat, StatsNZ) do not load in it.
 */
export function exportToHtmlLive(config: SDMXDashboardConfig) {
  const title = getDashboardTitle(config);
  const subtitle = getDashboardSubtitle(config);

  const configJson = JSON.stringify(config, null, 2);

  const esmReact = "https://esm.sh/react@19";
  const esmReactDom = "https://esm.sh/react-dom@19";
  const esmDashboardPackage = `https://esm.sh/sdmx-dashboard-components@${LIVE_EXPORT_DASHBOARD_VERSION}`;
  const esmDashboard =
    `${esmDashboardPackage}?deps=react@19,react-dom@19,` +
    `echarts@${LIVE_EXPORT_ECHARTS_VERSION},` +
    `sdmx-json-parser@${LIVE_EXPORT_PARSER_VERSION}`;
  // Two esm.sh module rewrites go through the import map:
  // - The library does `import "ol/ol.css"`; esm.sh serves that as text/css,
  //   which a browser refuses as a module, failing the whole dashboard
  //   import. It maps to an empty module and the stylesheet is linked
  //   instead. The range follows the library's `ol` dependency.
  // - The parser ships a CommonJS bundle, so esm.sh exposes only a default
  //   export while the library imports `{ SDMXParser }`. The parser module
  //   maps to a shim that re-exports it by name; the shim loads the real file
  //   under a query suffix so the map does not send it back to itself.
  const esmOlCssModule = "https://esm.sh/ol@^8.2.0/ol.css?target=es2022";
  const olCssHref = "https://esm.sh/ol@^8.2.0/ol.css";
  const esmParserModule = `https://esm.sh/sdmx-json-parser@${LIVE_EXPORT_PARSER_VERSION}/es2022/sdmx-json-parser.mjs`;
  const parserShim =
    "data:text/javascript," +
    encodeURIComponent(
      `import p from "${esmParserModule}?raw-default"; ` +
        "export const SDMXParser = p.SDMXParser; export default p;",
    );
  const importMap = JSON.stringify({
    imports: {
      react: esmReact,
      "react/": `${esmReact}/`,
      "react-dom": esmReactDom,
      "react-dom/": `${esmReactDom}/`,
      [esmOlCssModule]: "data:text/javascript,",
      [esmParserModule]: parserShim,
    },
  });

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — Data Surfer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap-grid.min.css">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap-utilities.min.css">
  <link rel="stylesheet" href="${esmDashboardPackage}/dist/style.css">
  <link rel="stylesheet" href="${olCssHref}">
  <style>
    ${EXPORT_THEME_CSS}
    ${EXPORT_LAYOUT_CSS}
    .loading { display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 200px; color: ${BRAND_THEME.colors.onSurfaceVariant}; font-size: 0.875rem; }
    .dot { width: 8px; height: 8px; border-radius: 50%; background: ${BRAND_THEME.colors.secondary}; animation: b 1s ease-in-out infinite; }
    .dot:nth-child(2) { animation-delay: .15s; } .dot:nth-child(3) { animation-delay: .3s; }
    @keyframes b { 0%,80%,100% { transform: scale(.6); opacity: .4; } 40% { transform: scale(1); opacity: 1; } }
    .error { background: ${BRAND_THEME.colors.surfaceLow}; border-radius: 0.75rem; padding: 1.5rem; margin-top: 1rem; color: ${BRAND_THEME.colors.onSurfaceVariant}; font-size: 0.875rem; }
    .error code { display: block; margin-top: 0.75rem; font-size: 0.75rem; background: ${BRAND_THEME.colors.surfaceHigh}; border-radius: 0.5rem; padding: 1rem; overflow-x: auto; white-space: pre; }
    .footer { margin-top: 2rem; padding-top: 1rem; font-size: 0.75rem; }
    @media print { body { padding: .5rem; } .footer { display: none; } }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="${BRAND_GOOGLE_FONTS_HREF}" rel="stylesheet">
  <script type="importmap">
  ${importMap}
  <\/script>
</head>
<body>
  <div class="header">
    <span class="badge">Live Dashboard</span>
    <h1>${escapeHtml(title)}</h1>
    ${subtitle ? "<p>" + escapeHtml(subtitle) + "</p>" : ""}
  </div>

  <div id="root"><div class="loading"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div></div>

  <div class="footer">
    Exported from Data Surfer on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
    &middot; Data from <a href="https://stats.pacificdata.org">Pacific Data Hub</a>
    &middot; <em>Interactive — fetches live data. Must be served over HTTP.</em>
  </div>

  <script type="module">
    import { createElement } from "${esmReact}";
    import { createRoot } from "${esmReactDom}/client";
    const config = ${configJson};
    try {
      // Dynamic import inside the try: a failed CDN load shows an error
      // instead of leaving the loading dots up forever.
      const { SDMXDashboard } = await import("${esmDashboard}");
      createRoot(document.getElementById('root'))
        .render(createElement(SDMXDashboard, { config, lang: 'en' }));
    } catch (err) {
      document.getElementById('root').innerHTML =
        '<div class="error"><strong>Failed to load or render the dashboard<\\/strong>' +
        '<p>This file must be served over HTTP (not file://) with internet access.<\\/p>' +
        '<p>Try: <code>npx serve .<\\/code><\\/p>' +
        '<code>' + String(err && err.message || err).replace(/</g, '&lt;') + '<\\/code><\\/div>';
    }
  <\/script>
  <noscript><div class="error"><strong>JavaScript required<\/strong><code>${escapeHtml(configJson)}</code></div></noscript>
</body>
</html>`;

  downloadFile(html, slugify(title) + "-live.html", "text/html");
}

/**
 * Collect CSS rules that apply to elements inside the given root.
 * Inlines Bootstrap grid classes and component styles
 * so the exported HTML renders correctly without external stylesheets.
 */
function collectStyles(root: HTMLElement): string {
  const rules: string[] = [];
  const seen = new Set<string>();

  for (const sheet of Array.from(document.styleSheets)) {
    try {
      const cssRules = sheet.cssRules;
      if (!cssRules) continue;

      for (const rule of Array.from(cssRules)) {
        if (rule instanceof CSSStyleRule) {
          // Include rules that match elements in the dashboard,
          // plus common Bootstrap grid patterns
          const sel = rule.selectorText;
          if (seen.has(sel)) continue;

          const isGridRule = /^\.(?:row|col|container|mb-|display-)/.test(sel);
          const matchesContent = isGridRule || safeQuerySelector(root, sel);

          if (matchesContent) {
            seen.add(sel);
            rules.push(rule.cssText);
          }
        } else if (rule instanceof CSSMediaRule) {
          // Include @media blocks that contain matching rules
          const inner: string[] = [];
          for (const sub of Array.from(rule.cssRules)) {
            if (sub instanceof CSSStyleRule) {
              const sel = sub.selectorText;
              if (
                /^\.(?:row|col|container)/.test(sel) ||
                safeQuerySelector(root, sel)
              ) {
                inner.push(sub.cssText);
              }
            }
          }
          if (inner.length > 0) {
            rules.push(
              "@media " +
                rule.conditionText +
                " { " +
                inner.join(" ") +
                " }",
            );
          }
        }
      }
    } catch {
      // Cross-origin stylesheets throw — skip them
    }
  }

  return rules.join("\n");
}

function safeQuerySelector(root: HTMLElement, selector: string): boolean {
  try {
    return root.querySelector(selector) !== null;
  } catch {
    return false;
  }
}

/**
 * Export the raw JSON config.
 */
export function exportToJson(config: SDMXDashboardConfig) {
  const title = getDashboardTitle(config) || "dashboard";

  downloadFile(
    JSON.stringify(config, null, 2),
    slugify(title) + ".json",
    "application/json",
  );
}

// ── Helpers ──

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
