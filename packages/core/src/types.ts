/** Shared domain types for the autocross → Assetto Corsa pipeline. */

/**
 * Assetto Corsa world space: left-handed, Y-up.
 * X = east, Y = up, Z = north.
 *
 * With that mapping AC's handedness matches real-world geography: facing north
 * (+Z), your right hand points east (+X). See `rightOf()` in geo/project.ts.
 */
export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** One 10 Hz telemetry sample as logged by the GPS unit. */
export interface Sample {
  /** Seconds since the first sample in the source file. */
  t: number;
  lat: number;
  lon: number;
  /** Metres above sea level, as reported (noisy). */
  elev: number;
  /** Metres per second. */
  speed: number;
  /** Cumulative distance in metres, from the log if present. */
  distance: number;
  /** Instantaneous turn radius in metres; NaN when not logged or straight. */
  radius: number;
  /** Radians per second, positive = one consistent direction. */
  yawRate: number;
}

/** A single continuous autocross run extracted from a log file. */
export interface Run {
  /** Source file name, for traceability back to the upload. */
  source: string;
  /** Index of this run within its source file. */
  index: number;
  samples: Sample[];
  /** Wall-clock duration in seconds. */
  duration: number;
  /** Total distance travelled in metres. */
  distance: number;
  maxSpeed: number;
}

/** A point on the reconstructed course centreline. */
export interface CenterlinePoint {
  position: Vec3;
  /** Normalised arc-length position along the course, 0..1. */
  s: number;
  /** Cumulative distance in metres from the course start. */
  distance: number;
  /** Mean speed across contributing runs, m/s. */
  speed: number;
  /**
   * Standard deviation in metres of contributing runs at this station.
   * Low spread implies a constraining gate; high spread implies open pavement.
   */
  spread: number;
  /** Signed curvature, 1/m. Positive and negative denote opposite turn directions. */
  curvature: number;
}
