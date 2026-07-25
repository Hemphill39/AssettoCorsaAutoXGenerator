import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseGpsCsv } from "../src/csv/parse.js";
import { splitRuns } from "../src/csv/splitRuns.js";
import { Projector, anchorOf, leftOf, rightOf } from "../src/geo/project.js";
import type { Sample } from "../src/types.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/run1-8.csv", import.meta.url));
const csvText = readFileSync(FIXTURE, "utf8");

/**
 * Ground truth for run1-8.csv, established by direct inspection of the file:
 * one continuous run, no clock gaps, 10 Hz throughout.
 */
const FIXTURE_TRUTH = {
  samples: 786,
  durationSeconds: 78.5,
  distanceMetres: 1176.579047,
  maxSpeedMs: 10.0 / 0.386, // ~25.9; asserted loosely below
} as const;

describe("parseGpsCsv", () => {
  it("parses every data row of the real fixture", () => {
    const { samples, skipped } = parseGpsCsv(csvText);
    expect(samples).toHaveLength(FIXTURE_TRUTH.samples);
    expect(skipped).toBe(0);
  });

  it("reads the first sample's values correctly", () => {
    const { samples } = parseGpsCsv(csvText);
    const first = samples[0]!;
    expect(first.t).toBe(0);
    expect(first.lat).toBeCloseTo(41.39969268, 8);
    expect(first.lon).toBeCloseTo(-81.85767638, 8);
    expect(first.elev).toBeCloseTo(236.4, 3);
    expect(first.speed).toBeCloseTo(0.2160666665, 6);
  });

  it("produces a strictly 10 Hz clock with no gaps", () => {
    const { samples } = parseGpsCsv(csvText);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]!.t - samples[i - 1]!.t).toBeCloseTo(0.1, 6);
    }
    expect(samples[samples.length - 1]!.t).toBeCloseTo(FIXTURE_TRUTH.durationSeconds, 6);
  });

  it("matches columns despite unit annotations in headers", () => {
    const renamed = csvText.replace("SPEED (m/s)", "SPEED (mph)").replace("LAT (deg)", "Latitude");
    const { samples } = parseGpsCsv(renamed);
    expect(samples).toHaveLength(FIXTURE_TRUTH.samples);
    expect(samples[0]!.lat).toBeCloseTo(41.39969268, 8);
  });

  it("rejects a file with no usable coordinates", () => {
    expect(() => parseGpsCsv("a,b,c\n1,2,3\n")).toThrow(/Missing required column/);
  });
});

