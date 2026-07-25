/**
 * A tiny software rasteriser for the minimap/outline/preview PNGs.
 *
 * There is no canvas or DOM in this package, so pixels are written directly into
 * an RGBA buffer with straight-alpha source-over blending. Everything here works
 * in pixel space; world→pixel projection is the caller's job (see
 * package/images.ts's worldToPixel, which is the one place that math happens).
 */
import { encodePngRgba } from "./texture.js";

export interface Rgba {
  r: number;
  g: number;
  b: number;
  a: number;
}

export interface Point {
  x: number;
  y: number;
}

export class Raster {
  private readonly data: Uint8Array;

  constructor(
    public readonly width: number,
    public readonly height: number,
  ) {
    this.data = new Uint8Array(width * height * 4); // starts fully transparent
  }

  fill(colour: Rgba): void {
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        this.blend(x, y, colour);
      }
    }
  }

  drawDisc(centre: Point, radiusPx: number, colour: Rgba): void {
    this.stampCapsule(centre, centre, radiusPx, colour);
  }

  /**
   * Draws a polyline as a chain of thick capsules (rounded-rectangle segments).
   * Two capsules sharing an endpoint each contribute a round cap there, which is
   * exactly a round join — no separate join case needed.
   */
  drawPolyline(points: Point[], widthPx: number, colour: Rgba): void {
    if (points.length === 0) return;
    const halfWidth = widthPx / 2;
    if (points.length === 1) {
      this.drawDisc(points[0]!, halfWidth, colour);
      return;
    }
    for (let i = 0; i < points.length - 1; i++) {
      this.stampCapsule(points[i]!, points[i + 1]!, halfWidth, colour);
    }
  }

  toPng(): Uint8Array {
    return encodePngRgba(this.width, this.height, this.data);
  }

  /** Straight-alpha source-over blend of one pixel; clipped to canvas bounds. */
  private blend(x: number, y: number, colour: Rgba): void {
    const xi = Math.trunc(x);
    const yi = Math.trunc(y);
    if (xi < 0 || xi >= this.width || yi < 0 || yi >= this.height) return;
    const srcA = colour.a / 255;
    if (srcA <= 0) return;

    const i = (yi * this.width + xi) * 4;
    const dstA = this.data[i + 3]! / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;

    const mix = (src: number, dst: number): number =>
      Math.round((src * srcA + dst * dstA * (1 - srcA)) / outA);
    this.data[i] = mix(colour.r, this.data[i]!);
    this.data[i + 1] = mix(colour.g, this.data[i + 1]!);
    this.data[i + 2] = mix(colour.b, this.data[i + 2]!);
    this.data[i + 3] = Math.round(outA * 255);
  }

  /**
   * Fills the capsule (rounded line segment) between two points. Cost is bounded
   * by the segment's own bounding box, so a long polyline of short segments stays
   * linear in total pixel work rather than scanning the whole canvas per segment.
   */
  private stampCapsule(p0: Point, p1: Point, radius: number, colour: Rgba): void {
    const minX = Math.max(0, Math.floor(Math.min(p0.x, p1.x) - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(Math.max(p0.x, p1.x) + radius));
    const minY = Math.max(0, Math.floor(Math.min(p0.y, p1.y) - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(Math.max(p0.y, p1.y) + radius));

    const dx = p1.x - p0.x;
    const dy = p1.y - p0.y;
    const lenSq = dx * dx + dy * dy || 1; // degenerate segment (a disc) falls back to point distance
    const radiusSq = radius * radius;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const px = x + 0.5 - p0.x;
        const py = y + 0.5 - p0.y;
        const t = Math.max(0, Math.min(1, (px * dx + py * dy) / lenSq));
        const ex = px - t * dx;
        const ey = py - t * dy;
        if (ex * ex + ey * ey <= radiusSq) this.blend(x, y, colour);
      }
    }
  }
}
