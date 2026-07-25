import { BinaryWriter } from "../kn5/binary.js";
import type { Vec3 } from "../types.js";

/**
 * Encoder for Assetto Corsa's `fast_lane.ai` racing line (format version 7).
 *
 * Layout follows the actools implementation (the library behind Content
 * Manager), which reads the file as a strict sequence with an explicit extras
 * count. A second community implementation (leBluem/io_import_accsv) disagrees
 * on two points — it omits the extras count entirely and places sideLeft/
 * sideRight one slot later — but its reader also skips 72 bytes where the
 * format has a 4-byte field and reports the remainder as "unknown", so actools
 * is the credible source. Flagged in PLAN.md for in-game confirmation.
 *
 * For our purposes the AI line *is* the driver's own recorded line, so AI cars
 * replay the real run and AC's ideal-line overlay shows how it was actually
 * driven.
 */

export const AI_VERSION = 7;

export interface AiLanePoint {
  position: Vec3;
  /** Cumulative distance from the start of the lane, in metres. */
  distance: number;
  /** Metres per second at this point. */
  speed: number;
  /** Turn radius in metres; 0 where unknown or straight. */
  radius: number;
  /** Drivable width to the left of the line, in metres. */
  sideLeft: number;
  /** Drivable width to the right of the line, in metres. */
  sideRight: number;
  /** Unit forward vector along the lane. */
  forward: Vec3;
}

export interface AiLaneOptions {
  /** Lap time in milliseconds, stored in the header. */
  lapTimeMs?: number;
  sampleCount?: number;
}

export class AiLaneError extends Error {}

export function encodeFastLane(
  points: AiLanePoint[],
  options: AiLaneOptions = {},
): Uint8Array {
  if (points.length < 2) {
    throw new AiLaneError(`An AI lane needs at least 2 points, got ${points.length}`);
  }

  const w = new BinaryWriter();

  w.int32(AI_VERSION);
  w.int32(points.length);
  w.int32(Math.round(options.lapTimeMs ?? 0));
  w.int32(options.sampleCount ?? 0);

  // AiPoint: position, length, id
  points.forEach((p, i) => {
    w.floats([p.position.x, p.position.y, p.position.z]);
    w.float(p.distance);
    w.int32(i);
  });

  // AiPointExtra: 18 floats, in actools' field order.
  w.int32(points.length);
  for (const p of points) {
    w.float(p.speed); // speed
    w.float(0); // gas
    w.float(0); // brake
    w.float(0); // obsoleteLatG
    w.float(Number.isFinite(p.radius) ? p.radius : 0); // radius
    w.float(p.sideLeft); // sideLeft
    w.float(p.sideRight); // sideRight
    w.float(0); // camber
    w.float(0); // direction
    w.floats([0, 1, 0]); // normal — flat track, so straight up
    w.float(p.distance); // length
    w.floats([p.forward.x, p.forward.y, p.forward.z]); // forwardVector
    w.float(0); // tag
    w.float(0); // grade
  }

  // No spatial grid: AC rebuilds it, and omitting it keeps the writer simple.
  w.int32(0);

  return w.finish();
}

export interface DecodedAiLane {
  version: number;
  pointCount: number;
  lapTimeMs: number;
  sampleCount: number;
  points: { position: Vec3; distance: number; id: number }[];
  extras: {
    speed: number;
    radius: number;
    sideLeft: number;
    sideRight: number;
    length: number;
    forward: Vec3;
  }[];
  hasGrid: boolean;
  bytesConsumed: number;
  totalBytes: number;
}

/** Strict reader; must land exactly on EOF, same discipline as the kn5 decoder. */
export function decodeFastLane(data: Uint8Array): DecodedAiLane {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  let pos = 0;

  const int32 = (): number => {
    const v = view.getInt32(pos, true);
    pos += 4;
    return v;
  };
  const float = (): number => {
    const v = view.getFloat32(pos, true);
    pos += 4;
    return v;
  };
  const vec3 = (): Vec3 => ({ x: float(), y: float(), z: float() });

  const version = int32();
  if (version !== AI_VERSION) {
    throw new AiLaneError(`Unsupported AI lane version ${version}`);
  }
  const pointCount = int32();
  const lapTimeMs = int32();
  const sampleCount = int32();

  const points: DecodedAiLane["points"] = [];
  for (let i = 0; i < pointCount; i++) {
    points.push({ position: vec3(), distance: float(), id: int32() });
  }

  const extraCount = int32();
  const extras: DecodedAiLane["extras"] = [];
  for (let i = 0; i < extraCount; i++) {
    const speed = float();
    float(); // gas
    float(); // brake
    float(); // obsoleteLatG
    const radius = float();
    const sideLeft = float();
    const sideRight = float();
    float(); // camber
    float(); // direction
    vec3(); // normal
    const length = float();
    const forward = vec3();
    float(); // tag
    float(); // grade
    extras.push({ speed, radius, sideLeft, sideRight, length, forward });
  }

  const hasGrid = int32() !== 0;

  if (pos !== data.length) {
    throw new AiLaneError(
      `Consumed ${pos} of ${data.length} bytes — encoder and decoder disagree`,
    );
  }

  return {
    version,
    pointCount,
    lapTimeMs,
    sampleCount,
    points,
    extras,
    hasGrid,
    bytesConsumed: pos,
    totalBytes: data.length,
  };
}

/** Builds AI lane points from a centreline-like sequence of positions. */
export function buildAiLane(
  positions: Vec3[],
  speeds: number[],
  halfWidth: number,
  radii?: number[],
): AiLanePoint[] {
  if (positions.length < 2) throw new AiLaneError("Need at least 2 positions");

  let cumulative = 0;
  return positions.map((position, i) => {
    if (i > 0) {
      const prev = positions[i - 1]!;
      cumulative += Math.hypot(position.x - prev.x, position.z - prev.z);
    }
    const next = positions[Math.min(positions.length - 1, i + 1)]!;
    const prev = positions[Math.max(0, i - 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;

    return {
      position,
      distance: cumulative,
      speed: speeds[i] ?? 0,
      radius: radii?.[i] ?? 0,
      sideLeft: halfWidth,
      sideRight: halfWidth,
      forward: { x: dx / len, y: 0, z: dz / len },
    };
  });
}
