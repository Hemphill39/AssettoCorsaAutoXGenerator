import { buildAiLane, encodeFastLane } from "../ai/fastLane.js";
import { fuseCenterline, headingAt } from "../course/centerline.js";
import { layoutCones, type Cone, type ConeLayoutOptions } from "../course/cones.js";
import { buildReturnPath } from "../course/loop.js";
import { parseGpsCsv } from "../csv/parse.js";
import { splitRuns } from "../csv/splitRuns.js";
import { leftOf, rightOf } from "../geo/project.js";
import {
  MeshBuilder,
  boundsOf,
  buildConeMeshes,
  buildLotSurface,
  buildPaintedLine,
  buildPerimeterWall,
} from "../geometry/builders.js";
import { noisePng, solidPng } from "../geometry/texture.js";
import {
  buildGuidanceMeshes,
  coneSpacingFor,
  DEFAULT_GUIDANCE,
  type GuidanceOptions,
} from "../geometry/guidance.js";
import { encodeKn5, yawFacing } from "../kn5/encode.js";
import type { Kn5Dummy, Kn5Material, Kn5Model } from "../kn5/types.js";
import type { Run, Vec3 } from "../types.js";
import { renderMapPng, renderOutlinePng, renderPreviewPng } from "./images.js";
import { writeMapIni, writeSurfacesIni } from "./ini.js";
import type { TrackFile, TrackMeta } from "./types.js";
import { writeUiTrackJson } from "./uiTrack.js";
import { createZip } from "./zip.js";

/**
 * Assembles a complete, installable Assetto Corsa track from GPS logs.
 *
 * Everything is generated: geometry, physics surfaces, timing objects, the AI
 * racing line, and the metadata Content Manager reads. The output is a zip the
 * user drags onto Content Manager.
 */

export interface BuildOptions {
  /** Metres of asphalt to leave around the course footprint. */
  lotMargin: number;
  /** Distance from the lot edge to the perimeter wall, in metres. */
  wallMargin: number;
  /** Width of the drivable corridor, in metres. */
  courseWidth: number;
  cones: Partial<ConeLayoutOptions>;
  /**
   * How much visual help to paint onto the course. Real autocross is walked
   * before it is driven; arriving at 50 mph having never seen the layout needs
   * more than a sparse cone field. See geometry/guidance.ts.
   */
  guidance: Partial<GuidanceOptions>;
  /** Grid slots, i.e. the maximum car count including AI opponents. */
  gridSlots: number;
  author: string;
  /** Overrides the generated track id (folder name). */
  trackId?: string;
  trackName?: string;
  /**
   * Hand-edited cone positions, replacing the automatic layout entirely.
   *
   * Inference fits a corridor to the line that was driven; only the driver knows
   * where the cones actually were. Without this the editor would be cosmetic —
   * the preview would show edits the exported track did not contain.
   *
   * Course geometry, timing gates and guidance paint still derive from the
   * centreline, so overriding cones changes the cones and nothing else.
   */
  conesOverride?: Cone[];
}

export const DEFAULT_BUILD_OPTIONS: BuildOptions = {
  lotMargin: 25,
  wallMargin: 10,
  courseWidth: 9,
  cones: {},
  guidance: { level: "guided" },
  gridSlots: 12,
  author: "assetto-corsa-xcros",
};

export interface SourceFile {
  name: string;
  text: string;
}

export interface BuildResult {
  meta: TrackMeta;
  files: TrackFile[];
  zip: Uint8Array;
  cones: Cone[];
  centerline: Vec3[];
  runs: Run[];
  /** Non-fatal notes worth surfacing in the UI. */
  warnings: string[];
}

function slugify(input: string): string {
  const slug = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return slug || "autocross_course";
}

const encoder = new TextEncoder();

function textFile(path: string, contents: string): TrackFile {
  return { path, data: encoder.encode(contents) };
}

/**
 * How far back from the start line cars spawn, in metres.
 *
 * Far enough to be clearly before the line — so crossing it starts sector 1 —
 * but close enough to launch from a near standstill, as in real autocross.
 */
const ENTRY_DISTANCE = 14;

/**
 * Timing and spawn objects.
 *
 * Gate 0 sits at the course start (the lap line) and gate 1 at the course
 * finish, so AC's *sector 1* time is exactly the autocross run time while the lap
 * continues around the return path. See PLAN.md §3.1.
 */
