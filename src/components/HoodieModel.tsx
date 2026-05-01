"use client";

import { Decal, useGLTF } from "@react-three/drei";
import { useThree, type ThreeEvent } from "@react-three/fiber";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import type { DecalConfig, LogoLayer } from "@/types/configurator";

export const HOODIE_MODEL_PATH =
  "/models/base_basic_pbr.glb";

type FlatMesh = {
  uuid: string;
  geometry: THREE.BufferGeometry;
  material: THREE.Material | THREE.Material[];
  matrixWorld: THREE.Matrix4;
};

function flattenMeshes(root: THREE.Object3D): FlatMesh[] {
  root.updateMatrixWorld(true);
  const out: FlatMesh[] = [];
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh && obj.geometry) {
      out.push({
        uuid: obj.uuid,
        geometry: obj.geometry,
        material: obj.material,
        matrixWorld: obj.matrixWorld.clone(),
      });
    }
  });
  return out;
}

type PreparedMesh = FlatMesh & {
  /** Geometry safe for DecalGeometry (has normals). */
  preparedGeometry: THREE.BufferGeometry;
  /** True when `preparedGeometry` is a clone and should be disposed. */
  ownsPreparedGeometry: boolean;
};

function prepareMeshesForDecals(meshes: FlatMesh[]): PreparedMesh[] {
  return meshes.map((m) => {
    const g = m.geometry;
    const hasPos = Boolean(g?.attributes?.position);
    const hasNormal = Boolean(g?.attributes?.normal);
    if (!hasPos) {
      // No position attribute -> cannot render or decal safely; keep as-is.
      return { ...m, preparedGeometry: g, ownsPreparedGeometry: false };
    }
    if (hasNormal) {
      return { ...m, preparedGeometry: g, ownsPreparedGeometry: false };
    }
    // Some GLBs ship without vertex normals; DecalGeometry needs them.
    const cloned = g.clone();
    cloned.computeVertexNormals();
    cloned.normalizeNormals();
    return { ...m, preparedGeometry: cloned, ownsPreparedGeometry: true };
  });
}

function normalizedDisplayRoot(scene: THREE.Object3D): THREE.Object3D {
  const root = scene.clone(true);
  const box = new THREE.Box3().setFromObject(root);
  if (box.isEmpty()) return root;
  const center = box.getCenter(new THREE.Vector3());
  const size = box.getSize(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z, 1e-6);
  const scale = 1.9 / maxDim;
  root.scale.multiplyScalar(scale);
  root.position.sub(center.multiplyScalar(scale));
  root.updateMatrixWorld(true);
  return root;
}

function pickDecalMeshIndex(meshes: FlatMesh[]): number {
  const score = (m: FlatMesh): { ok: boolean; triCount: number; radius: number } => {
    const g = m.geometry;
    const pos = g?.attributes?.position as THREE.BufferAttribute | undefined;
    const normal = g?.attributes?.normal as THREE.BufferAttribute | undefined;
    if (!pos) return { ok: false, triCount: 0, radius: 0 };

    // Prefer meshes that already have normals (or can be computed) for decals.
    const ok = Boolean(normal);
    const triCount = g.index
      ? Math.floor(g.index.count / 3)
      : Math.floor(pos.count / 3);
    const tmp = g.clone();
    tmp.applyMatrix4(m.matrixWorld);
    tmp.computeBoundingSphere();
    const radius = tmp.boundingSphere?.radius ?? 0;
    tmp.dispose();
    return { ok, triCount, radius };
  };

  let bestOk = -1;
  let bestCount = -1;
  let bestR = 0;
  let best = -1;
  meshes.forEach((m, i) => {
    const s = score(m);
    const okRank = s.ok ? 1 : 0;
    if (
      okRank > bestOk ||
      (okRank === bestOk && (s.triCount > bestCount || (s.triCount === bestCount && s.radius > bestR)))
    ) {
      bestOk = okRank;
      bestCount = s.triCount;
      bestR = s.radius;
      best = i;
    }
  });

  return best >= 0 ? best : 0;
}

type LoadedLogoTex = {
  texture: THREE.Texture;
  aspectRatio: number;
  loadGeneration: number;
};

