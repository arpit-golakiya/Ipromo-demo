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

type PdfGStateCtor = new (opts: { opacity: number }) => unknown;
type PdfWithGState = {
  GState?: PdfGStateCtor;
  setGState?: (state: unknown) => void;
};

function hasGState(pdf: unknown): pdf is PdfWithGState & { GState: PdfGStateCtor; setGState: (state: unknown) => void } {
  if (typeof pdf !== "object" || pdf === null) return false;
  const p = pdf as PdfWithGState;
  return typeof p.GState === "function" && typeof p.setGState === "function";
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
  pdf.text("3D Product Design", pageW - margin, cursorY + 10, { align: "right" });

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
  pdf.text("Custom 3D Preview — Configured via 3D Branded Merch", margin, cursorY + 13);
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

type LogoPositionLike = { x?: number; y?: number; width?: number; height?: number; rotation?: number };
type TemplateImageLike = { url: string; title?: string | null; logo_position?: LogoPositionLike | null };
type TemplatePageLike = { productname: string; images: TemplateImageLike[] };

function safeBasenameFromUrl(url: string) {
  try {
    const u = new URL(url);
    const base = u.pathname.split("/").pop() || "image";
    return decodeURIComponent(base).replace(/\.[a-zA-Z0-9]+$/, "");
  } catch {
    const base = (url.split("?")[0] ?? "").split("#")[0].split("/").pop() || "image";
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  }
}

function safeCaption(img: { title?: string | null; url: string }) {
  if (img.title?.trim()) return img.title.trim();
  return safeBasenameFromUrl(img.url);
}

function normalizeUnit(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v > 1.5) return v / 100;
  return v;
}

function describeImage(img: { url: string; logo_position?: LogoPositionLike | null }) {
  const name = safeBasenameFromUrl(img.url);
  const p = img.logo_position ?? {};
  const x = typeof p.x === "number" ? Math.round(normalizeUnit(p.x) * 100) : null;
  const y = typeof p.y === "number" ? Math.round(normalizeUnit(p.y) * 100) : null;
  const w = typeof p.width === "number" ? Math.round(normalizeUnit(p.width) * 100) : null;
  const h = typeof p.height === "number" ? Math.round(normalizeUnit(p.height) * 100) : null;
  const r = typeof p.rotation === "number" ? Math.round(p.rotation) : 0;

  const parts: string[] = [];
  parts.push(name);
  if (x !== null && y !== null) parts.push(`logo at ${x}%, ${y}%`);
  if (w !== null && h !== null) parts.push(`size ${w}%×${h}%`);
  if (r) parts.push(`rot ${r}°`);
  return parts.join(" • ");
}

export async function downloadTemplatePdf(opts: {
  templateName: string;
  pages: TemplatePageLike[];
  logoDataUrl: string;
}): Promise<void> {
  const { templateName, pages, logoDataUrl } = opts;

  const { compositeToDataUrl } = await import("@/lib/imageComposite.client");
  const { jsPDF } = await import("jspdf");

  // A4 in points (jsPDF "pt" units).
  const A4_W = 595.28;
  const A4_H = 841.89;
  const MARGIN = 34;
  const HEADER_H = 52;
  const GRID_GAP = 24;
  const RIGHT_COL_Y_OFFSET = 20;

  const pdf = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });

  for (let pi = 0; pi < pages.length; pi++) {
    const page = pages[pi]!;
    if (pi > 0) pdf.addPage();

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(14);
    pdf.setTextColor(20, 20, 20);
    pdf.text(page.productname, A4_W / 2, MARGIN + 20, { align: "center" });

    pdf.setDrawColor(220, 220, 220);
    pdf.setLineWidth(0.75);
    pdf.line(MARGIN, MARGIN + 34, A4_W - MARGIN, MARGIN + 34);

    const gridX = MARGIN;
    const gridY = MARGIN + HEADER_H;
    const gridW = A4_W - 2 * MARGIN;
    const gridH = A4_H - gridY - MARGIN;

    type Tile = { x: number; y: number; w: number; h: number };
    const tilesStyleB = (count: number): Tile[] => {
      if (count <= 1) return [{ x: gridX, y: gridY, w: gridW, h: gridH }];
      if (count === 2) {
        const w = (gridW - GRID_GAP) / 2;
        return [
          { x: gridX, y: gridY, w, h: gridH },
          { x: gridX + w + GRID_GAP, y: gridY + RIGHT_COL_Y_OFFSET, w, h: gridH },
        ];
      }

      const w = (gridW - GRID_GAP) / 2;
      const h = (gridH - GRID_GAP) / 2;
      return [
        { x: gridX, y: gridY, w, h },
        { x: gridX + w + GRID_GAP, y: gridY + RIGHT_COL_Y_OFFSET, w, h },
        { x: gridX, y: gridY + h + GRID_GAP, w, h },
        { x: gridX + w + GRID_GAP, y: gridY + h + GRID_GAP + RIGHT_COL_Y_OFFSET, w, h },
      ].slice(0, count);
    };

    const imagesToRender = (page.images ?? []).slice(0, 4);
    const tiles = tilesStyleB(imagesToRender.length).slice(0, imagesToRender.length);

    for (let ii = 0; ii < imagesToRender.length; ii++) {
      const img = imagesToRender[ii]!;
      const tile = tiles[ii]!;
      const { x, y, w, h } = tile;

      try {
        const dataUrl = await compositeToDataUrl(img.url, logoDataUrl, img.logo_position ?? null, 1600);

        const props = pdf.getImageProperties(dataUrl);
        const iw = props.width || 1;
        const ih = props.height || 1;
        const scale = Math.min(w / iw, h / ih);
        const drawW = iw * scale;
        const drawH = ih * scale;
        const dx = x + (w - drawW) / 2;
        const dy = y + (h - drawH) / 2;

        pdf.addImage(dataUrl, "PNG", dx, dy, drawW, drawH);

        const caption = safeCaption(img) || describeImage(img);
        const capH = 22;
        const capY = dy + drawH - capH;

        if (hasGState(pdf)) {
          const GState = pdf.GState;
          pdf.setGState(new GState({ opacity: 0.2 }));
          pdf.setFillColor(0, 0, 0);
          pdf.rect(dx, capY, drawW, capH, "F");
          pdf.setGState(new GState({ opacity: 1 }));
        } else {
          pdf.setFillColor(45, 45, 45);
          pdf.rect(dx, capY, drawW, capH, "F");
        }

        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(9);
        pdf.setTextColor(255, 255, 255);
        pdf.text(caption, dx + drawW / 2, capY + capH / 2 + 0.5, {
          align: "center",
          baseline: "middle",
          maxWidth: drawW - 16,
        });
      } catch {
        pdf.setFillColor(235, 235, 235);
        pdf.rect(x, y, w, h, "F");
        pdf.setFontSize(9);
        pdf.setTextColor(160, 160, 160);
        pdf.text("Image unavailable", x + w / 2, y + h / 2, { align: "center", baseline: "middle" });
      }
    }
  }

  const safeName = templateName.replace(/\s+/g, "-");
  pdf.save(`${safeName}-branded.pdf`);
}
