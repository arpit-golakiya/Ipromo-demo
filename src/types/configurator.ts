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
