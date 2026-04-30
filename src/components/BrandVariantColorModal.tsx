"use client";

import { type MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";

type TabKey = "existing" | "custom" | "advanced";

function clampByte(n: number) {
  return Math.max(0, Math.min(255, Math.round(n)));
}

function toHexByte(n: number) {
  return clampByte(n).toString(16).padStart(2, "0");
}

function rgbToHex(r: number, g: number, b: number) {
  return `#${toHexByte(r)}${toHexByte(g)}${toHexByte(b)}`.toUpperCase();
}

function parseHexColor(input: string): { r: number; g: number; b: number } | null {
  const raw = input.trim().replace(/^#/, "");
  const hex = raw.length === 3 ? raw.split("").map((c) => `${c}${c}`).join("") : raw;
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) return null;
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return { r, g, b };
}

function distSq(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

async function loadImage(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  img.loading = "eager";
  img.src = url;
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error("Failed to load image"));
  });
  return img;
}

function canvasSafeUrl(url: string) {
  const s = url.trim();
  if (!s) return s;
  if (s.startsWith("data:") || s.startsWith("blob:")) return s;
  // Same-origin relative URLs are already canvas-safe.
  if (s.startsWith("/")) return s;
  // Proxy all absolute http(s) to avoid intermittent CORS/cached-header issues.
  if (s.startsWith("http://") || s.startsWith("https://")) {
    return `/api/image-proxy?url=${encodeURIComponent(s)}`;
  }
  return s;
}

function extractPaletteFromImageData(data: ImageData, opts?: { maxColors?: number }) {
  const maxColors = opts?.maxColors ?? 12;
  const { width, height } = data;
  const pixels = data.data;

  const step = Math.max(1, Math.floor(Math.max(width, height) / 120));
  const buckets = new Map<string, { count: number; r: number; g: number; b: number }>();

  for (let y = 0; y < height; y += step) {
    for (let x = 0; x < width; x += step) {
      const i = (y * width + x) * 4;
      const a = pixels[i + 3] ?? 0;
      if (a < 18) continue;
      const r0 = pixels[i] ?? 0;
      const g0 = pixels[i + 1] ?? 0;
      const b0 = pixels[i + 2] ?? 0;

      const r = Math.round(r0 / 16) * 16;
      const g = Math.round(g0 / 16) * 16;
      const b = Math.round(b0 / 16) * 16;
      const key = `${r},${g},${b}`;
      const prev = buckets.get(key);
      if (prev) prev.count += 1;
      else buckets.set(key, { count: 1, r, g, b });
    }
  }

  const sorted = Array.from(buckets.values()).sort((a, b) => b.count - a.count);
  const colors: { r: number; g: number; b: number }[] = [];

  const minDistSq = 24 * 24;
  for (const c of sorted) {
    if (colors.length >= maxColors) break;
    const tooClose = colors.some((p) => distSq(p, c) < minDistSq);
    if (!tooClose) colors.push({ r: c.r, g: c.g, b: c.b });
  }

  return colors.map((c) => rgbToHex(c.r, c.g, c.b));
}

function replaceColorsInImageData(params: {
  image: ImageData;
  replacements: Array<{ from: { r: number; g: number; b: number }; to: { r: number; g: number; b: number } }>;
  threshold?: number;
}) {
  const threshold = Math.max(0, params.threshold ?? 28);
  const thrSq = threshold * threshold;
  const next = new ImageData(new Uint8ClampedArray(params.image.data), params.image.width, params.image.height);
  const d = next.data;

  for (let i = 0; i < d.length; i += 4) {
    const a = d[i + 3] ?? 0;
    if (a < 18) continue;
    const r = d[i] ?? 0;
    const g = d[i + 1] ?? 0;
    const b = d[i + 2] ?? 0;

    for (const { from, to } of params.replacements) {
      const dr = r - from.r;
      const dg = g - from.g;
      const db = b - from.b;
      if (dr * dr + dg * dg + db * db <= thrSq) {
        d[i] = to.r;
        d[i + 1] = to.g;
        d[i + 2] = to.b;
        break;
      }
    }
  }

  return next;
}

type AdvRegion = {
  id: string;
  fromHex: string;
  toHex: string;
  mask: Uint8Array; // 1 where selected
  border: Uint8Array; // 1 where border pixel
  bbox: { minX: number; minY: number; maxX: number; maxY: number };
};

