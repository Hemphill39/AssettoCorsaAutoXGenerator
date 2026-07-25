/** Little-endian growable binary writer. kn5 is little-endian throughout. */
export class BinaryWriter {
  private buf: Uint8Array;
  private view: DataView;
  private pos = 0;
  private static readonly encoder = new TextEncoder();

  constructor(initialCapacity = 1 << 16) {
    this.buf = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let capacity = this.buf.length || 1;
    while (capacity < this.pos + extra) capacity *= 2;
    const next = new Uint8Array(capacity);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  uint32(v: number): void {
    this.ensure(4);
    this.view.setUint32(this.pos, v, true);
    this.pos += 4;
  }

  int32(v: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, v, true);
    this.pos += 4;
  }

  uint16(v: number): void {
    this.ensure(2);
    this.view.setUint16(this.pos, v, true);
    this.pos += 2;
  }

  uint8(v: number): void {
    this.ensure(1);
    this.view.setUint8(this.pos, v);
    this.pos += 1;
  }

  bool(v: boolean): void {
    this.uint8(v ? 1 : 0);
  }

  float(v: number): void {
    this.ensure(4);
    this.view.setFloat32(this.pos, v, true);
    this.pos += 4;
  }

  floats(values: readonly number[]): void {
    for (const v of values) this.float(v);
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buf.set(data, this.pos);
    this.pos += data.length;
  }

  /** uint32 byte-length prefix followed by UTF-8 bytes. */
  string(v: string): void {
    const encoded = BinaryWriter.encoder.encode(v);
    this.uint32(encoded.length);
    this.bytes(encoded);
  }

  /** uint32 byte-length prefix followed by raw bytes. */
  blob(data: Uint8Array): void {
    this.uint32(data.length);
    this.bytes(data);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }

  get length(): number {
    return this.pos;
  }
}
