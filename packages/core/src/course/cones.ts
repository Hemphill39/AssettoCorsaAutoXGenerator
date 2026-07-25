import { headingAt } from "./centerline.js";
import { leftOf, rightOf } from "../geo/project.js";
import type { CenterlinePoint, Vec3 } from "../types.js";

/**
 * Infers a cone layout from a reconstructed centreline.
 *
 * This is a plausible course that fits the driven line, not the course that was
 * actually set out — see centerline.ts. Treat every position here as an editable
 * starting point.
 */

/**
 * `pointer` is a cone laid on its side pointing the way to go — standard
 * autocross practice for marking direction where a course could be ambiguous.
 */
export type ConeType = "gate" | "slalom" | "start" | "finish" | "pointer";

export interface Cone {
  position: Vec3;
  type: ConeType;
  /** -1 = left of travel, +1 = right, 0 = a standalone slalom cone. */
  side: -1 | 0 | 1;
  /** Index into the centreline this cone was derived from. */
  station: number;
  /** Direction a pointer cone indicates; unused by upright cones. */
  forward?: Vec3;
}

export type SectionKind = "straight" | "sweeper" | "tight";

export interface ConeLayoutOptions {
  /** Distance between the cones of a gate pair, in metres (~30 ft). */
  gateWidth: number;
  /** Gate spacing along straights, in metres. */
  straightSpacing: number;
  /** Gate spacing through tight corners, in metres. */
  cornerSpacing: number;
  /** |curvature| above this is a corner rather than a straight. 1/m. */
  sweeperCurvature: number;
  /** |curvature| above this is a tight corner. 1/m. */
  tightCurvature: number;
  detectSlaloms: boolean;
  /** Minimum alternating peaks required before a section counts as a slalom. */
  minSlalomPeaks: number;
  /** Lay pointer cones at direction changes. */
  pointerCones: boolean;
  /** Minimum gap between pointer cones, in metres. */
  pointerSpacing: number;
}

export const DEFAULT_CONE_OPTIONS: ConeLayoutOptions = {
  gateWidth: 9,
  straightSpacing: 22,
  cornerSpacing: 9,
  sweeperCurvature: 0.01, // radius 100 m
  tightCurvature: 0.05, // radius 20 m
  detectSlaloms: true,
  minSlalomPeaks: 3,
  pointerCones: true,
  pointerSpacing: 20,
};

export function classifySection(curvature: number, opt: ConeLayoutOptions): SectionKind {
  const k = Math.abs(curvature);
  if (k >= opt.tightCurvature) return "tight";
  if (k >= opt.sweeperCurvature) return "sweeper";
  return "straight";
}

/** Local curvature maxima, which is where a driver is closest to a cone. */
interface Peak {
  station: number;
  curvature: number;
}

function findCurvaturePeaks(points: CenterlinePoint[], minCurvature: number): Peak[] {
  const peaks: Peak[] = [];
  for (let i = 1; i < points.length - 1; i++) {
    const k = points[i]!.curvature;
    const prev = points[i - 1]!.curvature;
    const next = points[i + 1]!.curvature;
    if (Math.abs(k) < minCurvature) continue;
    // Strictly greater than one neighbour and at least equal to the other, so
    // plateaus register exactly once.
    const isPeak =
      (Math.abs(k) > Math.abs(prev) && Math.abs(k) >= Math.abs(next)) ||
      (Math.abs(k) >= Math.abs(prev) && Math.abs(k) > Math.abs(next));
    if (isPeak) peaks.push({ station: i, curvature: k });
  }
  return peaks;
}

/**
 * Finds runs of alternating-direction curvature peaks — the signature of a slalom.
 *
 * A driver weaving through a cone line produces regularly spaced peaks whose
 * direction flips at every cone.
 */