function buildTimingDummies(
  centerline: Vec3[],
  courseEndIndex: number,
  halfWidth: number,
  gridSlots: number,
): Kn5Dummy[] {
  const headingOf = (index: number): Vec3 => {
    const prev = centerline[Math.max(0, index - 1)]!;
    const next = centerline[Math.min(centerline.length - 1, index + 1)]!;
    const dx = next.x - prev.x;
    const dz = next.z - prev.z;
    const len = Math.hypot(dx, dz) || 1;
    return { x: dx / len, y: 0, z: dz / len };
  };

  const gate = (index: number, id: string): Kn5Dummy[] => {
    const centre = centerline[index]!;
    const heading = headingOf(index);
    const left = leftOf(heading);
    const right = rightOf(heading);
    return [
      {
        name: `AC_TIME_${id}_L`,
        position: { x: centre.x + left.x * halfWidth, y: 0, z: centre.z + left.z * halfWidth },
        yaw: yawFacing(heading),
      },
      {
        name: `AC_TIME_${id}_R`,
        position: { x: centre.x + right.x * halfWidth, y: 0, z: centre.z + right.z * halfWidth },
        yaw: yawFacing(heading),
      },
    ];
  };

  const start = centerline[0]!;
  const startHeading = headingOf(0);
  const startYaw = yawFacing(startHeading);
  const right = rightOf(startHeading);

  /**
   * A staggered grid stretching back from the start line.
   *
   * AC caps the field at the number of AC_START_n / AC_PIT_n slots, so a single
   * slot means no AI opponents at all. Cars alternate left and right of the line
   * and step backwards, which keeps them clear of the first cones.
   */
  const grid: Kn5Dummy[] = [];
  for (let slot = 0; slot < gridSlots; slot++) {
    // Slot 0 is pole and sits ON the course centreline at the entrance, so a
    // single driver always starts lined up with the course rather than offset
    // to one side. Everyone else stacks in pairs behind it.
    const row = slot === 0 ? 0 : Math.floor((slot + 1) / 2);
    const lateral = slot === 0 ? 0 : (slot % 2 === 1 ? -1 : 1) * 3.5;
    const back = ENTRY_DISTANCE + row * 7;
    const position: Vec3 = {
      x: start.x - startHeading.x * back + right.x * lateral,
      y: 0,
      z: start.z - startHeading.z * back + right.z * lateral,
    };
    grid.push({ name: `AC_START_${slot}`, position, yaw: startYaw });
    // AC spawns the player in their PIT box for practice sessions, not on the
    // grid, so pit 0 has to be the good spot: right on the course centreline at
    // the entrance. Only the remaining boxes move aside, and they step further
    // back rather than sideways so a full grid still fits on the pavement.
    const pit: Vec3 =
      slot === 0
        ? { x: position.x, y: 0, z: position.z }
        : {
            x: position.x + right.x * 16 - startHeading.x * 6,
            y: 0,
            z: position.z + right.z * 16 - startHeading.z * 6,
          };
    grid.push({ name: `AC_PIT_${slot}`, position: pit, yaw: startYaw });
  }

  return [
    ...grid,
    // Hotlap/practice spawns at the same centred entrance, so the very first
    // crossing of the start line begins timing cleanly.
    {
      name: "AC_HOTLAP_START_0",
      position: {
        x: start.x - startHeading.x * ENTRY_DISTANCE,
        y: 0,
        z: start.z - startHeading.z * ENTRY_DISTANCE,
      },
      yaw: startYaw,
    },
    ...gate(0, "0"),
    ...gate(courseEndIndex, "1"),
  ];
}

