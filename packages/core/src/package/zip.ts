/**
 * Dependency-free ZIP writer. Assetto Corsa packages are small (a few MB at most) and
 * Content Manager doesn't care about compression, so this only ever emits STORE
 * (method 0) entries — no deflate needed, and it runs identically in Node and the
 * browser (unlike PNG, ZIP has no need for even the stored-deflate trick since STORE
 * is a first-class method in the format itself).
 */

import { crc32 } from "../util/crc32.js";
import type { TrackFile } from "./types.js";

// Fixed DOS date/time (2020-01-01 00:00:00) so package output is byte-reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

const LOCAL_SIGNATURE = 0x04034b50;
const CENTRAL_SIGNATURE = 0x02014b50;
const EOCD_SIGNATURE = 0x06054b50;
const VERSION = 20; // 2.0, minimum that unambiguously supports STORE

interface Entry {
  nameBytes: Uint8Array;
  data: Uint8Array;
  crc: number;
  localOffset: number;
}

function buildLocalHeader(entry: Entry): Uint8Array {
  const header = new Uint8Array(30 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, LOCAL_SIGNATURE, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, 0, true); // flags
  view.setUint16(8, 0, true); // method: store
  view.setUint16(10, DOS_TIME, true);
  view.setUint16(12, DOS_DATE, true);
  view.setUint32(14, entry.crc, true);
  view.setUint32(18, entry.data.length, true); // compressed size
  view.setUint32(22, entry.data.length, true); // uncompressed size
  view.setUint16(26, entry.nameBytes.length, true);
  view.setUint16(28, 0, true); // extra field length
  header.set(entry.nameBytes, 30);
  return header;
}

function buildCentralHeader(entry: Entry): Uint8Array {
  const header = new Uint8Array(46 + entry.nameBytes.length);
  const view = new DataView(header.buffer);
  view.setUint32(0, CENTRAL_SIGNATURE, true);
  view.setUint16(4, VERSION, true); // version made by
  view.setUint16(6, VERSION, true); // version needed
  view.setUint16(8, 0, true); // flags
  view.setUint16(10, 0, true); // method: store
  view.setUint16(12, DOS_TIME, true);
  view.setUint16(14, DOS_DATE, true);
  view.setUint32(16, entry.crc, true);
  view.setUint32(20, entry.data.length, true); // compressed size
  view.setUint32(24, entry.data.length, true); // uncompressed size
  view.setUint16(28, entry.nameBytes.length, true);
  view.setUint16(30, 0, true); // extra field length
  view.setUint16(32, 0, true); // comment length
  view.setUint16(34, 0, true); // disk number start
  view.setUint16(36, 0, true); // internal attrs
  view.setUint32(38, 0, true); // external attrs
  view.setUint32(42, entry.localOffset, true);
  header.set(entry.nameBytes, 46);
  return header;
}

/** Builds a STORE-only ZIP with every entry rooted under `rootFolder/`. */
export function createZip(files: TrackFile[], rootFolder: string): Uint8Array {
  const encoder = new TextEncoder();
  const parts: Uint8Array[] = [];
  const entries: Entry[] = [];
  let offset = 0;

  for (const file of files) {
    const nameBytes = encoder.encode(`${rootFolder}/${file.path}`);
    const entry: Entry = { nameBytes, data: file.data, crc: crc32(file.data), localOffset: offset };
    entries.push(entry);

    const local = buildLocalHeader(entry);
    parts.push(local, entry.data);
    offset += local.length + entry.data.length;
  }

  const centralStart = offset;
  for (const entry of entries) {
    const central = buildCentralHeader(entry);
    parts.push(central);
    offset += central.length;
  }
  const centralSize = offset - centralStart;

  const eocd = new Uint8Array(22);
  const eocdView = new DataView(eocd.buffer);
  eocdView.setUint32(0, EOCD_SIGNATURE, true);
  eocdView.setUint16(4, 0, true); // disk number
  eocdView.setUint16(6, 0, true); // disk with central dir
  eocdView.setUint16(8, entries.length, true); // entries on this disk
  eocdView.setUint16(10, entries.length, true); // total entries
  eocdView.setUint32(12, centralSize, true);
  eocdView.setUint32(16, centralStart, true);
  eocdView.setUint16(20, 0, true); // comment length
  parts.push(eocd);

  const total = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of parts) {
    out.set(part, p);
    p += part.length;
  }
  return out;
}
