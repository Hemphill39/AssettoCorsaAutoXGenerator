import type { Run, Sample } from "../types.js";

/**
 * Splits a log into discrete autocross runs.
 *
 * Loggers differ: some export one file per run, others concatenate a whole
 * session. Both shapes are handled by cutting on (a) gaps in the sample clock
 * and (b) sustained near-standstill, which is what staging between runs looks
 * like.
 */
export interface SplitOptions {
  /** A jump larger than this in the sample clock ends a run. Seconds. */
  maxTimeGap: number;
  /** Speeds below this count as stopped. m/s (~1.1 mph). */
  stoppedSpeed: number;
  /** Being stopped for at least this long ends a run. Seconds. */
  stoppedDuration: number;
  /** Runs shorter than this are discarded as noise. Seconds. */
  minDuration: number;
  /** Runs shorter than this are discarded as noise. Metres. */
  minDistance: number;
}

export const DEFAULT_SPLIT_OPTIONS: SplitOptions = {
  maxTimeGap: 2,
  stoppedSpeed: 0.5,
  stoppedDuration: 3,
  minDuration: 10,
  minDistance: 100,
};

/** Great-circle-free planar distance; fine at autocross scale. */
function metresBetween(a: Sample, b: Sample): number {
  const latRad = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const dLat = (b.lat - a.lat) * 111_320;
  const dLon = (b.lon - a.lon) * 111_320 * Math.cos(latRad);
  return Math.hypot(dLat, dLon);
}

function summarise(source: string, index: number, samples: Sample[]): Run {
  let distance = 0;
  let maxSpeed = 0;
  for (let i = 1; i < samples.length; i++) {
    distance += metresBetween(samples[i - 1]!, samples[i]!);
  }
  for (const s of samples) maxSpeed = Math.max(maxSpeed, s.speed);
  const duration = samples.length > 1 ? samples[samples.length - 1]!.t - samples[0]!.t : 0;
  return { source, index, samples, duration, distance, maxSpeed };
}

export function splitRuns(
  samples: Sample[],
  source: string,
  options: Partial<SplitOptions> = {},
): Run[] {
  const opt = { ...DEFAULT_SPLIT_OPTIONS, ...options };

  // Cut into segments on clock gaps and sustained stops.
  const segments: Sample[][] = [];
  let current: Sample[] = [];
  let stoppedSince: number | null = null;

  for (let i = 0; i < samples.length; i++) {
    const s = samples[i]!;
    const prev = samples[i - 1];

    if (prev && s.t - prev.t > opt.maxTimeGap) {
      if (current.length) segments.push(current);
      current = [];
      stoppedSince = null;
    }

    if (s.speed < opt.stoppedSpeed) {
      if (stoppedSince === null) stoppedSince = s.t;
      const stoppedFor = s.t - stoppedSince;
      if (stoppedFor >= opt.stoppedDuration && current.length) {
        // Trim the stationary tail off the run we just finished.
        while (current.length && current[current.length - 1]!.speed < opt.stoppedSpeed) {
          current.pop();
        }
        if (current.length) segments.push(current);
        current = [];
      }
    } else {
      stoppedSince = null;
      current.push(s);
      continue;
    }

    // Still moving slowly but not yet a confirmed stop: keep the sample.
    if (current.length) current.push(s);
  }
  if (current.length) segments.push(current);

  return segments
    .map((seg, i) => summarise(source, i, seg))
    .filter((run) => run.duration >= opt.minDuration && run.distance >= opt.minDistance)
    .map((run, i) => ({ ...run, index: i }));
}
