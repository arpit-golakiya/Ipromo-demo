/**
 * PDF export: captures the 3D viewer, then builds a branded A4 PDF with
 * the iPromo 27th Anniversary logo in the header and the mockup as the
 * main visual.
 */

const IPROMO_LOGO_PATH = "/Images/iPromo_27th_Anniversary_v2.jpg";

/** Fetch a same-origin asset and return a data URL (needed by jsPDF.addImage). */
async function fetchAsDataUrl(url: string): Promise<string | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Measure an image data URL and return { width, height } in pixels. */
function measureImage(dataUrl: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
    img.onerror = () => resolve({ w: 1, h: 1 });
    img.src = dataUrl;
  });
}

export async function downloadConfiguratorPdf(
  viewerElementId: string,
  productName: string,
): Promise<void> {
  const el = document.getElementById(viewerElementId);
  if (!el) throw new Error(`Missing viewer element #${viewerElementId}`);

  const webglCanvas = el.querySelector("canvas");

  // ── Capture 3D viewer ────────────────────────────────────────────────────
  let mockupDataUrl: string;
  try {
    const html2canvas = (await import("html2canvas")).default;
    const shot = await html2canvas(el, {
      backgroundColor: "#0c0f14",
      scale: 2,
      useCORS: true,
      logging: false,
    });
    mockupDataUrl = shot.toDataURL("image/png");
  } catch {
    if (webglCanvas) {
      mockupDataUrl = webglCanvas.toDataURL("image/png");
    } else {
      throw new Error("Could not capture viewer");
    }
  }

  // Prefer the direct WebGL snapshot if it's substantially larger (richer data)
  if (webglCanvas) {
    try {
      const direct = webglCanvas.toDataURL("image/png");
      if (direct.length > mockupDataUrl.length * 1.1) {
        mockupDataUrl = direct;
      }
    } catch {
      /* keep html2canvas result */
    }
  }

  // ── Load iPromo 27th Anniversary logo ────────────────────────────────────
  const logoDataUrl = await fetchAsDataUrl(IPROMO_LOGO_PATH);

  // ── Build PDF ────────────────────────────────────────────────────────────
  const { jsPDF } = await import("jspdf");
  const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });

  const pageW = pdf.internal.pageSize.getWidth();   // 210 mm
  const pageH = pdf.internal.pageSize.getHeight();  // 297 mm
  const margin = 14;
  const usableW = pageW - margin * 2;               // 182 mm

  let cursorY = margin;

  // ── Header: logo (left) + date (right) ───────────────────────────────────
  const headerH = 18; // mm

  if (logoDataUrl) {
    const { w: lw, h: lh } = await measureImage(logoDataUrl);
    const logoH = headerH;                       // fit to header height
    const logoW = logoH * (lw / lh);            // maintain aspect ratio
    pdf.addImage(logoDataUrl, "JPEG", margin, cursorY, logoW, logoH);
  } else {
    // Fallback text if image fails to load
    pdf.setFontSize(16);
    pdf.setTextColor(0, 100, 130);
    pdf.text("iPromo", margin, cursorY + 12);
  }

  // Date — top right
  const today = new Date().toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  pdf.setFontSize(8);
  pdf.setTextColor(140);
  pdf.text(today, pageW - margin, cursorY + 5, { align: "right" });
  pdf.text("3D Product Configurator", pageW - margin, cursorY + 10, { align: "right" });

  cursorY += headerH + 4;

  // ── Divider ───────────────────────────────────────────────────────────────
  pdf.setDrawColor(0, 100, 130);
  pdf.setLineWidth(0.6);
  pdf.line(margin, cursorY, pageW - margin, cursorY);
  cursorY += 6;

  // ── Product name ──────────────────────────────────────────────────────────
  pdf.setFontSize(20);
  pdf.setTextColor(20);
  pdf.text(productName, margin, cursorY + 6);

  pdf.setFontSize(9);
  pdf.setTextColor(100);
  pdf.text("Custom 3D Preview — Configured via iPromo Configurator", margin, cursorY + 13);
  cursorY += 20;

  // ── Mockup image (full usable width, maintain aspect ratio) ───────────────
  const { w: mw, h: mh } = await measureImage(mockupDataUrl);
  const mockupW = usableW;
  const mockupH = Math.min(mockupW * (mh / mw), pageH - cursorY - margin - 24);

  // Light grey background card behind the mockup
  pdf.setFillColor(245, 246, 248);
  pdf.setDrawColor(220);
  pdf.setLineWidth(0.3);
  pdf.roundedRect(margin, cursorY, usableW, mockupH + 6, 3, 3, "FD");
  pdf.addImage(mockupDataUrl, "PNG", margin + 3, cursorY + 3, usableW - 6, mockupH);
  cursorY += mockupH + 6 + 6;

  // ── Footer divider ────────────────────────────────────────────────────────
  pdf.setDrawColor(220);
  pdf.setLineWidth(0.3);
  pdf.line(margin, cursorY, pageW - margin, cursorY);
  cursorY += 5;

  // Footer: website left, tagline right
  pdf.setFontSize(8);
  pdf.setTextColor(0, 100, 130);
  pdf.text("www.ipromo.com", margin, cursorY);

  pdf.setTextColor(140);
  pdf.text(
    "© " + new Date().getFullYear() + " iPromo · 27 Years of Branded Excellence (1999–2026)",
    pageW - margin,
    cursorY,
    { align: "right" },
  );

  // ── Save ──────────────────────────────────────────────────────────────────
  const slug = productName.replace(/\s+/g, "-").toLowerCase();
  pdf.save(`${slug}-ipromo-preview.pdf`);
}
