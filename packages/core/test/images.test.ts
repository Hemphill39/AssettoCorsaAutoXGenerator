import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { renderMapPng, renderOutlinePng, renderPreviewPng, worldToPixel } from "../src/package/images.js";
import { writeMapIni } from "../src/package/ini.js";
import type { TrackBounds } from "../src/package/types.js";
import type { Vec3 } from "../src/types.js";

const VERIFIER = fileURLToPath(new URL("../../../tools/verify_png.py", import.meta.url));

function pythonPath(): string | null {
  try {
    return execFileSync("sh", ["-c", "command -v python3"]).toString().trim() || null;
  } catch {
    return null;
  }
}

function verifyPng(png: Uint8Array): string | null {
  const python = pythonPath();
  if (!python) return null;
  const dir = mkdtempSync(join(tmpdir(), "xcross-images-"));
  const file = join(dir, "test.png");
  writeFileSync(file, png);
  return execFileSync(python, [VERIFIER, file]).toString();
}

const bounds: TrackBounds = { minX: 10, maxX: 110, minZ: -5, maxZ: 45 };

/** A little zigzag loop inside `bounds`, plenty for exercising the rasteriser. */
function sampleLoop(): Vec3[] {
  const points: Vec3[] = [];
  for (let i = 0; i <= 20; i++) {
    const t = i / 20;
    points.push({
      x: 10 + t * 100,
      y: 0,
      z: -5 + (i % 2 === 0 ? 0 : 40),
    });
  }
  return points;
}

describe("worldToPixel", () => {
  it("places the min corner at (MARGIN, MARGIN)", () => {
    const t = worldToPixel(bounds, 20);
    expect(t.project(bounds.minX, bounds.minZ)).toEqual({ x: 20, y: 20 });
  });

  it("places the max corner at (WIDTH-MARGIN, HEIGHT-MARGIN)", () => {
    const t = worldToPixel(bounds, 20);
    expect(t.project(bounds.maxX, bounds.maxZ)).toEqual({ x: t.width - 20, y: t.height - 20 });
  });
});

describe("worldToPixel / writeMapIni agreement", () => {
  it("emits the same WIDTH/HEIGHT/OFFSET values writeMapIni puts in the ini", () => {
    const margin = 20;
    const t = worldToPixel(bounds, margin);
    const ini = writeMapIni(bounds, margin);

    const params: Record<string, string> = {};
    const match = ini.match(/\[PARAMS\]\n([^[]*)/);
    for (const line of (match?.[1] ?? "").split("\n")) {
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      params[line.slice(0, eq)] = line.slice(eq + 1);
    }

    expect(Number(params.WIDTH)).toBe(t.width);
    expect(Number(params.HEIGHT)).toBe(t.height);
    expect(Number(params.X_OFFSET)).toBe(t.xOffset);
    expect(Number(params.Z_OFFSET)).toBe(t.zOffset);
    expect(Number(params.SCALE_FACTOR)).toBe(t.scaleFactor);
  });
});

describe("renderMapPng", () => {
  it("produces a PNG that validates against the independent verifier", () => {
    const png = renderMapPng(sampleLoop(), bounds);
    const output = verifyPng(png);
    if (output === null) return; // python3 not available
    expect(output).toContain("PNG VALID");
    expect(output).toContain("truecolour+alpha");
  });

  it("has a fully transparent background", () => {
    const png = renderMapPng(sampleLoop(), bounds);
    // Corner pixel (0,0) sits inside the margin, away from the drawn line.
    const t = worldToPixel(bounds, 20);
    const alpha = pixelAlpha(png, t.width, 0, 0);
    expect(alpha).toBe(0);
  });

  it("actually draws the track line", () => {
    const png = renderMapPng(sampleLoop(), bounds);
    const t = worldToPixel(bounds, 20);
    expect(anyPixelOpaque(png, t.width, t.height)).toBe(true);
  });
});

describe("renderOutlinePng", () => {
  it("is transparent-background PNG that validates", () => {
    const png = renderOutlinePng(sampleLoop(), bounds);
    const output = verifyPng(png);
    if (output === null) return;
    expect(output).toContain("truecolour+alpha");

    const t = worldToPixel(bounds, 20);
    expect(pixelAlpha(png, t.width, 0, 0)).toBe(0);
    expect(anyPixelOpaque(png, t.width, t.height)).toBe(true);
  });
});

describe("renderPreviewPng", () => {
  it("is a 1024x575 PNG that validates and is non-trivial in size", () => {
    const png = renderPreviewPng(sampleLoop(), [{ x: 30, y: 0, z: 10 }, { x: 60, y: 0, z: 30 }], bounds);
    expect(png.length).toBeGreaterThan(1000);
    const output = verifyPng(png);
    if (output === null) return;
    expect(output).toContain("1024x575");
    expect(output).toContain("truecolour+alpha");
  });
});

/**
 * PNGs here use filter-type 0 (None) on every scanline — asserted by
 * verify_png.py — so raw pixel bytes sit right after each scanline's single
 * filter byte. Good enough for test assertions without a real PNG decoder.
 */
function decodeRawRgba(png: Uint8Array): { width: number; height: number; raw: Uint8Array } {
  // IHDR is always the first chunk, 13 bytes of data starting at offset 16 (8-byte
  // signature + 4-byte length + 4-byte "IHDR").
  const view = new DataView(png.buffer, png.byteOffset, png.byteLength);
  const width = view.getUint32(16, false);
  const height = view.getUint32(20, false);

  // Walk chunks to collect and concatenate IDAT payloads.
  let pos = 8;
  const idatParts: Uint8Array[] = [];
  while (pos < png.length) {
    const length = view.getUint32(pos, false);
    const type = new TextDecoder().decode(png.subarray(pos + 4, pos + 8));
    if (type === "IDAT") idatParts.push(png.subarray(pos + 8, pos + 8 + length));
    pos += 12 + length;
  }
  const idat = new Uint8Array(idatParts.reduce((n, p) => n + p.length, 0));
  let off = 0;
  for (const p of idatParts) {
    idat.set(p, off);
    off += p.length;
  }

  // Our own encoder only ever emits stored (uncompressed) deflate blocks: skip
  // the 2-byte zlib header, then each block is [1B flag][2B len][2B ~len][data].
  let p = 2;
  const stride = 1 + width * 4;
  const raw = new Uint8Array(height * stride);
  let rawOff = 0;
  while (rawOff < raw.length) {
    const isLast = idat[p]! & 1;
    const len = idat[p + 1]! | (idat[p + 2]! << 8);
    p += 5;
    raw.set(idat.subarray(p, p + len), rawOff);
    p += len;
    rawOff += len;
    if (isLast && rawOff >= raw.length) break;
  }
  return { width, height, raw };
}

function pixelAlpha(png: Uint8Array, _width: number, x: number, y: number): number {
  const { width, raw } = decodeRawRgba(png);
  const stride = 1 + width * 4;
  return raw[y * stride + 1 + x * 4 + 3]!;
}

function anyPixelOpaque(png: Uint8Array, width: number, height: number): boolean {
  const { raw } = decodeRawRgba(png);
  const stride = 1 + width * 4;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (raw[y * stride + 1 + x * 4 + 3]! > 0) return true;
    }
  }
  return false;
}
