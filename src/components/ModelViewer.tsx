"use client";

import { Html, OrbitControls, Stage, useProgress } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { Suspense, useRef, type RefObject } from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { HoodieModel, type HoodieModelProps } from "@/components/HoodieModel";

function ModelLoadFallback({ label }: { label?: string }) {
  const { active, progress } = useProgress();
  const shownProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;

  return (
    <Html center>
      <div className="pointer-events-none flex min-w-[220px] flex-col items-center gap-3 rounded-xl border border-white/10 bg-black/70 px-5 py-4 text-center text-white backdrop-blur-sm">
        <svg className="h-7 w-7 animate-spin text-blue-400" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z" />
        </svg>
        <p className="text-sm font-medium">{label ?? (active ? "Loading 3D model…" : "Preparing 3D view…")}</p>
        <div className="w-48 overflow-hidden rounded-full bg-zinc-700">
          <div
            className="h-2 rounded-full bg-blue-500 transition-all duration-300"
            style={{ width: `${shownProgress}%` }}
          />
        </div>
        <p className="text-xs text-zinc-300">{Math.round(shownProgress)}%</p>
      </div>
    </Html>
  );
}

/**
 * Lighting / framing aligned with `GLB_DEMO/frontend/src/Model.jsx` (Stage + city + low ambient).
 * Logo placement and decals stay in `HoodieModel` unchanged.
 */
function Scene({
  orbitRef,
  isLogoPlacementMode,
  allowDefaultModel = true,
  ...hoodie
}: HoodieModelProps & {
  orbitRef: RefObject<OrbitControlsImpl | null>;
  isLogoPlacementMode?: boolean;
  allowDefaultModel?: boolean;
}) {
  const shouldRenderModel = allowDefaultModel || Boolean(hoodie.modelUrl);

  return (
    <>
      <ambientLight intensity={0.25} />
      <Suspense fallback={<ModelLoadFallback />}>
        {shouldRenderModel ? (
          <Stage
            intensity={0.5}
            environment="city"
            adjustCamera={1.15}
            shadows={false}
          >
            <HoodieModel
              {...hoodie}
              orbitRef={orbitRef}
              isLogoPlacementMode={isLogoPlacementMode}
            />
          </Stage>
        ) : (
          <ModelLoadFallback label="Loading shared product…" />
        )}
      </Suspense>
      <OrbitControls
        ref={orbitRef}
        enabled={!isLogoPlacementMode}
        enableDamping
        dampingFactor={0.08}
        minDistance={0.2}
        maxDistance={80}
        target={[0, 0, 0]}
      />
    </>
  );
}

export type ModelViewerProps = HoodieModelProps & {
  /** DOM id for PDF / html2canvas capture wrapper */
  captureId?: string;
  /** Optional label shown above the canvas (included in capture). */
  title?: string;
  isLogoPlacementMode?: boolean;
  /** If false, don't render the built-in default model while waiting for a real model URL. */
  allowDefaultModel?: boolean;
  /** When generating a new model, show a loading overlay over the canvas. */
  isGeneratingModel?: boolean;
  modelGenerationProgress?: number;
};

/**
 * Full-height R3F canvas. `preserveDrawingBuffer` helps screenshots / PDF export.
 */
export function ModelViewer({
  captureId = "configurator-viewer",
  title,
  isLogoPlacementMode,
  allowDefaultModel = true,
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
      className="relative isolate box-border h-full min-h-[240px] w-full flex-1 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-zinc-900 to-black md:min-h-0"
    >
      {title ? (
        <div
          className="pointer-events-none absolute left-0 top-0 z-20 w-full bg-gradient-to-b from-black/70 to-black/0 px-4 py-3 transform-gpu"
          style={{ transform: "translateZ(0)" }}
        >
          <p className="truncate text-sm font-semibold text-zinc-100">{title}</p>
        </div>
      ) : null}
      <Canvas
        key={hoodie.modelUrl ?? "static"}
        className="absolute inset-0 z-0 touch-none"
        style={{ zIndex: 0 }}
        camera={{ position: [2.2, 1.6, 2.2], fov: 45, near: 0.1, far: 100 }}
        onCreated={({ gl }) => {
          gl.outputColorSpace = THREE.SRGBColorSpace;
        }}
        gl={{
          preserveDrawingBuffer: true,
          antialias: true,
          alpha: false,
          powerPreference: "high-performance",
        }}
        dpr={[1, 2]}
        resize={{ offsetSize: true, debounce: { scroll: 0, resize: 0 } }}
      >
        <color attach="background" args={["#0c0c12"]} />
        <Scene
          {...hoodie}
          orbitRef={orbitRef}
          isLogoPlacementMode={isLogoPlacementMode}
          allowDefaultModel={allowDefaultModel}
        />
      </Canvas>

      {/* Generation progress overlay */}
      {isGeneratingModel && (
        <div className="pointer-events-none absolute inset-0 z-30 flex flex-col items-center justify-center gap-4 bg-black/70 backdrop-blur-sm">
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

      <p
        className="pointer-events-none absolute bottom-3 left-3 z-20 max-w-[min(100%,20rem)] text-xs leading-snug text-zinc-500 transform-gpu"
        style={{ transform: "translateZ(0)" }}
      >
        {isLogoPlacementMode ? (
          <span className="text-amber-300">
            Drag on the model to place your logo
          </span>
        ) : (
          <>Drag to rotate · Scroll to zoom</>
        )}
      </p>
    </div>
  );
}
