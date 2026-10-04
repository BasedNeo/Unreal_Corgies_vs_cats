# LISTEN: the six cues, measured and logged (W15 Sprints B, C and D, lane A-HOOK)

**Nobody has listened to these cues.** No machine used so far has an audio device. This page holds numbers and
play logs only. It makes no claim that any cue sounds good. The human ear step at the end is **NOT DONE**.

Base: `9139c7a` plus the working tree, in a private copy. The patch round's web runs used HEAD `ace71ca`, which is
`9139c7a` plus a test-only commit. Sprint C (the sound tests hardened, §1 re-measured) ran on HEAD `816489c` plus the
working tree. Sprint D (in slab mode only the six cues play; the intensity guard; §2 "W15 D") is checked on HEAD
`54a0abf` plus the working tree: `tests/unit/audio-*.test.ts` passes 139 of 139 (15 files). No cue file was changed.

## 1. The files

`node tools/audio/measure-cues.mjs` (new; Node only, no dependencies; `--json` for raw numbers). All six files are
16-bit PCM mono at 44.1 kHz in `public/assets/audio/`.

| Cue | File | Duration | Peak | RMS (file) | RMS (loudest 50 ms) | Attack | Audible (to -40 dB) | Centroid | Dominant |
|---|---|---|---|---|---|---|---|---|---|
| rifle_shot | `synth_rifle_shot.wav` | 240 ms | -3.0 dBFS | -21.6 dBFS | -14.9 dBFS | 5 ms | 108 ms | 220 Hz | 97 Hz |
| hit_confirm | `synth_hit_confirm.wav` | 100 ms | -3.0 dBFS | -23.4 dBFS | -20.4 dBFS | 1 ms | 25 ms | 1688 Hz | 3149 Hz |
| slab_tick | `synth_slab_tick.wav` | 130 ms | -3.0 dBFS | -17.8 dBFS | -13.6 dBFS | 4 ms | 65 ms | 906 Hz | 883 Hz |
| slab_tick_enemy | `synth_slab_tick_enemy.wav` | 130 ms | -3.0 dBFS | -19.4 dBFS | -15.2 dBFS | 6 ms | 59 ms | 585 Hz | 587 Hz |
| match_end_win | `synth_match_end_win.wav` | 1500 ms | -3.0 dBFS | -19.0 dBFS | -10.7 dBFS | 374 ms | 1094 ms | 687 Hz | 698 Hz |
| match_end_lose | `synth_match_end_lose.wav` | 1300 ms | -3.0 dBFS | -19.2 dBFS | -10.8 dBFS | 18 ms | 851 ms | 195 Hz | 87 Hz |

How the columns are measured:
- **Centroid:** the **power-weighted** (|X|²) mean frequency of the whole file (Hann window, 20 Hz to 20 kHz).
- **Dominant:** the largest FFT bin over the same range.
- **Onset:** the first 1 ms RMS window within -20 dB of the loudest window.
- **Attack:** from the onset to the loudest window.
- **Audible:** from the onset to the last 1 ms window above -40 dB of the loudest window.
- **Win sting:** its 374 ms "attack" is the snare pickup before the chord.

**What Sprint C changed.** Sprint B weighted the centroid by magnitude and counted the audible length from the file's
first sample. Its table read 1510 / 2036 / 1132 / 620 / 5937 / 265 Hz, and the win sting 1142 ms.
- Magnitude weighting is pulled far up by a noise floor. Own-tick samples plus -70 dBFS noise moved a
  magnitude-weighted centroid by 1248 Hz; weighted by power the same copy moves by less than 5 Hz.
- The length now starts at the onset. 50 ms of silence before a signal changes its duration, not its audible length.

**Correction to the Sprint B brief (kept for the record).** It quoted the W14 ticks with the two columns swapped. Then,
weighted by magnitude, the own tick's centroid was 1132 Hz and its dominant 883 Hz.

### Your tick and the enemy's

| | Own `slab_tick` | Enemy `slab_tick_enemy` | Gap | Guard |
|---|---|---|---|---|
| Centroid (power-weighted) | 906 Hz | 585 Hz | **321 Hz** | at least 150 Hz, or the length gap below |
| Dominant | 883 Hz | 587 Hz | 296 Hz | (reported only) |
| File length | 130 ms | 130 ms | 0 ms | (reported only) |
| Audible length (onset to -40 dB) | 65 ms | 59 ms | 6 ms | at least 20 ms, or the centroid gap above |

- The two ticks differ in **pitch**, not in length.
- **The guard.** HUD_CONTRACT §3 asks for a difference "in length or pitch". `tests/unit/audio-cue-measure.test.ts`
  fails when the centroid gap is under 150 Hz **and** the audible-length gap is under 20 ms; either gap alone
  passes.
  - Sprint B's extra centroid pin is gone. The test header and this page now say the same thing.
