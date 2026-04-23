"use client";

import { Html, OrbitControls, Stage, useProgress } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useCallback, useMemo, useRef, useState, type RefObject } from "react";
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
 * Reads the average luminance of the centre 40 % of the WebGL canvas.
 * Called once after the model finishes rendering so we get the true
 * perceived brightness — textures, PBR, environment and all.
 */
function sampleCanvasLuminance(gl: THREE.WebGLRenderer): number | null {
  const canvas = gl.domElement;
  const w = canvas.width;
  const h = canvas.height;
  if (w < 1 || h < 1) return null;

  const sw = Math.max(8, Math.floor(w * 0.4));
  const sh = Math.max(8, Math.floor(h * 0.4));
  const sx = Math.floor((w - sw) / 2);
  const sy = Math.floor((h - sh) / 2);

  const pixels = new Uint8Array(sw * sh * 4);
  // WebGL y=0 is at the bottom, so flip the y origin.
  gl.getContext().readPixels(sx, h - sy - sh, sw, sh, 0x1908 /* RGBA */, 0x1401 /* UNSIGNED_BYTE */, pixels);

  const count = sw * sh;
  let total = 0;
  for (let i = 0; i < count; i++) {
    total +=
      0.2126 * (pixels[i * 4] / 255) +
      0.7152 * (pixels[i * 4 + 1] / 255) +
      0.0722 * (pixels[i * 4 + 2] / 255);
  }
  return total / count;
}

/**
 * Lighting / framing aligned with `GLB_DEMO/frontend/src/Model.jsx`.
 * Background colour is derived from the actual rendered pixel luminance so
 * texture-based colours, PBR metalness/roughness and environment lighting are
 * all accounted for — material.color alone is unreliable for GLBs.
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
  const { gl } = useThree();

  // 0.5 = neutral grey until we sample the real rendered pixels.
  const [luminance, setLuminance] = useState(0.5);

  // Refs that drive the one-shot pixel sample after model renders.
  const modelReadyRef = useRef(false);   // flipped when HoodieModel fires its callback
  const frameCountRef = useRef(0);
  const sampledRef = useRef(false);

  // HoodieModel calls this once it has parsed the meshes (i.e. model is in scene).
  const handleColorInfo = useCallback(() => {
    modelReadyRef.current = true;
    frameCountRef.current = 0;
  }, []);

  // Reset on every model URL change so a newly loaded model is re-sampled.
  const modelUrlKey = hoodie.modelUrl ?? "default";
  const prevKeyRef = useRef(modelUrlKey);
  if (prevKeyRef.current !== modelUrlKey) {
    prevKeyRef.current = modelUrlKey;
    modelReadyRef.current = false;
    frameCountRef.current = 0;
    sampledRef.current = false;
  }

  useFrame(() => {
    // Only sample once per model load, and only after HoodieModel has rendered.
    if (sampledRef.current || !modelReadyRef.current) return;
    frameCountRef.current++;
    // Wait 5 frames so the Stage environment + shadows have had time to render.
    if (frameCountRef.current < 5) return;

    sampledRef.current = true;
    const lum = sampleCanvasLuminance(gl);
    if (lum !== null) setLuminance(lum);
  });

  // t=1 → dark/black scene → whitish bg   t=0 → bright/white scene → blackish bg
  const bgColor = useMemo(() => {
    const t = Math.max(0, Math.min(1, 1 - luminance / 0.35));
    return `#${new THREE.Color("#0f0f0f").lerp(new THREE.Color("#e0e0e0"), t).getHexString()}`;
  }, [luminance]);

  const shouldRenderModel = allowDefaultModel || Boolean(hoodie.modelUrl);

  return (
    <>
      <color attach="background" args={[bgColor]} />
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
              onModelColorInfo={handleColorInfo}
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
      className="relative isolate box-border h-full min-h-[240px] w-full flex-1 overflow-hidden rounded-xl border border-white/10 bg-gradient-to-b from-zinc-900 to-black max-md:h-[min(52dvh,580px)] max-md:flex-none md:min-h-0"
    >
      {title ? (
        <div
          className="pointer-events-none absolute left-0 top-0 z-20 w-full bg-gradient-to-b from-black/80 to-black/0 px-4 py-3 transform-gpu"
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
