import { describe, expect, it } from "vitest";
import {
  buildDirectionArrows,
  buildEdgeLines,
  buildGuidanceMeshes,
  coneSpacingFor,
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

describe("buildDirectionArrows", () => {
  it("spaces chevrons along the course at the requested interval", () => {
    const mesh = buildDirectionArrows(straight(), 0, 25);
    // 200 m at 25 m spacing, 3 vertices per triangle.
    expect(mesh.vertices.length / 3).toBeGreaterThanOrEqual(6);
    expect(mesh.vertices.length / 3).toBeLessThanOrEqual(9);
  });

  it("points chevrons along the direction of travel", () => {
    const mesh = buildDirectionArrows(straight(), 0, 50);
    // Heading north, so each apex must be north of its own base.
    for (let i = 0; i < mesh.vertices.length; i += 3) {
      const zs = [
        mesh.vertices[i]!.position.z,
        mesh.vertices[i + 1]!.position.z,
        mesh.vertices[i + 2]!.position.z,
      ];
      const apex = Math.max(...zs);
      const base = Math.min(...zs);
      expect(apex - base).toBeGreaterThan(1);
    }
  });

  it("emits nothing for a course shorter than one interval", () => {
    expect(buildDirectionArrows(straight(10), 0, 50).vertices).toHaveLength(0);
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

  it("adds edge lines and chevrons when training", () => {
    const meshes = buildGuidanceMeshes(straight(), 4.5, 0, { level: "training" });
    expect(meshes.map((m) => m.name)).toEqual(["paint_edges", "paint_arrows"]);
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
