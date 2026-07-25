import { describe, expect, it } from "vitest";
import { acToScene, sceneToAc, toSceneArray, turnSign, TOP_DOWN_UP } from "../src/geo/preview.js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGpsCsv } from "../src/csv/parse.js";
import { splitRuns } from "../src/csv/splitRuns.js";
import { fuseCenterline } from "../src/course/centerline.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/run1-8.csv", import.meta.url));

describe("AC <-> three.js coordinate mapping", () => {
  it("round-trips exactly", () => {
    const original = { x: 12.5, y: 3, z: -47.25 };
    expect(sceneToAc(acToScene(original))).toEqual(original);
  });

  it("flips handedness by negating exactly one axis", () => {
    const scene = acToScene({ x: 5, y: 2, z: 9 });
    expect(scene.x).toBe(5);
    expect(scene.y).toBe(2);
    expect(scene.z).toBe(-9);
  });

  it("reverses turn direction, which is what prevents a mirrored preview", () => {
    // A right turn in AC space: heading north, curving east.
    const a = { x: 0, y: 0, z: 0 };
    const b = { x: 0, y: 0, z: 10 };
    const c = { x: 5, y: 0, z: 18 };

    const acSign = turnSign(a, b, c);
    const sceneSign = turnSign(acToScene(a), acToScene(b), acToScene(c));

    expect(acSign).not.toBe(0);
    // The sign MUST flip. If it did not, we would be rendering a mirror image.
    expect(sceneSign).toBe(-acSign);
  });

  it("orients a top-down view as a map: north up, east right", () => {
    // With camera up = (0,0,-1), screen-up is the -Z scene direction.
    const north = acToScene({ x: 0, y: 0, z: 1 });
    const east = acToScene({ x: 1, y: 0, z: 0 });

    // North must land on the screen-up axis, i.e. negative scene Z.
    expect(north.z).toBeLessThan(0);
    expect(TOP_DOWN_UP.z).toBe(-1);
    // East must remain screen-right, i.e. positive scene X.
    expect(east.x).toBeGreaterThan(0);
  });

  it("builds a packed vertex array in scene space", () => {
    const array = toSceneArray([
      { x: 1, y: 2, z: 3 },
      { x: 4, y: 5, z: 6 },
    ]);
    expect(Array.from(array)).toEqual([1, 2, -3, 4, 5, -6]);
  });

  it("preserves distances and course shape for the real run", () => {
    const runs = splitRuns(parseGpsCsv(readFileSync(FIXTURE, "utf8")).samples, "run1-8.csv");
    const points = fuseCenterline(runs).points.map((p) => p.position);
    const scene = points.map(acToScene);

    // A handedness flip is a reflection, so every pairwise distance is preserved.
    for (let i = 1; i < points.length; i += 17) {
      const acDist = Math.hypot(
        points[i]!.x - points[i - 1]!.x,
        points[i]!.z - points[i - 1]!.z,
      );
      const sceneDist = Math.hypot(
        scene[i]!.x - scene[i - 1]!.x,
        scene[i]!.z - scene[i - 1]!.z,
      );
      expect(sceneDist).toBeCloseTo(acDist, 9);
    }
  });
});