function useLogoTextureMap(logos: LogoLayer[]) {
  const [map, setMap] = useState<Record<string, LoadedLogoTex | null>>({});
  const prevIdsRef = useRef<Set<string>>(new Set());
  const lastUrlByIdRef = useRef<Record<string, string>>({});

  useEffect(() => {
    const nextIds = new Set(logos.map((l) => l.id));
    prevIdsRef.current = nextIds;

    // Dispose removed textures.
    setMap((prev) => {
      const out: Record<string, LoadedLogoTex | null> = { ...prev };
      for (const id of Object.keys(out)) {
        if (!nextIds.has(id)) {
          const entry = out[id];
          if (entry?.texture) entry.texture.dispose();
          delete out[id];
        }
      }
      return out;
    });
    // Drop removed ids from URL tracking.
    for (const id of Object.keys(lastUrlByIdRef.current)) {
      if (!nextIds.has(id)) delete lastUrlByIdRef.current[id];
    }

    // Load/update any logo whose dataUrl changed.
    const cleanups: Array<() => void> = [];
    for (const logo of logos) {
      const id = logo.id;
      const dataUrl = logo.dataUrl;
      if (!id || !dataUrl) continue;
      if (lastUrlByIdRef.current[id] === dataUrl) continue;
      lastUrlByIdRef.current[id] = dataUrl;

      let cancelled = false;
      const img = new Image();
      img.crossOrigin = "anonymous";

      const apply = () => {
        if (cancelled || !img.complete || img.naturalWidth < 1) return;
        const tex = new THREE.Texture(img);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
        tex.flipY = true;
        tex.needsUpdate = true;
        setMap((prev) => {
          const prevEntry = prev[id];
          if (prevEntry?.texture) prevEntry.texture.dispose();
          return {
            ...prev,
            [id]: {
              texture: tex,
              aspectRatio: img.naturalWidth / Math.max(img.naturalHeight, 1),
              loadGeneration: (prevEntry?.loadGeneration ?? 0) + 1,
            },
          };
        });
      };

      img.onload = apply;
      img.onerror = () => {
        if (cancelled) return;
        console.warn("[HoodieModel] Logo image failed to load (check file type / path).");
        setMap((prev) => ({ ...prev, [id]: null }));
      };
      img.src = dataUrl;
      if (img.complete && img.naturalWidth > 0) apply();
      cleanups.push(() => { cancelled = true; });
    }
    return () => {
      for (const fn of cleanups) fn();
    };
  }, [logos]);

  return map;
}

export type HoodieModelProps = {
  logos: LogoLayer[];
  activeLogoId: string | null;
  onLogoDecalChange?: (logoId: string, next: DecalConfig) => void;
  orbitRef?: RefObject<OrbitControlsImpl | null>;
  isLogoPlacementMode?: boolean;
  modelUrl?: string;
  /** Called once after the model loads with the average material luminance (0 = black, 1 = white). */
  onModelColorInfo?: (luminance: number) => void;
};

