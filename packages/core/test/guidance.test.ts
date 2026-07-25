import { describe, expect, it } from "vitest";
import {
  buildEdgeLines,
  buildGuidanceMeshes,
  coneSpacingFor,
  corridorCenterline,
} from "../src/geometry/guidance.js";
import { computeCurvature } from "../src/course/centerline.js";
import type { CenterlinePoint, Vec3 } from "../src/types.js";

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
    return { position, s: i / (positions.length - 1), distance, speed: 15, spread: 0, curvature: curvature[i]! };
  });
}

/** 200 m straight heading north, sampled every metre. */
function straight(n = 201): CenterlinePoint[] {
  return centerlineFrom(Array.from({ length: n }, (_, i) => ({ x: 0, y: 0, z: i })));
}

describe("buildEdgeLines", () => {
  it("paints a stripe down each side at the corridor half-width", () => {
    const mesh = buildEdgeLines(straight(), 4.5, 0, 0.2);
    const xs = mesh.vertices.map((v) => v.position.x);

    // Two stripes, centred at -4.5 and +4.5, each 0.2 m wide.
    expect(Math.min(...xs)).toBeCloseTo(-4.6, 6);
    expect(Math.max(...xs)).toBeCloseTo(4.6, 6);

    const leftStripe = xs.filter((x) => x < 0);
    const rightStripe = xs.filter((x) => x > 0);
    expect(leftStripe.length).toBeGreaterThan(0);
    expect(rightStripe.length).toBeGreaterThan(0);
    for (const x of leftStripe) expect(Math.abs(x)).toBeGreaterThan(4.3);
    for (const x of rightStripe) expect(Math.abs(x)).toBeGreaterThan(4.3);
  });

  it("floats above the asphalt to avoid z-fighting", () => {
    const mesh = buildEdgeLines(straight(), 4.5, 0);
    for (const v of mesh.vertices) {
      expect(v.position.y).toBeGreaterThan(0);
      expect(v.position.y).toBeLessThan(0.1);
    }
  });

  it("follows curvature, staying the right distance from a circular centreline", () => {
    const radius = 40;
    const positions: Vec3[] = [];
    for (let i = 0; i <= 180; i++) {
      const a = (i / 180) * Math.PI;
      positions.push({ x: radius * Math.cos(a), y: 0, z: radius * Math.sin(a) });
    }
    const mesh = buildEdgeLines(centerlineFrom(positions), 5, 0, 0.2);

    // Every painted vertex must sit on one of the two offset arcs.
    for (const v of mesh.vertices) {
      const r = Math.hypot(v.position.x, v.position.z);
      const nearInner = Math.abs(r - 35) < 0.5;
      const nearOuter = Math.abs(r - 45) < 0.5;
      expect(nearInner || nearOuter).toBe(true);
    }
  });

  it("produces geometry proportional to the number of segments", () => {
    const short = buildEdgeLines(straight(51), 4.5, 0);
    const long = buildEdgeLines(straight(201), 4.5, 0);
    expect(long.vertices.length).toBeGreaterThan(short.vertices.length * 3);
  });
});

describe("guidance levels", () => {
  it("adds nothing at all in realistic mode", () => {
    expect(buildGuidanceMeshes(straight(), 4.5, 0, { level: "realistic" })).toHaveLength(0);
  });

  it("adds edge lines when guided", () => {
    const meshes = buildGuidanceMeshes(straight(), 4.5, 0, { level: "guided" });
    expect(meshes).toHaveLength(1);
    expect(meshes[0]!.name).toBe("paint_edges");
  });

  it("adds edge lines when training, with direction left to pointer cones", () => {
    const meshes = buildGuidanceMeshes(straight(), 4.5, 0, { level: "training" });
    expect(meshes.map((m) => m.name)).toEqual(["paint_edges"]);
  });

  it("keeps guidance non-physical so it never affects the car", () => {
    // Paint must not carry a `1` (drivable) or `n` (collidable) name prefix.
    for (const level of ["guided", "training"] as const) {
      for (const mesh of buildGuidanceMeshes(straight(), 4.5, 0, { level })) {
        expect(mesh.name).not.toMatch(/^[0-9]/);
        expect(mesh.name).not.toMatch(/^n/);
      }
    }
  });

  it("tightens cone spacing as guidance increases", () => {
    const realistic = coneSpacingFor("realistic");
    const guided = coneSpacingFor("guided");
    const training = coneSpacingFor("training");
    expect(guided.straight).toBeLessThan(realistic.straight);
    expect(training.straight).toBeLessThan(guided.straight);
    expect(training.corner).toBeLessThan(guided.corner);
  });
});

describe("corridor through slaloms", () => {
  /**
   * Edge lines built on the driven line snake through a slalom, because the
   * driven line is a wave while the cones sit in a straight row. The corridor
   * must instead run straight along the cone axis, so the driver weaves across
   * the paint — which is what a slalom actually looks like.
   */
  function weave(amplitude = 3, wavelength = 36, samples = 400): CenterlinePoint[] {
    const positions: Vec3[] = [];
    for (let i = 0; i <= samples; i++) {
      const z = i * 0.5;
      positions.push({ x: amplitude * Math.sin((z / wavelength) * Math.PI * 2), y: 0, z });
    }
    return centerlineFrom(positions);
  }

  it("follows the driven line when there is no slalom", () => {
    const points = weave();
    const line = corridorCenterline(points, []);
    line.forEach((p, i) => expect(p.x).toBeCloseTo(points[i]!.position.x, 9));
  });

  it("runs straight along the axis through a slalom, not weaving with the driver", () => {
    const points = weave(3);
    // Slalom occupies the middle of the trace, so there is untouched line either
    // side of the blended margins.
    const span = {
      from: 150,
      to: 250,
      // The real cone line: dead straight at x = 0.
      axis: Array.from({ length: 6 }, (_, i) => ({ x: 0, y: 0, z: 75 + i * 10 })),
    };
    const line = corridorCenterline(points, [span]);

    // Inside the slalom the corridor must hug the axis, not the ±3 m weave.
    for (let i = span.from; i <= span.to; i++) {
      expect(Math.abs(line[i]!.x)).toBeLessThan(1.0);
    }
    // Well clear of the slalom and its blend margins, the driven line is untouched.
    expect(line[5]!.x).toBeCloseTo(points[5]!.position.x, 6);
    expect(line[395]!.x).toBeCloseTo(points[395]!.position.x, 6);
  });

  it("joins the driven line without a kink", () => {
    const points = weave(3);
    const span = {
      from: 150,
      to: 250,
      axis: Array.from({ length: 6 }, (_, i) => ({ x: 0, y: 0, z: 75 + i * 10 })),
    };
    const line = corridorCenterline(points, [span]);

    // No step change anywhere along the blended corridor.
    for (let i = 1; i < line.length; i++) {
      const step = Math.hypot(line[i]!.x - line[i - 1]!.x, line[i]!.z - line[i - 1]!.z);
      expect(step).toBeLessThan(2);
    }
  });

  it("paints through the slalom rather than leaving a gap", () => {
    const points = weave(3);
    const span = {
      from: 150,
      to: 250,
      axis: Array.from({ length: 6 }, (_, i) => ({ x: 0, y: 0, z: 75 + i * 10 })),
    };
    const withSlalom = buildEdgeLines(points, 4.5, 0, 0.15, "paint_edges", [span]);
    const without = buildEdgeLines(points, 4.5, 0, 0.15, "paint_edges", []);
    // Same amount of paint: the slalom is covered, just along a different line.
    expect(withSlalom.vertices.length).toBe(without.vertices.length);
  });
});