describe("splitRuns", () => {
  it("finds exactly one run in the fixture", () => {
    const { samples } = parseGpsCsv(csvText);
    const runs = splitRuns(samples, "run1-8.csv");
    expect(runs).toHaveLength(1);
    const run = runs[0]!;
    // The car is stationary on the line for the first two samples; the splitter
    // trims that lead-in, so the run covers the moving portion only. Trimming
    // should cost a fraction of a second, never more.
    expect(run.duration).toBeGreaterThan(FIXTURE_TRUTH.durationSeconds - 0.5);
    expect(run.duration).toBeLessThanOrEqual(FIXTURE_TRUTH.durationSeconds);
    // Distance is recomputed from lat/lon, so allow drift vs the logged column.
    expect(run.distance).toBeGreaterThan(FIXTURE_TRUTH.distanceMetres * 0.97);
    expect(run.distance).toBeLessThan(FIXTURE_TRUTH.distanceMetres * 1.03);
    expect(run.maxSpeed).toBeGreaterThan(25);
  });

  it("splits a concatenated session on staging stops", () => {
    // Three runs, separated by 10 s stationary periods.
    const samples: Sample[] = [];
    let t = 0;
    let lat = 41.4;
    for (let run = 0; run < 3; run++) {
      for (let i = 0; i < 400; i++) {
        lat += 0.00002;
        samples.push({ t, lat, lon: -81.85, elev: 236, speed: 15, distance: 0, radius: NaN, yawRate: 0 });
        t += 0.1;
      }
      for (let i = 0; i < 100; i++) {
        samples.push({ t, lat, lon: -81.85, elev: 236, speed: 0, distance: 0, radius: NaN, yawRate: 0 });
        t += 0.1;
      }
    }
    const runs = splitRuns(samples, "session.csv");
    expect(runs).toHaveLength(3);
    for (const run of runs) expect(run.duration).toBeGreaterThan(30);
    expect(runs.map((r) => r.index)).toEqual([0, 1, 2]);
  });

  it("splits on clock gaps between separately logged runs", () => {
    const samples: Sample[] = [];
    let t = 0;
    let lat = 41.4;
    for (let run = 0; run < 2; run++) {
      for (let i = 0; i < 400; i++) {
        lat += 0.00002;
        samples.push({ t, lat, lon: -81.85, elev: 236, speed: 15, distance: 0, radius: NaN, yawRate: 0 });
        t += 0.1;
      }
      t += 60; // logger paused between runs
    }
    expect(splitRuns(samples, "gapped.csv")).toHaveLength(2);
  });

  it("discards fragments that are too short to be runs", () => {
    const samples: Sample[] = [];
    for (let i = 0; i < 30; i++) {
      samples.push({
        t: i * 0.1, lat: 41.4 + i * 0.00001, lon: -81.85,
        elev: 236, speed: 5, distance: 0, radius: NaN, yawRate: 0,
      });
    }
    expect(splitRuns(samples, "short.csv")).toHaveLength(0);
  });
});

describe("Projector", () => {
  it("round-trips coordinates to sub-millimetre precision", () => {
    const { samples } = parseGpsCsv(csvText);
    const projector = new Projector(anchorOf(samples));
    for (const s of samples.slice(0, 50)) {
      const back = projector.unproject(projector.project(s, false));
      expect(back.lat).toBeCloseTo(s.lat, 9);
      expect(back.lon).toBeCloseTo(s.lon, 9);
    }
  });

  it("produces a course footprint matching the known bounding box", () => {
    const { samples } = parseGpsCsv(csvText);
    const projector = new Projector(anchorOf(samples));
    const pts = samples.map((s) => projector.project(s));
    const width = Math.max(...pts.map((p) => p.x)) - Math.min(...pts.map((p) => p.x));
    const depth = Math.max(...pts.map((p) => p.z)) - Math.min(...pts.map((p) => p.z));
    // Hand-computed from the raw lat/lon extents: ~221 m east-west, ~302 m north-south.
    expect(width).toBeGreaterThan(215);
    expect(width).toBeLessThan(228);
    expect(depth).toBeGreaterThan(295);
    expect(depth).toBeLessThan(310);
  });

  it("flattens elevation by default", () => {
    const projector = new Projector({ lat: 41.4, lon: -81.85, elev: 236 });
    expect(projector.project({ lat: 41.4, lon: -81.85, elev: 300 }).y).toBe(0);
    expect(projector.project({ lat: 41.4, lon: -81.85, elev: 300 }, false).y).toBeCloseTo(64, 6);
  });
});

describe("handedness", () => {
  it("puts east on the right when facing north", () => {
    const r = rightOf({ x: 0, y: 0, z: 1 });
    expect(r.x).toBeCloseTo(1, 9);
    expect(r.z).toBeCloseTo(0, 9);
  });

  it("puts south on the right when facing east", () => {
    const r = rightOf({ x: 1, y: 0, z: 0 });
    expect(r.x).toBeCloseTo(0, 9);
    expect(r.z).toBeCloseTo(-1, 9);
  });

  it("makes left the exact opposite of right", () => {
    const f = { x: 0.6, y: 0, z: 0.8 };
    const r = rightOf(f);
    const l = leftOf(f);
    expect(l.x).toBeCloseTo(-r.x, 9);
    expect(l.z).toBeCloseTo(-r.z, 9);
  });
});
