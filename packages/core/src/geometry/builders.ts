import type { Kn5Mesh, Vertex } from "../kn5/types.js";
import type { Vec3 } from "../types.js";

/**
 * Mesh builders for the generated parking lot.
 *
 * Triangle winding is the detail that decides whether a track works at all: get
 * it backwards and the surface is invisible and the car drops through the world.
 * Rather than guess, the convention below is derived from the reference Blender
 * exporter — see `orientedTriangle`.
 */

function subtract(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function normalize(v: Vec3): Vec3 {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

/**
 * Orders a triangle's vertices so its visible face points along `desiredNormal`.
 *
 * Derivation: the reference exporter converts Blender coordinates with
 * (x, y, z) -> (x, z, -y), a determinant +1 mapping that preserves winding. An
 * upward-facing Blender plane, wound counter-clockwise from +Z, therefore lands
 * in AC space such that the plain right-handed cross product of (p1-p0, p2-p0)
 * points along the visible face's normal. So we can simply test that cross
 * product and swap two vertices when it points the wrong way.
 */
export function orientedTriangle(
  p0: Vec3,
  p1: Vec3,
  p2: Vec3,
  desiredNormal: Vec3,
): [Vec3, Vec3, Vec3] {
  const facing = cross(subtract(p1, p0), subtract(p2, p0));
  return dot(facing, desiredNormal) >= 0 ? [p0, p1, p2] : [p0, p2, p1];
}

/** A tangent roughly perpendicular to the normal; AC tolerates approximations. */
function tangentFor(normal: Vec3): Vec3 {
  const candidate = Math.abs(normal.y) > 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 };
  return normalize(cross(candidate, normal));
}

export class MeshBuilder {
  private readonly vertices: Vertex[] = [];
  private readonly indices: number[] = [];

  constructor(
    readonly name: string,
    readonly materialId: number,
  ) {}

  get vertexCount(): number {
    return this.vertices.length;
  }

  addTriangle(p0: Vec3, p1: Vec3, p2: Vec3, normal: Vec3, uvScale = 10): void {
    const [a, b, c] = orientedTriangle(p0, p1, p2, normal);
    const tangent = tangentFor(normal);
    const base = this.vertices.length;
    for (const position of [a, b, c]) {
      this.vertices.push({
        position,
        normal,
        // Planar UVs from world position: fine for tiling asphalt and paint.
        uv: { u: position.x / uvScale, v: position.z / uvScale },
        tangent,
      });
    }
    this.indices.push(base, base + 1, base + 2);
  }

  addQuad(p0: Vec3, p1: Vec3, p2: Vec3, p3: Vec3, normal: Vec3, uvScale = 10): void {
    this.addTriangle(p0, p1, p2, normal, uvScale);
    this.addTriangle(p0, p2, p3, normal, uvScale);
  }

  build(overrides: Partial<Kn5Mesh> = {}): Kn5Mesh {
    return {
      name: this.name,
      materialId: this.materialId,
      vertices: this.vertices,
      indices: this.indices,
      ...overrides,
    };
  }
}

export interface LotBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

export function boundsOf(positions: Vec3[], margin = 0): LotBounds {
  if (positions.length === 0) throw new Error("Cannot bound an empty position list");
  const xs = positions.map((p) => p.x);
  const zs = positions.map((p) => p.z);
  return {
    minX: Math.min(...xs) - margin,
    maxX: Math.max(...xs) + margin,
    minZ: Math.min(...zs) - margin,
    maxZ: Math.max(...zs) + margin,
  };
}

/**
 * The drivable asphalt.
 *
 * Subdivided rather than a single huge quad so lighting varies across the
 * surface and UVs tile sensibly. The `1` prefix plus the `ROAD` key is what makes
 * AC treat it as a physical driving surface (see surfaces.ini).
 */
export function buildLotSurface(
  bounds: LotBounds,
  materialId: number,
  cellSize = 10,
  name = "1ROAD_lot",
): Kn5Mesh {
  const builder = new MeshBuilder(name, materialId);
  const up: Vec3 = { x: 0, y: 1, z: 0 };

  const cols = Math.max(1, Math.ceil((bounds.maxX - bounds.minX) / cellSize));
  const rows = Math.max(1, Math.ceil((bounds.maxZ - bounds.minZ) / cellSize));
  const stepX = (bounds.maxX - bounds.minX) / cols;
  const stepZ = (bounds.maxZ - bounds.minZ) / rows;

  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x0 = bounds.minX + col * stepX;
      const x1 = x0 + stepX;
      const z0 = bounds.minZ + row * stepZ;
      const z1 = z0 + stepZ;
      builder.addQuad(
        { x: x0, y: 0, z: z0 },
        { x: x0, y: 0, z: z1 },
        { x: x1, y: 0, z: z1 },
        { x: x1, y: 0, z: z0 },
        up,
      );
    }
  }
  return builder.build();
}

