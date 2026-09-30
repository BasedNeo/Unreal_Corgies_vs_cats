# P-GLB1b (W11, pipeline-1b): the container's look risks, and the adjoining kit piece

**Card.** Fix P-GLB1's open look risks on `Kit_Lot_Container20_01` (texel density, paint mask, rust, wet response, shade
side) without breaking a standard or a budget. Then put the Lot prop that most often stands next to the containers through
the same pipeline, behind the same `?kit=glb` flag. Plan lock and standards: `docs/design/ASSET_PIPELINE.md`. Base:
P-GLB1 at `25dcd63`; the trial tree is HEAD `3b3b41b` (W10 INT10, which touches none of these files) plus my files.
Nothing was committed or staged. The flag stays off by default.

Every number below comes from a command I ran in this session.

## 1. Files

| Path | What |
|---|---|
| `tools/assets/kitlib.py` | **New.** The shared half of the kit builds: seeded noise, meshes, the PBR material, the Cycles AO bake, `COL_` boxes, glTF export. It writes the paint mask into the baseColor alpha. |
| `tools/assets/build-container.py` | Uses kitlib. New paint: a **paint mask**, and rust as **edge wear + run-off streaks** (section 2). Geometry, LODs, atlas and `COL_` are unchanged. |
| `tools/assets/build-bagwall.py` | **New.** `Kit_Lot_BagWall_01` (section 3). |
| `tools/assets/README.md` | Two pieces, kitlib, and the paint mask. |
| `assets/masters/Kit_Lot_Container20_01*.{glb,png}` | Rebuilt. |
| `assets/masters/Kit_Lot_BagWall_01*.{glb,png}` | **New.** |
| `public/assets/kits/Kit_Lot_Container20_01.glb`, `Kit_Lot_BagWall_01.glb` | Web variants. |
| `assets/manifest.json` | Container v2 (`paint_mask`, provenance). New bag-wall entry: `why`, sizes, budgets, provenance, licence. |
| `src/client/style/style-webgpu.js` | `pbr()` gets the Stage 6 layer and `StylePbrLightingModel` gets wrap + floor (section 4). A private `interiorOpenGeometry` is added. `toon`, `glow` and `stylize` are unchanged, and so is `interiorOpen`, which is now built by the same helper with the same normal. |
| `src/client/style/style-tokens.js` | `STYLE.pbr` only. |
| `src/client/assets/kit-glb.ts` | Generalised for two pieces (section 5). |
| `src/client/world/world-view.ts` | Only the `?kit=glb` branch (the import and 4 lines). |
| `tests/unit/glb-bagwall-colliders.test.ts` | **New.** 8 tests. |
| `docs/design/ASSET_PIPELINE.md` | Standards: the paint-mask channel line. |

## 2. The container's look risks

- **Paint mask.** It is in the GLB as the **baseColor alpha**: 1 is paint, 0 is rust, grime, frame, door, glass and floor.
  - It is stored as `1 + 254 × mask`, so no texel has alpha 0. A lossy WebP encoder may rewrite the colour under alpha 0.
  - I checked the web variant: alpha ranges 1–255, and the mean RGB under the 660,579 low-alpha texels is 50.0 in the
    PNG and 50.1 in the WebP.
  - The material stays `OPAQUE`. Blender keeps the straight alpha and RGB (tested before use), and Godot ignores it.
  - Under `pbr({ paintTint: true })`, each instance's `paintTint` (a per-instance attribute) multiplies the albedo only
    through the mask. The toon side (`?kitlook=stylize`) still tints the whole albedo with `instanceColor`, as before.
  - Mask mean: 0.285.
- **Rust.** The isotropic `rust_p` patches are gone.
  - Edge wear rusts the foot, climbing each valley by its own amount. It also rusts the eaves under the rail, the corners
    at the posts, and the face borders of frames and door.
  - Thin run-off streaks hang from drip sources: the top rail, the window sills and the door head. They thin out and
    break up as they run down, and are strongest in the corrugation valleys. Broader dirt run-off follows the same sources.
  - Paint chips sit mostly low on the wall, on crests and near edges. Horizontal scrapes appear at knock height.
  - The chamfer block is rusty worn steel instead of bright steel.
