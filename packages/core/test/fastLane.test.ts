import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { AiLaneError, buildAiLane, decodeFastLane, encodeFastLane } from "../src/ai/fastLane.js";
import { parseGpsCsv } from "../src/csv/parse.js";
import { splitRuns } from "../src/csv/splitRuns.js";
import { fuseCenterline } from "../src/course/centerline.js";
import type { Vec3 } from "../src/types.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/run1-8.csv", import.meta.url));
const csvText = readFileSync(FIXTURE, "utf8");

function straightLine(n = 50): Vec3[] {
  return Array.from({ length: n }, (_, i) => ({ x: 0, y: 0, z: i * 2 }));
}

describe("encodeFastLane", () => {
  it("round-trips to exactly EOF", () => {
    const points = buildAiLane(straightLine(), new Array(50).fill(20), 4.5);
    const decoded = decodeFastLane(encodeFastLane(points, { lapTimeMs: 78_500 }));
    expect(decoded.bytesConsumed).toBe(decoded.totalBytes);
    expect(decoded.version).toBe(7);
    expect(decoded.pointCount).toBe(50);
    expect(decoded.hasGrid).toBe(false);
  });

  it("has the byte length the format dictates", () => {
    const n = 50;
    const bytes = encodeFastLane(buildAiLane(straightLine(n), new Array(n).fill(20), 4.5));
    // 4 header int32s + n*(3 floats + float + int32) + count + n*18 floats + hasGrid
    expect(bytes.length).toBe(16 + n * 20 + 4 + n * 72 + 4);
  });

  it("stores the real run time in the header", () => {
    const points = buildAiLane(straightLine(), new Array(50).fill(20), 4.5);
    expect(decodeFastLane(encodeFastLane(points, { lapTimeMs: 78_500 })).lapTimeMs).toBe(78_500);
  });

  it("preserves positions, ids and cumulative distance", () => {
    const points = buildAiLane(straightLine(10), new Array(10).fill(15), 5);
    const decoded = decodeFastLane(encodeFastLane(points));

    decoded.points.forEach((p, i) => {
      expect(p.id).toBe(i);
      expect(p.position.z).toBeCloseTo(i * 2, 4);
      // Points are 2 m apart on this synthetic line.
      expect(p.distance).toBeCloseTo(i * 2, 4);
    });
  });

  it("preserves per-point speed, width and forward vector", () => {
    const speeds = Array.from({ length: 10 }, (_, i) => 10 + i);
    const points = buildAiLane(straightLine(10), speeds, 4.5);
    const decoded = decodeFastLane(encodeFastLane(points));

    decoded.extras.forEach((extra, i) => {
      expect(extra.speed).toBeCloseTo(speeds[i]!, 4);
      expect(extra.sideLeft).toBeCloseTo(4.5, 5);
      expect(extra.sideRight).toBeCloseTo(4.5, 5);
      // Heading north along +Z.
      expect(extra.forward.z).toBeCloseTo(1, 5);
      expect(extra.forward.x).toBeCloseTo(0, 5);
    });
  });

  it("rejects a lane too short to be meaningful", () => {
    expect(() => encodeFastLane([])).toThrow(AiLaneError);
    expect(() => buildAiLane([{ x: 0, y: 0, z: 0 }], [0], 4)).toThrow(/at least 2/);
  });

  it("rejects a file whose version is not 7", () => {
    const bytes = encodeFastLane(buildAiLane(straightLine(5), new Array(5).fill(10), 4));
    new DataView(bytes.buffer).setInt32(0, 6, true);
    expect(() => decodeFastLane(bytes)).toThrow(/Unsupported AI lane version/);
  });

  it("substitutes zero for a non-finite radius", () => {
    const points = buildAiLane(straightLine(5), new Array(5).fill(10), 4);
    points[0]!.radius = NaN;
    points[1]!.radius = 25;
    const decoded = decodeFastLane(encodeFastLane(points));
    expect(decoded.extras[0]!.radius).toBe(0);
    expect(decoded.extras[1]!.radius).toBeCloseTo(25, 4);
  });
});

describe("AI lane from the real run", () => {
  it("encodes the driver's actual line as the racing line", () => {
    const runs = splitRuns(parseGpsCsv(csvText).samples, "run1-8.csv");
    const fused = fuseCenterline(runs);

    const points = buildAiLane(
      fused.points.map((p) => p.position),
      fused.points.map((p) => p.speed),
      4.5,
      fused.points.map((p) => p.curvature ? 1 / p.curvature : 0),
    );
    const decoded = decodeFastLane(
      encodeFastLane(points, { lapTimeMs: Math.round(runs[0]!.duration * 1000) }),
    );

    expect(decoded.pointCount).toBe(400);
    expect(decoded.lapTimeMs).toBeGreaterThan(78_000);
    expect(decoded.lapTimeMs).toBeLessThan(79_000);

    // Cumulative distance must track the reconstructed course length.
    const last = decoded.points[decoded.points.length - 1]!;
    expect(last.distance).toBeGreaterThan(1100);
    expect(last.distance).toBeLessThan(1200);

    // Distance must never go backwards.
    for (let i = 1; i < decoded.points.length; i++) {
      expect(decoded.points[i]!.distance).toBeGreaterThanOrEqual(decoded.points[i - 1]!.distance);
    }

    // Speeds should look like a real autocross run, not garbage.
    const speeds = decoded.extras.map((e) => e.speed);
    expect(Math.max(...speeds)).toBeGreaterThan(20); // ~45+ mph somewhere
    expect(Math.min(...speeds)).toBeGreaterThanOrEqual(0);
  });
});
