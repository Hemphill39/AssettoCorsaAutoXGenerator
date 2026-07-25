/**
 * Renders the PNGs Content Manager and AC's HUD require: map.png (minimap, with
 * the car dot and AI line overlaid at runtime), ui/outline.png (track-list
 * thumbnail), ui/preview.png (track-browser photo).
 */
import { Raster, type Point, type Rgba } from "../geometry/raster.js";
import type { Vec3 } from "../types.js";
import type { TrackBounds } from "./types.js";

/**
 * Pixels of blank border baked around the course on the minimap. This value MUST
 * match data/map.ini's MARGIN — see worldToPixel below — or AC's runtime overlay
 * (car dot, AI line) lands off the line this module draws into map.png.
 */
export const DEFAULT_MAP_MARGIN = 20;

export interface PixelTransform {
  width: number;
  height: number;
  xOffset: number;
  zOffset: number;
  scaleFactor: number;
  project(worldX: number, worldZ: number): Point;
}

/**
 * The single source of truth for world→pixel mapping. Both the renderers below
 * and writeMapIni (package/ini.ts) call this — never duplicate the arithmetic.
 * AC's own runtime transform is `(world + OFFSET) * SCALE_FACTOR`, with the
 * margin folded into OFFSET rather than added separately (PLAN.md §9).
 */
export function worldToPixel(bounds: TrackBounds, margin = DEFAULT_MAP_MARGIN): PixelTransform {
  const scaleFactor = 1;
  const xOffset = margin - bounds.minX;
  const zOffset = margin - bounds.minZ;
  const width = Math.ceil(bounds.maxX - bounds.minX) + 2 * margin;
  const height = Math.ceil(bounds.maxZ - bounds.minZ) + 2 * margin;
  return {
    width,
    height,
    xOffset,
    zOffset,
    scaleFactor,
    project: (worldX: number, worldZ: number): Point => ({
      x: (worldX + xOffset) * scaleFactor,
      y: (worldZ + zOffset) * scaleFactor,
    }),
  };
}

const TRACK_LINE: Rgba = { r: 255, g: 255, b: 255, a: 255 };

function projectLoop(loop: Vec3[], transform: PixelTransform): Point[] {
  return loop.map((p) => transform.project(p.x, p.z));
}

/**
 * AC's minimap: an opaque line on a fully transparent background, so the runtime
 * overlay (car dot, AI line) reads cleanly against whatever HUD skin is active.
 */
export function renderMapPng(loop: Vec3[], bounds: TrackBounds, margin = DEFAULT_MAP_MARGIN): Uint8Array {
  const transform = worldToPixel(bounds, margin);
  // Raster starts fully transparent already; the background needs no explicit fill.
  const raster = new Raster(transform.width, transform.height);
  raster.drawPolyline(projectLoop(loop, transform), 10, TRACK_LINE);
  return raster.toPng();
}

/** Same geometry as the minimap, thinner, for track-list thumbnails. */
export function renderOutlinePng(loop: Vec3[], bounds: TrackBounds, margin = DEFAULT_MAP_MARGIN): Uint8Array {
  const transform = worldToPixel(bounds, margin);
  const raster = new Raster(transform.width, transform.height);
  raster.drawPolyline(projectLoop(loop, transform), 4, TRACK_LINE);
  return raster.toPng();
}

const PREVIEW_WIDTH = 1024;
const PREVIEW_HEIGHT = 575;
const PREVIEW_INSET = 40; // px kept clear at the frame edge so the line/cones never touch it
const PREVIEW_BG: Rgba = { r: 0x23, g: 0x25, b: 0x2b, a: 255 };
const PREVIEW_LINE: Rgba = { r: 214, g: 218, b: 226, a: 255 };
const PREVIEW_CONE: Rgba = { r: 255, g: 140, b: 20, a: 255 };

/**
 * A 1024x575 "photo" for the track browser. Purely illustrative — it fits the
 * course into the frame with a uniform scale (so it isn't stretched) and centres
 * it, independent of the map.ini transform used by renderMapPng/renderOutlinePng.
 */
export function renderPreviewPng(loop: Vec3[], cones: Vec3[], bounds: TrackBounds): Uint8Array {
  const raster = new Raster(PREVIEW_WIDTH, PREVIEW_HEIGHT);
  raster.fill(PREVIEW_BG);

  const worldWidth = Math.max(1e-6, bounds.maxX - bounds.minX);
  const worldHeight = Math.max(1e-6, bounds.maxZ - bounds.minZ);
  const availWidth = PREVIEW_WIDTH - 2 * PREVIEW_INSET;
  const availHeight = PREVIEW_HEIGHT - 2 * PREVIEW_INSET;
  const scale = Math.min(availWidth / worldWidth, availHeight / worldHeight);
  const offsetX = (PREVIEW_WIDTH - worldWidth * scale) / 2 - bounds.minX * scale;
  const offsetY = (PREVIEW_HEIGHT - worldHeight * scale) / 2 - bounds.minZ * scale;

  const project = (p: Vec3): Point => ({
    x: p.x * scale + offsetX,
    y: p.z * scale + offsetY,
  });

  raster.drawPolyline(loop.map(project), 6, PREVIEW_LINE);
  for (const cone of cones) {
    raster.drawDisc(project(cone), 4, PREVIEW_CONE);
  }
  return raster.toPng();
}
