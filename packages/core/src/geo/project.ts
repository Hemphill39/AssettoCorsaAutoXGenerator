import type { Sample, Vec3 } from "../types.js";

/**
 * Geodetic → local tangent-plane projection.
 *
 * An autocross course spans a few hundred metres, so a local ENU (east/north/up)
 * tangent plane anchored at the course centroid is accurate to well under a
 * centimetre — far below GPS noise — while keeping the maths trivial.
 *
 * Output is Assetto Corsa world space: X = east, Y = up, Z = north.
 */

const WGS84_A = 6_378_137.0; // semi-major axis, metres
const WGS84_E2 = 6.694379990141316e-3; // first eccentricity squared
const DEG = Math.PI / 180;

export interface Anchor {
  lat: number;
  lon: number;
  elev: number;
}

/** Metres per degree of latitude and longitude at a given latitude. */
function scaleAt(lat: number): { perLat: number; perLon: number } {
  const s = Math.sin(lat * DEG);
  const w = 1 - WGS84_E2 * s * s;
  const primeVertical = WGS84_A / Math.sqrt(w);
  const meridional = (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w));
  return {
    perLat: meridional * DEG,
    perLon: primeVertical * Math.cos(lat * DEG) * DEG,
  };
}

export function anchorOf(samples: Sample[]): Anchor {
  if (samples.length === 0) throw new Error("Cannot anchor an empty sample set");
  let lat = 0;
  let lon = 0;
  let elev = 0;
  for (const s of samples) {
    lat += s.lat;
    lon += s.lon;
    elev += s.elev;
  }
  return {
    lat: lat / samples.length,
    lon: lon / samples.length,
    elev: elev / samples.length,
  };
}

export class Projector {
  private readonly perLat: number;
  private readonly perLon: number;

  constructor(readonly anchor: Anchor) {
    const s = scaleAt(anchor.lat);
    this.perLat = s.perLat;
    this.perLon = s.perLon;
  }

  /** @param flatten drop elevation to y=0 (see PLAN.md §3.3 — GPS altitude is noise). */
  project(sample: { lat: number; lon: number; elev?: number }, flatten = true): Vec3 {
    return {
      x: (sample.lon - this.anchor.lon) * this.perLon,
      y: flatten ? 0 : (sample.elev ?? this.anchor.elev) - this.anchor.elev,
      z: (sample.lat - this.anchor.lat) * this.perLat,
    };
  }

  /** Inverse projection, for round-tripping back to map coordinates. */
  unproject(v: Vec3): { lat: number; lon: number; elev: number } {
    return {
      lat: this.anchor.lat + v.z / this.perLat,
      lon: this.anchor.lon + v.x / this.perLon,
      elev: this.anchor.elev + v.y,
    };
  }
}

/**
 * Right-hand side of a heading, in AC's left-handed Y-up space.
 *
 * Derivation: AC is left-handed with X right, Y up, Z forward, so a body facing
 * +Z has its right hand toward +X. The rotation satisfying that is
 * (fx, fz) -> (fz, -fx). Sanity check: facing east (+X) yields (0,0,-1) = south,
 * which is correct. Because we map east→X and north→Z, this also matches
 * real-world geography, so `AC_TIME_n_L` placement needs no mirroring.
 */
export function rightOf(forward: Vec3): Vec3 {
  const len = Math.hypot(forward.x, forward.z) || 1;
  return { x: forward.z / len, y: 0, z: -forward.x / len };
}

export function leftOf(forward: Vec3): Vec3 {
  const r = rightOf(forward);
  return { x: -r.x, y: 0, z: -r.z };
}
