"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  DEFAULT_DECAL,
  MAX_LOGOS,
  decalPresetForPlacement,
  type DecalConfig,
  type LogoLayer,
  type LogoPlacement,
} from "@/types/configurator";

const DEFAULT_PRODUCT_NAME = "Select a product";
const DEFAULT_LIBRARY_QUERY = "Paxton Sweatshirt";

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

function parseLabel(raw: string | null, maxLen = 140): string | null {
  if (raw == null) return null;
  const s = raw
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!s) return null;
  if (s.length > maxLen) return s.slice(0, maxLen).trim();
  return s;
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

export function useConfiguratorState(opts?: { disableInitialLibrarySearch?: boolean }) {
  const disableInitialLibrarySearch = Boolean(opts?.disableInitialLibrarySearch);
  const [color, setColor] = useState("#ffffff");
  const [logos, setLogos] = useState<LogoLayer[]>([]);
  const [activeLogoId, setActiveLogoId] = useState<string | null>(null);
  const [isLogoPlacementMode, setIsLogoPlacementMode] = useState(false);
  const [decalPreset, setDecalPreset] = useState<DecalConfig | null>(null);

  type DecalSource = "default" | "preset" | "url" | "share" | "user";
  // Tracks which system last set logo decals, so we can avoid overwriting explicit share/url/user placement.
  const decalSource = useRef<DecalSource>("default");

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
  const didAutoSelectFirstVariant = useRef(false);
  const lastLibraryFetchKey = useRef<string | null>(null);
  const lastPresetFetchKey = useRef<string | null>(null);
  const libraryFetchSeq = useRef(0);
  const activeLibraryFetchSeq = useRef(0);

  const makeLogoLayer = useCallback(
    (dataUrl: string, placement: LogoPlacement, opts?: { id?: string; baseDecal?: DecalConfig }) => {
      const id = (opts?.id ?? (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`)).toString();
      const base = opts?.baseDecal ?? decalPreset ?? DEFAULT_DECAL;
      const decal = decalPresetForPlacement(placement, base);
      const layer: LogoLayer = { id, dataUrl, placement, decal };
      return layer;
    },
    [decalPreset],
  );

  const addLogo = useCallback(
    (dataUrl: string, placement: LogoPlacement = "front") => {
      const layer = makeLogoLayer(dataUrl, placement);
      setLogos((prev) => {
        const next = prev.slice(0, MAX_LOGOS);
        if (next.length >= MAX_LOGOS) return next;
        return [...next, layer];
      });
      setActiveLogoId(layer.id);
    },
    [makeLogoLayer],
  );

  const upsertActiveLogo = useCallback(
    (dataUrl: string, placement: LogoPlacement = "front") => {
      // If we are adding a new logo, pre-generate the layer so we can set active synchronously.
      const newLayer = makeLogoLayer(dataUrl, placement);
      let didInsertNew = false;
      setLogos((prev) => {
        const next = prev.slice(0, MAX_LOGOS);
        const idx = activeLogoId ? next.findIndex((l) => l.id === activeLogoId) : -1;
        if (idx >= 0) {
          const current = next[idx]!;
          const base = current.decal;
          next[idx] = {
            ...current,
            dataUrl,
            // keep existing placement/decal; swapping image shouldn't move it
            decal: base,
          };
          return next;
        }
        if (next.length >= MAX_LOGOS) return next;
        didInsertNew = true;
        return [...next, newLayer];
      });
      if (didInsertNew) setActiveLogoId(newLayer.id);
    },
    [activeLogoId, makeLogoLayer],
  );

  const removeLogo = useCallback((id: string) => {
    setLogos((prev) => prev.filter((l) => l.id !== id));
    setIsLogoPlacementMode(false);
    setActiveLogoId((cur) => (cur === id ? null : cur));
  }, []);

  const setLogoPlacement = useCallback((id: string, placement: LogoPlacement) => {
    setLogos((prev) => prev.map((l) => {
      if (l.id !== id) return l;
      return {
        ...l,
        placement,
        decal: decalPresetForPlacement(placement, l.decal),
      };
    }));
  }, []);

  const setLogoDecal = useCallback((id: string, next: DecalConfig) => {
    decalSource.current = "user";
    setLogos((prev) => prev.map((l) => (l.id === id ? { ...l, decal: next } : l)));
  }, []);

  useEffect(() => {
    if (hydratedFromUrl.current) return;
    hydratedFromUrl.current = true;

    const sp = new URLSearchParams(window.location.search);

    const c = parseColor(sp.get("c"));
    if (c) setColor(c);

    const urlProductName = parseLabel(sp.get("productName"));
    if (urlProductName) setProductName(urlProductName);
    const urlProductKey = parseLabel(sp.get("productKey"), 200);
    if (urlProductKey) setProductKey(urlProductKey);

    const mid = parseModelId(sp.get("modelId"));
    if (mid) setSelectedModelId(mid);

    const hashParams = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    const logo = hashParams.get("logo") ?? sp.get("logo");
    const decalFromUrl = hasDecalParams(sp) ? readDecalFromParams(sp) : null;
    if (logo && logo.startsWith("data:image")) {
      const id =
        (typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random()}`).toString();
      const layer: LogoLayer = {
        id,
        dataUrl: logo,
        placement: "front",
        decal: decalFromUrl ?? DEFAULT_DECAL,
      };
      setLogos([layer]);
      setActiveLogoId(layer.id);
      if (decalFromUrl) decalSource.current = "url";
    } else if (decalFromUrl) {
      // If there is a decal in the URL but no logo, keep it as a future base preset.
      decalSource.current = "url";
      setDecalPreset(decalFromUrl);
    }
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

    // Derive a stable "color label" from the selected productName.
    // Expected format: "Product — Color". If not present, omit.
    const colorLabel = (() => {
      const raw = String(productName ?? "");
      const parts = raw.split("—");
      const right = (parts[1] ?? "").trim();
      return right ? right : null;
    })();

    // Dedupe: avoid calling the API repeatedly on initial hydration where
    // productName/productKey can change a few times.
    const fetchKey = `${modelId ?? ""}::${pk ?? ""}::${colorLabel ?? ""}`;
    if (lastPresetFetchKey.current === fetchKey) return;
    lastPresetFetchKey.current = fetchKey;

    const loadPreset = async () => {
      try {
        const params = new URLSearchParams();
        if (modelId) params.set("modelId", modelId);
        if (pk) params.set("productKey", pk);
        if (colorLabel) params.set("colorLabel", colorLabel);
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
        // Only auto-apply presets when the logo decals haven't been explicitly set via
        // share link / URL params / user interaction. Apply only to logos that still
        // look like the default/preset (i.e. not user-moved).
        if (!preset) return;
        if (decalSource.current !== "default" && decalSource.current !== "preset") return;
        setLogos((prev) => {
          if (prev.length === 0) return prev;
          // Apply to all logos but keep placement intent (front/back/sleeves).
          return prev.map((l) => ({
            ...l,
            decal: decalPresetForPlacement(l.placement, preset),
          }));
        });
        decalSource.current = "preset";
      } catch {
        if (cancelled) return;
        setDecalPreset(null);
      }
    };

    void loadPreset();
    return () => {
      cancelled = true;
    };
  }, [productKey, productName, selectedModelId]);

  const loadFromShareId = useCallback(async (shareId: string) => {
    if (!shareId || hydratedFromShare.current) return;
    hydratedFromShare.current = true;
    setIsHydratingFromShare(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
      const data: {
        payload?: {
          v: 1 | 2;
          productName: string;
          color: string;
          modelId: string | null;
          // v1
          decal?: DecalConfig;
          logoDataUrl?: string | null;
          // v2
          logos?: LogoLayer[];
        };
        error?: string;
      } = await res.json();
      if (!res.ok || data.error || !data.payload) return;
      const p = data.payload;
      if (p.v !== 1 && p.v !== 2) return;
      setProductName(p.productName || DEFAULT_PRODUCT_NAME);
      setProductKey(null);
      if (p.color) setColor(p.color);
      setSelectedModelId(parseModelId(p.modelId));
      if (p.v === 2 && Array.isArray(p.logos) && p.logos.length) {
        decalSource.current = "share";
        const next = p.logos.slice(0, MAX_LOGOS).filter((l) => typeof l?.dataUrl === "string" && l.dataUrl.startsWith("data:image"));
        setLogos(next);
        setActiveLogoId(next[0]?.id ?? null);
        return;
      }
      // v1 fallback
      if (p.logoDataUrl && p.logoDataUrl.startsWith("data:image")) {
        const base = p.decal ?? DEFAULT_DECAL;
        decalSource.current = "share";
        const layer = makeLogoLayer(p.logoDataUrl, "front", { baseDecal: base });
        setLogos([layer]);
        setActiveLogoId(layer.id);
      }
    } catch {
      // ignore
    } finally {
      setIsHydratingFromShare(false);
    }
  }, [makeLogoLayer]);

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    params.set("c", color.replace("#", ""));
    // Encode the active logo's decal (best-effort URL compat).
    const active = activeLogoId ? logos.find((l) => l.id === activeLogoId) : logos[0];
    const decal = active?.decal ?? DEFAULT_DECAL;
    params.set("dx", String(decal.position[0]));
    params.set("dy", String(decal.position[1]));
    params.set("dz", String(decal.position[2]));
    params.set("ds", String(decal.scale));
    params.set("rx", String(decal.rotation[0]));
    params.set("ry", String(decal.rotation[1]));
    params.set("rz", String(decal.rotation[2]));
    if (selectedModelId) params.set("modelId", selectedModelId);
    return params.toString();
  }, [activeLogoId, color, logos, selectedModelId]);

  const buildShareHref = useCallback(() => {
    const q = buildQueryString();
    const href = `${window.location.origin}${window.location.pathname}?${q}`;
    // IMPORTANT: do NOT embed logo data URLs into the link. These URLs are often
    // extremely large and can cause clipboard writes to fail (falling back to a prompt).
    // Sharing is handled via /api/share which returns a short /s/[id] link.
    return href;
  }, [buildQueryString]);

  const modelUrl = selectedModelId
    ? `/api/library/model?id=${encodeURIComponent(selectedModelId)}`
    : null;

  const fetchLibrary = useCallback(async (q: string, opts?: { setQuery?: boolean }) => {
    const fetchSeq = ++libraryFetchSeq.current;
    activeLibraryFetchSeq.current = fetchSeq;
    if (opts?.setQuery !== false) setLibraryQuery(q);
    setIsLoadingLibrary(true);
    setLibraryError(null);
    try {
      const res = await fetch(`/api/library?q=${encodeURIComponent(q)}&pageSize=50`, {
        cache: "no-store",
      });
      const data: { products?: LibraryProduct[]; items?: LibraryItem[]; error?: string } =
        await res.json();
      if (activeLibraryFetchSeq.current !== fetchSeq) return;
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
      if (activeLibraryFetchSeq.current !== fetchSeq) return;
      setLibraryError("Failed to load library");
      setLibraryProducts([]);
    } finally {
      if (activeLibraryFetchSeq.current === fetchSeq) setIsLoadingLibrary(false);
    }
  }, []);

  const syncFromUrlParams = useCallback(
    (params: { modelId: string | null; productName?: string | null; productKey?: string | null }) => {
      const urlProductName = parseLabel(params.productName ?? null);
      if (urlProductName) setProductName(urlProductName);
      const urlProductKey = parseLabel(params.productKey ?? null, 200);
      if (urlProductKey) setProductKey(urlProductKey);

      const mid = parseModelId(params.modelId);
      setSelectedModelId(mid);

      const baseName = (() => {
        const raw = urlProductName || "";
        const parts = raw.split("—");
        const left = (parts[0] ?? "").trim();
        return left && left !== DEFAULT_PRODUCT_NAME ? left : null;
      })();
      const query = baseName ?? (urlProductKey && urlProductKey.trim() ? urlProductKey.trim() : null);
      if (!query) {
        if (lastLibraryFetchKey.current === DEFAULT_LIBRARY_QUERY) return;
        lastLibraryFetchKey.current = DEFAULT_LIBRARY_QUERY;
        void fetchLibrary(DEFAULT_LIBRARY_QUERY, { setQuery: false });
        return;
      }
      if (lastLibraryFetchKey.current === query) return;
      lastLibraryFetchKey.current = query;

      // Keep the search field intact; just ensure variants/colors match the URL product.
      void fetchLibrary(query, { setQuery: false });
    },
    [fetchLibrary],
  );

  const searchLibrary = useCallback(async (q: string) => {
    // Reset the URL-driven fetch key so that if the user later navigates back
    // to a URL product, syncFromUrlParams can re-fetch without being blocked
    // by the stale dedup key.
    lastLibraryFetchKey.current = q;
    await fetchLibrary(q, { setQuery: true });
  }, [fetchLibrary]);

  // When arriving from "All Products" (or any deep link) we already have
  // `modelId` + `productName/productKey` in the URL. In that case, we should
  // fetch the library for that product so the sidebar shows the correct
  // variant/color options (instead of whatever defaults were last searched).
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (disableInitialLibrarySearch) return;
    if (isHydratingFromShare) return;
    if (!selectedModelId) return;

    const baseName = (() => {
      const raw = productName || "";
      const parts = raw.split("—");
      const left = (parts[0] ?? "").trim();
      return left && left !== DEFAULT_PRODUCT_NAME ? left : null;
    })();

    const query =
      baseName ??
      ((typeof productKey === "string" && productKey.trim() ? productKey.trim() : null));

    if (!query) return;
    if (lastLibraryFetchKey.current === query) return;
    // If the user has typed a different search query, don't silently overwrite
    // their results — wait until they clear the search or the URL product matches.
    if (libraryQuery && libraryQuery !== query) return;
    lastLibraryFetchKey.current = query;

    // Populate `libraryProducts` without overwriting the search field.
    void fetchLibrary(query, { setQuery: false });
  }, [disableInitialLibrarySearch, fetchLibrary, isHydratingFromShare, libraryQuery, productKey, productName, selectedModelId]);

  // Auto-select the first returned variant so the GLB loads by default.
  useEffect(() => {
    if (didAutoSelectFirstVariant.current) return;
    if (isHydratingFromShare) return;
    if (selectedModelId) return;
    const firstProduct = libraryProducts[0];
    const firstVariant = firstProduct?.variants?.[0];
    if (!firstProduct || !firstVariant) return;

    didAutoSelectFirstVariant.current = true;
    setSelectedModelId(firstVariant.id);
    setProductName(`${firstProduct.product_name} — ${firstVariant.label}` || DEFAULT_PRODUCT_NAME);
    const pk =
      (typeof firstProduct.product_key === "string" ? firstProduct.product_key : null) ??
      firstProduct.product_name;
    setProductKey(pk ? pk : null);
  }, [isHydratingFromShare, libraryProducts, selectedModelId]);

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

  const copyShareLink = useCallback(async (): Promise<{ ok: boolean; href: string }> => {
    let href = buildShareHref();
    try {
      const res = await fetch("/api/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          v: 2,
          productName,
          color,
          modelId: selectedModelId,
          logos,
        }),
      });
      const data: { id?: string; error?: string } = await res.json();
      if (res.ok && data.id) href = `${window.location.origin}/s/${data.id}`;
    } catch {
      // fallback to non-share URL
    }

    try {
      await navigator.clipboard.writeText(href);
      return { ok: true, href };
    } catch {
      // No browser modal fallback — the UI can show an error instead.
      return { ok: false, href };
    }
  }, [buildShareHref, color, logos, productName, selectedModelId]);

  return {
    productKey,
    productName,
    logos,
    activeLogoId,
    setActiveLogoId,
    addLogo,
    upsertActiveLogo,
    removeLogo,
    setLogoPlacement,
    setLogoDecal,
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
    copyShareLink,
    buildQueryString,
    loadFromShareId,
    syncModelIdFromUrl: syncFromUrlParams,
  };
}

