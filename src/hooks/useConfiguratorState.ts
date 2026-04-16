"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DECAL, type DecalConfig } from "@/types/configurator";

const DEFAULT_PRODUCT_NAME = "Select a product";

export type LibraryItem = {
  id: string;
  name: string;
  /** Stable grouping key for presets (preferred over product_name). */
  product_key?: string | null;
  image_url: string | null;
};

export type LibraryProduct = {
  product_key?: string | null;
  product_name: string;
  preview_image_url: string | null;
  variants: Array<{
    id: string;
    label: string;
    image_url: string | null;
  }>;
};

function parseModelId(raw: string | null): string | null {
  if (raw == null || raw === "") return null;
  const id = raw.trim();
  if (id.length < 1 || id.length > 200) return null;
  if (!/^[a-zA-Z0-9_-]+$/.test(id)) return null;
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
  const [isLogoPlacementMode, setIsLogoPlacementMode] = useState(false);
  const [decalPreset, setDecalPreset] = useState<DecalConfig | null>(null);

  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);
  const [productKey, setProductKey] = useState<string | null>(null);

  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryProducts, setLibraryProducts] = useState<LibraryProduct[]>([]);
  const [isLoadingLibrary, setIsLoadingLibrary] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);

  const [selectedModelId, setSelectedModelId] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return parseModelId(new URLSearchParams(window.location.search).get("modelId"));
  });

  const hydratedFromUrl = useRef(false);
  const hydratedFromShare = useRef(false);
  const [isHydratingFromShare, setIsHydratingFromShare] = useState(false);

  const setLogoDataUrlWithReset = useCallback((url: string | null) => {
    setLogoDataUrl(url);
    if (!url) {
      setIsLogoPlacementMode(false);
      return;
    }
    // If we have a saved preset for the currently-selected model, use it.
    // Otherwise fall back to the default placement.
    setDecal(decalPreset ?? DEFAULT_DECAL);
  }, [decalPreset]);

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;

    const sp = new URLSearchParams(window.location.search);

    const c = parseColor(sp.get("c"));
    if (c) setColor(c);

    const mid = parseModelId(sp.get("modelId"));
    if (mid) setSelectedModelId(mid);

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const logo = hashParams.get("logo") ?? sp.get("logo");
    if (logo && logo.startsWith("data:image")) setLogoDataUrl(logo);
    if (hasDecalParams(sp)) setDecal(readDecalFromParams(sp));
  }, []);

  // Load preset for the selected model id (if any). If a logo is already present,
  // apply the preset immediately so switching products keeps auto-placement behavior.
  useEffect(() => {
    let cancelled = false;
    const modelId = selectedModelId;
    const pk = productKey;
    if (!modelId && !pk) {
      setDecalPreset(null);
      return;
    }

    const loadPreset = async () => {
      try {
        const params = new URLSearchParams();
        if (modelId) params.set("modelId", modelId);
        if (pk) params.set("productKey", pk);
        const res = await fetch(`/api/decal-presets?${params.toString()}`, {
          cache: "no-store",
        });
        const data: {
          decal?: DecalConfig | null;
          productKey?: string | null;
          error?: string;
        } = await res.json();
        if (!res.ok) throw new Error(data.error ?? "Failed to load decal preset");
        if (cancelled) return;
        // If we loaded via modelId, the API can resolve productKey for us.
        if (!pk && typeof data.productKey === "string" && data.productKey.trim()) {
          setProductKey(data.productKey.trim());
        }
        const preset = data.decal ?? null;
        setDecalPreset(preset);
        if (preset && logoDataUrl) setDecal(preset);
      } catch {
        if (cancelled) return;
        setDecalPreset(null);
      }
    };

    void loadPreset();
    return () => {
      cancelled = true;
    };
  }, [logoDataUrl, productKey, selectedModelId]);

  const loadFromShareId = useCallback(async (shareId: string) => {
    if (!shareId || hydratedFromShare.current) return;
    hydratedFromShare.current = true;
    setIsHydratingFromShare(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
      const data: {
        payload?: {
          v: 1;
          productName: string;
          color: string;
          decal: DecalConfig;
          modelId: string | null;
          logoDataUrl: string | null;
        };
        error?: string;
      } = await res.json();
      if (!res.ok || data.error || !data.payload) return;
      const p = data.payload;
      if (p.v !== 1) return;
      setProductName(p.productName || DEFAULT_PRODUCT_NAME);
      setProductKey(null);
      if (p.color) setColor(p.color);
      if (p.decal) setDecal(p.decal);
      setSelectedModelId(parseModelId(p.modelId));
      if (p.logoDataUrl && p.logoDataUrl.startsWith("data:image")) setLogoDataUrl(p.logoDataUrl);
    } catch {
      // ignore
    } finally {
      setIsHydratingFromShare(false);
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
    if (selectedModelId) params.set("modelId", selectedModelId);
    return params.toString();
  }, [color, decal, selectedModelId]);

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

  const modelUrl = selectedModelId
    ? `/api/library/model?id=${encodeURIComponent(selectedModelId)}`
    : null;

  const syncModelIdFromUrl = useCallback((rawModelId: string | null) => {
    setSelectedModelId(parseModelId(rawModelId));
  }, []);

  const searchLibrary = useCallback(async (q: string) => {
    setLibraryQuery(q);
    setIsLoadingLibrary(true);
    setLibraryError(null);
    try {
      const res = await fetch(`/api/library?q=${encodeURIComponent(q)}&pageSize=50`, {
        cache: "no-store",
      });
      const data: { products?: LibraryProduct[]; items?: LibraryItem[]; error?: string } =
        await res.json();
      if (!res.ok) {
        setLibraryError(data.error ?? "Failed to load library");
        setLibraryProducts([]);
        return;
      }

      if (Array.isArray(data.products)) {
        setLibraryProducts(data.products);
        return;
      }

      // Back-compat: flat list -> group by `name` (product_name) with each item as a single variant.
      if (Array.isArray(data.items)) {
        const byName = new Map<string, LibraryProduct>();
        for (const item of data.items) {
          const name = String(item.name ?? "").trim();
          if (!name) continue;
          const group =
            byName.get(name) ??
            (() => {
              const g: LibraryProduct = {
                product_name: name,
                preview_image_url: item.image_url ?? null,
                variants: [],
              };
              byName.set(name, g);
              return g;
            })();
          group.variants.push({
            id: item.id,
            label: "Variant",
            image_url: item.image_url ?? null,
          });
        }
        setLibraryProducts(Array.from(byName.values()));
        return;
      }

      setLibraryError(data.error ?? "Failed to load library");
      setLibraryProducts([]);
    } catch {
      setLibraryError("Failed to load library");
      setLibraryProducts([]);
    } finally {
      setIsLoadingLibrary(false);
    }
  }, []);

  const selectModel = useCallback((item: LibraryItem | null) => {
    if (!item) {
      setSelectedModelId(null);
      setProductName(DEFAULT_PRODUCT_NAME);
      setProductKey(null);
      return;
    }
    setSelectedModelId(item.id);
    setProductName(item.name || DEFAULT_PRODUCT_NAME);
    setProductKey(typeof item.product_key === "string" ? item.product_key : null);
  }, []);

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
          modelId: selectedModelId,
          logoDataUrl,
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
  }, [buildShareHref, color, decal, logoDataUrl, productName, selectedModelId]);

  return {
    productKey,
    productName,
    logoDataUrl,
    setLogoDataUrl: setLogoDataUrlWithReset,
    decal,
    setDecal,
    decalPreset,
    setDecalPreset,
    isLogoPlacementMode,
    setIsLogoPlacementMode,
    libraryQuery,
    libraryProducts,
    isLoadingLibrary,
    libraryError,
    searchLibrary,
    selectedModelId,
    selectModel,
    modelUrl,
    isHydratingFromShare,
    shareUrl,
    copyShareLink,
    buildQueryString,
    loadFromShareId,
    syncModelIdFromUrl,
  };
}

