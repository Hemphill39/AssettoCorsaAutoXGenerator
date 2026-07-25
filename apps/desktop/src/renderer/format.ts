/** Plain-language unit formatting for a non-technical, US-based user. */

/** Seconds -> "1:18.300". */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00.000";
  const totalMs = Math.round(seconds * 1000);
  const minutes = Math.floor(totalMs / 60_000);
  const remainderMs = totalMs % 60_000;
  const secs = Math.floor(remainderMs / 1000);
  const millis = remainderMs % 1000;
  return `${minutes}:${secs.toString().padStart(2, "0")}.${millis.toString().padStart(3, "0")}`;
}

/** Milliseconds -> "1:18.300". */
export function formatDurationMs(ms: number): string {
  return formatDuration(ms / 1000);
}

export function metersToFeet(meters: number): number {
  return meters * 3.28084;
}

export function mpsToMph(metersPerSecond: number): number {
  return metersPerSecond * 2.23694;
}

export function feetToMeters(feet: number): number {
  return feet / 3.28084;
}

/** Metres -> "1,234 ft". */
export function formatFeet(meters: number): string {
  return `${Math.round(metersToFeet(meters)).toLocaleString()} ft`;
}

/** Metres per second -> "42 mph". */
export function formatMph(metersPerSecond: number): string {
  return `${Math.round(mpsToMph(metersPerSecond))} mph`;
}