- **Texel density.** This is the non-destructive Stage 6 layer in `pbr()`; the GLB stays at 1024² and about 22 px/m. It
  uses world-space noise at 3.1 /m and 23 /m (world metres, because the web variant's quantized geometry is not in metres) for:
  - a bump (4 mm dents, 0.7 mm grain), with Mikkelsen's surface gradient on unnormalized derivatives, so it keeps its
    size in metres at every distance;
  - ±7 % albedo mottling and ±0.08 roughness breakup;
  - micro-scratches on the paint only (contour lines of a stretched noise, in patches).

  Everything fades out once a pixel covers a good part of a wavelength. I did not choose a trim strip, because it would
  need a new UV layout, a rebake and a new atlas budget, and the look risk is up close only.
- **Wet.** The wet response uses `STYLE_WEATHER.wet` and `.rain`:
  - porous (rough) texels darken most, and painted steel mostly gains gloss;
  - the roughness falls toward a sheen;
  - while it rains, rivulets run down walls (dark, roughness 0.06);
  - puddles form on flat tops (roughness 0.035, a flat normal, albedo × 0.3);
  - sheltered interiors stay dry (the interior test uses the geometry normal to avoid a node cycle).
- **Shade side.** This is tuned only through `STYLE.pbr`:
  - `wrap` 0.5 applies `max(saturate((N·L + w)/(1 + w)), floor)`, which tracks the toon ramp's half-lambert;
  - `shadeFloor` 0.14 equals `bandFloor` on faces turned away from the unshadowed sky fill;
  - `aoIntensity` goes from 1.0 to 0.6, because the bake is also in the albedo.

  I measured the mean luma of c_west's shaded lower west wall (`shade` bookmark below, region 320×120 px):

  | Look | Mean luma |
  |---|---|
  | toon | 27.4 |
  | HEAD `pbr()` | 18.0 (−34 %) |
  | `pbr()` with wrap + AO only | 18.5 |
  | `pbr()` with the floor | **30.0 (+9 %)** |

  `a3-shade.png` was taken before the detail layer moved to world metres. That move changes the noise only; the
  lighting knobs measured here have not changed since.

## 3. The adjoining piece: `Kit_Lot_BagWall_01`

- **Why this piece.** From the data (`createWorldData(1, 'the_lot')`):
  - within 6 m of a container footprint stand only the gangway (c_east's own access), the pallet stack inside c_west,
    and the two canyon-mouth bag walls, at **5.4 and 5.9 m**;
  - in the hero views, `lot_container_canyon` has 2 bag walls as its foreground, and `lot_corgi_base` has 3;
  - there are 8 walls on the map, all built by `props.ts bagWall()`;
  - the pallet stack inside c_west is closer (0 m), but it is hidden inside the container and is a single box.
- **The piece.** It is one 4.8 m module of 5 sacks: row 0 has two full sacks; row 1 has a half, a full and a half.
  - `D`, `BH` and the 2.4 m nominal sack length are read from `props.ts`.
  - Each sack is a superellipsoid, flattened where it rests, bulging at the sides and pinched at the tied ends, with fold
    and wrinkle displacement.
  - Budgets: **LOD0 1760, LOD1 400, LOD2 96** triangles.
  - Each sack has its own 512×256 atlas slot, about **123 px/m** (5.5× the container). The slots carry woven fibre,
    stitched folded ends, a printed stencil band, mud and tide marks on the lower row, and dust.
  - AO is baked over 1.2 m. The piece has no paint mask: it is never tinted.
  - The ground contact is centred by a −16.5 mm x shift.
- **In the game.** A wall of length `len` is drawn as `m = round(len / 4.8)` modules, each stretched along z by
  `len / (m × 4.8)`, which is 0.90–1.15 on The Lot. This matches `bagWall()`, which itself stretches its sacks. That
  gives 8 walls and 16 modules. The procedural wall prims are removed one for one: `bagWall()` is rebuilt from each
  `bags` collider, with `missing = 0`.

## 4. `pbr()` contract additions

`pbr(src, opts)` keeps P-GLB1's behaviour and adds new `STYLE.pbr` keys:
- `wrap`, `shadeFloor`
- `paintTint` (per call)
- `detailFreq`, `detailBump`, `detailAlbedo`, `detailRough`
- `scratch`, `scratchFreq`
- `rivulets`, `puddle`

`aoIntensity` now defaults to 0.6. `PBR_PAINT_TINT = 'paintTint'` names the attribute. The bag wall passes
`{ scratch: 0, rivulets: 0, puddle: 0, detailBump: [0.006, 0.001], detailRough: 0.05 }`.

## 5. `kit-glb.ts`

- A `KitPiece` holds `name`, `url`, `lodDist`, `centreY`, `paintTint`, `pbrOpts` and `toonSurface`.
- `createKitView(piece, { prims, placements }, look)` is the old container view made generic, with the per-instance z
  stretch `sz`.
- `matchPrims` holds the prim matching.
- For bag walls: `lotBagWalls`, `bagWallModules` and `splitBagWallPrims`.
- `splitLotKitPrims` and `createLotKitView` bundle the two pieces for world-view. `stats()` sums them and adds
  `kitTriangles_<name>`.
- The bag LODs switch at 30 and 80 m.
- P-GLB1's exports are kept, so its test passes unchanged: `splitContainerPrims`, `createContainerKitView`,
  `kitLodFor` (+ `kitLodAt`).

## 6. Acceptance

**Build.** Command: `<venv>/bin/python tools/assets/build-container.py` and `build-bagwall.py` (about 27 s each).
- Container: LOD0/1/2 **612 / 252 / 122** triangles (unchanged). The atlas is 22.22 px/m, the AO mean 0.630 and the
  paint-mask mean 0.285. The master is 2,551,644 B.
- Bag wall: **1760 / 400 / 96** triangles and an AO mean of 0.439. The master is 2,302,936 B.
- **Deterministic:** I rebuilt both into scratch, and all 8 files (2 GLB + 6 PNG) are byte-identical (sha256).

**Validator.** Command: `node tools/assets/validate-glb.mjs <glb>`.

| File | Result | Bytes |
|---|---|---|
| container master | PASS (exit 0) | 2,551,644 |
| container web | PASS | 329,464 (P-GLB1: 245,840; the alpha channel and the new paint; under 614,400) |
| bag-wall master | PASS | 2,302,936 (size 1.7734 × 1.1009 × 4.8622 m) |
| bag-wall web | PASS | 216,384 |
| broken copy (`break-glb.mjs`), container | **FAIL (30), exit 1** | |
| broken copy, bag wall | **FAIL (18), exit 1** | |

**Godot 4.7.2 headless.** Command: `GODOT=<bin> bash tools/godot/run.sh assets/masters/<name>.glb`. Both masters exit 0
with `GODOT IMPORT: PASS  RUNTIME: PASS`.
- Container: `LOD0 AABB (m) size (10.26, 10.46, 24.2)`, `LODs: 3  COL_: 13`.
- Bag wall: `size (1.773397, 1.100932, 4.862167)`, `LODs: 3  COL_: 1`.
- Both: `StandardMaterial3D: albedo 1024x1024 normal yes roughness yes metallic yes ao yes`.
- The import logs have no error or warning lines.

**`COL_` = sim.** `tests/unit/glb-bagwall-colliders.test.ts` (8 tests) covers seeds 1 and 7, on the master and on the
web variant:
- the kit box, placed module by module exactly as the client places it (T · R(yaw) · S(1, 1, sz)), tiles every one of
  the 8 walls' `bags` boxes within 1 cm: across the wall, height, both ends, and consecutive modules touching;
- `splitBagWallPrims` has `missing = 0`, and `splitLotKitPrims` takes nothing twice.

P-GLB1's container test passes unchanged against the rebuilt GLBs. The three GLB test files give **29 passed**.

**Budget: Lot 4v4 high.** Command: `perf-render --tiers high --query '&mode=team-deathmatch&bots=4,4&t=0.68&map=the_lot'`
[`&kit=glb`], on my Vite (:5340). Draws / triangles:

| Run | Flag off | `?kit=glb` (pbr, both pieces) |
|---|---|---|
| 1 | 232 / 574,631 | 237 / 562,722 |
| 2 | 229 / 573,114 | 235 / 563,885 |

The kit's maximum is **237 draws, +2.2 %** on the flag-off maximum of 232, and triangles fall by 1.6–2.1 %. The flag
adds up to 3 instanced draws per piece (one per visible LOD) plus shadows, and removes about 4.5 k procedural triangles
per container. The shots are in `artifacts/p-glb1b/perf-{off,glb}-{1,2}/p2-high.png`.

**Trial tree.** The tree is `git archive HEAD` (`3b3b41b`) plus exactly the 21 files of section 1 (the list is in
`scratchpad/pglb1b/files.txt`).
- `tsc --noEmit`: exit 0.
- `check-boundaries`: **BOUNDARIES: PASS**.
- `vitest run`: **136 files, 1154 passed, 4 skipped, exit 0** (905 s under load). This ran on the final files.

**Screenshots.** All were taken with `tools/probe.mjs` at 1280×720 under SwiftShader, and I looked at every one. The
bookmark is `labs/lot.html?webgl&bm=lot_container_canyon&t=0.74&freeze&hud=0&dummies=0&kit=glb`. "Before" is P-GLB1
on a `git archive HEAD` tree (:5341); "after" is my tree (:5340).

| Shot | Before | After |
|---|---|---|
| canyon t 0.74 | `artifacts/p-glb1b/before-canyon.png` | `after-canyon.png` |
| close-up `&pos=-83.5,3.2,-19&look=-91,4.5,-27&fov=60` | `before-closeup.png` | `after-closeup.png` |
| rain (canyon, `&wx=rain`) | `before-rain.png` | `after-rain.png` |
| rain close-up (close-up + `&wx=rain`) | – | `after-rainclose.png` (rivulets, the wet darkening and sheen read here) |
| bag close-up `&pos=-84.3,1.5,-53.0&look=-81.5,0.55,-49.4&fov=50` | `before-bags.png` (procedural) | `after-bags.png`, `after-bagsrain.png` |
| shade (c_west's west wall) `&pos=-114,3.2,-12&look=-100,4.5,-28&fov=60` | `before-shade.png` | `a3-shade.png` (pbr); `a2-shadest.png` (toon) |

Mean luma (my `luma.mjs`), before → after:
- canyon: c_east's lane wall 37.0 → 42.1; c_west's lit lane wall 83.6 → 89.9; the whole frame 44.2 → 43.9;
- the left bag wall: 43.3 (procedural toon) → 35.0 (GLB);
- shade: section 2.

## 7. Look against the mood board (honest)

The mood board shows a photoreal armoured corgi on a rainy industrial dock at dusk, with wet asphalt, rust, sodium
floodlights and cranes.

**Closer:**
- The container reads as a weathered steel box, not a clean blue prop with brown polka dots:
  - rust sits where it belongs: a scalloped foot climbing the valleys, eaves under the rail, corners, and frame and door edges;
  - thin run-off streaks hang from the rail, the sills and the door head;
  - the tint no longer turns the rust and frame blue, and the rust reads brown at dusk.
- The world-space detail breaks up the flat 22 px/m wall up close: faint dents in the rib highlights, mottling and grain.
- The bag walls are now soft woven sacks with pinched, stitched ends, a printed stencil and mud on the lower row, instead
  of bevelled boxes. They are the nearest objects in the canyon hero shot.
- PBR shade sides are no longer black next to the toon world: +9 % against toon, where HEAD was −34 %.

**Still far:**
- The palette: `garageSiding2` × the cool sky fill is a saturated blue that the mood board never has. That is a palette
  and lighting call, not an asset one.
- The ground: flat pale-grey dirt, not wet asphalt that mirrors the sodium lights.
- Real rain on the steel: in the canyon shot the wetness and rivulets barely register at 20–30 m. Under SwiftShader the
  sodium floodlights do not glint on these walls in any shot.
- Resolution: 1024² over a 24 m box is still soft at 3 m; the detail layer is procedural noise, not scanned grime.
- Silhouette: the shells are plain boxes (no dents in the geometry, no door hardware).
- The non-kit props around the kit pieces stay toon with ink, so the canyon mixes two languages until the owner picks
  one.

## 8. Open risks

- **The look call.** It is still the owner's A/B: toon ink vs `pbr()`. The flag stays off.
- **Quantized geometry.** The web variant's `KHR_mesh_quantization` puts the dequantization on the node. That is why the
  detail layer uses world metres (`positionWorld`); `positionGeometry` is not metres in the web GLB. A moving kit piece
  would see its detail swim; none of the Lot's kit pieces move.
- **Stretched modules.** Bag modules are stretched 0.90–1.15 along z (as `bagWall()` stretches its sacks). The 11 m pit
  wall is 2 modules at 1.146, and its sacks read about 15 % long.
- **Shader cost.** `pbr()` now evaluates up to 5 noise lookups per pixel (2 detail, scratches, rivulets, puddles) plus
  the interior loop. Draws and triangles are measured; GPU time is not (SwiftShader). Measure on a real GPU before
  shipping.
- **Toon side.** `?kitlook=stylize` still tints the whole albedo (`instanceColor`). The toon model ignores the mask, ORM
  and normal.
- **`aoIntensity` is global.** The 1.0 → 0.6 change applies to every `pbr()` material. Only the two kit pieces use
  `pbr()` today.
- **Test flake under load.** In the first trial run (on an earlier revision, stopped and restarted on the final files), one test failed:
  `interact-yard.test.ts` ("runs the layer cheaply") at 0.9069 ms/tick against a load-scaled budget. That run shared
  the machine with another lane's full suite and two SwiftShader jobs (load ≈ 17). It is a sim timing test; none of my
  files touch the sim. It passed in the final run.
- **Shots under load.** Three probes timed out on `page.screenshot` (30 s) under the same load and were retried. Only
  shots that completed are listed.
- **Not run.** `e2e` and `npm run verify` were not run.
- **Scope held.** Nothing in `src/sim`, `src/host` or `src/shared` changed. `PROGRESS.md`, `ARCHITECTURE.md`,
  `KNOWLEDGE.md` and `docs/qa/*` were not touched. Nothing was staged or committed. `tools/assets/__pycache__/` (from the
  kitlib import) is gitignored and was removed.
