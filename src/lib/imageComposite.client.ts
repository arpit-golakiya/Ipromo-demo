export type LogoPositionLike = {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  rotation?: number;
};

async function dataUrlToBlob(dataUrl: string): Promise<Blob> {
  const res = await fetch(dataUrl);
  return await res.blob();
}

async function fetchAsBlob(url: string): Promise<Blob> {
  const res = await fetch(url, { cache: "force-cache" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return await res.blob();
}

function clamp01(x: number) {
  if (!Number.isFinite(x)) return 0;
  return Math.min(1, Math.max(0, x));
}

function normalizeUnit(v: number): number {
  // Supports either [0..1] or [0..100] inputs.
  if (!Number.isFinite(v)) return 0;
  if (v > 1.5) return v / 100;
  return v;
}

function normalizeLogoPosition(posRaw: unknown): Required<LogoPositionLike> {
  const fallback: Required<LogoPositionLike> = { x: 0.66, y: 0.08, width: 0.26, height: 0.18, rotation: 0 };
  if (!posRaw || typeof posRaw !== "object") return fallback;
  const p = posRaw as LogoPositionLike;
  const x = typeof p.x === "number" ? p.x : fallback.x;
  const y = typeof p.y === "number" ? p.y : fallback.y;
  const width = typeof p.width === "number" ? p.width : fallback.width;
  const height = typeof p.height === "number" ? p.height : fallback.height;
  const rotation = typeof p.rotation === "number" ? p.rotation : 0;
  return { x, y, width, height, rotation };
}

/**
 * Composite `logoDataUrl` onto `imageUrl` at `logo_position`, returning a data URL.
 * Intended for client-side use (needs canvas APIs).
 */
export async function compositeToDataUrl(
  imageUrl: string,
  logoDataUrl: string,
  logo_position: unknown,
  maxSizePx = 1400,
): Promise<string> {
  const [imgBlob, logoBlob] = await Promise.all([fetchAsBlob(imageUrl), dataUrlToBlob(logoDataUrl)]);

  const imgBitmap = await createImageBitmap(imgBlob);
  const scale = Math.min(1, maxSizePx / Math.max(imgBitmap.width, imgBitmap.height));
  const outW = Math.max(1, Math.round(imgBitmap.width * scale));
  const outH = Math.max(1, Math.round(imgBitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  ctx.drawImage(imgBitmap, 0, 0, outW, outH);

  const logoBitmap = await createImageBitmap(logoBlob);
  const pos = normalizeLogoPosition(logo_position);
  const x = clamp01(normalizeUnit(pos.x));
  const y = clamp01(normalizeUnit(pos.y));
  const w = clamp01(normalizeUnit(pos.width));
  const h = clamp01(normalizeUnit(pos.height));
  const rotationDeg = Number.isFinite(pos.rotation) ? pos.rotation : 0;

  const drawW = Math.max(1, Math.round(w * outW));
  const drawH = Math.max(1, Math.round(h * outH));
  const drawX = Math.round(x * outW);
  const drawY = Math.round(y * outH);

  ctx.save();
  ctx.translate(drawX + drawW / 2, drawY + drawH / 2);
  ctx.rotate((rotationDeg * Math.PI) / 180);
  ctx.drawImage(logoBitmap, -drawW / 2, -drawH / 2, drawW, drawH);
  ctx.restore();

  return canvas.toDataURL("image/png");
}

