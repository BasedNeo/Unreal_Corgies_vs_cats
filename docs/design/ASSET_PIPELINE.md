# Asset pipeline: one GLB, three tools (Wave 11+)

The owner's production workflow (Sept 2026) adopted for Corgis vs Cats. Every authored asset ends as one clean GLB
that Godot 4 and Three.js both load. The game still ships as the browser client plus the TypeScript authority.
Godot is the asset-compatibility gate, and the door to a native client later; it is not a port.

## Plan lock (Wave 11)
| Field | Content |
|---|---|
| Goal | One Lot kit piece goes Blender → master GLB → validator → Godot import → the game, behind `?kit=glb`, with an A/B against the current look |
| Non-goals | A Godot port of the game; character GLBs (W12); replacing the procedural world wholesale; any change to what the authority simulates |
| Constraints | The sim never loads GLBs: collision stays in world data, and a test proves the GLB's `COL_` boxes equal it. Budgets are those of MASTER_PLAN §8.7. Materials only go through the style factory (a new `pbr()` entry point is sanctioned for GLB assets). There are no paid APIs or uploads without the owner |
| Success | The validator, the Godot headless import and `verify --e2e` are all green. The Lot at 4v4 high stays within +10 % of P5's draws and triangles. A/B screenshots of the toon and PBR looks are on file |
| Horizon | This wave: one asset and an adjoining kit piece; then batch |
| Do not change | The authoritative sim, the wire protocol, `stepCharacter`, the 24 class kits |

## Stages and their status here
| Stage (owner's workflow) | Here | Status |
|---|---|---|
| 0 Concept / style bible | Mood board (armoured corgi, rainy dock at dusk) plus `style-tokens.js`, `STYLE_GUIDE`, and the Lot hero bookmarks | live |
| 1 Image-to-3D (Scenario, Tripo, Hunyuan, Meshy, Rodin) | `assets/incoming/<asset>/` holds generated originals, never edited in place | **blocked:** `api.cloud.scenario.com` is denied by the environment's network policy and no key is set. Until then, assets are scripted in Blender (bpy) |
| 2A Environment / prop refinement | Blender 5 headless (`bpy` 5.0.1 from PyPI, Python 3.11) scripts in `tools/assets/`: pivots, meters, LOD0/1/2, `COL_` proxies, PBR bake, naming | **proven**: `build-container.py` is deterministic (byte-identical rebuilds) |
| 2B Characters (Cartwheel; Mixamo) | One master GLB per character with named actions | **blocked:** Scenario access; Mixamo is a web login, a human step (W12) |
| 3 Validation | `tools/assets/validate-glb.mjs` (glTF-Transform): scale, pivot, names, LODs, `COL_`, triangle and texture budgets, file size | **proven**: the master and the web variant pass; a broken copy fails with 30 errors |
| 4 Godot | Godot 4 headless in `tools/godot/`: imports every master GLB and checks its tree, AABB, materials and LODs | **proven** with Godot 4.7.2: the master imports and loads. Godot rejects the web variant (`EXT_meshopt_compression`, `KHR_mesh_quantization`), so Godot always takes the master |
| 5 Three.js | `GLTFLoader` → style factory (`stylize()` or `pbr()`), instanced, behind a flag until the owner picks the look | **proven** behind `?kit=glb`: instanced LODs, `COL_` equals the sim within 1 cm, Lot 4v4 high 236 draws (230 off) |
| 6 Three.js enhancement ("Astra" pass) | Non-destructive TSL material and lighting work in the style layer only; GLBs are never modified | live (the style system) |
| Grok Imagine multi-view projection | Phase 1 (Blender camera rig plus depth / normal / shaded passes): P-GLB2. Phase 2 (API) | **blocked:** `api.x.ai` denied, no key |

## Standards (enforced by the validator)
- **Units:** meters. glTF is +Y up, and a kit's front faces +Z. The pivot is at the base centre, on the ground.
- **Names:** `Kit_<Set>_<Thing>_<NN>` (for example `Kit_Lot_Container20_01`), `Char_<Species>_<Class>`, and actions
  `Idle`, `Walk`, `Run`, `Attack_01`.
  - LOD nodes are `<name>_LOD0|1|2`.
  - Collision nodes are `COL_<name>_<n>` boxes; they are never rendered. An axis-aligned box is the default; a
    rotated one carries `extras.obb` (P-GLB3, for the pipes' diagonal facets). A cylinder collider is exported as its
    bounding box, with the shape recorded in extras.
- **PBR:** baseColor, ORM and normal at 1024² for kit pieces (2048² for heroes only).
  - **Paint mask (P-GLB1b):** the baseColor **alpha** channel. 1 = paint that the game tints per instance, 0 = everything
    that keeps its own colour (rust, grime, frame, glass). It is stored as `1 + 254 × mask` (never 0: lossy WebP may
    rewrite colour under alpha 0), and the material stays `OPAQUE`. A piece that is never tinted has no alpha.
- **Files:**
  - the master GLB (PNG textures) is the source of truth, the one Godot imports;
  - the web variant (meshopt, WebP) is made from it and is what Three.js loads;
  - both are listed in `assets/manifest.json` with versions, budgets, sizes, provenance and licence.
- **Budgets per kit piece:** LOD0 ≤ 2.5 k triangles, LOD1 ≤ 800, LOD2 ≤ 200. Web variant ≤ 600 KB.
- **The authority never reads a GLB.** Anything gameplay needs (collision, nav, hiding spots) lives in `src/shared`
  world data, and a unit test checks that the GLB's `COL_` boxes match it.

## Why not port to Godot
The authority, prediction, netcode, bots and 1,100+ tests are TypeScript. The client is web, so a match is one click
away with no install. A Godot client would be a rewrite of the whole client that doubles every later lane. The
shared-GLB rule keeps that door open at no cost; revisit it when the game targets Steam or consoles.

## What the photoreal references mean for the look
The mood-board renders are offline photoreal. A 24-pet browser shooter cannot match them frame for frame, but PBR GLB
assets can move the game a long way towards them: baked wear, wet response and armour plates. The slice's A/B (the
current HARDENED toon vs `pbr()`) is the owner's decision point: keep the ink, or go stylised-real.

## Open pipeline items (after batch 1)
- ~~**Draw headroom**~~ closed by P-GLB4. Each kit piece is one static batch that holds every LOD of every
  placement; an instance switches LOD by rewriting its index range, with hysteresis. All pieces cast through one
  shadow-only mesh (layer 30), so the kit costs one draw per piece plus one shadow draw. Lot 4v4 high: +0.3 % draws
  against flag-off; triangles below batch 1's LOD0-only figure. `BatchedMesh` was rejected: in three 0.186 on WebGPU
  it issues one draw per instance.
- **Inside interiors, `pbr()` has no toon ramp floor.** The GLB tunnel is 11 % darker than the procedural one; a style
  call.
- **The palette under the cool sky fill:** blue-tinted concrete and steel at play distance. This sits with the owner's
  look decision (the toon HARDENED look, or stylised-real).
