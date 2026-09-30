# P-GLB3 (W11, pipeline-3): batch 1 of The Lot's kit

**Card.** Three more Lot pieces through the proven pipeline (bpy → master GLB → validator → Godot → the game behind
`?kit=glb`): a Pipeworks pipe section whose bore matches `lotInteriors()`, the floodlight tower, and the most repeated
remaining Lot prop in the base and canyon bookmarks. `kit-glb.ts` becomes a table of pieces. Plan lock and standards:
`docs/design/ASSET_PIPELINE.md`.

**Base.** Started on HEAD `80ce0f1`; the trial tree is HEAD `3bb5053` (the lead's CI-budget commit, which touches none of
my files) plus my 31 files. Nothing was committed or staged. The flag stays off by default. Every number below comes
from a command I ran in this session.

## 1. Files

| Path | What |
|---|---|
| `tools/assets/build-pipe.py` | **New.** `Kit_Lot_Pipe_01`: one 9 m segment of `pipes.ts addPipe()` (reads `PIPE` from `layout.ts`). |
| `tools/assets/build-footing.py` | **New.** `Kit_Lot_Footing_01`: `props.ts footing()` (reads `w`, `h`). |
| `tools/assets/build-floodtower.py` | **New.** `Kit_Lot_FloodMast_01` + `Kit_Lot_FloodLamp_01` (reads `FLOOD`, and the base / mast / head sizes from `floodTower()`). |
| `tools/assets/kitlib.py` | Shared half for the new scripts: `palette()`, `shelf_pack()` / `solve_atlas()`, `face_uv()`, `paint_faces()`, `poly_mesh()` (smooth groups), `box_faces()` / `box_polys()` (chamfered boxes), `rot_x/y/z`, `rot_g2b`. `build_kit` takes an optional rotation per collider (an `obb`). The container and bag wall rebuild **byte-identical** to HEAD's masters. |
| `tools/assets/validate-glb.mjs` | `COL_` may be an oriented box (`extras.collider = "obb"`, node rotation, the mesh an axis-aligned box in node space). New export `colliderObbs(doc)`. The `box` rule is unchanged: the broken container copy still fails with 30 errors. |
| `tools/assets/README.md` | Batch 1, kitlib's new helpers, oriented `COL_`. |
| `assets/masters/Kit_Lot_{Pipe,Footing,FloodMast,FloodLamp}_01{.glb,_baseColor.png,_normal.png,_orm.png}` | **New** masters and their 1024² PNGs. |
| `public/assets/kits/Kit_Lot_{Pipe,Footing,FloodMast,FloodLamp}_01.glb` | **New** web variants. |
| `assets/manifest.json` | Four new entries: `why`, sizes, budgets, provenance, licence, collision, Godot, `paint_mask`, and for the lamp `emissive`. |
| `src/client/assets/kit-glb.ts` | `LOT_KIT` table, `KitPlacement.pitch`, four splits, generic `splitLotKitPrims` / `createLotKitView` (section 5). |
| `src/client/world/world-view.ts` | Only the `?kit=glb` branch: a comment and the "any piece has placements" test. |
| `tests/unit/glb-lot-batch1.test.ts` | **New.** 28 tests. |
| `tests/unit/glb-bagwall-colliders.test.ts` | One assertion: the Lot split's prim count now adds the later pieces. |

## 2. The pieces

| Piece | LOD0 / 1 / 2 tris | Size (m) | Atlas | Master / web bytes | `COL_` |
|---|---|---|---|---|---|
| `Kit_Lot_Pipe_01` | 144 / 96 / 44 | 5.796 × 5.796 × 9 | 11 faces, 54.5 px/m outside, about 34 in the bore | 2,483,448 / 201,664 | 12 (4 box, 8 obb) |
| `Kit_Lot_Footing_01` | 182 / 70 / 14 | 3.56 × 1.4 × 3.2 | 75 faces, 126.4 px/m | 1,797,504 / 128,896 | 1 |
| `Kit_Lot_FloodMast_01` | 484 / 118 / 34 | 3.28 × 22 × 3.2 | 142 faces, 93.9 px/m | 1,889,936 / 203,792 | 2 |
| `Kit_Lot_FloodLamp_01` | 146 / 34 / 12 | 1.42 × 0.95 × 0.94 | 57 faces, 310.5 px/m | 1,559,004 / 96,840 | 1 |

