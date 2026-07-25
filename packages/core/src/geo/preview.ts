import type { Vec3 } from "../types.js";

/**
 * Conversion between Assetto Corsa world space and three.js scene space.
 *
 * This module exists because getting it wrong is silently destructive rather
 * than obviously broken. AC is **left-handed** (X east, Y up, Z north); three.js
 * is **right-handed**. Rendering AC coordinates directly into a three.js scene
 * produces a mirror image that still looks like a plausible autocross course —
 * so a user would drag cones to "fix" it and make the exported track worse.
 *
 * Flipping exactly one axis converts handedness, so AC (x, y, z) maps to
 * three.js (x, y, -z).
 *
 * Paired with a top-down camera using up = (0, 0, -1), this yields a correct map
 * view: north is up on screen and east is to the right.
 *   - AC +Z (north) -> three -Z, which the camera's up vector puts at screen-up
 *   - AC +X (east)  -> three +X, which is screen-right
 */

export interface Vec3Tuple {
  x: number;
  y: number;
  z: number;
}

/** AC world space -> three.js scene space. */
export function acToScene(v: Vec3): Vec3Tuple {
  return { x: v.x, y: v.y, z: -v.z };
}

/** three.js scene space -> AC world space. Its own inverse. */
export function sceneToAc(v: Vec3Tuple): Vec3 {
  return { x: v.x, y: v.y, z: -v.z };
}

/** Flat array for three.js BufferAttribute, converted to scene space. */
export function toSceneArray(points: Vec3[]): Float32Array {
  const out = new Float32Array(points.length * 3);
  points.forEach((p, i) => {
    out[i * 3] = p.x;
    out[i * 3 + 1] = p.y;
    out[i * 3 + 2] = -p.z;
  });
  return out;
}

/** Camera up vector that orients a top-down view as a map: north up, east right. */
export const TOP_DOWN_UP: Vec3Tuple = { x: 0, y: 0, z: -1 };

/**
 * Whether three points keep their turn direction through the mapping.
 *
 * A left-to-right-handed conversion flips the sign of a 2D cross product, which
 * is correct and expected: it is what makes the rendered image match reality
 * instead of mirroring it. Used by tests to assert the flip actually happens.
 */
export function turnSign(a: Vec3Tuple, b: Vec3Tuple, c: Vec3Tuple): number {
  const cross = (b.x - a.x) * (c.z - b.z) - (b.z - a.z) * (c.x - b.x);
  return Math.sign(cross);
}
