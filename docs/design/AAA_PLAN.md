# AAA pass plan, measured (W17 spike, 2026-10-17)

The north star is `docs/design/NORTH_STAR.md`. This page records what a scratch-only feasibility spike measured on this
box, the rulings that settle the plan, and one card per lane. The pass starts after W17 item 11 is CI-green.
Every number was taken on 4 shared CPU cores at load 6-20 (SwiftShader, llvmpipe, lavapipe): treat times as ratios,
and re-time on an idle box before committing a schedule. No real-GPU frame time exists for any item yet.

## Verdict: go, with the fallback built first

| Question | Answer | Evidence |
|---|---|---|
| Can the twin draw a Gaussian splat? | Yes, with no new dependency: three 0.186.1 ships a native TSL `GaussianSplat` (SPZ/PLY loaders, GPU counting sort, SH up to degree 3). It ran on WebGPU and on the WebGL2 fallback, through the twin's own post pipeline, depth-tested against the Lot and writing no depth. | spike `render-web`: depth "sandwich" test (opaque box at 300 m: only the 200 m splats show over it); WebGPU and WebGL2 images match |
| Can we train a splat here? | Only as a short fine-tune. OpenSplat 1.2.2 builds for CPU (about 25 min, 1.3 GB while building, 0.5 GB kept). From scratch, 30k iterations at 300k splats is 14-24 h here and stays blurry from sparse points; a splat baked from the Blender scene plus 300 iterations gained +3.7 dB on backdrop pixels (28.98 to 32.67 dB) and was the sharpest. | spike `train`: 300k splats = 3.58 MB as .spz v3 |
| Can Blender make the splat? | No: Blender 5.2.2 has no splat type and 5.3 imports splats for lookdev only, with no export. Blender makes the sky, the wet mask, the backdrop GLB and the training renders; training runs outside it. | spike `blender` |
| Can Godot draw splats? | Not shippably: GDGS 3.3.0 renders but has fog disabled, a 242 ms GDScript sort at 300k and no .spz import. Godot gets the backdrop GLB (7 draws, 90.7k triangles in the spike). | spike `godot` |
| Does an EXR sky work in Godot? | Yes, in both renderers, with one fix: in a 4.7.2 sky shader Compatibility writes COLOR without sRGB encoding, so the shader needs an `encode_srgb` uniform set only on Compatibility (without it, linear 0.0146 renders as 0). Camera euler (90, 0, 180) in Blender matches Godot's sky axes (proved with markers). | spike `godot` |
| Do SSR and probes give the reference's amber puddle streaks? | No, not alone: both engines need a lamp-streak term in the wet shader. | spike `godot` |

## Rulings that settle the plan

1. **Fallback first.** The backdrop GLB is the floor everywhere (Godot, the twin's low and medium tiers, any WebGL
   backend). A splat baked from the backdrop meshes and coloured from the training renders is labelled UNTRAINED and
   can always ship. A 5k-iteration CPU fine-tune replaces it only if held-out PSNR on backdrop pixels gains at least
   3 dB and it beats the GLB at the hero view by eye.
2. **The splat runs only on the twin's high tier and the WebGPU backend.** On WebGL the main-thread sort costs 8.7 ms
   p50 / 22.9 ms p95 per re-sort at 300k. Budget: at most 300k splats and 15 MB; at most 1.5 ms GPU on the reference
   desktop (human-measured). Split into 8 azimuth sectors (about -30 % frame time).
3. **Training renders:** the Lot collection is camera-invisible (not a holdout), the view transform is Standard (the
   twin applies its own AgX), no baked haze (both engines apply live fog), 768x432 at 32 spp (39.1 dB against
   128 spp), 150 views from inside the play bounds looking out.
