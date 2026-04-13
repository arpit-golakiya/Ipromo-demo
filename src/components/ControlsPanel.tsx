"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { DecalConfig } from "@/types/configurator";
import { downloadConfiguratorPdf } from "@/lib/pdfExport";
import type { ScrapedProduct } from "@/app/api/scrape/route";
import {
  ModelGroupsSetupSection,
  type ImageGroup,
} from "@/components/ModelGroupsSetupSection";

const LOGO_MAX_PX = 256;

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
  onLoadUploadedImages: (imageUrls: string[], productUrl?: string) => void;
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
    imageUrls?: string[];
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
  onGenerateModelsBatch: (
    items: Array<{
      key: string;
      imageUrl: string;
      imageUrls?: string[];
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
  onLoadUploadedImages,
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
  const groupIdRef = useRef(0);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  /** URLs currently checked in the "available" pool (not yet in a group). */
  const [selection, setSelection] = useState<string[]>([]);
  /** Each group → one 3D job (multi-view when more than one URL). */
  const [groups, setGroups] = useState<ImageGroup[]>([]);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);
  /** Strip PDP logos / people via OpenAI before 3D (any product type). */
  const [removeLogosFor3D, setRemoveLogosFor3D] = useState(false);
  const [copied, setCopied] = useState(false);
  const [logoDropActive, setLogoDropActive] = useState(false);
  /** Full-screen setup for 3D groups; opens automatically when product images load. */
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelPortalReady, setModelPortalReady] = useState(false);
  const [uploadProductUrl, setUploadProductUrl] = useState("");

  const scrapeKey = scrapedImages.join("\u0001");

  const assignedUrls = useMemo(
    () => new Set(groups.flatMap((g) => g.imageUrls)),
    [groups],
  );

  const availableUrls = useMemo(
    () => scrapedImages.filter((u) => !assignedUrls.has(u)),
    [scrapedImages, assignedUrls],
  );

  useEffect(() => {
    setGroups([]);
    setSelection([]);
    if (scrapedImages.length > 0) setModelModalOpen(true);
    else setModelModalOpen(false);
  }, [scrapeKey, scrapedImages.length]);

  useEffect(() => {
    setModelPortalReady(true);
  }, []);

  const successCount = generatedColorModels.filter((m) => m.status === "SUCCEEDED").length;

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

  async function fileToDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") resolve(reader.result);
        else reject(new Error("Could not read file"));
      };
      reader.onerror = () => reject(new Error("Could not read file"));
      reader.readAsDataURL(file);
    });
  }

  async function handleProductImagesUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []).filter((f) => f.type.startsWith("image/"));
    if (files.length === 0) {
      e.target.value = "";
      return;
    }

    const capped = files.slice(0, 40);
    try {
      const dataUrls = await Promise.all(capped.map((f) => fileToDataUrl(f)));
      onLoadUploadedImages(dataUrls, uploadProductUrl.trim() || undefined);
    } catch {
      alert("Could not read one or more uploaded images.");
    } finally {
      e.target.value = "";
    }
  }

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

      {/* ── Direct image upload (optional product URL) ── */}
      <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
        <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
          Upload Product Images
        </span>
        <p className="text-xs text-zinc-500">
          Upload product photos directly and use the same group-based 3D flow.
        </p>
        <input
          type="url"
          value={uploadProductUrl}
          onChange={(e) => setUploadProductUrl(e.target.value)}
          className="min-w-0 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-zinc-200 outline-none ring-blue-500/40 focus:ring-2"
          placeholder="Optional product_url (for auto-save/preload mapping)"
        />
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => void handleProductImagesUpload(e)}
          className="w-full text-sm text-zinc-300 file:mr-3 file:rounded-md file:border-0 file:bg-indigo-600 file:px-3 file:py-1.5 file:text-sm file:text-white hover:file:bg-indigo-500"
        />
        <p className="text-[11px] text-zinc-500">
          You can upload up to 40 images per load.
        </p>
      </div>

      {/* ── 3D: compact summary in sidebar (full UI in modal) ── */}
      {scrapedImages.length > 0 && (
        <div className="flex flex-col gap-2 rounded-lg border border-white/10 bg-black/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <span className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                3D models
              </span>
              <p className="mt-0.5 truncate text-xs text-zinc-400">
                {groups.length} group{groups.length === 1 ? "" : "s"}
                {isGeneratingModel ? ` · generating ${modelGenerationProgress}%` : ""}
                {!isGeneratingModel && successCount > 0 ? ` · ${successCount} ready` : ""}
                {!isGeneratingModel && successCount === 0 && groups.length === 0
                  ? " · open window to set up"
                  : ""}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setModelModalOpen(true)}
              className="shrink-0 rounded-lg bg-indigo-600 px-3 py-2 text-xs font-medium text-white transition hover:bg-indigo-500"
            >
              Open setup
            </button>
          </div>
          {!modelModalOpen && generatedModelUrl && !isGeneratingModel && successCount > 0 && (
            <select
              value={selectedModelKey ?? ""}
              onChange={(e) => onSelectedModelKeyChange(e.target.value || null)}
              className="w-full rounded-md border border-white/15 bg-black/40 px-2 py-1.5 text-xs text-zinc-200"
            >
              <option value="">Preview variant…</option>
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

      {modelPortalReady &&
        modelModalOpen &&
        scrapedImages.length > 0 &&
        createPortal(
          <div
            role="dialog"
            aria-modal
            aria-labelledby="setup-3d-title"
            className="fixed inset-0 z-[100] flex items-center justify-center bg-black/75 p-3 backdrop-blur-sm sm:p-5"
            onClick={() => setModelModalOpen(false)}
          >
            <div
              className="flex max-h-[min(92vh,880px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-white/10 bg-zinc-900 shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <h2 id="setup-3d-title" className="truncate text-base font-semibold text-white">
                    Build 3D models
                  </h2>
                  <p className="mt-0.5 truncate text-xs text-zinc-500">{productName}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {generatedModelUrl && !isGeneratingModel ? (
                    <button
                      type="button"
                      onClick={onResetModel}
                      className="rounded-md px-2 py-1 text-xs text-zinc-400 hover:bg-white/10 hover:text-red-300"
                    >
                      Reset
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="rounded-lg p-2 text-zinc-400 transition hover:bg-white/10 hover:text-white"
                    aria-label="Close"
                    onClick={() => setModelModalOpen(false)}
                  >
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path strokeLinecap="round" d="M6 6l12 12M18 6L6 18" />
                    </svg>
                  </button>
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-5 pt-3 sm:px-5">
                <ModelGroupsSetupSection
                  scrapedImages={scrapedImages}
                  scrapedColors={scrapedColors}
                  groups={groups}
                  setGroups={setGroups}
                  selection={selection}
                  setSelection={setSelection}
                  groupIdRef={groupIdRef}
                  availableUrls={availableUrls}
                  removeLogosFor3D={removeLogosFor3D}
                  setRemoveLogosFor3D={setRemoveLogosFor3D}
                  isGeneratingModel={isGeneratingModel}
                  modelGenerationProgress={modelGenerationProgress}
                  modelGenerationError={modelGenerationError}
                  generatedColorModels={generatedColorModels}
                  selectedModelKey={selectedModelKey}
                  onSelectedModelKeyChange={onSelectedModelKeyChange}
                  onGenerateModelsBatch={onGenerateModelsBatch}
                  isStoringPreloaded={isStoringPreloaded}
                  storePreloadedError={storePreloadedError}
                  onStorePreloaded={onStorePreloaded}
                  setLightboxSrc={setLightboxSrc}
                />
              </div>
            </div>
          </div>,
          document.body,
        )}

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