- **Pipe.** A 12-sided tube, flat floor, crown and sides (`addPipe()`'s spin π/12), vertex radii 3.0 / 2.55, 9 m. The outer
  and inner facets lie on the sim's facet boxes. As on the client's lathe, only the outer rims have a 0.12 m chamfer
  (LOD0); the bore is the exact 12-gon, mouth to mouth. The barrel is smooth-shaded (welded around), rims and mouths hard.
  LOD2 is the barrel plus a dark cap over each mouth. Paint: cast concrete (aggregate, bug holes), mould seams, spigot
  grooves, two lifting anchors with rust halos, lime run-off, algae and mud low, a stencil, chipped rims, and an ochre spray
  arrow on the +x side. The bore has silt with a tide line, lime drips and algae. The bore's baked AO is lifted
  (0.75 + 0.25 ao) because the style already shuts the sky fill out of it.
- **Footing (the third piece).** Counted from the data (`createWorldData(1, 'the_lot')`, colliders inside each bookmark's
  view: 96° wide, 150 m deep; containers, bag walls, pipes and floodlights excluded; `scratchpad/pglb3/count-props.ts`):

  | Prop | `lot_corgi_base` | `lot_container_canyon` | Total |
  |---|---|---|---|
  | footing | 6 | 0 | **6** |
  | pallet stack | 1 | 4 (one inside c_west) | 5 |
  | ammo crate | 4 | 0 | 4 |
  | barrel / cone / cable drum | 0 / 0 / 1 | 4 / 4 / 3 | 4 each |

  The footing wins: all six stand in the base's foreground, 29-41 m out. Map-wide the pallet stack is commoner (17), so it
  is the natural batch-2 piece. The block has 6 cm arrises, board-formed sides, a trowelled top with `footing()`'s oil
  stain and two lifting anchors, and the two plywood panels on ±x with timber walers and tie-rod nuts.
- **Floodlight tower: two pieces.** The world data turns the lamp bar to each tower's aim (yaw 1.50 / -1.13 / 2.81 /
  3.14) and pitches every housing to its target (0.73 / 0.67 / 0.87 / 0.90 rad), while the ballast base stands square
  (yaw 0). One rigid GLB could equal none of the four towers' colliders. So:
  - `Kit_Lot_FloodMast_01`: the ochre ballast base with its checker plate and fork-pocket plates, the tapered mast
    (r 0.4 → 0.3, up to `FLOOD.mast` = 22 m), a flange with gussets, a junction box, a conduit, 18 step bolts, a collar,
    and an ochre band at 2.2 m. Yaw 0 at each `flood_base`.
  - `Kit_Lot_FloodLamp_01`: one housing with a visor, blinders, 5 rear fins, pivot bosses, a gland and a faceted
    reflector. At each `flood_head` collider: `T(centre) Ry(yaw) Rx(pitch) T(0, -0.475, 0)`.
  - The lamp bar (a plain 6.4 × 0.4 × 0.4 box) stays procedural: it turns but is not pitched.
- **Emissive.** The GLBs carry none. The sodium lens is lamps-view's `glow()` tube (`WorldData.lamps`), untouched, like the
  lights. A test proves every one of the 16 tubes sits on its housing's face centre, 1 cm proud of the +z face. `pbr()` does
  keep a source emissive, but the standard allows one material and three textures, so a lens-only emissive would need a
  fourth texture or a second material. This is recorded in the manifest (`emissive`).
- **Paint mask.** None of the three pieces is tinted per instance (all four towers share hazardOchre / gunmetal /
  camoBlack, and the pipes and footings are raw concrete and plywood). So, per the standard ("a piece that is never
  tinted has no alpha"), none carries one; the colours are baked from the palette at build time, as for the bag wall.
  This is the strict reading of the card's "paint mask where the piece has paint"; say if you want an inert mask on the
  tower's paint.
- **Mast collider.** The sim's mast is a cylinder (r 0.4, half height 10.4). Its `COL_` is that cylinder's bounding box,
  with `extras.sim_shape = "cyl"`, `sim_r`, `sim_hh`, because the standard has boxes only.

## 3. `lotInteriors()` and the bore (read this)

The card asks for a test that "the GLB bore's inner space contains each matching interior box". Geometrically it is the
other way round. P5's box is the bounding square of the bore's inscribed circle (± the inner apothem 2.4631 m across,
mouth to mouth along the axis). Its four long edges sit 3.48 m from the axis, beyond even the pipe's outer vertex radius
of 3.0 m. So no N-gon bore can contain it; that is P5's design (the style's feather lets light in only at box faces). What
`glb-lot-batch1.test.ts` proves, for every Lot pipe, seeds 1 and 7, master and web:
- every bore vertex (LOD0) lies inside its interior box (±1 cm): the tunnel's whole inner surface is where the sky fill
  is shut out;
