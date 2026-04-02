// NOTE: PDF export uses allowTaint:false to avoid a SecurityError from
// cross-origin images loaded by sdmx-dashboard-components (Highcharts map
// tiles, flag sprites, etc.). This means those images are silently skipped
// in the PDF. The proper fix is for the library to either serve assets
// from the same origin or add crossorigin="anonymous" to <image> elements.
// Track in: PacificCommunity/sdmx-dashboard-components

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
 * Convert an SVG element to a canvas element in-place.
 * Returns a restore function that puts the original SVG back.
 */
async function svgToCanvas(
  svg: SVGSVGElement,
): Promise<{ canvas: HTMLCanvasElement; restore: () => void }> {
  const rect = svg.getBoundingClientRect();
  const width = rect.width || svg.width.baseVal.value || 600;
  const height = rect.height || svg.height.baseVal.value || 400;

  const canvas = document.createElement("canvas");
  const scale = 2;
  canvas.width = width * scale;
  canvas.height = height * scale;
  canvas.style.width = width + "px";
  canvas.style.height = height + "px";

  const ctx = canvas.getContext("2d");
  if (!ctx) return { canvas, restore: () => {} };

  // Clone the SVG and inline computed styles for correct rendering
  const clone = svg.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");

  // Serialize to data URL
  const serializer = new XMLSerializer();
  const svgString = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.width = width;
  img.height = height;

  const parent = svg.parentNode;
  const nextSibling = svg.nextSibling;

  // Replace SVG with canvas in the DOM
  if (parent) {
    parent.replaceChild(canvas, svg);
  }

  const restore = () => {
    if (parent) {
      if (nextSibling) {
        parent.insertBefore(svg, nextSibling);
      } else {
        parent.appendChild(svg);
      }
      canvas.remove();
    }
    URL.revokeObjectURL(url);
  };

  return new Promise<{ canvas: HTMLCanvasElement; restore: () => void }>((resolve) => {
    img.onload = () => {
      ctx.scale(scale, scale);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve({ canvas, restore });
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve({ canvas, restore });
    };
    img.src = url;
  });
}

/**
 * Convert all SVGs inside an element to canvases, returning a function to restore them.
 */
async function replaceAllSvgsWithCanvases(element: HTMLElement): Promise<() => void> {
  const svgs = Array.from(element.querySelectorAll("svg"));
  const restoreFns: (() => void)[] = [];

  for (const svg of svgs) {
    const { restore } = await svgToCanvas(svg);
    restoreFns.push(restore);
  }

  return () => {
    // Restore in reverse order to maintain DOM positions
    for (let i = restoreFns.length - 1; i >= 0; i--) {
      restoreFns[i]();
    }
  };
}

/**
 * Capture the rendered dashboard DOM as a PDF.
 * Converts Highcharts SVGs to canvas first so html2canvas can capture them,
 * then places the result into a jsPDF document.
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

  console.log("[PDF] replacing SVGs with canvases…");
  const restoreSvgs = await replaceAllSvgsWithCanvases(element);

  try {
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
  const colGap = 12;
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
  pdf.text("SDMX data queries used in this dashboard. Links open in the Pacific Data Hub.", margin, y);
  y += lineH * 1.5;

  // Table column layout
  const col1X = margin + 4;             // Component
  const col2X = margin + contentW * 0.22; // Dataflow
  const col3X = margin + contentW * 0.52; // Type
  const col4X = margin + contentW * 0.62; // Links
  const headerY = y;

  pdf.setFillColor(242, 243, 245); // surface-low
  pdf.rect(margin, headerY - 10, contentW, lineH + 4, "F");

  pdf.setFont("helvetica", "bold");
  pdf.setFontSize(7);
  pdf.setTextColor(BRAND_THEME.colors.onSurfaceVariant);
  pdf.text("COMPONENT", col1X, headerY);
  pdf.text("DATAFLOW", col2X, headerY);
  pdf.text("TYPE", col3X, headerY);
  pdf.text("LINKS", col4X, headerY);
  y = headerY + lineH;

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
    const dfText = src.dataflowName.length > 35
      ? src.dataflowName.slice(0, 33) + "…"
      : src.dataflowName;
    pdf.text(dfText, col2X, rowY);

    // Type
    pdf.setTextColor(BRAND_THEME.colors.onSurfaceVariant);
    pdf.text(src.componentType.toUpperCase(), col3X, rowY);

    // Links
    pdf.setTextColor(BRAND_THEME.colors.primary);
    pdf.textWithLink("API", col4X, rowY, { url: src.apiUrl });
    if (src.explorerUrl) {
      pdf.setTextColor(BRAND_THEME.colors.secondary);
      pdf.textWithLink("Data Explorer", col4X + 30, rowY, { url: src.explorerUrl });
    }

    // Separator line
    y = rowY + lineH;
    pdf.setDrawColor(238, 238, 238); // outline-variant
    pdf.setLineWidth(0.5);
    pdf.line(margin, y - 4, margin + contentW, y - 4);
  }

  // Footer
  y += lineH;
  pdf.setFont("helvetica", "italic");
  pdf.setFontSize(7);
  pdf.setTextColor(BRAND_THEME.colors.textMuted);
  const footerText = "Exported from SDMX Surfer on " +
    new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) +
    "  ·  Data from stats.pacificdata.org";
  pdf.text(footerText, margin, y);
}

/**
 * Export the dashboard as a self-contained static HTML file.
 * Captures the live rendered DOM (including Highcharts SVGs) as a snapshot.
 * Works offline, from file://, email attachments — no JS or network needed.
 */
