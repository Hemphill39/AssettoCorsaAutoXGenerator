import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildTrack } from "../src/package/buildTrack.js";
import { decodeKn5 } from "../src/kn5/decode.js";
import { decodeFastLane } from "../src/ai/fastLane.js";

const FIXTURE = fileURLToPath(new URL("../../../fixtures/run1-8.csv", import.meta.url));
const csvText = readFileSync(FIXTURE, "utf8");
const sources = [{ name: "run1-8.csv", text: csvText }];

describe("buildTrack end-to-end", () => {
  it("produces every file Assetto Corsa requires", () => {
    const result = buildTrack(sources);
    const paths = result.files.map((f) => f.path).sort();
    expect(paths).toEqual([
      "ai/fast_lane.ai",
      "data/map.ini",
      "data/surfaces.ini",
      "map.png",
      "ui/outline.png",
      "ui/preview.png",
      "ui/ui_track.json",
      `${result.meta.id}.kn5`,
    ].sort());
  });

  it("builds a model with a drivable surface, cones and a barrier", () => {
    const result = buildTrack(sources);
    const kn5 = result.files.find((f) => f.path.endsWith(".kn5"))!;
    const model = decodeKn5(kn5.data);

    // The digit prefix plus ROAD key is what makes AC treat this as drivable.
    const road = model.meshes.find((m) => m.name.startsWith("1ROAD"));
    expect(road).toBeDefined();
    expect(road!.triangleCount).toBeGreaterThan(100);

    // The `n` prefix makes the perimeter collidable.
    expect(model.meshes.some((m) => m.name.startsWith("nWall"))).toBe(true);

    // Cones must NOT carry a physics prefix — they have to be drive-through.
    const cones = model.meshes.filter((m) => m.name.startsWith("cones_"));
    expect(cones.length).toBeGreaterThan(0);
    for (const mesh of cones) {
      expect(mesh.name).not.toMatch(/^[0-9]/);
      expect(mesh.name).not.toMatch(/^n/);
    }
  });

  it("places the timing objects AC needs for a lap to register", () => {
    const result = buildTrack(sources);
    const model = decodeKn5(result.files.find((f) => f.path.endsWith(".kn5"))!.data);
    const names = model.dummies.map((d) => d.name);

    for (const required of [
      "AC_START_0",
      "AC_PIT_0",
      "AC_HOTLAP_START_0",
      "AC_TIME_0_L",
      "AC_TIME_0_R",
      "AC_TIME_1_L",
      "AC_TIME_1_R",
    ]) {
      expect(names).toContain(required);
    }
  });

  it("separates each timing gate by exactly the course width", () => {
    const result = buildTrack(sources, { courseWidth: 12 });
    const model = decodeKn5(result.files.find((f) => f.path.endsWith(".kn5"))!.data);
    for (const gate of ["0", "1"]) {
      const l = model.dummies.find((d) => d.name === `AC_TIME_${gate}_L`)!;
      const r = model.dummies.find((d) => d.name === `AC_TIME_${gate}_R`)!;
      expect(
        Math.hypot(l.position.x - r.position.x, l.position.z - r.position.z),
      ).toBeCloseTo(12, 3);
    }
  });

  it("writes an AI line that closes into a lap and carries the real run time", () => {
    const result = buildTrack(sources);
    const ai = decodeFastLane(result.files.find((f) => f.path.endsWith(".ai"))!.data);

    expect(ai.lapTimeMs).toBe(result.meta.targetTimeMs);
    expect(ai.pointCount).toBeGreaterThan(400);

    // The return path must bring the line back near where it started.
    const first = ai.points[0]!.position;
    const last = ai.points[ai.points.length - 1]!.position;
    expect(Math.hypot(last.x - first.x, last.z - first.z)).toBeLessThan(10);

    // Lap distance exceeds the course itself, because of the return path.
    expect(ai.points[ai.points.length - 1]!.distance).toBeGreaterThan(result.meta.lengthMetres);
  });

  it("warns that a single run means inferred cone positions", () => {
    const result = buildTrack(sources);
    expect(result.warnings.join(" ")).toMatch(/Only one run/);
  });

  it("accepts several files at once and uses every run", () => {
    const result = buildTrack([
      { name: "run1.csv", text: csvText },
      { name: "run2.csv", text: csvText },
      { name: "run3.csv", text: csvText },
    ]);
    expect(result.runs).toHaveLength(3);
    expect(result.warnings.join(" ")).not.toMatch(/Only one run/);
  });

  it("rejects input with no usable runs", () => {
    expect(() => buildTrack([])).toThrow(/No source files/);
    expect(() =>
      buildTrack([{ name: "empty.csv", text: "LAT (deg),LONG (deg)\n41.4,-81.8\n" }]),
    ).toThrow(/usable run/);
  });

  it("produces a zip that Python's zipfile accepts", () => {
    let python: string;
    try {
      python = execFileSync("sh", ["-c", "command -v python3"]).toString().trim();
    } catch {
      console.warn("python3 not found — skipping zip cross-check");
      return;
    }

    const result = buildTrack(sources);
    const dir = mkdtempSync(join(tmpdir(), "xcross-track-"));
    const zipPath = join(dir, "track.zip");
    writeFileSync(zipPath, result.zip);

    const script = `
import zipfile, sys
z = zipfile.ZipFile(sys.argv[1])
assert z.testzip() is None, "CRC failure"
names = z.namelist()
assert any(n.endswith(".kn5") for n in names), names
assert any(n.endswith("surfaces.ini") for n in names), names
assert any(n.endswith("fast_lane.ai") for n in names), names
assert any(n.endswith("ui_track.json") for n in names), names
assert any(n.endswith("map.png") for n in names), names
assert any(n.endswith("data/map.ini") for n in names), names
assert any(n.endswith("ui/preview.png") for n in names), names
assert any(n.endswith("ui/outline.png") for n in names), names
# Everything must live under the single track folder AC expects.
assert all(n.startswith(sys.argv[2] + "/") for n in names), names
print("ZIP OK", len(names))
`;
    const output = execFileSync(python, ["-c", script, zipPath, result.meta.id]).toString();
    expect(output).toContain("ZIP OK 8");
  });
});

