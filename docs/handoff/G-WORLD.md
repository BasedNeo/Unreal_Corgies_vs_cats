# G-WORLD (W12): The Lot in Godot, from the same data as the web game and the sim

**Card.** `npm run godot` opens The Lot built from `buildTheLot(seed)` (the TypeScript that builds the web world and the
sim) and the six shared kit GLBs, with colliders you walk on and a baked navigation mesh. Base: HEAD `f8ca7c1`; nothing
staged or committed. Every number below comes from a command I ran in this session (scratch:
`/tmp/claude-0/-home-user/4eb0b9e5-129d-5c0b-ac58-7a3e7a57c134/scratchpad/gworld`). Godot 4.7.2 (`scratchpad/pglb1/`).
G-GAME and G-LOOK were editing `game/` and `look/` at the same time, so the screenshots show their work in progress.

## 1. Files
| Path | What |
|---|---|
| `tools/godot/export-lot.mjs` | **New.** `exportLot(seed)` → the JSON text + the heights buffer; `npx tsx tools/godot/export-lot.mjs` writes them, `--check` exits 1 on drift. Seed `LOT_SEED = 1` |
| `engines/godot/data/the_lot.json` | **New.** 300.5 KB. Format `cvc-lot/1` (section 2) |
| `engines/godot/data/the_lot_heights.bin` | **New.** 422.8 KB: the sim's `Float32Array` (329 × 329, little-endian), byte for byte. As JSON text it would be ~760 KB and rounded |
| `engines/godot/world/world.gd` | Replaces the stub; keeps `built`, `spawn_points`, `slab`, `floodlights`, adds `nav_region()` (section 3) |
| `engines/godot/tests/test_world_lot.gd` | **New.** Headless checks (section 5) |
| `tests/unit/godot-lot-data.test.ts` | **New.** The drift guard plus data checks (section 5) |

