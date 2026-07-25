import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGpsCsv } from "../src/csv/parse.js";
import { splitRuns } from "../src/csv/splitRuns.js";
import { computeCurvature, fuseCenterline, headingAt } from "../src/course/centerline.js";
import { buildReturnPath } from "../src/course/loop.js";
import { classifySection, detectSlaloms, layoutCones, DEFAULT_CONE_OPTIONS } from "../src/course/cones.js";
import type { CenterlinePoint, Run, Vec3 } from "../src/types.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/run1-8.csv", import.meta.url));
const csvText = readFileSync(FIXTURE, "utf8");

function fixtureRuns(): Run[] {
  return splitRuns(parseGpsCsv(csvText).samples, "run1-8.csv");
}

/** Builds centreline points directly from positions, for geometry-only tests. */
function centerlineFrom(positions: Vec3[]): CenterlinePoint[] {
  const curvature = computeCurvature(positions);
  let distance = 0;
  return positions.map((position, i) => {
    if (i > 0) {
      distance += Math.hypot(
        position.x - positions[i - 1]!.x,
        position.z - positions[i - 1]!.z,
      );
    }
    return {
      position,
      s: i / (positions.length - 1),
      distance,
      speed: 15,
      spread: 0,
      curvature: curvature[i]!,
    };
  });
}

describe("computeCurvature", () => {
  it("matches 1/radius on a circle", () => {
    const radius = 25;
    const positions: Vec3[] = [];
    for (let i = 0; i < 100; i++) {
      const a = (i / 100) * Math.PI * 2;
      positions.push({ x: radius * Math.cos(a), y: 0, z: radius * Math.sin(a) });
    }
    const curvature = computeCurvature(positions);
    // Ignore endpoints, which have no neighbour on one side.
    for (const k of curvature.slice(2, -2)) {
      expect(Math.abs(k)).toBeCloseTo(1 / radius, 3);
    }
  });

  it("signs a right turn negative and a left turn positive", () => {
    // Heading north (+Z), then curving east (+X) — a right turn.
    const right = computeCurvature([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 5, y: 0, z: 18 },
    ]);
    expect(right[1]!).toBeLessThan(0);

    // Heading north, then curving west — a left turn.
    const left = computeCurvature([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: -5, y: 0, z: 18 },
    ]);
    expect(left[1]!).toBeGreaterThan(0);
  });

  it("returns zero curvature on a straight line", () => {
    const straight = computeCurvature([
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 10 },
      { x: 0, y: 0, z: 20 },
    ]);
    expect(straight[1]!).toBeCloseTo(0, 9);
  });
});

describe("fuseCenterline", () => {
  it("reconstructs the fixture course at roughly its logged length", () => {
    const fused = fuseCenterline(fixtureRuns());
    expect(fused.runCount).toBe(1);
    // Logged elapsed distance is 1176 m; smoothing shortens it slightly.
    expect(fused.lengthMetres).toBeGreaterThan(1100);
    expect(fused.lengthMetres).toBeLessThan(1200);
    expect(fused.points).toHaveLength(400);
    expect(fused.points[0]!.s).toBe(0);
    expect(fused.points[399]!.s).toBe(1);
  });

  it("reports near-zero spread when the same run is supplied repeatedly", () => {
    const [run] = fixtureRuns();
    const fused = fuseCenterline([run!, run!, run!]);
    expect(fused.runCount).toBe(3);
    const maxSpread = Math.max(...fused.points.map((p) => p.spread));
    expect(maxSpread).toBeCloseTo(0, 6);
  });

  it("reports non-zero spread when runs differ, and averages between them", () => {
    const [run] = fixtureRuns();
    // Shift one copy 4 m east by nudging longitude.
    const shifted: Run = {
      ...run!,
      samples: run!.samples.map((s) => ({ ...s, lon: s.lon + 0.000048 })),
    };
    const fused = fuseCenterline([run!, shifted]);
    const meanSpread =
      fused.points.reduce((sum, p) => sum + p.spread, 0) / fused.points.length;
    // Two runs 4 m apart sit 2 m either side of the mean.
    expect(meanSpread).toBeGreaterThan(1);
    expect(meanSpread).toBeLessThan(3);
  });

  it("keeps distance monotonically increasing", () => {
    const fused = fuseCenterline(fixtureRuns());
    for (let i = 1; i < fused.points.length; i++) {
      expect(fused.points[i]!.distance).toBeGreaterThanOrEqual(fused.points[i - 1]!.distance);
    }
  });

  it("rejects an empty run list", () => {
    expect(() => fuseCenterline([])).toThrow(/at least one run/);
  });
});

