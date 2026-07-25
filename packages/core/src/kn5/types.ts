import type { Vec3 } from "../types.js";

/** kn5 model format version 5 — see PLAN.md §2.1 for the verified byte layout. */
export const KN5_VERSION = 5;
export const KN5_MAGIC = "sc6969";

/** Indices are uint16, so a single mesh cannot exceed this vertex count. */
export const MAX_VERTICES_PER_MESH = 65536;

export enum BlendMode {
  Opaque = 0,
  AlphaBlend = 1,
  AlphaToCoverage = 2,
}

export enum DepthMode {
  DepthNormal = 0,
  DepthNoWrite = 1,
  DepthOff = 2,
}

export enum NodeClass {
  Node = 1,
  Mesh = 2,
  SkinnedMesh = 3,
}

/** Textures are embedded verbatim; AC accepts PNG and DDS. */
export interface Kn5Texture {
  name: string;
  data: Uint8Array;
}

export interface Kn5Material {
  name: string;
  /** e.g. "ksPerPixel", "ksPerPixelMultiMap", "ksGrass". */
  shader: string;
  blendMode?: BlendMode;
  alphaTested?: boolean;
  depthMode?: DepthMode;
  /** Scalar shader properties, e.g. { ksDiffuse: 0.4, ksAmbient: 0.4 }. */
  props?: Record<string, number>;
  /** Shader input name -> texture name, e.g. { txDiffuse: "asphalt.png" }. */
  textures?: Record<string, string>;
}

export interface Vertex {
  position: Vec3;
  normal: Vec3;
  uv: { u: number; v: number };
  tangent: Vec3;
}

export interface Kn5Mesh {
  /**
   * Naming drives physics (PLAN.md §2.3):
   *   `1ROAD...`  drivable surface, keyed to surfaces.ini
   *   `nWall...`  collidable barrier
   *   anything else -> non-physical decoration (this is how cones stay drive-through)
   */
  name: string;
  materialId: number;
  vertices: Vertex[];
  indices: number[];
  castShadows?: boolean;
  visible?: boolean;
  transparent?: boolean;
  renderable?: boolean;
  layer?: number;
  lodIn?: number;
  lodOut?: number;
}

/** An empty/dummy node — AC's logical objects (AC_START_0, AC_TIME_0_L, ...). */
export interface Kn5Dummy {
  name: string;
  position: Vec3;
  /** Compass-style yaw in radians: 0 faces north (+Z), increasing clockwise. */
  yaw?: number;
}

export interface Kn5Model {
  textures: Kn5Texture[];
  materials: Kn5Material[];
  meshes: Kn5Mesh[];
  dummies: Kn5Dummy[];
  rootName?: string;
}
