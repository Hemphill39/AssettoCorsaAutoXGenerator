import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { encodePng, noisePng, solidPng } from "../src/geometry/texture.js";

const VERIFIER = fileURLToPath(new URL("../../../tools/verify_png.py", import.meta.url));

function pythonPath(): string | null {
  try {
    return execFileSync("sh", ["-c", "command -v python3"]).toString().trim() || null;
  } catch {
    return null;
  }
}

describe("encodePng", () => {
  it("emits a valid PNG signature and IEND terminator", () => {
    const png = solidPng(10, 20, 30, 4);
    expect(Array.from(png.subarray(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(new TextDecoder().decode(png.subarray(png.length - 8, png.length - 4))).toBe("IEND");
  });

  it("rejects a pixel buffer of the wrong size", () => {
    expect(() => encodePng(4, 4, new Uint8Array(10))).toThrow(/Expected 48 bytes/);
  });

  it("is deterministic, so generated tracks stay reproducible", () => {
    expect(Array.from(noisePng({ r: 60, g: 60, b: 62 }, 12, 16, 42))).toEqual(
      Array.from(noisePng({ r: 60, g: 60, b: 62 }, 12, 16, 42)),
    );
  });

  it("varies with the seed", () => {
    const a = noisePng({ r: 60, g: 60, b: 62 }, 12, 16, 1);
    const b = noisePng({ r: 60, g: 60, b: 62 }, 12, 16, 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it("handles images large enough to span multiple deflate blocks", () => {
    // 160x160 RGB + filter bytes exceeds the 65535-byte stored-block limit,
    // exercising the multi-block path in zlibStored().
    const size = 160;
    const png = noisePng({ r: 90, g: 90, b: 90 }, 20, size, 3);
    expect(png.length).toBeGreaterThan(65535);
    const python = pythonPath();
    if (!python) return;
    const dir = mkdtempSync(join(tmpdir(), "xcross-png-"));
    const file = join(dir, "big.png");
    writeFileSync(file, png);
    expect(execFileSync(python, [VERIFIER, file]).toString()).toContain("PNG VALID");
  });
});

describe("cross-implementation PNG check", () => {
  /**
   * Our encoder emits stored (uncompressed) deflate blocks, an unusual path that
   * a real decoder must still accept. Python's zlib is that independent decoder.
   */
  it("produces PNGs that Python's zlib inflates correctly", () => {
    const python = pythonPath();
    if (!python) {
      console.warn("python3 not found — skipping PNG cross-check");
      return;
    }
    const dir = mkdtempSync(join(tmpdir(), "xcross-png-"));
    const solid = join(dir, "solid.png");
    const noise = join(dir, "noise.png");
    writeFileSync(solid, solidPng(60, 60, 62, 4));
    writeFileSync(noise, noisePng({ r: 60, g: 60, b: 62 }, 12, 64, 7));

    const output = execFileSync(python, [VERIFIER, solid, noise]).toString();
    expect(output).toContain("4x4 truecolour");
    expect(output).toContain("64x64 truecolour");
    expect(output).toContain("PNG VALID");
  });
});
