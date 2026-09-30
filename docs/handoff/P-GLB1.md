# P-GLB1 (W11, pipeline-1): one Lot kit piece through the shared-GLB pipeline

**Card.** `Kit_Lot_Container20_01` is The Lot's 20 ft site-office container. It goes Blender (bpy) → master GLB →
validator → Godot 4 headless import → the game, behind `?kit=glb`, with an A/B against the current look.
The plan lock and the standards are in `docs/design/ASSET_PIPELINE.md`.

**Base.** HEAD `d2f3614` (the W11 lead commit). Nothing was committed or staged.

**Result.** Acceptance 1–6 are green. The numbers below come from commands run in this session. The flag stays off by
default.

## 1. Files

| Path | What |
|---|---|
| `tools/assets/build-container.py` | bpy 5.0.1: geometry, LOD0/1/2, 13 `COL_` boxes, the 1024² atlas, painted textures, Cycles AO bake, GLB export. It reads `CONTAINER` and `c_west`'s door from `src/shared/world/lot/layout.ts`. |
| `tools/assets/validate-glb.mjs` | The standards validator (CLI + `validateGlb()` / `colliderBoxes()` for tests). |
| `tools/assets/make-web-variant.mjs` | master → web variant (dedup, prune, WebP q84 / normal q92, meshopt medium), validates both, writes the manifest numbers. |
| `tools/assets/break-glb.mjs` | Writes a deliberately broken copy (defects: `scale pivot lodname col tris zup`). |
| `tools/assets/README.md` | The pipeline's commands. |
| `tools/godot/project.godot`, `validate_glb.gd`, `run.sh`, `.gitignore` | The minimal Godot 4 project: editor import (`--import`) + runtime `GLTFDocument` load + checks. Exits non-zero on failure. |
| `assets/masters/Kit_Lot_Container20_01.glb` + `_baseColor.png`, `_orm.png`, `_normal.png` | The master (PNG textures inside) and the three 1024² PNGs. |
| `assets/manifest.json` | Versions, budgets, sizes, sha256, triangle counts, bounds, provenance, licence, Godot results. |
| `public/assets/kits/Kit_Lot_Container20_01.glb` | The web variant (245,840 B). |
| `src/client/assets/kit-glb.ts` | New module: `kitFlag`, `lotContainerPlacements`, `splitContainerPrims`, `kitTint`, `createContainerKitView` (GLTFLoader from `three/addons` with the meshopt decoder, 3 InstancedMeshes, per-instance LOD, procedural fallback until loaded). |
| `src/client/style/style-webgpu.js` | New `pbr(gltfMaterial, opts)` + `StylePbrMaterial` (+ a private `StylePbrLightingModel`). `toon`, `glow` and `stylize` are unchanged. |
| `src/client/style/style-tokens.js` | New `STYLE.pbr` tokens. |
| `src/client/world/world-view.ts` | Only the `?kit=glb` branch: 11 lines. This is the file that draws the containers (as merged prims). |
| `tests/unit/glb-container-colliders.test.ts` | 10 tests. |
| `tests/unit/glb-validate.test.ts` | 10 tests. |
| `package.json` | devDependencies only: `@gltf-transform/core`, `/extensions` and `/functions` 4.5.1, `meshoptimizer` ^1.3.0, `sharp` ^0.35.5. `package-lock.json` changed with them: npm also raised the root `meshoptimizer` from 1.1.1 to 1.3.0. |

## 2. The asset

- **Size.** The container is in world metres at the game's pet scale. The body is `CONTAINER` (9.6 × 10.4 × 24 m),
  which is a real 20 ft box (2.44 × 2.59 × 6.06 m) scaled ×4. The LOD0 bounds are 10.26 × 10.46 × 24.2 m, with the proud
  door leaf, rails and castings. It is +Y up, the front (the open end) faces +Z, and the pivot is the base centre.
- **Door and yaw.** The door is on +x, 7 m toward +z, like `c_west`. `c_east` is the same piece turned π; the placements
  read the turn from the door collider's side.
- **LODs.** LOD0 has **612** triangles, with chamfered posts, castings, rails and door frame, door locking bars, and lamp
  housings. LOD1 has **252** (plain boxes). LOD2 has **122** (shell, door, posts, windows).
