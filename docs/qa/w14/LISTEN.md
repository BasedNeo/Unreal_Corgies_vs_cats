# LISTEN: the six SYNTH cues (W14 EAR, lane A-HOOK)

**Nobody has listened to these files.** No machine used so far has an audio device. Every number below is
measured from the files or read from a log. Nothing on this page claims the cues sound good. That is for the human
listener (last section).

## The files, measured

All six are 16-bit PCM mono at 44.1 kHz.

| File (`public/assets/audio/`) | Duration | Peak | RMS, whole file | RMS, loudest 50 ms | Attack | Peak sample at | Envelope to -40 dB | Dominant | Centroid |
|---|---|---|---|---|---|---|---|---|---|
| `synth_rifle_shot.wav` | 240 ms | -3.0 dBFS | -21.6 dBFS | -14.9 dBFS | 5 ms | 1.2 ms | 108 ms | 97 Hz | 1510 Hz |
| `synth_hit_confirm.wav` | 100 ms | -3.0 dBFS | -23.4 dBFS | -20.4 dBFS | 1 ms | 1.5 ms | 25 ms | 3149 Hz | 2036 Hz |
| `synth_slab_tick.wav` | 130 ms | -3.0 dBFS | -17.8 dBFS | -13.6 dBFS | 4 ms | 4.5 ms | 65 ms | 883 Hz | 1132 Hz |
| `synth_slab_tick_enemy.wav` | 130 ms | -3.0 dBFS | -19.4 dBFS | -15.2 dBFS | 6 ms | 7.3 ms | 60 ms | 587 Hz | 620 Hz |
| `synth_match_end_win.wav` | 1500 ms | -3.0 dBFS | -19.0 dBFS | -10.7 dBFS | 375 ms | 419.8 ms | 1145 ms | 698 Hz | 5937 Hz |
| `synth_match_end_lose.wav` | 1300 ms | -3.0 dBFS | -19.2 dBFS | -10.8 dBFS | 18 ms | 18.2 ms | 853 ms | 87 Hz | 265 Hz |

**How each column is measured.**
- **Attack:** from the first 1 ms RMS window within -20 dB of the loudest window, to that loudest window.
- **Envelope to -40 dB:** the last 1 ms window above -40 dB of that loudest window.
- **Dominant:** the largest FFT bin (Hann window, 20 Hz to 20 kHz).
- **Centroid:** the magnitude-weighted mean frequency over the same range.
- The win sting's 375 ms "attack" is its snare pickup before the chord. Its high centroid comes from the snare and
  crash noise.

**Command.** `node <scratch>/a-hook14/listen-stats.mjs public/assets/audio`. It is a Node script with no
dependencies and is not checked in; the lead can ask for it to be added under `tools/audio/`.

## Playback gain in each build

The gain is the same per cue in both builds. A unit test parses both files to keep them equal.

| Cue | Godot `sfx.gd VOLUME_DB` | Web `slab-cues.ts SLAB_CUE_DB` (linear) | Godot level after gain: peak / loudest 50 ms | Web level after gain, bus and master: peak / loudest 50 ms |
|---|---|---|---|---|
| rifle_shot | 0 dB | 0 dB (1.000) | -3.0 / -14.9 dBFS | -8.7 / -20.6 dBFS |
| hit_confirm | -6 dB | -6 dB (0.501) | -9.0 / -26.4 | -13.1 / -30.5 |
| slab_tick | -14 dB | -14 dB (0.200) | -17.0 / -27.6 | -21.1 / -31.7 |
| slab_tick_enemy | -14 dB | -14 dB (0.200) | -17.0 / -29.2 | -21.1 / -33.3 |
| match_end_win | -4 dB | -4 dB (0.631) | -7.0 / -14.7 | -11.1 / -18.8 |
| match_end_lose | -4 dB | -4 dB (0.631) | -7.0 / -14.8 | -11.1 / -18.9 |

- **Godot:** the Master bus is at 0 dB.
- **Godot shots** play in 3D at the muzzle: full level within 4 m (your own shot is about 3.3 m from the camera), then
  inverse distance, and silent past 80 m.
- **Web:** the default master is 0.8² (-3.9 dB). The shot goes through the sfx bus at 0.9² (-1.8 dB); the other
  cues go through the ui bus (-0.2 dB). After that come the engine's glue compressor (-18 dB, 3:1) and its limiter
  (-3 dB).
- **Web shots** use a panner at reference 4 m, culled past 80 m.
- **Web slab mode** also plays the web's own footsteps, ambience, hit thwack and death sounds. It plays no music.

