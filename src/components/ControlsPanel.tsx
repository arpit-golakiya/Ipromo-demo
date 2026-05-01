"use client";

import { useEffect, useRef, useState } from "react";
import { MAX_LOGOS, type DecalConfig, type LogoLayer, type LogoPlacement } from "@/types/configurator";
import { downloadConfiguratorPdf } from "@/lib/pdfExport";
import type { LibraryItem, LibraryProduct } from "@/hooks/useConfiguratorState";

// Keep this reasonably high; the logo is used as a decal texture, so low values
// quickly look blurry. Share URLs can grow with higher-res data URLs; we still
// warn users if the share link becomes too long.
const LOGO_MAX_PX = 1024;
const LOGO_MAX_PX_ENHANCED = 4096;
// Add transparent margin around raster logos so projection onto curved models
// doesn't clip the design near the edges.
const LOGO_SAFE_MARGIN_FRAC = 0.14;

async function padLogoWithTransparentMargin(dataUrl: string, marginFrac = LOGO_SAFE_MARGIN_FRAC): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;
  const m = Number.isFinite(marginFrac) ? Math.max(0, Math.min(0.45, marginFrac)) : LOGO_SAFE_MARGIN_FRAC;

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const w = Math.max(1, img.naturalWidth);
      const h = Math.max(1, img.naturalHeight);
      const outW = Math.max(1, Math.round(w * (1 + 2 * m)));
      const outH = Math.max(1, Math.round(h * (1 + 2 * m)));

      const canvas = document.createElement("canvas");
      canvas.width = outW;
      canvas.height = outH;
      const ctx = canvas.getContext("2d");
      if (!ctx) { resolve(dataUrl); return; }

      // Preserve alpha; don't paint a background.
      ctx.clearRect(0, 0, outW, outH);
      const dx = Math.round((outW - w) / 2);
      const dy = Math.round((outH - h) / 2);
      ctx.drawImage(img, dx, dy, w, h);

      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
}

async function compressLogoImage(dataUrl: string, maxPx = LOGO_MAX_PX): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;

  return new Promise<string>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const longest = Math.max(img.naturalWidth, img.naturalHeight, 1);
      const scale = Math.min(1, maxPx / longest);
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

function dataUrlToBlob(dataUrl: string): { blob: Blob; mime: string } {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.*)$/);
  if (!match) {
    // Fallback: treat as png; let downstream fail gracefully if invalid.
    return { blob: new Blob([], { type: "image/png" }), mime: "image/png" };
  }
  const mime = match[1] ?? "image/png";
  const b64 = (match[2] ?? "").replace(/\s+/g, "");
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return { blob: new Blob([bytes], { type: mime }), mime };
}

function dataUrlToFile(dataUrl: string, fallbackName: string): File {
  const { blob, mime } = dataUrlToBlob(dataUrl);
  const ext =
    mime.includes("png") ? "png" : mime.includes("webp") ? "webp" : mime.includes("jpeg") ? "jpg" : "png";
  const name = fallbackName.replace(/\.[a-z0-9]+$/i, "") + `.${ext}`;
  return new File([blob], name, { type: mime });
}