export function detectSlaloms(
  points: CenterlinePoint[],
  opt: ConeLayoutOptions,
): Peak[][] {
  const peaks = findCurvaturePeaks(points, opt.sweeperCurvature);
  const groups: Peak[][] = [];
  let current: Peak[] = [];

  for (let i = 0; i < peaks.length; i++) {
    const peak = peaks[i]!;
    const prev = current[current.length - 1];
    if (!prev) {
      current = [peak];
      continue;
    }
    const alternates = Math.sign(peak.curvature) !== Math.sign(prev.curvature);
    const gap = points[peak.station]!.distance - points[prev.station]!.distance;
    // Real slaloms sit roughly 15-25 m apart; allow a generous band.
    const plausibleSpacing = gap >= 8 && gap <= 40;
    if (alternates && plausibleSpacing) {
      current.push(peak);
    } else {
      if (current.length >= opt.minSlalomPeaks) groups.push(current);
      current = [peak];
    }
  }
  if (current.length >= opt.minSlalomPeaks) groups.push(current);
  return groups;
}

function offsetFrom(point: Vec3, direction: Vec3, distance: number): Vec3 {
  return {
    x: point.x + direction.x * distance,
    y: point.y,
    z: point.z + direction.z * distance,
  };
}

export interface ConeLayout {
  cones: Cone[];
  /** Stations classified as part of a detected slalom. */
  slalomStations: Set<number>;
  /** Inclusive station ranges covered by each detected slalom. */
  slalomSpans: SlalomSpan[];
}

export interface SlalomSpan {
  from: number;
  to: number;
  /** The cone line itself: the axis the driver weaves around. */
  axis: Vec3[];
}

/**
 * The centre axis a slalom is built around.
 *
 * A slalom's cones sit in a line and the driver weaves around them, so the
 * driven trace is a wave oscillating about that line. Averaging the trace over
 * one full wave period cancels the oscillation and recovers the axis — which is
 * where the cones actually were.
 *
 * A full period spans two consecutive curvature peaks (the driver reaches
 * maximum offset once per cone, alternating sides), so the averaging window is
 * ±one peak spacing.
 */
function slalomAxisPositions(
  points: CenterlinePoint[],
  group: Peak[],
): Map<number, Vec3> {
  const apex = group.map((peak) => points[peak.station]!.position);
  const axis: Vec3[] = new Array(apex.length);

  /**
   * Successive apexes lie on opposite sides of the axis by definition — that
   * alternation is what identified this as a slalom — so the [1,2,1]/4 average
   * of three consecutive apexes cancels the excursion exactly:
   * (−A + 2·0 + −A)/4 offsets to zero for a symmetric weave, while a genuinely
   * curving slalom axis survives as the low-order trend.
   *
   * Averaging over a window of trace samples instead leaves a residual tilt
   * (a least-squares fit against a sinusoid has a nonzero first moment even over
   * whole periods), which showed up as slalom cones drifting off the line.
   */
  for (let i = 1; i < apex.length - 1; i++) {
    const prev = apex[i - 1]!;
    const cur = apex[i]!;
    const next = apex[i + 1]!;
    axis[i] = {
      x: (prev.x + 2 * cur.x + next.x) / 4,
      y: 0,
      z: (prev.z + 2 * cur.z + next.z) / 4,
    };
  }

  // The outermost cones have no neighbour on one side. Their correction is very
  // nearly the negation of their neighbour's, since consecutive apexes sit on
  // opposite sides of the axis.
  const mirrorEnd = (endIndex: number, neighbourIndex: number): Vec3 => {
    const end = apex[endIndex]!;
    const neighbour = apex[neighbourIndex]!;
    const corrected = axis[neighbourIndex];
    if (!corrected) return { x: end.x, y: 0, z: end.z };
    return {
      x: end.x - (corrected.x - neighbour.x),
      y: 0,
      z: end.z - (corrected.z - neighbour.z),
    };
  };

  if (apex.length >= 3) {
    axis[0] = mirrorEnd(0, 1);
    axis[apex.length - 1] = mirrorEnd(apex.length - 1, apex.length - 2);
  } else {
    for (let i = 0; i < apex.length; i++) axis[i] ??= { ...apex[i]!, y: 0 };
  }

  const result = new Map<number, Vec3>();
  group.forEach((peak, i) => {
    result.set(peak.station, axis[i] ?? { ...apex[i]!, y: 0 });
  });
  return result;
}

