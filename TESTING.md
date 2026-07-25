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

Still unconfirmed: **sector 1 timing** (should be ≈ the real run time, 1:18.300)
and whether the inferred course shape matches the real event — the latter can
only be judged by someone who was there.

## Known-unverified details

Neither is fatal, both are cosmetic-to-minor — listed so they are not mistaken for bugs:

- **No minimap.** `map.png`/`map.ini` are deliberately not generated yet. CM can
  render a minimap itself. Not a load failure.
- **AI line field offsets.** Two community implementations disagree on
  `sideLeft`/`sideRight` positions. If AI cars drive strangely, that is the cause.
  Does not affect a human driver.

## What to report back

Screenshots help enormously, especially of anything that looks wrong. Most useful:

1. Did it load at all?
2. Does the car sit on the ground?
3. Photo/screenshot of the course from above (chase cam, or the track preview)
4. Anything that looks obviously broken