- **`COL_` boxes.** There are 13 `COL_Kit_Lot_Container20_01_<n>` boxes: floor, roof, 3 walls + lintel, door leaf,
  4 posts, 2 headers. They are the sim's boxes, taken from `props.ts container()`'s formulas, with
  `extras.collider = "box"` and no material.
- **Textures.** The textures are 1024² baseColor (sRGB), ORM (R occlusion, G roughness, B metalness) and normal
  (OpenGL +Y). Each of the 146 visible faces has its own atlas rectangle, at 22.22 px/m × a density weight per surface
  kind. The atlas uses landscape shelf packing with 90° UV turns for tall faces and 4 px painted gutters. Chamfers share
  one worn-steel block.
- **Painting and bake.** The paint is weathered corrugated steel: 21 side ribs, sun fade, a dirt band at the foot,
  run-off streaks, rust patches and rust streaks, and chips. The roof has transverse ribs and stains. The floor is
  plywood planks. There is a hazard eaves band, windows, and casting apertures. The occlusion is a Cycles AO bake
  (48 samples, 4 m, LOD0 on a ground plane), and it is multiplied lightly into the base colour too.
- **Paint colour.** The paint is a neutral light grey (`KIT_PAINT_SRGB`). In the game, each instance is tinted to its
  world palette colour (`garageSiding2` for c_west, `hull` for c_east) as a linear ratio.

## 3. Acceptance

**1 — Deterministic build.** Command: `<venv>/bin/python tools/assets/build-container.py` (about 40 s). Its output:
`atlas: 146 faces, 22.22 px/m`, `LOD0: 612 / LOD1: 252 / LOD2: 122 triangles`, `AO bake: mean 0.630`.
- Two builds into separate folders gave **byte-identical** GLB and PNGs (sha256 compared).
- The master is 2,350,164 B, sha256 `9b2aab23…a74` (full hashes in the manifest).
- No `.blend` is written.

**2 — Validator.** Command: `node tools/assets/validate-glb.mjs <glb>`.

| File | Result |
|---|---|
| master | **PASS** (exit 0) |
| web variant | **PASS** (exit 0): 245,840 B ≤ 600 KB; WebP baseColor 81,412 B, ORM 102,712 B, normal 23,578 B; `EXT_meshopt_compression`, `EXT_texture_webp`, `KHR_mesh_quantization` |
| broken copy (below) | **FAIL (30), exit 1** |

The broken copy comes from `node tools/assets/break-glb.mjs assets/masters/Kit_Lot_Container20_01.glb /tmp/broken.glb`.
The validator listed, among the 30 failures:
- the root transform (the ×100 centimetre export);
- the missing `_LOD1`;
- the LOD0 rotation (Z-up);
- LOD2 at 366 tris > 200;
- the pivot (y = −1210, x = 200);
- the size against the manifest on all three axes;
- the `COL_` box rotated, with a material, and not axis-aligned.

`tests/unit/glb-validate.test.ts` fails each of the six defects on its own.

The rules checked are the ones in `ASSET_PIPELINE.md` Standards:
- names;
- root without a transform;
- ground contact centred and on y = 0 (±1 cm);
- size = manifest `size_m` ±5 cm (this also pins +Y up / front +Z);
- LOD budgets, and each LOD cheaper than the one before;
- `COL_` = material-less axis-aligned boxes;
- ORM packing;
- 1024² square power-of-two textures;
- master PNG with no compression, versus web meshopt + WebP ≤ 600 KB.

**3 — Godot 4 headless.** Godot is **4.7.2.stable.official.ed1daf0bf**, the newest 4.x stable on GitHub (4.8 has no
release). Command: `GODOT=<bin> bash tools/godot/run.sh assets/masters/Kit_Lot_Container20_01.glb`, **exit 0**.
- Both loads print the tree: root, 13 `COL_` MeshInstance3D (12 tris each), and LOD0/1/2 at 612 / 252 / 122 tris.
- Both print `LOD0 AABB (m): position (-4.96, 0.0, -12.1) size (10.26, 10.46, 24.2)`, `LODs: 3  COL_: 13  materials: 1`
  and `StandardMaterial3D: albedo 1024x1024 normal yes roughness yes metallic yes ao yes`.