- it is tight: the bore's extent on all three axes equals the box's (±1 cm): the floor, crown and both sides lie on the
  box's faces, and the mouths are its ends;
- the bore contains the box's inscribed cylinder: every inner facet's midline is at least the box's half width from the
  axis.

## 4. Acceptance

**Build + determinism.** Command: `<venv>/bin/python tools/assets/build-{pipe,footing,floodtower,container,bagwall}.py
--out <scratch>`. All 24 files (6 GLBs + 18 PNGs) are **byte-identical** to `assets/masters` (sha256). That covers the
container and bag wall too: kitlib's changes leave them as committed.

**Validator.** Command: `node tools/assets/validate-glb.mjs <glb>`. **PASS on all 12** (6 masters, 6 web variants,
including the older two). `break-glb.mjs` on the container still gives **FAIL (30)**.

**Godot 4.7.2 headless.** Command: `GODOT=<scratch>/pglb1/Godot_v4.7.2-stable_linux.x86_64 bash tools/godot/run.sh
assets/masters/<name>.glb`.
- All **6 masters** exit 0 with `GODOT IMPORT: PASS  RUNTIME: PASS`.
- The import logs have 0 error or warning lines.
- The AABBs are pipe (5.795555, 5.795555, 9.0), footing (3.56, 1.4, 3.2), mast (3.28, 22.0, 3.2) and lamp (1.42, 0.95,
  0.94); `COL_` counts are 12 / 1 / 2 / 1.

**`COL_` = sim, and the interiors.** `tests/unit/glb-lot-batch1.test.ts`, **28 passed**. For seeds 1 and 7, on the master and
on the web variant, every kit box placed as the client places it matches a sim box corner for corner within 1 cm, one to
one:
- the 96 `pipe` facet boxes (8 pipes × 12);
- the 6 `footing` boxes, with their yaw jitter;
- the 4 `flood_base` boxes and the 4 `flood_mast` cylinders' bounding boxes;
- the 16 `flood_head` boxes, with their yaw and pitch.

It also proves:
- the interiors (section 3);
- the sodium lenses on the housings;
- the splits: `missing = 0` for every piece, 8 / 6 / 4 / 16 placements, and the table taking nothing twice (`rest` + every
  piece = all prims; the 4 bars stay in `rest`);
- the West Yard has nothing to split.

**Budget: Lot 4v4 high.** Command: `PROBE_URL=http://localhost:5360/ node tools/perf-render.mjs --tiers high --query
'&mode=team-deathmatch&bots=4,4&t=0.68&map=the_lot'` [`&kit=glb`]. Draws / triangles:

| Run | Flag off | `?kit=glb`, per-instance LODs (first try) | `?kit=glb`, final (batch 1 LOD0 only) |
|---|---|---|---|
| 1 | 222 / 572,648 | 248 / 572,736 | **232 / 562,732** |
| 2 | 222 / 572,760 | 250 / 573,024 | **234 / 562,880** |
| `--objects` | – | – | 241 / 566,431 |

- The first try broke the budget: +12.6 % draws, because each of the four pieces drew up to 3 LOD meshes plus their
  shadows.
- **Fix:** batch 1 draws LOD0 at every distance (`KIT_LOD0_ONLY`). All 34 instances then cost about 6.5 k triangles (1,152 + 1,092 + 1,936 + 2,336),
  and each piece is one draw plus its shadow.
- **Final:** +4.5 / +5.4 % draws and −1.7 % triangles against flag-off (limit: 244). The `--objects` frame (bots moved)
  is 241 draws (+8.6 %).
