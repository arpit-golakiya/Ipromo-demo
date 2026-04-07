"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect } from "react";
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
  const {
    productName,
    color,
    setColor,
    logoDataUrl,
    setLogoDataUrl,
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
    generatedModelUrl,
    isGeneratingModel,
    modelGenerationProgress,
    modelGenerationError,
    generateModelFromImage,
    resetGeneratedModel,
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

  const onDecalChange = useCallback((next: DecalConfig) => {
    setDecal(next);
  }, [setDecal]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-3 sm:p-4 md:flex-row md:gap-6 md:p-6">
      <div className="w-full shrink-0 md:w-[380px]">
        <ControlsPanel
          productName={productName}
          displayUrl={displayUrl}
          onDisplayUrlChange={setDisplayUrl}
          onLoadProduct={loadProductFromUrl}
          isLoadingProduct={isLoadingProduct}
          productLoadError={productLoadError}
          scrapedColors={scrapedColors}
          productLoadedFromScrape={productLoadedFromScrape}
          scrapedImages={scrapedImages}
          color={color}
          onColorChange={setColor}
          logoDataUrl={logoDataUrl}
          onLogoDataUrlChange={setLogoDataUrl}
          isLogoPlacementMode={isLogoPlacementMode}
          onLogoPlacementModeChange={setIsLogoPlacementMode}
          decal={decal}
          onDecalChange={onDecalChange}
          generatedModelUrl={generatedModelUrl}
          isGeneratingModel={isGeneratingModel}
          modelGenerationProgress={modelGenerationProgress}
          modelGenerationError={modelGenerationError}
          onGenerateModel={generateModelFromImage}
          onResetModel={resetGeneratedModel}
          shareUrl={shareUrl}
          onCopyShare={copyShareLink}
          captureElementId={CAPTURE_ID}
        />
      </div>
      <div className="flex min-h-0 w-full flex-col max-md:h-[min(52dvh,580px)] max-md:min-h-[280px] max-md:flex-shrink-0 md:min-h-[min(70vh,720px)] md:flex-1">
        <ModelViewer
          captureId={CAPTURE_ID}
          color={color}
          logoDataUrl={logoDataUrl}
          decal={decal}
          onDecalChange={onDecalChange}
          isLogoPlacementMode={isLogoPlacementMode}
          modelUrl={generatedModelUrl ?? undefined}
          isGeneratingModel={isGeneratingModel}
          modelGenerationProgress={modelGenerationProgress}
        />
      </div>
    </main>
  );
}
