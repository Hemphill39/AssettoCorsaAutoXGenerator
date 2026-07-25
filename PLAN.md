# Autocross → Assetto Corsa Track Generator

Turn real autocross GPS logs into drivable Assetto Corsa tracks, so a course you can
only run three times a weekend becomes one you can run all winter.

**Status:** built and confirmed in-game — installs, drives, and lap/sector timing
works. See `TESTING.md` for what real driving verified and corrected.

---

## 1. Goal

A cross-platform app that lets a user:

1. **Upload** one or more GPS run logs (`run1-8.csv` format, 10 Hz)
2. **Preview** the reconstructed course in 3D, with cones laid out in a parking lot
3. **Edit** cone positions by hand when the inference gets it wrong
4. **Export** a track package that installs into Assetto Corsa via Content Manager

Nice-to-haves, in priority order: parking-lot themes, a Google Maps / OSM lot picker,
in-sim cone-hit penalties.

---

## 2. Spike results — verified, not assumed

The main project risk was whether a track model (`.kn5`) can be generated
programmatically, or whether it requires the manual 3ds Max / ksEditor pipeline that
every modding tutorial describes. **It can be generated.** Everything below was
confirmed by writing a file and parsing it back, not by reading documentation.

### 2.1 `.kn5` format version 5 — CONFIRMED WORKING

A from-scratch Python writer (~200 lines, no dependencies, no Blender) produced a file
that a strict independent parser consumed to **exactly EOF (10665/10665 bytes)** with all
geometry, materials, and embedded textures intact.

```
header    : b"sc6969" + uint32 version(=5)
strings   : uint32 byteLength + utf-8 bytes
textures  : int32 count
            per texture: int32 active(=1), string name, uint32 blobLen + blob (PNG or DDS)
materials : int32 count
            per material: string name, string shaderName, byte alphaBlendMode,
                          bool alphaTested, int32 depthMode,
                          uint32 propCount, per prop: string name, float A,
                                                      vec2 B, vec3 C, vec4 D,
                          uint32 texMapCount, per: string shaderInput, uint32 slot,
                                                   string textureName
nodes     : depth-first tree, each node:
              uint32 class (1=Node, 2=Mesh, 3=SkinnedMesh)
              string name, uint32 childCount, bool active
            class 1 (Node/dummy):
              4x4 float matrix, DX row-major — translation at float indices 12,13,14
            class 2 (Mesh):
              bool castShadows, bool visible, bool transparent
              uint32 vertexCount, per vertex: vec3 pos, vec3 normal, vec2 uv, vec3 tangent
              uint32 indexCount, per index: uint16
              uint32 materialId, uint32 layer, float lodIn, float lodOut
              vec3 boundingSphereCenter, float boundingSphereRadius
              bool isRenderable
```

Two properties make procedural generation much easier than expected:

- **Mesh vertices are world-space with no per-mesh transform.** We emit final coordinates
  directly; no transform hierarchy math.
- **Textures are embedded as raw PNG bytes.** No DDS conversion toolchain needed.

Constraints: max 2^16 vertices per mesh (indices are `uint16`), so large surfaces must be
split. Meshes cannot have children.

Coordinate system: AC is **right-handed and Y-up — X = east, Y = up, Z = south.**
The Blender→AC conversion `(x, y, z) → (x, z, −y)` has determinant **+1**, so it
preserves Blender's right-handed orientation. A right-handed frame with X = east
and Y = up then forces `Z = east × up = south`.

This matters more than it looks. Projecting north to +Z makes `(east, up, north)`
— a *left*-handed triple — and the engine renders the whole course as a mirror
image, turning every left turn into a right turn. It still looks like a perfectly
plausible autocross course, which is exactly why the mistake survived several
rounds of testing. It also swaps `AC_TIME_n_L`/`_R`, which stops the timing gates
firing at all.

### 2.2 `fast_lane.ai` format version 7 — CONFIRMED (from actools source)