- It attributes exactly 1 scene + 1 shadow draw to each batch-1 piece's LOD0 (`artifacts/p-glb3/perf-glb-objects/objects-high.txt`):
  lamps 2,336 tris, mast 1,936, pipe 1,152, footing 1,092. So the kit is really drawn.

**Trial tree.** `git archive HEAD` (`3bb5053`) plus the 31 files in `scratchpad/pglb3/files.txt`; `tools/check-boundaries.mjs`
equals HEAD's.
- `tsc --noEmit`: exit 0.
- `check-boundaries`: **BOUNDARIES: PASS**.
- `vitest run`: **140 files, 1200 passed, 4 skipped, exit 0** (600 s, next to the lead's own verify run).
- After a comment-only edit to `kit-glb.ts`, the tree was re-checked: every file equals the working copy (`cmp`), `tsc`
  exit 0, **BOUNDARIES: PASS**, and the four `glb-*` test files **57 passed**.

**Screenshots.** Taken with `tools/probe.mjs` at 1280×720 under SwiftShader on my Vite (:5360), 16 s each. I looked at
every one. They are in `artifacts/p-glb3/` (off = the same view without `&kit=glb`). Mean luma is from sharp greyscale.

| Shot | Query (after `labs/lot.html?webgl&hud=0&dummies=0&freeze`) | Luma (kit / off) |
|---|---|---|
| Pipeworks entrance, dusk: `pipes-dusk`, `-off` | `&t=0.74&pos=85.5,3.4,2.5&look=85.5,2.2,20&fov=62` | 47.0 / 47.7 |
| Pipeworks entrance, storm: `pipes-storm` | the same + `&wx=storm` | 33.2 |
| Inside the west tunnel: `pipemouth-bm`, `-off` | `&bm=lot_pipe_mouth&t=0.74` | 21.8 / 24.4 |
| Pipe close-up: `pipe-close`, `-off` | `&t=0.74&pos=75.2,2.4,9.5&look=79.5,2.8,14&fov=60` | 42.2 / 43.3 |
| Floodlight tower at night: `tower-night`, `-off` | `&t=0.92&pos=-70,6,-100&look=-85,17,-112&fov=60` | 7.0 / 7.2 |
| Tower head, dusk / night: `tower-head-dusk` (`-off`), `tower-head-night` | `&t=0.74` / `0.92` `&pos=-78,20.5,-108.5&look=-85,22.3,-112&fov=55` | 91.8 / 92.7 |
| Mast base: `mast-base` | `&t=0.74&pos=-78.5,3.2,-105.5&look=-85,2.2,-112&fov=55` | – |
| The third piece: `footing-base` (the base bookmark), `footing-close`, `-off` | `&bm=lot_corgi_base&t=0.74`; `&t=0.74&pos=-20,2.6,-104&look=-28,0.2,-111&fov=55` | 69.8 / 70.5 (close) |
| The canyon bookmark: `canyon` | `&bm=lot_container_canyon&t=0.74` | – |
| The perf frames | `perf-{off,glb,glb-lod0}-{1,2}/p2-high.png`, `perf-glb-objects/` | – |

## 5. `kit-glb.ts`

- `KitPlacement.pitch`: Euler `'YXZ'` after yaw, as the prims and colliders turn. `createKitView` composes
  `T · Ry(yaw) Rx(pitch) · S(1, 1, sz)`; the LOD distance is measured to the turned centre. With no pitch the matrices are
  as before.
- `KitSplit { rest, matched, placements, missing }` and `KitEntry { piece, split(data, prims) }`.
- `LOT_KIT` holds, in split order: container, bag wall, pipe, footing, flood mast, flood lamp.
- `splitLotKitPrims(data, table = LOT_KIT)` runs the table on what the entries before it left. It returns `rest` and
  `pieces`, plus P-GLB1b's `containers` / `bags` shapes.
- `createLotKitView` makes one `createKitView` per piece with placements. Each keeps its procedural stand-in until its
  GLB is drawn, and for good if the load fails (the `console.warn` path is unchanged).
- **The splits rebuild the procedural prims with the same builders and match them one for one:**
  - `splitPipePrims` works from the 8 `ring` prims (base = the axis − ro cos(π/12); turn = heading + π/2) and uses `addPipe()`;
  - `splitFootingPrims` works from the `footing` colliders and uses `footing()` with a flat height;
  - `splitFloodMastPrims` / `splitFloodLampPrims` work from the colliders and use `floodTower()`. Its height function gives
    the base's ground, and at the aim the ground that reproduces the pitch. The bar prim, found at its `flood_bar`
    collider, goes back to `rest`.
- Batch-1 `pbrOpts`:
  - concrete: `{ scratch: 0, detailBump: [0.003, 0.0006] }`;
  - tower: the defaults;
  - toon surfaces: `world` / `metal`.
- Exports kept: `splitContainerPrims`, `splitBagWallPrims`, `createContainerKitView`, `kitLodFor`, `KIT_*_PIECE`.

## 6. Look against the mood board (honest)

The mood board is a rainy industrial dock at dusk: rust, wet steel, sodium floodlights, cranes.

**Closer:**
- The tower head now reads as real floodlights: boxed housings with visors and blinders framing the sodium tubes, fins,
  bosses, and a collar and step bolts on the mast (`tower-head-dusk` vs `-off`).
- The mast base reads as a weathered hazard-ochre ballast block: chevron band, rust chips, fork pockets.
- The pipes up close read as cast concrete with chipped rims and aggregate, instead of flat blue-grey facets.
- The footings read as formwork-cast blocks with the panels left on.
- Values are unchanged: mean luma is within 1-2 % of flag-off in every outside shot.

**Still far:**
- At play distance the pipes' outside still reads blue. That is the sky fill × grey concrete (a lighting and palette
  call).
