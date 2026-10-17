# North star: the wet sodium yard (W17 AAA pass plan)

**Reference.** `docs/design/refs/hardened-corgi-hero.jpg` and `hardened-corgi-sheet.webp`: a photoreal armored corgi
soldier, rifle at the ready, in a rain-soaked industrial yard at night. Godot is the product; the Three.js twin is the
look lab and runs the same Lot GLBs and the same rules. Godot wins any clash. The locked rules still hold: no ink, no
crease lines, no comic FX, placeholder pets stay labelled PLACEHOLDER, West Yard stays dirt.

## What the reference has, and where we are (W17 shots, `docs/qa/w17/p17-*-own-fire.jpg`)

| Element | Reference | Now (both builds) | Pass |
|---|---|---|---|
| Sky | Low overcast deck lit warm-grey from below by the yard's sodium, darker slate toward the zenith, rain haze | Flat dark blue-black, no lit cloud underside | 1 SKY |
| Ground | Black wet asphalt; puddles mirror every lamp as long amber streaks; damp sheen everywhere else | Dark asphalt with a uniform sheen; no lamp streaks, no puddle breaks | 2 WET |
| Light and air | Sodium floods with glare halos and haze shafts; cold rim from the sky; deep blacks | Floods read as dim points; little haze; no halos | 3 AIR |
| Backdrop | Dense skyline: cranes, gantries, lamp towers, container walls in silhouette, lamps dotted through it | Sparse: a few sheds, one tower, open dark horizon | 4 BACKDROP |
| Pets | Photoreal fur, weathered yellow/black armor plates, heavy rifle, wet highlights | Low-poly placeholder pets (CHAR parked) | 5 CHAR (parked) |

## The passes, in order (each ends with the 30 m check: teams separate in colour, greyscale and a colour-blind sim)

1. **SKY: one SOURCE, both engines.** Blender 5.2.2 headless renders a Cycles equirect panorama of the locked night
   (16-bit EXR plus a PNG preview): the overcast deck lit from below by a ring of sodium sources at the yard's flood
   positions, slate zenith, cold haze at the horizon. Our own render, so licence-clean. Path
   `assets/sky/lot_night_sky.exr`, labelled SOURCE with a receipt (blend file, script, seed, samples, hash). Godot
   samples it in `night_sky.gdshader` (fog colour = horizon colour); the twin's sky reads the SAME file. PARITY P1.
2. **WET: the Lot asphalt only.** A Blender top-down bake from the Lot heights and the flood positions:
   `assets/lot/lot_wet_mask.png` (R puddle, G damp, B glint), world-aligned, with the transform in its receipt.
   Puddles get mirror roughness and a rain-ripple normal; damp gets the sheen we have. Reflections: Godot Forward+
   screen-space reflections plus a reflection probe; Compatibility gets the probe and a cheap streak term; the twin uses
   TSL SSR on the high tier (three's `SSRNode`) and the probe path on low. No new collision mesh.
3. **AIR: halos, haze, rain.** Bloom keyed to the sodium emissives only; a glare halo card per flood (both engines);
   height fog tinted by the sky SOURCE's horizon; Godot Forward+ volumetric fog for the flood shafts (Compatibility
   keeps the cards); rain streaks and ground splashes as GPU particles inside the frame budget.
4. **BACKDROP: Blender scene, two outputs.** `lot_backdrop.blend` builds the skyline beyond the playable fence (60 m
   and farther from any play position) from the existing Lot kit GLBs plus new crane and gantry silhouettes, lit by the
   sky SOURCE and sodium lamps. It exports:
   - **one backdrop GLB** (one mesh family, emissive lamp cards, no collision, outside the play bounds) for Godot and
     the twin's low tier;
   - **one Gaussian splat** (`.spz`, budget about 300k splats and 15 MB) for the twin's high tier only: a
     view-dependent layer that keeps wet highlights and lamp glints alive as the camera moves. It is trained from
     multi-view Cycles renders taken from inside the play bounds looking out. Measured (docs/design/AAA_PLAN.md):
     from scratch is 14-24 h on this CPU, so the splat is baked from the scene's surfaces first (labelled UNTRAINED,
     always shippable) and then fine-tuned for 5k iterations with OpenSplat on CPU (gsplat if a CUDA GPU is attached),
     which replaces it only if it gains 3 dB. The twin draws it with three 0.186.1's own GaussianSplat (no new
     dependency), on the high tier with the WebGPU backend only.
   Splats are look-only: they never replace the Lot GLB, collision or the pet meshes, and nothing in the sim reads
   them. Godot has no shippable splat path (GDGS was tried and rejected), so Godot's backdrop is the GLB; PARITY logs the backdrop as an allowed look DIFF.
5. **CHAR (parked).** The reference pets need an image-to-3D generator on a GPU (TRELLIS.2, MIT) or a hosted service
   with a real key (Scenario, Meshy, Tripo); no key is invented. When one is available: licence gate first, then
   Blender cleanup (one master armature, quadruped rig, actions `Idle` `Walk` `Plant` `Fire` `Hit` `Death`), one
   master GLB per pet (LOD0 at most 20k triangles, 2K textures), fresh-import check, receipt. Until then the pets stay
   PLACEHOLDER.

## Budgets and proof

- Frame budget unchanged: no draw-call growth on the Lot itself; the backdrop GLB is one draw per material family;
  the splat layer only on the twin's high tier. Headless renders here are SwiftShader / lavapipe: judge looks from
  screenshots, frame times on real GPUs (logged for a human).
- Every pass: before and after shots at the fixed views (spawn, slab 10 m, slab 30 m, the hero view) in both builds,
  the 30 m team-read check, PARITY rows updated, `npm run godot` and `npm run twin` still launch.
- Receipts for every Blender output: path, triangles, texture sizes, licence line, the command that rebuilds it.