```
int32 version(=7)
int32 pointCount
int32 lapTime          <- milliseconds
int32 sampleCount
pointCount   x AiPoint      { vec3 position, float length, int32 id }              (20 B)
int32 extraCount
extraCount   x AiPointExtra { float speed, gas, brake, obsoleteLatG, radius,
                              sideLeft, sideRight, camber, direction,
                              vec3 normal, float length, vec3 forwardVector,
                              float tag, grade }                                   (72 B)
int32 hasGrid          <- 0 to omit the optional spatial grid
```

This maps onto the source data almost field-for-field:

| AI field | Source |
|---|---|
| `position` | projected GPS lat/lon/elev |
| `length` | `MATH_ELAPSED_DISTANCE` |
| `speed` | `SPEED (m/s)` |
| `radius` | `MATH_RADIUS` |
| `sideLeft` / `sideRight` | half the gate width — also defines AC's drivable corridor |
| `lapTime` | his real measured run time |

So the AI racing line **is** his actual driven line: AI cars replay his run, and the
"ideal line" overlay shows how he drove it.

### 2.3 Track conventions — CONFIRMED

- **Drivable surface:** mesh name must be `<digit><KEY>`, e.g. `1ROAD`. The leading digit
  exists only to allow multiple meshes per surface type; `surfaces.ini` uses `KEY=ROAD`
  (no digit). `01ROAD` is valid, `0ROAD` is not.
- **Collidable wall:** mesh name starting with `n`, e.g. `nWall_perimeter`.
- **Non-physical decoration:** any other name — this is how cones become drive-through.
- **Circuit timing objects (dummies):** `AC_START_0`, `AC_PIT_0`, `AC_HOTLAP_START_0`,
  and at least two timing gates: `AC_TIME_0_L`/`AC_TIME_0_R` (start/finish) and
  `AC_TIME_1_L`/`AC_TIME_1_R`. `_L` must be on the left in the direction of travel.
- **A-to-B timing objects:** `AC_AB_START_L/R`, `AC_AB_FINISH_L/R`, with
  `AC_TIME_0_L/R` as an optional single split.

---

## 3. Key design decisions

### 3.1 Looped circuit with a sector split — solves "his lap time, but repeatable"

Autocross is point-to-point; AC is lap-based. Running A-to-B means reloading the session
after every 78-second run, which defeats the purpose of practicing.

**Decision: generate a closed circuit**, appending a smooth return path from the course
finish back to the course start (they are only ~37 m apart in the sample data). Then:

- `AC_TIME_0_L/R` sits at the **real course start** — this is the lap line
- `AC_TIME_1_L/R` sits at the **real course finish**
- Therefore **AC's sector 1 time is exactly the autocross run time**, directly comparable
  to his real-world result, while the lap continues around the return path so he can
  reset and go again without leaving the session

His measured time is also written to `fast_lane.ai`'s `lapTime` field and into
`ui_track.json`, so the target is visible in-game and in Content Manager.

### 3.2 Cones are drive-through in v1

A static AC track object behaves like a concrete block — clipping a cone at 50 mph would
end the run and likely the car. That is worse than useless for practice.

**Decision: cones are non-physical decoration in v1** (naming them anything without the
`1`/`n` prefix achieves this automatically). Cone-hit detection comes in a later phase via
a CSP Lua script that compares car position against the known cone coordinates each frame
— we generate the cones, so we already have their exact positions. This gives real penalty
scoring without needing physics objects at all.

A perimeter `nWall` keeps the car from driving off into the void.

### 3.3 Flatten elevation in v1

Geometrically, elevation is easy — a heightfield instead of a plane. The problem is data
quality: GPS elevation in the sample drifts 236.4 → 238.7 m across a flat parking lot,
which is noise, not terrain. Baking that in creates fake bumps that affect physics and
would make the sim feel wrong in a way that's hard to diagnose.

**Decision: flat in v1.** A "use smoothed elevation" toggle can come later, once there's
real driving feedback to judge it against.

### 3.4 Electron desktop app, no backend, no hosting

Nothing in the pipeline requires a server: parsing, inference, geometry, and binary
encoding all run fine on `ArrayBuffer`/`DataView`, so the core stays a pure,
DOM-free TypeScript library that could equally run in a browser.

