"use client";

import { useEffect, useRef, useState } from "react";
import type { DecalConfig } from "@/types/configurator";
import { downloadConfiguratorPdf } from "@/lib/pdfExport";
import type { LibraryItem, LibraryProduct } from "@/hooks/useConfiguratorState";

// Keep this reasonably high; the logo is used as a decal texture, so low values
// quickly look blurry. Share URLs can grow with higher-res data URLs; we still
// warn users if the share link becomes too long.
const LOGO_MAX_PX = 1024;

async function compressLogoImage(dataUrl: string): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.naturalWidth, img.naturalHeight, 1);
      const scale = Math.min(1, LOGO_MAX_PX / longest);
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(img, 0, 0, w, h);

      // Keep PNG for any image that might carry transparency (PNG input or bg-removed)
      const isPng = dataUrl.startsWith("data:image/png");
      const compressed = isPng
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.92);
      resolve(compressed);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function removeBackgroundViaApi(file: File): Promise<string> {
  const form = new FormData();
  form.set("image", file, file.name || "logo.png");

  const res = await fetch("/api/remove-bg", {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`remove-bg failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }

  const json = (await res.json()) as { dataUrl?: unknown };
  const dataUrl = typeof json?.dataUrl === "string" ? json.dataUrl : null;
  if (!dataUrl || !dataUrl.startsWith("data:image/")) {
    throw new Error("remove-bg failed: invalid response payload");
  }
  return dataUrl;
}

/**
 * Remove white / near-white backgrounds from a logo image using canvas pixel
 * manipulation. Pure white pixels become fully transparent; pixels close to
 * white become proportionally semi-transparent for smooth anti-aliased edges.
 *
 * @param dataUrl  - Source image as a data URL (any raster format).
 * @param tolerance - 0–255. Higher = removes more near-white pixels (default 40).
 * @returns A PNG data URL with the background made transparent.
 */
async function removeWhiteBackground(dataUrl: string, tolerance = 40): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = img.naturalWidth;
      const h = img.naturalHeight;
      if (w < 1 || h < 1) { resolve(dataUrl); return; }

      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }

      ctx.drawImage(img, 0, 0);
      const imageData = ctx.getImageData(0, 0, w, h);
      const d = imageData.data;

      for (let i = 0; i < d.length; i += 4) {
        if (d[i + 3] === 0) continue; // already transparent — leave it

        const r = d[i];
        const g = d[i + 1];
        const b = d[i + 2];

        // "Distance from white" — 0 means pure white, 255 means pure black
        const dist = Math.max(255 - r, 255 - g, 255 - b);

        if (dist < tolerance) {
          // Linearly ramp alpha: fully transparent at dist=0, fully opaque at dist=tolerance
          d[i + 3] = Math.round((dist / tolerance) * d[i + 3]);
        }
      }

      ctx.putImageData(imageData, 0, 0);
      // Always PNG so transparency is preserved downstream
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

export type ControlsPanelProps = {
  productName: string;
  productKey: string | null;
  libraryQuery: string;
  libraryProducts: LibraryProduct[];
  isLoadingLibrary: boolean;
  libraryError: string | null;
  onSearchLibrary: (q: string) => void;
  selectedModelId: string | null;
  onSelectModel: (item: LibraryItem | null) => void;
  logoDataUrl: string | null;
  onLogoDataUrlChange: (dataUrl: string | null) => void;
  isLogoPlacementMode: boolean;
  onLogoPlacementModeChange: (v: boolean) => void;
  decal: DecalConfig;
  onDecalChange: (next: DecalConfig) => void;
  shareUrl: string;
  onCopyShare: () => void;
  captureElementId: string;
};

/**
 * Left column: URL field, logo upload / drop, decal tuning, share & PDF.
 */
export function ControlsPanel({
  productName,
  productKey: _productKey,
  libraryQuery,
  libraryProducts,
  isLoadingLibrary,
  libraryError,
  onSearchLibrary,
  selectedModelId,
  onSelectModel,
  logoDataUrl,
  onLogoDataUrlChange,
  isLogoPlacementMode,
  onLogoPlacementModeChange,
  decal,
  onDecalChange,
  shareUrl,
  onCopyShare,
  captureElementId,
}: ControlsPanelProps) {
  void _productKey;
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);
  const [isLogoProcessing, setIsLogoProcessing] = useState(false);
  const [logoProcessingLabel, setLogoProcessingLabel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [logoDropActive, setLogoDropActive] = useState(false);
  const [localQuery, setLocalQuery] = useState(libraryQuery);

  useEffect(() => {
    setLocalQuery(libraryQuery);
  }, [libraryQuery]);

  // Modern browsers handle URLs up to ~100 KB without issues.
  // Logos are compressed to 256 px on upload, so this is only triggered by
  // unusually large or complex PNGs.
  const shareTooLong = shareUrl.length > 100_000;

  async function handlePdf() {
    try {
      await downloadConfiguratorPdf(captureElementId, productName);
    } catch (e) {
      console.error(e);
      alert(
        "Could not create PDF. Wait for the 3D model to finish loading, then try again.",
      );
    }
  }

  function isLogoFile(f: File): boolean {
    return (
      f.type === "image/png" ||
      f.type === "image/jpeg" ||
      f.type === "image/jpg" ||
      f.type === "image/svg+xml" ||
      f.name.toLowerCase().endsWith(".svg")
    );
  }

  function processLogoFile(f: File) {
    if (!isLogoFile(f)) {
      alert("Please use PNG, JPG, or SVG.");
      return;
    }
    setIsLogoProcessing(true);
    setLogoProcessingLabel("Optimizing logo…");

    if (removeWhiteBg && !f.type.includes("svg")) {
      // Prefer the background-removal API for best edges/transparency.
      setLogoProcessingLabel("Removing background…");
      removeBackgroundViaApi(f)
        .then(compressLogoImage)
        .then((result) => onLogoDataUrlChange(result))
        .catch(() => {
          // Fallback to local near-white removal if the API fails.
          setLogoProcessingLabel("Optimizing logo…");
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result;
            if (typeof res !== "string") return;
            removeWhiteBackground(res)
              .then(compressLogoImage)
              .then((result) => onLogoDataUrlChange(result))
              .finally(() => {
                setLogoProcessingLabel(null);
                setIsLogoProcessing(false);
              });
          };
          reader.readAsDataURL(f);
        })
        .finally(() => {
          setLogoProcessingLabel(null);
          setIsLogoProcessing(false);
        });
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") return;
      compressLogoImage(res)
        .then((result) => onLogoDataUrlChange(result))
        .finally(() => {
          setLogoProcessingLabel(null);
          setIsLogoProcessing(false);
        });
    };
    reader.readAsDataURL(f);
  }

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) {
      onLogoDataUrlChange(null);
      return;
    }
    processLogoFile(f);
    e.target.value = "";
  }

  function handleLogoDragOver(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (isLogoProcessing) return;
    if (e.dataTransfer.types.includes("Files")) setLogoDropActive(true);
  }

  function handleLogoDragLeave(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLogoDropActive(false);
  }

  function handleLogoDrop(e: React.DragEvent) {
    e.preventDefault();
    e.stopPropagation();
    setLogoDropActive(false);
    if (isLogoProcessing) return;
    const f = e.dataTransfer.files?.[0];
    if (f) processLogoFile(f);
  }

  function clearLogo() {
    if (isLogoProcessing) return;
    onLogoDataUrlChange(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function setDecalPartial(patch: Partial<DecalConfig>) {
    onDecalChange({
      position: patch.position ?? decal.position,
      rotation: patch.rotation ?? decal.rotation,
      scale: patch.scale ?? decal.scale,
    });
  }

  const rotateDeg = Math.round((decal.rotation[2] * 180) / Math.PI);

  return (
    <aside className="flex h-auto min-h-0 flex-col gap-4 overflow-visible rounded-xl border border-white/10 bg-zinc-900/80 p-4 shadow-xl backdrop-blur-sm sm:gap-5 sm:p-5 md:h-full md:overflow-y-auto">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-white">
          {productName}
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Search and load a prebuilt 3D product, then add your logo (upload or drag-and-drop).
        </p>
      </header>

      {/* ── Product library ── */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Product library
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="search"
            value={localQuery}
            onChange={(e) => setLocalQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onSearchLibrary(localQuery);
            }}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none ring-blue-500/40 focus:ring-2"
            placeholder="Search by name…"
          />
          <button
            type="button"
            disabled={isLoadingLibrary}
            onClick={() => onSearchLibrary(localQuery)}
            className="w-full shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isLoadingLibrary ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Searching
              </span>
            ) : "Search"}
          </button>
        </div>
        {libraryError ? <p className="text-xs text-red-400">{libraryError}</p> : null}
      </div>

      {libraryProducts.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Results ({libraryProducts.length})
          </span>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {libraryProducts.map((product) => (
              <details
                key={product.product_name}
                className="rounded-md border border-white/10 bg-black/25 px-2 py-1.5"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-zinc-200">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-black/30">
                    {product.preview_image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={product.preview_image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>
                  <span className="min-w-0 flex-1 truncate">{product.product_name}</span>
                  <span className="shrink-0 text-[11px] text-zinc-400">
                    {product.variants.length} color{product.variants.length === 1 ? "" : "s"}
                  </span>
                </summary>

                <div className="mt-2 space-y-1.5 pl-10">
                  {product.variants.map((v) => {
                    const active = selectedModelId === v.id;
                    const item: LibraryItem = {
                      id: v.id,
                      name: `${product.product_name} — ${v.label}`,
                      product_key: product.product_key ?? product.product_name,
                      image_url: v.image_url,
                    };
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => onSelectModel(item)}
                        className={`flex w-full items-center gap-2 rounded-md border px-2 py-1.5 text-left text-xs transition ${active
                            ? "border-indigo-500/50 bg-indigo-950/40 text-indigo-100"
                            : "border-white/10 bg-black/25 text-zinc-200 hover:border-white/20 hover:bg-black/35"
                          }`}
                      >
                        <div className="h-7 w-7 shrink-0 overflow-hidden rounded bg-black/30">
                          {v.image_url ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.image_url} alt="" className="h-full w-full object-cover" />
                          ) : null}
                        </div>
                        <span className="min-w-0 flex-1 truncate">{v.label}</span>
                        {active ? (
                          <span className="shrink-0 text-[11px] text-indigo-200">Loaded</span>
                        ) : null}
                      </button>
                    );
                  })}
                </div>
              </details>
            ))}
          </div>
          <button
            type="button"
            onClick={() => onSelectModel(null)}
            className="mt-1 self-start text-[11px] text-zinc-400 hover:underline"
          >
            Clear selection
          </button>
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Logo (PNG / JPG / SVG)
          </span>
          {/* Background removal toggle */}
          <label className={`flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 select-none ${isLogoProcessing ? "opacity-60 pointer-events-none" : ""}`}>
            <div
              role="checkbox"
              aria-checked={removeWhiteBg}
              onClick={() => setRemoveWhiteBg((v) => !v)}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${removeWhiteBg ? "bg-blue-600" : "bg-zinc-600"
                }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${removeWhiteBg ? "translate-x-3.5" : "translate-x-0.5"
                  }`}
              />
            </div>
            Remove white bg
          </label>
        </div>

        <div
          onDragOver={handleLogoDragOver}
          onDragLeave={handleLogoDragLeave}
          onDrop={handleLogoDrop}
          className={`relative rounded-lg border-2 border-dashed p-3 transition-colors ${logoDropActive
              ? "border-blue-400 bg-blue-500/10"
              : "border-white/15 bg-black/20"
            }`}
        >
          {isLogoProcessing ? (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/55 backdrop-blur-sm">
              <svg className="h-5 w-5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
              </svg>
              <p className="text-xs font-medium text-zinc-200">
                {logoProcessingLabel ?? "Processing logo…"}
              </p>
            </div>
          ) : null}
          <p className="mb-2 text-center text-xs text-zinc-500">
            Drop a logo here or choose a file
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/svg+xml,.svg"
            onChange={handleLogoFile}
            disabled={isLogoProcessing}
            className="w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-blue-500"
          />
        </div>

        {logoDataUrl ? (
          <>
            {/* Logo preview — checkerboard behind it shows transparency */}
            <div
              className="relative mx-auto h-20 w-20 overflow-hidden rounded-lg border border-white/10"
              style={{
                backgroundImage:
                  "repeating-conic-gradient(#3f3f46 0% 25%, #27272a 0% 50%)",
                backgroundSize: "12px 12px",
              }}
            >
              {isLogoProcessing ? (
                <div className="absolute inset-0 z-10 flex items-center justify-center bg-black/55 backdrop-blur-sm">
                  <svg className="h-5 w-5 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                </div>
              ) : null}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={logoDataUrl}
                alt="Logo preview"
                className="h-full w-full object-contain"
              />
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={isLogoProcessing}
                onClick={() => onLogoPlacementModeChange(!isLogoPlacementMode)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-60 ${isLogoPlacementMode
                    ? "border-amber-400/60 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
                    : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
                  }`}
              >
                {isLogoProcessing
                  ? "Processing…"
                  : isLogoPlacementMode
                    ? "✋ Drag logo to place — click to exit"
                    : "🖱 Drag logo on model"}
              </button>
              <button
                type="button"
                onClick={clearLogo}
                disabled={isLogoProcessing}
                className="text-xs text-red-400 hover:underline disabled:cursor-not-allowed disabled:opacity-60"
              >
                Remove
              </button>
            </div>

            {isLogoPlacementMode ? (
              <div className="flex items-center justify-center gap-2 rounded-md border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-xs text-amber-200">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-300 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-amber-300" />
                </span>
                Placement mode active — drag on the model
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-zinc-500">
            {removeWhiteBg
              ? "White backgrounds will be removed automatically."
              : "Background will be kept as-is."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-white/5 bg-black/20 p-3">
        <p className="text-xs text-zinc-500">
          Hold and drag on the product to move the logo. Use the sliders to
          adjust rotation and size.
        </p>

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-12 shrink-0">Rotate</span>
          <input
            type="range"
            min={-180}
            max={180}
            step={1}
            value={rotateDeg}
            onChange={(e) => {
              const deg = Number(e.target.value);
              const rad = (deg * Math.PI) / 180;
              const next: [number, number, number] = [...decal.rotation];
              next[2] = rad;
              setDecalPartial({ rotation: next });
            }}
            className="flex-1 accent-blue-500"
          />
          <span className="w-10 text-right font-mono text-zinc-500">
            {rotateDeg}°
          </span>
        </label>

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-12 shrink-0">Size</span>
          <input
            type="range"
            min={0.04}
            max={0.55}
            step={0.005}
            value={decal.scale}
            onChange={(e) =>
              setDecalPartial({ scale: Number(e.target.value) })
            }
            className="flex-1 accent-blue-500"
          />
          <span className="w-10 text-right font-mono text-zinc-500">
            {Math.round(decal.scale * 100)}%
          </span>
        </label>

      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-white/10 pt-4">
        <button
          type="button"
          onClick={() => {
            void onCopyShare();
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
          }}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500"
        >
          {copied ? "Copied!" : "Copy share link"}
        </button>
        <button
          type="button"
          onClick={() => void handlePdf()}
          className="rounded-lg border border-white/15 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-100 transition hover:bg-white/10"
        >
          Download PDF
        </button>
      </div>

      {/* ── Lightbox overlay ── */}
      {lightboxSrc && (
        <div
          role="dialog"
          aria-modal
          className="fixed inset-0 z-[110] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
          onClick={() => setLightboxSrc(null)}
        >
          <div
            className="relative max-h-[90vh] max-w-[90vw] overflow-hidden rounded-xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={lightboxSrc}
              alt="Product image enlarged"
              className="block max-h-[85vh] max-w-[85vw] object-contain"
            />
            <button
              type="button"
              onClick={() => setLightboxSrc(null)}
              className="absolute right-2 top-2 rounded-full bg-black/60 p-1.5 text-white hover:bg-black/80"
              aria-label="Close"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2.5">
                <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </aside>
  );
}