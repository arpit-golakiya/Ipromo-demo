"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  DEFAULT_DECAL,
  type DecalConfig,
} from "@/types/configurator";
import type { ScrapedProduct } from "@/app/api/scrape/route";
import type { MeshyTaskStatus } from "@/app/api/meshy/status/route";

const DEFAULT_PRODUCT_NAME = "Custom Hoodie";

/** Accept only share-safe Meshy task ids (keeps URLs predictable and small). */
function parseShareTaskId(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const id = raw.trim();
  if (id.length < 8 || id.length > 200) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return null;
  return id;
}

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

/** Central configurator state; we hydrate once from `window.location` to avoid Next remounts that can break WebGL. */
export function useConfiguratorState() {
  const [color, setColor] = useState("#4a6fa5");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [decal, setDecal] = useState<DecalConfig>(DEFAULT_DECAL);
  const [displayUrl, setDisplayUrl] = useState("");
  const [isLogoPlacementMode, setIsLogoPlacementMode] = useState(false);

  // Scraped PDP metadata (optional; used to seed color/images).
  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);
  const [scrapedColors, setScrapedColors] = useState<ScrapedProduct["colors"]>([]);
  /** True after a successful `/api/scrape` load (even if the PDP lists no colors). */
  const [productLoadedFromScrape, setProductLoadedFromScrape] = useState(false);
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [productLoadError, setProductLoadError] = useState<string | null>(null);

  // 3D generation state (taskId can be restored from share links on first mount).
  const [generatedModelTaskId, setGeneratedModelTaskId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return parseShareTaskId(new URLSearchParams(window.location.search).get("taskId"));
  });
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [modelGenerationProgress, setModelGenerationProgress] = useState(0);
  const [modelGenerationError, setModelGenerationError] = useState<string | null>(null);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hydratedFromUrl = useRef(false);
  const hydratedFromShare = useRef(false);

  const setLogoDataUrlWithReset = useCallback(
    (url: string | null) => {
      setLogoDataUrl(url);
      if (!url) {
        setIsLogoPlacementMode(false);
        return;
      }
      // Always start new uploads at the default placement.
      setDecal(DEFAULT_DECAL);
    },
    [],
  );

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const sp = new URLSearchParams(window.location.search);
    const c = parseColor(sp.get("c"));
    if (c) setColor(c);
    const hashParams = new URLSearchParams(
      window.location.hash.replace(/^#/, ""),
    );
    const logo =
      hashParams.get("logo") ?? sp.get("logo");
    if (logo && logo.startsWith("data:image")) {
      setLogoDataUrl(logo); // Direct setter on initial hydrate (don’t toggle placement mode here).
    }
    if (hasDecalParams(sp)) {
      setDecal(readDecalFromParams(sp));
    }
  }, []);

  const loadFromShareId = useCallback(async (shareId: string) => {
    if (!shareId || hydratedFromShare.current) return;
    hydratedFromShare.current = true;
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
      const data: {
        payload?: {
          v: 1;
          productName: string;
          color: string;
          decal: DecalConfig;
          taskId: string | null;
          logoDataUrl: string | null;
        };
        logo_url?: string | null;
        error?: string;
      } = await res.json();

      if (!res.ok || data.error || !data.payload) return;

      const p = data.payload;
      if (p.v !== 1) return;
      setProductName(p.productName || DEFAULT_PRODUCT_NAME);
      if (p.color) setColor(p.color);
      if (p.decal) setDecal(p.decal);
      setGeneratedModelTaskId(parseShareTaskId(p.taskId));
      if (p.logoDataUrl && p.logoDataUrl.startsWith("data:image")) {
        setLogoDataUrl(p.logoDataUrl);
      } else {
        setLogoDataUrl(null);
      }
    } catch {
      // ignore — user can still use the app without share hydration
    }
  }, []);

  /** Query only — logo is never appended here (see share URL hash) so GET requests stay small. */
  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("c", color.replace("#", ""));
    params.set("dx", String(decal.position[0]));
    params.set("dy", String(decal.position[1]));
    params.set("dz", String(decal.position[2]));
    params.set("ds", String(decal.scale));
    params.set("rx", String(decal.rotation[0]));
    params.set("ry", String(decal.rotation[1]));
    params.set("rz", String(decal.rotation[2]));
    if (generatedModelTaskId) {
      params.set("taskId", generatedModelTaskId);
    }
    return params.toString();
  }, [color, decal, generatedModelTaskId]);

  const buildShareHref = useCallback(() => {
    const q = buildQueryString();
    let href = `${window.location.origin}${window.location.pathname}?${q}`;
    if (logoDataUrl) {
      const hash = new URLSearchParams({ logo: logoDataUrl }).toString();
      href += `#${hash}`;
    }
    return href;
  }, [buildQueryString, logoDataUrl]);

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return buildShareHref();
  }, [buildShareHref]);

  const loadProductFromUrl = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setIsLoadingProduct(true);
    setProductLoadError(null);
    // Loading a new PDP invalidates any previously generated model.
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
      setProductLoadedFromScrape(true);
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
            // Still running — poll again after 4s.
            pollTimerRef.current = setTimeout(poll, 4000);
          }
        } catch {
          // Transient network hiccup — retry with backoff.
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

  // Always stop polling on unmount.
  useEffect(() => {
    return () => stopPolling();
  }, [stopPolling]);

  const copyShareLink = useCallback(async () => {
    // Prefer a short URL backed by Supabase. If anything fails, fall back to the long URL.
    let full = buildShareHref();
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          v: 1,
          productName,
          color,
          decal,
          taskId: generatedModelTaskId,
          logoDataUrl,
        }),
      });
      const data: { id?: string; error?: string } = await res.json();
      if (res.ok && data.id) {
        full = `${window.location.origin}/s/${data.id}`;
      }
    } catch {
      /* keep fallback */
    }
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      window.prompt("Copy this link:", full);
    }
  }, [buildShareHref, color, decal, generatedModelTaskId, logoDataUrl, productName]);

  // Proxy URL for the generated model (null => fall back to bundled GLB).
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
    productLoadedFromScrape,
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
    loadFromShareId,
  };
}