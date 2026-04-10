"use client";

import { useEffect, useRef, useState } from "react";
import type { DecalConfig } from "@/types/configurator";
import { downloadConfiguratorPdf } from "@/lib/pdfExport";
import type { ScrapedProduct } from "@/app/api/scrape/route";

const LOGO_MAX_PX = 256;

function normalizeImageName(rawUrl: string): string {
  try {
    const u = new URL(rawUrl);
    const decodedPath = decodeURIComponent(u.pathname);
    const file = decodedPath.split("/").pop() ?? decodedPath;
    return file.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  } catch {
    const cleaned = decodeURIComponent(rawUrl);
    const file = cleaned.split("/").pop() ?? cleaned;
    return file.toLowerCase().replace(/\.[a-z0-9]+$/i, "");
  }
}

function deriveColorLabelForImage(
  imageUrl: string,
  scrapedImages: string[],
  scrapedColors: ScrapedProduct["colors"],
): { label: string; hex?: string } {
  const directIdx = scrapedImages.indexOf(imageUrl);
  if (directIdx >= 0 && scrapedColors[directIdx]?.label) {
    return {
      label: scrapedColors[directIdx].label,
      hex: scrapedColors[directIdx].hex,
    };
  }

  const imageToken = normalizeImageName(imageUrl);
  for (const c of scrapedColors) {
    const labelToken = c.label.toLowerCase().replace(/[^a-z0-9]+/g, "");
    if (!labelToken) continue;
    if (imageToken.includes(labelToken)) {
      return { label: c.label, hex: c.hex };
    }
  }

  const oneBased = directIdx >= 0 ? directIdx + 1 : 1;
  return { label: `Image ${oneBased}` };
}

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

      ctx.drawImage(img, 0, 0, w, h);

      // Keep PNG for any image that might carry transparency (PNG input or bg-removed)
      const isPng = dataUrl.startsWith("data:image/png");
      const compressed = isPng
        ? canvas.toDataURL("image/png")
        : canvas.toDataURL("image/jpeg", 0.82);
      resolve(compressed);
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
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
  displayUrl: string;
  onDisplayUrlChange: (v: string) => void;
  onLoadProduct: (url: string) => void;
  isLoadingProduct: boolean;
  productLoadError: string | null;
  scrapedColors: ScrapedProduct["colors"];
  productLoadedFromScrape: boolean;
  scrapedImages: string[];
  logoDataUrl: string | null;
  onLogoDataUrlChange: (dataUrl: string | null) => void;
  isLogoPlacementMode: boolean;
  onLogoPlacementModeChange: (v: boolean) => void;
  decal: DecalConfig;
  onDecalChange: (next: DecalConfig) => void;
  // 3D model generation
  generatedModelUrl: string | null;
  generatedColorModels: Array<{
    key: string;
    imageUrl: string;
    colorLabel?: string;
    colorHex?: string;
    taskId: string | null;
    status: "QUEUED" | "PENDING" | "IN_PROGRESS" | "SUCCEEDED" | "FAILED" | "EXPIRED";
    progress: number;
    error: string | null;
    fromPreload?: boolean;
  }>;
  selectedModelKey: string | null;
  onSelectedModelKeyChange: (key: string | null) => void;
  isGeneratingModel: boolean;
  modelGenerationProgress: number;
  modelGenerationError: string | null;
  onGenerateModel: (
    imageUrl: string,
    options?: { removeLogosFor3D?: boolean },
  ) => void;
  onGenerateModelsBatch: (
    items: Array<{
      key: string;
      imageUrl: string;
      colorLabel?: string;
      colorHex?: string;
    }>,
    options?: { removeLogosFor3D?: boolean },
  ) => void;
  onResetModel: () => void;
  isStoringPreloaded: boolean;
  storePreloadedError: string | null;
  onStorePreloaded: () => void;
  shareUrl: string;
  onCopyShare: () => void;
  captureElementId: string;
};

/**
 * Left column: URL field, logo upload / drop, decal tuning, share & PDF.
 */
