"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { ControlsPanel } from "@/components/ControlsPanel";
import { useConfiguratorState } from "@/hooks/useConfiguratorState";
import type { DecalConfig } from "@/types/configurator";

const ModelViewer = dynamic(
  () =>
    import("@/components/ModelViewer").then((m) => ({
      default: m.ModelViewer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-full min-h-[280px] w-full items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-sm text-zinc-500 max-md:min-h-[min(52dvh,580px)] md:min-h-[420px]">
        Loading 3D viewer…
      </div>
    ),
  },
);

const CAPTURE_ID = "configurator-viewer";

/**
 * Wires panel + 3D viewer. Shareable state lives in the copied link (see ControlsPanel);
 * we intentionally do not call `history.replaceState` here — that desyncs Next's router
 * from the URL and can remount client trees, which tears down WebGL and shows a white canvas.
 */
export default function Configurator({ shareId }: { shareId?: string }) {
  const isSharedView = Boolean(shareId);
  const [modelUrl, setModelUrl] = useState<string | null>(null);
  const [variants, setVariants] = useState<
    Array<{
      id?: string;
      colorKey?: string;
      colorLabel: string;
      colorHex?: string | null;
      imageUrl?: string | null;
      glbUrl: string;
    }>
  >([]);
  const [isLoadingModel, setIsLoadingModel] = useState(true);
  const {
    productName,
    setProductName,
    color,
    setColor,
    logoDataUrl,
    setLogoDataUrl,
    decal,
    setDecal,
    isLogoPlacementMode,
    setIsLogoPlacementMode,
    selectedVariantGlbUrl,
    setSelectedVariantGlbUrl,
    shareUrl,
    copyShareLink,
    loadFromShareId,
  } = useConfiguratorState();

  // If this page is /s/[id], hydrate state from Supabase once.
  // (This runs client-side and doesn’t force Next router URL mutations.)
  useEffect(() => {
    if (!shareId) return;
    void loadFromShareId(shareId);
  }, [loadFromShareId, shareId]);

  // Load the active 3D model from Supabase (`one_model_data`).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/model", { method: "GET" });
        const data = (await res.json().catch(() => ({}))) as {
          modelUrl?: string;
          productName?: string | null;
          variants?: Array<{
            id?: string;
            colorKey?: string;
            colorLabel: string;
            colorHex?: string | null;
            imageUrl?: string | null;
            glbUrl: string;
          }>;
        };
        if (cancelled || !res.ok) return;

        if (!isSharedView && typeof data.productName === "string" && data.productName.trim()) {
          setProductName(data.productName.trim());
        }

        const nextVariants = Array.isArray(data.variants) ? data.variants : [];
        if (nextVariants.length) {
          setVariants(nextVariants);
          const desired =
            selectedVariantGlbUrl &&
            nextVariants.find((v) => v.glbUrl === selectedVariantGlbUrl)?.glbUrl;
          const first = nextVariants[0]?.glbUrl;
          setModelUrl(desired ?? first ?? null);
        } else if (typeof data.modelUrl === "string" && data.modelUrl.trim()) {
          setModelUrl(data.modelUrl.trim());
        }
      } catch {
        // ignore
      } finally {
        if (!cancelled) setIsLoadingModel(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isSharedView, selectedVariantGlbUrl, setProductName]);

  // When a share payload selects a specific GLB, prefer it.
  useEffect(() => {
    if (!isSharedView) return;
    if (!selectedVariantGlbUrl) return;
    setModelUrl(selectedVariantGlbUrl);
  }, [isSharedView, selectedVariantGlbUrl]);

  const effectiveModelUrl =
    modelUrl && /^https?:\/\//i.test(modelUrl)
      ? `/api/model/proxy?src=${encodeURIComponent(modelUrl)}`
      : modelUrl;

  const onDecalChange = useCallback((next: DecalConfig) => {
    setDecal(next);
  }, [setDecal]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-3 sm:p-4 md:flex-row md:gap-6 md:p-6">
      {!isSharedView ? (
        <div className="w-full shrink-0 md:w-[380px]">
          <ControlsPanel
            productName={productName}
            color={color}
            onColorChange={setColor}
            variants={variants}
            selectedVariantGlbUrl={modelUrl}
            onVariantSelect={(glbUrl) => {
              setModelUrl(glbUrl);
              setSelectedVariantGlbUrl(glbUrl);
            }}
            logoDataUrl={logoDataUrl}
            onLogoDataUrlChange={setLogoDataUrl}
            isLogoPlacementMode={isLogoPlacementMode}
            onLogoPlacementModeChange={setIsLogoPlacementMode}
            decal={decal}
            onDecalChange={onDecalChange}
            shareUrl={shareUrl}
            onCopyShare={copyShareLink}
            captureElementId={CAPTURE_ID}
          />
        </div>
      ) : null}
      <div className="flex min-h-0 w-full flex-col max-md:h-[min(52dvh,580px)] max-md:min-h-[280px] max-md:flex-shrink-0 md:min-h-[min(70vh,720px)] md:flex-1">
        {isLoadingModel ? (
          <div className="flex h-full min-h-[280px] w-full items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-sm text-zinc-500 max-md:min-h-[min(52dvh,580px)] md:min-h-[420px]">
            Loading model…
          </div>
        ) : effectiveModelUrl ? (
          <ModelViewer
            captureId={CAPTURE_ID}
            modelUrl={effectiveModelUrl}
            color={color}
            logoDataUrl={logoDataUrl}
            decal={decal}
            onDecalChange={isSharedView ? undefined : onDecalChange}
            isLogoPlacementMode={isLogoPlacementMode}
            allowDefaultModel={false}
            isGeneratingModel={false}
            modelGenerationProgress={0}
          />
        ) : (
          <div className="flex h-full min-h-[280px] w-full flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-zinc-900 px-6 text-center text-sm text-zinc-500 max-md:min-h-[min(52dvh,580px)] md:min-h-[420px]">
            <p className="text-zinc-300">No model returned from backend.</p>
            <p className="text-xs text-zinc-500">Check `/api/model` response / `one_model_data`.</p>
          </div>
        )}
      </div>
    </main>
  );
}
