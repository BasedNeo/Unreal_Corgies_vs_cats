# Corgis vs Cats — the Godot game (Wave 12)

**Play:** `npm run godot` from the repo root, or `godot --path engines/godot` with Godot 4.7+. This opens the match.

Godot 4.x is the game the owner launches. The browser client (Three.js, `src/client`) is the web twin of the same
GLBs. Look: **stylised-realistic** (a wet night on The Lot), locked in Wave 12; no ink outlines anywhere.

## Layout and ownership (one writer per folder)
| Path | Owner | What |
|---|---|---|
| `project.godot`, `main.tscn`, this README | lead | project settings, the scene composition, contracts |
| `world/`, `data/` | G-WORLD | The Lot built from `data/the_lot.json` (exported from the TS world by `tools/godot/export-lot.mjs`) and the shared kit GLBs: terrain + collision, props, kit pieces, colliders, navigation |
| `look/` | G-LOOK | environment, sky, fog, tonemap, floodlights, wet PBR materials and shaders |
| `game/` | G-GAME | input map, player controller, rifle, bot, slab, score, HUD, rematch, placeholder pets |
| `tests/` | each lane adds its own `test_<lane>_*.gd`; the runner `tests/run.gd` is the lead's | headless checks |

The shared kit GLBs stay in `../../assets/masters/`. The world loads them at runtime with `GLTFDocument`, so nothing
is copied into this project.

## Contracts
- **Units:** meters, +Y up. World coordinates equal the TS sim's (x, y, z), so data exported from `buildTheLot()`
  places things exactly where the web game has them.
- **World → game, look:** `World` (`world/world.gd`) emits `built` when it is ready. Before that, the game waits for
  it. It exposes:
  - `spawn_points(team: int) -> Array[Vector3]` (0 = Corgi Company, 1 = Cat Cadre);
  - `slab() -> {center: Vector3, size: Vector2}`, the one control slab;
  - `floodlights() -> Array[{pos: Vector3, target: Vector3}]`;
  - `nav_region() -> NavigationRegion3D`, baked, for bots; `nav_ready()` is true once the nav map serves paths
    (about 11 physics frames after `built`).
  - `look/` also reads `World.data.lamps` for the practicals (to become a `lamps()` accessor).
- **Groups (set by the world, read by the look):** `ground` (terrain), `kit` (GLB pieces), `prims` (box and
  cylinder props), `world_static` (all static colliders).
- **Physics layers:** 1 world, 2 pets, 3 hitboxes (rifle rays hit 1 and 3).
- **Look → all:** `look/look.gd` has `const LOOK := "stylised-realistic"`; a test fails on any other value.

## Sound (W13)
`game/sfx.gd` plays the shared cues at runtime from `../../public/assets/audio/` (the same WAVs as the web twin, made by
`tools/audio/synth-cues.mjs`, SYNTH placeholders): rifle shot (3D at the muzzle), hit confirm, own / enemy slab tick,
match end win / lose. No music. A missing file warns once and stays silent.

## Flags (user args after `--`)
- `--2v2`, `--bots-only`, `--debug`, `--perf N`: match options (G-GAME).
- `--demo`: bots and the human start by the slab.
- `--lineup <m>` (+ `--lineup-side`): the READ check: the human stands <m> from the slab, one corgi and one cat bot
  stand still on it (facing, or in profile).
- `--sfx-log`: prints `SFX <cue> <seconds>` for every cue played.
- `--shot <png> [--frames N] [--cam x,y,z:tx,ty,tz]`: save a screenshot and quit (`proof.gd`).

## Proof
- **Headless:** `godot --headless --path engines/godot --script res://tests/run.gd` runs every `tests/test_*.gd`
  (`-- --only <text>` runs the files whose name contains <text>).
- **Bot balance:** `godot --headless --path engines/godot --script res://tests/balance.gd -- --format 2v2 --n 20 --seed 1
  --speed 30` plays full bots-only matches and prints the win split (docs/handoff/G-BOT.md).
- **Screenshots:** `xvfb-run -a godot --path engines/godot --rendering-method gl_compatibility --rendering-driver opengl3 -- --shot <png>`
  (container: Mesa llvmpipe). The project itself defaults to Forward+.