- **Checks on the measures.**
  - Synthetic 1 kHz and 500 Hz tones: centroid within 5 Hz, dominant within 3 Hz.
  - 50 ms of leading silence: duration +50 ms, audible length within 1.5 ms.
  - The guard's edges: 149 Hz and 19 ms read as alike; 150 Hz or 20 ms alone read as different.
  - A **near copy** (the own tick plus seeded -70 dBFS noise) reads as alike: centroid within 5 Hz, length within
    2 ms.
- **Mutants**, each in a private copy, restored after; "B" is the Sprint B test, "C" the Sprint C test:

  | Mutant | B | C, with its message |
  |---|---|---|
  | The centroid weighted by \|X\| again | pass | **fail**: `expected 1248.2114167916718 to be less than 5` (near copy) |
  | The length counted from the file's first sample | pass | **fail**: `expected 49.88662131519273 to be less than 1.5` (leading silence) |
  | The enemy tick file replaced by a near copy of the own tick | fail | **fail**: `slab_tick 906 Hz / 65 ms vs slab_tick_enemy 907 Hz / 65 ms: centroid gap 1 Hz (min 150), length gap 0 ms (min 20)` |

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

`godot --headless --path engines/godot --script res://tests/run.gd -- --only sfx --sfx-log` passes (13 s on Sprint C).

The test records the game's own events (every rifle's `fired`, the human's `hit_confirmed`, `slab_point` and
`match_over`). Each cue's play count must equal its event count.

**Sprint C wiring checks.** A count by name could not see a cue that plays the wrong file, or plays muted. Each section
now also checks the wiring, at boot and again after play:
- every cue's stream holds its own file, `synth_<cue>.wav`, which the test reads itself;
- every 2D player plays its own cue's stream at sfx.gd's `VOLUME_DB`;
- all 12 shot voices play `streams.rifle_shot` at `VOLUME_DB.rifle_shot`;
- no `VOLUME_DB` entry is under -20 dB;
- `streams.slab_tick.data != streams.slab_tick_enemy.data`;
- right after a slab point, that side's tick player is the one playing.

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

**Mutants**, each a one-line edit to `sfx.gd` in a private copy, restored after (`cmp` with the real tree: same).
"B" is the Sprint B test (HEAD `816489c`), "C" the Sprint C test:

