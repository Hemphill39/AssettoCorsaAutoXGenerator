/** Contracts for assembling an installable Assetto Corsa track folder. */

export interface TrackMeta {
  /** Folder name and AC track id. Filesystem-safe: [a-z0-9_-] only. */
  id: string;
  /** Display name shown in Content Manager. */
  name: string;
  description: string;
  author: string;
  /** The driver's real measured run time, in milliseconds. */
  targetTimeMs: number;
  /** Course length in metres. */
  lengthMetres: number;
  /** Width of the drivable corridor in metres. */
  widthMetres: number;
  country?: string;
  city?: string;
  /** ISO date of the source run, e.g. "2025-05-18". */
  runDate?: string;
  /**
   * Grid slots. Must equal the number of AC_PIT_n / AC_START_n dummies in the
   * model — AC caps the field size at this number, and AI opponents need a slot
   * each or they cannot spawn at all.
   */
  pitboxes?: number;
}

/** One file in the track package. `path` is relative to the track folder root. */
export interface TrackFile {
  path: string;
  data: Uint8Array;
}

/** World-space extents of the generated track, used for minimap scaling. */
export interface TrackBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}
