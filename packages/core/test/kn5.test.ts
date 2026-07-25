import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { decodeKn5 } from "../src/kn5/decode.js";
import { Kn5EncodeError, encodeKn5, yawFacing } from "../src/kn5/encode.js";
import { solidPng } from "../src/geometry/texture.js";
import type { Kn5Model, Vertex } from "../src/kn5/types.js";
import type { Vec3 } from "../src/types.js";

const VERIFIER = fileURLToPath(new URL("../../../tools/verify_kn5.py", import.meta.url));

function vertex(position: Vec3): Vertex {
  return {
    position,
    normal: { x: 0, y: 1, z: 0 },
    uv: { u: position.x, v: position.z },
    tangent: { x: 1, y: 0, z: 0 },
  };
}

/** A quad on the ground plane, as two triangles. */
function quad(half: number): { vertices: Vertex[]; indices: number[] } {
  return {
    vertices: [
      vertex({ x: -half, y: 0, z: -half }),
      vertex({ x: -half, y: 0, z: half }),
      vertex({ x: half, y: 0, z: half }),
      vertex({ x: half, y: 0, z: -half }),
    ],
    indices: [0, 1, 2, 0, 2, 3],
  };
}

function sampleModel(): Kn5Model {
  const lot = quad(60);
  return {
    textures: [
      { name: "asphalt.png", data: solidPng(60, 60, 62) },
      { name: "cone.png", data: solidPng(240, 90, 20) },
    ],
    materials: [
      {
        name: "asphalt",
        shader: "ksPerPixel",
        props: { ksDiffuse: 0.4, ksAmbient: 0.4 },
        textures: { txDiffuse: "asphalt.png" },
      },
      {
        name: "coneMat",
        shader: "ksPerPixel",
        props: { ksDiffuse: 0.5, ksAmbient: 0.5 },
        textures: { txDiffuse: "cone.png" },
      },
    ],
    meshes: [{ name: "1ROAD_lot", materialId: 0, ...lot }],
    dummies: [
      { name: "AC_START_0", position: { x: 0, y: 0, z: -40 } },
      { name: "AC_PIT_0", position: { x: 5, y: 0, z: -40 } },
      { name: "AC_TIME_0_L", position: { x: -5, y: 0, z: -35 } },
      { name: "AC_TIME_0_R", position: { x: 5, y: 0, z: -35 } },
    ],
  };
}

describe("encodeKn5", () => {
  it("produces a file the strict decoder consumes to exactly EOF", () => {
    const bytes = encodeKn5(sampleModel());
    const decoded = decodeKn5(bytes);
    expect(decoded.bytesConsumed).toBe(decoded.totalBytes);
    expect(decoded.version).toBe(5);
  });

  it("round-trips geometry, materials and textures", () => {
    const decoded = decodeKn5(encodeKn5(sampleModel()));

    expect(decoded.textures.map((t) => t.name)).toEqual(["asphalt.png", "cone.png"]);
    expect(decoded.textures[0]!.magic).toBe(".PNG");

    expect(decoded.materials[0]!.name).toBe("asphalt");
    expect(decoded.materials[0]!.shader).toBe("ksPerPixel");
    expect(decoded.materials[0]!.props["ksDiffuse"]).toBeCloseTo(0.4, 6);
    expect(decoded.materials[0]!.textures["txDiffuse"]).toBe("asphalt.png");

    expect(decoded.meshes).toHaveLength(1);
    const lot = decoded.meshes[0]!;
    expect(lot.name).toBe("1ROAD_lot");
    expect(lot.vertexCount).toBe(4);
    expect(lot.triangleCount).toBe(2);
    expect(Math.min(...lot.positions.map((p) => p.x))).toBeCloseTo(-60, 4);
    expect(Math.max(...lot.positions.map((p) => p.x))).toBeCloseTo(60, 4);

    // root + the four logical objects
    expect(decoded.dummies.map((d) => d.name)).toEqual([
      "root",
      "AC_START_0",
      "AC_PIT_0",
      "AC_TIME_0_L",
      "AC_TIME_0_R",
    ]);
    const start = decoded.dummies.find((d) => d.name === "AC_START_0")!;
    expect(start.position.x).toBeCloseTo(0, 5);
    expect(start.position.z).toBeCloseTo(-40, 5);
  });

  it("encodes dummy yaw so a node faces a given heading", () => {
    const east: Vec3 = { x: 1, y: 0, z: 0 };
    const model = sampleModel();
    model.dummies = [{ name: "AC_START_0", position: { x: 1, y: 2, z: 3 }, yaw: yawFacing(east) }];
    const decoded = decodeKn5(encodeKn5(model));
    const start = decoded.dummies.find((d) => d.name === "AC_START_0")!;
    expect(start.position.x).toBeCloseTo(1, 5);
    expect(start.position.y).toBeCloseTo(2, 5);
    expect(start.position.z).toBeCloseTo(3, 5);
    // Facing east is a quarter turn clockwise from north.
    expect(yawFacing(east)).toBeCloseTo(Math.PI / 2, 9);
    expect(yawFacing({ x: 0, y: 0, z: 1 })).toBeCloseTo(0, 9);
  });

  it("rejects a mesh referencing a missing material", () => {
    const model = sampleModel();
    model.meshes[0]!.materialId = 7;
    expect(() => encodeKn5(model)).toThrow(Kn5EncodeError);
  });

  it("rejects a material referencing a texture that is not embedded", () => {
    const model = sampleModel();
    model.materials[0]!.textures = { txDiffuse: "missing.png" };
    expect(() => encodeKn5(model)).toThrow(/not embedded/);
  });

  it("rejects out-of-range vertex indices", () => {
    const model = sampleModel();
    model.meshes[0]!.indices = [0, 1, 99];
    expect(() => encodeKn5(model)).toThrow(/references vertex 99/);
  });

  it("rejects an index count that is not a multiple of three", () => {
    const model = sampleModel();
    model.meshes[0]!.indices = [0, 1];
    expect(() => encodeKn5(model)).toThrow(/not a multiple of 3/);
  });
});

describe("cross-implementation check", () => {
  /**
   * The TypeScript decoder shares assumptions with the encoder, so agreement
   * between them cannot catch a shared misreading of the format. The Python
   * verifier was written against the reference Blender exporter independently,
   * so this is the test that would actually catch field-order drift.
   */
  it("is accepted by the independent Python verifier", () => {
    let python: string;
    try {
      python = execFileSync("sh", ["-c", "command -v python3"]).toString().trim();
    } catch {
      // Python is a dev-only convenience; never fail the suite over its absence.
      console.warn("python3 not found — skipping cross-implementation check");
      return;
    }

    const dir = mkdtempSync(join(tmpdir(), "xcross-kn5-"));
    const file = join(dir, "model.kn5");
    writeFileSync(file, encodeKn5(sampleModel()));

    const output = execFileSync(python, [VERIFIER, file]).toString();
    expect(output).toContain("PASS: parsed to exactly EOF");
    expect(output).toContain("1ROAD_lot");
    expect(output).toContain("AC_TIME_0_L");
    expect(output).toMatch(/leftover=0/);
  });
});