async function removeBackgroundViaApi(file: Blob, filename = "logo.png"): Promise<string> {
  const form = new FormData();
  form.set("image", file, filename);

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

async function enhanceLogoViaApi(
  dataUrl: string,
  onRemainingToday?: (remaining: number) => void,
): Promise<string> {
  if (dataUrl.startsWith("data:image/svg")) return dataUrl;

  const res = await fetch("/api/enhance-logo", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dataUrl }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (res.status === 429) {
      if (typeof onRemainingToday === "function") onRemainingToday(0);
      throw new Error("Enhance limit reached. Please contact an admin.");
    }
    throw new Error(`enhance-logo failed: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
  }

  const json = (await res.json()) as {
    dataUrl?: unknown;
    enhanceRemaining?: unknown;
    enhanceRemainingToday?: unknown;
  };
  const next = typeof json?.dataUrl === "string" ? json.dataUrl : null;
  if (!next || !next.startsWith("data:image/")) {
    throw new Error("enhance-logo failed: invalid response payload");
  }
  const remaining =
    typeof json?.enhanceRemainingToday === "number" ? json.enhanceRemainingToday : null;
  if (typeof remaining === "number" && typeof onRemainingToday === "function") {
    onRemainingToday(remaining);
  }
  return next;
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
  onOpen2dPreview: () => void;
  libraryQuery: string;
  libraryProducts: LibraryProduct[];
  isLoadingLibrary: boolean;
  libraryError: string | null;
  onSearchLibrary: (q: string) => void;
  selectedModelId: string | null;
  onSelectModel: (item: LibraryItem | null) => void;
  logos: LogoLayer[];
  activeLogoId: string | null;
  onActiveLogoIdChange: (id: string | null) => void;
  onAddLogo: (dataUrl: string, placement?: LogoPlacement) => void;
  onUpsertActiveLogo: (dataUrl: string, placement?: LogoPlacement) => void;
  onRemoveLogo: (id: string) => void;
  isLogoPlacementMode: boolean;
  onLogoPlacementModeChange: (v: boolean) => void;
  activeDecal: DecalConfig | null;
  onActiveDecalChange: (next: DecalConfig) => void;
  onCopyShare: () => Promise<{ ok: boolean; href: string }>;
  captureElementId: string;
};

/**
 * Left column: URL field, logo upload / drop, decal tuning, share & PDF.
 */
export function ControlsPanel({
  productName,
  productKey: _productKey,
  onOpen2dPreview,
  libraryQuery,
  libraryProducts,
  isLoadingLibrary,
  libraryError,
  onSearchLibrary,
  selectedModelId,
  onSelectModel,
  logos,
  activeLogoId,
  onActiveLogoIdChange,
  onAddLogo,
  onUpsertActiveLogo,
  onRemoveLogo,
  isLogoPlacementMode,
  onLogoPlacementModeChange,
  activeDecal,
  onActiveDecalChange,
  onCopyShare,
  captureElementId,
}: ControlsPanelProps) {
  void _productKey;
  const fileRef = useRef<HTMLInputElement>(null);
  const [lightboxSrc, setLightboxSrc] = useState<string | null>(null);
  const [removeWhiteBg, setRemoveWhiteBg] = useState(true);
  const [increaseLogoQuality, setIncreaseLogoQuality] = useState(false);
  const [enhanceRemaining, setEnhanceRemaining] = useState<number | null>(null);
  const [isLogoProcessing, setIsLogoProcessing] = useState(false);
  const [logoProcessingLabel, setLogoProcessingLabel] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isCopyingShare, setIsCopyingShare] = useState(false);
  const [logoDropActive, setLogoDropActive] = useState(false);
  const [localQuery, setLocalQuery] = useState(libraryQuery);
  const originalLogoDataUrlRef = useRef<string | null>(null);
  const lastAutoEnhancedSourceRef = useRef<string | null>(null);
  const autoEnhanceInFlightRef = useRef(false);
  const enhanceBlocked = typeof enhanceRemaining === "number" && Math.trunc(enhanceRemaining) <= 0;

  function applyEnhanceRemaining(remaining: number) {
    const next = Number.isFinite(remaining) ? Math.max(0, Math.trunc(remaining)) : null;
    setEnhanceRemaining(next);
    if (typeof next === "number" && next <= 0) setIncreaseLogoQuality(false);
  }

  useEffect(() => {
    setLocalQuery(libraryQuery);
  }, [libraryQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/me", { cache: "no-store" });
        const json: unknown = await res.json().catch(() => ({}));
        if (cancelled) return;
        const enhance = (json as { enhance?: unknown } | null)?.enhance;
        const remaining = (enhance as { remainingToday?: unknown } | null)?.remainingToday;
        if (typeof remaining === "number") applyEnhanceRemaining(remaining);
        else setEnhanceRemaining(null);
      } catch {
        if (!cancelled) setEnhanceRemaining(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Allow a manual retry: toggling Enhance OFF -> ON should re-attempt.
    if (!increaseLogoQuality) {
      lastAutoEnhancedSourceRef.current = null;
    }
  }, [increaseLogoQuality]);

  const activeLogo = (() => {
    const id = activeLogoId ?? logos[0]?.id ?? null;
    return id ? logos.find((l) => l.id === id) ?? null : null;
  })();
  const activeLogoDataUrl = activeLogo?.dataUrl ?? null;
  const activeLogoPlacement = activeLogo?.placement ?? "front";

  function commitProcessedLogo(dataUrl: string) {
    // UX: each upload should add a new logo until we hit the max.
    // After MAX_LOGOS, we fall back to replacing the active logo.
    if (logos.length < MAX_LOGOS) {
      onAddLogo(dataUrl, activeLogoPlacement);
      return;
    }
    onUpsertActiveLogo(dataUrl, activeLogoPlacement);
  }

  useEffect(() => {
    // If the active logo is cleared (or loaded from share/url without an "original upload"),
    // reset our local tracking so future uploads can be enhanced immediately on toggle.
    if (!activeLogoDataUrl) {
      originalLogoDataUrlRef.current = null;
      lastAutoEnhancedSourceRef.current = null;
      return;
    }
  }, [activeLogoDataUrl]);

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

    const maxPx = increaseLogoQuality ? LOGO_MAX_PX_ENHANCED : LOGO_MAX_PX;

    if (removeWhiteBg && !f.type.includes("svg")) {
      // When both are enabled, do quality enhancement first (helps bg removal edges),
      // then remove background, then compress for the decal texture.
      setLogoProcessingLabel(increaseLogoQuality ? "Increasing logo quality…" : "Removing background…");
      (async () => {
        let dataUrl: string;

        // Step 1: read the file
        const reader = new FileReader();
        dataUrl = await new Promise<string>((resolve, reject) => {
          reader.onload = () => {
            const res = reader.result;
            if (typeof res === "string") resolve(res);
            else reject(new Error("Invalid FileReader result"));
          };
          reader.onerror = () => reject(new Error("Failed to read file"));
          reader.readAsDataURL(f);
        });
        // Keep the true original so we can enhance later without requiring re-upload.
        originalLogoDataUrlRef.current = dataUrl;
        lastAutoEnhancedSourceRef.current = null;

        // Step 2: enhance (optional)
        let enhancedFile: File | null = null;
        if (increaseLogoQuality) {
          setLogoProcessingLabel("Increasing logo quality…");
          try {
            dataUrl = await enhanceLogoViaApi(dataUrl, applyEnhanceRemaining);
            // We already enhanced from the original upload; prevent the auto-enhance effect
            // (which also runs when the toggle is ON) from re-enhancing again.
            lastAutoEnhancedSourceRef.current = originalLogoDataUrlRef.current;
            enhancedFile = dataUrlToFile(dataUrl, f.name || "logo");
          } catch (e) {
            // If enhancement fails, continue with the original image.
            if (e instanceof Error && /limit reached/i.test(e.message)) alert(e.message);
          }
        }

        // Step 3: remove background (prefer API; fallback to local)
        setLogoProcessingLabel("Removing background…");
        try {
          // Pass the enhanced image when available; otherwise use the original upload.
          const blobToSend = enhancedFile ?? f;
          const nameToSend = enhancedFile?.name ?? (f.name || "logo.png");
          dataUrl = await removeBackgroundViaApi(blobToSend, nameToSend);
        } catch {
          dataUrl = await removeWhiteBackground(dataUrl);
        }

        // Step 4: compress to keep decal texture size reasonable
        // Step 4: add transparent padding to prevent edge clipping on curved models
        dataUrl = await padLogoWithTransparentMargin(dataUrl);
        // Step 5: compress to keep decal texture size reasonable
        const compressed = await compressLogoImage(dataUrl, maxPx);
        commitProcessedLogo(compressed);
      })()
        .catch(() => {
          // Fallback to local near-white removal if the API fails.
          setLogoProcessingLabel("Optimizing logo…");
          const reader = new FileReader();
          reader.onload = () => {
            const res = reader.result;
            if (typeof res !== "string") return;
            removeWhiteBackground(res)
              .then(async (bgRemoved) => {
                // Mirror the order: enhance first, then bg-remove (already done), then compress.
                if (!increaseLogoQuality) return bgRemoved;
                setLogoProcessingLabel("Increasing logo quality…");
                try {
                  const out = await enhanceLogoViaApi(bgRemoved, applyEnhanceRemaining);
                  lastAutoEnhancedSourceRef.current = originalLogoDataUrlRef.current;
                  return out;
                } catch (e) {
                  if (e instanceof Error && /limit reached/i.test(e.message)) alert(e.message);
                  return bgRemoved;
                }
              })
              .then((result) => padLogoWithTransparentMargin(result))
              .then((result) => compressLogoImage(result, maxPx))
              .then((result) => commitProcessedLogo(result))
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
      (async () => {
        let next = res;
        // Keep the true original so we can enhance later without requiring re-upload.
        originalLogoDataUrlRef.current = res;
        lastAutoEnhancedSourceRef.current = null;
        if (increaseLogoQuality && !next.startsWith("data:image/svg")) {
          setLogoProcessingLabel("Increasing logo quality…");
          try {
            next = await enhanceLogoViaApi(next, applyEnhanceRemaining);
            lastAutoEnhancedSourceRef.current = res;
          } catch (e) {
            // If enhancement fails, fall back to original.
            if (e instanceof Error && /limit reached/i.test(e.message)) alert(e.message);
            next = res;
          }
        }
        next = await padLogoWithTransparentMargin(next);
        const compressed = await compressLogoImage(next, maxPx);
        commitProcessedLogo(compressed);
      })()
        .finally(() => {
          setLogoProcessingLabel(null);
          setIsLogoProcessing(false);
        });
    };
    reader.readAsDataURL(f);
  }

  useEffect(() => {
    // Auto-enhance after upload when the toggle is turned on.
    // No button, no re-upload: reprocess from the original uploaded dataUrl.
    if (!increaseLogoQuality) return;
    if (autoEnhanceInFlightRef.current) return;
    if (!activeLogoDataUrl) return;
    const original = originalLogoDataUrlRef.current;
    if (!original) return;
    if (lastAutoEnhancedSourceRef.current === original) return;

    let cancelled = false;
    autoEnhanceInFlightRef.current = true;
    setIsLogoProcessing(true);
    setLogoProcessingLabel("Increasing logo quality…");
    const maxPx = LOGO_MAX_PX_ENHANCED;
    // Mark as attempted immediately to prevent failure loops.
    // If the user wants to retry, they can toggle Enhance OFF -> ON.
    lastAutoEnhancedSourceRef.current = original;

    (async () => {
      let dataUrl = original;

      // Step 1: enhance (best-effort; if it fails, keep current logoDataUrl)
      try {
        dataUrl = await enhanceLogoViaApi(dataUrl, applyEnhanceRemaining);
      } catch (e) {
        console.warn("[ControlsPanel] enhance-logo failed; keeping existing logo.", e);
        if (e instanceof Error && /limit reached/i.test(e.message)) {
          // Make it explicit to the user why enhance won't run.
          alert(e.message);
        }
        return;
      }

      // Step 2: background removal (if enabled)
      if (removeWhiteBg && !dataUrl.startsWith("data:image/svg")) {
        setLogoProcessingLabel("Removing background…");
        try {
          const enhancedFile = dataUrlToFile(dataUrl, "logo");
          dataUrl = await removeBackgroundViaApi(enhancedFile, enhancedFile.name);
        } catch {
          dataUrl = await removeWhiteBackground(dataUrl);
        }
      }

      // Step 3: add transparent padding so edges don't clip on curved surfaces
      dataUrl = await padLogoWithTransparentMargin(dataUrl);
      // Step 4: compress for decal texture
      setLogoProcessingLabel("Optimizing logo…");
      const compressed = await compressLogoImage(dataUrl, maxPx);
      if (cancelled) return;
      // Auto-enhance should REPLACE the active logo (not add a new one).
      onUpsertActiveLogo(compressed, activeLogoPlacement);
    })()
      .finally(() => {
        autoEnhanceInFlightRef.current = false;
        setLogoProcessingLabel(null);
        setIsLogoProcessing(false);
      });

    return () => {
      cancelled = true;
      // Ensure the loader never gets stuck if the request is cancelled mid-flight.
      // (This cleanup only runs when deps change, not when we set loader state.)
      autoEnhanceInFlightRef.current = false;
      setLogoProcessingLabel(null);
      setIsLogoProcessing(false);
    };
  }, [activeLogoDataUrl, activeLogoPlacement, increaseLogoQuality, onUpsertActiveLogo, removeWhiteBg]);

  function handleLogoFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
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
    const id = activeLogoId ?? logos[0]?.id ?? null;
    if (id) onRemoveLogo(id);
    if (fileRef.current) fileRef.current.value = "";
  }

  function setDecalPartial(patch: Partial<DecalConfig>) {
    if (!activeDecal) return;
    onActiveDecalChange({
      position: patch.position ?? activeDecal.position,
      rotation: patch.rotation ?? activeDecal.rotation,
      scale: patch.scale ?? activeDecal.scale,
    });
  }

  const rotateDeg = Math.round(((activeDecal?.rotation?.[2] ?? 0) * 180) / Math.PI);

  return (
    <aside className="flex h-auto min-h-0 flex-col gap-4 overflow-visible rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:gap-5 sm:p-5 md:h-full md:overflow-y-auto hide-scrollbar">
      <header>
        <h1 className="text-lg font-semibold tracking-tight text-slate-900">
          {productName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Search and load a prebuilt 3D product, then add your logo (upload or drag-and-drop).
        </p>
      </header>

      {/* ── 2D preview ── */}
      <button
        type="button"
        onClick={onOpen2dPreview}
        className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-800 transition hover:bg-slate-50"
      >
        View 2D preview
      </button>

      {/* ── Product library ── */}
      <div className="flex flex-col gap-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
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
            className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none ring-blue-500/30 placeholder:text-slate-400 focus:ring-2"
            placeholder="Search by name…"
          />
          <button
            type="button"
            disabled={isLoadingLibrary}
            onClick={() => onSearchLibrary(localQuery)}
            className="w-full shrink-0 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
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
        {libraryError ? <p className="text-xs text-red-600">{libraryError}</p> : null}
      </div>

      {libraryProducts.length > 0 ? (
        <div className="flex flex-col gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Results ({libraryProducts.length})
          </span>
          <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {libraryProducts.map((product) => (
              <details
                key={product.product_name}
                className="rounded-md border border-slate-200 bg-white px-2 py-1.5"
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 text-xs text-slate-800">
                  <div className="h-8 w-8 shrink-0 overflow-hidden rounded bg-slate-100">
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
                  <span className="shrink-0 text-[11px] text-slate-500">
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
                          ? "border-blue-500/50 bg-blue-50/40 text-blue-900"
                          : "border-gray-200 bg-gray-50 text-gray-900 hover:border-gray-300 hover:bg-gray-100"
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
                          <span className="shrink-0 text-[11px] text-zinc-600">Loaded</span>
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
        <div className="flex flex-col gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-gray-400">
            Logos (max {MAX_LOGOS})
          </span>
          {/* Background removal toggle */}
          <div className={`flex items-center gap-3 text-xs text-gray-400 select-none ${isLogoProcessing ? "opacity-60 pointer-events-none" : ""}`}>
            <label
              className={`flex items-center gap-1.5 ${enhanceBlocked && !increaseLogoQuality ? "cursor-not-allowed opacity-60" : "cursor-pointer"}`}
              title={enhanceBlocked && !increaseLogoQuality ? "Enhance limit reached" : undefined}
            >
              <div
                role="checkbox"
                aria-checked={increaseLogoQuality}
                aria-disabled={enhanceBlocked && !increaseLogoQuality}
                onClick={() => {
                  if (enhanceBlocked && !increaseLogoQuality) return;
                  setIncreaseLogoQuality((v) => !v);
                }}
                className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${increaseLogoQuality ? "bg-blue-600" : "bg-zinc-600"
                  }`}
              >
                <span
                  className={`inline-block h-3 w-3 rounded-full bg-white shadow transition-transform ${increaseLogoQuality ? "translate-x-3.5" : "translate-x-0.5"
                    }`}
                />
              </div>
              Enhance logo quality
            </label>
            <label className="flex cursor-pointer items-center gap-1.5">
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
          {typeof enhanceRemaining === "number" ? (
            <span className="text-[11px] text-gray-400">
              Remaining enhances: {Math.max(0, Math.trunc(enhanceRemaining))} for the day
            </span>
          ) : null}
        </div>

        <div
          onDragOver={handleLogoDragOver}
          onDragLeave={handleLogoDragLeave}
          onDrop={handleLogoDrop}
          className={`relative rounded-lg border-2 border-dashed p-3 transition-colors ${logoDropActive
            ? "border-blue-400"
            : "border-gray-200"
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
          <p className="mb-2 text-center text-xs text-gray-400">
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

        {/* Logo slots */}
        <div className="flex flex-col gap-2 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-gray-500">
              {logos.length}/{MAX_LOGOS} added
            </span>
          </div>

          {logos.length ? (
            <div className="flex flex-wrap gap-2">
              {logos.map((l) => {
                const active = l.id === (activeLogoId ?? logos[0]?.id);
                return (
                  <button
                    key={l.id}
                    type="button"
                    disabled={isLogoProcessing}
                    onClick={() => onActiveLogoIdChange(l.id)}
                    className={`relative h-12 w-12 overflow-hidden rounded-lg border transition ${active ? "border-blue-500 bg-blue-50/40" : "border-white/10 bg-white/5 hover:bg-white/10"}`}
                    title={l.placement}
                    style={{
                      backgroundImage:
                        "repeating-conic-gradient(#3f3f46 0% 25%, #27272a 0% 50%)",
                      backgroundSize: "12px 12px",
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={l.dataUrl} alt="" className="h-full w-full object-contain" />
                    {active ? (
                      <span className="absolute left-1 top-1 rounded bg-blue-600/90 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                        Active
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ) : (
            <p className="text-xs text-gray-400">Upload up to 4 logos and choose placement per logo.</p>
          )}
        </div>

        {activeLogoDataUrl ? (
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
                src={activeLogoDataUrl}
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
                  ? "border-blue-400/60 bg-blue-50/40 text-blue-900 hover:bg-blue-50/50"
                  : "border-gray-200 bg-gray-50 text-gray-900 hover:bg-gray-100"
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
              <div className="flex items-center justify-center gap-2 rounded-md border border-blue-400/20 bg-blue-50/40 px-3 py-2 text-xs text-blue-900">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-blue-500 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-blue-300" />
                </span>
                Placement mode active — drag on the model
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-xs text-gray-400">
            {removeWhiteBg
              ? "White backgrounds will be removed automatically."
              : "Background will be kept as-is."}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-xs text-gray-400">
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
              if (!activeDecal) return;
              const next: [number, number, number] = [...activeDecal.rotation];
              next[2] = rad;
              setDecalPartial({ rotation: next });
            }}
            className="flex-1 accent-blue-500"
          />
          <span className="w-10 text-right font-mono text-gray-600/80">
            {rotateDeg}°
          </span>
        </label>

        <label className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="w-12 shrink-0">Size</span>
          <input
            type="range"
            min={0.05}
            max={1}
            step={0.005}
            value={activeDecal?.scale ?? 0.22}
            onChange={(e) =>
              setDecalPartial({ scale: Number(e.target.value) })
            }
            className="flex-1 accent-blue-500"
          />
          <span className="w-10 text-right font-mono text-gray-600/80">
            {Math.round((activeDecal?.scale ?? 0.22) * 100)}%
          </span>
        </label>
      </div>

      <div className="mt-auto flex flex-col gap-2 border-t border-gray-200 pt-4">
        <button
          type="button"
          disabled={isCopyingShare}
          onClick={() => {
            if (isCopyingShare) return;
            setIsCopyingShare(true);
            (async () => {
              const res = await onCopyShare();
              if (!res.ok) {
                alert("Could not copy the share link. Please try again.");
                return;
              }
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1800);
            })()
              .finally(() => setIsCopyingShare(false));
          }}
          className="rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {isCopyingShare ? "Creating link…" : copied ? "Copied!" : "Copy share link"}
        </button>
        <button
          type="button"
          onClick={() => void handlePdf()}
          className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-2.5 text-sm font-medium text-gray-900 transition hover:bg-gray-100"
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