4. **Distances:** backdrop objects at 216 m or more (the Lot's bounds are ±156); cranes and gantries at 400-900 m; a
   wet apron from 165 m; the splat is cropped to nothing inside 165 m.
5. **Splats are look-only:** nothing in `src/sim`, `src/host` or `src/shared` may mention `.spz` or `GaussianSplat`
   (a boundaries rule). PARITY logs the backdrop as an allowed look DIFF: twin high on WebGPU = splat; Godot and the
   twin's other tiers = GLB.

## Lane cards (in pass order: SKY, WET, AIR, BACKDROP)

| Card | Owner | What | Measured cost |
|---|---|---|---|
| W17-AAA-BL | BL-DCC (Blender 5.2.2 headless) | `tools/blender/` sky_source, wet_mask, backdrop + backdrop_glb, splat_set; `tools/splat/` build_opensplat.sh (fetch and build recipe only), bake_splat, ply_scrub, spz_check. Outputs: `assets/sky/lot_night_sky.exr` (2048x1024, 64 spp), `assets/lot/lot_wet_mask.png` (2048², R puddle, G damp, B glint), `assets/backdrop/lot_backdrop.glb` (at most 8 draws), the training set, the baked splat, the gated fine-tune, each with a receipt | sky 958 CPU-s; wet 32 CPU-s; 150 training views 13.8k CPU-s (about 62 min on an idle box, projected); bake 65 s for 300k; fine-tune 2.5-4.1 h on the shared box |
| W17-AAA-GA | g-atmos (Godot) | G-SKY: `night_sky.gdshader` samples the SOURCE EXR (BC6H, 2.10 MB VRAM), `encode_srgb` on Compatibility only, SKY_HORIZON and fog colour from the receipt. G-WET: the mask, puddle roughness 0.03, a lamp-streak term in both renderers, SSR on Forward+ medium/high only. G-AIR: halo cards per flood, height fog, Forward+ volumetric shafts, rain. G-BACKDROP: the GLB, no collision | EXR sky costs about the same as the procedural one; SSR + probe about 2.2x the sky-only frame in software; volumetric +15 % |
| W17-AAA-TL | tw-look (twin) | The same EXR through three's EXRLoader (verify the quarter-turn with a markers EXR), the same mask and streak term, SSRNode on high only, halo cards, bloom unchanged, the backdrop GLB on low/medium and WebGL | not measured on a real GPU |
| W17-AAA-TS | TW-SPLAT (new lane) | `src/client/world/backdrop-splat.ts`: SPZLoader + GaussianSplat on WebGPU high only, 8 sectors, the colour contract (sRGB decode, divide by exposure 1.5, a lift so lamp cores pass bloom 1.3), fog from fragment depth, load once and hide (r186 has no dispose), a device-limit fallback to the GLB, pin three 0.186.1 with a test on the internals it hooks | WebGPU re-sort 0.3-0.6 ms CPU; 0 re-sorts with a still camera |
| W17-AAA-QA | QA-30M (fresh checker) | Before pass 1 a baseline; after every pass the 30 m team-read lineup in 4 configs (Godot Compatibility and Forward+, twin WebGL and WebGPU high): colour, greyscale and colour-blind (deuteranopia, protanopia); pets must still read against the backdrop | a FAIL blocks the next pass |

## Open risks and what they need

- **Fog against the skyline:** `look.gd`'s exponential density 0.0045 gives 62 % fog at 216 m, 83 % at 400 m and 98 %
  at 900 m (computed). If the cranes vanish at the hero view, the lead rules on a far-fog cap in both engines.
- **View-dependent glints are unproven on CPU:** spherical harmonics barely train in 300 iterations, and the glints are
  the splat's reason to exist. The +3 dB gate and the hero-view check decide.
- **Disk:** the OpenSplat build peaks at 1.3 GB; run it in a quiet window with 2 GB free.
- **Headless WebGPU tests** need a test-only shim (Chromium 141 rejects three r186's texture-view swizzle) and a
  render-target readback (page screenshots miss WebGPU canvases).

## Decisions for the owner (logged, not blocking the fallback)

1. **OpenSplat is AGPL-3.0.** The plan uses it only as an offline tool: fetched and built by script, never committed,
   linked, shipped or served; its outputs are ours. The fine-tune (step 4d) waits for your sign-off; the baked
   UNTRAINED splat and every GLB path do not need it.
2. **Real-GPU frame times** for the splat, SSR and volumetric fog must be measured once on the reference desktop.
3. **CHAR (the photoreal pets) stays parked** until a GPU (TRELLIS.2, MIT) or a hosted service key (Scenario, Meshy,
   Tripo) is available. No key is invented; the pets stay labelled PLACEHOLDER.

## Licences (all tools; every output is ours)

Blender 5.2.2 (GPL-2.0-or-later, tool), Cycles and OpenImageDenoise (Apache-2.0), Godot 4.7.2 (MIT), three 0.186.1
(MIT, existing dependency; GaussianSplat, SPZLoader, EXRLoader), OpenSplat 1.2.2 (AGPL-3.0, offline tool only, pending
sign-off), libtorch CPU (BSD-3-Clause, build-time only), OpenCV 4.12 (Apache-2.0, build-time only). Rejected or not
used: Spark (WebGLRenderer only), GDGS (not shippable), Brush (blocked here), the original Inria code (non-commercial
licence: must not be used).
