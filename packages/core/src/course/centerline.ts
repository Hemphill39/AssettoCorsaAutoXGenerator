import { Projector, anchorOf } from "../geo/project.js";
import type { CenterlinePoint, Run, Sample, Vec3 } from "../types.js";

/**
 * Reconstructs a course centreline from one or more runs.
 *
 * Important honesty about what this can and cannot do: GPS records the line the
 * driver *drove*, not where the cones *were*. A single run can only ever yield a
 * corridor fitted around that one line. Multiple runs of the same course improve
 * the estimate — averaging suppresses GPS noise, and the spread between runs is
 * itself signal — but this remains inference, not recovery. The cone editor is
 * how the user corrects what inference cannot know.
 */

export interface CenterlineOptions {
  /** Number of evenly spaced stations along the course. */
  stations: number;
  /** Half-width of the moving-average smoothing window, in stations. */
  smoothingWindow: number;
}

export const DEFAULT_CENTERLINE_OPTIONS: CenterlineOptions = {
  stations: 400,
  smoothingWindow: 3,
};

function distance2d(a: Vec3, b: Vec3): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export interface ResampledRun {
  positions: Vec3[];
  speeds: number[];
  totalDistance: number;
}

/**
 * Resamples a run to `stations` points spaced evenly by arc length.
 *
 * Arc length rather than time is what makes runs comparable: a driver who is
 * slower through a section still traverses the same geometry.
 */
export function resampleByArcLength(
  samples: Sample[],
  projector: Projector,
  stations: number,
): ResampledRun {
  if (samples.length < 2) throw new Error("Need at least two samples to resample");

  const positions = samples.map((s) => projector.project(s));
  const cumulative: number[] = [0];
  for (let i = 1; i < positions.length; i++) {
    cumulative.push(cumulative[i - 1]! + distance2d(positions[i - 1]!, positions[i]!));
  }
  const total = cumulative[cumulative.length - 1]!;
  if (total <= 0) throw new Error("Run has zero length");

  const outPositions: Vec3[] = [];
  const outSpeeds: number[] = [];
  let cursor = 0;

  for (let station = 0; station < stations; station++) {
    const target = (station / (stations - 1)) * total;
    while (cursor < cumulative.length - 2 && cumulative[cursor + 1]! < target) cursor++;

    const segStart = cumulative[cursor]!;
    const segEnd = cumulative[cursor + 1]!;
    const segLength = segEnd - segStart;
    const t = segLength > 0 ? (target - segStart) / segLength : 0;

    outPositions.push(lerp(positions[cursor]!, positions[cursor + 1]!, t));
    const s0 = samples[cursor]!.speed;
    const s1 = samples[cursor + 1]!.speed;
    outSpeeds.push(s0 + (s1 - s0) * t);
  }

  return { positions: outPositions, speeds: outSpeeds, totalDistance: total };
}

/** Moving average over a closed or open polyline, applied in the XZ plane. */
function smooth(points: Vec3[], halfWindow: number): Vec3[] {
  if (halfWindow <= 0) return points;
  return points.map((_, i) => {
    let x = 0;
    let z = 0;
    let n = 0;
    for (let k = -halfWindow; k <= halfWindow; k++) {
      const p = points[i + k];
      if (!p) continue;
      x += p.x;
      z += p.z;
      n++;
    }
    return { x: x / n, y: points[i]!.y, z: z / n };
  });
}

/**
 * Signed Menger curvature at each station, in 1/m.
 *
 * The sign distinguishes left from right turns, which is what makes slalom
 * detection possible: a slalom is a run of regular sign alternations.
 */
export function computeCurvature(points: Vec3[]): number[] {
  return points.map((p1, i) => {
    const p0 = points[i - 1];
    const p2 = points[i + 1];
    if (!p0 || !p2) return 0;

    const ax = p1.x - p0.x;
    const az = p1.z - p0.z;
    const bx = p2.x - p1.x;
    const bz = p2.z - p1.z;

    const cross = ax * bz - az * bx;
    const la = Math.hypot(ax, az);
    const lb = Math.hypot(bx, bz);
    const lc = distance2d(p0, p2);
    const denom = la * lb * lc;
    if (denom < 1e-9) return 0;
    return (2 * cross) / denom;
  });
}

export interface FusedCenterline {
  points: CenterlinePoint[];
  /** Projector used, so callers can map back to lat/lon. */
  projector: Projector;
  /** Number of runs that contributed. */
  runCount: number;
  /** Total course length in metres. */
  lengthMetres: number;
}

/**
 * Fuses runs into a single centreline.
 *
 * Runs are matched by normalised arc length, which assumes they all traverse the
 * same course in the same direction — true for repeat runs of one autocross
 * layout. Positions are averaged; the per-station standard deviation is retained
 * as `spread`, since tight convergence implies a constraining gate while wide
 * divergence implies open pavement.
 */
export function fuseCenterline(
  runs: Run[],
  options: Partial<CenterlineOptions> = {},
): FusedCenterline {
  if (runs.length === 0) throw new Error("Need at least one run");
  const opt = { ...DEFAULT_CENTERLINE_OPTIONS, ...options };

  const allSamples = runs.flatMap((r) => r.samples);
  const projector = new Projector(anchorOf(allSamples));

  const resampled = runs.map((run) =>
    resampleByArcLength(run.samples, projector, opt.stations),
  );

  const mean: Vec3[] = [];
  const spread: number[] = [];
  const speed: number[] = [];

  for (let station = 0; station < opt.stations; station++) {
    let x = 0;
    let z = 0;
    let v = 0;
    for (const run of resampled) {
      const p = run.positions[station]!;
      x += p.x;
      z += p.z;
      v += run.speeds[station]!;
    }
    const centre: Vec3 = { x: x / resampled.length, y: 0, z: z / resampled.length };
    mean.push(centre);
    speed.push(v / resampled.length);

    let variance = 0;
    for (const run of resampled) {
      const d = distance2d(run.positions[station]!, centre);
      variance += d * d;
    }
    spread.push(Math.sqrt(variance / resampled.length));
  }

  const smoothed = smooth(mean, opt.smoothingWindow);
  const curvature = computeCurvature(smoothed);

  let cumulative = 0;
  const points: CenterlinePoint[] = smoothed.map((position, i) => {
    if (i > 0) cumulative += distance2d(smoothed[i - 1]!, position);
    return {
      position,
      s: i / (opt.stations - 1),
      distance: cumulative,
      speed: speed[i]!,
      spread: spread[i]!,
      curvature: curvature[i]!,
    };
  });

  return {
    points,
    projector,
    runCount: runs.length,
    lengthMetres: cumulative,
  };
}

/** Unit heading at a station, pointing along the direction of travel. */
export function headingAt(points: CenterlinePoint[], index: number): Vec3 {
  const prev = points[Math.max(0, index - 1)]!.position;
  const next = points[Math.min(points.length - 1, index + 1)]!.position;
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, y: 0, z: dz / len };
}