export function exportToHtml(
  element: HTMLElement,
  config: SDMXDashboardConfig,
) {
  const title = getDashboardTitle(config);
  const subtitle = getDashboardSubtitle(config);

  // Grab the rendered dashboard HTML including inline SVGs
  const dashboardHtml = element.innerHTML;

  // Collect computed styles from stylesheets that affect the dashboard.
  // We inline a minimal set of Bootstrap grid + component styles.
  const collectedCss = collectStyles(element);

  const configJson = JSON.stringify(config, null, 2);

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — SDMX Surfer</title>
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
    Exported from SDMX Surfer on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
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
 * Export the dashboard as a live interactive HTML file.
 * Loads sdmx-dashboard-components from esm.sh CDN and re-renders with live data.
 * Requires: HTTP server (not file://) + internet connection.
 * Charts are fully interactive (tooltips, hover, zoom).
 */
export function exportToHtmlLive(config: SDMXDashboardConfig) {
  const title = getDashboardTitle(config);
  const subtitle = getDashboardSubtitle(config);

  const configJson = JSON.stringify(config, null, 2);

  const esmReact = "https://esm.sh/react@19";
  const esmReactDom = "https://esm.sh/react-dom@19";
  const esmDashboard =
    "https://esm.sh/sdmx-dashboard-components@0.4.6?deps=react@19,react-dom@19";

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(title)} — SDMX Surfer</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap@5/dist/css/bootstrap-grid.min.css">
  <link rel="stylesheet" href="https://esm.sh/sdmx-dashboard-components@0.4.6/dist/index.css">
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
  { "imports": { "react": "${esmReact}", "react/": "${esmReact}/", "react-dom": "${esmReactDom}", "react-dom/": "${esmReactDom}/" } }
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
    Exported from SDMX Surfer on ${new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}
    &middot; Data from <a href="https://stats.pacificdata.org">Pacific Data Hub</a>
    &middot; <em>Interactive — fetches live data. Must be served over HTTP.</em>
  </div>

  <script type="module">
    import { createElement } from "${esmReact}";
    import { createRoot } from "${esmReactDom}/client";
    import { SDMXDashboard } from "${esmDashboard}";
    const config = ${configJson};
    try {
      createRoot(document.getElementById('root'))
        .render(createElement(SDMXDashboard, { config, lang: 'en' }));
    } catch (err) {
      document.getElementById('root').innerHTML =
        '<div class="error"><strong>Failed to render<\\/strong>' +
        '<p>This file must be served over HTTP, not opened from file://.<\\/p>' +
        '<p>Try: <code>npx serve .<\\/code><\\/p>' +
        '<code>' + (err.message || err) + '<\\/code><\\/div>';
    }
  <\/script>
  <noscript><div class="error"><strong>JavaScript required<\/strong><code>${escapeHtml(configJson)}</code></div></noscript>
</body>
</html>`;

  downloadFile(html, slugify(title) + "-live.html", "text/html");
}

/**
 * Collect CSS rules that apply to elements inside the given root.
 * Inlines Bootstrap grid classes, Highcharts styles, and component styles
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
          // plus common Bootstrap grid and Highcharts patterns
          const sel = rule.selectorText;
          if (seen.has(sel)) continue;

          const isGridRule = /^\.(?:row|col|container|mb-|display-)/.test(sel);
          const isHighcharts = sel.includes("highcharts");
          const matchesContent =
            isGridRule ||
            isHighcharts ||
            safeQuerySelector(root, sel);

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
                sel.includes("highcharts") ||
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
