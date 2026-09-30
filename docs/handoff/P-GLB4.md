# P-GLB4 (W11, pipeline-4): real distance LODs for the Lot kit, one draw per piece

**Card.** The six Lot kit pieces behind `?kit=glb` draw real distance LODs (LOD0/1/2 from their GLBs) without the
draw-call cost of P-GLB1's one `InstancedMesh` per kind per LOD (+12.6 %, over budget in P-GLB3). One batched draw
path, picked by measurement. Plan lock and standards: `docs/design/ASSET_PIPELINE.md`.

**Base.** HEAD `f464b4d`; nothing committed or staged. The flag stays off by default. Every number below comes from a
command I ran in this session (scratch: `/tmp/claude-0/-home-user/4eb0b9e5-129d-5c0b-ac58-7a3e7a57c134/scratchpad/pglb4`).
The HEAD comparison runs used a `git archive HEAD` copy of the repo served by its own Vite (:5371); mine ran on :5370.

## 1. Files

| Path | What |
|---|---|
| `src/client/assets/kit-glb.ts` | `buildKitBatch`, `kitLodSelect` + `KIT_LOD_HYST`, `kitForcedLod` (`?kitlod=`), `createKitShadowCaster` + `KIT_SHADOW_LAYER`, `kitPlacementMatrix` / `kitPlacementTurn`, `LotKitView.shadowFrom`; `createKitView` rewritten on the batch; batch-1 LOD distances replace `KIT_LOD0_ONLY`; the load-failure path no longer leaves an unhandled rejection |
| `src/client/world/world-view.ts` | The `?kit=glb` branch only: the `LotKitView` type, a comment, and `kit?.shadowFrom(sky.sun)` right after the sky is made (a no-op with the flag off: `kit` is null) |
| `tests/unit/glb-lod-batch.test.ts` | **New.** 17 tests (section 5) |
| `docs/handoff/P-GLB4.md` | This file |

Screenshots and perf outputs: `artifacts/p-glb4/` (gitignored, like `artifacts/p-glb3/`).

## 2. Decision: a static merged batch per piece, plus one shared shadow caster

Three candidates. The acceptance metric is `tools/perf-render.mjs`, which counts WebGL2 `drawArrays` / `drawElements`
(and their `…Instanced` forms) under SwiftShader.

| Path | Draws per piece per pass | Why kept or dropped |
|---|---|---|
| One `InstancedMesh` per LOD (HEAD) | 1 per LOD in use (1-3), plus as many shadow draws | Measured: HEAD `?kit=glb` 240 / 240 / 240 draws vs flag-off 224-230 (+5.4 % on the means, table 4a). P-GLB3's first try had +12.6 % with LODs on all six pieces |
| three `BatchedMesh` | WebGPU: 1 **per instance**. WebGL2: 1 `multiDrawElementsWEBGL` | Dropped by reading the r186.1 source, not built. `WebGPUBackend.draw()` loops `passEncoder.drawIndexed(…, i)` over every instance and calls `info.update` for each (`node_modules/three/src/renderers/webgpu/WebGPUBackend.js` 2124-2146), so the shipping WebGPU path would issue 52 draws per pass for the Lot's 52 instances. On WebGL2, `WebGLBackend._draw` uses the `WEBGL_multi_draw` extension, which perf-render does not wrap: the budget tool would count **0 draws and 0 triangles**, a win that cannot be measured. It also has no custom per-instance attributes (`pbr()`'s `paintTint` would need a geometry copy per tint) |
| **Merged batch (chosen)** | exactly 1 `drawElements` on both backends, whatever mix of LODs | Measured below |

