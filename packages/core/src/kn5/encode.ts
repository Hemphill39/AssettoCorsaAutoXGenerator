import { BinaryWriter } from "./binary.js";
import {
  BlendMode,
  DepthMode,
  KN5_MAGIC,
  KN5_VERSION,
  MAX_VERTICES_PER_MESH,
  NodeClass,
  type Kn5Dummy,
  type Kn5Material,
  type Kn5Mesh,
  type Kn5Model,
  type Vertex,
} from "./types.js";
import type { Vec3 } from "../types.js";

/**
 * Encodes a kn5 model (format version 5).
 *
 * Layout verified by round-tripping generated files through an independent
 * parser; see PLAN.md §2.1. Two properties simplify this a lot: mesh vertices
 * are world-space with no per-mesh transform, and textures embed as raw bytes.
 */

export class Kn5EncodeError extends Error {}

/**
 * Transform matrix for a dummy: yaw about Y, then translation.
 *
 * DirectX row-vector convention, so translation occupies floats 12..14 and a
 * yaw of θ maps forward (0,0,1) to (sinθ, 0, cosθ) — i.e. a clockwise compass
 * bearing from north, matching our east=X / north=Z projection.
 */
function dummyMatrix(position: Vec3, yaw: number): number[] {
  const s = Math.sin(yaw);
  const c = Math.cos(yaw);
  return [
    c, 0, -s, 0,
    0, 1, 0, 0,
    s, 0, c, 0,
    position.x, position.y, position.z, 1,
  ];
}

/** Yaw that makes a dummy face along `forward`. Inverse of dummyMatrix's mapping. */
export function yawFacing(forward: Vec3): number {
  return Math.atan2(forward.x, forward.z);
}

/**
 * Bounding sphere over a mesh's vertices.
 *
 * Deliberately matches the reference exporter's (loose) formula rather than a
 * minimal enclosing sphere: AC uses this for culling, and an over-large sphere
 * merely costs a little performance, whereas too small a one makes geometry
 * vanish at certain camera angles.
 */
function boundingSphere(vertices: Vertex[]): { center: Vec3; radius: number } {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const { position } of vertices) {
    if (position.x < minX) minX = position.x;
    if (position.x > maxX) maxX = position.x;
    if (position.y < minY) minY = position.y;
    if (position.y > maxY) maxY = position.y;
    if (position.z < minZ) minZ = position.z;
    if (position.z > maxZ) maxZ = position.z;
  }
  if (!vertices.length) {
    return { center: { x: 0, y: 0, z: 0 }, radius: 0 };
  }
  return {
    center: {
      x: minX + (maxX - minX) / 2,
      y: minY + (maxY - minY) / 2,
      z: minZ + (maxZ - minZ) / 2,
    },
    radius: Math.max((maxX - minX) / 2, (maxY - minY) / 2, (maxZ - minZ) / 2) * 2,
  };
}

function writeMaterial(w: BinaryWriter, material: Kn5Material): void {
  w.string(material.name);
  w.string(material.shader);
  w.uint8(material.blendMode ?? BlendMode.Opaque);
  w.bool(material.alphaTested ?? false);
  w.int32(material.depthMode ?? DepthMode.DepthNormal);

  const props = material.props ?? {};
  const propNames = Object.keys(props);
  w.uint32(propNames.length);
  for (const name of propNames) {
    w.string(name);
    w.float(props[name]!);
    w.floats([0, 0]); // vec2 B
    w.floats([0, 0, 0]); // vec3 C
    w.floats([0, 0, 0, 0]); // vec4 D
  }

  const textures = material.textures ?? {};
  const inputs = Object.keys(textures);
  w.uint32(inputs.length);
  inputs.forEach((shaderInput, slot) => {
    w.string(shaderInput);
    w.uint32(slot);
    w.string(textures[shaderInput]!);
  });
}

