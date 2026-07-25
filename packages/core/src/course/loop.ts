import { headingAt } from "./centerline.js";
import type { CenterlinePoint, Vec3 } from "../types.js";

/**
 * Closes an autocross course into a circuit.
 *
 * Autocross is point-to-point and Assetto Corsa is lap-based. Running A-to-B
 * means reloading the session after every 78-second run, which defeats the
 * purpose of practising. Instead we append a return path from finish back to
 * start, so timing gates can be arranged as:
 *
 *   AC_TIME_0 at the real course start   -> the lap line
 *   AC_TIME_1 at the real course finish  -> so *sector 1 is the autocross run*
 *
 * The driver's sector 1 time is then directly comparable to their real-world
 * result, while the lap continues around the return path and lines them up to go
 * again without leaving the session.
 */

export interface ReturnPathOptions {
  /** Number of points to sample along the return curve. */
  samples: number;
  /**
   * How far the Bézier control points extend along the entry/exit tangents, as a
   * multiple of the start-finish gap. Higher values swing wider.
   */
  tangentStrength: number;
  /** Minimum control-point extension in metres, for very short gaps. */
  minTangent: number;
}

export const DEFAULT_RETURN_PATH_OPTIONS: ReturnPathOptions = {
  samples: 60,
  tangentStrength: 0.9,
  minTangent: 15,
};

function cubicBezier(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, t: number): Vec3 {
  const u = 1 - t;
  const a = u * u * u;
  const b = 3 * u * u * t;
  const c = 3 * u * t * t;
  const d = t * t * t;
  return {
    x: a * p0.x + b * p1.x + c * p2.x + d * p3.x,
    y: 0,
    z: a * p0.z + b * p1.z + c * p2.z + d * p3.z,
  };
}

/**
 * Builds a smooth return path from the course finish back to the course start.
 *
 * Tangent-matched at both ends so the car exits the finish still travelling
 * forwards and arrives at the start already pointing down the course, rather
 * than having to make a hairpin at either join.
 */
export function buildReturnPath(
  centerline: CenterlinePoint[],
  options: Partial<ReturnPathOptions> = {},
): Vec3[] {
  if (centerline.length < 2) throw new Error("Centreline too short to close");
  const opt = { ...DEFAULT_RETURN_PATH_OPTIONS, ...options };

  const finish = centerline[centerline.length - 1]!.position;
  const start = centerline[0]!.position;
  const finishHeading = headingAt(centerline, centerline.length - 1);
  const startHeading = headingAt(centerline, 0);

  const gap = Math.hypot(start.x - finish.x, start.z - finish.z);
  const reach = Math.max(opt.minTangent, gap * opt.tangentStrength);

  const control1: Vec3 = {
    x: finish.x + finishHeading.x * reach,
    y: 0,
    z: finish.z + finishHeading.z * reach,
  };
  const control2: Vec3 = {
    x: start.x - startHeading.x * reach,
    y: 0,
    z: start.z - startHeading.z * reach,
  };

  // Endpoints are excluded: they already exist as the course's own start/finish.
  const path: Vec3[] = [];
  for (let i = 1; i < opt.samples; i++) {
    path.push(cubicBezier(finish, control1, control2, start, i / opt.samples));
  }
  return path;
}