/**
 * A traffic cone.
 *
 * Roughly SCCA proportions: 18 inches tall on a square base. Deliberately named
 * without a `1` or `n` prefix so AC treats it as decoration — the car drives
 * straight through, which is the whole point (see PLAN.md §3.2).
 */
export function buildCone(
  builder: MeshBuilder,
  centre: Vec3,
  height = 0.46,
  radius = 0.16,
  baseHalf = 0.18,
  segments = 8,
): void {
  const apex: Vec3 = { x: centre.x, y: centre.y + height, z: centre.z };

  for (let i = 0; i < segments; i++) {
    const a0 = (i / segments) * Math.PI * 2;
    const a1 = ((i + 1) / segments) * Math.PI * 2;
    const p0: Vec3 = {
      x: centre.x + Math.cos(a0) * radius,
      y: centre.y,
      z: centre.z + Math.sin(a0) * radius,
    };
    const p1: Vec3 = {
      x: centre.x + Math.cos(a1) * radius,
      y: centre.y,
      z: centre.z + Math.sin(a1) * radius,
    };
    // Outward normal, tilted up to match the cone's slope.
    const midX = (p0.x + p1.x) / 2 - centre.x;
    const midZ = (p0.z + p1.z) / 2 - centre.z;
    const normal = normalize({ x: midX, y: radius / height, z: midZ });
    builder.addTriangle(p0, p1, apex, normal, 1);
  }

  // Square base plate, so cones read clearly from a driver's eye height.
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const y = centre.y + 0.01;
  builder.addQuad(
    { x: centre.x - baseHalf, y, z: centre.z - baseHalf },
    { x: centre.x - baseHalf, y, z: centre.z + baseHalf },
    { x: centre.x + baseHalf, y, z: centre.z + baseHalf },
    { x: centre.x + baseHalf, y, z: centre.z - baseHalf },
    up,
    1,
  );
}

/**
 * A cone laid on its side, pointing along `forward`.
 *
 * Autocross pointer cones: the cone lies flat with its tip indicating the
 * direction of travel. Built with a horizontal axis, resting on the ground.
 */
export function buildLaidCone(
  builder: MeshBuilder,
  base: Vec3,
  forward: Vec3,
  height = 0.46,
  radius = 0.16,
  segments = 8,
): void {
  const f = normalize({ x: forward.x, y: 0, z: forward.z });
  // Axis is horizontal, so the cone rests with its centreline one radius up.
  const centre: Vec3 = { x: base.x, y: base.y + radius, z: base.z };
  const right: Vec3 = { x: f.z, y: 0, z: -f.x }; // perpendicular in the ground plane
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  const apex: Vec3 = {
    x: centre.x + f.x * height,
    y: centre.y,
    z: centre.z + f.z * height,
  };

  const ring: Vec3[] = [];
  for (let k = 0; k < segments; k++) {
    const a = (k / segments) * Math.PI * 2;
    const c = Math.cos(a) * radius;
    const s = Math.sin(a) * radius;
    ring.push({
      x: centre.x + right.x * c + up.x * s,
      y: centre.y + right.y * c + up.y * s,
      z: centre.z + right.z * c + up.z * s,
    });
  }

  for (let k = 0; k < segments; k++) {
    const p0 = ring[k]!;
    const p1 = ring[(k + 1) % segments]!;
    const outward = normalize({
      x: (p0.x + p1.x) / 2 - centre.x,
      y: (p0.y + p1.y) / 2 - centre.y,
      z: (p0.z + p1.z) / 2 - centre.z,
    });
    builder.addTriangle(p0, p1, apex, outward, 1);
  }
}

