# A-HOOK (W13): the four cues play in Godot and in the web twin's slab mode

**Card.** Play A-CUES's six shared WAVs (`public/assets/audio/synth_*.wav`) in the Godot game and in the web twin's
slab mode: the rifle shot, the hit confirm, the slab tick (yours / the enemy's) and the match-end sting (win / lose).
There is no music.

**Base.** HEAD `71d05d5` plus the working tree (every lane's finished, uncommitted files). Nothing is staged or
committed. The proof ran in a private copy.

## Files

| Path | What |
|---|---|
| `engines/godot/game/sfx.gd` | **New.** The `Sfx` node: it loads the WAVs at runtime, hooks the game's signals and plays the cues. |
| `engines/godot/main.tscn` | One node added: `Sfx` (script `res://game/sfx.gd`), after `Game`. |
| `engines/godot/game/match.gd` | Two lines: `signal slab_point(team: int)`, and its emit in `step_score` after each point. |
| `engines/godot/tests/test_game_sfx.gd` | **New.** The headless test (below). |
| `src/client/audio/slab-cues.ts` | **New.** Cue names, files and levels, the pure cue selection (`slabEventCue`, `SlabMatchCues`), and the loader (`SlabSamples`, `sampleRecipe`). |
| `src/client/audio/index.ts` | Slab-mode branches in `createAudio`: a `bus.on('match')` tracker, the shot and hit-confirm swap, no score stings and no music bed in slab mode. It also adds `?sfxlog`. |
| `tests/unit/audio-slab-cues.test.ts` | **New**, 9 tests (below). |
| `docs/qa/w13/sfx-log-godot.txt`, `docs/qa/w13/sfx-log-web.txt` | **New.** The SFX logs (below). |

`rifle.gd`, `slab.gd`, `slab-view.ts` and `main.ts` are **unchanged**. The game already had `Rifle.fired(result)`,
`Player.hit_confirmed(res)` and `Game.match_started` / `match_over(winner)`. On the web, the audio module already
gets every game event, and it now listens to bus `match` itself.

## Godot (`game/sfx.gd`)

- **Files.** The files load at runtime from `ProjectSettings.globalize_path("res://") + ../../public/assets/audio`
  with `AudioStreamWAV.load_from_file`, the same way `world.gd` reads the kit GLBs. Nothing is copied into
  `engines/godot`.
  - A missing or unreadable file gets **one** `push_warning` for all of them (`Sfx: no playable file for …`). Its cue
    then stays silent, and nothing else changes.
  - The file's existence is checked before loading, so a missing folder logs no engine error.
- **Hookup.** On `match_started` (`_spawn_pets` always runs just before it), `Sfx` connects every pet's
  `rifle.fired` and the human's `hit_confirmed`. It hooks each node once, tracked by instance id. It also connects
  `match_over` and the new `slab_point`.
- **Cues.**

  | Cue | When | How it plays |
  |---|---|---|
  | `rifle_shot` | any pet fires | `AudioStreamPlayer3D` at the muzzle, from a pool of 12 (four pets at 10 shots/s). Inverse distance: full level within 4 m, silent past 80 m, the web panner's numbers. |
  | `hit_confirm` | your shot lands on a pet | `AudioStreamPlayer` (2D) |
  | `slab_tick` / `slab_tick_enemy` | a slab point for your side / the other side | 2D |
  | `match_end_win` / `match_end_lose` | the match ends: your side won / did not | 2D |

  - A draw plays `match_end_lose`.
  - "Your side" is the human's team. When the bots play alone (`--bots-only`) it is Corgi Company, as on the web.
- **Levels** (`VOLUME_DB`) follow A-CUES's suggested starting gains: shot 0 dB, hit -6 dB, ticks -14 dB, end
  -4 dB. They have not been tuned by ear.
- **`--sfx-log`** prints `SFX <cue> <seconds since start>` on every play. With `--audio-driver Dummy` (and
  headless) the players still play, so the line works without a sound card.
- `Sfx.counts[cue]` counts plays (for tests). `Sfx.audio_dir` can be set before `_ready` to point at another
  folder.

## Web (slab mode only)

- **Which cue.** `slabEventCue(ev, localId)` picks the cue for an event:
  - `fire` gives `rifle_shot`: yours is centred; anyone else's plays at the muzzle (ref 4 m, culled at 80 m).
  - `hit` with `src` = you and `dst` = someone else gives `hit_confirm`.
- **Slab points.** The authority adds slab points silently, with no event per point. So `SlabMatchCues.update(ms,
  myTeam)` follows each snapshot's `MatchState`, which comes on bus `match` before that snapshot's events:
  - it plays a tick for each team whose score rose while the match was live;
  - on live → ended it plays win or lose (a draw plays lose). When the last point and the end land in one snapshot,
    the tick plays and then the sting, the same order as Godot;
  - the first slab snapshot only sets the baseline, a rematch plays nothing, and another mode resets the tracker.
- **What changes in slab mode** (W15 D, the lead's ruling: Godot wins).
  - The web's event sounds are exactly Godot's six shared cues. `onGameEvent` plays the event's shared cue, if there
    is one, and returns (`src/client/audio/index.ts`, the `slabCues.active` gate).
  - Everything else that an event triggers stays out:
    - the synth rifle report, the brass and the bullet impacts;
    - the hit thwack and the shooter's hit thud;
    - the death poof, the victims' voices, and the kill and death stings;
    - the spawn, jump, land, reload and taunt sounds;
    - the generic `score` stings.
  - **No music bed** (the lead's decision: Godot has none). The adaptive music stops when a slab match starts and
    never starts during one. It starts again in another mode.
  - **Non-event sound stays:** footsteps, The Lot's ambience, the weather beds and thunder, and the interface blips.
    `docs/qa/w15/LISTEN.md` §2 "W15 D" lists them with an event-sounds-per-build table.
  - Other modes are untouched: no file is fetched there, and the unit test checks this.
- **Loading.** On the first slab `MatchState`, the six files are fetched once from `/assets/audio/` and decoded with
  `engine.whenReady`, after the first gesture unlocks audio. They play through the engine's voice limiter and
  buses as a `sampleRecipe`.
  - A missing file gets one `console.warn` for all of them, and its cue is silent.
  - While the files are still loading, or when one is missing, that cue is silent, as in Godot. Before W15 D the shot
    and the hit confirm fell back to the web's old synth.
- **Levels.** `SLAB_CUE_DB` equals sfx.gd's `VOLUME_DB`, and the test parses sfx.gd to keep the two builds in step.
- **`?sfxlog`** prints `SFX <cue>` on every play. A cue that is selected but cannot play prints
  `SFX <cue> silent (audio locked | loading | no file | culled)`.

## Proof

All runs used the private copy: HEAD plus the working tree, my files, and A-CUES's six WAVs.

- **Godot cue test.** `$G --headless --path engines/godot --script res://tests/run.gd -- --only sfx` gives
  `PASS test_game_sfx.gd`. It boots a 1 v 1, places the Cat bot on the camera line 7 m out, and holds fire until a
  hit. Then:
  - the Cat's own shot plays at its muzzle;
  - a slab point for each side plays `slab_tick` and then `slab_tick_enemy`;
  - at 59-0, holding the slab wins and plays `match_end_win`; a rematch lost plays `match_end_lose`;
  - all six files are 16-bit mono 44.1 kHz;
  - with a missing folder, a full match runs with every cue silent, exactly one `Sfx:` warning and no engine error.
- **Godot full suite.** `$G --headless --path engines/godot --script res://tests/run.gd`: 15 files PASS and
  `GODOT TESTS: PASS` (exit 0). The cue test's prints read `sfx counts: { "rifle_shot": 3, "hit_confirm": 1,
  "slab_tick": 2, "slab_tick_enemy": 1, "match_end_win": 1, "match_end_lose": 1 }`. The suite first ran on test tones
  under the six names; A-CUES's real files then landed, and `--only sfx` passed again on them.
- **Real launch.** `xvfb-run … --audio-driver Dummy -- --sfx-log --demo` (gl_compatibility) was killed by PID each
  time. The machine was shared and loaded (load average about 20 on 4 cores), so the game ran slowly.
  - With test tones: `SFX rifle_shot 22.313`, … and `SFX slab_tick_enemy 79.851`, …: 29 shots and 4 Cat points.
  - With A-CUES's files, 75 s: `SFX rifle_shot 15.735`, `SFX rifle_shot 15.755`, …, 15 shots, then
    `SFX slab_tick_enemy 55.023` and `SFX slab_tick_enemy 90.328`. There was no `Sfx:` warning and no error.
  - The human does not fire in `--demo`, so there was no hit confirm. The headless test covers it.
- **Web unit tests.** `npx vitest run tests/unit/audio-slab-cues.test.ts`: 9 passed, including the music test.
  `tsc --noEmit`: 0 errors. `check-boundaries`: PASS. All `tests/unit/audio*`, `weather-audio` and `slab*` tests:
  15 files, 148 passed. One earlier run failed `audio-w10-mix` once under machine load; it passed alone (11/11) and
  on the full rerun.
- **Logs.**
  - `docs/qa/w13/sfx-log-godot.txt`: `--only sfx --sfx-log` prints all six cues, `SFX rifle_shot 10.726` …
    `SFX match_end_lose 11.717`, plus the real `--demo` launch lines.
  - `docs/qa/w13/sfx-log-web.txt`: the private web probe's console lines.
- **Web probes.** The probes ran on a private vite server.
  - The given probe, `node tools/probe.mjs '?mode=slab&webgl&autoplay&sfxlog' 20 …`, has no user gesture, so the
    page logs the selected cue as `SFX slab_tick_enemy silent (audio locked)`. The machine was loaded (fps 0.2), so
    the screenshot timed out.
  - A private probe variant clicks once to unlock audio:
    - with `&slabWin=8`: `SFX slab_tick_enemy` ×8, then `SFX match_end_lose`, all played;
    - with `&2v2&cam=slab&slabWin=15`: `SFX rifle_shot` ×46, `SFX slab_tick_enemy` ×15 and `SFX match_end_lose`,
      with no `silent` line;
    - with A-CUES's files, `&2v2&cam=slab&slabWin=10`: `SFX rifle_shot` ×34, `SFX slab_tick_enemy` ×10 and
      `SFX match_end_lose`, again with no `silent` line and no slab-cue warning.
    - `&cam=slab` puts the listener near the slab, inside the 80 m shot range. Your own fire and your hit confirm
      need pointer lock, which the headless page did not get, so the unit tests cover them.
    - No screenshot: under that load every `page.screenshot` timed out.

## Open

1. The levels are A-CUES's untuned starting points; set them by ear in both builds.
2. Web slab mode still plays its own other sounds: footsteps, the victim-side thwack, death poofs and the kill /
   death stings, and site ambience. Godot plays only the four cues. The music is off in slab mode.
3. ARCHITECTURE.md lines, for the lead:
   - `engines/godot/game/sfx.gd  W13 the four shared cues (runtime WAVs from public/assets/audio)`
   - `src/client/audio/slab-cues.ts  W13 slab-mode cues (same WAVs as sfx.gd)`