const ADV_CANVAS_PAD_PX = 16; // match Tailwind `p-4` used by the <img> preview
const ADV_FLOOD_TOLERANCE = 26; // allow selecting anti-aliased edges (letters/logos)

function colorDistSqRgb(a: { r: number; g: number; b: number }, b: { r: number; g: number; b: number }) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

function floodFillMask(params: {
  data: Uint8ClampedArray;
  width: number;
  height: number;
  startX: number;
  startY: number;
  toleranceSq: number;
}) {
  const { data, width, height, startX, startY, toleranceSq } = params;
  const startIdx = (startY * width + startX) * 4;
  const seedA = data[startIdx + 3] ?? 0;
  if (seedA < 18) return null;
  const seed = {
    r: data[startIdx] ?? 0,
    g: data[startIdx + 1] ?? 0,
    b: data[startIdx + 2] ?? 0,
  };

  const visited = new Uint8Array(width * height);
  const mask = new Uint8Array(width * height);
  const stack: number[] = [startY * width + startX];

  let minX = startX;
  let maxX = startX;
  let minY = startY;
  let maxY = startY;

  while (stack.length) {
    const p = stack.pop()!;
    if (visited[p]) continue;
    visited[p] = 1;

    const x = p % width;
    const y = (p - x) / width;
    const i = p * 4;
    const a = data[i + 3] ?? 0;
    if (a < 18) continue;

    const c = { r: data[i] ?? 0, g: data[i + 1] ?? 0, b: data[i + 2] ?? 0 };
    if (colorDistSqRgb(seed, c) > toleranceSq) continue;

    mask[p] = 1;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;

    if (x > 0) stack.push(p - 1);
    if (x + 1 < width) stack.push(p + 1);
    if (y > 0) stack.push(p - width);
    if (y + 1 < height) stack.push(p + width);
  }

  const bbox = { minX, minY, maxX, maxY };
  return { seed, mask, bbox };
}

function computeBorder(mask: Uint8Array, width: number, height: number, bbox: { minX: number; minY: number; maxX: number; maxY: number }) {
  const border = new Uint8Array(width * height);
  for (let y = bbox.minY; y <= bbox.maxY; y++) {
    for (let x = bbox.minX; x <= bbox.maxX; x++) {
      const p = y * width + x;
      if (!mask[p]) continue;
      const left = x > 0 ? mask[p - 1] : 0;
      const right = x + 1 < width ? mask[p + 1] : 0;
      const up = y > 0 ? mask[p - width] : 0;
      const down = y + 1 < height ? mask[p + width] : 0;
      if (!left || !right || !up || !down) border[p] = 1;
    }
  }
  return border;
}

