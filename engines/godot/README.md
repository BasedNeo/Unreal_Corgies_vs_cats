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

## Proof
- **Headless:** `godot --headless --path engines/godot --script res://tests/run.gd` runs every `tests/test_*.gd`.
- **Screenshots:** `xvfb-run -a godot --path engines/godot --rendering-method gl_compatibility --rendering-driver opengl3 -- --shot <png>`
  (container: Mesa llvmpipe). The project itself defaults to Forward+.
