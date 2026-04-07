"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useRef, type RefObject } from "react";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { HoodieModel, type HoodieModelProps } from "@/components/HoodieModel";

function Scene({
  orbitRef,
  isLogoPlacementMode,
  ...hoodie
}: HoodieModelProps & {
  orbitRef: RefObject<OrbitControlsImpl | null>;
  isLogoPlacementMode?: boolean;
}) {
  return (
    <>
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 4]} intensity={1.2} castShadow />
      {/* "studio" HDRI — realistic reflections on fabric + logo */}
      <Environment preset="studio" />
      <Suspense fallback={null}>
        <HoodieModel {...hoodie} orbitRef={orbitRef} isLogoPlacementMode={isLogoPlacementMode} />
      </Suspense>
      <OrbitControls
        ref={orbitRef}
        enabled={!isLogoPlacementMode}
        enableDamping
        dampingFactor={0.08}
        minDistance={1.6}
        maxDistance={6}
        target={[0, 0, 0]}
      />
    </>
  );
}

export type ModelViewerProps = HoodieModelProps & {
  /** DOM id for PDF / html2canvas capture wrapper */
  captureId?: string;
  isLogoPlacementMode?: boolean;
  /** When generating a new model, show a loading overlay over the canvas. */
  isGeneratingModel?: boolean;
  modelGenerationProgress?: number;
};

/**
 * Full-height R3F canvas. `preserveDrawingBuffer` helps screenshots / PDF export.
 */
export function ModelViewer({
  captureId = "configurator-viewer",
  isLogoPlacementMode,
  isGeneratingModel,
  modelGenerationProgress,
  ...hoodie
}: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const orbitRef = useRef<OrbitControlsImpl | null>(null);

  return (
    <div
      ref={containerRef}
      id={captureId}
      className="relative min-h-[420px] w-full flex-1 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-zinc-900 to-black md:min-h-0 md:h-full"
    >
      <Canvas
        key={hoodie.modelUrl ?? "static"}
        shadows
        camera={{ position: [0, 0.65, 3.2], fov: 45, near: 0.1, far: 100 }}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        dpr={[1, 2]}
      >
        <color attach="background" args={["#0c0f14"]} />
        <Scene {...hoodie} orbitRef={orbitRef} isLogoPlacementMode={isLogoPlacementMode} />
      </Canvas>

      {/* Generation progress overlay */}
      {isGeneratingModel && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/70 backdrop-blur-sm">
          <div className="flex flex-col items-center gap-3 px-8 text-center">
            <svg className="h-8 w-8 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
            </svg>
            <p className="text-sm font-medium text-white">Generating 3D model…</p>
            <div className="w-48 overflow-hidden rounded-full bg-zinc-700">
              <div
                className="h-2 rounded-full bg-blue-500 transition-all duration-500"
                style={{ width: `${modelGenerationProgress ?? 0}%` }}
              />
            </div>
            <p className="text-xs text-zinc-400">{modelGenerationProgress ?? 0}% complete</p>
          </div>
        </div>
      )}

      <p className="pointer-events-none absolute bottom-3 left-3 max-w-[min(100%,20rem)] text-xs leading-snug text-zinc-500">
        {isLogoPlacementMode ? (
          <span className="text-amber-300">
            Drag on the hoodie to place your logo
          </span>
        ) : (
          <>Drag to rotate · Scroll to zoom</>
        )}
      </p>
    </div>
  );
}
