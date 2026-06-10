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
      const html2canvasMod = await import("html2canvas");
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

      pdf.setFontSize(8);
      pdf.text(
        `SDMX Surfer — Country Snapshot — ${filenameStem.replace(/_/g, " ")} — ${stamp}`,
        20,
        14,
      );

      const imgW = pageW - 40;
      const imgH = imgW * (canvas.height / canvas.width);
      let remaining = imgH;
      const position = 20;

      if (imgH <= pageH - 40) {
        pdf.addImage(imgData, "PNG", 20, position, imgW, imgH);
      } else {
        // Slice the canvas across multiple pages.
        let yOffset = 0;
        const pageContentH = pageH - 40;
        while (remaining > 0) {
          pdf.addImage(imgData, "PNG", 20, position - yOffset, imgW, imgH);
          remaining -= pageContentH;
          if (remaining > 0) {
            pdf.addPage();
            yOffset += pageContentH;
          }
        }
      }

      pdf.setFontSize(7);
      pdf.text(
        `Data sourced from .Stat (Pacific Data Hub). Retrieved ${stamp}.`,
        20,
        pageH - 14,
      );

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
        className="rounded-md bg-[#006970] px-3 py-1.5 text-xs text-white shadow-sm disabled:opacity-60"
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
