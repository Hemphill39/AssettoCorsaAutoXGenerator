import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSurfacesIni, writeMapIni } from "../src/package/ini.js";
import { formatLapTime, writeUiTrackJson } from "../src/package/uiTrack.js";
import { createZip } from "../src/package/zip.js";
import type { TrackBounds, TrackFile, TrackMeta } from "../src/package/types.js";

function pythonPath(): string | null {
  try {
    return execFileSync("sh", ["-c", "command -v python3"]).toString().trim() || null;
  } catch {
    return null;
  }
}

/** Pulls `KEY=value` pairs out of one `[SECTION]` block for assertions. */
function parseIniSection(ini: string, section: string): Record<string, string> {
  const match = ini.match(new RegExp(`\\[${section}\\]\\n([^[]*)`));
  const body = match?.[1] ?? "";
  const out: Record<string, string> = {};
  for (const line of body.split("\n")) {
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

describe("writeSurfacesIni", () => {
  const ini = writeSurfacesIni();

  it("declares DEFAULT before SURFACE_0 before SURFACE_1", () => {
    const defaultAt = ini.indexOf("[DEFAULT]");
    const surface0At = ini.indexOf("[SURFACE_0]");
    const surface1At = ini.indexOf("[SURFACE_1]");
    expect(defaultAt).toBeGreaterThanOrEqual(0);
    expect(defaultAt).toBeLessThan(surface0At);
    expect(surface0At).toBeLessThan(surface1At);
  });

  it("gives SURFACE_0 realistic asphalt values keyed as ROAD", () => {
    const surface0 = parseIniSection(ini, "SURFACE_0");
    expect(surface0).toMatchObject({
      KEY: "ROAD",
      FRICTION: "0.99",
      DAMPING: "0",
      WAV_PITCH: "0",
      IS_VALID_TRACK: "1",
      BLACK_FLAG_TIME: "0",
      SIN_HEIGHT: "0",
      SIN_LENGTH: "0",
      VIBRATION_GAIN: "0",
      VIBRATION_LENGTH: "0",
    });
  });

  it("gives SURFACE_1 off-track grass values keyed as GRASS", () => {
    const surface1 = parseIniSection(ini, "SURFACE_1");
    expect(surface1).toMatchObject({
      KEY: "GRASS",
      FRICTION: "0.6",
      IS_VALID_TRACK: "0",
      BLACK_FLAG_TIME: "10",
    });
  });

  it("never leaks the mesh-name digit prefix into KEY", () => {
    // Mesh `1ROAD_lot` -> surfaces.ini KEY=ROAD, per PLAN.md 2.3.
    expect(ini).not.toMatch(/KEY=\dROAD/);
  });
});

describe("writeMapIni", () => {
  const bounds: TrackBounds = { minX: 10, maxX: 110, minZ: -5, maxZ: 45 };

  it("sizes the canvas as world extent plus margin on both sides, at 1 px/m", () => {
    const params = parseIniSection(writeMapIni(bounds, 20), "PARAMS");
    expect(params.WIDTH).toBe("140"); // (110-10) + 2*20
    expect(params.HEIGHT).toBe("90"); // (45-(-5)) + 2*20
    expect(params.MARGIN).toBe("20");
    expect(params.SCALE_FACTOR).toBe("1");
  });

  it("folds the margin into X_OFFSET/Z_OFFSET (margin - min), not just -min", () => {
    const params = parseIniSection(writeMapIni(bounds, 20), "PARAMS");
    expect(params.X_OFFSET).toBe("10"); // 20 - 10
    expect(params.Z_OFFSET).toBe("25"); // 20 - (-5)
  });

  it("maps a known world point to the expected pixel", () => {
    const margin = 20;
    const params = parseIniSection(writeMapIni(bounds, margin), "PARAMS");
    const xOffset = Number(params.X_OFFSET);
    const zOffset = Number(params.Z_OFFSET);
    const scale = Number(params.SCALE_FACTOR);

    // Margin is already folded into X_OFFSET/Z_OFFSET, so the runtime transform
    // is just (world + OFFSET) * SCALE_FACTOR — see worldToPixel in images.ts.
    const toPixel = (worldX: number, worldZ: number): [number, number] => [
      (worldX + xOffset) * scale,
      (worldZ + zOffset) * scale,
    ];

    // The min corner must land exactly `margin` px inside the canvas...
    expect(toPixel(bounds.minX, bounds.minZ)).toEqual([20, 20]);
    // ...and the max corner exactly `margin` px from the far edge.
    expect(toPixel(bounds.maxX, bounds.maxZ)).toEqual([120, 70]);
    // An arbitrary interior point.
    expect(toPixel(60, 20)).toEqual([70, 45]);
  });

  it("defaults the margin to 20 metres", () => {
    const withDefault = parseIniSection(writeMapIni(bounds), "PARAMS");
    const explicit = parseIniSection(writeMapIni(bounds, 20), "PARAMS");
    expect(withDefault).toEqual(explicit);
  });
});

describe("formatLapTime", () => {
  it("formats zero", () => {
    expect(formatLapTime(0)).toBe("0:00.000");
  });

  it("formats sub-minute times without a leading zero on minutes", () => {
    expect(formatLapTime(45123)).toBe("0:45.123");
  });

  it("formats the PLAN.md example lap time", () => {
    expect(formatLapTime(78500)).toBe("1:18.500");
  });

  it("formats times over 10 minutes", () => {
    expect(formatLapTime(725_001)).toBe("12:05.001");
  });
});

describe("writeUiTrackJson", () => {
  const meta: TrackMeta = {
    id: "test_track",
    name: "Test Track",
    description: "A test autocross course.",
    author: "Eric",
    targetTimeMs: 78500,
    lengthMetres: 1176.4,
    widthMetres: 9.5,
    country: "USA",
    city: "Springfield",
  };

  it("emits parseable JSON with the expected keys", () => {
    const parsed = JSON.parse(writeUiTrackJson(meta));
    expect(Object.keys(parsed).sort()).toEqual(
      [
        "name",
        "description",
        "tags",
        "geotags",
        "country",
        "city",
        "length",
        "width",
        "pitboxes",
        "run",
        "author",
        "version",
        "url",
      ].sort(),
    );
  });

  it("carries name, author, length, width and pitboxes through", () => {
    const parsed = JSON.parse(writeUiTrackJson(meta));
    expect(parsed.name).toBe("Test Track");
    expect(parsed.author).toBe("Eric");
    expect(parsed.length).toBe("1176");
    expect(parsed.width).toBe("10");
    expect(parsed.pitboxes).toBe("1");
    expect(parsed.run).toBe("");
  });

  it("tags the track as autocross and generated", () => {
    const parsed = JSON.parse(writeUiTrackJson(meta));
    expect(parsed.tags).toEqual(expect.arrayContaining(["autocross", "generated"]));
  });

  it("embeds the formatted target time in the description", () => {
    const parsed = JSON.parse(writeUiTrackJson(meta));
    expect(parsed.description).toContain(formatLapTime(78500));
    expect(parsed.description).toContain("1:18.500");
  });

  it("is 2-space indented", () => {
    const json = writeUiTrackJson(meta);
    expect(json).toContain('{\n  "name"');
  });

  it("falls back to empty strings when country/city are absent", () => {
    const { country: _country, city: _city, ...rest } = meta;
    const parsed = JSON.parse(writeUiTrackJson(rest as TrackMeta));
    expect(parsed.country).toBe("");
    expect(parsed.city).toBe("");
    expect(parsed.geotags).toEqual([]);
  });
});

describe("createZip", () => {
  function sampleFiles(): TrackFile[] {
    const encoder = new TextEncoder();
    return [
      { path: "hello.txt", data: encoder.encode("hello track package\n") },
      { path: "data/surfaces.ini", data: encoder.encode(writeSurfacesIni()) },
      {
        path: "ui/ui_track.json",
        data: encoder.encode(
          writeUiTrackJson({
            id: "test_track",
            name: "Test Track",
            description: "A test autocross course.",
            author: "Eric",
            targetTimeMs: 78500,
            lengthMetres: 1176,
            widthMetres: 10,
          }),
        ),
      },
    ];
  }

  it("prefixes every entry path with the root folder", () => {
    const zip = createZip(sampleFiles(), "test_track");
    const text = new TextDecoder("latin1").decode(zip);
    expect(text).toContain("test_track/hello.txt");
    expect(text).toContain("test_track/data/surfaces.ini");
    expect(text).toContain("test_track/ui/ui_track.json");
  });

  it("starts local entries with the PK\\x03\\x04 signature", () => {
    const zip = createZip(sampleFiles(), "test_track");
    expect(Array.from(zip.subarray(0, 4))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("ends with the end-of-central-directory signature", () => {
    const zip = createZip(sampleFiles(), "test_track");
    const eocd = zip.subarray(zip.length - 22, zip.length - 18);
    expect(Array.from(eocd)).toEqual([0x50, 0x4b, 0x05, 0x06]);
  });

  it("is byte-reproducible given the same input", () => {
    const a = createZip(sampleFiles(), "test_track");
    const b = createZip(sampleFiles(), "test_track");
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

describe("cross-implementation zip check", () => {
  /**
   * We hand-roll local/central headers and CRC-32 rather than trusting a library, so
   * the one test that actually matters is whether an independent implementation —
   * Python's stdlib zipfile — agrees the archive is well-formed.
   */
  it("produces a zip that Python can open, verify, and read back byte-for-byte", () => {
    const python = pythonPath();
    if (!python) {
      console.warn("python3 not found — skipping zip cross-check");
      return;
    }

    const encoder = new TextEncoder();
    const helloContent = "hello track package\n";
    const files: TrackFile[] = [
      { path: "hello.txt", data: encoder.encode(helloContent) },
      { path: "data/surfaces.ini", data: encoder.encode(writeSurfacesIni()) },
    ];
    const zip = createZip(files, "test_track");

    const dir = mkdtempSync(join(tmpdir(), "xcross-zip-"));
    const zipPath = join(dir, "test_track.zip");
    writeFileSync(zipPath, zip);

    const script = [
      "import sys, json, zipfile",
      "path = sys.argv[1]",
      "zf = zipfile.ZipFile(path)",
      "result = {",
      "    'bad': zf.testzip(),",
      "    'names': zf.namelist(),",
      "    'hello': zf.read('test_track/hello.txt').decode('utf-8'),",
      "}",
      "print(json.dumps(result))",
    ].join("\n");

    const output = execFileSync(python, ["-c", script, zipPath]).toString();
    const result = JSON.parse(output);

    expect(result.bad).toBeNull(); // testzip() returned None: every CRC-32 checks out
    expect(result.names).toEqual(["test_track/hello.txt", "test_track/data/surfaces.ini"]);
    expect(result.hello).toBe(helloContent);
  });
});