- Final line: `GODOT IMPORT: PASS  RUNTIME: PASS`.

The web variant is **rejected** (exit 1, by both the import and the runtime load): "required extension
EXT_meshopt_compression is not supported" and "KHR_mesh_quantization is not supported". A WebP-only copy (no meshopt
or quantization) passes, so WebP is fine. This is recorded in `assets/manifest.json` → `godot`: Godot imports the
master, and the web variant is Three.js-only.

**4 — In the game.** `?kit=glb` on The Lot builds 2 placements from the world data's own colliders:
- the floor slab gives the base centre;
- the door side gives the yaw.

The 3 LOD InstancedMeshes draw at those placements. `splitContainerPrims` removes exactly the procedural containers'
prims: it rebuilds them with `props.ts container()` and matches them one for one, with `missing = 0`. The pallet cover
inside the containers stays. `tests/unit/glb-container-colliders.test.ts` proves that the GLB's 13 `COL_` boxes, placed
at both containers (yaw 0 and π), equal the sim's 13 `container_*` colliders **within 1 cm**. It checks every box,
both ways, for seeds 1 and 7, on the master and on the web variant (quantized).

**5 — Screenshots and budget.** All were taken with `tools/probe.mjs` on my Vite (:5330; HEAD tree on :5331), 1280×720,
SwiftShader, and I looked at every one.

| Shot | File | Draws / tris (lab) |
|---|---|---|
| Procedural, flag off (the unchanged code path) | `artifacts/p-glb1/canyon-head.png` | 96 / 372,643 |
| Procedural, HEAD tree (`git archive HEAD`) | `artifacts/p-glb1/canyon-head-tree.png` | 96 / 372,643 (identical draws; pixels differ by mean 4.8/255, from cloud drift) |
| GLB through `stylize()` | `artifacts/p-glb1/canyon-stylize.png` | 93 / 365,179 |
| GLB through `pbr()` | `artifacts/p-glb1/canyon-pbr.png` | 92 / 363,955 |
| Close-up, `pbr()`, the door side of c_west | `artifacts/p-glb1/closeup-pbr.png` | 68 / 215,983 |

- The bookmark is `labs/lot.html?webgl&bm=lot_container_canyon&t=0.74&freeze&hud=0&dummies=0` + `&kit=glb`
  [`&kitlook=stylize`].
- The close-up is `&pos=-83.5,3.2,-19&look=-91,4.5,-27&fov=60`.

**Look notes.** Mean luma: HEAD tree 47.6, `stylize()` 43.9, `pbr()` 44.2, close-up 57.4.
- **Values.** The three bookmark shots read with the same values: c_west's lane wall catches the cool sky fill, and
  c_east stands in its shade, as in HEAD.
- **`pbr()`.** It adds the corrugation (normal map), rust patches and streaks, the hazard band, the window, and the
  door with its locking bars. It has no ink.
- **`stylize()`.** It keeps the colour map with the toon ramp and the ink hull. It is flatter, with no normal map.
- **Close-up.** The ribs, frame chamfers and rust read clearly. The lit wall is a strongly saturated blue: the cool
  fill × the `garageSiding2` tint. The rust reads dark brown rather than orange at dusk.

**perf-render, The Lot live 4v4 TDM, high.** Command: `--tiers high --query '&mode=team-deathmatch&bots=4,4&t=0.68&map=the_lot'`,
same server; the flags were appended to the query. Draws / triangles:

| Tree | Run 1 | Run 2 | vs P5 232 (+10 % = 255) |
|---|---|---|---|
| flag off | 227 / 573,639 | 230 / 577,494 | – |
| `?kit=glb` (pbr) | 232 / 568,589 | 230 / 565,008 (third run, `--objects`: 236 / 571,779) | ✓ max 236 (+1.7 %) |
| `?kit=glb&kitlook=stylize` | 230 / 569,993 | 235 / 569,924 | ✓ max 235 (+1.3 %) |

- Live frames vary with the bots. P4 saw 252–268 on one tree.
- The GLB replaces about 4.5 k procedural triangles per container. The kit adds at most 3 instanced draws (one per
  visible LOD) plus shadows. Triangles fall.
