"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_DECAL, type DecalConfig } from "@/types/configurator";

const DEFAULT_PRODUCT_NAME = "Customize product with your logo";

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

  const [productName, setProductName] = useState(DEFAULT_PRODUCT_NAME);

  const hydratedFromUrl = useRef(false);
  const hydratedFromShare = useRef(false);
  const [isHydratingFromShare, setIsHydratingFromShare] = useState(false);

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
    setIsHydratingFromShare(true);
    try {
      const res = await fetch(`/api/share?id=${encodeURIComponent(shareId)}`);
      const data: {
        payload?: {
          v: 1;
          productName: string;
          color: string;
          decal: DecalConfig;
          modelId?: string | null;
          logoDataUrl: string | null;
        };
        error?: string;
      } = await res.json();
      if (!res.ok || data.error || !data.payload) return;
      const p = data.payload;
      if (p.v !== 1) return;
      setProductName(p.productName || DEFAULT_PRODUCT_NAME);
      if (p.color) setColor(p.color);
      if (p.decal) setDecal(p.decal);
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
    return params.toString();
  }, [color, decal]);

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
          modelId: null,
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
  }, [buildShareHref, color, decal, logoDataUrl, productName]);

  return {
    productName,
    logoDataUrl,
    setLogoDataUrl: setLogoDataUrlWithReset,
    decal,
    setDecal,
    isLogoPlacementMode,
    setIsLogoPlacementMode,
    isHydratingFromShare,
    shareUrl,
    copyShareLink,
    buildQueryString,
    loadFromShareId,
  };
}

