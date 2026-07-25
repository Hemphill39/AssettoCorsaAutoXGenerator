# Autocross Track Generator for Assetto Corsa

Turn real autocross GPS logs into drivable Assetto Corsa tracks.

An autocross course is set out with cones in a parking lot, run three or four
times in a morning, and then it's gone forever. You can't go back and take
another crack at the section you fluffed. This rebuilds the course from the
telemetry so you can run it as many times as you like.

Everything is generated programmatically — the track model, physics surfaces,
timing gates, racing line and metadata. There is no 3ds Max, ksEditor or Blender
step anywhere in the pipeline.

## What you get

- The course rebuilt from GPS, with cones laid out along it
- **Sector 1 timed exactly start line → finish line**, so it's directly
  comparable to the real-world run time
- A closed lap, so you can keep going without reloading the session
- The driver's own line exported as the AI racing line — turn on the ideal-line
  assist and you can see how the run was actually driven
- Drive-through cones, because a static object in AC behaves like a concrete
  block and clipping one at 50 mph would end the run

## Using the app

```bash
npm install
npm run dev
```

1. **Add runs** — drag in one or more `.csv` logs
2. **Preview and edit** — check the course from above, drag cones to match what
   was actually set out
3. **Export** — install straight into Assetto Corsa, or save a `.zip`

### Building for Windows

Cross-compiles from macOS or Linux — no Windows machine needed:

```bash
npm run pack:win
```

Produces `apps/desktop/release/AutocrossTrackBuilder-<version>-win-x64.zip`
(~106 MB). Unpack it anywhere and run `Autocross Track Builder.exe`; there is no
installer and no admin rights required.

The build is unsigned, so Windows SmartScreen warns on first launch —
*More info* → *Run anyway*.

### Command line

```bash
npx tsx tools/generate.ts fixtures/run1-8.csv -o out
```

Multiple runs of the same course produce a better result — see below.

## About accuracy

GPS records the line the driver **drove**, not where the cones **were**. From a
single run the generator can only fit a corridor around that one lap, so the
course fits their driving by construction.

Several runs of the same course improve this materially: averaging suppresses
GPS noise, and the spread between runs is itself informative — where laps
converge tightly there was probably a constraining gate; where they diverge
there was open pavement. But it remains inference. **The cone editor is core
functionality, not a nice-to-have** — it's how you correct what inference cannot
know.

## Guidance levels

Real autocross is walked before it's driven. In the sim you arrive at 50 mph
having never seen the layout, so there's a setting for how much help the course
gives you:

| Level | What you get |
|---|---|
| **Realistic** | Cones only, as the sport actually is |
| **Guided** *(default)* | Painted edge lines down both sides of the corridor |
| **Training** | As above, with cones packed tighter still |

Direction is marked with **pointer cones** — a cone laid on its side aiming the
way to go, with an upright cone beside it — at corners, at slalom entries, and
anywhere the course could be read two ways. That is how autocross actually marks
it. Pointers aim at where the course goes *next* rather than straight ahead,
since a cone aimed directly away from you is seen end-on and reads as nothing.

## Input format

10 Hz GPS CSV with latitude, longitude, speed and elevation columns. Column
headers are matched loosely, so unit annotations and naming differences between
firmware revisions are fine. Only latitude and longitude are strictly required.

Files containing a whole session are split into individual runs automatically, on
clock gaps and on sustained standstills.

## Status

Confirmed by driving the generated track in Assetto Corsa: it installs, loads and
drives; the car sits correctly on the surface; **lap and sector timing work**, so
sector 1 really is the autocross run; and slaloms read correctly from the car.

Still unverified: whether the reconstructed course matches the real event. Only
someone who was there can judge that — see the accuracy note above.

## Project layout

```
packages/core/   the whole pipeline — pure TypeScript, no dependencies
apps/desktop/    Electron app (React + three.js)
tools/           CLI generator and independent format validators
fixtures/        real telemetry used by the test suite
```

`PLAN.md` records the design decisions and the reverse-engineered `.kn5` and
`fast_lane.ai` format specifications. `TESTING.md` tracks what has been confirmed
in-game and what has not.

## Development

```bash
npm test        # 138 tests
npm run build
```

The `.kn5` writer was validated by round-tripping generated files through an
independent parser until they consumed to exactly EOF; the same discipline
applies to the PNG and ZIP writers, which are checked against Python's `zlib` and
`zipfile`. Those cross-implementation tests are the ones that matter — a decoder
sharing assumptions with its encoder cannot catch a shared misreading.

## Acknowledgements

The `.kn5` format was learned from the open-source Assetto Corsa modding
community, in particular the Blender exporter by Thomas Hagnhofer
([moppius/blender-assetto-corsa-tools](https://github.com/moppius/blender-assetto-corsa-tools),
GPL-3), with structure cross-checked against
[MarvinSt/kn5-obj-converter](https://github.com/MarvinSt/kn5-obj-converter). The
`fast_lane.ai` layout came from [gro-ove/actools](https://github.com/gro-ove/actools),
the library behind Content Manager.

Note on licensing: this project's encoder is independently written, and file
formats themselves are not copyrightable, but it was not a clean-room process.
If this is distributed more widely, that's worth a deliberate decision — either
licensing under GPL-3, or having the encoder rewritten from the format notes in
`PLAN.md` by someone who hasn't read that source.
