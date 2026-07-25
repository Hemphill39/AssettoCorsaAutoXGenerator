import type { Sample } from "../types.js";

/**
 * Parses the GPS logger's CSV export.
 *
 * Headers carry units (`SPEED (m/s)`, `LAT (deg)`, ...) which vary between
 * firmware revisions, so columns are matched on a normalised key rather than
 * the literal header text.
 */

/** `SPEED (m/s)` -> `speed`, `MATH_ELAPSED_DISTANCE` -> `mathelapseddistance` */
function normaliseHeader(header: string): string {
  return header
    .replace(/\(.*?\)/g, "") // drop unit annotations
    .replace(/[^A-Za-z0-9]/g, "")
    .toLowerCase();
}

/** Candidate column names per field, in order of preference. */
const COLUMNS = {
  gpsTime: ["gpstime"],
  lat: ["lat", "latitude"],
  lon: ["long", "lon", "longitude"],
  elev: ["elev", "elevation", "altitude", "alt"],
  speed: ["speed"],
  distance: ["mathelapseddistance", "elapseddistance", "distance"],
  radius: ["mathradius", "radius"],
  yawRate: ["yawrate"],
} as const;

type Field = keyof typeof COLUMNS;

export class CsvParseError extends Error {}

/** Splits a CSV line, tolerating quoted fields and trailing whitespace. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else quoted = false;
      } else cur += ch;
    } else if (ch === '"') {
      quoted = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

export interface ParseResult {
  samples: Sample[];
  /** Rows skipped because they were blank or unparseable. */
  skipped: number;
}

export function parseGpsCsv(text: string): ParseResult {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    throw new CsvParseError("File contains no data rows");
  }

  const headers = splitLine(lines[0]!).map(normaliseHeader);
  const columnIndex = {} as Record<Field, number>;

  for (const field of Object.keys(COLUMNS) as Field[]) {
    const idx = COLUMNS[field].map((c) => headers.indexOf(c)).find((i) => i >= 0);
    columnIndex[field] = idx ?? -1;
  }

  // Only position is truly required; everything else can be derived or defaulted.
  for (const required of ["lat", "lon"] as const) {
    if (columnIndex[required] < 0) {
      throw new CsvParseError(
        `Missing required column '${required}'. Found: ${headers.join(", ")}`,
      );
    }
  }

  const num = (cells: string[], idx: number): number => {
    if (idx < 0) return NaN;
    const raw = cells[idx];
    if (raw === undefined || raw === "") return NaN;
    const v = Number(raw);
    return Number.isFinite(v) ? v : NaN;
  };

  const samples: Sample[] = [];
  let skipped = 0;
  let timeBase: number | null = null;

  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]!);
    const lat = num(cells, columnIndex.lat);
    const lon = num(cells, columnIndex.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
      skipped++;
      continue;
    }

    const gpsTimeMs = num(cells, columnIndex.gpsTime);
    if (timeBase === null && Number.isFinite(gpsTimeMs)) timeBase = gpsTimeMs;
    // Fall back to a synthetic 10 Hz clock if the log has no time column.
    const t = Number.isFinite(gpsTimeMs)
      ? (gpsTimeMs - (timeBase ?? 0)) / 1000
      : samples.length * 0.1;

    samples.push({
      t,
      lat,
      lon,
      elev: num(cells, columnIndex.elev) || 0,
      speed: num(cells, columnIndex.speed) || 0,
      distance: num(cells, columnIndex.distance) || 0,
      radius: num(cells, columnIndex.radius),
      yawRate: num(cells, columnIndex.yawRate) || 0,
    });
  }

  if (samples.length === 0) {
    throw new CsvParseError("No rows contained usable GPS coordinates");
  }

  return { samples, skipped };
}
