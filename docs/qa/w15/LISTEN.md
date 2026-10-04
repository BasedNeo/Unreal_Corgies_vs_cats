# LISTEN: the six cues, measured and logged (W15 Sprint B, lane A-HOOK)

**Nobody has listened to these cues.** No machine used so far has an audio device. This page holds numbers and
play logs only. It makes no claim that any cue sounds good. The human ear step at the end is **NOT DONE**.

Base: `9139c7a` plus the working tree, in a private copy. The patch round's web runs used HEAD `ace71ca`, which is
`9139c7a` plus a test-only commit. No cue file was changed.

## 1. The files

`node tools/audio/measure-cues.mjs` (new; Node only, no dependencies; `--json` for raw numbers). All six files are
16-bit PCM mono at 44.1 kHz in `public/assets/audio/`.

| Cue | File | Duration | Peak | RMS (file) | RMS (loudest 50 ms) | Attack | Audible (to -40 dB) | Centroid | Dominant |
|---|---|---|---|---|---|---|---|---|---|
| rifle_shot | `synth_rifle_shot.wav` | 240 ms | -3.0 dBFS | -21.6 dBFS | -14.9 dBFS | 5 ms | 108 ms | 1510 Hz | 97 Hz |
| hit_confirm | `synth_hit_confirm.wav` | 100 ms | -3.0 dBFS | -23.4 dBFS | -20.4 dBFS | 1 ms | 25 ms | 2036 Hz | 3149 Hz |
| slab_tick | `synth_slab_tick.wav` | 130 ms | -3.0 dBFS | -17.8 dBFS | -13.6 dBFS | 4 ms | 65 ms | 1132 Hz | 883 Hz |
| slab_tick_enemy | `synth_slab_tick_enemy.wav` | 130 ms | -3.0 dBFS | -19.4 dBFS | -15.2 dBFS | 6 ms | 60 ms | 620 Hz | 587 Hz |
| match_end_win | `synth_match_end_win.wav` | 1500 ms | -3.0 dBFS | -19.0 dBFS | -10.7 dBFS | 374 ms | 1142 ms | 5937 Hz | 698 Hz |
| match_end_lose | `synth_match_end_lose.wav` | 1300 ms | -3.0 dBFS | -19.2 dBFS | -10.8 dBFS | 18 ms | 851 ms | 265 Hz | 87 Hz |

How the columns are measured:
- **Centroid:** the magnitude-weighted mean frequency of the whole file (Hann window, 20 Hz to 20 kHz).
- **Dominant:** the largest FFT bin over the same range.
- **Attack:** from the first 1 ms RMS window within -20 dB of the loudest window, to that window.
- **Audible:** until the 1 ms envelope last sits above -40 dB of its loudest window.
- **Win sting:** its 374 ms "attack" is the snare pickup before the chord.

**Correction to the brief.** It quoted the W14 ticks with the two columns swapped. The own tick's **centroid** is
1132 Hz and its **dominant** is 883 Hz. The enemy tick's centroid is 620 Hz and its dominant 587 Hz. That is what
W14's table says too.

### Your tick and the enemy's

| | Own `slab_tick` | Enemy `slab_tick_enemy` | Gap | Guard |
|---|---|---|---|---|
| Centroid | 1132 Hz | 620 Hz | **512 Hz** | at least 150 Hz |
| Dominant | 883 Hz | 587 Hz | 296 Hz | (reported only) |
| File length | 130 ms | 130 ms | 0 ms | (reported only) |
| Audible length | 65 ms | 60 ms | 5 ms | at least 20 ms |

- The two ticks differ in **pitch**, not in length.
- `tests/unit/audio-cue-measure.test.ts` fails when the centroid gap is under 150 Hz **and** the audible-length gap
  is under 20 ms.
- **Mutation check:** with the own tick copied over the enemy's file (private copy only), the test failed:
  `centroid gap 0 Hz (min 150), length gap 0 ms (min 20): expected false to be true`.
- The test also checks the measures on synthetic tones (1 kHz and 500 Hz, centroid within 20 Hz) and the guard's
  edges (149 Hz and 19 ms: alike; 150 Hz or 20 ms: different).

### Playback gain

**Per-cue gain constants are equal; output balance differs by about 3 dB (Godot has no bus effects).**
- The constants are Godot `sfx.gd VOLUME_DB` and web `slab-cues.ts SLAB_CUE_DB`. A unit test keeps the two equal.
- Godot sends every cue to its default Master bus at 0 dB. The project has no bus layout and no effects.
- The web sends every cue through its engine's output chain (`src/client/audio/engine.ts`, lines 89-92):
  1. the bus: sfx 0.9² (-1.8 dB) for the shot, ui 0.99² (-0.2 dB) for the rest;
  2. the master 0.8² (-3.9 dB);
  3. a glue compressor: threshold -18 dB, ratio 3:1, knee 12 dB, attack 6 ms, release 200 ms;
  4. a limiter: threshold -3 dB, ratio 20:1, knee 0, attack 1 ms, release 80 ms.
