/**
 * Decal placement stored as NORMALIZED [0..1] fractions of the target mesh's
 * axis-aligned bounding box. HoodieModel converts these to absolute local-space
 * coordinates at render time, so the values are unit-agnostic and work with any GLB.
 *
 *   position[0] = 0 → left edge,   1 → right edge  (X)
 *   position[1] = 0 → bottom edge, 1 → top edge    (Y)
 *   position[2] = 0 → back edge,   1 → front edge  (Z)
 *   scale       = fraction of min(mesh width, mesh height)
 */
export type DecalConfig = {
  position: [number, number, number];
  rotation: [number, number, number];
  scale: number;
};

export const DEFAULT_DECAL: DecalConfig = {
  // Center chest default (matches iPromo "YOUR LOGO HERE" preview placement).
  position: [0.5, 0.66, 0.9],
  rotation: [0, 0, 0],
  scale: 0.22,
};

export type LogoPlacement = "front" | "back" | "leftSleeve" | "rightSleeve";

export type LogoLayer = {
  id: string;
  dataUrl: string;
  placement: LogoPlacement;
  decal: DecalConfig;
};

export const MAX_LOGOS = 4;

export function decalPresetForPlacement(placement: LogoPlacement, base: DecalConfig): DecalConfig {
  // IMPORTANT: when `base` comes from `decal-presets`, we want "front" placement
  // to stay exactly as the preset (same behavior as before multi-logo).
  // Other placements are derived from `base` as a convenience starting point.
  switch (placement) {
    case "front":
      return base;
    case "back":
      return {
        ...base,
        // Mirror Z (front/back) while keeping X/Y/scale/rotation similar.
        position: [base.position[0], base.position[1], 1 - base.position[2]],
      };
    case "leftSleeve":
      return {
        ...base,
        position: [Math.min(0.24, base.position[0]), base.position[1], base.position[2]],
        scale: Math.min(0.18, base.scale),
      };
    case "rightSleeve":
      return {
        ...base,
        position: [Math.max(0.76, base.position[0]), base.position[1], base.position[2]],
        scale: Math.min(0.18, base.scale),
      };
    default:
      return base;
  }
}