## `--sfx-log` evidence on the current tree

Every run used a private copy: HEAD `3b9b956` plus the working tree.

**Godot cue test**, `godot --headless --path engines/godot --script res://tests/run.gd -- --only sfx --sfx-log`.
All six cues play; the result was `PASS test_game_sfx.gd`, `GODOT TESTS: PASS`.
```
SFX rifle_shot 2.453 · SFX rifle_shot 2.454 · SFX hit_confirm 2.454 · SFX rifle_shot 2.454 · SFX slab_tick 2.454
SFX slab_tick_enemy 2.454 · SFX slab_tick 3.427 · SFX match_end_win 3.427 · SFX match_end_lose 3.448
```

**Godot real launch**, `xvfb-run … --rendering-method gl_compatibility --audio-driver Dummy -- --sfx-log --demo`.
- In the first 60 s: 15 × `rifle_shot` (the Cat bot's; the human does not fire in `--demo`) and 2 × `slab_tick_enemy`
  (36.625, 48.193). There was no warning and no error.
- My stop at 60 s hit the `xvfb-run` wrapper instead of Godot. Godot then ran for about 8.5 min, to 50 shots and 24
  Cat points, until I killed it and its Xvfb by PID.

**Web unit test**, `npx vitest run tests/unit/audio-slab-cues.test.ts`: 10 passed. Its `?sfxlog` case drives
`createAudio` on a fake AudioContext and gets exactly these lines:
`SFX rifle_shot`, `SFX rifle_shot`, `SFX hit_confirm`, `SFX slab_tick`, `SFX slab_tick_enemy`, `SFX slab_tick`,
`SFX match_end_win`, `SFX slab_tick_enemy`, `SFX match_end_lose`.

**Web browser**, headless Chromium on a private vite server. One click unlocks Web Audio. Every line was a real play;
none was `silent`.
- `?mode=slab&…&sfxlog&2v2&cam=slab&slabWin=10`: `SFX rifle_shot` ×26, `SFX slab_tick_enemy` ×10, then
  `SFX match_end_lose`.
- `?mode=slab&…&sfxlog&bots=3,1&cam=slab&slabWin=8`: `SFX rifle_shot` ×26, `SFX slab_tick` ×8, then
  `SFX match_end_win`.
- `hit_confirm` needs your own shots to land, which needs pointer lock. Headless Chromium did not get it, so the
  unit test above covers that cue.

## For the human listener

**Start.**
- Godot: `npm run godot` (or `godot --path engines/godot`). Add `-- --demo` to start beside the slab, and
  `-- --sfx-log` to print `SFX <cue> <seconds>` on each play.
- Web: `npm run twin`, then add `&sfxlog` (the console prints `SFX <cue>`) and `&slabWin=5` (a short match). Click once
  so the browser lets audio start.

| Cue | How to hear it |
|---|---|
| rifle_shot | Hold LMB (or RT). The Cat bot's shots are the same cue, in 3D at its gun. |
| hit_confirm | Land a shot on the Cat bot. The crosshair hit marker shows at the same moment. |
| slab_tick | Stand alone on the slab: one tick per second. |
| slab_tick_enemy | Let the Cat bot stand alone on the slab. |
| match_end_win | Hold the slab to 60. Web: `&slabWin=5`. |
| match_end_lose | Let the Cat bot reach 60. Web: `&slabWin=3` and stay off the slab. A draw also plays the lose sting. |

**Report back, per cue and per build.**
- [ ] Did you hear it at all?
- [ ] Too loud, too quiet or fine, against the shot.
- [ ] Clipping or harshness.
- [ ] Too long, or cut short.
- [ ] Can you tell **your tick from the enemy's** without looking? This is the key confusable pair.
- [ ] Can you tell the **hit confirm from your own shot** during full-auto fire (10 shots per second)?
- [ ] Do **win and lose** read as what they are?
- [ ] Does the tick get tiring after 60 s of one per second?
- [ ] Do the last tick and the end sting clash?
- [ ] Do enemy shots fade with distance and come from the right side?
- [ ] Do Godot and the web sound the same?

**Where to change levels.** Change both `engines/godot/game/sfx.gd VOLUME_DB` and
`src/client/audio/slab-cues.ts SLAB_CUE_DB`; the unit test fails if they differ. Leave the WAVs alone: they are
A-CUES's and are regenerated by `tools/audio/synth-cues.mjs`.