**Decision (confirmed by the user): ship it as an Electron desktop app for
Windows, not a hosted web app.** No hosting, single user, his dad's machine.

Electron over Tauri for one concrete reason: Node's `fs` in the main process
enables an **"Install to Assetto Corsa"** button that writes straight into
`content/tracks/`, removing the zip → Content Manager → import dance entirely.
For a non-technical user that is the difference between five steps and one.
Tauri's smaller binaries do not outweigh it, and cross-compiling Rust to Windows
from a Mac is avoidable pain.

Security posture: `contextIsolation` on, `nodeIntegration` off, and the renderer
reaches the filesystem only through a narrow named-channel preload bridge. Writes
are path-guarded to stay inside `content/tracks/`.

Packaging: electron-builder targeting Windows `zip`, which cross-compiles cleanly
from macOS. NSIS installers need Wine, so they are deliberately not the default.

---

## 4. Pipeline

```
CSV file(s)
   ↓  parse            10 Hz samples; tolerant of the exact column set
   ↓  split runs       on time gaps and sustained near-zero speed
   ↓  project          geodetic → local ENU tangent plane, anchored at course centroid
   ↓  resample         by arc length, normalized to s ∈ [0,1] per run
   ↓  fuse             average across runs → centerline; spread → confidence
   ↓  analyse          curvature; classify slalom / sweeper / hairpin / straight
   ↓  lay out cones    offset pairs, alternating slalom singles, gates, start/finish box
   ↓  build geometry   lot surface, perimeter wall, painted lines, cone instances
   ↓  encode           .kn5 + fast_lane.ai + surfaces.ini + ui_track.json + map.png
   ↓  package          .zip, drag-and-drop installable via Content Manager
```

**On course inference, honestly stated:** GPS records the line he *drove*, not where the
cones *were*. A single run can only ever produce a corridor fitted around his own line.
Multiple runs of the same course improve this materially — averaging suppresses noise, and
the *spread* between runs is itself signal (tight convergence implies a constraining gate;
wide divergence implies open pavement), which can modulate gate width. But this is
inference, not recovery. The in-app cone editor is therefore **core functionality, not a
nice-to-have** — it is how the user corrects what inference cannot know.

---

## 5. Track package layout

```
<track_id>/
  <track_id>.kn5           lot + cones + timing dummies, single file
  data/
    surfaces.ini           KEY=ROAD grip definition
    ai/fast_lane.ai        his driven line, v7
  ui/
    ui_track.json          name, description, length, his target time
    preview.png            3D preview render
    outline.png            course outline
  map.png                  minimap
  data/map.ini             minimap scaling
  extension/
    ext_config.ini         CSP hooks (phase 6)
```

---

## 6. Repository layout

```
packages/core/         pure TypeScript, no DOM — the whole pipeline
  src/csv/             parsing, run splitting
  src/geo/             projection
  src/course/          centerline fusion, curvature, feature detection, cone layout
  src/geometry/        mesh builders
  src/kn5/             binary encoder
  src/ai/              fast_lane.ai encoder
  src/package/         ini/json writers, zip assembly
apps/web/              React + three.js + Vite
tools/                 Python kn5 verifier (dev-only cross-implementation check)
fixtures/              run1-8.csv and trimmed test fixtures
```

---

## 7. Phases

| # | Phase | Owner | Gate |
|---|---|---|---|
| 0 | Repo scaffold, fixtures, test runner | Sonnet | `npm test` runs |
| 1 | CSV parse → run split → projection → centerline | **me** | tests on real fixture |
| 2 | kn5 encoder in TS | **me** | cross-verified against Python verifier |
| 3 | Cone inference + full package assembly | **me** | a real installable `.zip` |
| 4 | Desktop UI: load runs, 3D preview, export | Sonnet | dad can drive a track |
| 5 | Cone editor | Sonnet | drag cones, re-export |
| 6 | CSP Lua cone-hit penalties | **me** | penalty count in-sim |
| 7 | Parking lot themes | Sonnet | ≥3 themes |
| 8 | OSM / Maps lot picker | Sonnet | real lot outlines |

