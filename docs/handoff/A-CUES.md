# A-CUES (W13): the shared SYNTH sound cues

**Card.** Make four short sound cues (six files) that both the Godot game and the web twin play. A checked-in
script generates them; there is no downloaded or AI-generated audio, no keys and no network. They are labelled SYNTH.
There is no music bed.

**Base.** HEAD `71d05d5`. Nothing staged or committed. The proof ran in a private copy (`git archive HEAD` plus the
files below, with `node_modules` symlinked).

## Files (all owned by this lane, all new)

| Path | What |
|---|---|
| `tools/audio/synth-cues.mjs` | Node script with no dependencies. Deterministic DSP writes the six WAVs |
| `public/assets/audio/synth_*.wav` | The six cues (table below) |
| `public/assets/audio/SYNTH.md` | SYNTH label, licence (original, made in-repo) and how to regenerate |
| `tests/unit/audio-cues.test.ts` | Format, bounds, peak, DC, size and byte-identical regeneration |
| `docs/handoff/A-CUES.md` | This file |

## Cues

All files are 16-bit PCM mono WAV at 44.1 kHz, peak-normalised to -3 dBFS, with DC under 0.001 % of full scale.
The table is the script's own printout.

| Cue | File | Duration | Peak | Size |
|---|---|---|---|---|
| rifle_shot | `synth_rifle_shot.wav` | 240 ms | -3.00 dBFS | 21,212 B (20.7 KB) |
| hit_confirm | `synth_hit_confirm.wav` | 100 ms | -3.00 dBFS | 8,864 B (8.7 KB) |
| slab_tick | `synth_slab_tick.wav` | 130 ms | -3.00 dBFS | 11,510 B (11.2 KB) |
| slab_tick_enemy | `synth_slab_tick_enemy.wav` | 130 ms | -3.00 dBFS | 11,510 B (11.2 KB) |
| match_end_win | `synth_match_end_win.wav` | 1500 ms | -3.00 dBFS | 132,344 B (129.2 KB) |
| match_end_lose | `synth_match_end_lose.wav` | 1300 ms | -3.00 dBFS | 114,704 B (112.0 KB) |

## Sound design

The cues follow the web's procedural voices in `src/client/audio/presets-weapons.ts` and `presets-objective.ts`.

- **rifle_shot**: the Squeaker Rifle report. It layers a high-passed noise crack (the peak lands at 1.2 ms), a sine
  thump gliding from 125 Hz to 52 Hz, a pink-noise blast band-passed at 780 Hz, and a short brown-noise tail under a
  closing low-pass. Those four layers go through a tanh grit stage. A clean bolt click (3.3 kHz) and a faint
  triangle squeak (2.5 to 3.3 kHz) ride on top: slightly toy-like but quiet. The level is about -60 dB by 130 ms.
- **hit_confirm**: a tonal "tk" that is clearly not a shot. It has a band-passed 2.15 kHz square tick and a 3.15 kHz
  glassy top over a mid noise slap (1.1 kHz) and a small 190-to-85 Hz body. Its spectral centroid is about 2 kHz;
  the shot's low body dominates the shot instead. It is about 45 dB down by 30 ms.
- **slab_tick**: A5 (880 Hz, the third of the music's key of F), with weak 2nd and 3rd partials. It settles from
  940 Hz in 12 ms and has a 4 ms soft attack and a short octave shimmer.
- **slab_tick_enemy**: D5 (about 587 Hz, a fourth lower). It is low-passed at 1 kHz, sags from 600 to 560 Hz, has a
  slower 7 ms attack and a muffled under-thump at 300 Hz. Its centroid is about 580 Hz, against 1.1 kHz for ours.
- **match_end_win**: an 8-hit snare pickup, then two bugle C5s, then the full F major chord (F4 A4 C5, F5 on top).
  The chord sits over an F2 timpani, a snare accent and a crash, and gains a vibrato as it holds. The brass is
  additive and gets brighter as it gets louder.
- **match_end_lose**: a snare and B-flat 2 timpani hit under a dark B-flat minor brass chord that sags a semitone,
  then a second, lower F2 drum. It is grim but not a joke: there is no squeak.

## For the playback lane

- Every file peaks at -3 dBFS, so loudness is set at playback. Suggested starting gains, which have **not** been
  checked in game: rifle_shot 0 dB, hit_confirm -6 dB, slab_tick and slab_tick_enemy -14 dB (they repeat once per
  second), match_end -4 dB.
- None of them loop. Each one starts and ends at near-zero samples, with a 4 ms raised-cosine fade-out.
- Godot only imports files under `res://` (`engines/godot/`). These files live in `public/assets/audio/`, so the
  Godot side needs a copy or an import step. That is the playback lane's choice; this lane does not own the files
  involved.

## Regenerate

`node tools/audio/synth-cues.mjs` rewrites the six WAVs in `public/assets/audio/` and prints the table above.
`--out <dir>` writes them somewhere else, which the test uses. The script does not use `Math.random`; it has its own
seeded mulberry32 (the same one as `src/shared/rng.ts`). One run takes about 0.7 s. Two runs produced identical
files, and the test regenerates the files and compares them byte for byte.

## Proof

`CI=1 npx vitest run tests/unit/audio-cues.test.ts --reporter=verbose` in the private copy: **9 passed (9)**. The
tests cover the six format, bounds, peak, DC, size and edge checks; the enemy tick being lower than ours (by
zero-crossing pitch); the `SYNTH.md` label; and byte-identical regeneration.

A mutation check: one flipped byte in `synth_slab_tick.wav` made the regeneration test fail, as intended. The test
file passes `tsc --noEmit` under the repo's tsconfig.

## Not done / caveats

- Nobody has listened to these by ear in this lane. The design was checked by analysis only (envelopes in 10 ms RMS
  windows, spectral centroid, peak position).
- Byte-identity relies on V8's `Math.sin`, `exp`, `pow` and `tanh`. They are deterministic for a given Node version.
  A future Node release could, in principle, move a sample by 1 LSB; if so, rerun the script and recommit.