describe("detectSlaloms", () => {
  it("finds a synthetic slalom", () => {
    // A sine weave: 8 cones at 18 m spacing, 3 m amplitude.
    const positions: Vec3[] = [];
    for (let i = 0; i <= 300; i++) {
      const z = i * 0.5; // 150 m long
      positions.push({ x: 3 * Math.sin((z / 18) * Math.PI), y: 0, z });
    }
    const groups = detectSlaloms(centerlineFrom(positions), DEFAULT_CONE_OPTIONS);
    expect(groups.length).toBeGreaterThanOrEqual(1);
    const longest = groups.reduce((a, b) => (a.length >= b.length ? a : b));
    expect(longest.length).toBeGreaterThanOrEqual(6);
    // Peaks must alternate direction — that is what makes it a slalom.
    for (let i = 1; i < longest.length; i++) {
      expect(Math.sign(longest[i]!.curvature)).not.toBe(Math.sign(longest[i - 1]!.curvature));
    }
  });

  it("finds no slalom on a straight", () => {
    const positions: Vec3[] = [];
    for (let i = 0; i <= 200; i++) positions.push({ x: 0, y: 0, z: i });
    expect(detectSlaloms(centerlineFrom(positions), DEFAULT_CONE_OPTIONS)).toHaveLength(0);
  });

  it("finds no slalom on a steady circle, which never alternates", () => {
    const positions: Vec3[] = [];
    for (let i = 0; i < 200; i++) {
      const a = (i / 200) * Math.PI * 2;
      positions.push({ x: 30 * Math.cos(a), y: 0, z: 30 * Math.sin(a) });
    }
    expect(detectSlaloms(centerlineFrom(positions), DEFAULT_CONE_OPTIONS)).toHaveLength(0);
  });
});

describe("classifySection", () => {
  it("separates straights, sweepers and tight corners by radius", () => {
    expect(classifySection(0, DEFAULT_CONE_OPTIONS)).toBe("straight");
    expect(classifySection(1 / 500, DEFAULT_CONE_OPTIONS)).toBe("straight");
    expect(classifySection(1 / 50, DEFAULT_CONE_OPTIONS)).toBe("sweeper");
    expect(classifySection(-1 / 50, DEFAULT_CONE_OPTIONS)).toBe("sweeper");
    expect(classifySection(1 / 10, DEFAULT_CONE_OPTIONS)).toBe("tight");
  });
});

describe("layoutCones", () => {
  it("lays out a plausible course for the real fixture", () => {
    const fused = fuseCenterline(fixtureRuns());
    const { cones } = layoutCones(fused.points);

    expect(cones.length).toBeGreaterThan(20);
    expect(cones.filter((c) => c.type === "start")).toHaveLength(2);
    expect(cones.filter((c) => c.type === "finish")).toHaveLength(2);

    // Every cone must sit within the lot, not out in a field somewhere.
    const xs = fused.points.map((p) => p.position.x);
    const zs = fused.points.map((p) => p.position.z);
    const margin = 20;
    for (const cone of cones) {
      expect(cone.position.x).toBeGreaterThan(Math.min(...xs) - margin);
      expect(cone.position.x).toBeLessThan(Math.max(...xs) + margin);
      expect(cone.position.z).toBeGreaterThan(Math.min(...zs) - margin);
      expect(cone.position.z).toBeLessThan(Math.max(...zs) + margin);
    }
  });

  it("separates gate pairs by exactly the configured width", () => {
    const positions: Vec3[] = [];
    for (let i = 0; i <= 200; i++) positions.push({ x: 0, y: 0, z: i });
    const { cones } = layoutCones(centerlineFrom(positions), { gateWidth: 12 });

    const byStation = new Map<number, typeof cones>();
    for (const cone of cones) {
      if (cone.side === 0) continue;
      const list = byStation.get(cone.station) ?? [];
      list.push(cone);
      byStation.set(cone.station, list);
    }
    expect(byStation.size).toBeGreaterThan(2);
    for (const pair of byStation.values()) {
      expect(pair).toHaveLength(2);
      const [a, b] = pair;
      expect(Math.hypot(a!.position.x - b!.position.x, a!.position.z - b!.position.z)).toBeCloseTo(12, 6);
    }
  });

  it("puts the left cone on the left of travel", () => {
    // Heading north, so left of travel is west (negative X).
    const positions: Vec3[] = [];
    for (let i = 0; i <= 200; i++) positions.push({ x: 0, y: 0, z: i });
    const { cones } = layoutCones(centerlineFrom(positions), { gateWidth: 10 });
    for (const cone of cones) {
      if (cone.side === -1) expect(cone.position.x).toBeCloseTo(-5, 6);
      if (cone.side === 1) expect(cone.position.x).toBeCloseTo(5, 6);
    }
  });

  it("spaces gates more tightly through corners than on straights", () => {
    const straight: Vec3[] = [];
    for (let i = 0; i <= 400; i++) straight.push({ x: 0, y: 0, z: i * 0.5 });
    const circle: Vec3[] = [];
    for (let i = 0; i <= 400; i++) {
      const a = (i / 400) * Math.PI * 2;
      circle.push({ x: 15 * Math.cos(a), y: 0, z: 15 * Math.sin(a) });
    }
    const straightGates = layoutCones(centerlineFrom(straight)).cones.filter((c) => c.side === -1).length;
    const cornerGates = layoutCones(centerlineFrom(circle), { detectSlaloms: false }).cones.filter(
      (c) => c.side === -1,
    ).length;
    // Both are ~200 m long, so the tighter course must yield more gates.
    expect(cornerGates).toBeGreaterThan(straightGates);
  });
});