/**
 * Places cones along the centreline.
 *
 * Gates are pairs straddling the line, spaced more tightly through corners where
 * a driver needs more definition. Detected slaloms instead get single cones laid
 * out in a line along the weave's centre axis, which is how a real slalom is set
 * out: the cones are collinear and the driver weaves around them.
 */
export function layoutCones(
  points: CenterlinePoint[],
  options: Partial<ConeLayoutOptions> = {},
): ConeLayout {
  const opt = { ...DEFAULT_CONE_OPTIONS, ...options };
  if (points.length < 2) throw new Error("Centreline too short to lay out cones");

  const cones: Cone[] = [];
  const slalomStations = new Set<number>();
  const half = opt.gateWidth / 2;

  const addGate = (station: number, type: ConeType): void => {
    const point = points[station]!;
    const heading = headingAt(points, station);
    cones.push({
      position: offsetFrom(point.position, leftOf(heading), half),
      type,
      side: -1,
      station,
    });
    cones.push({
      position: offsetFrom(point.position, rightOf(heading), half),
      type,
      side: 1,
      station,
    });
  };

  const slalomSpans: SlalomSpan[] = [];

  if (opt.detectSlaloms) {
    for (const group of detectSlaloms(points, opt)) {
      // Cones go ON the weave's centre axis, in a line. Offsetting each apex by a
      // fixed distance instead would produce a zigzag of cones — which is not
      // what a slalom is, and was the original bug here.
      const axis = slalomAxisPositions(points, group);
      for (const peak of group) {
        slalomStations.add(peak.station);
        cones.push({
          position: axis.get(peak.station) ?? points[peak.station]!.position,
          type: "slalom",
          side: 0,
          station: peak.station,
        });
      }
      slalomSpans.push({
        from: group[0]!.station,
        to: group[group.length - 1]!.station,
        axis: group.map((peak) => axis.get(peak.station) ?? points[peak.station]!.position),
      });
    }
  }

  addGate(0, "start");

  // Walk the course placing gates, skipping any stretch already covered by a
  // slalom so we don't clutter it with contradictory gates.
  let lastPlacedDistance = points[0]!.distance;
  for (let i = 1; i < points.length - 1; i++) {
    const point = points[i]!;
    const kind = classifySection(point.curvature, opt);
    const spacing =
      kind === "tight"
        ? opt.cornerSpacing
        : kind === "sweeper"
          ? (opt.cornerSpacing + opt.straightSpacing) / 2
          : opt.straightSpacing;

    if (point.distance - lastPlacedDistance < spacing) continue;

    const nearSlalom = [...slalomStations].some(
      (station) => Math.abs(points[station]!.distance - point.distance) < 12,
    );
    if (nearSlalom) {
      lastPlacedDistance = point.distance;
      continue;
    }

    addGate(i, "gate");
    lastPlacedDistance = point.distance;
  }

  addGate(points.length - 1, "finish");

  /**
   * Pointer cones at direction changes.
   *
   * Standard autocross practice: a cone laid on its side pointing where to go
   * next, placed wherever the course could be read two ways. Laid just outside
   * the corridor on the outside of the turn, where a driver looking ahead through
   * the corner naturally sees it.
   */
  if (opt.pointerCones) {
    let lastPointerAt = -Infinity;
    for (let i = 2; i < points.length - 2; i++) {
      const point = points[i]!;
      if (slalomStations.has(i)) continue; // a slalom's own cones say which way
      if (classifySection(point.curvature, opt) === "straight") continue;
      if (point.distance - lastPointerAt < opt.pointerSpacing) continue;

      const heading = headingAt(points, i);
      // Positive curvature turns left, so the outside of the turn is to the right.
      const outside = point.curvature > 0 ? rightOf(heading) : leftOf(heading);
      cones.push({
        position: offsetFrom(point.position, outside, half + 1.2),
        type: "pointer",
        side: 0,
        station: i,
        forward: heading,
      });
      lastPointerAt = point.distance;
    }
  }

  return { cones, slalomStations, slalomSpans };
}
