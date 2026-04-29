"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, Loader2, X } from "lucide-react";

type TabKey = "existing" | "custom";

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

export function BrandVariantColorModal(props: {
  open: boolean;
  title: string;
  imageUrl: string;
  bgColor?: string;
  onClose: () => void;
  onApply?: (url: string) => void;
}) {
  const { open, title, imageUrl, bgColor, onClose, onApply } = props;

  const [tab, setTab] = useState<TabKey>("existing");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hovering, setHovering] = useState(false);

  const [palette, setPalette] = useState<string[]>([]);
  const [replacements, setReplacements] = useState<Record<string, string>>({});
  const threshold = 28;

  const [previewDataUrl, setPreviewDataUrl] = useState<string | null>(null);
  const replaceSeqRef = useRef(0);

  // Existing tab always shows original; custom tab shows preview if available.
  const displayUrl = tab === "existing" ? imageUrl : (previewDataUrl ?? imageUrl);

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

  useEffect(() => {
    if (!open) return;
    setTab("existing");
    setError(null);
    setPalette([]);
    setReplacements({});
    setPreviewDataUrl(null);
    setHovering(false);
  }, [open, imageUrl]);

  useEffect(() => {
    if (!open || tab !== "custom") return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const img = await loadImage(imageUrl);
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

  async function generatePreview() {
    if (!hasActiveReplacements) return;
    const seq = ++replaceSeqRef.current;
    try {
      const img = await loadImage(imageUrl);
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={displayUrl} alt="" className="h-full w-full object-contain p-4" />

              {/* Existing tab: hover overlay with "Use this" button */}
              {tab === "existing" && hovering && onApply && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/25 transition-opacity">
                  <button
                    type="button"
                    onClick={() => onApply(imageUrl)}
                    className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-5 py-2.5 text-sm font-semibold text-slate-900 shadow-lg hover:bg-slate-50 active:scale-95"
                  >
                    <Check className="h-4 w-4 text-zinc-600" />
                    Select
                  </button>
                </div>
              )}

              {/* Custom tab: loading overlay */}
              {tab === "custom" && loading && (
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
        </div>

        <div className="h-2" />
      </div>
    </div>
  );
}
