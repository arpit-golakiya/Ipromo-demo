"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DECAL, type DecalConfig } from "@/types/configurator";
import type { ScrapedProduct } from "@/app/api/scrape/route";
import type { Hyper3dTaskStatus } from "@/lib/hyper3d";

const DEFAULT_PRODUCT_NAME = "Custom Hoodie";

type GenerateBatchItemInput = {
  key: string;
  /** Primary thumbnail / first view */
  imageUrl: string;
  /** Up to 5 views for one Rodin job (optional; defaults to `[imageUrl]`). */
  imageUrls?: string[];
  colorLabel?: string;
  colorHex?: string;
};

type GeneratedColorModel = {
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
};

function parseShareTaskId(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const id = raw.trim();
  if (id.length < 8 || id.length > 4096) return null;
  if (!/^[a-zA-Z0-9_.-]+$/.test(id)) return null;
  return id;
}

function parseColor(param: string | null): string | null {
  if (!param) return null;
  const hex = param.startsWith("#") ? param : `#${param}`;
  if (/^#[0-9A-Fa-f]{6}$/.test(hex)) return hex;
  return null;
}

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

export function useConfiguratorState() {
  const [color, setColor] = useState("#ffffff");
  const [logoDataUrl, setLogoDataUrl] = useState<string | null>(null);
  const [decal, setDecal] = useState<DecalConfig>(DEFAULT_DECAL);
  const [displayUrl, setDisplayUrl] = useState("");
  const [isLogoPlacementMode, setIsLogoPlacementMode] = useState(false);

  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);
  const [scrapedColors, setScrapedColors] = useState<ScrapedProduct["colors"]>([]);
  const [productLoadedFromScrape, setProductLoadedFromScrape] = useState(false);
  const [scrapedImages, setScrapedImages] = useState<string[]>([]);
  const [isLoadingProduct, setIsLoadingProduct] = useState(false);
  const [productLoadError, setProductLoadError] = useState<string | null>(null);
  const [loadedProductUrl, setLoadedProductUrl] = useState<string | null>(null);

  const [generatedModelTaskId, setGeneratedModelTaskId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return parseShareTaskId(new URLSearchParams(window.location.search).get("taskId"));
  });
  const [generatedColorModels, setGeneratedColorModels] = useState<GeneratedColorModel[]>([]);
  const [selectedModelKey, setSelectedModelKey] = useState<string | null>(null);
  const [isGeneratingModel, setIsGeneratingModel] = useState(false);
  const [modelGenerationProgress, setModelGenerationProgress] = useState(0);
  const [modelGenerationError, setModelGenerationError] = useState<string | null>(null);
  const [isStoringPreloaded, setIsStoringPreloaded] = useState(false);
  const [storePreloadedError, setStorePreloadedError] = useState<string | null>(null);

  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hydratedFromUrl = useRef(false);
  const hydratedFromShare = useRef(false);
  const promptedStoreTokenRef = useRef<string | null>(null);

  const setLogoDataUrlWithReset = useCallback((url: string | null) => {
    setLogoDataUrl(url);
    if (!url) {
      setIsLogoPlacementMode(false);
      return;
    }
    setDecal(DEFAULT_DECAL);
  }, []);

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;
    const sp = new URLSearchParams(window.location.search);
    const c = parseColor(sp.get("c"));
    if (c) setColor(c);
    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const logo = hashParams.get("logo") ?? sp.get("logo");
    if (logo && logo.startsWith("data:image")) setLogoDataUrl(logo);
    if (hasDecalParams(sp)) setDecal(readDecalFromParams(sp));
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
          scrapedColors?: ScrapedProduct["colors"];
        };
        error?: string;
      } = await res.json();
      if (!res.ok || data.error || !data.payload) return;
      const p = data.payload;
      if (p.v !== 1) return;
      setProductName(p.productName || DEFAULT_PRODUCT_NAME);
      if (p.scrapedColors && p.scrapedColors.length > 0) setScrapedColors(p.scrapedColors);
      if (p.color) setColor(p.color);
      if (p.decal) setDecal(p.decal);
      setGeneratedModelTaskId(parseShareTaskId(p.taskId));
      if (p.logoDataUrl && p.logoDataUrl.startsWith("data:image")) setLogoDataUrl(p.logoDataUrl);
    } catch {
      // ignore
    }
  }, []);

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
    if (generatedModelTaskId) params.set("taskId", generatedModelTaskId);
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

  const stopPolling = useCallback(() => {
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadPreloadedModels = useCallback(async (productUrl: string, images: string[]) => {
    try {
      const res = await fetch(`/api/hyper3d/preloaded?productUrl=${encodeURIComponent(productUrl)}`);
      const data: {
        items?: Array<{
          color_key: string;
          color_label: string | null;
          color_hex: string | null;
          image_url: string;
          task_id: string | null;
        }>;
      } = await res.json();
      if (!res.ok || !Array.isArray(data.items)) return;
      const byImage = new Map(
        (data.items ?? [])
          .filter((item) => item.task_id && images.includes(item.image_url))
          .map((item) => [item.image_url, item]),
      );
      if (byImage.size === 0) return;
      const models: GeneratedColorModel[] = [];
      for (let idx = 0; idx < images.length; idx += 1) {
        const imageUrl = images[idx];
        const item = byImage.get(imageUrl);
        if (!item || !item.task_id) continue;
        models.push({
          key: item.color_key || `img-${idx + 1}`,
          imageUrl,
          colorLabel: item.color_label ?? undefined,
          colorHex: item.color_hex ?? undefined,
          taskId: item.task_id,
          status: "SUCCEEDED",
          progress: 100,
          error: null,
          fromPreload: true,
        });
      }
      if (models.length > 0) {
        setGeneratedColorModels(models);
        setSelectedModelKey((prev) => prev ?? models[0].key);
      }
    } catch {
      // optional path
    }
  }, []);

  const loadProductFromUrl = useCallback(async (url: string) => {
    if (!url.trim()) return;
    setIsLoadingProduct(true);
    setProductLoadError(null);
    stopPolling();
    setGeneratedModelTaskId(null);
    setGeneratedColorModels([]);
    setSelectedModelKey(null);
    promptedStoreTokenRef.current = null;
    setIsGeneratingModel(false);
    setModelGenerationProgress(0);
    setModelGenerationError(null);
    setStorePreloadedError(null);
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
      setLoadedProductUrl(url);
      await loadPreloadedModels(url, data.images ?? []);
    } catch {
      setProductLoadError("Network error — check your connection");
    } finally {
      setIsLoadingProduct(false);
    }
  }, [loadPreloadedModels, stopPolling]);

  const loadProductFromUploads = useCallback(
    async (imageUrls: string[], productUrl?: string) => {
      const cleanImages = [...new Set(imageUrls.map((u) => u.trim()).filter(Boolean))].slice(0, 40);
      if (cleanImages.length === 0) return;
      stopPolling();
      setGeneratedModelTaskId(null);
      setGeneratedColorModels([]);
      setSelectedModelKey(null);
      promptedStoreTokenRef.current = null;
      setIsGeneratingModel(false);
      setModelGenerationProgress(0);
      setModelGenerationError(null);
      setStorePreloadedError(null);
      setProductLoadError(null);
      setIsLoadingProduct(false);
      setProductLoadedFromScrape(false);
      setScrapedColors([]);
      setScrapedImages(cleanImages);

      const trimmedProductUrl = (productUrl ?? "").trim();
      setLoadedProductUrl(trimmedProductUrl || null);
      if (trimmedProductUrl) {
        setDisplayUrl(trimmedProductUrl);
      }
      setProductName("Uploaded Product");
    },
    [stopPolling],
  );

  const pollBatchStatuses = useCallback(async (items: GeneratedColorModel[]) => {
    const taskItems = items
      .filter((i) => i.taskId)
      .map((i) => ({ key: i.key, taskId: i.taskId as string }));

    if (taskItems.length === 0) {
      setIsGeneratingModel(false);
      return;
    }

    const poll = async () => {
      try {
        const statusRes = await fetch("/api/hyper3d/batch-status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ items: taskItems }),
        });
        const payload: {
          items?: Array<
            {
              key: string;
              taskId: string;
            } & Hyper3dTaskStatus
          >;
          error?: string;
        } = await statusRes.json();

        if (!statusRes.ok || !payload.items) {
          setModelGenerationError(payload.error ?? "Batch status check failed");
          setIsGeneratingModel(false);
          return;
        }

        const byKey = new Map(payload.items.map((i) => [i.key, i]));
        setGeneratedColorModels((prev) =>
          prev.map((item) => {
            const status = byKey.get(item.key);
            if (!status) return item;
            return {
              ...item,
              status: status.status,
              progress: status.progress ?? 0,
              error: status.error,
            };
          }),
        );

        const terminalCount = payload.items.filter(
          (i) => i.status === "SUCCEEDED" || i.status === "FAILED" || i.status === "EXPIRED",
        ).length;
        const avgProgress =
          payload.items.length === 0
            ? 0
            : Math.round(
                payload.items.reduce((sum, item) => sum + (item.progress ?? 0), 0) / payload.items.length,
              );
        setModelGenerationProgress(avgProgress);

        if (terminalCount === payload.items.length) {
          setIsGeneratingModel(false);
          setModelGenerationProgress(100);
          setGeneratedColorModels((prev) => {
            const succeeded = prev.find((m) => m.status === "SUCCEEDED");
            if (succeeded) setSelectedModelKey((curr) => curr ?? succeeded.key);
            return prev;
          });
          return;
        }

        pollTimerRef.current = setTimeout(poll, 4000);
      } catch {
        pollTimerRef.current = setTimeout(poll, 8000);
      }
    };

    poll();
  }, []);

  const storeGeneratedModels = useCallback(async () => {
    if (!loadedProductUrl) return;
    const successful = generatedColorModels.filter((m) => m.taskId && m.status === "SUCCEEDED");
    if (successful.length === 0) return;
    setIsStoringPreloaded(true);
    setStorePreloadedError(null);
    try {
      const res = await fetch("/api/hyper3d/batch-store", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          productUrl: loadedProductUrl,
          items: successful.map((m) => ({
            key: m.key,
            colorLabel: m.colorLabel,
            colorHex: m.colorHex,
            imageUrl: m.imageUrl,
            taskId: m.taskId,
          })),
        }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok || data.error) {
        setStorePreloadedError(data.error ?? "Failed to store generated models");
      }
    } catch {
      setStorePreloadedError("Failed to store generated models");
    } finally {
      setIsStoringPreloaded(false);
    }
  }, [generatedColorModels, loadedProductUrl]);

  const generateModelsBatch = useCallback(
    async (items: GenerateBatchItemInput[], options?: { removeLogosFor3D?: boolean }) => {
      if (items.length === 0) return;
      stopPolling();
      setModelGenerationError(null);
      setModelGenerationProgress(0);
      setIsGeneratingModel(true);
      setStorePreloadedError(null);
      setGeneratedModelTaskId(null);

      const initial: GeneratedColorModel[] = items.map((item) => ({
        key: item.key,
        imageUrl: item.imageUrl,
        imageUrls: item.imageUrls?.length ? item.imageUrls : undefined,
        colorLabel: item.colorLabel,
        colorHex: item.colorHex,
        taskId: null,
        status: "QUEUED",
        progress: 0,
        error: null,
      }));
      setGeneratedColorModels(initial);
      setSelectedModelKey(null);
      promptedStoreTokenRef.current = null;

      try {
        const res = await fetch("/api/hyper3d/batch-generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            items: items.map((it) => ({
              key: it.key,
              imageUrl: it.imageUrl,
              ...(it.imageUrls && it.imageUrls.length > 0 ? { imageUrls: it.imageUrls } : {}),
              colorLabel: it.colorLabel,
              colorHex: it.colorHex,
            })),
            removeLogosFor3D: options?.removeLogosFor3D === true,
          }),
        });
        const data: {
          items?: Array<{
            key: string;
            imageUrl: string;
            imageUrls?: string[];
            colorLabel?: string;
            colorHex?: string;
            taskId: string | null;
            error: string | null;
          }>;
          error?: string;
        } = await res.json();
        if (!res.ok || !data.items) {
          setModelGenerationError(data.error ?? "Failed to start 3D generation batch");
          setIsGeneratingModel(false);
          return;
        }

        const started = data.items.map((item) => ({
          key: item.key,
          imageUrl: item.imageUrl,
          imageUrls: item.imageUrls?.length ? item.imageUrls : undefined,
          colorLabel: item.colorLabel,
          colorHex: item.colorHex,
          taskId: item.taskId,
          status: item.taskId ? ("PENDING" as const) : ("FAILED" as const),
          progress: 0,
          error: item.error,
        }));
        setGeneratedColorModels(started);

        const hasTask = started.some((i) => i.taskId);
        if (!hasTask) {
          const details = started
            .map((i) => i.error)
            .filter((v): v is string => Boolean(v))
            .slice(0, 3)
            .join(" | ");
          setIsGeneratingModel(false);
          setModelGenerationError(
            details
              ? `Could not start model generation: ${details}`
              : "Could not start model generation for selected colors",
          );
          return;
        }

        await pollBatchStatuses(started);
      } catch {
        setModelGenerationError("Network error — check your connection");
        setIsGeneratingModel(false);
      }
    },
    [pollBatchStatuses, stopPolling],
  );

  const generateModelFromImage = useCallback(
    async (imageUrl: string, options?: { removeLogosFor3D?: boolean; imageUrls?: string[] }) => {
      const urls =
        options?.imageUrls && options.imageUrls.length > 0
          ? options.imageUrls.slice(0, 5)
          : [imageUrl];
      const one: GenerateBatchItemInput[] = [
        {
          key: "single",
          imageUrl: urls[0],
          imageUrls: urls.length > 1 ? urls : undefined,
          colorLabel: "Selected variant",
        },
      ];
      await generateModelsBatch(one, options);
    },
    [generateModelsBatch],
  );

  useEffect(() => () => stopPolling(), [stopPolling]);

  useEffect(() => {
    if (isGeneratingModel) return;
    const successful = generatedColorModels.filter((m) => m.status === "SUCCEEDED");
    if (successful.length === 0) return;
    if (!loadedProductUrl) return;
    const hasFresh = successful.some((m) => !m.fromPreload);
    if (!hasFresh) return;
    const token = successful
      .map((m) => m.taskId ?? "")
      .sort()
      .join("|");
    if (!token || promptedStoreTokenRef.current === token) return;
    promptedStoreTokenRef.current = token;

    // const shouldStore = window.confirm(
    //   `Generated ${successful.length} model(s). Do you want to store these for this product and preload next time?`,
    // );
    // if (shouldStore) {
    //   void storeGeneratedModels();
    // }
    // Auto-save generated models once a completed batch is detected.
    void storeGeneratedModels();
  }, [generatedColorModels, isGeneratingModel, loadedProductUrl, storeGeneratedModels]);

  const syncTaskIdFromUrl = useCallback((rawTaskId: string | null) => {
    const parsed = parseShareTaskId(rawTaskId);
    setGeneratedModelTaskId((prev) => (prev === parsed ? prev : parsed));
    if (!parsed) {
      setSelectedModelKey(null);
      setGeneratedColorModels([]);
    }
  }, []);

  const activeModelTaskId = useMemo(() => {
    const selected = selectedModelKey
      ? generatedColorModels.find((m) => m.key === selectedModelKey)
      : null;
    if (selected?.taskId) return selected.taskId;
    const firstSucceeded = generatedColorModels.find((m) => m.status === "SUCCEEDED" && m.taskId);
    if (firstSucceeded?.taskId) return firstSucceeded.taskId;
    return generatedModelTaskId;
  }, [generatedColorModels, generatedModelTaskId, selectedModelKey]);

  const generatedModelUrl = activeModelTaskId
    ? `/api/hyper3d/model?taskId=${encodeURIComponent(activeModelTaskId)}`
    : null;

  const copyShareLink = useCallback(async () => {
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
          // Share the currently selected/active model so receiver sees same color variant.
          taskId: activeModelTaskId,
          logoDataUrl,
          ...(scrapedColors.length > 0 ? { scrapedColors } : {}),
        }),
      });
      const data: { id?: string; error?: string } = await res.json();
      if (res.ok && data.id) full = `${window.location.origin}/s/${data.id}`;
    } catch {
      // fallback
    }
    try {
      await navigator.clipboard.writeText(full);
    } catch {
      window.prompt("Copy this link:", full);
    }
  }, [activeModelTaskId, buildShareHref, color, decal, logoDataUrl, productName, scrapedColors]);

  return {
    productName,
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
    loadProductFromUploads,
    generatedColorModels,
    selectedModelKey,
    setSelectedModelKey,
    isStoringPreloaded,
    storePreloadedError,
    storeGeneratedModels,
    generatedModelUrl,
    isGeneratingModel,
    modelGenerationProgress,
    modelGenerationError,
    generateModelFromImage,
    generateModelsBatch,
    resetGeneratedModel: () => {
      stopPolling();
      setGeneratedModelTaskId(null);
      setGeneratedColorModels([]);
      setSelectedModelKey(null);
      promptedStoreTokenRef.current = null;
      setIsGeneratingModel(false);
      setModelGenerationProgress(0);
      setModelGenerationError(null);
      setStorePreloadedError(null);
    },
    shareUrl,
    copyShareLink,
    buildQueryString,
    loadFromShareId,
    syncTaskIdFromUrl,
  };
}

