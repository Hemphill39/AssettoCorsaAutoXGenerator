import { MeshBuilder } from "./builders.js";
import { leftOf, rightOf } from "../geo/project.js";
import type { SlalomSpan } from "../course/cones.js";
import type { CenterlinePoint, Vec3 } from "../types.js";
import type { Kn5Mesh } from "../kn5/types.js";

/**
 * Visual guidance: making the course followable at speed.
 *
 * Real autocross is walked before it is driven, and real courses use far denser
 * cones than a GPS trace implies. In the sim you arrive at 50 mph having never
 * seen the layout, and a sparse cone field gives you nothing to aim at.
 *
 * These are deliberately unrealistic aids. They are presets rather than always-on
 * so the course can be tightened toward realism once it is familiar.
 */

export type GuidanceLevel = "realistic" | "guided" | "training";

export interface GuidanceOptions {
  level: GuidanceLevel;
  /** Painted edge stripe width, in metres. */
  lineWidth: number;
}

export const DEFAULT_GUIDANCE: GuidanceOptions = {
  level: "guided",
  lineWidth: 0.15,
};

/** Cone spacing overrides per guidance level, in metres. */
export function coneSpacingFor(level: GuidanceLevel): { straight: number; corner: number } {
  switch (level) {
    case "realistic":
      return { straight: 22, corner: 9 };
    case "guided":
      return { straight: 14, corner: 7 };
    case "training":
      return { straight: 9, corner: 5 };
  }
}

/** Floats paint just above the asphalt so it never z-fights with the surface. */
const PAINT_HEIGHT = 0.02;
const UP: Vec3 = { x: 0, y: 1, z: 0 };

function offsetPoint(p: Vec3, direction: Vec3, distance: number): Vec3 {
  return {
    x: p.x + direction.x * distance,
    y: PAINT_HEIGHT,
    z: p.z + direction.z * distance,
  };
}

function headingAt(points: CenterlinePoint[], index: number): Vec3 {
  const prev = points[Math.max(0, index - 1)]!.position;
  const next = points[Math.min(points.length - 1, index + 1)]!.position;
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, y: 0, z: dz / len };
}

/**
 * The line the painted corridor follows.
 *
 * Normally the driven centreline — but through a slalom the driven line is a
 * wave, so edge lines built on it snake around cones that sit in a straight row.
 * Inside a slalom the corridor follows the cone axis instead, so the paint runs
 * straight past the cones and the driver weaves across it, which is what a
 * slalom actually looks like.
 *
 * The swap is ramped in and out over a margin at each end so the corridor never
 * kinks where it joins the driven line.
 */
export function corridorCenterline(
  points: CenterlinePoint[],
  slalomSpans: SlalomSpan[] = [],
): Vec3[] {
  const out = points.map((p) => ({ ...p.position }));

  for (const span of slalomSpans) {
    if (span.axis.length < 2 || span.to <= span.from) continue;
    const core = span.to - span.from;
    const margin = Math.max(2, Math.round(core * 0.25));
    const from = Math.max(0, span.from - margin);
    const to = Math.min(points.length - 1, span.to + margin);

    for (let i = from; i <= to; i++) {
      // Position along the slalom, clamped so the margins sample its ends.
      const t = Math.min(1, Math.max(0, (i - span.from) / core));
      const f = t * (span.axis.length - 1);
      const lo = Math.min(span.axis.length - 1, Math.floor(f));
      const hi = Math.min(span.axis.length - 1, lo + 1);
      const frac = f - lo;
      const a = span.axis[lo]!;
      const b = span.axis[hi]!;
      const onAxis = { x: a.x + (b.x - a.x) * frac, z: a.z + (b.z - a.z) * frac };

      // Blend weight: full inside the slalom, ramping to zero across the margins.
      let w = 1;
      if (i < span.from) w = (i - from) / Math.max(1, span.from - from);
      else if (i > span.to) w = (to - i) / Math.max(1, to - span.to);
      w = w * w * (3 - 2 * w); // smoothstep, so the join has no visible corner

      const original = out[i]!;
      out[i] = {
        x: original.x + (onAxis.x - original.x) * w,
        y: 0,
        z: original.z + (onAxis.z - original.z) * w,
      };
    }
  }
  return out;
}

function headingOfLine(line: Vec3[], index: number): Vec3 {
  const prev = line[Math.max(0, index - 1)]!;
  const next = line[Math.min(line.length - 1, index + 1)]!;
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, y: 0, z: dz / len };
}

/**
 * Continuous painted stripes down both edges of the corridor.
 *
 * This is what turns a scattered cone field into something readable as a track:
 * the eye follows a continuous line far better than it interpolates between
 * discrete markers.
 */
export function buildEdgeLines(
  points: CenterlinePoint[],
  halfWidth: number,
  materialId: number,
  lineWidth = DEFAULT_GUIDANCE.lineWidth,
  name = "paint_edges",
  slalomSpans: SlalomSpan[] = [],
): Kn5Mesh {
  const builder = new MeshBuilder(name, materialId);
  const half = lineWidth / 2;
  const line = corridorCenterline(points, slalomSpans);

  for (const side of [leftOf, rightOf]) {
    for (let i = 0; i < line.length - 1; i++) {
      const n0 = side(headingOfLine(line, i));
      const n1 = side(headingOfLine(line, i + 1));
      const p0 = line[i]!;
      const p1 = line[i + 1]!;

      builder.addQuad(
        offsetPoint(p0, n0, halfWidth - half),
        offsetPoint(p1, n1, halfWidth - half),
        offsetPoint(p1, n1, halfWidth + half),
        offsetPoint(p0, n0, halfWidth + half),
        UP,
        2,
      );
    }
  }
  return builder.build({ castShadows: false });
}

/**
 * Meshes for a guidance level.
 *
 * "realistic" returns nothing — cones only, as the sport actually is. Direction
 * is conveyed by pointer cones (see course/cones.ts), which are how autocross
 * actually marks it, rather than by painted arrows we invented.
 */
export function buildGuidanceMeshes(
  points: CenterlinePoint[],
  halfWidth: number,
  paintMaterialId: number,
  options: Partial<GuidanceOptions> = {},
  slalomSpans: SlalomSpan[] = [],
): Kn5Mesh[] {
  const opt = { ...DEFAULT_GUIDANCE, ...options };
  if (opt.level === "realistic") return [];

  const meshes = [
    buildEdgeLines(points, halfWidth, paintMaterialId, opt.lineWidth, "paint_edges", slalomSpans),
  ];
  return meshes;
}