| Mutant | B | C, first message |
|---|---|---|
| Every point plays `slab_tick` (Sprint B's mutant) | fail | **fail**: `human, enemy point: no slab_tick_enemy player playing right after the point`, then `human: slab_tick played 4 times for 2 events` |
| `swap_player`: the enemy tick's player gets the own-tick stream | PASS | **fail**: `human, at boot: the slab_tick_enemy player does not play the slab_tick_enemy stream` |
| `swap_file`: `CUES` maps the enemy tick to `synth_slab_tick.wav` | PASS | **fail**: `the slab_tick_enemy stream does not hold synth_slab_tick_enemy.wav`, `slab_tick and slab_tick_enemy are the same data` |
| `mute_player`: the enemy tick's player at -80 dB | PASS | **fail**: `the slab_tick_enemy player is at -80.0 dB, VOLUME_DB says -14.0` |
| `mute_const`: `VOLUME_DB.slab_tick_enemy` = -80 | PASS | **fail**: `slab_tick_enemy is set to -80.0 dB, under the -20 dB floor`; the web parity test fails as well |
| `mute_shots`: every shot voice at -80 dB | PASS | **fail**: `shot voice 0 is at -80.0 dB, VOLUME_DB says 0.0` (and voices 1 to 11) |

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

**Unit tests.** On Sprint C, `npx vitest run tests/unit/audio-slab-cues.test.ts tests/unit/audio-cue-measure.test.ts
tests/unit/audio-weapons.test.ts tests/unit/audio-cues.test.ts` passes 29 of 29. `tsc --noEmit` reports 0 errors;
boundaries PASS.

Through `createAudio` with `?sfxlog`, the first case prints:

`SFX rifle_shot` · `SFX rifle_shot` · `SFX hit_confirm` · `SFX slab_tick` · `SFX slab_tick_enemy` · `SFX slab_tick` ·
`SFX match_end_win` · `SFX slab_tick_enemy` · `SFX match_end_lose`

The new cases:
- A Cat player hears the ticks flipped and wins with the Cats.
- With no local pet, as Godot's `--bots-only`, your side is Corgi Company. A bot's hit plays no confirm.
  - **Sprint C:** the test now plays one snapshot as a Cat first (local pet 1, team 1), then goes to no local pet, and
    still expects Corgi-side ticks.
  - The mutant `idx_nobranch` (drop `else if (localId < 0) slabTeam = 0` in `index.ts`) passes the Sprint B test
    (12/12) and fails the Sprint C one: `with no local pet … your side is Corgi Company, even after you were a Cat:
    expected [ 'SFX rifle_shot', …(6) ] to deeply equal [ 'SFX rifle_shot', …(6) ]`.
- A local pet missing from one frame's states keeps your side. Before W15 the web fell back to Corgi Company there;
  `index.ts` now keeps the last known team.
- **Sprint C:** every `createAudio` a test makes is disposed in `afterEach`, even when an expect throws. No bus
  listener outlives its test.

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

### W15 D: in slab mode the web plays only the six shared cues (Godot wins)

**Ruling.** The lead's ruling on Sprint D's open question: Godot wins. In slab mode the web twin plays the same event
sounds as Godot, which are exactly the six SYNTH cues. Other modes are unchanged.
- **Code.** In `src/client/audio/index.ts`, `onGameEvent` in slab mode plays the shared cue for the event, if it has
  one, and returns before the web's own event sounds.
- **Missing files.** When a cue's file is missing or still loading, the web used to play its synth stand-in. Now the
  cue stays silent, as in Godot.
- **No new cue.** Nothing was added, so there is nothing new to measure. Nobody has listened to the result.
- **Superseded.** Sprint D's first step dropped only the death "poof" (`S.poof`, "soft poof + a comedy squeaky-toy
  wheeze"). This replaces that step.

**Event sounds per build, slab mode.** "—" means no sound.

| Event | Godot | Web, slab mode now | Web slab mode before (dropped now) |
|---|---|---|---|
| Your shot | `rifle_shot`, 3D at the muzzle | `rifle_shot`, centred | the brass tinkle, the bullet's surface impact |
| Another pet's shot | `rifle_shot`, 3D | `rifle_shot`, 3D (ref 4 m, cut at 80 m) | its surface impact near you |
| Your shot lands (the kill shot too) | `hit_confirm` | `hit_confirm` | the thwack at the victim |
| You are hit / someone else is hit | — | — | the thwack |
| Your kill (a death by you) | — | — | the poof, the victim's yelp or meow, the kill thump (`hitThud` k2), the kill sting (`sting` k0) |
| Any other death, a fall | — | — | the poof, the victim's yelp or meow |
| Your own death | — | — | the poof, your yelp or meow, the death sting (`sting` k3) |
| A slab point, yours / theirs | `slab_tick` / `slab_tick_enemy` | the same | the same |
| The match ends, won / lost or drawn | `match_end_win` / `match_end_lose` | the same | the same (the generic score stings were already off) |
| Spawn, jump, land, reload, taunt | — | — | sparkle, boing, landing thud, reload clicks, voice and bark |
| A shared file missing or loading | that cue is silent | that cue is silent | the synth shot and hit thud stood in |

Pickups, explosions, abilities, vehicles and ordnance do not exist in slab mode (no ordnance, pickups, vehicles or
class ability: `src/shared/content/modes.ts`).

**What still plays on the web in slab mode.** These are not event sounds, so the ruling leaves them:

| Sound | Why it stays | Godot |
|---|---|---|
| Footsteps | Driven every frame by each pet's speed, not by an event | none |
| The Lot's site ambience (`site-ambience.ts`: rain on steel and tarps, drips, the crane, the floodlight hum, the ditch, the far site) | Continuous beds, not events | none |
| The weather beds: the rain, the wind bed and the storm roar (`weather.ts:116-118` set their levels) | Continuous beds that follow the world's weather clock, not events | none |
| Thunder (`weather.ts:139`) | A one-shot from the world's weather clock: a lightning strike, heard after the sound's travel time, not a game event. The Lot storms in its first weather cycle (`layout.ts` `LOT_WEATHER`) | none |
| Interface clicks (menus, settings) | Interface, not the match | none |
| The reward card's blip at the match end (`audio.ui('open')`: wired at `main.ts:274`, played at `rewards.ts:99` when `main.ts:405` shows the card for the match result) and the awards card's blip (`main.ts:277`, `awards.ts:518`, shown at `main.ts:318` when the match has awards) | Interface: a card opening, not a match event | none |

Music is off in slab mode (W15).

**Tests** (`tests/unit/audio-slab-cues.test.ts`).
- One round covers your shot, the kill shot, your kill, being hit, your own death, a fall, spawn, jump, land, reload
  and a taunt.
  - In another mode the round plays the web's own sounds: poof, meow, yelp, sting, hit thud, thwack, brass, sparkle,
    boing, thud, reload clicks.
  - In slab mode the same round plays exactly two sounds: `synth_rifle_shot.wav` and `synth_hit_confirm.wav`.
- The missing-file case now expects silence, not the synth shot.
- The shared-files case now expects no brass.

**Mutants.**
- With the slab gate removed, five tests fail. The new test fails with
  `expected [] to deeply equal [ 'synth_rifle_shot.wav', …(1) ]`.
- With the gate letting deaths through (`ev.e !== 'death'`), the new test fails with
  `plays: , , poof, meow, hitThud, sting, poof, yelp, sting, poof, meow: expected 11 to be 2`.

**Intensity guard.** `src/client/audio/intensity.ts` now checks `ev.by >= 0 && ev.by === c.localId`. With no local pet
(localId -1), a fall (`by: -1`) used to count as your kill: `deathNear * 1.5` = 0.15 of combat intensity.
- `tests/unit/audio-intensity-fall.test.ts`: a far fall adds 0 with no local pet, and 0 while you play. Your kill and
  your own fall still add 0.15.
- **Mutant:** without the guard the test fails: `expected 0.15000000000000002 to be +0`.

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