- Web Audio's compressor adds its own makeup gain, so quiet cues come out louder than they go in.

| Cue | Gain constant | Godot output peak | Web peak before the compressors | Web output peak | Web makeup (peak / loudest 50 ms RMS) |
|---|---|---|---|---|---|
| rifle_shot (yours) | 0 dB | -3.3 dBFS (your muzzle is 4.1 m from the camera: -0.3 dB) | -8.7 dBFS | -3.8 dBFS | +4.9 / +5.1 dB |
| hit_confirm | -6 dB | -9.0 dBFS | -13.1 dBFS | -6.9 dBFS | +6.1 / +6.2 dB |
| slab_tick | -14 dB | -17.0 dBFS | -21.1 dBFS | -14.5 dBFS | +6.5 / +6.5 dB |
| slab_tick_enemy | -14 dB | -17.0 dBFS | -21.1 dBFS | -14.5 dBFS | +6.5 / +6.5 dB |
| match_end_win | -4 dB | -7.0 dBFS | -11.1 dBFS | -5.6 dBFS | +5.5 / +5.7 dB |
| match_end_lose | -4 dB | -7.0 dBFS | -11.1 dBFS | -5.5 dBFS | +5.5 / +5.8 dB |

- **Balance against your shot, Godot then web:** hit confirm -5.7 and -3.1 dB, ticks -13.7 and -10.7 dB, end
  stings -3.7 and -1.8 dB. The web plays the quieter cues 2 to 3 dB louder relative to the shot.
- **How the web column was measured.** Each file went through the same chain in an `OfflineAudioContext` in headless
  Chromium, at the default volumes (master 0.8, sfx 0.9), once with the two compressors and once without.
  - The chain first ran on 1 s of silence, so the compressors were settled; 3 s gave the same numbers within
    0.1 dB.
  - Through a freshly built chain, with no silence first, the four short cues came out 19 to 24 dB quieter than
    settled. The win sting was the same, and the lose sting 3.5 dB quieter. The first sound after the page unlocks
    audio may be quieter for that reason.
  - This reproduces the check's figures: the shot -8.7 to -3.8 dBFS, the ticks -21.1 to -14.5 dBFS.
- The Godot column is the file's peak (-3.0 dBFS) plus the gain constant. For your own shot it also includes the 3D
  distance law (`unit_size` 4 m, `max_db` +3 dB), measured headless as camera to muzzle 4.12 m, -0.26 dB. On the
  web your own shot plays centred (2D). Other pets' shots play 3D in both builds: full level to 4 m, then inverse
  distance, silent past 80 m.
- There is no music in either build.

## 2. Every cue plays when its event happens

In the logs below, each line is `SFX <cue> <seconds since start>`.

### Godot cue test: event counts equal play counts

`godot --headless --path engines/godot --script res://tests/run.gd -- --only sfx --sfx-log` passes (12 s).

The test records the game's own events (every rifle's `fired`, the human's `hit_confirmed`, `slab_point` and
`match_over`). Each cue's play count must equal its event count.

**With the human** (1 v 1):
- The human fires through the `fire` input until the Cat is down: every shot landed, the kill included.
- `SFX rifle_shot 1.828`, `SFX hit_confirm 1.828`, … `SFX hit_confirm 2.714` (8 hits; the Cat down), then
  `SFX slab_tick 2.832`, `SFX slab_tick_enemy 2.832`, then `SFX slab_tick 3.811` with `SFX match_end_win 3.811` (held
  from 59-0), then `SFX slab_tick_enemy 4.812` with `SFX match_end_lose 4.812` (the Cat held from 0-59).

| Cue | rifle_shot | hit_confirm | slab_tick | slab_tick_enemy | match_end_win | match_end_lose |
|---|---|---|---|---|---|---|
| Events | 9 | 8 | 2 | 2 | 1 | 1 |
| Plays | 9 | 8 | 2 | 2 | 1 | 1 |

**Bots only** (no human; your side is Corgi Company):
- 16 s of bot play beside the slab at 4x speed: shots by both bots (26 and 21), and 7 and 4 points ticked as they
  came.
- Then one forced point for each side, and the clock ends a win, a loss and a draw:
  `SFX match_end_win 10.186`, `SFX match_end_lose 10.255`, `SFX match_end_lose 10.434` (the draw).

| Cue | rifle_shot | hit_confirm | slab_tick | slab_tick_enemy | match_end_win | match_end_lose |
|---|---|---|---|---|---|---|
| Events (= plays) | 47 | 0 | 8 | 5 | 1 | 2 |