## 2. The data (`the_lot.json`)
Units and axes are the sim's: metres, +Y up, the same x / z. Rotations are Euler `YXZ` (yaw, then pitch about the
turned x, then roll), as `PropBox`, `VisualPrim` and `KitPlacement`. Lengths are rounded to 1e-5 m, angles to 1e-6.
- `terrain`: `x0 z0 cell n` (−164, −164, 1, 329), the `.bin` name, its sha256, min / max, and the split rule: each
  cell is (a,c,b) + (b,c,d), the b–c diagonal (`terrain.ts gridHeight`, Rapier's layout).
- `prims`: the 1,613 procedural prims the kit does not replace, as rows `[shape, x, y, z, a, b, c, yaw, pitch, roll,
  col, seg, bev]`; `palette`: each used colour key → sRGB hex, roughness, metallic (`world-palette.ts`).
- `colliders`: the sim's 266 boxes `[type, x, y, z, hx, hy, hz, yaw, pitch, roll]` and 41 cylinders `[type, x, y, z, r, hh]`.
- `kit`: the six pieces in the web's split order, from `splitLotKitPrims()` (`src/client/assets/kit-glb.ts`, imported,
  not copied): `glb`, `lodDist`, `paintTint`, `placements` `[x, y, z, yaw, pitch, sz, tintR, tintG, tintB]` (tint
  linear, the web's `kitTint()`), `ids`, and `fallbackPrims` (the procedural stand-in). Counts: container 2, bag wall
  16, pipe 8, footing 6, mast 4, lamp 16 = 52; `missing` 0 for each.
- `spawns` (`"0"` Corgi Company, `"1"` Cat Cadre: 16 each, `[x, y, z, yaw]`), `slab`, `floodlights` (id, team, pos,
  target), `bases`, `interiors`, `water`, `fences`, `lamps`, `districts`, `perches`, `bookmarks`, `bounds`, `killY`,
  `bedLevel`, `timeOfDay`, `weatherBias`.
- `checks`: 16 terrain probes and one turned box's corners (three.js `Euler('YXZ')`), for the Godot tests.

## 3. The world (`world/world.gd`)
Built synchronously in `_ready`; `built` is emitted **deferred**, so nodes whose `_ready` runs after the world's can
still connect; `is_built` tells a late caller it already fired. Groups as the README; physics layer 1.
- **Ground** (`ground`): one `ArrayMesh` from the heights, with normals (central differences) and world-metre UVs, the
  same b–c split. **GroundBody** (`world_static`, not `ground`): a `HeightMapShape3D` of the same samples.
- **Colliders** (`world_static`): one `StaticBody3D`, a `BoxShape3D` (`Basis.from_euler(…, EULER_ORDER_YXZ)`) or
  `CylinderShape3D` per sim collider, in JSON order (the `boundary` walls included).
- **Kit** (`kit`): the six GLBs are read in parallel (`WorkerThreadPool`, mostly PNG decoding) with
  `GLTFDocument.append_from_file` from `ProjectSettings.globalize_path("res://")/../../assets/masters/<name>.glb`; no
  copies. Only the `<name>_LOD0` mesh is taken from the `GLTFState` (CPU data); `generate_scene` is never called, so
  **no `COL_` node and no LOD1/LOD2 node ever enters the tree**. One `MultiMeshInstance3D` per piece (1 draw per piece)
  with `cast_shadow = OFF`, plus **KitShadow**: every loaded piece's LOD0 baked at its placements into one
  shadows-only mesh (P-GLB4's "1 draw per piece plus a shared shadow"). The container's palette tint is the
  MultiMesh instance colour, applied through `vertex_color_use_as_albedo` on a copy of the GLB material.
- **Prims** (`prims`): the rest merged into one mesh (de-indexed triangles: unit box / cylinder / cone / sphere scaled,
  rings at their own size; normals by the inverse transpose). Vertex colour = palette colour (linear), UV2 =
  (roughness, metallic). A piece whose GLB fails to load is drawn here from its `fallbackPrims`. The one fence run
  (`FenceRun`, drawn by the web's fence view) is a box here.
- **Water** (`water`): one quad per ditch zone at its surface.
- **Nav**: `NavigationMesh` parsed from the `world_static` group (static colliders, mask 1) inside the bounds and
  baked synchronously: cell 0.5 m (the sim's bot grid is 1 m; 0.25 m took 2,244 ms to bake), cell height 0.05 m,
  agent radius 0.5, height 1.0, climb 0.45 (the KCC autostep), slope 48° (the bots' limit in `nav.ts`). The map's cell
  size and height are set to match. Result: **6,175 polygons**. Recast floors the climb in voxels: with a 0.15 m cell
  height, 0.45 / 0.15 = 2.99999 became 0.3 m (it warned), hence 0.05 m.
- **API:** `spawn_points(team)`, `slab()`, `floodlights()` (+ `id`, `team`), `nav_region()`, plus `nav_ready()`,
  `spawn_yaws(team)`, `ground_height(x, z)` (the sim's formula), `data`, `timings`, `kit_loaded`, `kit_failed`,
  `kit_nodes`, `kit_xforms`, `kit_lods`.
- **Debug args** (after `--`): `--no-kit` (the procedural stand-ins, for A/B), `--world-stats` (prints draw calls,
  objects and primitives two frames before `--frames`), `--mesh-lod-threshold <px>`, `--no-nav`.

**Build time** (`timings`, ms). Alone, headless: total **954** (data 5, terrain 47, colliders 2, kit 130, prims 22,
water 0.4, nav 747). Other runs this session, with the other lanes' Godot processes on the same 4 cores: 1,079-1,917
(the kit 130-904, nav 747-945). Before the parallel GLB read the kit took 592-601 ms.

## 4. The slab
**Centre (0, −0.0572, 0), size 8 × 8 m.** The Lot is point-symmetric about the origin (the corgis' pit north-west, the
cats' heap south-east, every cover pair mirrored), so the origin is the one spot equally far from both teams by
construction: the mean spawn distance differs by < 1 cm between the teams (unit test). It lies on the **middle
causeway** (dry, x −14..14) across the ditch, the Mud lane's crossing. Under the 8 × 8 m the ground spans −0.253 to
−0.024 m (0.23 m, the road ruts; max slope 12°). No collider, prim or water zone reaches it; the nearest cover (cones at
(±4, ∓12), barrels at (±17, ±9)) sits outside. Neighbours I rejected: (0, 8) has a cone and its base on it; (0, −30)
spans 0.38 m and is 30 m nearer the corgis.

## 5. Tests
**Headless** (`godot --headless --path engines/godot --script res://tests/run.gd`): `PASS test_world_lot.gd` (and
`test_lead_boot.gd`). Alone: `RESULT PASS`, peak RSS 211 MB. It builds `world.gd` on its own (not `main.tscn`) and asserts:
- `built` fires; 6 / 6 kit pieces load; each is one `MultiMeshInstance3D` whose instance count equals the JSON, casts
  no shadow, has one surface; every instance's origin (1 mm) and yaw (1e-3) equals its JSON placement; one
  shadows-only KitShadow; **no `COL_*` node** in the world; the four groups are not empty;
- **the terrain collider is the sim's surface**: the 16 probes are the off-grid points where the b–c split and the
  other diagonal differ most (10-31 cm); every ray hits within 1 cm of the sim's height (measured: ≤ 1e-5 m), so a
  wrong split would fail;
- the most turned box collider's 8 corners equal three.js `Euler('YXZ')`'s within 1 mm;
- a ray down at each of the 32 spawns hits ground within 2 m;
- the slab: the centre and four inset corners hit GroundBody with a normal under 48° and within 0.5 m of the centre's
  height; a 8 × 1.8 × 8 m box just over it touches nothing; the centre is on the nav mesh;
- **a nav path from every one of the 32 spawns to the slab** (end within 0.6 m, start within 1 m; worst gap 0.03 m).

**Vitest** (`CI=1 npx vitest run tests/unit/godot-*.test.ts`): 2 files, 6 tests passed. `godot-lot-data.test.ts`: the
committed JSON and `.bin` equal a fresh `exportLot()`; the heights equal the sim's `Float32Array`; the kit placements
equal `splitLotKitPrims()` (1e-4 m, 1e-5 rad) with `missing` 0 and counts [2, 16, 8, 6, 4, 16]; every prim is drawn
exactly once (rest + fallbacks = all prims); collider and spawn counts; the slab is flat (< 0.3 m), clear, dry and
equidistant.

## 6. Screenshots and draw calls
Command: `xvfb-run -a -s "-screen 0 1280x720x24" <godot> --path engines/godot --rendering-method gl_compatibility
--rendering-driver opengl3 --audio-driver Dummy -- --shot artifacts/godot/<name>.png --frames 120 --cam <cam>
--world-stats [--no-kit]` (llvmpipe; the full game: G-LOOK's night and G-GAME's HUD). I looked at each.

| Shot | Cam (bookmark) | What it shows |
|---|---|---|
| `artifacts/godot/world_overview.png` | `lot_overview` 3.28,114,130.45 → −26,−2,−46 | The whole lot from the crane: terrain with the pit and heap, the crane lattice, the skyline houses, the containers, the Pipeworks pipes, the slab marker at the origin. Dark (the night look) |
| `artifacts/godot/world_canyon.png` | `lot_container_canyon` −85,2.4,−58 → −78,9,60 | Container Canyon: both GLB containers with their lamps, the GLB bag walls at the mouth, the gangway and pallets (prims), a GLB pipe on the left, the houses beyond |
| `artifacts/godot/world_overview_nokit.png`, `world_canyon_nokit.png` | same, `--no-kit` | The procedural stand-ins in exactly the same places (the A/B: the kit is in place) |

`RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME` / objects / primitives:

| View | Kit on | Kit off (stand-ins) | Kit cost |
|---|---|---|---|
| Overview | 131 / 221 / 581,278 | 118 / 214 / 555,334 | +13 draws, +7 objects |
| Canyon | 77 / 195 / 829,240 | 65 / 188 / 766,258 | +12 draws, +7 objects |

The +7 objects are the 6 MultiMeshes and KitShadow; the stand-ins cost 0 extra draws (they merge into Prims). The
other ~6 draws are KitShadow in each shadow pass of G-LOOK's lights (I did not split them by pass).

**LOD: what Godot does.** Godot generated its own LODs on each LOD0 at load (`ImporterMesh.generate_lods`): container
3, bag wall 6, pipe 2, footing 1, mast 2, lamp 1 index LODs. It picks **one LOD per `MultiMeshInstance3D`**, from the
distance to the whole MultiMesh's AABB, not per instance: at the overview the frame drops from 615,170 primitives
(`--mesh-lod-threshold 0`, LOD off) to 581,278 (default 1 px), −33,892, close to the kit's whole LOD0 (35,900 triangles
per pass: 612×2 + 1,760×16 + 144×8 + 182×6 + 484×4 + 146×16), so the whole kit went coarse together. Close up, a
piece's AABB contains or nears the camera, so all its instances stay at LOD0. The GLBs' authored LOD1/LOD2 are not
used in Godot (the web uses them); KitShadow has no LODs.

## 7. Open risks
1. **G-GAME's `test_game_soak.gd` fails on the real Lot** ("no bot fired a shot") in the full runner; the other 6 game
   tests and the lead's pass. Not diagnosed (their folder). One likely factor: the navigation map serves the baked
   mesh about 11 physics frames (49 ms) after `built` (Godot's async region sync); a path query before that returns
   nothing. `nav_ready()` or `NavigationServer3D.map_changed` covers it. The spawns are ~130 m from the slab.
2. **The terrain is one 215 k-triangle mesh that casts shadows**: every shadow pass draws all of it (the frame's
   0.58-0.83 M primitives). Chunking it (culling per chunk) or letting G-LOOK turn its shadow off is the next step.
3. **The container tint covers the whole albedo** (rust and frame too); the paint mask is in the baseColor alpha, a
   G-LOOK shader can apply it from the instance colour. Kit nodes are `MultiMeshInstance3D` (mesh at
   `multimesh.mesh`), not `MeshInstance3D`.
4. **Prims are simplified**: no box bevels, rings without their edge chamfers, sphere ring counts approximate. The
   ground has one flat colour: the sim's surface weights (`data.surface`) are not exported.
5. **Physics engine**: `physics/3d/physics_engine` is `DEFAULT`; the probes prove the HeightMapShape3D matches the sim's
   split on whatever engine that is. If the project switches engine, the test re-checks it.
6. **An exported Godot build** must include `data/*.json` and `data/*.bin` (non-resource files) and ship the masters
   next to it, since the world reads `../../assets/masters` at run time.
7. `built` now arrives after ~1 s of synchronous build (the window stalls that long at start). The nav bake is 75 % of
   it; it can move to `bake_from_source_geometry_data_async` once the game waits for `nav_ready()`.
8. With `--no-kit` the overview has no flood pools (compare the two overview shots): G-LOOK's floods seem to key off
   the FloodLamp kit node, so they vanish when a lamp GLB fails. Their folder; noted for them.
9. **Not run:** `npm run gate`, `npm run verify`, the Forward+ renderer (container: compatibility only), a GPU.
