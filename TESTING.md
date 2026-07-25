# In-game verification

Automated tests cover file structure, byte layout, and geometry math. They cannot
answer "does Assetto Corsa accept this and is it fun to drive." That needs a human.

Generate a track:

```bash
npx tsx tools/generate.ts fixtures/run1-8.csv -o out
```

## Install

1. Open **Content Manager**
2. Drag the `.zip` onto the CM window — it should offer to install a track
   - Manual alternative: extract the zip into
     `…/steamapps/common/assettocorsa/content/tracks/` so you end up with
     `content/tracks/xcross_run1_8/xcross_run1_8.kn5`
3. Pick the track in **Drive → Practice**, choose your autocross car, go

## Checklist — in order, because each failure explains the next

| # | Check | If it fails |
|---|---|---|
| 1 | Track appears in Content Manager's track list | `ui/ui_track.json` malformed or folder layout wrong |
| 2 | Session loads without an error dialog | Note the exact error text — usually a missing required file |
| 3 | Car sits on the asphalt instead of falling through | Surface naming (`1ROAD_lot` + `KEY=ROAD`) or triangle winding |
| 4 | Ground is visible, not invisible or see-through from above | **Triangle winding is inverted** — flip the comparison in `orientedTriangle()` in `geometry/builders.ts`; it is a one-line change |
| 5 | Orange cones visible, roughly at driver eye scale | Cone geometry scale in `buildCone()` |
| 6 | Driving through a cone does nothing (no collision) | A cone mesh accidentally got a `1`/`n` name prefix |
| 7 | Perimeter wall stops you leaving the lot | `nWall_perimeter` naming |
| 8 | Lap timer runs; crossing the finish records a **sector 1** split | Timing gate placement or `AC_TIME_*_L`/`_R` left-right ordering |
| 9 | Sector 1 time is in the same ballpark as 1:18.300 | Expected — it is his real run time |
| 10 | Course shape resembles the real event | Inference quality; this is what the cone editor is for |

## Confirmed working in-game (2026-07-25, first real test)

Verified by driving the generated track in Assetto Corsa:

- Track installs and appears in Content Manager
- Session loads and is drivable
- **Car sits correctly on the asphalt** — surface naming (`1ROAD_lot` + `KEY=ROAD`)
  and `surfaces.ini` are right
- **Ground renders correctly from above** — triangle winding derived in
  `orientedTriangle()` is correct, and needs no flip

Found and fixed from that session:

| Reported | Cause | Fix |
|---|---|---|
| "map / outline / preview missing" | Those PNGs were never generated | `package/images.ts` renders all three |
| "tag: circuit is missing" | CM reads `tags` to decide supported race modes | `tags` now includes `circuit` |
| Couldn't add AI opponents | Only one `AC_PIT_0`/`AC_START_0` and `pitboxes: 1`, so AC capped the field at one car | 12-slot staggered grid |
| Hard to tell where the course goes | 22 m cone spacing with no continuous edge to follow | Painted edge lines, cones 116 → 172, `guidance` presets |

Later sessions additionally confirmed:

- **Lap and sector timing work.** Crossing the start line opens the lap, the
  finish line closes sector 1, and the return path brings you round to go again
  without reloading. This was the central design claim.
- Slaloms read correctly from the car once their cones were laid in a line and
  the painted corridor ran straight through them.
- The Windows package builds from macOS and runs.

Found and fixed from those sessions:

| Reported | Cause | Fix |
|---|---|---|
| Cone editor let you add but never move a cone | Markers are ~1 px at usable zoom; selection needed a ray/mesh hit | Screen-space picking within 18 px, markers scale with zoom |
| Slalom cones looked wrong | Each was offset from the driven apex by a fixed 2.5 m, so a wider weave produced a zigzag instead of a row | Cones placed on the weave's centre axis via a [1,2,1]/4 filter over apexes |
| Timing dead; started off to one side | Left-handed coordinate frame mirrored the world, which also swapped `AC_TIME_n_L`/`_R` so gates never fired | Corrected to AC's right-handed frame (Z = south) |
| Still started off to one side | Practice spawns at `AC_PIT_0`, not `AC_START_0` | Pit box 0 placed on the course entrance |
| White lines wrong near a slalom's ends | Gates built from the driven line, paint from the cone axis | One shared corridor line for both |
| Pointer cones invisible | Aimed down the tangent, so seen end-on | Aimed ~22 m ahead, plus an upright companion cone |

**Still unverified:** whether the reconstructed course shape matches the real
event. Only someone who was at the event can judge that, and the question became
meaningful only after the mirroring bug was fixed — before that every turn was
reversed.

## Known-unverified details

Neither is fatal, both are cosmetic-to-minor — listed so they are not mistaken for bugs:

- **`map.ini` offsets.** The minimap image and `map.ini` are generated from one
  shared transform, so they agree with each other, but AC's own world→pixel
  formula was never confirmed against a stock Kunos track. If the car's dot sits
  offset on the minimap, that is why. Purely cosmetic.
- **AI line field offsets.** Two community implementations disagree on
  `sideLeft`/`sideRight` positions. If AI cars drive strangely, that is the cause.
  Does not affect a human driver.

## What to report back

Screenshots help enormously, especially of anything that looks wrong. Most useful:

1. Did it load at all?
2. Does the car sit on the ground?
3. Photo/screenshot of the course from above (chase cam, or the track preview)
4. Anything that looks obviously broken