export function BrandVariantColorModal(props: {
  open: boolean;
  title: string;
  imageUrl: string;
  originalImageUrl?: string;
  bgColor?: string;
  onClose: () => void;
  onApply?: (url: string) => void;
}) {
  const { open, title, imageUrl, originalImageUrl, bgColor, onClose, onApply } = props;

  const [tab, setTab] = useState<TabKey>("existing");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);

  const [palette, setPalette] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const threshold = 28;

  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const replaceSeqRef = useRef(0);
  const advBaseImgRef = useRef<HTMLImageElement | null>(null);
  const advImageDataRef = useRef<{ data: Uint8ClampedArray; width: number; height: number } | null>(null);
  const advCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const advCanvasWrapRef = useRef<HTMLDivElement | null>(null);

  const [advAppliedRegions, setAdvAppliedRegions] = useState<AdvRegion[]>([]);
  const [advRegion, setAdvRegion] = useState<AdvRegion | null>(null);
  const [advImageReadySeq, setAdvImageReadySeq] = useState(0);

  const existingUrl = originalImageUrl ?? imageUrl;

  const displayUrl = tab === "existing"
    ? existingUrl
    : tab === "custom"
      ? (previewDataUrl ?? imageUrl)
      : imageUrl;

  const activeReplacements = useMemo(() => {
    const result: Array<{ from: { r: number; g: number; b: number }; to: { r: number; g: number; b: number } }> = [];
    for (const [from, to] of Object.entries(replacements)) {
      const fromColor = parseHexColor(from);
      const toColor = parseHexColor(to);
      if (fromColor && toColor) {
        result.push({ from: fromColor, to: toColor });
      }
    }
    return result;
  }, [replacements]);

  const hasActiveReplacements = activeReplacements.length > 0;

  const advHasAnyRecolor = useMemo(() => {
    const applied = advAppliedRegions.some((r) => Boolean(parseHexColor(r.toHex)));
    const current = Boolean(advRegion && parseHexColor(advRegion.toHex));
    return applied || current;
  }, [advAppliedRegions, advRegion]);

  useEffect(() => {
    if (!open) return;
    setTab("existing");
    setError(null);
    setPalette([]);
    setReplacements({});
    setPreviewDataUrl(null);
    setHovering(false);
    setAdvAppliedRegions([]);
    setAdvRegion(null);
    advImageDataRef.current = null;
    advBaseImgRef.current = null;
  }, [open, imageUrl]);

  useEffect(() => {
    if (!open || tab !== "custom") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const img = await loadImage(canvasSafeUrl(imageUrl));
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
        canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const colors = extractPaletteFromImageData(data, { maxColors: 12 });
        if (!cancelled) {
          setPalette(colors);
          setReplacements(Object.fromEntries(colors.map((c) => [c, ""])));
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to extract colors");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, tab, imageUrl]);

  useEffect(() => {
    if (!open || tab !== "advanced") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const img = await loadImage(canvasSafeUrl(imageUrl));
        if (cancelled) return;
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
        canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas not supported");
        ctx.drawImage(img, 0, 0);
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
        advImageDataRef.current = { data: new Uint8ClampedArray(data.data), width: data.width, height: data.height };
        if (!cancelled) {
          advBaseImgRef.current = img;
          setAdvAppliedRegions([]);
          setAdvRegion(null);
          setAdvImageReadySeq((s) => s + 1);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load image");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [open, tab, imageUrl]);

  function advClientToPixel(e: MouseEvent) {
    const wrap = advCanvasWrapRef.current;
    const canvas = advCanvasRef.current;
    const imgData = advImageDataRef.current;
    if (!wrap || !canvas || !imgData) return null;
    const rect = canvas.getBoundingClientRect();
    const clientW = rect.width;
    const clientH = rect.height;
    const naturalW = imgData.width;
    const naturalH = imgData.height;
    if (clientW <= 0 || clientH <= 0 || naturalW <= 0 || naturalH <= 0) return null;

    const pad = ADV_CANVAS_PAD_PX;
    const availW = Math.max(1, clientW - pad * 2);
    const availH = Math.max(1, clientH - pad * 2);
    const scale = Math.min(availW / naturalW, availH / naturalH);
    const drawW = naturalW * scale;
    const drawH = naturalH * scale;
    const offsetX = pad + (availW - drawW) / 2;
    const offsetY = pad + (availH - drawH) / 2;
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    if (x < offsetX || y < offsetY || x > offsetX + drawW || y > offsetY + drawH) return null;
    const px = Math.floor((x - offsetX) / scale);
    const py = Math.floor((y - offsetY) / scale);
    if (px < 0 || py < 0 || px >= naturalW || py >= naturalH) return null;
    return { px, py, scale, offsetX, offsetY, drawW, drawH, clientW, clientH };
  }

  function advPickRegion(e: MouseEvent<HTMLCanvasElement>) {
    if (tab !== "advanced") return;
    const imgData = advImageDataRef.current;
    if (!imgData) return;
    const mapped = advClientToPixel(e);
    if (!mapped) return;

    const { px, py } = mapped;
    const p = py * imgData.width + px;

    // If the click hits an already-applied region, bring it back as the active selection for editing.
    const appliedHit = advAppliedRegions.find((r) => r.mask[p]);
    if (appliedHit) {
      setAdvAppliedRegions((prev) => prev.filter((r) => r !== appliedHit));
      setAdvRegion({ ...appliedHit, id: "selected" });
      return;
    }

    // Commit current selection (if it has a valid recolor) before replacing it.
    const currentTo = advRegion ? parseHexColor(advRegion.toHex) : null;
    if (advRegion && currentTo) {
      const committed: AdvRegion = { ...advRegion, id: `applied-${Date.now().toString(36)}` };
      setAdvAppliedRegions((prev) => [committed, ...prev]);
    }

    const ff = floodFillMask({
      data: imgData.data,
      width: imgData.width,
      height: imgData.height,
      startX: px,
      startY: py,
      toleranceSq: ADV_FLOOD_TOLERANCE * ADV_FLOOD_TOLERANCE,
    });
    if (!ff) return;

    const fromHex = rgbToHex(ff.seed.r, ff.seed.g, ff.seed.b);
    const border = computeBorder(ff.mask, imgData.width, imgData.height, ff.bbox);
    const next: AdvRegion = { id: "selected", fromHex, toHex: "", mask: ff.mask, border, bbox: ff.bbox };
    setAdvRegion(next);
  }

  function advUpdateHover(e: MouseEvent<HTMLCanvasElement>) {
    if (tab !== "advanced") return;
    // Intentionally no hover state — selected region outline is always shown.
    void e;
  }

  async function generatePreview() {
    if (!hasActiveReplacements) return;
    const seq = ++replaceSeqRef.current;
    try {
      const img = await loadImage(canvasSafeUrl(imageUrl));
      if (seq !== replaceSeqRef.current) return;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, img.naturalWidth || img.width || 1);
      canvas.height = Math.max(1, img.naturalHeight || img.height || 1);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas not supported");
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const next = replaceColorsInImageData({ image: data, replacements: activeReplacements, threshold });
      ctx.putImageData(next, 0, 0);
      const url = canvas.toDataURL("image/png");
      if (seq !== replaceSeqRef.current) return;
      setPreviewDataUrl(url);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to apply replace");
    }
  }

  useEffect(() => {
    if (!open || tab !== "custom") return;
    if (!hasActiveReplacements) {
      setPreviewDataUrl(null);
      return;
    }
    const t = window.setTimeout(() => {
      setLoading(true);
      setError(null);
      void generatePreview().finally(() => setLoading(false));
    }, 250);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, replacements, imageUrl]);


  function resetReplacements() {
    setPreviewDataUrl(null);
    setReplacements(Object.fromEntries(palette.map((c) => [c, ""])));
  }

  function renderAdvancedCanvas() {
    const canvas = advCanvasRef.current;
    const wrap = advCanvasWrapRef.current;
    const base = advImageDataRef.current;
    if (!canvas || !wrap || !base) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));
    const cssW = Math.max(1, Math.floor(wrap.clientWidth));
    const cssH = Math.max(1, Math.floor(wrap.clientHeight));
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const naturalW = base.width;
    const naturalH = base.height;
    const pad = ADV_CANVAS_PAD_PX;
    const availW = Math.max(1, cssW - pad * 2);
    const availH = Math.max(1, cssH - pad * 2);
    const scale = Math.min(availW / naturalW, availH / naturalH);
    const drawW = naturalW * scale;
    const drawH = naturalH * scale;
    const drawX = pad + (availW - drawW) / 2;
    const drawY = pad + (availH - drawH) / 2;

    // Build recolored pixels (applied regions + current selection)
    const out = new Uint8ClampedArray(base.data);
    const paintRegion = (region: AdvRegion) => {
      const to = parseHexColor(region.toHex);
      if (!to) return;
      for (let y = region.bbox.minY; y <= region.bbox.maxY; y++) {
        const row = y * naturalW;
        for (let x = region.bbox.minX; x <= region.bbox.maxX; x++) {
          const p = row + x;
          if (!region.mask[p]) continue;
          const i = p * 4;
          out[i] = to.r;
          out[i + 1] = to.g;
          out[i + 2] = to.b;
        }
      }
    };
    for (const r of advAppliedRegions) paintRegion(r);
    if (advRegion) paintRegion(advRegion);

    const off = document.createElement("canvas");
    off.width = naturalW;
    off.height = naturalH;
    const offCtx = off.getContext("2d");
    if (!offCtx) return;
    const imgData = new ImageData(out, naturalW, naturalH);
    offCtx.putImageData(imgData, 0, 0);

    // Selected border overlay (draw in natural space)
    if (advRegion) {
      offCtx.save();
      offCtx.globalAlpha = 0.95;
      offCtx.fillStyle = "#0EA5E9";
      for (let y = advRegion.bbox.minY; y <= advRegion.bbox.maxY; y++) {
        const row = y * naturalW;
        for (let x = advRegion.bbox.minX; x <= advRegion.bbox.maxX; x++) {
          const p = row + x;
          if (!advRegion.border[p]) continue;
          offCtx.fillRect(x, y, 1, 1);
        }
      }
      offCtx.restore();
    }

    // Background
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = bgColor ?? "#ffffff";
    ctx.fillRect(0, 0, cssW, cssH);

    // Draw image (contain)
    ctx.imageSmoothingEnabled = false; // keep borders crisp
    ctx.drawImage(off, drawX, drawY, drawW, drawH);
  }

  useEffect(() => {
    if (!open || tab !== "advanced") return;
    const raf = window.requestAnimationFrame(() => renderAdvancedCanvas());
    return () => window.cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab, advAppliedRegions, advRegion, bgColor, advImageReadySeq]);

  useEffect(() => {
    if (!open || tab !== "advanced") return;
    const wrap = advCanvasWrapRef.current;
    if (!wrap) return;
    const ro = new ResizeObserver(() => {
      window.requestAnimationFrame(() => renderAdvancedCanvas());
    });
    ro.observe(wrap);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, tab]);

  function resetAdvancedReplacements() {
    setAdvAppliedRegions([]);
    setAdvRegion((prev) => (prev ? { ...prev, toHex: "" } : prev));
  }

  function buildAdvancedDataUrl() {
    const base = advImageDataRef.current;
    if (!base) return null;
    const naturalW = base.width;
    const naturalH = base.height;
    const out = new Uint8ClampedArray(base.data);
    const paintRegion = (region: AdvRegion) => {
      const to = parseHexColor(region.toHex);
      if (!to) return;
      for (let y = region.bbox.minY; y <= region.bbox.maxY; y++) {
        const row = y * naturalW;
        for (let x = region.bbox.minX; x <= region.bbox.maxX; x++) {
          const p = row + x;
          if (!region.mask[p]) continue;
          const i = p * 4;
          out[i] = to.r;
          out[i + 1] = to.g;
          out[i + 2] = to.b;
        }
      }
    };
    for (const r of advAppliedRegions) paintRegion(r);
    if (advRegion) paintRegion(advRegion);
    const canvas = document.createElement("canvas");
    canvas.width = naturalW;
    canvas.height = naturalH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.putImageData(new ImageData(out, naturalW, naturalH), 0, 0);
    return canvas.toDataURL("image/png");
  }

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal
      className="fixed inset-0 z-[200] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-[620px] overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">Change colors</div>
            <div className="truncate text-xs text-slate-600">{title}</div>
          </div>
          <button
            type="button"
            className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
            onClick={onClose}
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {error ? (
          <div className="border-b border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">{error}</div>
        ) : null}

        {/* Tabs */}
        <div className="px-4 pt-3">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className={`h-9 rounded-lg px-3 text-sm font-semibold ${tab === "existing"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              onClick={() => setTab("existing")}
            >
              Existing colors
            </button>
            <button
              type="button"
              className={`h-9 rounded-lg px-3 text-sm font-semibold ${tab === "custom"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              onClick={() => setTab("custom")}
            >
              Custom colors
            </button>
            <button
              type="button"
              className={`h-9 rounded-lg px-3 text-sm font-semibold ${tab === "advanced"
                ? "bg-slate-900 text-white"
                : "border border-slate-200 bg-white text-slate-800 hover:bg-slate-50"
                }`}
              onClick={() => setTab("advanced")}
            >
              Advanced editor
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="p-4">
          {/* Image preview — full width for both tabs */}
          <div className="overflow-hidden rounded-xl border border-slate-200">
            <div
              className="relative aspect-[16/9] w-full"
              style={{ backgroundColor: bgColor ?? "#ffffff" }}
              onMouseEnter={() => setHovering(true)}
              onMouseLeave={() => setHovering(false)}
            >
              {tab === "advanced" ? (
                <div ref={advCanvasWrapRef} className="absolute inset-0">
                  <canvas
                    ref={advCanvasRef}
                    className="h-full w-full cursor-crosshair"
                    onMouseMove={advUpdateHover}
                    onClick={advPickRegion}
                  />
                </div>
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={displayUrl} alt="" className="h-full w-full object-contain p-4" draggable={false} />
              )}

              {/* Existing tab: hover overlay with "Use this" button */}
              {tab === "existing" && hovering && onApply && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-opacity">
                  <button
                    type="button"
                    onClick={() => onApply(existingUrl)}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg hover:bg-slate-50 active:scale-95"
                  >
                    <Check className="h-4 w-4 text-zinc-600" />
                    Select
                  </button>
                </div>
              )}

              {/* Custom / Advanced: loading overlay */}
              {(tab === "custom" || tab === "advanced") && loading && (
                <div className="absolute inset-0 flex items-center justify-center bg-white/50">
                  <Loader2 className="h-6 w-6 animate-spin text-slate-500" />
                </div>
              )}
            </div>
          </div>

          {/* Custom tab: per-color replacement rows */}
          {tab === "custom" && (
            <div className="mt-4">
              {palette.length > 0 ? (
                <div className="max-h-[220px] space-y-2 overflow-y-auto pr-0.5">
                  {palette.map((hex) => {
                    const replacementVal = replacements[hex] ?? "";
                    const replacementColor = parseHexColor(replacementVal);
                    return (
                      <div key={hex} className="flex items-center gap-2">
                        {/* Original color swatch + hex */}
                        <span
                          className="h-7 w-7 flex-shrink-0 rounded-md border border-black/10"
                          style={{ backgroundColor: hex }}
                        />
                        <span className="w-[76px] flex-shrink-0 font-mono text-xs text-slate-600">{hex}</span>

                        <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />

                        {/* Input for replacement color */}
                        <input
                          value={replacementVal}
                          onChange={(e) =>
                            setReplacements((prev) => ({ ...prev, [hex]: e.target.value }))
                          }
                          placeholder={hex}
                          className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500"
                        />

                        {/* Preview swatch for the replacement */}
                        <span
                          className="h-7 w-7 flex-shrink-0 rounded-md border border-black/10 transition-colors"
                          style={{
                            backgroundColor: replacementColor
                              ? replacementVal
                              : "transparent",
                          }}
                        />
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="py-4 text-center text-sm text-slate-500">
                  {loading ? "Extracting colors…" : "No colors found."}
                </div>
              )}

              {/* Actions row */}
              {palette.length > 0 && (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={resetReplacements}
                    disabled={!previewDataUrl}
                    className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                  >
                    Reset
                  </button>
                  {onApply && previewDataUrl && (
                    <button
                      type="button"
                      onClick={() => onApply(previewDataUrl)}
                      className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700"
                    >
                      Apply to variant
                    </button>
                  )}
                </div>
              )}
            </div>
          )}

          {tab === "advanced" && (
            <div className="mt-4">

              {advRegion ? (
                <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-2.5 py-2">
                  <span
                    className="h-7 w-7 flex-shrink-0 rounded-md border border-black/10"
                    style={{ backgroundColor: advRegion.fromHex }}
                    title="Original"
                  />
                  <span className="w-[76px] flex-shrink-0 font-mono text-xs text-slate-600">{advRegion.fromHex}</span>
                  <ArrowRight className="h-3.5 w-3.5 flex-shrink-0 text-slate-400" />
                  <input
                    value={advRegion.toHex}
                    onChange={(e) => setAdvRegion((prev) => (prev ? { ...prev, toHex: e.target.value } : prev))}
                    placeholder="#RRGGBB"
                    className="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs text-slate-900 outline-none focus:border-blue-500"
                  />
                  <span
                    className="h-7 w-7 flex-shrink-0 rounded-md border border-black/10 transition-colors"
                    style={{
                      backgroundColor: parseHexColor(advRegion.toHex) ? advRegion.toHex : "transparent",
                    }}
                    title="Replacement"
                  />
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-500">
                  Click a letter/shape in the preview to create your selection.
                </div>
              )}

              <div className="mt-3 flex items-center justify-between gap-2">
                <button
                  type="button"
                  onClick={resetAdvancedReplacements}
                  disabled={!advHasAnyRecolor}
                  className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-800 hover:bg-slate-50 disabled:opacity-40"
                >
                  Reset
                </button>
                {onApply && (
                  <button
                    type="button"
                    disabled={!advHasAnyRecolor}
                    onClick={() => {
                      const url = buildAdvancedDataUrl();
                      if (url) onApply(url);
                    }}
                    className="h-9 rounded-lg bg-blue-600 px-4 text-sm font-semibold text-white hover:bg-blue-700 disabled:bg-slate-400"
                  >
                    Apply to variant
                  </button>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="h-2" />
      </div>
    </div>
  );
}
