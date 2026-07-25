/** Writers for AC's INI-format track config files (surfaces.ini, data/map.ini). */

import { DEFAULT_MAP_MARGIN, worldToPixel } from "./images.js";
import type { TrackBounds } from "./types.js";

type IniValue = string | number;

function iniSection(name: string, kv: Record<string, IniValue>): string {
  const lines = [`[${name}]`];
  for (const [key, value] of Object.entries(kv)) {
    lines.push(`${key}=${value}`);
  }
  return lines.join("\n");
}

/**
 * surfaces.ini maps mesh-name prefixes to grip/physics behaviour. Mesh names carry a
 * leading digit (`1ROAD`) purely to allow several meshes per surface; KEY never does
 * (see PLAN.md §2.3).
 */
export function writeSurfacesIni(): string {
  const sections = [
    iniSection("DEFAULT", {
      KEY: "DEFAULT",
      FRICTION: 0.7,
      DAMPING: 0,
      WAV: "",
      WAV_PITCH: 0,
      FF_EFFECT: "",
      DIRT_ADDITIVE: 0,
      IS_VALID_TRACK: 0,
      IS_PITLANE: 0,
      BLACK_FLAG_TIME: 0,
      SIN_HEIGHT: 0,
      SIN_LENGTH: 0,
      VIBRATION_GAIN: 0,
      VIBRATION_LENGTH: 0,
    }),
    iniSection("SURFACE_0", {
      KEY: "ROAD",
      FRICTION: 0.99,
      DAMPING: 0,
      WAV: "",
      WAV_PITCH: 0,
      FF_EFFECT: "",
      DIRT_ADDITIVE: 0,
      IS_VALID_TRACK: 1,
      IS_PITLANE: 0,
      BLACK_FLAG_TIME: 0,
      SIN_HEIGHT: 0,
      SIN_LENGTH: 0,
      VIBRATION_GAIN: 0,
      VIBRATION_LENGTH: 0,
    }),
    iniSection("SURFACE_1", {
      KEY: "GRASS",
      FRICTION: 0.6,
      DAMPING: 0.2,
      WAV: "",
      WAV_PITCH: 0,
      FF_EFFECT: "",
      DIRT_ADDITIVE: 0,
      IS_VALID_TRACK: 0,
      IS_PITLANE: 0,
      BLACK_FLAG_TIME: 10,
      SIN_HEIGHT: 0.02,
      SIN_LENGTH: 0.5,
      VIBRATION_GAIN: 0.2,
      VIBRATION_LENGTH: 0.2,
    }),
  ];
  return sections.join("\n\n") + "\n";
}

/**
 * data/map.ini scales world XZ to the minimap PNG (map.png, rendered by
 * package/images.ts). Both derive from the same worldToPixel() so the image and
 * the ini this scales it by can never drift apart — see worldToPixel's doc
 * comment for why that matters (a mismatch here puts the car's minimap dot in
 * the wrong place).
 */
export function writeMapIni(bounds: TrackBounds, marginMetres = DEFAULT_MAP_MARGIN): string {
  const transform = worldToPixel(bounds, marginMetres);

  return (
    iniSection("PARAMS", {
      WIDTH: transform.width,
      HEIGHT: transform.height,
      MARGIN: marginMetres,
      SCALE_FACTOR: transform.scaleFactor,
      X_OFFSET: transform.xOffset,
      Z_OFFSET: transform.zOffset,
      DRAWING_SIZE: 5,
    }) + "\n"
  );
}