describe("hand-edited cones", () => {
  /**
   * The editor is only meaningful if edits reach the exported model. Before this
   * was supported, dragging a cone changed the preview but not the .kn5 — an
   * editor that silently does nothing is worse than none.
   */
  it("exports hand-placed cones instead of the inferred layout", () => {
    const auto = buildTrack(sources);
    expect(auto.cones.length).toBeGreaterThan(50);

    // Keep three cones and shove one somewhere unmistakable.
    const edited = auto.cones.slice(0, 3).map((c) => ({ ...c }));
    edited[0] = { ...edited[0]!, position: { x: 1234, y: 0, z: -4321 } };

    const result = buildTrack(sources, { conesOverride: edited });
    expect(result.cones).toHaveLength(3);

    const model = decodeKn5(result.files.find((f) => f.path.endsWith(".kn5"))!.data);
    const coneMeshes = model.meshes.filter((m) => m.name.startsWith("cones_"));
    const xs = coneMeshes.flatMap((m) => m.positions.map((p) => p.x));

    // The moved cone must actually be in the exported geometry.
    expect(Math.max(...xs)).toBeGreaterThan(1200);
    // Three cones' worth of geometry, not the full inferred set.
    const totalVerts = coneMeshes.reduce((n, m) => n + m.vertexCount, 0);
    expect(totalVerts).toBe(3 * 30);
  });

  it("still derives timing gates and course length from the centreline", () => {
    const auto = buildTrack(sources);
    const edited = buildTrack(sources, { conesOverride: auto.cones.slice(0, 5) });

    // Removing cones must not move the start/finish or resize the course.
    expect(edited.meta.lengthMetres).toBe(auto.meta.lengthMetres);
    expect(edited.meta.targetTimeMs).toBe(auto.meta.targetTimeMs);

    const autoModel = decodeKn5(auto.files.find((f) => f.path.endsWith(".kn5"))!.data);
    const editModel = decodeKn5(edited.files.find((f) => f.path.endsWith(".kn5"))!.data);
    const gateOf = (m: typeof autoModel, name: string) =>
      m.dummies.find((d) => d.name === name)!.position;

    for (const name of ["AC_TIME_0_L", "AC_TIME_1_R", "AC_START_0"]) {
      expect(gateOf(editModel, name).x).toBeCloseTo(gateOf(autoModel, name).x, 6);
      expect(gateOf(editModel, name).z).toBeCloseTo(gateOf(autoModel, name).z, 6);
    }
  });

  it("says plainly when hand-placed cones are in use", () => {
    const auto = buildTrack(sources);
    const result = buildTrack(sources, { conesOverride: auto.cones.slice(0, 4) });
    expect(result.warnings.join(" ")).toMatch(/4 hand-placed cones/);
  });
});
