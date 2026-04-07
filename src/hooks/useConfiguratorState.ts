"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DECAL,
  type DecalConfig,
} from "@/types/configurator";
import type { ScrapedProduct } from "@/app/api/scrape/route";
import type { MeshyTaskStatus } from "@/app/api/meshy/status/route";

const DEFAULT_PRODUCT_NAME = "Custom Hoodie";

function parseColor(param: string | null): string | null {
  if (!param) return null;
  const hex = param.startsWith("#") ? param : `#${param}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  return null;
}

/** True if any decal-related query key is present. */
function hasDecalParams(sp: URLSearchParams): boolean {
  return ["dx", "dy", "dz", "ds", "rx", "ry", "rz"].some(
    (k) => sp.get(k) != null && sp.get(k) !== "",
  );
}

function readDecalFromParams(sp: URLSearchParams): DecalConfig {
  const num = (k: string, fallback: number) => {
    const v = sp.get(k);
    if (v == null || v === "") return fallback;
    const n = Number(v);
    return Number.isFinite(n) ? n : fallback;
  };
  return {
    position: [
      num("dx", DEFAULT_DECAL.position[0]),
      num("dy", DEFAULT_DECAL.position[1]),
      num("dz", DEFAULT_DECAL.position[2]),
    ],
    rotation: [
      num("rx", DEFAULT_DECAL.rotation[0]),
      num("ry", DEFAULT_DECAL.rotation[1]),
      num("rz", DEFAULT_DECAL.rotation[2]),
    ],
    scale: num("ds", DEFAULT_DECAL.scale),
  };
}

/**
 * Central configurator state (client-only).
 *
 * Initial values are read once from `window.location.search` on mount — not from
 * `useSearchParams()`, because Next can churn that hook when the address bar changes
 * and remounting/reconciling the tree breaks the WebGL canvas. Share links still work
 * on full page loads; use "Copy share link" for the full query (including logo).
 */
export function useConfiguratorState() {
  const [color, setColor] = useState("#4a6fa5");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [decal, setDecal] = useState<DecalConfig>(DEFAULT_DECAL);
  const [displayUrl, setDisplayUrl] = useState("");
  const [isLogoPlacementMode, setIsLogoPlacementMode] = useState(false);

  // Product scraping state
  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);
  const [scrapedColors, setScrapedColors] = useState<ScrapedProduct["colors"]>([]);
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [productLoadError, setProductLoadError] = useState<string | null>(null);

  // 3D model generation state
  const [generatedModelTaskId, setGeneratedModelTaskId] = useState<string | null>(null);
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [modelGenerationProgress, setModelGenerationProgress] = useState(0);
  const [modelGenerationError, setModelGenerationError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hydratedFromUrl = useRef(false);

  const setLogoDataUrlWithReset = useCallback(
    (url: string | null) => {
      setLogoDataUrl(url);
      if (!url) setIsLogoPlacementMode(false);
    },
    [],
  );

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const sp = new URLSearchParams(window.location.search);
    const c = parseColor(sp.get("c"));
    if (c) setColor(c);
    const logo = sp.get("logo");
    if (logo && logo.startsWith("data:image")) {
      setLogoDataUrl(logo);  // direct setter — no placement mode reset needed on initial load
    }
    if (hasDecalParams(sp)) {
      setDecal(readDecalFromParams(sp));
    }
  }, []);

  const buildQueryString = useCallback(
    (options?: { includeLogo: boolean }) => {
      const includeLogo = options?.includeLogo ?? true;
      const params = new URLSearchParams();
      params.set("c", color.replace("#", ""));
      params.set("dx", String(decal.position[0]));
      params.set("dy", String(decal.position[1]));
      params.set("dz", String(decal.position[2]));
      params.set("ds", String(decal.scale));
      params.set("rx", String(decal.rotation[0]));
      params.set("ry", String(decal.rotation[1]));
      params.set("rz", String(decal.rotation[2]));
      if (includeLogo && logoDataUrl) {
        params.set("logo", logoDataUrl);
      }
      return params.toString();
    },
    [color, decal, logoDataUrl],
  );

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    const q = buildQueryString({ includeLogo: true });
    return `${window.location.origin}${window.location.pathname}?${q}`;
  }, [buildQueryString]);

  const loadProductFromUrl = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setIsLoadingProduct(true);
    setProductLoadError(null);
    // Reset any previously generated model when loading a new product
    if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
    setGeneratedModelTaskId(null);
    setIsGeneratingModel(false);
    setModelGenerationProgress(0);
    setModelGenerationError(null);
    try {
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
      const data: ScrapedProduct & { error?: string } = await res.json();
      if (!res.ok || data.error) {
        setProductLoadError(data.error ?? "Failed to load product");
        return;
      }
      setProductName(data.name || DEFAULT_PRODUCT_NAME);
      setScrapedColors(data.colors ?? []);
      setScrapedImages(data.images ?? []);
      if (data.colors?.length > 0) {
        setColor(data.colors[0].hex);
      }
    } catch {
      setProductLoadError("Network error — check your connection");
    } finally {
      setIsLoadingProduct(false);
    }
  }, []);

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const generateModelFromImage = useCallback(async (imageUrl: string) => {
    stopPolling();
    setIsGeneratingModel(true);
    setModelGenerationProgress(0);
    setModelGenerationError(null);
    setGeneratedModelTaskId(null);

    try {
      const res = await fetch("/api/meshy/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl }),
      });
      const data: { taskId?: string; error?: string } = await res.json();

      if (!res.ok || data.error) {
        setModelGenerationError(data.error ?? "Failed to start 3D generation");
        setIsGeneratingModel(false);
        return;
      }

      const taskId = data.taskId!;

      const poll = async () => {
        try {
          const statusRes = await fetch(`/api/meshy/status?taskId=${encodeURIComponent(taskId)}`);
          const status: MeshyTaskStatus & { error?: string } = await statusRes.json();

          if (!statusRes.ok) {
            setModelGenerationError((status as { error?: string }).error ?? "Status check failed");
            setIsGeneratingModel(false);
            return;
          }

          setModelGenerationProgress(status.progress ?? 0);

          if (status.status === "SUCCEEDED") {
            setGeneratedModelTaskId(taskId);
            setIsGeneratingModel(false);
            setModelGenerationProgress(100);
          } else if (status.status === "FAILED" || status.status === "EXPIRED") {
            setModelGenerationError(status.error || "3D generation failed — try a different image");
            setIsGeneratingModel(false);
          } else {
            // Still PENDING or IN_PROGRESS — poll again after 4 s
            pollTimerRef.current = setTimeout(poll, 4000);
          }
        } catch {
          // Network hiccup — retry after a longer delay
          pollTimerRef.current = setTimeout(poll, 8000);
        }
      };

      poll();
    } catch {
      setModelGenerationError("Network error — check your connection");
      setIsGeneratingModel(false);
    }
  }, [stopPolling]);

  const resetGeneratedModel = useCallback(() => {
    stopPolling();
    setGeneratedModelTaskId(null);
    setIsGeneratingModel(false);
    setModelGenerationProgress(0);
    setModelGenerationError(null);
  }, [stopPolling]);

  // Stop polling when the hook unmounts
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const copyShareLink = useCallback(async () => {
    const q = buildQueryString({ includeLogo: true });
    const full = `${window.location.origin}${window.location.pathname}?${q}`;
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      window.prompt("Copy this link:", full);
    }
  }, [buildQueryString]);

  // The proxy URL for the generated model (null = use the bundled static model)
  const generatedModelUrl = generatedModelTaskId
    ? `/api/meshy/model?taskId=${encodeURIComponent(generatedModelTaskId)}`
    : null;

  return {
    productName,
    color,
    setColor,
    logoDataUrl,
    setLogoDataUrl: setLogoDataUrlWithReset,
    decal,
    setDecal,
    displayUrl,
    setDisplayUrl,
    isLogoPlacementMode,
    setIsLogoPlacementMode,
    scrapedColors,
    scrapedImages,
    isLoadingProduct,
    productLoadError,
    loadProductFromUrl,
    // 3D generation
    generatedModelUrl,
    isGeneratingModel,
    modelGenerationProgress,
    modelGenerationError,
    generateModelFromImage,
    resetGeneratedModel,
    shareUrl,
    copyShareLink,
    buildQueryString,
  };
}
