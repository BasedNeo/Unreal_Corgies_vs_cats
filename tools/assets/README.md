# tools/assets: the shared-GLB pipeline (W11 P-GLB1, P-GLB1b, P-GLB3)

Plan and standards: `docs/design/ASSET_PIPELINE.md`. One authored asset ends as one master GLB (PNG textures, what
Godot imports) and one web variant (meshopt + WebP, what Three.js loads), both listed in `assets/manifest.json`.

| Step | Command | Output |
|---|---|---|
| Blender (bpy) | `python3 -m venv <scratch>/bl && <scratch>/bl/bin/pip install bpy==5.0.1` (Python 3.11, about 400 MB), then `<scratch>/bl/bin/python tools/assets/build-<piece>.py` (container, bagwall, pipe, footing, floodtower; 15-30 s each) | `assets/masters/<name>.glb` and its three 1024² PNGs |
| Web variant + manifest numbers | `node tools/assets/make-web-variant.mjs assets/masters/<name>.glb` (the manifest entry must exist) | `public/assets/kits/<name>.glb`, `assets/manifest.json` (files, sizes, sha256, tris) |
| Validate | `node tools/assets/validate-glb.mjs <file.glb>` (exit 0 PASS, 1 FAIL) | the report and every broken rule |
| Prove the validator fails | `node tools/assets/break-glb.mjs <in.glb> <out.glb> [scale pivot lodname col tris zup]`, then validate `<out.glb>` | a copy with the chosen defects |
| Godot 4 | `GODOT=<Godot_v4.x binary> bash tools/godot/run.sh <file.glb>` | editor import + runtime load, tree / AABB / LODs / materials, exit 0 / 1 |

- **Pieces.** `Kit_Lot_Container20_01` (`build-container.py`) and `Kit_Lot_BagWall_01` (`build-bagwall.py`, one 4.8 m
  module of `props.ts bagWall()`; the game tiles and stretches modules along each wall). `kitlib.py` is their shared
  half: noise, meshes, the PBR material, the Cycles AO bake, the `COL_` boxes and the export.
- **Batch 1 (P-GLB3).** `Kit_Lot_Pipe_01` (`build-pipe.py`: one 9 m segment of `pipes.ts addPipe()`, the Pipeworks
  tunnels), `Kit_Lot_Footing_01` (`build-footing.py`: `props.ts footing()`), and the floodlight tower as two pieces,
  `Kit_Lot_FloodMast_01` + `Kit_Lot_FloodLamp_01` (`build-floodtower.py`: the base stands square, the housings turn and
  pitch per tower). kitlib gained the generic half they share: `palette()`, `solve_atlas()` / `shelf_pack()` (faces in
  metres packed at the densest px/m that fits), `paint_faces()`, `poly_mesh()` (smooth groups), `box_faces()` /
  `box_polys()` (chamfered boxes) and game-axes rotations.
- **Oriented `COL_` boxes (P-GLB3).** A sim collider turned about its own centre (the pipe's 8 diagonal facets) is a
  `COL_` node with a rotation and `extras.collider = "obb"`; its mesh is the unturned box. `validate-glb.mjs` checks it in
  the node's own space; `colliderObbs(doc)` returns every `COL_` box's corners for tests.
- **Paint mask.** The baseColor ALPHA is the paint mask (1 = paint that the game tints per instance through
  `pbr({ paintTint: true })`, 0 = rust, grime, frame). It is stored as `1 + 254 × mask`, so no texel is fully transparent
  and the lossy WebP encoder keeps the colour under it. A piece without a tint has an opaque RGB baseColor.
- **Sources.** The scripts are the source: no `.blend` is kept or committed. `build-container.py` reads `CONTAINER` and
  `c_west`'s door from `src/shared/world/lot/layout.ts`, so the kit follows the world data. It is deterministic: two
  builds produce byte-identical files.
- **Textures.** Every visible face has its own rectangle in a 1024² atlas: shelf packing, a texel density per surface
  kind, and 4 px gutters. baseColor, roughness, metalness and height are painted per texel by seeded numpy functions of
  the face's metres. The normal map is derived from the height. The occlusion is baked by Cycles (AO, LOD0 on a ground
  plane).
- **Collision.** `COL_<name>_<n>` boxes are the sim's colliders (`props.ts`). They carry `extras.collider = "box"` and
  no material. `tests/unit/glb-container-colliders.test.ts` checks them against `createWorldData('the_lot')`.
- **Godot and the web variant.** Godot 4.7.2 rejects `EXT_meshopt_compression` and `KHR_mesh_quantization`, so the web
  variant is Three.js-only. It accepts WebP. See `assets/manifest.json` → `godot`.
