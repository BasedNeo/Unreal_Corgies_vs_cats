# W13 verification (V-PLAY, independent): a64ce51

Clean `git archive a64ce51`, no product file edited. Godot 4.7.2 on Xvfb 640x360, with xdotool and ImageMagick,
Compatibility, `--look-quality low`. Shared machine (load 10–24, 1–5 FPS): no frame-time claims.
`L` = `GODOT=$G npm run godot -- --rendering-method gl_compatibility --rendering-driver opengl3 --resolution 640x360 -- --look-quality low`.

| # | Check | Verdict | Command | Output | Evidence |
|---|---|---|---|---|---|
| 1 | Launch | **PASS** | `L` | `WORLD The Lot … kit 6/6 loaded`; only audio-device and V-Sync noise | `play-launch.jpg` |
| 2 | Headless | **PASS** | `--import`, then `--script res://tests/run.gd` | 15 × PASS, `GODOT TESTS: PASS` | `play-headless-tests.jpg` |
| 3 | On the slab, real input | **PASS, aided** | `L` + `--fixed-fps 60`, `--demo` | `SLAB CORGI COMPANY HOLDING +1/s`; Corgi 0 → 1 at 2:59 | `play-slab-score.jpg`, `play-slab-hud-f015-f016.jpg`, `play-slab-attempt-normal.jpg` |
| 4 | Pit exit, no jump | **PASS** | `L`, W held only | Up the ramp in the sandbag gap (2:42 → 2:39); slab edge at 2:11 | `play-walk.jpg` |
| 5 | Sound | **PASS** logged; hearing **NOT SHOWN** | `L` + `--sfx-log`, LMB held | 22 `SFX rifle_shot` (ammo 30 → 10), 9 `slab_tick_enemy`. `sfx-log-godot.txt` has all six cues; four of them only from its headless test. No sound device. | `play-sfx-fire.jpg`, `play-sfx-log.jpg` |
| 6a | Web probes | **FAIL at 12 s** (load); **PASS at 90 s** | `node tools/probe.mjs '?mode=slab&webgl&autoplay' 12` (and `&2v2`), port 5291 | 12 s: 2 frames, kits 0, screenshot timeout. 90 s: kits 6, `errors []`. The Lot, plain HUD, no ink, no comic words; slab frame via `&cam=slab`. | `web-twin-final-1v1.jpg`, `-2v2.jpg`, `-slabcam.jpg` |
| 6b | e2e SLAB | **PASS** | `npx playwright test tests/e2e/modes.spec.ts -g SLAB` | `2 passed` | `web-twin-final-e2e.jpg` |

## Check 3
It took 9 launches; I was downed 53 times before the first Corgi point.
- **Launches 1–8, normal pacing:** the HUD showed CORGI HOLDING often (`play-slab-attempt-normal.jpg`, HP 120 → 21
  within 3:00–2:59), but never for 1 s alone. The Cat downed me, or it stepped onto a slab corner (CONTESTED),
  which resets the count. Below 7.5 FPS a frame is 0.13 s of game time, too coarse to aim.
- **Launch 9, with two aids:** `--fixed-fps 60` gives 1/60 s of game time per frame (slow motion, same rules), and a
  script read each screenshot and sent real X input through xdotool (W, then right-button aim and left-button
  fire). In f000–f016 I stand alone on the blue slab while the Cat waits off the edge, and the score goes 0 → 1.
- **Not shown:** a person at normal speed. Remaining step: on a real GPU, run `npm run godot -- -- --demo`, stand
  in the middle of the slab and hold it for 1 s. Expect Corgi 0 → 1.

## What a stranger hits in the first minute
1. On software GL, a 20 s splash.
2. Walking without Shift, you find the Cat on the slab at 2:44 and ahead 14–0 by 2:30.
3. The pit exit is the ramp straight ahead; no jump is needed.
4. At the slab you are downed in 1–2 s and respawn 140 m back.
5. The Cat circles you at 7 m and clips the slab corners; only the middle of the slab holds.
6. The game is silent without an audio device; the cues are placeholders.
7. Web: a debug line (`fps · webgl · rtt`) shows for everyone; after the win the slab line still says HOLDING.
8. In web 2v2 with an idle human, the Cats win 60–0 at about 79 s.
