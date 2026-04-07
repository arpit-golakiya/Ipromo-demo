"use client";

import dynamic from "next/dynamic";
import { useCallback } from "react";
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
      <div className="flex min-h-[420px] flex-1 items-center justify-center rounded-xl border border-white/10 bg-zinc-900 text-sm text-zinc-500">
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
export default function Configurator() {
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
  } = useConfiguratorState();

  const onDecalChange = useCallback((next: DecalConfig) => {
    setDecal(next);
  }, [setDecal]);

  return (
    <main className="mx-auto flex min-h-screen max-w-[1600px] flex-col gap-4 p-4 md:flex-row md:gap-6 md:p-6">
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
      <div className="flex min-h-[max(420px,60vh)] flex-1 flex-col md:min-h-[min(70vh,720px)]">
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
