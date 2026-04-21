"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect } from "react";
import { useSearchParams } from "next/navigation";
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
  const searchParams = useSearchParams();
  const {
    productName,
    productKey,
    logoDataUrl,
    setLogoDataUrl,
    decal,
    setDecal,
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
    shareUrl,
    copyShareLink,
    loadFromShareId,
    syncModelIdFromUrl,
  } = useConfiguratorState({ disableInitialLibrarySearch: isSharedView });

  // If this page is /s/[id], hydrate state from Supabase once.
  // (This runs client-side and doesn’t force Next router URL mutations.)
  useEffect(() => {
    if (!shareId) return;
    void loadFromShareId(shareId);
  }, [loadFromShareId, shareId]);

  useEffect(() => {
    if (shareId) return;
    syncModelIdFromUrl({
      modelId: searchParams.get("modelId"),
      productName: searchParams.get("productName"),
      productKey: searchParams.get("productKey"),
    });
  }, [searchParams, shareId, syncModelIdFromUrl]);

  const onDecalChange = useCallback((next: DecalConfig) => {
    setDecal(next);
  }, [setDecal]);

  return (
    <main className="mx-auto flex w-full max-w-[1600px] flex-1 min-h-0 flex-col gap-4 p-3 sm:p-4 md:h-full md:flex-row md:gap-6 md:p-6">
      {!isSharedView ? (
        <div className="w-full shrink-0 md:h-full md:min-h-0 md:w-[380px]">
          <ControlsPanel
            productName={productName}
            productKey={productKey}
            libraryQuery={libraryQuery}
            libraryProducts={libraryProducts}
            isLoadingLibrary={isLoadingLibrary}
            libraryError={libraryError}
            onSearchLibrary={searchLibrary}
            selectedModelId={selectedModelId}
            onSelectModel={selectModel}
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
      <div className="flex min-h-0 w-full flex-1 flex-col md:h-full">
        <ModelViewer
          captureId={CAPTURE_ID}
          title={productName}
          logoDataUrl={logoDataUrl}
          decal={decal}
          onDecalChange={isSharedView ? undefined : onDecalChange}
          isLogoPlacementMode={isLogoPlacementMode}
          allowDefaultModel={false}
          modelUrl={modelUrl ?? undefined}
          isGeneratingModel={false}
          modelGenerationProgress={0}
        />
      </div>
    </main>
  );
}
