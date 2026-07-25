# CLAUDE.md

Guidance for Claude Code when working in this repository.

## What this is

Turns real autocross GPS logs into drivable Assetto Corsa tracks. An autocross
course exists for one weekend and is never run again; this makes it repeatable.

The end user is a non-technical driver on Windows. Optimise for him: few
controls, obvious next step, plain language. No jargon like "kn5", "centreline
fusion", or "Menger curvature" in anything user-facing.

## Commands

```bash
npm test                  # vitest, whole suite (currently 138 tests)
npm run typecheck         # core only
npx tsc --noEmit -p apps/desktop/tsconfig.json   # desktop app

npm run dev               # run the Electron app
npm run build             # build renderer + main + preload
npm run pack:win          # Windows zip (cross-compiles from macOS)

npx tsx tools/generate.ts fixtures/run1-8.csv -o out   # CLI: CSV -> track zip
python3 tools/verify_kn5.py <file.kn5>                 # independent validators
python3 tools/verify_png.py <file.png>
```

## Layout

```
packages/core/     pure TypeScript, no DOM, no runtime dependencies
  csv/             parse 10 Hz GPS logs; split sessions into runs
  geo/             geodetic -> local tangent plane; AC <-> three.js
  course/          centreline fusion, curvature, slalom detection, cone layout,
                   corridor line, loop closure
  geometry/        mesh builders, PNG encoder, rasteriser, guidance paint
  kn5/             .kn5 model encoder + strict decoder (format v5)
  ai/              fast_lane.ai racing line encoder (format v7)
  package/         surfaces.ini, ui_track.json, map images, ZIP, orchestration
apps/desktop/      Electron: main / preload / renderer (React + three.js)
tools/             CLI generator, independent Python validators
fixtures/          run1-8.csv — real telemetry, the whole suite depends on it
```

`packages/core` must stay DOM-free and dependency-free. It runs in Node, in the
Electron renderer, and would run in a browser unchanged.

## Non-obvious things that will bite you

**Coordinate frame.** AC world space is **right-handed: X = east, Y = up,
Z = south**. Z is south, not north — a right-handed frame with X=east and Y=up
forces `Z = east × up = south`. Writing north as +Z makes a left-handed triple
and the engine renders a **mirror image**: every left turn becomes a right turn,
and it still looks like a perfectly plausible course. This bug shipped once
already. See `geo/project.ts`.

**Mesh naming drives physics.** Not a convention — the actual mechanism.
- `1ROAD…` (digit prefix + surface key) → drivable, keyed to `surfaces.ini`
- `nWall…` → collidable barrier
- anything else → non-physical decoration. This is how cones stay drive-through,
  and why hitting one must not end the run.

**Triangle winding decides whether the track works at all.** Backwards winding
means an invisible surface and a car that falls through the world. Use
`orientedTriangle()` in `geometry/builders.ts`; it derives the correct order from
a desired normal rather than guessing.

**One corridor line, shared.** `course/corridor.ts` defines where the edges of
the course are. Cone gates and painted edge lines must *both* be built from it.
They were not, once: gates used the driven line while the paint followed the
slalom cone axis, and around a slalom's entry and exit the cones sat metres from
the paint beside them. To a driver that reads as the paint being wrong. Gates are
also suppressed across the whole blended region (`isBlended`), not a fixed
distance.

Through a slalom the corridor follows the cone axis rather than the driven line,
because the driven line there is a wave while the cones sit in a straight row.

**Practice sessions spawn at `AC_PIT_0`, not `AC_START_0`.** Pit box 0 therefore
sits on the course entrance deliberately. Both earlier reports of "I start off to
one side" were this.

**Timing gates are deliberately much wider than the cone corridor.** A gate only
fires if the car crosses the segment between `_L` and `_R`; sized to the cones, a
driver running wide misses it and the lap never registers.

**`AC_TIME_n_L` must be on the true left of travel.** AC decides crossing
direction from the L/R ordering — reverse it and the gate never fires at all.
This is the most commonly cited cause of dead timing on custom tracks, and it is
exactly what the left-handed coordinate bug produced. There is a regression test.

**Pointer cones are distinguished by `forward`.** A `pointer` cone *with* a
`forward` is laid on its side aiming that way; one *without* renders upright as
its companion. Pointers aim at the corridor ~22 m ahead, not down the local
tangent: aimed at the tangent they point straight away from an approaching driver
and are seen end-on, which makes them near-invisible.

**Timing design.** `AC_TIME_0` at the course start, `AC_TIME_1` at the finish, so
**AC's sector 1 time is exactly the autocross run** and is directly comparable to
the real-world result. A return path closes the loop so runs repeat without
reloading. Don't "simplify" this away.

**uint16 index limit.** Meshes cap at 65536 vertices; large surfaces must be
chunked.

## Testing

Cross-implementation checks are the point, not decoration. The TypeScript decoder
shares assumptions with the encoder, so it cannot catch a shared misreading of a
binary format; the Python validators in `tools/` were written against independent
references and must consume files to *exactly* EOF. Keep them passing, and keep
them guarded on `python3` being present so the suite never hard-fails without it.

Prefer tests that encode *why* a thing must hold. Several here exist because a
real bug shipped: slalom cones must be collinear regardless of weave amplitude;
pole must be laterally centred on the course; guidance paint must never carry a
physics name prefix; gates must straddle the corridor line the paint follows;
`AC_TIME_n_L` must be on the left.

## Verification discipline

Much of this cannot be unit tested — whether AC accepts a file, whether a track
is fun to drive. Verify what can be verified, and say plainly what hasn't been.
`TESTING.md` tracks confirmed-in-game versus still-unknown; keep it current.
Never describe an unverified detail as if it were confirmed.

When a binary format is ambiguous and sources disagree, prefer the mature
implementation, write down why in a comment, and flag it for in-game
confirmation rather than quietly picking one.

## Packaging

`npm run pack:win` cross-compiles a Windows zip from macOS. Two things it needs
and will not tell you clearly: `electronVersion` must be pinned in the build
config, because npm workspaces hoists `electron` to the repo root where
electron-builder does not look; and the config is schema-validated, so `"//"`
comment keys are rejected outright. The output is unsigned, so Windows SmartScreen
warns on first launch.

## Style

Comments explain *why*, not *what*, and are sparse. Strict TypeScript with
`noUncheckedIndexedAccess` on — indexing yields `T | undefined`. ESM: relative
imports end in `.js`. No new runtime dependencies without a strong reason.
