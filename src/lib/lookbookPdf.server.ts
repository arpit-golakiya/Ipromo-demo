/**
 * Server-side lookbook PDF generation.
 * Uses `sharp` for image compositing and `pdf-lib` for PDF building.
 * Zero browser dependencies — safe to run in a Next.js Route Handler.
 */

import sharp from "sharp";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { dbQuery } from "@/lib/db";
import { getBrandForUser } from "@/lib/brands";

// ─── Types ────────────────────────────────────────────────────────────────────

type LogoPositionLike = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
};

type LogoPositionsLike = Record<string, LogoPositionLike>;

type ImageRecord = {
  id: string;
  url: string;
  title?: string | null;
  logo_position: LogoPositionLike;
  /**
   * Optional multi-logo layout.
   * When present, we stamp the (chosen) logo onto every position.
   */
  logo_positions?: LogoPositionsLike | null;
};

type PageRecord = {
  id: string;
  productname: string;
  images: ImageRecord[];
};

// ─── Template parsing (mirrors TemplateDetails.tsx) ──────────────────────────

function asRec(x: unknown): Record<string, unknown> | null {
  if (!x || typeof x !== "object") return null;
  return x as Record<string, unknown>;
}

function normPos(pos: unknown): LogoPositionLike {
  const F: Required<LogoPositionLike> = { x: 0.66, y: 0.08, width: 0.26, height: 0.18, rotation: 0 };
  if (!pos || typeof pos !== "object") return F;
  const p = pos as Partial<LogoPositionLike>;
  return {
    x: typeof p.x === "number" ? p.x : F.x,
    y: typeof p.y === "number" ? p.y : F.y,
    width: typeof p.width === "number" ? p.width : F.width,
    height: typeof p.height === "number" ? p.height : F.height,
    rotation: typeof p.rotation === "number" ? p.rotation : F.rotation,
  };
}

function normPositions(posRaw: unknown): LogoPositionsLike | null {
  const rec = asRec(posRaw);
  if (!rec) return null;
  const out: LogoPositionsLike = {};
  for (const [k, v] of Object.entries(rec)) {
    // Be permissive; ignore keys whose values aren't objects with numeric-ish fields.
    out[k] = normPos(v);
  }
  return Object.keys(out).length ? out : null;
}