- The storm shot shows no visible wet response on the pipes at 15 m.
- **The tunnel interior is darker than flag-off: luma 21.8 vs 24.4 (−11 %) at `lot_pipe_mouth`.** Under `pbr()` inside a
  P5 interior only the shadowed key and ambient remain; there is no toon ramp floor. I lifted the bore's AO; the rest is a
  style change (for example `STYLE.pbr.shadeFloor` inside interiors), which the card puts out of scope.
- At night the towers are silhouettes in both looks; the heads' detail shows at dusk only.
- There are no cranes or dock water in these pieces.
- The toon `?kitlook=stylize` side of the new pieces got one shot, `pipe-close-stylize.png`: it loads with ink and no
  console error, and the bore is lighter than under `pbr()` (the ramp floor). The other pieces were not shot in toon.

## 7. Open risks

- **Standard extension:** `obb` `COL_` boxes. `docs/design/ASSET_PIPELINE.md` Standards should say so (it is lead-owned,
  so not edited). The pipe web variant's quantization puts a scale on those nodes; the validator accepts a turned,
  scaled box (still a box in node space).
- **The tower is two GLBs plus the procedural bar**, not one GLB (section 2). The lead may prefer another cut.
- **LOD0 only on the web.** LOD1 / LOD2 of batch 1 are unused in Three.js (kept for Godot and a far tier). The draw
  budget, not triangles, set this.
- **Budget headroom.** Final 232-234, and the `--objects` frame 241, against a limit of 244. Batch 2 needs the same
  care; merging pieces into shared instanced draws, or no shadows on small far pieces, are the next levers.
- **Interiors.** The wording of the test differs from the card (section 3); the tunnel is darker (section 6).
- **Atlas packing** is simple shelf packing. It leaves about 40 % of the footing's atlas and 20 % of the pipe's unused;
  a better packer would raise the texel density for free.
- **Shader cost** is unchanged in kind (`pbr()` as P-GLB1b), on 6 pieces now. GPU time was not measured (SwiftShader).
- **Load.** The trial suite ran next to the lead's own `cvc-verify` run (load average about 13); it passed first time.
- **Not run:** `e2e`, `npm run verify`.
- **Scope held.** Nothing changed in `src/sim`, `src/host`, `src/shared` or `src/client/style`. No GLB is referenced
  outside `src/client/assets`. `PROGRESS.md`, `ARCHITECTURE.md`, `KNOWLEDGE.md` and `docs/qa/*` were not touched. Nothing
  was staged or committed. Vite ran on :5360 only.

## 8. Trial-tree unit suite

`npx vitest run` in the trial tree (HEAD `3bb5053` + the 31 files): **Test Files 140 passed (140), Tests 1200 passed | 4
skipped (1204)**, 600 s, exit 0. It ran next to the lead's `cvc-verify` run (load average 11-13), with no failure and no
retry.
