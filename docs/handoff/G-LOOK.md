# G-LOOK (W12): The Lot in Godot as a wet night, stylised-realistic

**Card.** The owner locked the look (Wave 12) as stylised-realistic, aiming at the mood board: a photoreal armoured
corgi on a rainy industrial dock at dusk. That means wet asphalt, a muted night palette, sodium glints, a wet coat
against scuffed ochre plates and rifle metal, and no ink outlines (HARDENED is retired). The look uses the same master
GLBs as the web, with no second mesh set. It works through G-WORLD's groups and API and G-GAME's `Look.pet_material`
only.

**Base.** HEAD `f8ca7c1`; nothing staged or committed. Godot 4.7.2 in the container (xvfb). I ran Compatibility on
llvmpipe (Mesa 25.2.8), and Forward+ on **lavapipe** (Vulkan 1.4.318) after `apt-get install mesa-vulkan-drivers`.
Every number below comes from a command I ran. Scratch dir: `…/scratchpad/glook`.

## 1. Files (all mine; nobody else's folder touched)

| Path | What |
|---|---|
| `engines/godot/look/look.gd` | Rewritten. `const LOOK := "stylised-realistic"` is kept. It sets up the environment, moon, floods, practicals, rain and quality knob; wets the `ground` / `kit` / `prims` groups; and provides `pet_material()`, `apply()`, `set_quality()`, the `applied` signal, the `--look off` A/B and `--look-stats` |
| `engines/godot/look/night_sky.gdshader` | Moonlit overcast sky shader: a blue-grey cloud deck, a brighter patch where the moon sits behind it, and a sodium glow on the low cloud base. Static, so the radiance map is not rebuilt every frame |
| `engines/godot/look/wet_ground.gdshader` | Wet asphalt for group `ground`. It maps in world space, so it needs no UVs or tangents. Puddle mask from noise, on flat ground only: roughness 0.05 in puddles, 0.55–0.7 elsewhere. Also a damp ring, a detail normal off the puddles, and rain ripples in puddles (MEDIUM and up) |
| `engines/godot/look/kit_wet.gdshader` | Kit GLBs. Uses the master's own baseColor / ORM / normal maps, never replaced. Applies the **paint mask** (baseColor alpha = 1 + 254 × mask; the MultiMesh colour tints only the paint, so rust and frames keep their own colour; this closes G-WORLD's open item 3). Wets it: porous (non-metal) surfaces darken more and stay rough, metal gets the water film, rain streaks run down walls. Also carries the optional emission for the FloodLamp lens |
| `engines/godot/look/prims_wet.gdshader` | G-WORLD's merged prims mesh. Keeps its COLOR (linear palette colour) and its UV2 (roughness, metallic), and wets them. Cheap triplanar grime and streaks |
| `engines/godot/look/pet_materials.gd` | `coat` (wet fur: rim sheen, roughness 0.42; corgi ochre/tan, cat dark tabby with stripes), `plate` (ochre armour, dark grime, bare-metal scuffs, a **team band** in the locked team colours #2f6fd6 / #c9344a with a faint emissive, clearcoat on Forward+), `metal` (rifle metal 0.9 / 0.32). Materials are cached per (kind, species, team) and mapped with object-space triplanar |
| `engines/godot/look/shots.sh` | Re-runs the bookmark A/B: `GODOT=<bin> bash engines/godot/look/shots.sh [compat\|fplus] [on\|off] [canyon overview base]` |
| `engines/godot/tests/test_look_scene.gd` | Real `main.tscn` (section 5) |
| `engines/godot/tests/test_look_contract.gd` | A stand-in world (section 5) |
| `docs/handoff/G-LOOK.md` | This file |

## 2. What the look does

- **Environment** (`look.gd` `_build_environment` / `_apply_quality`):
  - Sky: the sky shader, with ambient and reflections taken from it (ambient energy 0.75).
  - Tonemap: AgX, exposure 1.25.
  - Glow: HDR threshold 1.3, bloom 0, so only emissives glow (the lenses, tubes and team trims).
  - Fog: exponential, density 0.0042 (about 57 % at 200 m), coloured like the horizon, plus height mist below 1 m.
  - **Volumetric fog** (Forward+, MEDIUM and up): density 0.009, anisotropy 0.45, ambient inject 0.04, so the haze
    comes from the lamps and not from a veil over long views.
  - SSAO, and SSR for the puddles (Forward+, MEDIUM and up).
  - Grade: saturation 0.82, contrast 1.06, and a 1-D colour-correction curve (teal shadows, warm highlights).
- **Moon:** a DirectionalLight3D, cool, energy 0.3. Shadows are 4 splits over 140 m on HIGH and 2 splits over 80 m on
  MEDIUM. Specular is 0, because behind cloud the sky's moonlit patch reflects instead; a hard moon glint on the
  puddles was blowing out the overview.
- **Floods:** one sodium `SpotLight3D` (colour 1.0 / 0.55 / 0.2, about 2000 K) per `World.floodlights()` entry, aimed
  at its `target`.
  - Energy 22, spot angle 38°, range 2 × the aim distance.
  - Shadows on a spread subset: 4 on HIGH, 2 on MEDIUM, 0 on LOW.
  - The floods do not depend on the kit: with `--no-kit` they are still 4 of 4 (headless probe). Only the lens glow
    needs the FloodLamp GLB. This answers G-WORLD's item 8.
- **FloodLamp lens:** the piece has one atlas material. The look finds the cream lens panel in its albedo
  (r > 0.45, g > 0.4, r − b > 0.08, at least 0.5 % of the texels), builds an emission map from it, and lights it
  sodium at energy 9, above the glow threshold. This applies to the MultiMesh mesh of the `Kit_Lot_FloodLamp_01` node.
- **Practicals:** the Lot's own lamp list. `lampTube` draws a glowing tube (one MultiMesh), plus a shadowless warm
  OmniLight (range 9) when it is on the play space: the 4 container ceiling tubes. `laserRed` is the crane's beacons,
  emissive only. `sodium` rows are the flood heads, already lit by the lens.
- **Wet surfaces:** `ground` gets the wet asphalt shader. `kit` and `prims` get wet copies, cached per source
  material, so shared stays shared. The originals are untouched (a test checks this).
- **Terrain shadow:** the look sets `cast_shadow = OFF` on the `ground` mesh. Its ~215 k triangles were being redrawn
  into every shadow pass: primitives in the canyon went from 1.41 M to 0.69 M on Forward+ and from 1.11 M to 0.47 M on
  Compatibility. This closes G-WORLD's item 2. The kit keeps its KitShadow caster.
- **Rain:** GPUParticles3D around the active camera, 2000 drops on HIGH and 1200 on MEDIUM, off on LOW. Thin
  billboard streaks at alpha 0.09 that fade out within 1–4 m of the lens.
- **Quality knob:** `Look.set_quality(Look.Quality.LOW|MEDIUM|HIGH)` or `-- --look-quality low|medium|high`. The
  default is HIGH on Forward+ and MEDIUM on Compatibility.
- **Timing:** materials go on at `World.built`. If the world has already built (`is_built`, or for a world without it,
  a non-empty `ground` group), they go on at once. `apply()` is idempotent.

## 3. Screenshots (`artifacts/godot/`, gitignored). I looked at every one

Bookmarks are the web game's own, from `data/the_lot.json`:

| Name | Web bookmark | Camera |
|---|---|---|
| `canyon` | `lot_container_canyon` | −85, 2.4, −58 → −78, 9, 60 |
| `overview` | `lot_overview` | 3.28, 114, 130.45 → −26, −2, −46 |
| `base` | `lot_corgi_base`, the pit with its floods and the slab side | 13, 1.9, −104.5 → −50, −2.2, −113 |

- **Before (the skeleton look on the real Lot, `--look off`):** `look_off_{canyon,overview,base}_{compat,fplus}.png`.
  The skeleton on its own 80 m plane is `look_before_*`.
- **After:** `look_on_{canyon,overview,base}_{compat,fplus}.png`.
- **Pets at 30 m:** `look_pets_30m_compat.png`. This is my scratch harness (stand-in pet shapes wearing
  `pet_material`), not G-GAME's pets.

**Against the mood board, honestly.**

What is closer:
- The sky is right: an overcast blue-grey deck brighter than the ground, a warm sodium glow along the horizon, and
  silhouettes against it.
- On Forward+ the pit reads as the mood board's background: sodium pools in volumetric haze, with the wet floor
  reflecting them.
- The container tube lights are warm practicals with halos.
- The palette is muted and cool with warm accents, and the containers show their paint-masked blue-grey hull with
  their own rust and frame.
- The ground reads wet: dark asphalt, puddles with sky and light glints, and ripples.
- Team colour survives at 30 m (blue and red bands on the far pair). No outline exists anywhere (tested).

What is still far:
- **No hero.** The mood board is a photoreal armoured corgi. G-GAME's pets are primitive placeholders, so the coat,
  plate and metal materials only get to show a hint of the wet-fur, scuffed-ochre and gunmetal read.
- **Compatibility has no SSR or volumetrics.** Puddles there reflect only the sky and specular highlights, with no
  light streaks, and there is no haze around the lamps.
- **The overview is dark and plain.** The terrain is one material everywhere (G-WORLD exports no surface weights),
  and from 114 m the flood pools are small.
- **The sandbags still read pale** under the sky light, although soaked canvas now darkens to 60 % and stays rough.
- There are no rain splashes, drips, wet decals, DOF or bokeh (the mood board's shallow-focus background).
- **Never seen on a real GPU.** Exposure and AgX were tuned on software renderers.

## 4. Numbers (look on vs off)

From `RenderingServer.get_rendering_info`, printed by `--look-stats` in the `shots.sh` runs, 1280 × 720.

| Bookmark | Renderer (quality) | Draws on / off | Objects on / off | Primitives on / off | CPU frame ms on / off |
|---|---|---|---|---|---|
| canyon | Compatibility (MEDIUM) | 105 / 63 | 473 / 464 | 469 488 / 256 848 | 630 / 254 |
| overview | Compatibility (MEDIUM) | 158 / 90 | 499 / 491 | 436 682 / 259 942 | 1056 / 371 |
| base | Compatibility (MEDIUM) | 124 / 60 | 493 / 461 | 404 416 / 257 620 | 482 / 215 |
| canyon | Forward+ (HIGH) | 103 / 63 | 504 / 464 | 685 292 / 256 848 | 802 / 385 |
| overview | Forward+ (HIGH) | 128 / 90 | 529 / 491 | 616 586 / 259 942 | 1029 / 473 |
| base | Forward+ (HIGH) | 122 / 60 | 523 / 461 | 550 304 / 257 620 | 785 / 368 |

How to read the table:
- **Where the extra draws and primitives come from:** the shadow passes. The moon draws 2–4 splits and the floods 2–4
  spot shadows, and each pass redraws the kit (KitShadow), the prims and the pets. The practicals add 2 draws and the
  rain 1.
- **The frame ms are not a GPU figure.** They are CPU wall time over 3 frames on a software rasteriser, noisy (the
  same overview Forward+ shot measured 1029–2783 ms across runs), and include the software rendering. The next step
  needs GPU timings on real hardware (`viewport_get_measured_render_time_gpu`).
- **Levers if it is over budget:**
  - LOW quality: no volumetrics, SSR, SSAO, rain or flood shadows.
  - Fewer moon splits.
  - Shadows on fewer floods.
  - `Sky.RADIANCE_SIZE_128` is already small.

## 5. Tests

`godot --headless --path engines/godot --script res://tests/run.gd` → `PASS` for all 9 files, `GODOT TESTS: PASS`
(the live tree, including G-GAME's and G-WORLD's tests).

- `test_look_scene.gd` (real `main.tscn`):
  - `LOOK == "stylised-realistic"`.
  - The look applied after `World.built`.
  - Fog is on; the tonemapper is AgX or ACES; the glow threshold is at least 1; the sky is a sky.
  - The flood count equals `World.floodlights().size()` (4), and each flood is a sodium SpotLight3D.
  - Every `ground` mesh wears the wet shader.
  - No outline anywhere in the tree. The scan catches:
    - an inverted hull: cull front plus grow, or a front-culled shader that pushes vertices along NORMAL;
    - `material_overlay` / `next_pass` outlines;
    - outline- or ink-named materials or nodes.
  - `pet_material` returns a Material for 3 kinds × 2 species × 2 teams; the two teams' plates differ; materials are
    cached.
- `test_look_contract.gd` (stand-in world):
  - Nothing happens before `built`.
  - 5 floods for 5 entries, aimed down, with 1–4 of them shadowed.
  - Kit moves onto `kit_wet` with its own albedo map, and the original material is unchanged.
  - Prims are darker and smoother.
  - `apply()` is idempotent.
  - LOW turns off flood shadows, volumetric fog and SSR.
  - `outline_scan` catches a planted inverted hull, so the scene test's PASS means something.

## 6. Open risks and requests

1. **`lamps` is not in the contract.** The look reads `World.lamps()` if it exists, else the public `World.data.lamps`.
   Lead: add `lamps() -> Array` to the README contract, or accept the read.
2. **Wet materials change the kit mesh.** On the kit's `MultiMeshInstance3D` the wet materials are set on
   `multimesh.mesh` in place. That is safe because G-WORLD makes one mesh per piece, but a mesh shared elsewhere
   would change too.
3. **The lens mask is a colour heuristic.** If the FloodLamp atlas changes, the lens may simply not glow; the lights
   still work.
4. **The team band is placed by object-space triplanar.** On G-GAME's small vest plates it may land partly off the
   plate. The 30 m read is proven on stand-in shapes only; G-GAME's glowing trims also carry team colour. Checking in
   the real match at 30 m is the next step.
5. **Settings that reach beyond the look:**
   - `RenderingServer.environment_set_volumetric_fog_volume_size` is a process-wide setting (128 × 96 on HIGH).
   - The glow threshold of 1.3 means G-GAME's trims (emissive energy 1.6) will bloom a little. That is intended, but
     it is their call.
6. **Forward+ is only proven on lavapipe.** Clearcoat, SSR and volumetric cost on real GPUs is unmeasured. There is
   no auto quality benchmark yet.
7. **The terrain's shadow is turned off by the look.** At night the heightfield's own shadow was barely visible, but
   pit walls now cast no moon or flood shadow.
8. **Not run:** `npm run gate` or `verify`, a real GPU, and G-GAME's pets checked at 30 m in a live match.
