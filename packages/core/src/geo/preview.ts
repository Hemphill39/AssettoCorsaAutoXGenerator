import type { Vec3 } from "../types.js";

/**
 * Conversion between Assetto Corsa world space and three.js scene space.
 *
 * Both are **right-handed** and Y-up, so this is the identity — but it stays as
 * an explicit, named boundary rather than being inlined away, because getting it
 * wrong is silently destructive rather than obviously broken: a mirrored course
 * still looks like a perfectly plausible autocross layout, so a user would drag
 * cones to "fix" it and corrupt the exported track.
 *
 * This originally negated Z, on the mistaken belief that AC was left-handed.
 * It is not: the reference Blender exporter's (x, y, z) -> (x, z, -y) has
 * determinant +1 and therefore preserves Blender's right-handed orientation.
 * See geo/project.ts for the full derivation.
 *
 * AC world space is X = east, Y = up, Z = south. With a top-down camera using
 * up = (0, 0, -1) — that is, north — north appears up on screen and east right,
 * reading as a normal map.
 */

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

/** AC world space -> three.js scene space. */
export function acToScene(v: Vec3): Vec3Tuple {
  return { x: v.x, y: v.y, z: v.z };
}

/** three.js scene space -> AC world space. Its own inverse. */
export function sceneToAc(v: Vec3Tuple): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

/** Flat array for three.js BufferAttribute, converted to scene space. */
export function toSceneArray(points: Vec3[]): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = p.z;
  });
  return out;
}

/** Camera up vector that orients a top-down view as a map: north up, east right. */
export const TOP_DOWN_UP: Vec3Tuple = { x: 0, y: 0, z: -1 };

/**
 * Turn direction of three points, used by tests.
 *
 * Because both spaces share a handedness, this sign must be *preserved* by the
 * conversion. A flip would mean the preview is mirrored relative to the track.
 */
export function turnSign(a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple): number {
  const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
  return Math.sign(cross);
}