**Mutation check:** a `sfx.gd` that plays `slab_tick` for every point fails the test four times, for example
`human: slab_tick played 4 times for 2 events` and `bots only: slab_tick_enemy played 0 times for 5 events`.

### Godot real launches

| Run | What it shows | SFX counts |
|---|---|---|
| Windowed under Xvfb (`gl_compatibility`, `--resolution 960x540`), `-- --sfx-log --lineup 30`, driven by **real X mouse input** (`xdotool`: the cursor moved over the Cat bot, LMB held) | The player-fire path: the Cat went down on the 9th hit, then the Corgi bot held the slab alone. The game ran slowly under llvmpipe, and the run stopped at 240 s by PID. | rifle_shot 53 · hit_confirm 9 (`28.960` … `142.928`) · slab_tick 14 (`148.655` …) |
| Main scene headless, `--fixed-fps 60`, `-- --sfx-log --bots-only --demo` | A full bots-only match, 7 s real | rifle_shot 371 · slab_tick 60 · slab_tick_enemy 58 · **match_end_win** `5.826` |
| The same again | A full bots-only match | rifle_shot 364 · slab_tick 58 · slab_tick_enemy 60 · **match_end_lose** `6.443` |
| Main scene headless, `--fixed-fps 60`, `-- --sfx-log --demo`, the human idle | The Cat shoots and holds | rifle_shot 120 · slab_tick_enemy 60 · **match_end_lose** `4.088` |

- No game flag makes the human fire. The `fire` input in the test and the real mouse in the Xvfb run are the
  player-fire path.
- No run logged an `Sfx:` warning or an error.

### Web

**Unit tests.** `npx vitest run tests/unit/audio-slab-cues.test.ts tests/unit/audio-cue-measure.test.ts
tests/unit/audio-weapons.test.ts` passes 20 of 20. `tsc --noEmit` reports 0 errors; boundaries PASS.

Through `createAudio` with `?sfxlog`, the first case prints:

`SFX rifle_shot` · `SFX rifle_shot` · `SFX hit_confirm` · `SFX slab_tick` · `SFX slab_tick_enemy` · `SFX slab_tick` ·
`SFX match_end_win` · `SFX slab_tick_enemy` · `SFX match_end_lose`

The new cases:
- A Cat player hears the ticks flipped and wins with the Cats.
- With no local pet, as Godot's `--bots-only`, your side is Corgi Company. A bot's hit plays no confirm.
- A local pet missing from one frame's states keeps your side. Before W15 the web fell back to Corgi Company there;
  `index.ts` now keeps the last known team.

**Browser.** A private probe ran `?mode=slab&webgl&autoplay&sfxlog`. A stand-in gamepad (`navigator.getGamepads`,
RT and LT held) fires through the game's own pad path after one click. It logged:
- `SFX rifle_shot` ×312 (`[14.2s]` …);
- `SFX slab_tick_enemy` ×60;
- `SFX match_end_lose` at `[81.8s]`;
- no `silent` line.

The player never got near the Cat, so the browser logged no `hit_confirm`; the unit test covers it.

The browser's own and enemy ticks and both end stings are in `docs/qa/w15/sfx-log-web.txt`. Two runs on port 5187
of the patch-round tree, one click each, logged no `silent` line:
- `?mode=slab&webgl&autoplay&sfxlog&bots=3,1&cam=slab&slabWin=8`: `SFX rifle_shot` ×32, `SFX slab_tick` ×8 and
  `SFX match_end_win` at `[33.7s]`. The score was 8-0, CORGI COMPANY WINS.
- `?mode=slab&webgl&autoplay&sfxlog&cam=slab&slabWin=5`: `SFX slab_tick_enemy` ×5 and `SFX match_end_lose` at
  `[26.5s]`. The score was 0-5, CAT CADRE WINS.

## 3. Human ear step: NOT DONE

Status: **not done**. Nobody has heard these cues. To do it, on a machine with speakers:
1. Godot: `npm run godot -- -- --sfx-log --demo` (npm takes the first `--`; Godot's user args follow the second). Web: `npm run twin`, then add `&sfxlog&slabWin=5` and click once.
2. Fire (rifle_shot). Land a shot on the Cat (hit_confirm). Stand alone on the slab (slab_tick). Let the Cat stand on
   it alone (slab_tick_enemy). Win and lose a match (match_end_win, match_end_lose).
3. Note per cue and per build:
   - heard or not;
   - too loud, too quiet or fine against the shot;
   - clipping;
   - too long or cut short;
   - whether you can tell your tick from the enemy's without looking;
   - whether you can tell the hit confirm from your own shot at 10 shots per second;
   - whether win and lose read as what they are.
4. Log the result here with your name and the date. Until then this step stays NOT DONE.