function writeMesh(w: BinaryWriter, mesh: Kn5Mesh): void {
  if (mesh.vertices.length > MAX_VERTICES_PER_MESH) {
    throw new Kn5EncodeError(
      `Mesh '${mesh.name}' has ${mesh.vertices.length} vertices, exceeding the ` +
        `uint16 index limit of ${MAX_VERTICES_PER_MESH}. Split it into chunks.`,
    );
  }
  if (mesh.indices.length % 3 !== 0) {
    throw new Kn5EncodeError(
      `Mesh '${mesh.name}' has ${mesh.indices.length} indices, which is not a multiple of 3.`,
    );
  }
  for (const index of mesh.indices) {
    if (index >= mesh.vertices.length || index < 0) {
      throw new Kn5EncodeError(
        `Mesh '${mesh.name}' references vertex ${index} but only has ${mesh.vertices.length}.`,
      );
    }
  }

  w.uint32(NodeClass.Mesh);
  w.string(mesh.name);
  w.uint32(0); // meshes may not have children
  w.bool(true); // active
  w.bool(mesh.castShadows ?? true);
  w.bool(mesh.visible ?? true);
  w.bool(mesh.transparent ?? false);

  w.uint32(mesh.vertices.length);
  for (const v of mesh.vertices) {
    w.floats([v.position.x, v.position.y, v.position.z]);
    w.floats([v.normal.x, v.normal.y, v.normal.z]);
    w.floats([v.uv.u, v.uv.v]);
    w.floats([v.tangent.x, v.tangent.y, v.tangent.z]);
  }

  w.uint32(mesh.indices.length);
  for (const index of mesh.indices) w.uint16(index);

  w.uint32(mesh.materialId);
  w.uint32(mesh.layer ?? 0);
  w.float(mesh.lodIn ?? 0);
  w.float(mesh.lodOut ?? 1e6);

  const sphere = boundingSphere(mesh.vertices);
  w.floats([sphere.center.x, sphere.center.y, sphere.center.z]);
  w.float(sphere.radius);
  w.bool(mesh.renderable ?? true);
}

function writeDummy(w: BinaryWriter, dummy: Kn5Dummy, childCount: number): void {
  w.uint32(NodeClass.Node);
  w.string(dummy.name);
  w.uint32(childCount);
  w.bool(true);
  w.floats(dummyMatrix(dummy.position, dummy.yaw ?? 0));
}

export function encodeKn5(model: Kn5Model): Uint8Array {
  for (const mesh of model.meshes) {
    if (mesh.materialId >= model.materials.length || mesh.materialId < 0) {
      throw new Kn5EncodeError(
        `Mesh '${mesh.name}' references material ${mesh.materialId} but only ` +
          `${model.materials.length} are defined.`,
      );
    }
  }
  const textureNames = new Set(model.textures.map((t) => t.name));
  for (const material of model.materials) {
    for (const texName of Object.values(material.textures ?? {})) {
      if (!textureNames.has(texName)) {
        throw new Kn5EncodeError(
          `Material '${material.name}' references texture '${texName}', which is not embedded.`,
        );
      }
    }
  }

  const w = new BinaryWriter();
  w.bytes(new TextEncoder().encode(KN5_MAGIC));
  w.uint32(KN5_VERSION);

  w.int32(model.textures.length);
  for (const texture of model.textures) {
    w.int32(1); // active
    w.string(texture.name);
    w.blob(texture.data);
  }

  w.int32(model.materials.length);
  for (const material of model.materials) writeMaterial(w, material);

  // Node tree: one root with every mesh and dummy as a direct child.
  writeDummy(
    w,
    { name: model.rootName ?? "root", position: { x: 0, y: 0, z: 0 } },
    model.meshes.length + model.dummies.length,
  );
  for (const dummy of model.dummies) writeDummy(w, dummy, 0);
  for (const mesh of model.meshes) writeMesh(w, mesh);

  return w.finish();
}