export function HoodieModel({
  logos,
  activeLogoId,
  onLogoDecalChange,
  orbitRef,
  isLogoPlacementMode,
  modelUrl,
  onModelColorInfo,
}: HoodieModelProps) {
  const effectiveModelUrl = modelUrl ?? HOODIE_MODEL_PATH;
  const { scene } = useGLTF(effectiveModelUrl);
  const decalMeshRef = useRef<THREE.Mesh>(null);
  const draggingLogo = useRef(false);
  const logoPointerId = useRef<number | null>(null);
  const activeId = activeLogoId ?? logos[0]?.id ?? null;
  const activeLogo = activeId ? logos.find((l) => l.id === activeId) : null;
  const activeDecal = activeLogo?.decal ?? null;
  const decalRef = useRef<DecalConfig | null>(activeDecal);
  decalRef.current = activeDecal;

  const { camera, gl, raycaster } = useThree();
  const pointerNdc = useRef(new THREE.Vector2());
  const localHit = useRef(new THREE.Vector3());
  const localFaceNormal = useRef(new THREE.Vector3(0, 0, 1));

  const displayRoot = useMemo(
    () => normalizedDisplayRoot(scene),
    [scene],
  );
  const flatMeshes = useMemo(
    () => flattenMeshes(displayRoot),
    [displayRoot],
  );
  const preparedMeshes = useMemo(
    () => prepareMeshesForDecals(flatMeshes),
    [flatMeshes],
  );
  const decalMeshIndex = useMemo(
    () => pickDecalMeshIndex(preparedMeshes),
    [preparedMeshes],
  );

  const texMap = useLogoTextureMap(logos);

  useEffect(() => {
    return () => {
      for (const m of preparedMeshes) {
        if (m.ownsPreparedGeometry) m.preparedGeometry.dispose();
      }
    };
  }, [preparedMeshes]);

  // Signal to the viewer that the model meshes are in the scene so it can
  // sample the rendered canvas pixels for accurate background detection.
  useEffect(() => {
    if (!onModelColorInfo || preparedMeshes.length === 0) return;
    onModelColorInfo(0); // value unused — just a readiness signal
  }, [preparedMeshes, onModelColorInfo]);

  useEffect(() => {
    // Improve perceived sharpness on angled surfaces / when zooming.
    // (This does not invent detail; it reduces blur from sampling.)
    for (const entry of Object.values(texMap)) {
      if (!entry?.texture) continue;
      const logoMap = entry.texture;
      logoMap.anisotropy = gl.capabilities.getMaxAnisotropy();
      logoMap.minFilter = THREE.LinearFilter;
      logoMap.magFilter = THREE.LinearFilter;
      logoMap.generateMipmaps = false;
      logoMap.premultiplyAlpha = true;
      logoMap.needsUpdate = true;
    }
  }, [gl.capabilities, texMap]);

  const decalGeoBBox = useMemo(() => {
    if (preparedMeshes.length === 0) return null;
    const geo = preparedMeshes[decalMeshIndex].preparedGeometry;
    const pos = geo.attributes.position;
    if (!pos) return null;
    const box = new THREE.Box3().setFromBufferAttribute(
      pos as THREE.BufferAttribute,
    );
    return box.isEmpty() ? null : box;
  }, [preparedMeshes, decalMeshIndex]);

  const decalBBoxSize = useMemo(
    () => decalGeoBBox?.getSize(new THREE.Vector3()) ?? null,
    [decalGeoBBox],
  );

  const computeDecalLocal = useCallback(
    (decal: DecalConfig, logoAspect: number): DecalConfig & { scaleX: number; scaleY: number; projectorDepth: number } => {
      const lerp = (t: number, min: number, max: number) => min + t * (max - min);
      const baseScale = decalGeoBBox && decalBBoxSize
        ? decal.scale * Math.min(decalBBoxSize.x, decalBBoxSize.y)
        : decal.scale;
      const scaleX = logoAspect >= 1 ? baseScale * logoAspect : baseScale;
      const scaleY = logoAspect < 1 ? baseScale / logoAspect : baseScale;
      // Decal's Z scale is projector depth.
      // Too small -> logo breaks on folds/curves (projection volume clips).
      // Too big -> may project onto inner/back faces.
      // This value is intentionally larger to better follow curved cloth,
      // but still tied to the logo size so it doesn't explode.
      // For highly curved products (e.g., rounded bottles), a deeper projection volume
      // reduces edge clipping of wide logos.
      const bboxZ = decalBBoxSize?.z ?? 0;
      const projectorDepth = Math.max(0.06, baseScale * 1.35, bboxZ * 0.12);
      const rotation: [number, number, number] = [...decal.rotation];
      return {
        position: decalGeoBBox ? [
          lerp(decal.position[0], decalGeoBBox.min.x, decalGeoBBox.max.x),
          lerp(decal.position[1], decalGeoBBox.min.y, decalGeoBBox.max.y),
          lerp(decal.position[2], decalGeoBBox.min.z, decalGeoBBox.max.z),
        ] : decal.position,
        rotation,
        scale: baseScale,
        scaleX,
        scaleY,
        projectorDepth,
      };
    },
    [decalGeoBBox, decalBBoxSize],
  );

  const localToNorm = useCallback(
    (local: THREE.Vector3): [number, number, number] => {
      if (!decalGeoBBox || !decalBBoxSize) {
        return [local.x, local.y, local.z];
      }
      const norm = (v: number, min: number, max: number) =>
        max <= min ? 0.5 : (v - min) / (max - min);
      return [
        norm(local.x, decalGeoBBox.min.x, decalGeoBBox.max.x),
        norm(local.y, decalGeoBBox.min.y, decalGeoBBox.max.y),
        norm(local.z, decalGeoBBox.min.z, decalGeoBBox.max.z),
      ];
    },
    [decalGeoBBox, decalBBoxSize],
  );

  const projectClientToDecalPosition = useCallback(
    (clientX: number, clientY: number) => {
      const mesh = decalMeshRef.current;
      if (!mesh || !onLogoDecalChange || !activeId || !decalRef.current) return;
      const rect = gl.domElement.getBoundingClientRect();
      pointerNdc.current.x =
        ((clientX - rect.left) / rect.width) * 2 - 1;
      pointerNdc.current.y =
        -((clientY - rect.top) / rect.height) * 2 + 1;
      raycaster.setFromCamera(pointerNdc.current, camera);
      const hits = raycaster.intersectObject(mesh, false);
      if (hits.length === 0) return;
      localHit.current.copy(hits[0].point);
      mesh.worldToLocal(localHit.current);

      if (hits[0].face?.normal) {
        localFaceNormal.current.copy(hits[0].face.normal).normalize();
      } else {
        localFaceNormal.current.set(0, 0, 1);
      }
      const q = new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 0, 1),
        localFaceNormal.current,
      );
      const euler = new THREE.Euler().setFromQuaternion(q, "XYZ");

      const d = decalRef.current;
      onLogoDecalChange(activeId, {
        ...d,
        position: localToNorm(localHit.current),
        rotation: [euler.x, euler.y, d.rotation[2]],
      });
    },
    [activeId, camera, gl.domElement, localToNorm, onLogoDecalChange, raycaster],
  );

  const endLogoDrag = useCallback(() => {
    if (logoPointerId.current != null) {
      try {
        gl.domElement.releasePointerCapture(logoPointerId.current);
      } catch {
        /* capture may already be released */
      }
      logoPointerId.current = null;
    }
    if (!draggingLogo.current) return;
    draggingLogo.current = false;
    if (orbitRef?.current) orbitRef.current.enabled = true;
  }, [gl.domElement, orbitRef]);

  useEffect(() => {
    const activeTex = activeId ? texMap[activeId]?.texture ?? null : null;
    if (!onLogoDecalChange || !activeTex) return;
    const el = gl.domElement;
    const onUp = () => endLogoDrag();
    const onMove = (ev: PointerEvent) => {
      if (!draggingLogo.current) return;
      projectClientToDecalPosition(ev.clientX, ev.clientY);
    };
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onUp);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointermove", onMove);
    return () => {
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointermove", onMove);
    };
  }, [activeId, endLogoDrag, gl.domElement, onLogoDecalChange, projectClientToDecalPosition, texMap]);

  const onDecalMeshPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const activeTex = activeId ? texMap[activeId]?.texture ?? null : null;
      if (!activeTex || !onLogoDecalChange || !isLogoPlacementMode) return;
      e.stopPropagation();
      draggingLogo.current = true;
      if (orbitRef?.current) orbitRef.current.enabled = false;
      logoPointerId.current = e.pointerId;
      gl.domElement.setPointerCapture(e.pointerId);
      projectClientToDecalPosition(e.clientX, e.clientY);
    },
    [
      activeId,
      gl.domElement,
      isLogoPlacementMode,
      onLogoDecalChange,
      orbitRef,
      projectClientToDecalPosition,
      texMap,
    ],
  );

  if (preparedMeshes.length === 0) return null;

  return (
    <group>
      {preparedMeshes.map((m, index) => (
        <group
          key={m.uuid}
          matrix={m.matrixWorld}
          matrixAutoUpdate={false}
        >
          <mesh
            ref={index === decalMeshIndex ? decalMeshRef : undefined}
            geometry={m.preparedGeometry}
            material={m.material}
            onPointerDown={
              index === decalMeshIndex ? onDecalMeshPointerDown : undefined
            }
          >
            {index === decalMeshIndex
              ? logos.map((logo) => {
                const entry = texMap[logo.id];
                const logoMap = entry?.texture ?? null;
                if (!logoMap) return null;
                const local = computeDecalLocal(logo.decal, entry?.aspectRatio ?? 1);
                return (
                  <Decal
                    key={`${logo.id}-${entry?.loadGeneration ?? 0}-${logoMap.uuid}`}
                    position={local.position}
                    rotation={local.rotation}
                    scale={[local.scaleX, local.scaleY, local.projectorDepth]}
                    map={logoMap}
                    renderOrder={10}
                    {...{
                      "material-depthTest": true,
                      "material-depthWrite": false,
                      "material-side": THREE.FrontSide,
                      "material-transparent": true,
                      // Avoid hard edge cutouts; prefer smooth blending.
                      "material-alphaTest": 0,
                      "material-alphaToCoverage": true,
                      "material-premultipliedAlpha": true,
                      "material-polygonOffset": true,
                      "material-polygonOffsetFactor": -1,
                      "material-polygonOffsetUnits": -4,
                      "material-toneMapped": true,
                    }}
                  />
                );
              })
              : null}
          </mesh>
        </group>
      ))}
    </group>
  );
}

useGLTF.preload(HOODIE_MODEL_PATH);