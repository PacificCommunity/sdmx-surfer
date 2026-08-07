"use client";

import { useEffect, useState } from "react";

/**
 * Count visible loading skeletons inside the PDF capture target. All our
 * loading placeholders (dynamic-import skeletons for charts/values, the
 * table's fetch placeholder) use the `animate-pulse` class, so this is a
 * cheap, plumbing-free readiness signal.
 */
function countPendingCharts(): number {
  const target = document.querySelector("[data-snapshot-pdf-target]");
  if (!target) return 0;
  return target.querySelectorAll(".animate-pulse").length;
}

export function ExportButton({ filenameStem }: { filenameStem: string }) {
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [pending, setPending] = useState(0);

  // Poll for outstanding chart skeletons so the button can hold itself
  // until the page is fully rendered — exporting too early baked grey
  // placeholder boxes into the PDF. Polling stops once everything is
  // loaded (and the effect re-arms on remount, i.e. page navigation).
  useEffect(() => {
    setPending(countPendingCharts());
    const interval = setInterval(() => {
      const n = countPendingCharts();
      setPending(n);
      if (n === 0) clearInterval(interval);
    }, 500);
    return () => clearInterval(interval);
  }, []);

  async function exportPdf() {
    setBusy(true);
    setToast(null);
    try {
      // html2canvas-pro, not html2canvas: Tailwind v4 emits oklch()/
      // color-mix() values that html2canvas 1.4.1 throws on at capture
      // time ("unsupported color function"). The -pro fork parses them.
      const html2canvasMod = await import("html2canvas-pro");
      const html2canvas = html2canvasMod.default;
      const jspdfMod = await import("jspdf");
      const { jsPDF } = jspdfMod;

      const target = document.querySelector(
        "[data-snapshot-pdf-target]",
      ) as HTMLElement | null;
      if (!target) {
        setToast("Couldn't find the page content.");
        return;
      }

      // Snapshot every link's position BEFORE the capture await — the DOM
      // can reflow while html2canvas runs. The captured image is flat, so
      // links survive as invisible clickable rectangles overlaid at the
      // same (scaled) positions. The DOM's a.href property resolves
      // relative paths against the current origin, which is exactly what
      // a PDF opened outside the app needs.
      const targetRect = target.getBoundingClientRect();
      const links = Array.from(
        target.querySelectorAll<HTMLAnchorElement>("a[href]"),
      )
        .map((a) => {
          const r = a.getBoundingClientRect();
          return {
            url: a.href,
            x: r.left - targetRect.left,
            y: r.top - targetRect.top,
            w: r.width,
            h: r.height,
          };
        })
        .filter((l) => l.w > 0 && l.h > 0 && l.url);

      const canvas = await html2canvas(target, {
        scale: 2,
        useCORS: true,
        backgroundColor: "#ffffff",
      });
      const imgData = canvas.toDataURL("image/png");

      const pdf = new jsPDF({
        orientation: "portrait",
        unit: "pt",
        format: "a4",
      });
      const pageW = pdf.internal.pageSize.getWidth();
      const pageH = pdf.internal.pageSize.getHeight();
      const stamp = new Date().toISOString().slice(0, 10);

      const margin = 20;
      const imgW = pageW - margin * 2;
      const imgH = imgW * (canvas.height / canvas.width);
      const position = margin;
      const pageContentH = pageH - margin * 2;
      const pageCount = Math.max(1, Math.ceil(imgH / pageContentH));

      // Draw the image slice on every page.
      for (let page = 0; page < pageCount; page++) {
        if (page > 0) pdf.addPage();
        pdf.addImage(
          imgData,
          "PNG",
          margin,
          position - page * pageContentH,
          imgW,
          imgH,
        );
      }

      // Map DOM CSS-pixel coordinates to PDF points: the image spans the
      // target's CSS width across imgW points.
      const scale = imgW / targetRect.width;

      // Header, footer, and link annotations per page — drawn AFTER the
      // image so the chrome isn't overpainted by the page-1 slice.
      for (let page = 0; page < pageCount; page++) {
        pdf.setPage(page + 1);
        pdf.setFontSize(8);
        pdf.text(
          `SDMX Surfer — Country Snapshot — ${filenameStem.replace(/_/g, " ")} — ${stamp}`,
          margin,
          14,
        );
        pdf.setFontSize(7);
        pdf.text(
          `Data sourced from .Stat (Pacific Data Hub). Retrieved ${stamp}.` +
            (pageCount > 1 ? `  ·  Page ${page + 1}/${pageCount}` : ""),
          margin,
          pageH - 8,
        );
      }
      for (const link of links) {
        const yDoc = link.y * scale; // y within the full image, in points
        const page = Math.min(
          pageCount - 1,
          Math.max(0, Math.floor(yDoc / pageContentH)),
        );
        const yOnPage = position + (yDoc - page * pageContentH);
        pdf.setPage(page + 1);
        pdf.link(
          margin + link.x * scale,
          yOnPage,
          link.w * scale,
          link.h * scale,
          { url: link.url },
        );
      }

      pdf.save(`${filenameStem.replace(/\s+/g, "_")}_${stamp}.pdf`);
    } catch (err) {
      console.warn("[country-snapshots export] failed", err);
      setToast("Some charts are still loading. Wait a moment and try again.");
    } finally {
      setBusy(false);
    }
  }

  const waiting = pending > 0;

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={exportPdf}
        disabled={busy || waiting}
        className="rounded-md bg-on-secondary-container px-3 py-1.5 text-xs text-white shadow-sm disabled:opacity-60"
        title={
          waiting
            ? "Waiting for all charts to finish loading"
            : "Download this page as a PDF"
        }
      >
        {busy
          ? "Generating…"
          : waiting
            ? `Charts loading (${pending})…`
            : "Download PDF"}
      </button>
      {toast ? (
        <span className="text-xs text-amber-700">{toast}</span>
      ) : null}
    </div>
  );
}