export function buildTrack(
  sources: SourceFile[],
  options: Partial<BuildOptions> = {},
): BuildResult {
  const opt = { ...DEFAULT_BUILD_OPTIONS, ...options };
  const warnings: string[] = [];

  if (sources.length === 0) throw new Error("No source files supplied");

  const runs: Run[] = [];
  for (const source of sources) {
    const parsed = parseGpsCsv(source.text);
    if (parsed.skipped > 0) {
      warnings.push(`${source.name}: skipped ${parsed.skipped} unreadable rows`);
    }
    const found = splitRuns(parsed.samples, source.name);
    if (found.length === 0) {
      warnings.push(`${source.name}: no run long enough to use`);
    }
    runs.push(...found);
  }
  if (runs.length === 0) {
    throw new Error("None of the supplied files contained a usable run");
  }
  if (runs.length === 1) {
    warnings.push(
      "Only one run supplied. Cone positions are inferred from a single driven line, " +
        "so the course fits that lap by construction — expect to adjust cones by hand.",
    );
  }

  const fused = fuseCenterline(runs, {});
  // Guidance level drives cone density too: more help means more markers, not
  // just more paint.
  const guidance = { ...DEFAULT_GUIDANCE, ...opt.guidance };
  const spacing = coneSpacingFor(guidance.level);
  const inferred = layoutCones(fused.points, {
    gateWidth: opt.courseWidth,
    straightSpacing: spacing.straight,
    cornerSpacing: spacing.corner,
    ...opt.cones,
  });
  const cones = opt.conesOverride ?? inferred.cones;
  if (opt.conesOverride) {
    warnings.push(`Using ${opt.conesOverride.length} hand-placed cones instead of the automatic layout.`);
  }

  // Course line, then a return path closing it into a lap.
  const coursePositions = fused.points.map((p) => p.position);
  const returnPath = buildReturnPath(fused.points);
  const loop = [...coursePositions, ...returnPath];
  const courseEndIndex = coursePositions.length - 1;

  const halfWidth = opt.courseWidth / 2;
  const dummies = buildTimingDummies(loop, courseEndIndex, halfWidth, opt.gridSlots);

  // The starting grid extends well behind the start line, so it has to be inside
  // the paved area too — otherwise cars spawn off the edge of the world.
  const paved = [...loop, ...dummies.map((d) => d.position)];
  const lotBounds = boundsOf(paved, opt.lotMargin);
  const wallBounds = boundsOf(paved, opt.lotMargin + opt.wallMargin);

  // --- model ---
  const textures = [
    { name: "asphalt.png", data: noisePng({ r: 62, g: 62, b: 66 }, 10, 64, 11) },
    { name: "cone.png", data: solidPng(236, 88, 20) },
    { name: "paint.png", data: solidPng(232, 232, 232) },
    { name: "wall.png", data: noisePng({ r: 120, g: 120, b: 124 }, 8, 32, 5) },
  ];
  const materials: Kn5Material[] = [
    {
      name: "asphalt",
      shader: "ksPerPixel",
      props: { ksDiffuse: 0.35, ksAmbient: 0.45, ksSpecular: 0.05 },
      textures: { txDiffuse: "asphalt.png" },
    },
    {
      name: "coneMat",
      shader: "ksPerPixel",
      props: { ksDiffuse: 0.5, ksAmbient: 0.5 },
      textures: { txDiffuse: "cone.png" },
    },
    {
      name: "paintMat",
      shader: "ksPerPixel",
      props: { ksDiffuse: 0.4, ksAmbient: 0.5 },
      textures: { txDiffuse: "paint.png" },
    },
    {
      name: "wallMat",
      shader: "ksPerPixel",
      props: { ksDiffuse: 0.4, ksAmbient: 0.4 },
      textures: { txDiffuse: "wall.png" },
    },
  ];

  const paint = new MeshBuilder("paint_lines", 2);
  buildPaintedLine(paint, coursePositions[0]!, rightOf(headingAt(fused.points, 0)), halfWidth);
  buildPaintedLine(
    paint,
    coursePositions[courseEndIndex]!,
    rightOf(headingAt(fused.points, courseEndIndex)),
    halfWidth,
  );

  const model: Kn5Model = {
    textures,
    materials,
    meshes: [
      buildLotSurface(lotBounds, 0),
      ...buildConeMeshes(
        cones.map((c) => ({ position: c.position, forward: c.forward, laid: c.type === "pointer" })),
        1,
      ),
      paint.build({ castShadows: false }),
      ...buildGuidanceMeshes(fused.points, halfWidth, 2, guidance, inferred.slalomSpans),
      buildPerimeterWall(wallBounds, 3),
    ],
    dummies,
  };

  const kn5 = encodeKn5(model);

  // --- AI line: the driver's own line, closed into a lap ---
  const loopSpeeds = [
    ...fused.points.map((p) => p.speed),
    // Assume a gentle return-path speed rather than pretending we measured it.
    ...returnPath.map(() => 8),
  ];
  const aiLane = buildAiLane(loop, loopSpeeds, halfWidth);
  const runTimeMs = Math.round(runs[0]!.duration * 1000);
  const fastLane = encodeFastLane(aiLane, { lapTimeMs: runTimeMs });

  // --- metadata ---
  const runDate = sources[0]?.name.replace(/\.csv$/i, "") ?? "run";
  const id = opt.trackId ?? slugify(`xcross_${runDate}`);
  const meta: TrackMeta = {
    id,
    name: opt.trackName ?? `Autocross — ${runDate}`,
    description:
      `Generated from ${runs.length} GPS run${runs.length === 1 ? "" : "s"}. ` +
      `The course runs from the start line to the finish line; sector 1 is the ` +
      `autocross run itself, so compare your sector 1 against the real time. ` +
      `Cones are drive-through.`,
    author: opt.author,
    targetTimeMs: runTimeMs,
    lengthMetres: Math.round(fused.lengthMetres),
    widthMetres: opt.courseWidth,
    pitboxes: opt.gridSlots,
    country: "United States",
    city: "",
  };

  const conePositions = cones.map((c) => c.position);
  const files: TrackFile[] = [
    { path: `${id}.kn5`, data: kn5 },
    textFile("data/surfaces.ini", writeSurfacesIni()),
    { path: "ai/fast_lane.ai", data: fastLane },
    textFile("ui/ui_track.json", writeUiTrackJson(meta)),
    { path: "map.png", data: renderMapPng(loop, lotBounds) },
    textFile("data/map.ini", writeMapIni(lotBounds)),
    { path: "ui/preview.png", data: renderPreviewPng(loop, conePositions, lotBounds) },
    { path: "ui/outline.png", data: renderOutlinePng(loop, lotBounds) },
  ];

  return {
    meta,
    files,
    zip: createZip(files, id),
    cones,
    centerline: coursePositions,
    runs,
    warnings,
  };
}
