/** Writer for AC's ui/ui_track.json — the Content Manager listing metadata. */

import type { TrackMeta } from "./types.js";

/**
 * Formats milliseconds as AC's lap-time convention, m:ss.mmm (minutes unpadded,
 * seconds/millis zero-padded). Used to embed the driver's real target time — the
 * whole point of this project (see PLAN.md §1) — into the track description.
 */
export function formatLapTime(ms: number): string {
  const totalMs = Math.max(0, Math.round(ms));
  const minutes = Math.floor(totalMs / 60000);
  const seconds = Math.floor((totalMs % 60000) / 1000);
  const millis = totalMs % 1000;
  return `${minutes}:${String(seconds).padStart(2, "0")}.${String(millis).padStart(3, "0")}`;
}

export function writeUiTrackJson(meta: TrackMeta): string {
  const targetTime = formatLapTime(meta.targetTimeMs);
  const description = `${meta.description} Target time: ${targetTime}.`;

  const geotags: string[] = [];
  if (meta.country) geotags.push(`#${meta.country}`);
  if (meta.city) geotags.push(`#${meta.city}`);

  const json = {
    name: meta.name,
    description,
    // "circuit" is not decorative: Content Manager reads it to decide which race
    // modes the track supports, and warns "tag: circuit is missing" without it.
    tags: ["circuit", "autocross", "generated"],
    geotags,
    country: meta.country ?? "",
    city: meta.city ?? "",
    length: String(Math.round(meta.lengthMetres)),
    width: String(Math.round(meta.widthMetres)),
    // Must match the number of AC_PIT_n / AC_START_n dummies in the model, or AI
    // opponents have nowhere to spawn and the grid size is capped at this value.
    pitboxes: String(Math.max(1, meta.pitboxes ?? 1)),
    run: "",
    author: meta.author,
    version: "1.0",
    url: "",
  };

  return JSON.stringify(json, null, 2) + "\n";
}