export function ControlsPanel({
  productName,
  displayUrl,
  onDisplayUrlChange,
  onLoadProduct,
  isLoadingProduct,
  productLoadError,
  scrapedColors,
  productLoadedFromScrape,
  scrapedImages,
  logoDataUrl,
  onLogoDataUrlChange,
  isLogoPlacementMode,
  onLogoPlacementModeChange,
  decal,
  onDecalChange,
  generatedModelUrl,
  generatedColorModels,
  selectedModelKey,
  onSelectedModelKeyChange,
  isGeneratingModel,
  modelGenerationProgress,
  modelGenerationError,
  onGenerateModel,
  onGenerateModelsBatch,
  onResetModel,
  isStoringPreloaded,
  storePreloadedError,
  onStorePreloaded,
  shareUrl,
  onCopyShare,
  captureElementId,
}: ControlsPanelProps) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [selectedImageUrl, setSelectedImageUrl] = useState<string | null>(null);
  const [selectedImageUrls, setSelectedImageUrls] = useState<string[]>([]);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);
  /** Strip PDP/model logos via OpenAI before Meshy (same prompt as test.py). */
  const [removeLogosFor3D, setRemoveLogosFor3D] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logoDropActive, setLogoDropActive] = useState(false);

  // Auto-select the first scraped image whenever a new product is loaded
  useEffect(() => {
    setSelectedImageUrl(null);
    setSelectedImageUrls([]);
  }, [scrapedImages]);

  const successCount = generatedColorModels.filter((m) => m.status === "SUCCEEDED").length;
  const failedCount = generatedColorModels.filter(
    (m) => m.status === "FAILED" || m.status === "EXPIRED",
  ).length;

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
    const reader = new FileReader();
    reader.onload = () => {
      const res = reader.result;
      if (typeof res !== "string") return;
      const pipeline = removeWhiteBg
        ? removeWhiteBackground(res).then(compressLogoImage)
        : compressLogoImage(res);
      pipeline.then((result) => onLogoDataUrlChange(result));
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
    const f = e.dataTransfer.files?.[0];
    if (f) processLogoFile(f);
  }

  function clearLogo() {
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
          Paste an iPromo URL to load the product, then add your logo (upload or
          drag-and-drop). Use a separate GLB per product color.
        </p>
      </header>

      {/* ── Product URL loader ── */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          iPromo Product URL
        </span>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            type="url"
            value={displayUrl}
            onChange={(e) => onDisplayUrlChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") onLoadProduct(displayUrl);
            }}
            className="min-w-0 flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none ring-blue-500/40 focus:ring-2"
            placeholder="https://www.ipromo.com/product.html"
          />
          <button
            type="button"
            disabled={isLoadingProduct || !displayUrl.trim()}
            onClick={() => onLoadProduct(displayUrl)}
            className="w-full shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {isLoadingProduct ? (
              <span className="flex items-center gap-1.5">
                <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                </svg>
                Loading
              </span>
            ) : "Load"}
          </button>
        </div>
        {productLoadError ? (
          <p className="text-xs text-red-400">{productLoadError}</p>
        ) : null}
        {productLoadedFromScrape && !isLoadingProduct ? (
          scrapedColors.length > 0 ? (
            <p className="text-xs text-emerald-400">
              ✓ Loaded — {scrapedColors.length} color{scrapedColors.length > 1 ? "s" : ""}
              {scrapedImages.length > 0
                ? `, ${scrapedImages.length} image${scrapedImages.length > 1 ? "s" : ""}`
                : ""}{" "}
              found
            </p>
          ) : (
            <p className="text-xs text-zinc-500">
              ✓ Loaded — no color variants listed on this page.
            </p>
          )
        ) : null}
      </div>

      {/* ── Generate 3D Model section ── */}
      {scrapedImages.length > 0 && (
        <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
              Generate 3D Model
            </span>
            {generatedModelUrl && !isGeneratingModel && (
              <button
                type="button"
                onClick={onResetModel}
                className="text-xs text-zinc-500 hover:text-red-400 transition"
              >
                Reset to default
              </button>
            )}
          </div>

          {/* Image thumbnails */}
          <div className="flex gap-2 overflow-x-auto pb-1">
            {scrapedImages.map((url) => (
              <div key={url} className="relative">
                <button
                  type="button"
                  title="Use this image for 3D generation"
                  onClick={() => setSelectedImageUrl(url)}
                  className={`relative shrink-0 h-16 w-16 overflow-hidden rounded-md border-2 transition ${
                    selectedImageUrl === url
                      ? "border-blue-500 ring-2 ring-blue-500/40"
                      : "border-white/10 hover:border-white/30"
                  }`}
                >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={url}
                  alt="Product image"
                  className="h-full w-full object-cover"
                  onError={(e) => {
                    (e.target as HTMLImageElement).style.display = "none";
                  }}
                />
                {selectedImageUrl === url && (
                  <div className="absolute inset-0 flex items-center justify-center bg-blue-500/20">
                    <svg viewBox="0 0 24 24" className="h-5 w-5 text-blue-300" fill="none" stroke="currentColor" strokeWidth="2.5">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                )}
                </button>
                <label className="absolute -right-1 -top-1 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedImageUrls.includes(url)}
                    onChange={(e) => {
                      setSelectedImageUrls((prev) =>
                        e.target.checked ? [...prev, url] : prev.filter((v) => v !== url),
                      );
                    }}
                    className="h-4 w-4 accent-indigo-500"
                    aria-label="Select image for batch generation"
                  />
                </label>
              </div>
            ))}
          </div>
          <p className="text-xs text-zinc-500">
            Selected for parallel generation: {selectedImageUrls.length}
          </p>

          {/* Progress bar (visible during generation) */}
          {isGeneratingModel && (
            <div className="flex flex-col gap-1.5">
              <div className="flex items-center justify-between text-xs text-zinc-400">
                <span className="flex items-center gap-1.5">
                  <svg className="h-3 w-3 animate-spin" viewBox="0 0 24 24" fill="none">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
                  </svg>
                  {removeLogosFor3D
                    ? "Cleaning image, then converting to 3D…"
                    : "Converting to 3D…"}
                </span>
                <span className="font-mono">{modelGenerationProgress}%</span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-700">
                <div
                  className="h-full rounded-full bg-blue-500 transition-all duration-500"
                  style={{ width: `${modelGenerationProgress}%` }}
                />
              </div>
              <p className="text-xs text-zinc-500">
                This usually takes 1–3 minutes. You can keep editing while waiting.
              </p>
            </div>
          )}

          {/* Success state */}
          {generatedModelUrl && !isGeneratingModel && (
            <div className="space-y-1">
              <p className="text-xs text-emerald-400">
                ✓ Generated {successCount} model{successCount === 1 ? "" : "s"}
                {failedCount > 0 ? ` (${failedCount} failed)` : ""}
              </p>
              {successCount > 0 && (
                <select
                  value={selectedModelKey ?? ""}
                  onChange={(e) => onSelectedModelKeyChange(e.target.value || null)}
                  className="w-full rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
                >
                  <option value="">Select generated model to preview</option>
                  {generatedColorModels
                    .filter((m) => m.status === "SUCCEEDED")
                    .map((m) => (
                      <option key={m.key} value={m.key}>
                        {m.colorLabel ?? m.key}
                        {m.fromPreload ? " (preloaded)" : ""}
                      </option>
                    ))}
                </select>
              )}
            </div>
          )}

          {/* Error state */}
          {modelGenerationError && !isGeneratingModel && (
            <p className="text-xs text-red-400">{modelGenerationError}</p>
          )}

          <label className="flex cursor-pointer items-center gap-2 text-xs text-zinc-400 select-none">
            <div
              role="checkbox"
              aria-checked={removeLogosFor3D}
              onClick={() => setRemoveLogosFor3D((v) => !v)}
              className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                removeLogosFor3D ? "bg-indigo-600" : "bg-zinc-600"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  removeLogosFor3D ? "translate-x-3.5" : "translate-x-0.5"
                }`}
              />
            </div>
            <span>
              Remove logos &amp; model from photo first{" "}
              {/* <span className="text-zinc-500">(OpenAI, slower)</span> */}
            </span>
          </label>

          {/* Generate button */}
          {!isGeneratingModel && (
            <div className="flex flex-col gap-2">
              <button
                type="button"
                disabled={!selectedImageUrl || isGeneratingModel}
                onClick={() => {
                  if (selectedImageUrl) {
                    onGenerateModel(selectedImageUrl, {
                      removeLogosFor3D,
                    });
                  }
                }}
                className="w-full rounded-lg bg-indigo-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Single 3D Model
              </button>
              <button
                type="button"
                disabled={selectedImageUrls.length === 0 || isGeneratingModel}
                onClick={() => {
                  const items = selectedImageUrls.map((imageUrl, idx) => {
                    const match = deriveColorLabelForImage(
                      imageUrl,
                      scrapedImages,
                      scrapedColors,
                    );
                    return {
                      key: `img-${idx + 1}`,
                      imageUrl,
                      colorLabel: match.label,
                      colorHex: match.hex,
                    };
                  });
                  onGenerateModelsBatch(items, { removeLogosFor3D });
                }}
                className="w-full rounded-lg bg-emerald-600 px-3 py-2.5 text-sm font-medium text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Generate Selected in Parallel ({selectedImageUrls.length})
              </button>
              {successCount > 0 && (
                <button
                  type="button"
                  disabled={isStoringPreloaded}
                  onClick={onStorePreloaded}
                  className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-white/10 disabled:opacity-60"
                >
                  {isStoringPreloaded ? "Storing..." : "Store generated models for preload"}
                </button>
              )}
              {storePreloadedError && (
                <p className="text-xs text-red-400">{storePreloadedError}</p>
              )}
            </div>
          )}
        </div>
      )}

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
            Logo (PNG / JPG / SVG)
          </span>
          {/* Background removal toggle */}
          <label className="flex cursor-pointer items-center gap-1.5 text-xs text-zinc-400 select-none">
            <div
              role="checkbox"
              aria-checked={removeWhiteBg}
              onClick={() => setRemoveWhiteBg((v) => !v)}
              className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${
                removeWhiteBg ? "bg-blue-600" : "bg-zinc-600"
              }`}
            >
              <span
                className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${
                  removeWhiteBg ? "translate-x-3.5" : "translate-x-0.5"
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
          className={`rounded-lg border-2 border-dashed p-3 transition-colors ${
            logoDropActive
              ? "border-blue-400 bg-blue-500/10"
              : "border-white/15 bg-black/20"
          }`}
        >
          <p className="mb-2 text-center text-xs text-zinc-500">
            Drop a logo here or choose a file
          </p>
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/jpg,image/svg+xml,.svg"
            onChange={handleLogoFile}
            className="w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-blue-500"
          />
        </div>

        {logoDataUrl ? (
          <>
            {/* Logo preview — checkerboard behind it shows transparency */}
            <div
              className="mx-auto h-20 w-20 overflow-hidden rounded-lg border border-white/10"
              style={{
                backgroundImage:
                  "repeating-conic-gradient(#3f3f46 0% 25%, #27272a 0% 50%)",
                backgroundSize: "12px 12px",
              }}
            >
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
                onClick={() => onLogoPlacementModeChange(!isLogoPlacementMode)}
                className={`flex-1 rounded-lg border px-3 py-2 text-xs font-medium transition ${
                  isLogoPlacementMode
                    ? "border-amber-400/60 bg-amber-400/15 text-amber-300 hover:bg-amber-400/25"
                    : "border-white/15 bg-white/5 text-zinc-300 hover:bg-white/10"
                }`}
              >
                {isLogoPlacementMode ? "✋ Drag logo to place — click to exit" : "🖱 Drag logo on model"}
              </button>
              <button
                type="button"
                onClick={clearLogo}
                className="text-xs text-red-400 hover:underline"
              >
                Remove
              </button>
            </div>
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
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Logo on chest (decal)
        </span>
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
        {shareTooLong ? (
          <p className="text-xs text-amber-400">
            Logo is very large even after compression. The share link may not
            open correctly on all browsers — use &quot;Download PDF&quot; to
            share instead.
          </p>
        ) : null}
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
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm"
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