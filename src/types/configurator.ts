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
  // Left chest (wearer's left = viewer's right): X shifted right of center to clear
  // the zipper track, Y lowered slightly to sit below the quarter-zip pull area.
  position: [0.65, 0.63, 0.90],
  rotation: [0, 0, 0],
  scale: 0.22,
};
