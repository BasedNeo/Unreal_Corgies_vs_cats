# G-MOVE handoff: step-up, the slab path, --demo, --lineup (Wave 13)

**Status: done for integration; nothing staged or committed.** A pet holding only W (or W + Shift) from either
team's match-start spawn reaches the slab with no jump. Movement uses the web KCC's numbers: a 0.45 m step and a
52 deg climb limit. The Corgi route gets there by a new ramp and trench notches in the shared map data (the slab
path), not by walkable cliffs. `--demo` keeps the human beside the slab, and `--lineup <m>` sets up the 30 m READ
shot.

## 1. Files
| Path | What |
|---|---|
| `engines/godot/game/pet.gd` | Movement for every pet (player and bots share `move_pet`). Step-up `STEP_HEIGHT` 0.45 m, `floor_max_angle` 52 deg (was 46), `wall_min_slide_angle` 0 (Godot's default was 15 deg). A step eases the model up over about 0.1 s (`step_offset`). |
| `engines/godot/game/player.gd` | One line: the camera pivot follows `step_offset`. |
| `engines/godot/game/match.gd` | `--demo` respawns beside the slab for the whole first match, and the human starts 2 m off the slab's edge. New `--lineup <m>` (`opts.lineup`). |
| `src/shared/world/lot/layout.ts` | New `SLAB_PATH`. |
| `src/shared/world/lot/terrain.ts` | Inside `SLAB_PATH`'s band, the pit and trench carves slope at 1:2 instead of 2.2:1. |
| `engines/godot/data/the_lot.json`, `the_lot_heights.bin` | Regenerated with `npx tsx tools/godot/export-lot.mjs` (the script itself is unchanged). |
| `engines/godot/tests/test_game_stepup.gd`, `test_game_demo.gd` | New tests (§3). |
| `docs/qa/w13/lineup30.jpg` | The `--lineup 30` shot. |

## 2. What blocked the straight route, and the fix
Measured at HEAD 71d05d5. I walked pets straight at the slab with no jump and no steering, from all 32 spawns, and
profiled the exported heightfield and colliders along the same lines.

- **Corgi side.** The "berm" is the foundation pit's south wall: 2.1-2.2 m at 65.6 deg (`WALL_STEEP` 2.2:1).
  Behind it, trench T1 (crossed at about (-53, -88.5)) and trench T3 (about (-48, -80)) are 2 m deep with the same
  walls. At HEAD, Godot's 46 deg floor slid the pet along the pit wall into T1, where it stuck against a wall at
  (-51.2, -1.92, -88.1) from 5.8 s on. That is Q6's "stalled for about 8 s". The web KCC (52 deg) is stopped by the
  same walls.
- **Cat side.** The heap's north face is only a drop. But the pallet stack at (10, 18) is met 13.8 deg off its face
  normal, and Godot's grounded `wall_min_slide_angle` (15 deg) zeroed the pet's speed: v = 0 from the first contact.
  At 52 deg with any-angle wall slide, the Cat route has no stall (§3).

**The slab path** (`SLAB_PATH`, x0 -74, z0 -123 to x1 0, z1 0, half 3.5, s 26..64, slope 0.5). It is a 7 m band
along the straight line from Corgi spawn 0 to the slab, between 26 m and 64 m along that line. Inside the band, the
pit's and the trenches' wall carves slope at 1:2 (26.6 deg), and the band's own sides are steep like the existing
pit ramps. That gives:
- a ramp out of the pit's south wall, inside the bag line's gap (x -68 to -47). It is about 3.5 m from the nearest
  bag wall, so the cover is intact. No prop or collider lies in the band;
- notches down into and up out of T1 and T3. The trenches stay continuous: a pet can still walk along them;
- on the 1 m grid, the slope along the band is at most 26.6 deg within 1.5 m of the centre line, at most 28.3 deg
  4 m wide, and at most 44 deg 5 m wide (walkable at 52 deg);
- the centre line from the pit floor to the open ground: -2.40 → -1.26 (between the pit ramp and T1) → -2.00 (T1)
  → -1.21 → -2.00 (T3) → -0.14 at 58 m. It is a sunken cut, not a bridge.

Only Corgi spawn 0's line is guaranteed straight. The other 15 Corgi spawns still meet walls on their own straight
lines, as before: a player steers.

## 3. Proof
Godot 4.7.2 headless, in a private copy: `git archive HEAD` plus my files and the regenerated data. The web checks
ran in a second copy with `node_modules` linked.

**`test_game_stepup.gd`, 52 deg, new data:** PASS.
```
Corgi from the Corgi spawn, run (143.5 m, 6.4 m/s): slab in 25.27 s (budget 29.16 s), longest stall 0.00 s
Cat from the Corgi spawn, run (143.5 m, 6.6 m/s): slab in 24.52 s (budget 28.27 s), longest stall 0.00 s
Corgi from the Cat spawn, run (119.0 m, 6.4 m/s): slab in 19.92 s (budget 24.17 s), longest stall 0.00 s
Cat from the Cat spawn, run (119.0 m, 6.6 m/s): slab in 19.30 s (budget 23.44 s), longest stall 0.00 s
Corgi from the Corgi spawn, sprint (143.5 m, 9.6 m/s): slab in 16.92 s (budget 19.44 s), longest stall 0.00 s
Cat from the Corgi spawn, sprint (143.5 m, 8.8 m/s): slab in 18.43 s (budget 21.21 s), longest stall 0.00 s
Corgi from the Cat spawn, sprint (119.0 m, 9.6 m/s): slab in 13.35 s (budget 16.11 s), longest stall 0.00 s
Cat from the Cat spawn, sprint (119.0 m, 8.8 m/s): slab in 14.52 s (budget 17.58 s), longest stall 0.00 s
0.40 m block: Corgi and Cat on top (feet 0.40 m, 1 step each); 0.55 m block: both stopped in front (feet 0.00 m)
```
**Budget** = the straight-line time at the gait's speed + 30 %. The measured overhead is 12-17 %, mostly 2-3 s of
sliding along the pallet stack. A stall (under 1 m/s for 0.5 s or more) also fails the test.

**The test bites:**
- **52 deg pet.gd, old (W12) data:** all 4 Corgi-spawn routes fail. Run: "did not reach the slab in 30.2 s; ended
  at (-51.2, -1.92, -88.1), longest stall 22.1 s" (in T1). Two others slide off the line and miss the slab, and one
  stalls 4.3 s at (-7.2, -1.71, -52.9). The Cat-spawn routes pass.
- **HEAD pet.gd (46 deg, no step-up, 15 deg wall stop), new data:** all 8 routes fail. The Corgi runners now cross
  the pit and the trenches but stall 8-12 s at the pallet stack (-11.9, -19.8); the Cat runners stall 11-16 s at
  (10.8, 20.2). Both 0.40 m kerbs fail too.
- An earlier version of the step-up measured the step by where the capsule ended up, and climbed the 0.55 m block.
  It now measures the contact point.

**`test_game_demo.gd`:** PASS. The human starts 1.7 m off the slab's edge and comes back 1.7 m off it after a
takedown. In `--lineup 30` the human stands at (-8.3, -0.03, -28.8), 30.00 m from the slab centre; the bots are on
the slab, did not move or fire in 2 s, and face the human. At HEAD the test reports "starts 6.2 m off the edge",
"came back 137.9 m off", and that the lineup match did not start.
**Why `--demo` showed the normal spawn (Q6 P2-5):** the human was placed 11 m out, but the Cat bot downed them 2-3 s
in (seen in a windowed run: "TAKEN DOWN · back in 0.8" at 2:55). The respawn then used `best_spawn`, 120-140 m away.

**Full Godot suite**, 52 deg and new data: 12/12 PASS in 1 min 17 s. Soak: `60.0 s game · score 10-25 · 6 takedowns
· 210 shots` (it was 6-26 on the W12 terrain).

**Web**
- `npx tsx tools/godot/export-lot.mjs --check` in the working tree: "LOT EXPORT: up to date". The committed data
  equals a fresh export, including other lanes' current edits.
- `godot-lot-data.test.ts`, `lot-world.test.ts`, `maps.test.ts` (HEAD version): 28/28 pass. No pinned value needed a
  change.
- Web nav (`navGridFor` + `findPath`, a private probe): both bases still reach the slab. Corgi spawn 0: 166.5 m →
  148.5 m. Corgi spawn 15: 141.1 m → 123.4 m. Corgi flag: 127.3 m, unchanged. Cat spawns and flag: unchanged
  (128.1 m, 147.3 m, 148.0 m). The main region grew by 8 cells, and 39/39 of the slab path's centre-line cells are
  walkable.
- The other Lot-touching web tests: §5.

## 4. Commands
```
npx tsx tools/godot/export-lot.mjs            # after any change to src/shared/world/lot/*
G=<Godot 4.7.2>
$G --headless --path engines/godot --script res://tests/run.gd -- --only stepup
$G --headless --path engines/godot --script res://tests/run.gd -- --only game_demo
xvfb-run -a -s "-screen 0 1280x720x24" $G --path engines/godot --rendering-method gl_compatibility \
  --rendering-driver opengl3 --audio-driver Dummy -- --lineup 30 --shot <png> --frames 240
```

## 5. Lot web test sweep
Each file ran alone (`npx vitest run tests/unit/<f>.test.ts`) in the private copy: HEAD plus `lot/layout.ts`,
`lot/terrain.ts` and the regenerated data. **All 25 pass, and no pinned value changed.**
lot-world 16, godot-lot-data 3, maps 9 (HEAD's version), lot-nav 7, lot-lanes 6, lot-sim 9, lot-tdm 1,
lot-pickups 4, adventure-lot 10, adventure-lot-bots 2, adventure-lot-human 7, f3-ba-nav 3, ai-nav-thin 9,
ai-nav-links 12, ai-base-assault-lanes 2, ai-base-assault 13 (+3 skipped, as at HEAD), base-assault 18,
adventure-chapters 8, adventure-a2-chapters 4, lot-atmosphere 9, glb-lot-batch1 28, glb-bagwall-colliders 9,
f3-site-peaks 10, contracts-w9 3, contracts-w10 4.

## 6. --lineup and the shot
`--lineup M` sets 1 human, 1 Corgi bot and 1 Cat bot. The bots have `think = false`: they stand still and never
fire. They stand on the slab 1.8 m apart, across the line of sight, facing the human. The human stands M m from the
slab centre. The bearing is searched in 15 deg steps outwards from the Corgi side, and the first one that passes all
of these is used:
- the ground is level and within 1 m of the slab's height;
- nothing is within 1 m above knee height;
- the camera boom has room;
- the camera has clear rays to both bots' feet and heads.

The play camera aims 1.5 m over the bots' chests (`LINEUP_AIM_LIFT`). The HUD is the normal one; the slab reads
CONTESTED. `--lineup-side` turns both bots side on (profile), with centres 2.8 m apart (about a body length
between them).

`docs/qa/w13/lineup30.jpg` and `lineup30-side.jpg` (1280x720, frame 240, llvmpipe, about 15 min each under load) shows the HUD (0-0, 2:29, SLAB
CONTESTED, HP 120, 30/30), the human Corgi in the foreground, and the two bots 30 m away, with nothing in between. With the 1.5 m lift, the crosshair sits about 25 px above
them. The bots end up just under the centre of the frame, not in its lower third (that would take a lift of about
7 m at 30 m). The SLAB marker is fixed at the slab centre + 1.5 m (`hud.gd`), so it falls in the gap between the
bots. It was shot before the slab path existed. The path lies behind the human's back, more than 40 m
away, so the frame is unchanged.

## 7. Open
- `bot.gd` (lane G-BOT) still jumps when the next nav corner is 0.3 m up. With the step-up it can raise that to
  0.45 m.
- `maps.test.ts` has TW-SIM's uncommitted edits, so I ran HEAD's version and edited neither file.