function parsePages(raw: unknown): PageRecord[] {
  const rec = asRec(raw);
  const embedded = rec ? rec["pages"] : null;
  const arr = Array.isArray(raw) ? raw : Array.isArray(embedded) ? embedded : null;
  if (!arr) return [];

  return arr
    .map((rawPage, pi) => {
      const p = asRec(rawPage) ?? {};
      const productname = String(
        p["productname"] ?? p["productName"] ?? p["title"] ?? `Page ${pi + 1}`,
      ).trim();

      const imagesRaw = (() => {
        for (const k of ["images", "product_images", "items"]) {
          const v = p[k];
          if (Array.isArray(v)) return v;
        }
        return [];
      })();

      const images = (imagesRaw as unknown[])
        .map((rawImg, ii) => {
          const i = asRec(rawImg) ?? {};
          const url = String(i["url"] ?? i["image_url"] ?? i["src"] ?? "").trim();
          if (!url) return null;
          const title =
            typeof i["title"] === "string"
              ? (i["title"] as string)
              : typeof i["caption"] === "string"
                ? (i["caption"] as string)
                : null;
          const logo_positions = normPositions(i["logo_positions"] ?? i["logoPositions"] ?? i["logo_pos_list"]);
          const logo_position = normPos(i["logo_position"] ?? i["logoPosition"] ?? i["logo_pos"]);
          return { id: String(i["id"] ?? `${pi}-${ii}`), url, title, logo_position, logo_positions };
        })
        .filter(Boolean) as ImageRecord[];

      return { id: String(p["id"] ?? `page-${pi}`), productname, images };
    })
    .filter((p) => p.images.length > 0);
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function normUnit(v: number | undefined, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return v > 1.5 ? v / 100 : v;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const raw = hex.trim().replace(/^#/, "");
  if (!/^[0-9a-fA-F]{6}$/.test(raw)) return null;
  return {
    r: parseInt(raw.slice(0, 2), 16),
    g: parseInt(raw.slice(2, 4), 16),
    b: parseInt(raw.slice(4, 6), 16),
  };
}

function colorDistSq(
  a: { r: number; g: number; b: number },
  b: { r: number; g: number; b: number },
): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function safeBasename(url: string): string {
  try {
    const u = new URL(url);
    const base = decodeURIComponent(u.pathname.split("/").pop() || "image");
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  } catch {
    const base = (url.split("?")[0] ?? "").split("#")[0].split("/").pop() || "image";
    return base.replace(/\.[a-zA-Z0-9]+$/, "");
  }
}

/**
 * Load an image as a Buffer.
 * - Relative paths (starting with "/") → read directly from public/ on disk.
 *   Brand logo variants are stored as "/brand-variants/..." which only works
 *   as a filesystem path on the server, not as an HTTP fetch target.
 * - Absolute URLs (http/https) → fetch over the network.
 */
async function fetchBuf(url: string): Promise<Buffer> {
  if (url.startsWith("/")) {
    const filePath = path.join(process.cwd(), "public", decodeURIComponent(url));
    return await readFile(filePath);
  }
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

// ─── Brand dominant color (mirrors imageColorsClient.ts logic via sharp) ─────

async function extractBrandBgHex(logoBuffer: Buffer): Promise<string> {
  const { data, info } = await sharp(logoBuffer)
    .ensureAlpha()
    .resize({ width: 280, height: 280, fit: "inside", withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * channels;
      const a = data[i + 3] ?? 0;
      if (a < 18) continue;
      const r0 = data[i] ?? 0, g0 = data[i + 1] ?? 0, b0 = data[i + 2] ?? 0;
      const lum = (0.2126 * r0 + 0.7152 * g0 + 0.0722 * b0) / 255;
      if (lum > 0.97 || lum < 0.05) continue;
      const r = Math.round(r0 / 16) * 16;
      const g = Math.round(g0 / 16) * 16;
      const b = Math.round(b0 / 16) * 16;
      const key = `${r},${g},${b}`;
      const prev = buckets.get(key);
      if (prev) prev.count++;
      else buckets.set(key, { count: 1, r, g, b });
    }
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  if (!sorted.length) return "#0EA5E9";

  let best: { score: number; r: number; g: number; b: number } | null = null;
  for (const c of sorted.slice(0, 40)) {
    const max = Math.max(c.r, c.g, c.b), min = Math.min(c.r, c.g, c.b);
    const sat = max === 0 ? 0 : (max - min) / max;
    const lum = (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
    const score = c.count * (0.4 + sat) * (1.2 - Math.abs(lum - 0.55));
    if (!best || score > best.score) best = { score, ...c };
  }
  if (!best) return "#0EA5E9";
  const h = (n: number) => Math.round(n).toString(16).padStart(2, "0");
  return `#${h(best.r)}${h(best.g)}${h(best.b)}`.toUpperCase();
}

// ─── Background color sampling ────────────────────────────────────────────────

async function sampleBgColor(
  imageBuffer: Buffer,
  pos: LogoPositionLike,
): Promise<{ r: number; g: number; b: number }> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  const rx = Math.max(0, Math.round(normUnit(pos.x, 0.66) * imgW));
  const ry = Math.max(0, Math.round(normUnit(pos.y, 0.08) * imgH));
  const rw = Math.max(1, Math.round(normUnit(pos.width, 0.26) * imgW));
  const rh = Math.max(1, Math.round(normUnit(pos.height, 0.18) * imgH));

  const safeX = Math.min(rx, imgW - 1);
  const safeY = Math.min(ry, imgH - 1);
  const safeW = Math.min(rw, imgW - safeX);
  const safeH = Math.min(rh, imgH - safeY);

  const { data, info } = await sharp(imageBuffer)
    .extract({ left: safeX, top: safeY, width: Math.max(1, safeW), height: Math.max(1, safeH) })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const { channels } = info;
  let totalR = 0, totalG = 0, totalB = 0, count = 0;
  for (let i = 0; i < data.length; i += channels) {
    const a = data[i + 3] ?? 0;
    if (a < 18) continue;
    totalR += data[i] ?? 0;
    totalG += data[i + 1] ?? 0;
    totalB += data[i + 2] ?? 0;
    count++;
  }
  return count === 0
    ? { r: 255, g: 255, b: 255 }
    : { r: Math.round(totalR / count), g: Math.round(totalG / count), b: Math.round(totalB / count) };
}

// ─── Variant picking (same reference table as new/page.tsx) ──────────────────
//
//  idx 0 → Multi Color Logo  on #F8FAFC  (light slate)
//  idx 1 → Light Color Logo  on #0F172A  (dark slate)
//  idx 2 → Brand-color BG    on brandBg  (dominant color of logoVariants[0])
//  idx 3 → Black Logo        on #FFFFFF  (white)

async function pickBestVariantIdx(
  imageBuffer: Buffer,
  pos: LogoPositionLike,
  brandBg: string,
): Promise<number> {
  const bg = await sampleBgColor(imageBuffer, pos);

  const refs = [
    { hex: "#F8FAFC", idx: 0 },
    { hex: "#0F172A", idx: 1 },
    { hex: brandBg,   idx: 2 },
    { hex: "#FFFFFF", idx: 3 },
  ];

  let bestIdx = 0, bestDist = Infinity;
  for (const { hex, idx } of refs) {
    const ref = hexToRgb(hex);
    if (!ref) continue;
    const d = colorDistSq(bg, ref);
    if (d < bestDist) { bestDist = d; bestIdx = idx; }
  }
  return bestIdx;
}

function positionsForImage(img: ImageRecord): LogoPositionLike[] {
  const rec = img.logo_positions;
  if (rec && typeof rec === "object") {
    const vals = Object.values(rec).filter(Boolean);
    if (vals.length) return vals;
  }
  return [img.logo_position];
}

async function pickBestVariantIdxForImage(
  imageBuffer: Buffer,
  img: ImageRecord,
  brandBg: string,
): Promise<number> {
  const positions = positionsForImage(img);
  if (positions.length <= 1) return await pickBestVariantIdx(imageBuffer, positions[0]!, brandBg);

  // If multiple stamps are needed, pick the "most common" best variant across positions.
  const votes = new Map<number, number>();
  for (const p of positions) {
    const idx = await pickBestVariantIdx(imageBuffer, p, brandBg);
    votes.set(idx, (votes.get(idx) ?? 0) + 1);
  }
  let bestIdx = 0;
  let bestVotes = -1;
  for (const [idx, v] of votes.entries()) {
    if (v > bestVotes) { bestVotes = v; bestIdx = idx; }
  }
  return bestIdx;
}

// ─── Image compositing (sharp) ────────────────────────────────────────────────

async function compositeJpeg(
  imageBuffer: Buffer,
  logoBuffer: Buffer,
  pos: LogoPositionLike,
  maxPx = 900,
): Promise<Buffer> {
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  const scale = Math.min(1, maxPx / Math.max(imgW, imgH));
  const outW = Math.max(1, Math.round(imgW * scale));
  const outH = Math.max(1, Math.round(imgH * scale));

  const scaledImg = await sharp(imageBuffer).resize(outW, outH).toBuffer();

  const lx = Math.max(0, Math.round(normUnit(pos.x, 0.66) * outW));
  const ly = Math.max(0, Math.round(normUnit(pos.y, 0.08) * outH));
  const lw = Math.max(1, Math.round(normUnit(pos.width, 0.26) * outW));
  const lh = Math.max(1, Math.round(normUnit(pos.height, 0.18) * outH));
  const rotation = typeof pos.rotation === "number" ? pos.rotation : 0;

  // Resize the logo to fill its bounding box (contain keeps aspect ratio)
  const logoResized = await sharp(logoBuffer)
    .resize(lw, lh, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  let compositeInput: Buffer;
  let left = Math.max(0, lx);
  let top = Math.max(0, ly);

  if (Math.abs(rotation) > 0.5) {
    // Create a transparent square large enough to hold the rotated logo
    const diagSize = Math.ceil(Math.sqrt(lw * lw + lh * lh)) + 4;

    const centeredCanvas = await sharp({
      create: { width: diagSize, height: diagSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: logoResized,
        left: Math.floor((diagSize - lw) / 2),
        top: Math.floor((diagSize - lh) / 2),
      }])
      .png()
      .toBuffer();

    compositeInput = await sharp(centeredCanvas)
      .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    const rotMeta = await sharp(compositeInput).metadata();
    const rotW = rotMeta.width ?? diagSize;
    const rotH = rotMeta.height ?? diagSize;
    left = Math.max(0, Math.round(lx + lw / 2 - rotW / 2));
    top  = Math.max(0, Math.round(ly + lh / 2 - rotH / 2));
  } else {
    compositeInput = logoResized;
  }

  return sharp(scaledImg)
    .composite([{ input: compositeInput, left, top }])
    .jpeg({ quality: 82 })
    .toBuffer();
}

async function compositeJpegMulti(
  imageBuffer: Buffer,
  logoBuffer: Buffer,
  positions: LogoPositionLike[],
  maxPx = 900,
): Promise<Buffer> {
  if (positions.length <= 1) {
    return compositeJpeg(imageBuffer, logoBuffer, positions[0] ?? {}, maxPx);
  }

  // Scale base image once, then apply all overlays in the same scaled coordinate space.
  const meta = await sharp(imageBuffer).metadata();
  const imgW = meta.width ?? 1;
  const imgH = meta.height ?? 1;

  const scale = Math.min(1, maxPx / Math.max(imgW, imgH));
  const outW = Math.max(1, Math.round(imgW * scale));
  const outH = Math.max(1, Math.round(imgH * scale));

  const scaledImg = await sharp(imageBuffer).resize(outW, outH).toBuffer();

  const overlays: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [];
  for (const pos of positions) {
    const lx = Math.max(0, Math.round(normUnit(pos.x, 0.66) * outW));
    const ly = Math.max(0, Math.round(normUnit(pos.y, 0.08) * outH));
    const lw = Math.max(1, Math.round(normUnit(pos.width, 0.26) * outW));
    const lh = Math.max(1, Math.round(normUnit(pos.height, 0.18) * outH));
    const rotation = typeof pos.rotation === "number" ? pos.rotation : 0;

    const logoResized = await sharp(logoBuffer)
      .resize(lw, lh, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png()
      .toBuffer();

    let compositeInput: Buffer;
    let left = Math.max(0, lx);
    let top = Math.max(0, ly);

    if (Math.abs(rotation) > 0.5) {
      const diagSize = Math.ceil(Math.sqrt(lw * lw + lh * lh)) + 4;
      const centeredCanvas = await sharp({
        create: { width: diagSize, height: diagSize, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
      })
        .composite([{
          input: logoResized,
          left: Math.floor((diagSize - lw) / 2),
          top: Math.floor((diagSize - lh) / 2),
        }])
        .png()
        .toBuffer();

      compositeInput = await sharp(centeredCanvas)
        .rotate(rotation, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      const rotMeta = await sharp(compositeInput).metadata();
      const rotW = rotMeta.width ?? diagSize;
      const rotH = rotMeta.height ?? diagSize;
      left = Math.max(0, Math.round(lx + lw / 2 - rotW / 2));
      top  = Math.max(0, Math.round(ly + lh / 2 - rotH / 2));
    } else {
      compositeInput = logoResized;
    }

    overlays.push({ input: compositeInput, left, top });
  }

  return sharp(scaledImg)
    .composite(overlays)
    .jpeg({ quality: 82 })
    .toBuffer();
}

// ─── PDF building (pdf-lib) ───────────────────────────────────────────────────

async function buildPdf(
  pages: PageRecord[],
  getCompositeJpeg: (img: ImageRecord) => Promise<Buffer>,
): Promise<Buffer> {
  const { PDFDocument, StandardFonts, rgb } = await import("pdf-lib");

  const doc = await PDFDocument.create();
  const font     = await doc.embedFont(StandardFonts.Helvetica);
  const boldFont = await doc.embedFont(StandardFonts.HelveticaBold);

  const A4_W = 595.28, A4_H = 841.89;
  const MARGIN = 34, HEADER_H = 52, GRID_GAP = 24, Y_OFF = 20;

  for (const pg of pages) {
    const page = doc.addPage([A4_W, A4_H]);

    // Title (centered)
    const titleSize = 14;
    const safeTitle = pg.productname.replace(/[^\x00-\x7F]/g, "?");
    const titleW = boldFont.widthOfTextAtSize(safeTitle, titleSize);
    page.drawText(safeTitle, {
      x: A4_W / 2 - titleW / 2,
      y: A4_H - MARGIN - 20,
      size: titleSize,
      font: boldFont,
      color: rgb(0.078, 0.078, 0.078),
    });

    // Divider
    page.drawLine({
      start: { x: MARGIN,          y: A4_H - MARGIN - 34 },
      end:   { x: A4_W - MARGIN,   y: A4_H - MARGIN - 34 },
      thickness: 0.75,
      color: rgb(0.863, 0.863, 0.863),
    });

    // Image grid
    const gridX = MARGIN;
    const gridY_top = MARGIN + HEADER_H;
    const gridW = A4_W - 2 * MARGIN;
    const gridH = A4_H - gridY_top - MARGIN;

    type Tile = { x: number; yTop: number; w: number; h: number };
    const imagesToRender = pg.images.slice(0, 4);
    const cnt = imagesToRender.length;

    let tiles: Tile[];
    if (cnt <= 1) {
      tiles = [{ x: gridX, yTop: gridY_top, w: gridW, h: gridH }];
    } else if (cnt === 2) {
      const w = (gridW - GRID_GAP) / 2;
      tiles = [
        { x: gridX,             yTop: gridY_top,          w, h: gridH },
        { x: gridX + w + GRID_GAP, yTop: gridY_top + Y_OFF, w, h: gridH },
      ];
    } else {
      const w = (gridW - GRID_GAP) / 2;
      const h = (gridH - GRID_GAP) / 2;
      tiles = ([
        { x: gridX,                yTop: gridY_top,                w, h },
        { x: gridX + w + GRID_GAP, yTop: gridY_top + Y_OFF,        w, h },
        { x: gridX,                yTop: gridY_top + h + GRID_GAP,  w, h },
        { x: gridX + w + GRID_GAP, yTop: gridY_top + h + GRID_GAP + Y_OFF, w, h },
      ] as Tile[]).slice(0, cnt);
    }

    for (let ii = 0; ii < imagesToRender.length; ii++) {
      const img   = imagesToRender[ii]!;
      const tile  = tiles[ii]!;

      try {
        const jpegBuf = await getCompositeJpeg(img);
        const embImg  = await doc.embedJpg(jpegBuf);
        const { width: iw, height: ih } = embImg.size();

        const scl   = Math.min(tile.w / iw, tile.h / ih);
        const drawW = iw * scl;
        const drawH = ih * scl;
        const dx    = tile.x + (tile.w - drawW) / 2;
        // yTop = distance from page top → convert to pdf-lib (bottom-left)
        const dy_top = tile.yTop + (tile.h - drawH) / 2;
        const dy_pdf = A4_H - dy_top - drawH;

        page.drawImage(embImg, { x: dx, y: dy_pdf, width: drawW, height: drawH });

        // Caption bar
        const capH = 22;
        page.drawRectangle({
          x: dx, y: dy_pdf,
          width: drawW, height: capH,
          color: rgb(0.176, 0.176, 0.176),
          opacity: 0.8,
        });

        const caption = (img.title?.trim() || safeBasename(img.url)).replace(/[^\x00-\x7F]/g, "?");
        const capSize = 9;
        const capTW = Math.min(font.widthOfTextAtSize(caption, capSize), drawW - 16);
        page.drawText(caption, {
          x:    dx + (drawW - capTW) / 2,
          y:    dy_pdf + capH / 2 - capSize / 2 + 1,
          size: capSize,
          font,
          color:    rgb(1, 1, 1),
          maxWidth: drawW - 16,
        });
      } catch {
        // fallback: grey placeholder
        page.drawRectangle({
          x: tile.x,
          y: A4_H - tile.yTop - tile.h,
          width: tile.w, height: tile.h,
          color: rgb(0.922, 0.922, 0.922),
        });
      }
    }
  }

  return Buffer.from(await doc.save());
}

// ─── Preview image: first PDF page rendered as PNG ───────────────────────────

function xmlEsc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function buildPreviewImage(
  firstPage: PageRecord,
  imgBufCache: Map<string, Buffer>,
  logoForImage: Map<string, Buffer | null>,
  fallbackLogoBuf: Buffer | null,
): Promise<Buffer | null> {
  // Mirror the exact PDF layout (same constants as buildPdf)
  const A4_W = 595, A4_H = 842;
  const MARGIN = 34, HEADER_H = 52, GRID_GAP = 24, Y_OFF = 20;

  const overlays: Parameters<ReturnType<typeof sharp>["composite"]>[0] = [];

  // Title + divider — single full-canvas SVG overlay
  const safeTitle = xmlEsc(firstPage.productname.replace(/[^\x00-\x7F]/g, "?"));
  const titleY = MARGIN + 20;
  const divY   = MARGIN + 34;

  const headerSvg = `<svg width="${A4_W}" height="${A4_H}" xmlns="http://www.w3.org/2000/svg">
    <text x="${A4_W / 2}" y="${titleY}"
      font-family="sans-serif" font-size="14" font-weight="bold"
      fill="#141414" text-anchor="middle">${safeTitle}</text>
    <line x1="${MARGIN}" y1="${divY}" x2="${A4_W - MARGIN}" y2="${divY}"
      stroke="#DCDCDC" stroke-width="0.75"/>
  </svg>`;
  overlays.push({ input: Buffer.from(headerSvg), top: 0, left: 0 });

  // Build tile geometry (identical to buildPdf)
  const gridX     = MARGIN;
  const gridY_top = MARGIN + HEADER_H;
  const gridW     = A4_W - 2 * MARGIN;
  const gridH     = A4_H - gridY_top - MARGIN;

  type Tile = { x: number; yTop: number; w: number; h: number };
  const imagesToRender = firstPage.images.slice(0, 4);
  const cnt = imagesToRender.length;

  let tiles: Tile[];
  if (cnt <= 1) {
    tiles = [{ x: gridX, yTop: gridY_top, w: gridW, h: gridH }];
  } else if (cnt === 2) {
    const w = (gridW - GRID_GAP) / 2;
    tiles = [
      { x: gridX,                yTop: gridY_top,         w, h: gridH },
      { x: gridX + w + GRID_GAP, yTop: gridY_top + Y_OFF, w, h: gridH },
    ];
  } else {
    const w = (gridW - GRID_GAP) / 2;
    const h = (gridH - GRID_GAP) / 2;
    tiles = ([
      { x: gridX,                yTop: gridY_top,                              w, h },
      { x: gridX + w + GRID_GAP, yTop: gridY_top + Y_OFF,                      w, h },
      { x: gridX,                yTop: gridY_top + h + GRID_GAP,               w, h },
      { x: gridX + w + GRID_GAP, yTop: gridY_top + h + GRID_GAP + Y_OFF,       w, h },
    ] as Tile[]).slice(0, cnt);
  }

  for (let ii = 0; ii < imagesToRender.length; ii++) {
    const img  = imagesToRender[ii]!;
    const tile = tiles[ii]!;
    const tileW = Math.floor(tile.w);
    const tileH = Math.floor(tile.h);

    try {
      const imgBuf  = imgBufCache.get(img.url);
      const logoBuf = logoForImage.get(img.url) ?? fallbackLogoBuf;

      if (!imgBuf || !logoBuf) throw new Error("missing buffers");

      // Composite at preview-appropriate resolution
      const jpegBuf = await compositeJpegMulti(imgBuf, logoBuf, positionsForImage(img), 500);

      // Scale to fit inside the tile, preserving aspect ratio
      const fitted = await sharp(jpegBuf)
        .resize(tileW, tileH, { fit: "inside" })
        .toBuffer();

      const { width: fw = tileW, height: fh = tileH } = await sharp(fitted).metadata();

      const imgLeft = Math.max(0, Math.floor(tile.x + (tileW - fw) / 2));
      const imgTop  = Math.max(0, Math.floor(tile.yTop + (tileH - fh) / 2));

      overlays.push({ input: fitted, left: imgLeft, top: imgTop });

      // Caption bar (same style as PDF)
      const capH   = 22;
      const capTop = Math.max(0, imgTop + fh - capH);
      const caption = xmlEsc(
        (img.title?.trim() || safeBasename(img.url)).replace(/[^\x00-\x7F]/g, "?"),
      );

      const capSvg = `<svg width="${A4_W}" height="${A4_H}" xmlns="http://www.w3.org/2000/svg">
        <rect x="${imgLeft}" y="${capTop}" width="${fw}" height="${capH}"
          fill="#2D2D2D" fill-opacity="0.8"/>
        <text x="${imgLeft + fw / 2}" y="${capTop + capH / 2 + 4}"
          font-family="sans-serif" font-size="9" fill="white"
          text-anchor="middle">${caption}</text>
      </svg>`;
      overlays.push({ input: Buffer.from(capSvg), top: 0, left: 0 });

    } catch {
      // Grey placeholder tile
      const placeholder = await sharp({
        create: { width: tileW, height: tileH, channels: 3,
                  background: { r: 235, g: 235, b: 235 } },
      }).png().toBuffer();
      overlays.push({
        input: placeholder,
        left: Math.floor(tile.x),
        top:  Math.floor(tile.yTop),
      });
    }
  }

  return sharp({
    create: { width: A4_W, height: A4_H, channels: 4,
              background: { r: 255, g: 255, b: 255, alpha: 1 } },
  })
    .composite(overlays)
    .png({ compressionLevel: 8 })
    .toBuffer();
}

// ─── Public entry point ───────────────────────────────────────────────────────

export async function generateLookbook(input: {
  ownerId: string;
  templateId: string;
  brandId: string;
}): Promise<{
  pdfBuffer: Buffer;
  previewBuffer: Buffer | null;
  title: string;
  brandName: string;
}> {
  // 1. Fetch template from DB
  const { rows: tRows } = await dbQuery<{
    id: string | number;
    name: string | null;
    pages: unknown;
  }>(
    `select id, name, pages from preload_templates where id::text = $1 limit 1`,
    [input.templateId],
  );
  const tRow = tRows[0];
  if (!tRow) throw new Error("Template not found");

  const title = String(tRow.name ?? "").trim() || "Lookbook";
  const pages = parsePages(tRow.pages);
  if (pages.length === 0) throw new Error("Template has no pages with images");

  // 2. Fetch brand from DB
  const brand = await getBrandForUser({ ownerId: input.ownerId, brandId: input.brandId });
  if (!brand) throw new Error("Brand not found");

  // 3. Extract brand dominant color from logoVariants[0]
  let brandBg = "#0EA5E9";
  if (brand.logoVariants[0]) {
    try {
      const logoBuf = await fetchBuf(brand.logoVariants[0]);
      brandBg = await extractBrandBgHex(logoBuf);
    } catch {
      // keep default
    }
  }

  // 4. Pre-fetch all unique images + pick best variant per image
  //    Cache buffers to avoid re-fetching the same URL
  const imgBufCache  = new Map<string, Buffer>();
  const varBufCache  = new Map<string, Buffer>();
  // imageUrl → chosen logo Buffer
  const logoForImage = new Map<string, Buffer | null>();

  const allImages: ImageRecord[] = [];
  for (const pg of pages) {
    for (const img of pg.images.slice(0, 4)) {
      if (!allImages.find((x) => x.url === img.url)) allImages.push(img);
    }
  }

  for (const img of allImages) {
    // Fetch product image
    let imgBuf = imgBufCache.get(img.url);
    if (!imgBuf) {
      try { imgBuf = await fetchBuf(img.url); imgBufCache.set(img.url, imgBuf); }
      catch { logoForImage.set(img.url, null); continue; }
    }

    // Pick variant index
    const varIdx = await pickBestVariantIdxForImage(imgBuf, img, brandBg);
    const varUrl = brand.logoVariants[varIdx] ?? brand.logoVariants[0];
    if (!varUrl) { logoForImage.set(img.url, null); continue; }

    // Fetch variant (cached)
    let varBuf = varBufCache.get(varUrl);
    if (!varBuf) {
      try { varBuf = await fetchBuf(varUrl); varBufCache.set(varUrl, varBuf); }
      catch { logoForImage.set(img.url, null); continue; }
    }

    logoForImage.set(img.url, varBuf);
  }

  const fallbackLogoBuf = brand.logoVariants[0]
    ? varBufCache.get(brand.logoVariants[0]) ?? null
    : null;

  // 5. Build PDF
  const pdfBuffer = await buildPdf(pages, async (img) => {
    const imgBuf  = imgBufCache.get(img.url);
    const logoBuf = logoForImage.get(img.url) ?? fallbackLogoBuf;
    if (!imgBuf || !logoBuf) throw new Error(`Missing buffers for ${img.url}`);
    return compositeJpegMulti(imgBuf, logoBuf, positionsForImage(img), 900);
  });

  // 6. Preview = first page of the PDF rendered as a PNG image
  let previewBuffer: Buffer | null = null;
  try {
    if (pages[0]) {
      previewBuffer = await buildPreviewImage(
        pages[0], imgBufCache, logoForImage, fallbackLogoBuf,
      );
    }
  } catch {
    // preview is optional
  }

  return { pdfBuffer, previewBuffer, title, brandName: brand.name };
}
