import type { CenterlinePoint, Vec3 } from "../types.js";

/**
 * The line the course corridor follows — the single source of truth for where
 * the edges of the course are.
 *
 * Normally this is the driven centreline. Through a slalom it is the cone axis
 * instead: the driven line there is a wave, so anything built on it snakes
 * around cones that actually sit in a straight row.
 *
 * Cone gates *and* painted edge lines must both be built from this, or they
 * disagree wherever the two lines differ — which reads to a driver as the paint
 * being wrong.
 */

export interface SlalomSpan {
  from: number;
  to: number;
  /** The cone line itself: the axis the driver weaves around. */
  axis: Vec3[];
}

/** Stations over which a span is blended in and out of the driven line. */
export function blendMargin(span: SlalomSpan): number {
  return Math.max(2, Math.round((span.to - span.from) * 0.25));
}

/**
 * True where the corridor deviates from the driven line, including the blend
 * ramps. Gates must not be placed here: they would be built on one line while
 * the paint beside them follows another.
 */
export function isBlended(spans: SlalomSpan[], station: number): boolean {
  return spans.some((span) => {
    const margin = blendMargin(span);
    return station >= span.from - margin && station <= span.to + margin;
  });
}

export function corridorCenterline(
  points: CenterlinePoint[],
  slalomSpans: SlalomSpan[] = [],
): Vec3[] {
  const out = points.map((p) => ({ ...p.position }));

  for (const span of slalomSpans) {
    if (span.axis.length < 2 || span.to <= span.from) continue;
    const core = span.to - span.from;
    const margin = blendMargin(span);
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

/** Unit heading along a plain position polyline. */
export function headingOfLine(line: Vec3[], index: number): Vec3 {
  const prev = line[Math.max(0, index - 1)]!;
  const next = line[Math.min(line.length - 1, index + 1)]!;
  const dx = next.x - prev.x;
  const dz = next.z - prev.z;
  const len = Math.hypot(dx, dz) || 1;
  return { x: dx / len, y: 0, z: dz / len };
}