export interface ConeInstance {
  position: Vec3;
  /** Present on pointer cones, which lie flat aiming this way. */
  forward?: Vec3;
  laid?: boolean;
}

/**
 * Cones merged into as few meshes as possible.
 *
 * Chunked to stay clear of the uint16 index limit while avoiding hundreds of
 * separate draw calls.
 */
export function buildConeMeshes(
  cones: ConeInstance[],
  materialId: number,
  namePrefix = "cones",
): Kn5Mesh[] {
  const VERTICES_PER_CONE = 8 * 3 + 6; // 8 side triangles + 2 base triangles
  const perMesh = Math.floor(60000 / VERTICES_PER_CONE);
  const meshes: Kn5Mesh[] = [];

  for (let chunk = 0; chunk * perMesh < cones.length; chunk++) {
    const builder = new MeshBuilder(`${namePrefix}_${chunk}`, materialId);
    for (const cone of cones.slice(chunk * perMesh, (chunk + 1) * perMesh)) {
      if (cone.laid && cone.forward) buildLaidCone(builder, cone.position, cone.forward);
      else buildCone(builder, cone.position);
    }
    meshes.push(builder.build({ castShadows: false }));
  }
  return meshes;
}

/**
 * A perimeter barrier.
 *
 * The `n` prefix makes it collidable, which stops the car driving off the edge
 * of the generated world into empty space.
 */
export function buildPerimeterWall(
  bounds: LotBounds,
  materialId: number,
  height = 2,
  name = "nWall_perimeter",
): Kn5Mesh {
  const builder = new MeshBuilder(name, materialId);
  const corners: Vec3[] = [
    { x: bounds.minX, y: 0, z: bounds.minZ },
    { x: bounds.minX, y: 0, z: bounds.maxZ },
    { x: bounds.maxX, y: 0, z: bounds.maxZ },
    { x: bounds.maxX, y: 0, z: bounds.minZ },
  ];
  const centre: Vec3 = {
    x: (bounds.minX + bounds.maxX) / 2,
    y: 0,
    z: (bounds.minZ + bounds.maxZ) / 2,
  };

  for (let i = 0; i < corners.length; i++) {
    const a = corners[i]!;
    const b = corners[(i + 1) % corners.length]!;
    // Face inward, so the wall is visible from inside the lot.
    const mid = { x: (a.x + b.x) / 2, y: 0, z: (a.z + b.z) / 2 };
    const inward = normalize({ x: centre.x - mid.x, y: 0, z: centre.z - mid.z });
    builder.addQuad(
      { x: a.x, y: 0, z: a.z },
      { x: a.x, y: height, z: a.z },
      { x: b.x, y: height, z: b.z },
      { x: b.x, y: 0, z: b.z },
      inward,
      5,
    );
  }
  return builder.build();
}

/** A painted stripe across the course, for the start and finish lines. */
export function buildPaintedLine(
  builder: MeshBuilder,
  centre: Vec3,
  right: Vec3,
  halfWidth: number,
  thickness = 0.3,
): void {
  const up: Vec3 = { x: 0, y: 1, z: 0 };
  // Forward is perpendicular to `right` in the ground plane.
  const forward: Vec3 = { x: -right.z, y: 0, z: right.x };
  const y = centre.y + 0.02; // float just above the asphalt to avoid z-fighting

  const corner = (side: number, along: number): Vec3 => ({
    x: centre.x + right.x * halfWidth * side + forward.x * thickness * along,
    y,
    z: centre.z + right.z * halfWidth * side + forward.z * thickness * along,
  });

  builder.addQuad(corner(-1, -1), corner(-1, 1), corner(1, 1), corner(1, -1), up, 2);
}
