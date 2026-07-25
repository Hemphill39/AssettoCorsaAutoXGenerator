import { KN5_MAGIC, KN5_VERSION, NodeClass } from "./types.js";
import type { Vec3 } from "../types.js";

/**
 * Strict kn5 reader.
 *
 * Strictness is the point: it must consume the file to exactly EOF. Any
 * field-order drift in the encoder shows up as leftover or insufficient bytes
 * rather than as silently plausible garbage.
 */

export class Kn5DecodeError extends Error {}

export interface DecodedMesh {
  name: string;
  materialId: number;
  vertexCount: number;
  triangleCount: number;
  positions: Vec3[];
  maxIndex: number;
}

export interface DecodedDummy {
  name: string;
  position: Vec3;
}

export interface DecodedKn5 {
  version: number;
  textures: { name: string; byteLength: number; magic: string }[];
  materials: {
    name: string;
    shader: string;
    props: Record<string, number>;
    textures: Record<string, string>;
  }[];
  meshes: DecodedMesh[];
  dummies: DecodedDummy[];
  bytesConsumed: number;
  totalBytes: number;
}

class Reader {
  private pos = 0;
  private readonly view: DataView;
  private static readonly decoder = new TextDecoder();

  constructor(private readonly data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  private need(n: number): void {
    if (this.pos + n > this.data.length) {
      throw new Kn5DecodeError(
        `Wanted ${n} bytes at offset ${this.pos}, only ${this.data.length - this.pos} remain`,
      );
    }
  }

  uint32(): number {
    this.need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }

  int32(): number {
    this.need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }

  uint16(): number {
    this.need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }

  uint8(): number {
    this.need(1);
    return this.view.getUint8(this.pos++);
  }

  bool(): boolean {
    return this.uint8() !== 0;
  }

  float(): number {
    this.need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }

  vec3(): Vec3 {
    return { x: this.float(), y: this.float(), z: this.float() };
  }

  take(n: number): Uint8Array {
    this.need(n);
    const v = this.data.subarray(this.pos, this.pos + n);
    this.pos += n;
    return v;
  }

  string(): string {
    return Reader.decoder.decode(this.take(this.uint32()));
  }

  skip(n: number): void {
    this.need(n);
    this.pos += n;
  }

  get offset(): number {
    return this.pos;
  }
}

export function decodeKn5(data: Uint8Array): DecodedKn5 {
  const r = new Reader(data);

  const magic = new TextDecoder().decode(r.take(6));
  if (magic !== KN5_MAGIC) {
    throw new Kn5DecodeError(`Bad magic '${magic}', expected '${KN5_MAGIC}'`);
  }
  const version = r.uint32();
  if (version !== KN5_VERSION) {
    throw new Kn5DecodeError(`Unsupported kn5 version ${version}`);
  }

  const textures: DecodedKn5["textures"] = [];
  const textureCount = r.int32();
  for (let i = 0; i < textureCount; i++) {
    r.int32(); // active
    const name = r.string();
    const blob = r.take(r.uint32());
    textures.push({
      name,
      byteLength: blob.length,
      magic: Array.from(blob.subarray(0, 4))
        .map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : "."))
        .join(""),
    });
  }

  const materials: DecodedKn5["materials"] = [];
  const materialCount = r.int32();
  for (let i = 0; i < materialCount; i++) {
    const name = r.string();
    const shader = r.string();
    r.uint8(); // blend mode
    r.bool(); // alpha tested
    r.int32(); // depth mode
    const props: Record<string, number> = {};
    const propCount = r.uint32();
    for (let p = 0; p < propCount; p++) {
      const propName = r.string();
      props[propName] = r.float();
      r.skip(8 + 12 + 16); // vec2 + vec3 + vec4
    }
    const texs: Record<string, string> = {};
    const texCount = r.uint32();
    for (let t = 0; t < texCount; t++) {
      const input = r.string();
      r.uint32(); // slot
      texs[input] = r.string();
    }
    materials.push({ name, shader, props, textures: texs });
  }

  const meshes: DecodedMesh[] = [];
  const dummies: DecodedDummy[] = [];

  const readNode = (): void => {
    const nodeClass = r.uint32();
    const name = r.string();
    const childCount = r.uint32();
    r.bool(); // active

    if (nodeClass === NodeClass.Node) {
      const m: number[] = [];
      for (let i = 0; i < 16; i++) m.push(r.float());
      dummies.push({ name, position: { x: m[12]!, y: m[13]!, z: m[14]! } });
    } else if (nodeClass === NodeClass.Mesh) {
      r.bool();
      r.bool();
      r.bool(); // castShadows, visible, transparent
      const vertexCount = r.uint32();
      const positions: Vec3[] = [];
      for (let v = 0; v < vertexCount; v++) {
        positions.push(r.vec3());
        r.skip(12 + 8 + 12); // normal + uv + tangent
      }
      const indexCount = r.uint32();
      let maxIndex = -1;
      for (let i = 0; i < indexCount; i++) {
        const idx = r.uint16();
        if (idx > maxIndex) maxIndex = idx;
      }
      const materialId = r.uint32();
      r.uint32(); // layer
      r.float();
      r.float(); // lodIn, lodOut
      r.skip(12 + 4); // bounding sphere
      r.bool(); // renderable
      meshes.push({
        name,
        materialId,
        vertexCount,
        triangleCount: indexCount / 3,
        positions,
        maxIndex,
      });
    } else {
      throw new Kn5DecodeError(`Unsupported node class ${nodeClass} for '${name}'`);
    }

    for (let c = 0; c < childCount; c++) readNode();
  };

  readNode();

  const bytesConsumed = r.offset;
  if (bytesConsumed !== data.length) {
    throw new Kn5DecodeError(
      `Consumed ${bytesConsumed} of ${data.length} bytes — encoder and decoder disagree`,
    );
  }

  return {
    version,
    textures,
    materials,
    meshes,
    dummies,
    bytesConsumed,
    totalBytes: data.length,
  };
}