- **The kit is really drawn in the measured frames.** The `--objects` run (`artifacts/p-glb1/perf-pbr-objects/objects-high.txt`)
  attributes `world/Kit_Lot_Container20_01_LOD1|StylePbrNodeMaterial` 1 scene draw + 1 shadow draw, 504 tris each
  (2 instances × 252). The procedural fallback was gone.
- Every row is under P5's 587 k triangles.
- The `perf-*/p2-high.png` shots are the live views.

**6 — Trial tree.** The tree is `git archive HEAD` (`d2f3614`) plus my files only. `tools/check-boundaries.mjs`,
`.gitignore` and `.gitattributes` were copied from the working tree; they equal HEAD.
- `tsc --noEmit`: exit 0.
- `check-boundaries`: **BOUNDARIES: PASS**.
- `vitest run`: **135 files, 1145 passed, 4 skipped, exit 0** (1082 s under load).
- The two new test files alone take 3.6 s.

## 4. `pbr(gltfMaterial, opts)`: the contract change

`pbr()` returns a cached `StylePbrMaterial` (a `MeshStandardNodeMaterial`, `userData.style = 'pbr'`).

**What it keeps from the source:**
- `map`, `roughnessMap`, `metalnessMap`, `aoMap` and `normalMap`, with their factors;
- the emissive, the side, and the vertex colours.

**What it adds from the rig:**
- **Sky reflection.** The fake sky reflection (`STYLE_ENV` by the reflected, normal-mapped direction, Fresnel and
  roughness, storm-dimmed). Without it, metal reads black: the style has no env map.
- **Weather.** `STYLE_WEATHER.wet` darkens the albedo and drops the roughness toward a sheen; up-facing surfaces soak
  most (`STYLE.wet` constants).
- **Interiors.** The W10 P5 interiors: the sky-fill light is shut out of `WorldData.interiors`.
- **Post.** Exposure, bloom and grade are the post chain's, as for everything else.

**Not a toon material:** no ink hull, no ramp.

**Tokens:** `STYLE.pbr = { env, wetK, normalScale, aoIntensity, interiors }`.

## 5. Open risks

- **Texel density.** It is about 22 px/m on a 24 m piece at 1024², so up close the texels are soft. The normal-map ribs
  hold. The fix is 2048² (the hero budget) or a tiling trim strip; that is the lead's call.
- **Colour.** The per-instance tint multiplies the whole albedo, rust and frame included; c_west's cool-lit wall reads
  as a saturated blue. A paint mask, for example in the baseColor alpha, would tint only the paint.
- **`pbr()` in shade.** Shade sides are darker under `pbr()` than under toon (no ramp floor). If the owner picks PBR, the
  knobs are `STYLE.pbr.env` / `aoIntensity` or a wrap term.
- **Async load.** The GLB loads asynchronously, in about 3–6 s under SwiftShader. The procedural containers draw until
  then, and they stay if the load fails (with a `console.warn`).
- **Lab stats.** `labs/lot.ts` snapshots the world stats at frame 3 and every 30 frames, so a probe's `DEBUG` can show
  `kitLoaded: 0` although the GLB is drawn.
- **`stylize()` side.** On the instanced meshes it has no crease ink (`stylize` skips InstancedMesh creases), and the
  toon model ignores ORM and normal.
- **Godot.** Godot 4.7.2 cannot read the web variant (meshopt + quantization). The master is the Godot file by design.
- **Dependencies.** `sharp` brings a native libvips binary (`@img/sharp-linux-x64`) into devDependencies.
  `package-lock.json` grew by about 770 lines.
- **Build output.** `public/` is new, so `vite build` copies the 246 KB GLB into `dist/`. It is fetched only with
  `?kit=glb`.
- **Not run.** `e2e` and `npm run verify` were not run (the card asks for tsc, boundaries and the unit suite).
- **Scope held.** Nothing changed in `src/sim`, `src/host` or `src/shared`, and no `.glb` is mentioned there.
- **Lead-owned files.** `PROGRESS.md`, `ARCHITECTURE.md`, `KNOWLEDGE.md` and `docs/qa/*` were not touched.