**The batch (`buildKitBatch`).** Kit pieces never move, so each piece becomes ONE indexed mesh that holds every LOD of
every placement, baked in world space: positions by `placement × the LOD node's matrix` (the node carries the web
variant's dequantization), normals by that matrix's normal matrix, tangents by its linear part (w kept), the uv copied
as floats. The index holds each placement's chosen LOD, packed from the start; the draw range covers exactly those.
When an instance crosses a switch distance the index is rewritten (a partial upload of the used range; Uint32, so the
upload stays 4-byte aligned on WebGPU). The bounds cover every LOD, so culling never depends on the selection.
Per-instance tints become per-vertex attributes with the same names: `paintTint` for `pbr()` (it reads
`attribute('paintTint')`, which is the same for a vertex attribute) and `color` + `toon({ vertexColors })` on the toon
side (three multiplies `vertexColor()` where it multiplied `instanceColor`). No style file changed.

**The shared shadow caster (`createKitShadowCaster`).** The batch alone left the kit at 1 colour + 1 shadow draw per
piece = 12, and the frame at 237-239 vs flag-off 224-230 (table 4b, +5.2 %): still over. Three's shadow pass renders
every caster with its own depth material and takes only `side` / `shadowSide` from the object's material, so the
textures do not matter there. Once every piece has loaded or failed, the loaded pieces stop casting
(`castShadow = false`) and one mesh casts for all of them: their baked positions end to end, with an index that
repeats each piece's current selection (so the shadow map sees the same LODs as the view). It sits on
`KIT_SHADOW_LAYER` (30), which no view camera has; `shadowFrom(sky.sun)` enables that layer on the sun's shadow
camera. Three's shadow pass then uses that camera's own mask (layers 0 + 30) instead of copying the view camera's
(layer 0); every other object is drawn exactly as before (the only other layer in use is destruct-view's 31, which
neither mask has). Pieces whose material has another side get their own caster (all six share one under `pbr()`:
the GLBs are double-sided; under `toon()` all are front-sided).

**Cost.** 45,976 baked vertices for the Lot's 52 instances: about 2.2 MB of vertex data, 0.43 MB of live index, plus
the caster's 0.55 MB of positions and 0.43 MB of index (≈ 3.6 MB GPU), and 0.57 MB of JS-side source index. An index
rewrite is at most 0.43 MB (the bag walls' 16 modules all at LOD0), only when an instance crosses a switch band.

## 3. LOD selection

- `kitLodSelect(d, dist, prev, h = KIT_LOD_HYST = 0.05)`: an instance goes coarser only beyond `dist × (1 + h)` and
  finer only inside `dist × (1 − h)`, so a camera hovering on a switch distance cannot make a piece pop back and
  forth. With no previous LOD it equals `kitLodAt` (the container's `kitLodFor` test is unchanged).
- Distances (m, camera to the instance's centre). A piece switches where the detail its next LOD drops is about
  1-2 px at 1280 × 720 and 60° (about 620 / d px per metre): container 70 / 160 and bag wall 30 / 80 (unchanged); pipe
  70 / 160 (the 12 cm rim chamfers); footing 30 / 80 and lamp housing 35 / 90 (6 cm arrises, fins, visor); mast
  50 / 120 (step bolts, gussets).
- `?kitlod=0|1|2` pins every instance to one LOD, for A/B shots. Default off.
- `stats()` adds `kitLod0|1|2_<piece>` and `kitShadowCasters`.

## 4. Budget: Lot 4v4 high

Command (the P-GLB3 method): `PROBE_URL=http://localhost:<port>/ node tools/perf-render.mjs --tiers high --query
'&mode=team-deathmatch&bots=4,4&t=0.68&map=the_lot'` [`&kit=glb`], run in turn (off, mine, HEAD) with nothing else
on the machine. Draws / triangles.

**4a. Final (`artifacts/p-glb4/perf/series.txt`).**

| Run | Flag off | HEAD `?kit=glb` | P-GLB4 `?kit=glb` |
|---|---|---|---|
| 1 | 230 / 580,041 | 240 / 569,927 | **230 / 554,117** |
| 2 | 229 / 580,087 | 240 / 571,796 | **227 / 548,754** |
| 3 | 224 / 571,142 | 240 / 569,927 | **228 / 550,144** |
| mean | 227.7 / 577,090 | 240 (+5.4 %) / 570,550 | **228.3 (+0.3 %) / 551,005** |
| `--objects` frame | 225 / 573,469 | – | 232 / 556,299 |

- Draws: at or below flag-off +5 % in every run (the limit on the mean is 239). Shadow draws equal flag-off (30).
- Triangles: 548,754-554,117, below batch 1's LOD0-only 562,732, and 3-5 % below flag-off.
- **Attribution** (`--objects`, same query, world objects only): flag-off 89 world draws, P-GLB4 92. The kit is exactly
  6 colour draws + 1 shadow draw (`Kit_Lot_*_batch` × 6, `kit_glb_shadow` × 1) and removes 4 procedural draws: net
  **+3**. The rest of the frame-to-frame spread (±6) is the bots (characters, weapons, interactables).
- The kit's own triangles in that frame: 7,998 per pass (bag walls 5,184, lamps 816, mast 670, container 504, footing
  420, pipes 404), against 14,956 in a HEAD `--objects` run of the same query (`scratchpad/pglb4/perf-headglb-obj`).

**4b. Before the shared caster** (the batch alone, `artifacts/p-glb4/perf/series-before-shadow-caster.txt`): off
225 / 230 / 224, batch 239 / 237 / 238, HEAD 240 / 235 / 236. The batch's 12 kit draws (6 + 6 shadow) netted +8.

**4c. Without bots** (`&bots=0,0`, same view every run): flag-off 167 / 515,149, HEAD 180 / 506,721, P-GLB4
**170 / 491,433** (shadow 25 = flag-off 25; HEAD 31). A second flag-off run gave 164, so even this view moves by ±3.

Note: `perf-render`'s default free-mode query ignores `&map=` (all three runs gave the same 126 / 1,020,815), so it is
not a Lot measurement; I did not use it.

## 5. Tests (`tests/unit/glb-lod-batch.test.ts`, 17 passed)

- **Selection:** the plain switch without history; the band edges both ways at both distances (`30 (1 ± h)`,
  `80 (1 ± h)`), two-level jumps, h = 0 equal to `kitLodAt`; a camera jittering within the band for 400 frames
  switches **0** times; a sweep 0 → 199 → 0 m switches exactly `[0, 1, 2, 1, 0]`; every `LOT_KIT` piece has finite,
  increasing distances; `?kitlod=` parsing.
- **Batch exactness:** three different LOD geometries (a sphere for oblique normals, a box, a plane), a non-uniform
  node matrix per LOD, placements with yaw, pitch and stretch. For four selections: the index draws exactly the chosen
  LOD of each placement (the source index rebased into that placement's block), and every vertex equals `M × source`
  (positions 1e-4, normals by the normal matrix and tangents by the linear part 1e-5, uv and extras exact). Bounds hold
  every LOD. Mutations caught: normals by the linear part instead of the normal matrix, a flipped tangent w, and
  a zero band on the coarsening edge (two tests fail).
- **Shadow caster:** one caster for same-sided pieces, on layer 30 only (a default camera never draws it), casting,
  not receiving; it draws exactly the pieces' own triangles in order, follows a selection change once the piece's
  version moves, and splits by side.
- **The six web GLBs** (read with glTF-Transform, handed over raw and normalized as GLTFLoader does) at their Lot
  placements (seed 1): for LOD 0, 1 and 2 every baked vertex is within 1 mm of `placement × node × decoded position`,
  the triangle counts are the placements × the LOD's, and the container's per-instance paint tint is carried.
- **Existing:** the `COL_` / interior / split tests are untouched and pass (section 7).

## 6. Screenshots (`artifacts/p-glb4/`)

`tools/probe.mjs`'s browser and flags at 1280 × 720 (a scratch copy, `scratchpad/pglb4/shot.mjs`, that also prints
the kit stats and can abort one GLB request). Query prefix: `labs/lot.html?webgl&hud=0&dummies=0&freeze&kit=glb`.
Diffs: `scratchpad/pglb4/diff.mjs` (mean |Δ| over RGB max, and the share of pixels with a channel off by more than 8).
**Noise floor:** the same code and view shot twice differs by 3.9 / 8.6 % (the clouds move and the grain is animated
even with `&freeze`). I looked at every shot.

| Shot | Query | What it shows |
|---|---|---|
| `overview.png` | `&bm=lot_overview&t=0.74` | LOD2 at distance: stats `kitLod0 0, kitLod1 7, kitLod2 45`, `kitShadowCasters 1`, 115 draws |
| `overview-kitlod0.png` | + `&kitlod=0` | (shot before the shared caster) The same camera with everything at LOD0: 458,725 vs 392,629 triangles, same draws; the picture differs from `overview.png` by 3.1 / 1.5 % (below the noise floor): LOD2 is invisible at that distance |
| `pipe-close-v1stats.png`, `pipe-close.png` | `&t=0.74&pos=75.2,2.4,9.5&look=79.5,2.8,14&fov=60` | LOD0 close: `kitLod0_Pipe 7, kitLod1_Pipe 1`; the open bore and chamfered rims. Against HEAD (`pipe-close-HEAD.png`): 3.7 / 7.2 %, the noise floor |
| `pipe-close-kitlod2.png` | + `&kitlod=2` | What LOD2 is: the capped dark mouths. Clearly not what the close shot shows |
| `canyon.png` / `canyon-HEAD.png` | `&bm=lot_container_canyon&t=0.74` | `pbr()` side: 4.2 / 9.6 % vs HEAD (the far batch-1 pieces now at LOD1/2, and the sky) |
| `canyon-stylize.png` / `-HEAD` | + `&kitlook=stylize` | The toon side: ink, ramp, the blue container still tinted. Differs from HEAD by 5.0 / 12.8 %: see risk 1 and `diff-canyon-stylize-x4.png` |
| `footing-close-day.png` / `-HEAD` / `-off` | `&t=0.62&pos=-20,2.6,-104&look=-28,0.2,-111&fov=55` | Shadows through the shared caster: the footings and masts cast onto the ground as at HEAD (3.2 / 1.4 %) |
| `tower-head.png`, `tower-head-stylize.png` | `&t=0.74&pos=-78,20.5,-108.5&look=-85,22.3,-112&fov=55` | Lamp housings at LOD0 up close, both looks |
| `pipe-close-fallback.png` | the pipe close-up, with the pipe GLB request aborted | `[kit-glb] Kit_Lot_Pipe_01 not loaded, procedural stand-in kept`; the procedural pipe with its ink stands; `kitLoaded 5`; **no page error** (HEAD also logs `[pageerror] TypeError: Failed to fetch`, an unhandled rejection; fixed) |

The lab's `__cvc.world` stats are refreshed on frame 3 and every 30 frames, so at SwiftShader's 1-2 fps a 16 s shot
often prints a stale snapshot (`kitLoaded 0`). The overview and fallback rows are from 40 s shots; the rest are judged
by the picture and the diff.

## 7. Trial tree

`git archive HEAD` (`f464b4d`) plus my three source files (`kit-glb.ts`, `world-view.ts`, `glb-lod-batch.test.ts`;
`cmp` equal to the working copy), `node_modules` linked:
- `tsc --noEmit`: exit 0.
- `node tools/check-boundaries.mjs`: **BOUNDARIES: PASS**.
- `CI=1 npx vitest run`: **Test Files 141 passed (141), Tests 1217 passed | 4 skipped (1221)**, 355 s, exit 0 (the
  machine otherwise idle). That includes the untouched `glb-container-colliders`, `glb-bagwall-colliders`,
  `glb-lot-batch1` (`COL_` = sim, the bore in `lotInteriors()`) and `glb-validate` files.

## 8. Open risks

1. **The toon side's weathering pattern changed.** `HardenedToonMaterial` computes grime / wear / mud noise from
   `positionGeometry`. On HEAD's instanced meshes that was the web variant's quantized units (not metres, the same
   pattern repeated on every instance); in the batch it is world metres, as on every procedural prop, and each
   instance gets its own pattern. The `pbr()` side reads `positionWorld` and is unchanged. Keeping the old pattern
   would need a style change (out of scope); I think the new one is the intended scale. Say if not.
2. **The shared caster changes how the sun's shadow camera picks layers** while the flag is on: its own mask (0 + 30)
   instead of the view camera's. Equivalent today (nothing else uses layers except destruct-view's 31); a later lane
   that puts objects on another layer for the view camera would need that layer on the shadow camera too while
   `?kit=glb` is on. `dispose()` removes layer 30 again.
3. **Shadows follow the view's LOD.** A far piece at LOD2 casts its LOD2 shape (the mast's prism, the footing's box)
   into the sun map. The sun map covers ±62 m around the camera, where most pieces are at LOD0/1; at dusk a far mast's
   long shadow can reach closer. Not seen in the shots.
4. **One mesh per piece is culled as a whole** (as the instanced meshes were): a piece with one instance in view draws
   all its selected LODs. The draw count, not triangles, is the budget here.
5. **BatchedMesh was ruled out by source reading, not by a build.** If three later draws BatchedMesh with one
   multi-draw on WebGPU, and perf-render learns to count `multiDraw*`, it would be worth a measured retry (it culls per
   instance).
6. **Memory:** about 3.6 MB more GPU memory than the instanced meshes (section 2). GPU time was not measured
   (SwiftShader).
7. **The 4v4 frame is noisy** (±6 draws from the bots): single runs of flag-off range 224-230. The attribution (net +3)
   is the stable number.
8. **Not run:** e2e, `npm run verify`, Godot, the validator (no GLB changed).
9. **Scope held.** Nothing in `src/client/style`, `src/sim`, `src/host`, `src/shared`, `assets/**`, `tools/**` or any
   GLB changed; the flag stays off; nothing staged or committed. Vite ran on :5370 and :5371 only and both are stopped.

**For the lead (ASSET_PIPELINE.md "Open pipeline items", lead-owned, not edited):** the draw-headroom item can close:
"P-GLB4: per-instance distance LODs for all six pieces at one draw per piece (a static world-space batch with a
rewritten index) plus one shared shadow draw; Lot 4v4 high 227-230 draws vs flag-off 224-230."
