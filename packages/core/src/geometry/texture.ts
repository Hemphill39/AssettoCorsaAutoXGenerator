/**
 * Minimal PNG encoder.
 *
 * kn5 embeds textures as raw image bytes, so we need to synthesise PNGs at
 * runtime. This deliberately avoids any zlib dependency by emitting *stored*
 * (uncompressed) deflate blocks: valid zlib, works identically in Node and the
 * browser, and stays synchronous — browsers only expose compression through the
 * async CompressionStream API. Track textures are small and mostly flat, so the
 * size cost is irrelevant.
 */

import { crc32 } from "../util/crc32.js";

function adler32(data: Uint8Array): number {
  let a = 1;
  let b = 0;
  for (let i = 0; i < data.length; i++) {
    a = (a + data[i]!) % 65521;
    b = (b + a) % 65521;
  }
  return ((b << 16) | a) >>> 0;
}

/** Wraps raw bytes in a zlib stream built from stored deflate blocks. */
function zlibStored(data: Uint8Array): Uint8Array {
  const MAX_BLOCK = 65535;
  const blockCount = Math.max(1, Math.ceil(data.length / MAX_BLOCK));
  const out = new Uint8Array(2 + blockCount * 5 + data.length + 4);
  let p = 0;

  out[p++] = 0x78; // CMF: deflate, 32K window
  out[p++] = 0x01; // FLG: no dictionary, fastest

  for (let offset = 0; offset < data.length || offset === 0; offset += MAX_BLOCK) {
    const len = Math.min(MAX_BLOCK, data.length - offset);
    const isLast = offset + len >= data.length;
    out[p++] = isLast ? 1 : 0;
    out[p++] = len & 0xff;
    out[p++] = (len >>> 8) & 0xff;
    out[p++] = ~len & 0xff;
    out[p++] = (~len >>> 8) & 0xff;
    out.set(data.subarray(offset, offset + len), p);
    p += len;
    if (isLast) break;
  }

  const sum = adler32(data);
  out[p++] = (sum >>> 24) & 0xff;
  out[p++] = (sum >>> 16) & 0xff;
  out[p++] = (sum >>> 8) & 0xff;
  out[p++] = sum & 0xff;

  return out.subarray(0, p);
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes);
  body.set(data, typeBytes.length);

  const out = new Uint8Array(4 + body.length + 4);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length, false);
  out.set(body, 4);
  view.setUint32(4 + body.length, crc32(body), false);
  return out;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Prefixes each scanline with a filter-type byte; 0 = None throughout. */
function addFilterBytes(pixels: Uint8Array, width: number, height: number, channels: number): Uint8Array {
  const stride = width * channels;
  const raw = new Uint8Array(height * (1 + stride));
  for (let y = 0; y < height; y++) {
    const src = y * stride;
    const dst = y * (1 + stride);
    raw[dst] = 0;
    raw.set(pixels.subarray(src, src + stride), dst + 1);
  }
  return raw;
}

/** Assembles signature + IHDR + IDAT + IEND around an already-filtered scanline buffer. */
function packPng(width: number, height: number, colourType: number, raw: Uint8Array): Uint8Array {
  const ihdr = new Uint8Array(13);
  const view = new DataView(ihdr.buffer);
  view.setUint32(0, width, false);
  view.setUint32(4, height, false);
  ihdr[8] = 8; // bit depth
  ihdr[9] = colourType;
  ihdr[10] = 0; // deflate
  ihdr[11] = 0; // adaptive filtering
  ihdr[12] = 0; // no interlace

  const parts = [
    PNG_SIGNATURE,
    chunk("IHDR", ihdr),
    chunk("IDAT", zlibStored(raw)),
    chunk("IEND", new Uint8Array(0)),
  ];

  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}

/**
 * Encodes 8-bit RGB pixels as a PNG.
 *
 * @param pixels row-major RGB triplets, length must be width * height * 3
 */
export function encodePng(width: number, height: number, pixels: Uint8Array): Uint8Array {
  const expected = width * height * 3;
  if (pixels.length !== expected) {
    throw new Error(`Expected ${expected} bytes for ${width}x${height} RGB, got ${pixels.length}`);
  }
  return packPng(width, height, 2, addFilterBytes(pixels, width, height, 3));
}

/**
 * Encodes 8-bit RGBA pixels as a PNG (colour type 6). Track map/outline images need
 * a real alpha channel so AC can overlay the car dot and AI line on a transparent
 * background instead of a rendered rectangle.
 *
 * @param rgba row-major RGBA quads, length must be width * height * 4
 */
export function encodePngRgba(width: number, height: number, rgba: Uint8Array): Uint8Array {
  const expected = width * height * 4;
  if (rgba.length !== expected) {
    throw new Error(`Expected ${expected} bytes for ${width}x${height} RGBA, got ${rgba.length}`);
  }
  return packPng(width, height, 6, addFilterBytes(rgba, width, height, 4));
}

/** A flat single-colour texture. */
export function solidPng(r: number, g: number, b: number, size = 4): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  for (let i = 0; i < size * size; i++) {
    pixels[i * 3] = r;
    pixels[i * 3 + 1] = g;
    pixels[i * 3 + 2] = b;
  }
  return encodePng(size, size, pixels);
}

/**
 * Deterministic value noise, so asphalt reads as a surface rather than a flat
 * colour. Seeded to keep generated tracks byte-reproducible.
 */
export function noisePng(
  base: { r: number; g: number; b: number },
  amplitude = 12,
  size = 64,
  seed = 1,
): Uint8Array {
  const pixels = new Uint8Array(size * size * 3);
  let state = seed >>> 0 || 1;
  const next = (): number => {
    // xorshift32
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state / 0xffffffff;
  };
  const clamp = (v: number): number => (v < 0 ? 0 : v > 255 ? 255 : Math.round(v));
  for (let i = 0; i < size * size; i++) {
    const delta = (next() - 0.5) * 2 * amplitude;
    pixels[i * 3] = clamp(base.r + delta);
    pixels[i * 3 + 1] = clamp(base.g + delta);
    pixels[i * 3 + 2] = clamp(base.b + delta);
  }
  return encodePng(size, size, pixels);
}