describe("buildReturnPath", () => {
  it("connects the finish back to the start", () => {
    const fused = fuseCenterline(fixtureRuns());
    const path = buildReturnPath(fused.points);
    expect(path.length).toBeGreaterThan(10);

    const finish = fused.points[fused.points.length - 1]!.position;
    const start = fused.points[0]!.position;
    const first = path[0]!;
    const last = path[path.length - 1]!;

    // The path should leave near the finish and arrive near the start.
    expect(Math.hypot(first.x - finish.x, first.z - finish.z)).toBeLessThan(20);
    expect(Math.hypot(last.x - start.x, last.z - start.z)).toBeLessThan(20);
  });

  it("produces a smooth path with no sudden jumps", () => {
    const fused = fuseCenterline(fixtureRuns());
    const path = buildReturnPath(fused.points);
    const steps: number[] = [];
    for (let i = 1; i < path.length; i++) {
      steps.push(Math.hypot(path[i]!.x - path[i - 1]!.x, path[i]!.z - path[i - 1]!.z));
    }
    const mean = steps.reduce((a, b) => a + b, 0) / steps.length;
    for (const step of steps) {
      expect(step).toBeLessThan(mean * 3);
    }
  });

  it("leaves the finish travelling forwards rather than doubling back", () => {
    const fused = fuseCenterline(fixtureRuns());
    const path = buildReturnPath(fused.points);
    const finishHeading = headingAt(fused.points, fused.points.length - 1);
    const exit = {
      x: path[0]!.x - fused.points[fused.points.length - 1]!.position.x,
      z: path[0]!.z - fused.points[fused.points.length - 1]!.position.z,
    };
    const dot = finishHeading.x * exit.x + finishHeading.z * exit.z;
    expect(dot).toBeGreaterThan(0);
  });
});

describe("slalom cone placement", () => {
  /**
   * A real slalom's cones are collinear and the driver weaves around them. The
   * original implementation offset each cone from the driven apex by a fixed
   * distance, which produced a ZIGZAG of cones whenever the driver's weave
   * amplitude differed from that constant. These tests lock in the real shape.
   */
  function sineSlalom(amplitude: number, wavelength = 36, length = 180): Vec3[] {
    const positions: Vec3[] = [];
    for (let i = 0; i <= length * 2; i++) {
      const z = i * 0.5;
      positions.push({ x: amplitude * Math.sin((z / wavelength) * Math.PI * 2), y: 0, z });
    }
    return positions;
  }

  it("places slalom cones in a line, not alternating sides", () => {
    // Driver weaves 3 m either side of an axis at x = 0.
    const { cones } = layoutCones(centerlineFrom(sineSlalom(3)), { detectSlaloms: true });
    const slalom = cones.filter((c) => c.type === "slalom");
    expect(slalom.length).toBeGreaterThanOrEqual(4);

    // Every cone must sit ON the axis, not out at the weave extremes (±3 m).
    for (const cone of slalom) {
      expect(Math.abs(cone.position.x)).toBeLessThan(0.25);
    }
  });

  it("stays collinear regardless of how wide the driver weaves", () => {
    // The old fixed-offset bug got worse as amplitude grew; this pins that down.
    for (const amplitude of [2, 3, 5, 8]) {
      const { cones } = layoutCones(centerlineFrom(sineSlalom(amplitude)), {
        detectSlaloms: true,
      });
      const slalom = cones.filter((c) => c.type === "slalom");
      expect(slalom.length).toBeGreaterThanOrEqual(4);
      // Residual must not scale with amplitude — that was the original bug.
      for (const cone of slalom) {
        expect(Math.abs(cone.position.x)).toBeLessThan(0.25);
      }
      // And they must not alternate about the axis.
      const signs = slalom.map((c) => Math.sign(c.position.x));
      let flips = 0;
      for (let i = 1; i < signs.length; i++) if (signs[i] !== signs[i - 1]) flips++;
      expect(flips).toBeLessThan(slalom.length - 1);
    }
  });

  it("spaces slalom cones evenly along the course", () => {
    const points = centerlineFrom(sineSlalom(3));
    const { cones } = layoutCones(points, { detectSlaloms: true });
    const slalom = cones.filter((c) => c.type === "slalom").sort((a, b) => a.station - b.station);

    const gaps: number[] = [];
    for (let i = 1; i < slalom.length; i++) {
      gaps.push(points[slalom[i]!.station]!.distance - points[slalom[i - 1]!.station]!.distance);
    }
    const mean = gaps.reduce((a, b) => a + b, 0) / gaps.length;
    // Half a wavelength between cones, and reasonably regular.
    expect(mean).toBeGreaterThan(10);
    for (const gap of gaps) expect(Math.abs(gap - mean)).toBeLessThan(mean * 0.5);
  });

  it("reports the station span of each detected slalom", () => {
    const { slalomSpans } = layoutCones(centerlineFrom(sineSlalom(3)), { detectSlaloms: true });
    expect(slalomSpans.length).toBeGreaterThanOrEqual(1);
    for (const span of slalomSpans) expect(span.to).toBeGreaterThan(span.from);
  });
});