**Status:** phases 0-5 complete and confirmed in-game — the track installs,
loads, drives, and lap/sector timing works, with sector 1 equal to the real
autocross run. Phases 6-8 are not started. See `TESTING.md` for what real
driving confirmed and what it corrected.

Ideas raised by testing but not built: chalk outlines around each cone base
(the signature look of an autocross lot, and probably better guidance than
painted edge lines), the 2-second cone penalty, start/finish timing lights, a
finish chute, and a course-walk mode.

**Delegation rule:** binary encoders, coordinate transforms, and course inference stay
with me — these are areas where "looks plausible" and "is correct" diverge silently.
UI scaffolding, file I/O, ini/json writers, and test boilerplate go to Sonnet once
interfaces are pinned.

**Milestone that matters: end of phase 3** — a real track file, installable, drivable.
Everything before that is unverified until it runs in the actual game.

---

## 8. Testing

Not production-grade; enough for regression confidence while moving fast.

- **Unit:** projection round-trip, run splitter against the known-single-run fixture,
  curvature on synthetic circles/slaloms, cone spacing invariants
- **Golden-file:** kn5 byte output compared against a committed reference
- **Cross-implementation:** TS-generated kn5 parsed by the independent Python verifier,
  asserting exact-EOF consumption — catches field-order drift that a TS-only test cannot
- **Integration smoke:** `run1-8.csv` → full package; assert every required file exists,
  the kn5 parses, and the AI line point count matches the input
- **Human-in-the-loop:** the only test for "does it feel like autocross" is driving it.
  Checkpoints at phase 3 (does it load), 4 (does it drive), 5 (does editing help).

---

## 9. Known risks

| Risk | Mitigation |
|---|---|
| Track loads but car falls through the world | Surface naming is the usual cause; verified convention in §2.3, testable immediately at phase 3 |
| Inferred cones don't match the real course | Expected — the editor is the answer, not better inference |
| CM rejects the package | Compare against a known-good track folder; adjust metadata |
| `uint16` index overflow on large lots | Split surfaces into chunks under 65 k verts |
| GPS elevation noise | Flattened in v1 (§3.3) |

**Carried unknowns — confirm in-game at phase 3/4.** Everything else above was
verified by round-tripping real bytes; these two could not be:

1. **`AiPointExtra` field offsets.** Two community implementations disagree.
   actools (the library behind Content Manager) places `sideLeft`/`sideRight` at
   float indices 5/6; `leBluem/io_import_accsv` places them at 6/7 and omits the
   extras-count int entirely. We follow actools, because that addon's reader also
   skips 72 bytes where the format has a 4-byte field and reports the remainder as
   "unknown". Symptom if wrong: AI cars behave oddly or the drivable corridor is
   the wrong width. Harmless to the human driver either way.
2. **`map.ini` offset formula.** Our world→pixel transform is
   `(world + OFFSET) * SCALE_FACTOR + MARGIN` with `OFFSET = -min`. No ground
   truth was available. Symptom if wrong: the minimap is offset or mis-scaled.
   Purely cosmetic. Fix by comparing against a stock Kunos track's `map.ini`.

**Licensing note:** the kn5 format was learned by reading the GPL-3 licensed
`moppius/blender-assetto-corsa-tools` exporter. Our writer is independently structured and
file formats themselves are not copyrightable, but this was not a clean-room process. For
private/personal use this is moot; **if this is ever published publicly, decide
deliberately**: license the project GPL-3, or have the encoder rewritten from the format
spec in §2.1 by someone who has not read that source.

---

## 10. Open questions

1. Do the other 7 runs from that event exist? Multiple runs of one course are the single
   highest-value input for course inference.
2. Confirm the `run1-8` naming convention — verified as one continuous 78.5 s run, so the
   `1-8` is not a run range.
3. Does he have any course maps (event diagrams, photos) to validate inference against?
4. Maps picker: real lot *shape* (OSM, licensing-clean) or satellite *imagery* look
   (Google terms disallow baking tiles into redistributable game assets)?
