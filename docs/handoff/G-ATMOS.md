# G-ATMOS (W13): the night, the wet asphalt, the sodium pools, and no Forward+-only warnings on Compatibility

**Card.** Q6 (`docs/qa/W12_VERIFICATION.md`, P2-6 and P2-7) found the locked stylised-realistic look off in four ways:
- the sky read as overcast dusk, not night;
- the ground read as brown mud with puddles, not wet asphalt;
- from the spawn and slab cameras no sodium pool showed on the ground;
- Compatibility printed SSR and volumetric-fog warnings (`look.gd:205`, `:210`).

This lane fixes those four. It keeps `const LOOK := "stylised-realistic"`, no ink outlines, the LOW / MEDIUM / HIGH
knob, the P-GLB4 draw contract (one draw per kit piece plus the shared KitShadow) and the existing look tests.

**Base.** HEAD `71d05d5`. Nothing staged or committed: the lead integrates. Every proof run used a private copy in
`scratchpad/g-atmos/`:
- `before`: `git archive HEAD`.
- `after`: HEAD plus my files.
- `final`: HEAD plus the whole current working-tree `engines/godot`. This is the integrated state: my files, plus
  G-MOVE / R-PETS / G-WORLD's `pet.gd`, `match.gd`, `player.gd`, `pet_model.gd`, `pet_materials.gd` and the new
  pit-ramp `the_lot.json` / `the_lot_heights.bin`.
- Godot 4.7.2.
- Compatibility: xvfb, Mesa llvmpipe (MEDIUM, its default).
- Forward+: lavapipe Vulkan (HIGH, its default).

## 1. Files (all in my lane)

| Path | Change |
|---|---|
| `engines/godot/look/night_sky.gdshader` | Rewritten as a night sky. A blue-black zenith over a low cloud deck lit from above by a hidden moon. The moon shows through a break, with a corona. Faint stars sit in the breaks. The horizon is a cold haze; the warm sodium horizon wash is gone. Still static (no `TIME`). |
| `engines/godot/look/wet_ground.gdshader` | Rewritten as wet asphalt; still world-space, on the existing terrain (no new mesh). Details in section 2. |
| `engines/godot/look/look.gd` | Several changes: <br>• `features(method, quality)`: SSR and volumetric fog are on for Forward+ only; Compatibility never touches those setters. <br>• `rendering_method` override, for tests. <br>• The night keys as constants. <br>• Ambient, exposure, AgX contrast, fog. <br>• Flood cone, energy and haze. <br>• Two cellular noise textures for the ground. <br>• A dark still-water material for G-WORLD's `water` group (the ditches). |
| `engines/godot/look/shots.sh` | Adds the `spawn` bookmark: play height behind the Corgi spawn, looking at the slab. |
| `engines/godot/tests/test_look_contract.gd` | Extended; see section 5. |
| `docs/qa/w13/atmos-*-before-after.jpg` | Proof montages (section 4). |
| `docs/handoff/G-ATMOS.md` | This file. |

Not touched: `pet_materials.gd` (R-PETS), `game/*` (G-MOVE, G-GAME), `world/*` (G-WORLD), `kit_wet.gdshader`,
`prims_wet.gdshader`.

## 2. What changed, and why it reads differently

- **Night, not dusk.**
  - The W12 sky was bright and blue-grey: a 0.2 to 0.25 horizon, cloud 0.34, and a warm glow added along the
    horizon. It sat in front of an ambient 0.75 that came wholly from that sky.
  - Now the zenith is near black-blue and the deck is a dark slate, brighter only around the moon.
  - The ambient is half sky and half a cold moonlit fill, so pets and the slab stay readable off the floods.
  - The cold moon key rises from 0.3 to 0.5. Exposure goes from 1.25 to 1.5 with AgX contrast 1.3.
  - Result: the frame is dark with local warm light, not a dim day.
- **Asphalt, not mud.** The W12 ground was one blotchy 0.14 m noise in brown-lit grey, so it read as mud. The new
  shader gives asphalt cues at three scales:
  - Centimetres: a grey-black binder with ~1.2 cm light aggregate (cellular noise).
  - Metres:
    - paving lanes 4.5 m wide with tar-sealed joints (8 cm), and a rare cross joint;
    - patch repairs: darker rectangles with a sealed edge, in 1 panel in 4;
    - a domain-warped crack network, sealed with tar, only where the surface is old.
  - The wet film: roughness 0.30 to 0.45, which takes the floods' sheen. Puddles have roughness 0.03 and a stronger
    mirror, plus a damp rim and rain ripples.
  - Berms and banks get coarse dark grit, projected onto their own face, and no joints or puddles.
  - The terrain's vertex colours can only shade the ground, never tint it brown.
  - The ditch water (G-WORLD's brown "mud" tint) becomes a dark, still mirror.
- **Pools.** The W12 floods had a 42° half-angle cone with soft falloff (exponent 0.8), aimed from 25 m. That lit the
  whole pit evenly, so no pool had an edge. Now:
  - The cone is 32° with exponent 1.6, giving a flat-topped hot centre and a defined edge.
  - Energy is 38 (was 22).
  - The sodium is a touch yellower.
  - The volumetric haze per flood drops from 1.2 to 0.4, so Forward+ no longer fills the pit with orange "dust".
- **Warnings.** `_apply_quality` asks `features(rendering_method, quality)`. SSR and volumetric fog are
  `forward_plus and quality >= MEDIUM`. On Compatibility (or Mobile) neither the `*_enabled` flags nor their
  parameters are ever set; both default to off. Each setter re-sends its whole group to the server, which is what
  warned. Forward+ keeps both effects (HIGH: SSR 64 steps, volumetric 128 × 96).

## 3. Key values for the web twin (TW-LOOK)

All colours are sRGB, as the Godot `Color` or `source_color` uniform is written. Linear values are given where the
web needs them for a shader. The web sets `new Color().setRGB(r, g, b, SRGBColorSpace)`.

| What | Value |
|---|---|
| Tonemap | AgX, exposure **1.5**, AgX contrast **1.3** (Godot's default is 1.25; three.js AgX has no contrast knob, so match by eye: slightly deeper blacks) |
| Glow | Emissives only: HDR threshold 1.3, intensity 0.7, bloom 0, screen blend |
| Grade | Saturation 0.85, contrast 1.06, plus the 1-D curve in `look.gd _grade()` (teal shadows, warm highlights) |
| Sky zenith | `(0.03, 0.042, 0.08)` = `#080b14` (linear 0.0023, 0.0033, 0.0072) |
| Sky horizon (and fog colour) | `(0.11, 0.13, 0.17)` = `#1c212b` (linear 0.0116, 0.0153, 0.0245). Blend: `mix(horizon, zenith, pow(up, 0.4))` |
| Cloud deck | Lit `(0.17, 0.19, 0.24)` = `#2b303d`; dark `(0.045, 0.055, 0.08)` = `#0b0e14`; cover 0.74; projection `dir.xz / (dir.y + 0.12)`; brightens ×(1 + glow) around the moon, with `glow = pow(m, 6) × 0.6 + pow(m, 40) × 1.4` and `m = dot(dir, moonDir)` |
| Moon (sky) | Direction `(-0.4, 0.55, -0.73)` (elevation 33°, towards −x −z; visible from the slab looking at the Corgi base). Disc colour `(0.82, 0.87, 1.0)` = `#d1deff` × 3, about 0.9° radius; corona `pow(m, 300) × 0.24`; a cloud break always crosses it |
| Stars | `(0.75, 0.8, 0.95)` × 0.6, about 3 % of cells on a 260-per-radian lattice, only in breaks above 0.1 elevation |
| Below horizon | Horizon fading to 0.35 × horizon |
| Fog | Exponential, colour = horizon, density **0.0045 /m** (59 % at 200 m), sky affect 0.15, aerial perspective 0.3, height fog below y = 1 m at density 0.03 |
| Volumetric fog (Forward+ only) | Density 0.009, albedo `(0.82, 0.85, 0.9)`, anisotropy 0.45, length 96 m (HIGH) / 64 m (MEDIUM), ambient inject 0.04, sky affect 0; per-light volumetric energy: floods 0.4, moon 0.25 |
| Ambient | Half sky radiance, half colour `(0.2, 0.25, 0.36)` = `#33405c` (linear 0.033, 0.051, 0.107); energy **1.6**; reflections from the sky |
| Moon light | Directional, colour `(0.62, 0.72, 0.95)` = `#9eb8f2`, energy **0.5**, specular 0 (behind cloud), shadows MEDIUM and up |
| Sodium floods | Colour `(1.0, 0.62, 0.28)` = `#ff9e47` (linear 1.0, 0.342, 0.064). Energy **38**. Spot half-angle **32°**, angle-falloff exponent **1.6** (Godot `1 − rim^1.6`, with `rim = (1 − cosθ) / (1 − cos 32°)`). Distance decay 0.9. Range `clamp(2 × aim distance, 30, 90)` m. Specular 1. Shadows on 4 / 2 / 0 of them (HIGH / MEDIUM / LOW) |
| Flood lens | Sodium emission × 9 (unchanged) |
| Practicals | Tubes `(1.0, 0.8, 0.55)` emission 5; omni energy 2, range 9 (unchanged) |
| Ground albedo | Binder `#2b2b2d` (0.17, fresh) to `#4c4c4c` (0.30, worn); aggregate `#666663` (0.40); tar `#060607` (0.025). Then wet × 0.7, damp rim × 0.8, puddle × 0.6 more, berms × 0.55. Resulting linear albedo: wet binder ≈ 0.017 to 0.05, stones ≈ 0.09 |
| Ground roughness | Wet binder **0.30**, rising to 0.45 on stone peaks. Tar seams 0.18. Damp rim × 0.6. **Puddles 0.03.** Berms 0.62 to 0.77. Dry (wetness 0) 0.75 to 0.9 |
| Ground specular | F0 0.04 (Godot specular 0.5); puddles 0.9, which is F0 ≈ 0.07 (a stylised stronger mirror) |
| Ground scales | Aggregate tile 0.8 m (stones ≈ 1.2 cm); wear 9 m and 48 m; lanes 4.5 m × 14 m; joint 8 cm wide; crack tile 26 m (cells ≈ 5 m, warped); puddle tile 24 m, cut 0.6 (about 30 % of flat ground: 29.7 % of the mask texels are above 0.6) |
| Ditch water | Albedo `#050606` at alpha 0.92, roughness 0.04 |

## 4. Proof

**Shots.** Before = HEAD `71d05d5`; after = the `final` copy (integrated tree). The same cameras and 60 frames were
used for both.
`scratchpad/g-atmos/shot.sh` is `look/shots.sh`'s loop with my paths:

```
xvfb-run -a -s "-screen 0 1280x720x24" $G --path engines/godot [--rendering-method gl_compatibility --rendering-driver opengl3] \
  --audio-driver Dummy -- --shot <png> --frames 60 --cam <bookmark cam> --look-stats
```

Cameras: canyon `-85,2.4,-58:-78,9,60`; overview `3.28,114,130.45:-26,-2,-46`; base `13,1.9,-104.5:-50,-2.2,-113`;
spawn `-63.6,-0.6,-113.8:0,-6,0` (1.8 m above the pit floor, looking at the slab); slab `3,1.6,8:-30,-4,-108`
(standing on the slab, looking at the Corgi base).

Each montage is a 2 × 2 grid: rows are before / after, columns are Compatibility (MEDIUM) / Forward+ (HIGH). They
are JPEG quality 80, 1200 px wide:
- `docs/qa/w13/atmos-spawn-before-after.jpg`
- `docs/qa/w13/atmos-base-before-after.jpg`
- `docs/qa/w13/atmos-canyon-before-after.jpg`
- `docs/qa/w13/atmos-overview-before-after.jpg`
- `docs/qa/w13/atmos-slab-before-after.jpg`

What changed, as I see it in the montages:
- **spawn** (play height, looking at the slab):
  - Sky: the grey-violet dusk deck with the warm horizon is now a blue-black night with a dark cloud deck and no warm
    band.
  - Ground: the brown, blotchy ground is now grey-black asphalt with fine aggregate, long tar-sealed lane joints,
    sealed cracks, and dark puddles.
  - Light: the foreground sits in the west flood's warm pool and falls off to a cool, darker floor towards the pit
    wall. The berms read as coarse wet grit, not brown slopes.
  - Forward+ adds a light sodium haze but no longer an orange fog.
- **base:** the W12 floods lit the whole pit orange. Now one bounded sodium pool sits under the west flood, with
  glints in its puddles, and a dark, cold floor around it. The moonlit house and sandbags hold their shape. The sky is
  night.
- **canyon:** the warm-pink horizon behind the containers is gone. The tube practicals and their halos now carry the
  frame against a cold night; the sandbags and containers stay readable.
- **overview** (114 m up): the pink-orange dusk haze over the far edge is now a cold blue night haze. From this
  height the flood pools are small: honest, not a strong frame.
- **slab** (standing on the slab, looking at the Corgi base): the moon now shows through a cloud break, with a corona
  on the deck, and the slab light reflects in the wet asphalt. The Corgi pit floor is below the rim from here (see
  section 6).

Not graded by me against the mood board. An independent verifier grades the look.

**Warnings.** I grepped the Compatibility console of every run (`grep -E 'SSR|olumetric'`):

| Run | SSR / volumetric lines | Other WARNING / ERROR lines |
|---|---|---|
| Before (HEAD), 5 runs | 3 each | n/a |
| After (`final`), 5 runs | **0** | 0, apart from the driver's V-Sync notice |

The before runs print:

```
WARNING: Screen-space reflections (SSR) are only available when using the Forward+ renderer.
WARNING: Volumetric fog is only available when using the Forward+ renderer.
```

Logs: `scratchpad/g-atmos/logs/{before,final}_*_compat.log`.

**Render stats.** Taken from the `LOOK stats` lines, 1280 × 720. They are CPU wall time on a software rasteriser
shared by about 6 lanes, so they are not a performance figure. Draws, before → after:

| Renderer | Tree | spawn | base | canyon | overview | slab |
|---|---|---|---|---|---|---|
| Compatibility | HEAD | 133 | 124 | 105 | 158 | 130 |
| Compatibility | HEAD + mine | 133 | 124 | 100 | 158 | 130 |
| Forward+ | HEAD | 135 | 122 | 103 | 133 | 115 |
| Forward+ | HEAD + mine | 129 | 122 | 106 | 125 | 115 |

So the look change is draw-neutral: one draw per kit piece plus KitShadow is untouched, and no meshes were added.
The integrated tree draws fewer (Compatibility 66–86, Forward+ 65–81), from other lanes' changes.

## 5. Tests

`test_look_contract.gd` now also checks the following:
- `features()` never asks for SSR or volumetric fog on `gl_compatibility` or `mobile` at any quality, and keeps both
  on `forward_plus` HIGH.
- A look built with `rendering_method = "gl_compatibility"` keeps SSR and volumetric fog off through
  `set_quality(HIGH, MEDIUM, LOW, HIGH)`.
- A Forward+ look at HIGH has both on.
- The night keys hold: zenith luminance at most 0.05 and blue above red; horizon luminance at most 0.15 and not warm
  (W12's dusk horizon was 0.22). The fog colour equals the horizon colour.
- The `water` group gets the look's dark still water.

Mutation: with `features()` changed to `"ssr": mid` (SSR on Compatibility), `test_look_contract` FAILS with 7
errors; restored, it PASSES.

Suites:
- HEAD plus my files: `godot --headless --path engines/godot --script res://tests/run.gd` gives 10 of 10 PASS,
  `GODOT TESTS: PASS`.
- The integrated tree (`scratchpad/g-atmos/live`, a copy of the current `engines/godot`): 13 of 13 PASS,
  `GODOT TESTS: PASS`. That includes the other lanes' new `test_game_demo`, `test_game_stepup` and `test_read_pets`.
- `-- --only look` on the integrated tree: both look tests PASS.

## 6. Open risks / NEXT

1. **Seen on software renderers only.** Exposure 1.5 and AgX contrast 1.3 were tuned on llvmpipe and lavapipe. A real
   GPU may need ±0.2 exposure. Compatibility LOW was not re-tuned; it has no SSAO, rain or flood shadows.
2. **Spawn pool.** The spawn camera stands inside the west flood's footprint, so it sees the lit floor around it and
   the cooler, darker floor towards the pit wall, not a whole pool. The base bookmark shows a whole pool. A narrower
   cone would show more pool from the spawn but leave the spawn darker.
3. **From the slab the Corgi pit floor is below the rim** (pit floor y −2.4, rim y ≈ 0). The pools there cannot be
   seen; only the flood heads, their light on the sandbags and walls, and the moon can. This is geometry, not look.
4. **On Compatibility the puddles are dark mirrors** of the night sky plus light glints (it has no SSR). On Forward+,
   SSR adds pets, lamps and walls. If the owner wants brighter puddles on Compatibility, the cheap lever is a brighter
   cold horizon. That would cost some of the night.
5. **`water` group:** the look now overrides G-WORLD's ditch material (dark water instead of brown). G-WORLD:
   object if the "mud" tint was meant to stay.
6. **Ground shader cost:** 8 texture reads per pixel (wear × 2, aggregate × 3, crack, puddle, detail normal) and two
   `fwidth`s. The W12 shader had 4 reads. It was not measured on a GPU.

# G-ATMOS (W15 Sprint D, item 11): the cover read in Godot

The full report is in `docs/qa/w15/COVER.md`. It has the cover table, the rule, the metric, the bar, the read on / off
numbers, the draw budget and the shots.

**Status (2026-10-12): accepted by the lead as item 11's Godot half (round 3).**
- **The shared rule changed.** The fill keeps the albedo's texture: one gain per piece, from its mean base-colour
  luminance, instead of a per-texel luminance band. It fades inside the floods' cones. A wide per-texel guard catches
  outliers only.
- **The shared bar:**
  - a dark view (read off < 35 L\*) may be lifted to 40 L\* at most at 10 and 30 m;
  - a flood-lit view (≥ 35 off) may be lifted by 5 L\* at most at 10 and 30 m (no Godot view is flood-lit);
  - at every view and distance, std_on ≥ 0.85 × std_off;
  - edge ≥ 15 at every distance, 60 m included;
  - value gap ≥ 10 at 10 and 30 m, reported at 60 m;
  - draws ×1.000 (lead ruling), gated exactly by the headless draw-item check (`test_look_cover.gd`, read on against
    off); the rendered `DRAW_GROWTH` 1.05 is only a tolerance.
- **Result:** both renderers pass all 15 split runs: Compatibility, and Forward+ with the gap gated at 10 / 30 m.
- **A known item for W17 AIR:** the Forward+ corgi-base gap at 60 m is 7.8, reported, not gated. The darkest cover
  there is the rim BagWall at 27.6, against a mast pole that Forward+'s volumetric sodium haze lights to 19.8.
  - The lead's ruling: the gap bar applies at the fight distances (10 and 30 m) like the lift rule. The AIR pass
    retunes that haze, so no distance-dependent fill is added now; it would be a shared term the AIR pass would undo.
  - `test_look_cover.gd` follows the ruling. The gap is gated at 10 / 30 m (`GAP_GATED_MAX`, `_gap_verdict()`, with
    a headless self-check). The Forward+ `corgi base` / `COVER_D=60` run passes and prints the 7.8 as REPORTED.
- **Forward+ std / C\* against Compatibility's:** report-only (COVER.md §4).

## Files

| Path | Change |
|---|---|
| `engines/godot/look/look.gd` | **Cover tables:**<br>- `COVER`: each piece's cover zone;<br>- `COVER_VALUES`: the per-renderer fill, band, guard, sheen, power, sat and pool;<br>- `COVER_MEAN`: each piece's mean base-colour luminance;<br>- `COVER_SCALE`: the per-renderer, per-piece scales.<br>**The read:** `cover_values()`, `cover_scale()`, the toggle (`set_cover_read`, `-- --cover-read off`), and the floods passed to the pool term (`_cover_floods()`). |
| `engines/godot/look/kit_wet.gdshader` | The cover rule. Its header states the rule with exact constants. |
| `engines/godot/tests/test_look_cover.gd` | **Headless (CI):**<br>- the shader-rule pins (`SHADER_RULE`);<br>- the band, guard and power pins;<br>- `COVER_MEAN` recomputed from the GLBs;<br>- the per-renderer gate through the helpers with every rendering method;<br>- the floods on every material;<br>- the glow bound;<br>- the draw shape.<br>**Rendered:** edge, gap, the dark-ceiling and lit-lift rule, the no-flattening rule and the draw A/B. Run per place and distance (`COVER_ONLY`, `COVER_D`). |
| `docs/qa/w15/COVER.md` | Godot half (tw-look writes the web half) |
| `docs/qa/w15/cover-godot-*.jpg` | 7 montages |

`world.gd` is not touched.

## The rule the web twin mirrors (tw-look)

Everything in this section is shared and must be copied exactly, except what "Per build" lists. Source of truth:
`kit_wet.gdshader` (the cover block and its header) and `look.gd` (`COVER`, `COVER_VALUES`' band / guard / power,
`COVER_MEAN`, `COVER_SHEEN_COLOR`, `_cover_floods()`).

### 1. The zone

A fragment is on the cover zone when:

```
cover = step(ly, cover_top) × step(0.001, cover_top)      ly = the vertex's mesh-local height (m, from the piece's foot)
```

`cover_top = COVER[piece]`:

| Piece | `cover_top` | Zone |
|---|---|---|
| `Kit_Lot_BagWall_01` | `COVER_ALL` = 1.0e6 | the whole piece |
| `Kit_Lot_Footing_01` | `COVER_ALL` | the whole piece |
| `Kit_Lot_Pipe_01` | `COVER_ALL` | the whole piece |
| `Kit_Lot_Container20_01` | `COVER_ALL` | the whole piece |
| `Kit_Lot_FloodMast_01` | 1.25 | the ballast |
| `Kit_Lot_FloodLamp_01` | 0 | none |

Off the zone, nothing is added, and nothing is dimmed anywhere: `ALBEDO = wet_alb`.

### 2. On the zone, in this order

All colour maths is linear. `lum(c) = dot(c, (0.2126, 0.7152, 0.0722))`. `step(e, x)` is 1 when x ≥ e, else 0.

```
graze = (1 − clamp(dot(normalize(N), V), 0, 1)) ^ cover_sheen_power
        × (1 − smoothstep(0.85, 0.97, Nw.y))
held0 = wet_alb × clamp(m, cover_floor, cover_ceil) / max(m, 1e-4)          m = COVER_MEAN[piece]
hl    = lum(held0)
held1 = mix(vec3(cover_lo), held0 × clamp(hl, cover_lo, cover_cap) / max(hl, 1e-4), step(1e-4, hl))
held  = max(mix(vec3(lum(held1)), held1, cover_sat), vec3(0))
pool  = max over the floods i (at most 8) of
        smoothstep(0.848, 0.961, dot(normalize(P − lamp_i), aim_i))          aim_i = normalize(target_i − lamp_i)
EMISSION += held × cover_fill × (1 − cover_pool × pool) + moon × cover_sheen × graze
```

- `N`: the interpolated vertex normal in view space, before the normal map.
- `V`: the unit vector to the camera.
- `Nw`: the vertex normal in world space (model matrix, normalised per vertex, interpolated).
- `P`: the fragment's world position (model matrix × vertex, interpolated).
- `moon`: `COVER_SHEEN_COLOR` = (0.62, 0.72, 0.95) sRGB, used as linear ≈ (0.3424, 0.4770, 0.8900). Godot's uniform is
  `source_color`.
- 0.848 and 0.961 are cos 32° and cos 16°. 32° is the floods' own spot (Godot `spot_angle` 32, web `angle` 0.559).
- If a flood's target equals its lamp, its aim is straight down.

### 3. Shared constants (copy exactly)

| Term | Value |
|---|---|
| band `cover_floor`, `cover_ceil` | 0.22, 0.28 |
| guard `cover_lo`, `cover_cap` | 0.08, 0.5 |
| `cover_sheen_power` | 3 |
| up-face edges | 0.85, 0.97 |
| cone | 0.848, 0.961 |
| luminance weights | 0.2126, 0.7152, 0.0722 |
| near-zero guards | 1e-4 |
| moon | (0.62, 0.72, 0.95) sRGB |
| `COVER` | the table in §1 |
| `COVER_MEAN` | the table in §4 |

The headless Godot test pins the band, the guard and the power on both renderers.

### 4. `COVER_MEAN`: the per-piece mean (shared data)

| Piece | `COVER_MEAN` |
|---|---|
| `Kit_Lot_BagWall_01` | 0.1409 |
| `Kit_Lot_Footing_01` | 0.1251 |
| `Kit_Lot_Pipe_01` | 0.1405 |
| `Kit_Lot_Container20_01` | 0.1312 |
| `Kit_Lot_FloodMast_01` | 0.0661 |
| `Kit_Lot_FloodLamp_01` | 0.0597 |

How it is computed, from each `assets/masters/<piece>.glb`:
1. Read the GLB's JSON chunk.
2. Take `materials[0].pbrMetallicRoughness.baseColorTexture.index` → `textures[i].source` → `images[j]`. On all six
   this is one embedded 1024 × 1024 PNG, read from `bufferViews[images[j].bufferView]` in the BIN chunk.
3. Decode it to RGBA8.
4. For every texel, decode each of R, G and B from sRGB: `c/255 ≤ 0.04045 ? (c/255)/12.92 : ((c/255 + 0.055)/1.055)^2.4`.
   Ignore alpha.
5. Take `lum()` of each texel and average over all texels at full resolution: no mips, no resizing.
6. Multiply by `lum(baseColorFactor.rgb)`, which is 1 on all six.

`test_look_cover.gd` (`_check_means`) recomputes the means from the files and fails if any is off by more than
0.0005. The web may parse `look.gd`'s `COVER_MEAN` or compute it the same way.

### 5. The pool's data (shared)

`WorldData.floodlights`, each row's `pos` (the lamp) and `target`, from the shared Lot data. Godot reads it through
`World.floodlights()`, from `engines/godot/data/the_lot.json`. The Lot has 4 floods.

### 6. Per build (not shared)

- **The gains:** `cover_fill`, `cover_sheen`, `cover_sat`, `cover_pool`.
- **`COVER_SCALE`:** the per-piece multipliers on those gains.
- **`wet_alb`:** each build's own wet albedo. Godot's is
  `albedo × mix(1, wet_darken, wet) × mix(1, 0.6, 1 − metallic)`.
- **The tonemap and the exposure.**

**Godot's gains:**

| Renderer | fill | sheen | sat | pool |
|---|---|---|---|---|
| Forward+ / Mobile | 0.38 | 0.5 | 1.0 | 0.2 |
| Compatibility | 0.5 | 0.35 | 1.0 | 0.2 |

**`COVER_SCALE` (Godot):**

| Renderer | Piece | Scales |
|---|---|---|
| Forward+ | Footing | fill ×1.47 |
| Forward+ | BagWall | fill ×0.97, sheen ×0.6 |
| Forward+ | FloodMast | fill ×0.84 |
| Forward+ | Container20 | fill ×1.32, sat ×1.3 |
| Compatibility | Container20 | fill ×2.2, sheen ×0.5 |

### 7. What changed from round 2, and `kit-cover.test.ts`

- **Gone:**
  - the per-texel band on `wet_alb`'s luminance (`float al = dot(wet_alb, …)`, `clamp(al, cover_floor, cover_ceil)`);
  - the near-black window `smoothstep(0.0, 0.04, al)`.
- **New uniforms:**
  - `cover_mean`, `cover_lo`, `cover_cap`, `cover_pool`;
  - `cover_flood_pos[8]`, `cover_flood_aim[8]`, `cover_flood_count`.
- **New `COVER_VALUES` keys:** `lo`, `cap`, `pool`.
- **New tables:** `COVER_MEAN`, and `COVER_SCALE`, which is now one row per renderer.
- **Unchanged names:** `COVER`, `COVER_ALL`, `COVER_VALUES` (`fill`, `floor`, `ceil`, `sheen`, `power`, `sat`),
  `COVER_SHEEN_COLOR`, `graze`, the up-face mask, and `ALBEDO = wet_alb;`.
- **`tests/unit/kit-cover.test.ts` passes 11/11 against these files.** tw-look moved its parse to the new terms
  (the weights in `dot(held, vec3(0.2126, 0.7152, 0.0722))`, no near-black window) and the `lo`, `cap` and `pool` keys.

## Found on the way (not fixed: outside this card)

**Compatibility's dark tones are crushed.** On this look, Compatibility shows emission under about 0.07 as black,
where Forward+ shows 0.025 as 0.14. The probe is `scratchpad/g-atmos/probe2/emit.gd`. It survives with:
- the colour correction off;
- the adjustments off;
- AgX contrast at 1.25;
- the linear tonemapper.

So it is in the Compatibility path itself, and that is why "Compatibility is flatter and darker" (Q6 P2-7). Its night
is much darker than Forward+'s. Worth its own look card: exposure or ambient per renderer, as the cover read now does.

# G-ATMOS (W17 item 11b): the Godot half of PARITY P2c, the gate holes

**Tests only.** Only `engines/godot/tests/test_look_cover.gd` changed. The shipped `look.gd` and `kit_wet.gdshader`
are unchanged, and so are their values.

| Hole | The check that closes it, headless (CI) |
|---|---|
| **V7**: `set_cover_read` ignored passed both gates | After `set_cover_read(false)`, every cover material's `cover_fill` and `cover_sheen` must be 0. After `set_cover_read(true)`, they must equal this renderer's `COVER_VALUES` × `COVER_SCALE` again |
| **V6**: an extra emission term after the rule passed the statement pins | The shader must write `EMISSION` exactly twice (the lens's `=`, the cover read's `+=`), and the cover block must be exactly the pinned statements in order, with nothing inserted between them and nothing after (the contiguous-block check, item 11b follow-up: it also fails the verifier's MY4 and MY5, a statement inserted between two pins); the block starts at the lens's `EMISSION =`, and `wet_alb`, `ly`, `wpos`, `wnrm` are each written exactly once (kills X2, X3) |
| **Pins** | `ly = VERTEX.y` joins the vertex pin. The lens's own `EMISSION =` is pinned. `Look.COVER_SHEEN_COLOR` is pinned at (0.62, 0.72, 0.95), and every cover material must receive it as `cover_sheen_color` |
| **Glow**: it keys on max(r, g, b), not luminance | `_glow_check()` runs every texel of each cover piece's GLB base colour through the shader's rule: ORM metal, each placement's paint tint, the brightest wet factor 0.775, no pool, a full sheen. It asserts max(r, g, b) × exposure < 1.3. Peaks: Container20 1.016 / 1.010 (Forward+ / Compatibility), FloodMast 0.809 / 0.942, Footing 0.873 / 0.652, Pipe 0.817 / 0.665, BagWall 0.591 / 0.725. They match the verifier's `glowpeak.py`; the old luminance bound asserted 0.900 for Compatibility FloodMast |
| `DRAW_GROWTH` → 1.0 (optional) | Not done. Proving it needs the ten 30 m rendered runs, and load5 was 7.7–9.7 from the parallel SwiftShader metric (the rule is < 8). It stays a render tolerance; the headless draw-item check gates ×1.000 exactly |

**Mutants** (`scratchpad/g-cover2/mut11b.py`; "e75c591" is the test as landed, "11b" is the new one):

| Mutant | e75c591 test | 11b test |
|---|---|---|
| V6: `EMISSION *= 1.0 + cover_fill * 1.5;` after the rule | survives | killed |
| V6b: `EMISSION += vec3(0.3) * cover_fill;` after the rule | survives | killed |
| V7: `_cover_params` ignores `cover_read` | survives | killed |
| V7b: `set_cover_read(true)` never restores | survives | killed |
| P1: `ly = VERTEX.y - 0.3` | survives | killed |
| P2: `_cover_params` sends a white sheen colour | survives | killed |
| P3: `COVER_SHEEN_COLOR` moved to (0.62, 0.72, 1.0) | survives | killed |
| G1: Compatibility FloodMast fill × 1.8 | survives | killed (1.552; the old luminance bound gave 1.2) |
| MY4: `held *= 3.0` before the pool loop | survives | killed |
| MY5: `pool = 0.0` before `EMISSION +=` | survives | killed |
| X2: `wet_alb *= 3.0` before the block | survives | killed (write-once) |
| X3: `ly -= 0.3` after the vertex pin | survives | killed (write-once) |
| none | passes | passes |

The 21 round-3 mutants (`mut.py`) behave as before against the new test: 20 killed headless, and H29 (the 60 m gap
gate) fails the rendered run.

**Suite:** a fresh copy of HEAD `c010d64` (fresh `--import`) with the new test: `--headless --script res://tests/run.gd` passes 26/26.
`test_look_cover` headless now takes about 17 s instead of 4 s; the texel glow check is the addition.

# G-ATMOS (W17 AAA pass 1, G-SKY): Godot draws the shared sky SOURCE

**Status (2026-10-23): SKY ACCEPTED (Godot).** BL-DCC's v3 sky at `SKY_ENERGY` 0.60, the split edge ring, and option
3 (the edge gated at 10 / 30 m, reported at 60 m).
- The full bar passes 30 of 30, with five named 60 m known limits that print REPORTED (§ Option 3).
- The headless suite passes 27 of 27.
- The hero stats on Forward+ / Compatibility: mean Y 0.053 / 0.051, p90/p10 3.31 / 3.63, r/b 0.55 / 0.53, g/b 0.80 /
  0.79, gap floor 18 / 17 %, flat 3 / 2 %.
- Shots: `g-sky/sky_e60_fplus.jpg` and `g-sky/sky_e60_compat.jpg`.

Ruling 1 (the night contract) and ruling 2 ((b): the Forward+ FloodMast fill, 0.84 → 0.82) are applied. Nothing is committed.

## Files

| Path | Change |
|---|---|
| `engines/godot/look/night_sky.gdshader` | Samples `assets/sky/lot_night_sky.exr` at `SKY_COORDS` (mip 0). Below the horizon, the haze fades from the horizon colour to ground. `energy` sets what the eye sees and `light_energy` sets the radiance map (`AT_CUBEMAP_PASS`). `encode_srgb` is for Compatibility only. With no SOURCE (`use_source` off), it draws a plain gradient between the receipt's horizon and zenith. The W13 procedural deck is gone |
| `engines/godot/look/look.gd` (sky, fog and ambient only) | `SKY_SOURCE`, `SKY_RECEIPT`, `SKY_ENERGY` 0.60 (0.67 on v1/v2; 0.60 ruled on v3, § v3 at `SKY_ENERGY` 0.60), `SKY_LIGHT_ENERGY` 0.12; `load_sky_source()` and `read_sky_receipt()`; `SKY_HORIZON` and `SKY_ZENITH` are now read from the receipt at startup; `sky_error`; fog = the receipt's horizon at `SKY_ENERGY`. On v2, ruling (b): Forward+ `COVER_SCALE` FloodMast fill 0.84 → 0.82 |
| `engines/godot/tests/test_look_sky.gd` | New (below) |
| `engines/godot/tests/test_look_contract.gd` | The night keys, as ruled (§ Rulings): `night_errs()` replaces the W13 blue-black bounds |

## Decisions

- **Load path: one source, no copies.** `Image.load_from_file(globalize_path("res://") + "../../assets/sky/lot_night_sky.exr")`,
  as world.gd reads the kit GLBs. Load and convert take 146–254 ms at startup. The receipt is read the same way.
- **Compression: RGBE9995, not BC6H.**
  - Runtime BC6H (`Image.compress(COMPRESS_BPTC)`) took **41 s of CPU** at load on this binary.
  - A pre-compressed BC6H file would be a second copy of the SOURCE.
  - The EXR's half-float RGB is converted once to shared-exponent RGBE9995: 4 bytes a texel, **8 MB** (BC6H would be 2.1 MB, half float 12–16 MB). Measured texture memory: Forward+ +7.6 MB, Compatibility +10.4 MB.
  - RGBE keeps 9 mantissa bits, under 0.4 % error a texel; the test holds the row means to 1 %.
- **Ambient and reflections: calibrated and decoupled from the display.**
  - The eye sees the SOURCE × `SKY_ENERGY` (0.67 on v1, ruled 0.60 on v3). On v1 × 0.67 under exposure 1.5 gave sRGB (0.19, 0.25, 0.30); on v3 at 0.60 the hero sky reads about (0.21, 0.25, 0.28). The reference's is (0.21–0.24, 0.25–0.28, 0.28–0.31).
  - The radiance map, which is the sky's half of the ambient and the sky reflections, is the SOURCE × 0.12, set in the shader with `AT_CUBEMAP_PASS`.
  - 0.12 was chosen on probe spheres 80 m over the Lot, with the moon and every lamp off (linear display luminance):

    | Probe | W13 sky | SOURCE sky at 0.12 |
    |---|---|---|
    | Matte, Forward+ | 0.0268 | 0.027 |
    | Matte, Compatibility | 0.0246 | 0.027 |
    | Chrome, Forward+ | 0.0021 | 0.0016 |
    | Chrome, Compatibility | 0.0005 | 0.0005 |

  - At the display energy, ambient would rise 44–74 %. The ambient contribution (0.5) and energy (1.6) are unchanged.
- **Fog = horizon = the receipt.** `fog_light_color` is the receipt's `sky.horizon_linear`, sRGB-encoded (0.290, 0.322, 0.341). `fog_light_energy` is `SKY_ENERGY`, so on screen the fog is the horizon. A re-rendered sky re-colours the fog with no code change. The fog is now about 3.6× brighter than W13's, so the far Lot sinks into a lighter haze.

## Tests: `test_look_sky.gd` (headless, plus the axes with a renderer)

**What it checks, headless:**
- **Load:** the SOURCE loads from the shared path (no copy under `engines/godot`), at 2048×1024, as RGBE9995.
- **Material, per renderer** (`forward_plus`, `mobile`, `gl_compatibility`):
  - `use_source` is on;
  - the texture is the SOURCE;
  - `encode_srgb` is on for Compatibility only;
  - both energies are set, and pinned to the ruled 0.60 / 0.12;
  - fog = `SKY_HORIZON` = the receipt (within 1e-4 linear), and the sky's horizon colour equals them.
- **Radiance:** the SOURCE's radiance at the horizon and zenith directions, through `SKY_COORDS`, matches the receipt within 1 %.
- **Missing EXR: a clear error, plus a documented fallback.**
  - `load_sky_source()` names the missing file.
  - Look sets `sky_error` and pushes it to the log.
  - It then draws the gradient with the receipt's horizon still as fog.

**With a renderer:** each axis shows its marker at the screen centre. This runs with a marker panorama built in the test, or with BL-DCC's `markers_256.exr` (`SKY_MARKERS=<exr>`).
- -Z red, +X green, +Z blue, -X yellow and +Y white all read correctly, on Forward+ and on Compatibility.
- BL-DCC's EXR and the built panorama give the same pixels.

**Mutants: 13 of 13 killed** (`scratchpad/g-sky/mutsky.py`):

| Mutant | Killed by |
|---|---|
| S1: path pointed to a copy under engines/godot | headless |
| S1b: half float kept | headless |
| S2: `encode_srgb` on both renderers | headless |
| S2b: `encode_srgb` on neither | headless |
| S3: fog is the W13 colour | headless |
| S3b: fog energy 1 | headless |
| S3c: horizon read from the zenith key | headless |
| S4: SOURCE flipped | headless |
| S4b: SOURCE through 8 bits | headless |
| S5: missing EXR gives no error | headless |
| S5b: missing EXR still flags the source | headless |
| S6: light energy = display energy | headless |
| S7: the shader samples a quarter turn off | the rendered axes, both renderers (the baseline passes) |

## The cover bar, re-run (binding views, through run.gd, split as in COVER.md §8)

| View | Forward+ before → after | Compatibility before → after |
|---|---|---|
| corgi base 10 m (Footing / BagWall / ballast), body | 38.7 / 39.1 / 32.6 → 39.3 / 39.4 / 33.0 | 26.0 / 32.7 / 20.4 → 28.2 / 33.6 / 21.2 |
| corgi base 10 m, edge | 25.1 / 47.7 / 44.4 → 22.5 / 23.2 / 30.9 | 22.7 / 47.4 / 32.9 → 19.9 / 21.5 / 17.3 |
| corgi base 30 m, body | 37.2 / 37.4 / 33.8 → 38.0 / 38.3 / 34.7 | 27.5 / 35.6 / 21.8 → 30.7 / 38.3 / 24.6 |
| corgi base 30 m, edge | 21.5 / 33.4 / 24.1 → 20.7 / 17.3 / 23.0 | 24.3 / 33.3 / 26.2 → 18.7 / 16.8 / 19.0 |
| corgi base 30 m, gap | 13.2 → 11.6 | 20.4 → 20.0 |
| cat base 10 m (ballast), body | 39.8 → **40.2: FAIL (bar 40)** | 33.7 → 34.4 |

- **Every other gate passes:** edge ≥ 15, gap ≥ 10, std ×, draws ×1.000.
- **Why the edges fell.** Pieces seen against the sky now stand against a lit overcast instead of black. The bag rims at 30 m keep 16.8–17.3, against the bar of 15.
- **The cat-base miss, 0.2 L\* over, is a mask effect, not a brighter ballast.**
  - It barely moves with the sky's light energy (0.06: 40.1), its display energy (0.55: 40.1) or the ambient energy (1.45: 40.1).
  - Its measured pixel count drops from 10,894 to 10,852: the brighter sky behind it pushes darker anti-aliased edge texels out of the mask's grey/black threshold.
  - HEAD's sky in the same tree gives 39.8.

## Shots and the art verdict

Before and after, at the spawn, slab 10 m, slab 30 m and hero views (fov 72, no HUD), in both renderers:
- the montages are `scratchpad/g-sky/sky_{spawn,slab10,slab30,hero}.jpg`;
- `scratchpad/g-sky/sky_vs_ref.jpg` puts the hero view next to `hardened-corgi-hero.jpg`.

| | Reference | After, Forward+ | Before, Forward+ |
|---|---|---|---|
| Sky, mean sRGB | (0.21–0.24, 0.25–0.28, 0.28–0.31) | (0.19, 0.25, 0.30) | (0.04, 0.07, 0.11) |
| Billow contrast, p90 / p10 luminance | 3.0–5.9 | **1.42** | 3.2 |
| Hue, r/b and g/b | 0.54–0.60 and 0.81–0.84 | **0.39 and 0.70** | not measured |

**What works.** It now reads as an overcast night, not a black void: the value is right, and the cranes, trees and sheds stand out against the deck. Compatibility and Forward+ match closely (Compatibility's horizon haze is a little greyer).

**What doesn't.**
- The billows are soft and low in contrast: a uniform slate, with no dark underbellies or bright wisps.
- The deck is too blue. The game's teal grade pushes it further: EXR r/b 0.47 becomes 0.39 in-engine.
- The "lit from below" sodium warmth is only a faint band just over the horizon. The reference's warm glow around the yard's lamps is missing.

**Asks for BL-DCC's v2**, each measured in-engine at the hero view:
1. Billow contrast p90/p10 ≥ 2.5: darker cloud bases between lighter wisps. A density or thickness variation in the deck is enough; a volumetric deck is not needed.
2. Overhead hue, in the EXR linear, r/b about 0.65–0.7 and g/b about 0.86. That lands at about 0.55 and 0.82 in-engine after the grade.
3. A visible warm underbelly over the yard: at 5–25° elevation toward the floods, r/b ≥ 0.7. It should be warm patches over the lamps, not a uniform band.

## Cost

| Item | Result |
|---|---|
| Frame time, SOURCE against the W13 procedural sky | 0.94× on Forward+, 1.00× on Compatibility. A/B/A/B in one process at the hero view, software renderers, noise ±25 % at load 6–10: a ratio only |
| Draws | unchanged: 17 at the slab and hero views; 20 and 26 at spawn |
| Startup | +146–254 ms (EXR load and RGBE convert) |
| Texture memory | +8 MB |

## Rulings (lead, 2026-10-18)

### 1. The night contract: applied (`tests/test_look_contract.gd`; the Godot look lane now owns it)

The north star moved the target from W13's dark blue-black sky to a lit overcast deck, so the absolute luminance bounds
are gone: zenith sRGB ≤ 0.05 and horizon ≤ 0.15. They rejected the SOURCE's receipt, whose zenith is (0.234, 0.279,
0.327) and horizon (0.290, 0.322, 0.341). A static `night_errs(zenith, horizon, fog)` now checks the look's keys in
linear:

| Check | Rule | v1 receipt |
|---|---|---|
| `warm` | horizon r ≤ b. The receipt's horizon is the mean of every column of rows 511–512, so it is the azimuth average, and `test_look_sky` pins it to the EXR. v2's warm lamp patches may warm parts of the horizon, but not its average | r 0.068 ≤ b 0.095 |
| `ceiling` | horizon linear luminance ≤ `NIGHT_HORIZON_MAX` 0.10. The reference is about 0.06–0.08 and the W12 dusk horizon was 0.22 | 0.082 |
| `zenith` | the zenith's linear luminance ≤ the horizon's | 0.061 ≤ 0.082 |
| `fog` | the fog colour = the horizon colour | equal |

The test also runs `night_errs` on a `DUSK` table: bright dusk at linear 0.3, warm dusk with r > b under the ceiling,
a zenith brighter than the horizon, and fog in the zenith's colour. Each must report its own failure, so the predicate
cannot be weakened without the test failing.

Mutants: each ran headless in a scratch copy, one at a time under `nice`. The baseline (the v1 receipt) passes.

| Mutant | Result |
|---|---|
| D1: the receipt's horizon is dusk, linear (0.29, 0.30, 0.33) | KILLED: `ceiling: … 0.300 is over the night ceiling 0.10` |
| D2: the receipt's horizon is warm, linear (0.09, 0.075, 0.06) | KILLED: `warm: … r > b` |
| D3: the receipt's zenith is linear (0.10, 0.11, 0.12) | KILLED: `zenith: … 0.109 is brighter than the horizon (0.082)` |
| D4: look.gd sets the fog to `SKY_ZENITH` | KILLED: `fog: …` |
| T1: ceiling 0.5 | KILLED: `night_errs passes a bright dusk horizon` |
| T2: the warm check off | KILLED: `night_errs passes a warm dusk horizon` |
| T3: the zenith check off | KILLED: `night_errs passes a zenith brighter than the horizon` |
| T4: the fog check off | KILLED: `night_errs passes fog the zenith's colour` |

The headless suite (a fresh copy of the tree): **27 of 27 PASS** (`GODOT TESTS: PASS`), up from 26 of 27.

### 2. The cat-base ceiling, 10 m, Forward+, 40.2 against 40: not tuned against v1; applied on v2 (§ v2)

BL-DCC's v2 is coming: less blue (EXR r/b about 0.65–0.7, g/b about 0.86), billow contrast p90/p10 ≥ 2.5, and warm
sodium patches over the lamps. It will change the lighting again. When the v2 EXR lands:

1. Re-run `test_look_sky`, the suite and the binding cover views.
2. If the ceiling still breaks, apply (b): Forward+'s FloodMast cover fill scale, inside the ruled range [0.5, 2.5].
3. Re-run every Forward+ view the FloodMast appears in, at 10, 30 and 60 m (the cat-base ballast and the pole views),
   so that edges and gaps hold.

`test_look_cover.gd`'s metric stays as it is: no mask erosion. Erosion would be a separate, measured change to the
metric, with its own before and after on every view. It is not a fix for a 0.2 overrun. `docs/qa/w15/COVER.md` is
updated only after the v2 re-run.

## v2: BL-DCC's sky v2 (`lot_night_sky.exr` sha 7916cd77…), re-run as ruled

**Suite.** test_look_sky and the whole headless suite pass on v2: **27 of 27**. That includes the night contract on
the v2 receipt (horizon linear (0.0684, 0.0846, 0.0949), luminance 0.082; zenith (0.0379, 0.0489, 0.0586), 0.047).
After (b), it is still 27 of 27; the FloodMast's Forward+ glow peak is 0.805 (it was 0.809).

**The binding cover views on v2, before (b).** Every number matches v1 to within 0.1 L\*: v2 does not change the
Lot's light, because the horizon is unchanged and `SKY_LIGHT_ENERGY` stays 0.12. The cat base at 10 m on Forward+ is
still **40.2**, so (b) applies.

| View | Forward+ | Compatibility |
|---|---|---|
| corgi base 10 m | PASS (darkest 33.0, gap 30.1) | PASS (21.2, gap 20.4) |
| corgi base 30 m | PASS (34.7, gap 11.7) | PASS (24.6, gap 20.2) |
| cat base 10 m | **FAIL, 40.2 > 40** | PASS (34.4, gap 33.7) |

**(b): Forward+ `COVER_SCALE` FloodMast fill 0.84 → 0.82** (`look.gd`; inside the ruled range [0.5, 2.5]; Mobile
takes the same row; Compatibility is untouched). Every Forward+ FloodMast sample (`COVER_ONLY=FloodMast`) was re-run
at 10, 30 and 60 m. All of them pass:

| Sample | m | 0.84: body / edge | 0.82: body / edge | Gap (0.82) |
|---|---|---|---|---|
| corgi base ballast | 10 | 33.0 / 33.4 | 32.6 / 33.1 | 29.7 |
| cat base ballast | 10 | **40.2** / 25.1 | **39.8** / 24.8 | 38.1 |
| corgi base ballast | 30 | 35.3 / 22.5 | 35.0 / 22.3 | 11.8 |
| cat base ballast | 30 | 38.0 / 33.7 | 37.6 / 33.4 | 32.8 |
| corgi base ballast | 60 | 32.6 / 21.1 | 32.4 / 20.8 | 8.4 (REPORTED, as ruled) |
| cat base ballast | 60 | no clear view (as in item 11) | no clear view | — |

The poles do not change (their edges at 10 / 30 / 60 m: corgi 24.6 / 7.1 / 4.2, cat 17.5 / 18.0 / 12.5; the pole
is not cover). `test_look_cover.gd` is not changed, and its metric is not changed.

**Shots** (v1 against v2; Forward+ and Compatibility; spawn, slab 10 m, slab 30 m, hero) are in the scratchpad as
`g-sky/sky_v2_{spawn,slab10,slab30,hero}.jpg` and `g-sky/sky_v2_vs_ref.jpg`. Draws are unchanged: hero 17, spawn 20
on Forward+ and 26 on Compatibility.

**The art verdict at the real hero camera.** The camera: eye (0, 1.38, −10) looking at (−12, 40, 72); bearing 188°
(0 = −Z, 90 = +X), pitch 25°, 72° vertical field of view (104.5° horizontal) at 1280 × 720. BL-DCC's estimate was
193° and 20°. The sky band is the top 330 px of the frame, in linear:

| Frame | p90/p10 | r/b | g/b | Tiles at the gap floor (< 1.25 × p10) | Flat tiles (16 px, cv < 3 %) |
|---|---|---|---|---|---|
| Reference, left sky | 3.02 | 0.60 | 0.84 | 23 % | 3 % |
| Reference, right sky | 5.94 | 0.54 | 0.81 | 9 % | 2 % |
| v1, Forward+ | 1.42 | 0.39 | 0.70 | 61 % | 59 % |
| v2, Forward+ | **3.63** | **0.58** | **0.82** | **46 %** | **35 %** |
| v2, Compatibility | 3.95 | 0.57 | 0.82 | 45 % | 38 % |

- **The numbers now fit the reference.** Contrast, hue and the warm underlit patches near the horizon are all in the
  reference's range. That fixes v1's asks.
- **The weather does not fit. In-engine, v2 reads as scattered cloud, not overcast.** It shows fragments of
  stratocumulus and wisps over a flat, clear slate sky. The right half of the hero frame and the zenith are an even,
  structureless blue-grey. Fog only touches the band just above the horizon. AgX greys the clouds but does not join
  them. The rain falls from what reads as a clearing sky. At spawn it reads as a fair-weather night.
- The table shows the cause. Almost half of v2's sky sits at the clear-gap floor, and over a third has no structure.
  The reference has 9–23 % at its floor and 2–3 % flat: its dark regions are thinner parts of one deck, not holes.
  v2's p90/p10 passes, but it passes on cloud against clear sky, not on billows within a deck.

**Asks for v3 (BL-DCC).**
1. **A continuous deck.** Coverage about 1 at the hero framing: a lower, underlit overcast layer under the billows, so
   that the gaps become darker cloud and not clear sky.
   - Measured at the real hero camera (above): ≤ 25 % of sky tiles at the gap floor, and ≤ 10 % flat (cv < 3 %).
   - Keep p90/p10 between 2.5 and about 4.5, made by thick and thin parts of the deck.
2. **Billows, not wisps.** Large, soft, rounded masses (the reference's billows span about 10–20° of the frame). Lose
   the thin streaky fragments at 5–15° above the horizon; at that height the deck should merge into the horizon haze.
3. **Keep v2's colour** (in-frame r/b 0.57–0.58, g/b 0.82) and the warm sodium underlight over the lamps. Keep the
   receipt horizon under the night ceiling (linear luminance ≤ 0.10; v2 is 0.082), cold (r ≤ b), with the zenith no
   brighter than the horizon: the night contract tests all three.
4. **Keep the axes, the projection and the receipt format.** The loader and `test_look_sky` depend on them.

## v3: BL-DCC's sky v3 (`lot_night_sky.exr` sha 1f6e85de…), re-run as ruled

**Suite.** 27 of 27 PASS on v3, including the night contract on the v3 receipt. The horizon is linear (0.0685,
0.0847, 0.0950), luminance 0.082, cold. The zenith is (0.0507, 0.0641, 0.0764), luminance 0.062, no brighter than
the horizon.

**The binding cover views on v3** (FloodMast fill 0.82, unchanged). Logs are in `g-sky/logs/v3/`.

| View | Forward+ | Compatibility |
|---|---|---|
| corgi base 10 m | PASS: darkest 32.6, gap 29.8 | PASS: 21.2, gap 20.5 |
| corgi base 30 m | PASS, but the BagWall edge is **15.4** (19.0 on v2) | **FAIL: BagWall edge 15.0 < 15** (18.5 on v2) |
| cat base 10 m | PASS: 39.8 (the ceiling holds), gap 38.1 | PASS: 34.4, gap 33.7 |

**Why the bag edge falls.** Behind the corgi-rim bags at 30 m, the sky just above the skyline (frame rows 270–330)
is 2–6 L\* brighter on v3, on both renderers. The bags are brighter than the sky, so their silhouette edge drops:
- Compatibility: in 44.9 → 45.0, out 26.8 → 30.6.
- Forward+: in 43.3 → 43.3, out 24.3 → 27.9.

This is what v3 was asked for: v2's dark clear gaps are now mid-grey cloud. The FloodMast ceiling does not move.

**A measured fix, applied in scratch only.** Lowering `SKY_ENERGY` (the background's display energy; it is also
`fog_light_energy`) from 0.67 to **0.60** brings back the corgi base 30 m bag edge: **16.6** on Compatibility and
**17.0** on Forward+. Everything else in that view holds (gaps 20.5 and 11.6). Logs: `g-sky/logs/v3_e60/`.

This does not change the radiance map (`SKY_LIGHT_ENERGY` 0.12), so it does not change the ambient. It does dim the
exponential fog's colour by the same factor, so landing it needs the whole 15-run bar on both renderers. In-frame,
the sky's mean Y would go from about 0.060 to about 0.054, which is still inside the reference's 0.054–0.066. It is
not landed: it waits for the lead's ruling.

**The hero stats in-engine** (my method: the real hero camera, the top 330 px, linear; also the overhead view `up`,
bearing 188°, pitch 60°, the whole frame). "Grain" is the std of each pixel over its 5 × 5 box mean, divided by that
mean.

| Frame | Mean Y | p90/p10 | r/b | g/b | Gap floor | Flat | Grain |
|---|---|---|---|---|---|---|---|
| Reference, left / right | 0.066 / 0.054 | 3.02 / 5.94 | 0.60 / 0.54 | 0.84 / 0.81 | 23 / 9 % | 3 / 2 % | 2.9 / 3.5 % |
| v2, Forward+ / Compatibility | 0.067 / 0.066 | 3.63 / 3.95 | 0.58 / 0.57 | 0.82 / 0.82 | 46 / 45 % | 35 / 38 % | 4.3 / 3.0 % |
| **v3, Forward+ / Compatibility** | 0.061 / 0.060 | **3.37 / 3.65** | **0.57 / 0.56** | **0.81 / 0.81** | **16 / 17 %** | **3 / 2 %** | 4.9 / 3.1 % |
| v3 `up`, Forward+ / Compatibility | 0.056 / 0.054 | 3.14 / 3.35 | 0.55 / 0.54 | 0.80 / 0.80 | 18 / 18 % | 4 / 4 % | 4.2 / 2.4 % |

Forward+'s grain includes the rain streaks and its own noise: v1's smooth sky already read 4.2 %.

**The art verdict: v3 reads as one overcast rain deck in-engine.** The deck is continuous, with darker and lighter
billows and a warm sodium underlight over the yard. The rain now falls from a sky that could hold it. Every hero
number sits inside the reference's range: v3 meets every ask made of v2 (gap floor ≤ 25 %, flat ≤ 10 %, p90/p10 2.5
to 4.5, and v2's hue).

**The lead's grain concern.** In-engine, the overhead mottle reads as soft, cottony cloud texture, not as noise. At 2×
its features are about 10–20 px, with no pixel-scale speckle, because the 2048-wide EXR is magnified about 2× at the
hero's field of view and filtered bilinearly. Its grain on Compatibility, 3.1 % (2.4 % overhead), equals the
reference's own 2.9–3.5 %. It is busier than the reference's large, soft masses: a v4 polish note, not a blocker.
Softening it would bring back flat tiles (BL-DCC: 0.15 gave 44 % flat). The trade is not worth it.

Shots are in the session scratchpad, under `g-sky/`:
- `sky_v3_{spawn,slab10,slab30,hero}.jpg` (v2 against v3, both renderers);
- `sky_v3_up.jpg`;
- `sky_v3_vs_ref.jpg`;
- `sky_v3_grain_crops.jpg` (2× crops);
- `bag30_v2v3.jpg` (the failing view).

Draws are unchanged: hero 17; spawn 20 on Forward+ and 26 on Compatibility.

**Status: the art is accepted on Godot; the cover bar holds it back** (Compatibility corgi base 30 m, the bag edge
at 15.0). The ruling is wanted on: (1) `SKY_ENERGY` 0.60 plus the full bar re-run; (2) BL-DCC darkens the band 0–5°
above the skyline (v3.1); or (3) a Compatibility BagWall fill scale. (3) is unlikely to work: the same bags' body is
38.4 at 30 m, close to the 40 ceiling.

## v3 at `SKY_ENERGY` 0.60 (ruled): the full bar, stopped at its first failure

`look.gd` `SKY_ENERGY` 0.67 → 0.60 is applied, as ruled. The full 15-run bar ran in order: Forward+ first, at 10,
then 30, then 60 m. The card says to stop at the first failure and not tune, so it stopped after 8 runs. Logs are in
`g-sky/logs/e60full/`.

| Forward+ run | Result (edge / body L\*) |
|---|---|
| corgi base 10 m | PASS: Footing 22.7 / 39.2, BagWall 25.8 / 39.4, FloodMast 34.1 / 32.5; gap 29.9 |
| cat base 10 m | PASS: FloodMast 25.1 / **39.7**; gap 38.1 |
| west lane 10 m | PASS: Container20 35.2 / 35.4, BagWall 41.6 / 39.4 |
| east lane 10 m | PASS: Pipe 36.0 / 38.6 |
| slab approach 10 m | PASS: BagWall 28.7 / 38.3 |
| corgi base 30 m | PASS: the bag edge is **17.0** (the fix works); gap 11.6 |
| cat base 30 m | PASS: FloodMast 33.7 / 37.5; gap 32.8 |
| **west lane 30 m** | **FAIL: Container20[1] edge 11.9 < 15** (body 37.5; BagWall 28.2) |

Not run: the other 7 Forward+ runs (east lane and slab approach at 30 m, and all five places at 60 m), all 15
Compatibility runs, the suite and the shots at 0.60.

**The cause: the SOURCE sky itself, not the energy.** The same view and renderer, on v3:

| Sky | Container20 edge | in / out L\* |
|---|---|---|
| HEAD's W13 procedural sky | 18.6 (item 11's number) | 23.3 / 4.7 |
| SOURCE v3, energy 0.67 | 12.2 | 24.4 / 16.5 |
| SOURCE v3, energy 0.60 | 11.9 | 24.3 / 15.3 |

The HEAD-sky run used HEAD's `look.gd` and shader in the scratch copy. It was interrupted when the lanes paused, but
its result had already been written. The scratch copy is restored to the shared tree.

In the edge masks (`g-sky/west30_sky_cause.jpg`), the failing pixels are the container's dark top rail and its right
corner post, seen against the lit overcast deck. Against W13's near-black sky they stood out; against a lit deck
they sit at nearly the sky's value. No sky energy fixes this while the sky stays a lit deck: 0.60 even reads 0.3
lower than 0.67, because the dimmer deck moves toward the rail's value.

It is not measured on v1 or v2. Every earlier G-SKY cover re-run was the three binding views, and west lane was not
one of them. So this is the first full bar under any SOURCE sky.

**Not tuned; a ruling is needed.** The candidates, none of them measured:
1. Raise Forward+'s Container20 fill (×1.32 now) to lift the rail. The headroom is small: body 37.5 at 30 m against
   the 40 ceiling, and 35.4 at 10 m.
2. An edge metric that judges a cover piece's silhouette against the sky separately from its edge against the Lot (a
   change to `test_look_cover.gd`'s metric, the lead's call). A lit overcast puts any dark rail at about the sky's
   value. The reference shows the same thing: the gantry against the sky.
3. Accept the Forward+ west lane 30 m edge as a known item, like the 60 m gap.

`COVER.md` is not touched.

## The split edge ring (lead's ruling, 2026-10-23): the exact rule, for the web twin to mirror

The cover bar asks whether a piece reads as cover **against the Lot**. Its silhouette against the sky is a different
read, owned by the AIR / BACKDROP passes and the 30 m check. With the lit overcast deck, the old ring tested the sky
by accident: on Forward+, west lane 30 m, the container's dark top rail sits at the deck's value. So
`test_look_cover.gd` (rendered part) now splits the ring. Nothing else changed: the ceiling, lift, std, gap and draw
rules, and every shipped value, are as they were.

1. **The ring is unchanged.** Each pair is a visible part pixel next to an exterior pixel (outside the piece's
   whole-outline mask, reachable from the rect's border). It compares L\* 2 px inside with L\* 2 px outside, falling
   back to the pixel itself when the 2 px sample leaves the mask or the exterior.
2. **Sky or Lot, per pair, by the outside sample** (the 2 px-out pixel, or its fallback). An extra frame, rendered
   after the normal frame, carries the sky mask. It is a full-screen unshaded quad (`SKY_MASK_SHADER`) that reads the
   depth buffer and turns it into view-space distance:
   - Forward+: ndc = (uv × 2 − 1, depth);
   - Compatibility: ndc = (uv, depth) × 2 − 1;
   - either way, view = inverse projection × ndc.

   It paints grey where the distance is ≥ `SKY_FAR_FRAC` (0.98) × the camera's far plane (400 m), and black
   elsewhere. A pixel whose R + G + B > 150 in that frame is sky; anything else is Lot geometry. On the web, the same
   test on the depth buffer (or the sky mesh's own mask) is enough. What matters is: "is the outside sample the sky
   at the far plane, or something the Lot drew?"
3. **Gated:** the mean |ΔL\*| over the **Lot-backed** pairs must be ≥ `BAR_EDGE` (15), when there are at least
   `EDGE_MIN_LOT` = **30** such pairs. The printout carries the Lot-backed mean's standard error.
4. **Reported, not gated:** the sky-backed pairs' count, mean |ΔL\*| and mean outside L\*, and the old all-pairs mean,
   on a second `ring:` line under every view.
5. **Fewer than 30 Lot-backed pairs: "sky-backed only".** The edge is not gated, and the view is printed as sky-backed
   only. It is judged on its body (the ceiling, lift and std rules, as before) and on the value gap at its place and
   distance:
   - at 10 / 30 m with a gated gap: it passes or fails with that gap;
   - at 10 / 30 m with no gap (a place without a mast pole: west lane, east lane, slab approach): it **fails**
     ("no gated value gap to judge it by"), so it never passes silently;
   - at 60 m, where the gap itself is only reported: it is **REPORTED**.
6. **Why 30.** That is three times the 10 pairs under which a view is skipped outright, and about 3.6 m of silhouette
   at 60 m (8.3 px/m at FOV 72° on 720 px). The smallest real rings with no sky in them are the 60 m bag walls and the
   ballast, at 55–70 pairs: they stay gated. With 60 they did not (they turned "sky-backed only" with no sky in their
   ring), which is why 60 was dropped. The standard error printed beside each mean shows the count's precision.

**The proof on HEAD's W13 sky** (scratch copy: HEAD's `look.gd` and `night_sky.gdshader`, the split test; all 15 runs
on both renderers; logs in `g-sky/logs/headsplit/`):
- The old all-pairs edge reproduces item 11's published edge (COVER.md §4) in **every** view on both renderers.
- In each ring with no sky pairs, the Lot-backed edge equals the old edge exactly.
- The numbers move only where sky pairs were in the ring.

| View | Forward+: item 11 → Lot-backed (n Lot / n sky) | Compatibility: item 11 → Lot-backed (n Lot / n sky) | Verdict |
|---|---|---|---|
| corgi base BagWall 10 m | 47.7 → 52.7 (7 / 297) | 47.4 → 50.4 (3 / 303) | ok → **sky-backed only**, judged by the corgi-base gap: 30.8 / 19.9, pass |
| corgi base BagWall 30 m | 33.4 → 31.3 (25 / 62) | 33.3 → 24.2 (26 / 81) | ok → **sky-backed only**, judged by the gap: 13.2 / 20.4, pass |
| corgi base FloodMast 10 m | 44.4 → 44.2 (166 / 148) | 32.9 → 34.5 (162 / 149) | ok → ok |
| east lane Pipe 10 m | 50.2 → 38.3 (184 / 893) | 46.4 → 27.2 (198 / 894) | ok → ok |
| east lane Pipe 30 m | 39.2 → 38.1 (174 / 80) | 35.8 → 33.0 (171 / 82) | ok → ok |
| east lane Pipe 60 m | 26.6 → 23.3 (43 / 84) | 29.4 → 17.4 (31 / 90) | ok → ok |
| west lane Container20 10 m | 40.5 → 37.5 (1208 / 353) | 24.0 → 21.5 (1207 / 355) | ok → ok |
| west lane Container20 30 m | 18.6 → 18.8 (627 / 513) | 19.4 → 17.4 (626 / 518) | ok → ok |
| west lane Container20 60 m | 21.8 → 16.8 (244 / 187) | 20.5 → 15.7 (205 / 226) | ok → ok |
| every other view | unchanged (no sky pairs) | unchanged | ok → ok |

- The corgi-rim bags sit on the rim, above eye height, so from the base they are seen almost wholly against the sky.
  Under the split they are judged by their value gap to the mast pole, which they hold.
- The tightest Lot-backed edges are on the 60 m rows: Container20 at 15.7 (Compatibility) and 16.8 (Forward+). They
  pass, but they are the margins to watch.
- The first proof run used a minimum of 60, which made four sky-free 60 m rings "sky-backed only". Those four views
  are re-run with the final rule below.

**The split, re-checked and mutated** (logs in `g-sky/logs/split/`):
- **The four HEAD-sky 60 m views that the 60-pair minimum had failed** (corgi base and east lane, both renderers),
  re-run with the final rule: all PASS. Their rings are gated again: corgi base FloodMast 58 pairs, 26.3 ± 1.0
  (Compatibility); east lane Pipe 43 / 31 pairs, 23.3 / 17.4.
- **Mutant A** (the container's fill and sheen at 0 on both renderers, so it reads at its ground's value): **killed**
  on both, by the gated Lot-backed edge. Forward+: 0.6 at 10 m, 2.1 at 30 m. Compatibility: 0.9 and 3.0. Its
  sky-backed edge stayed high (24–27), which is what the old all-pairs mean would have half-counted.
- **Mutant B** (every outside sample classed as sky): no view passes silently. Every view prints "sky-backed only".
  - corgi base 10 m: judged by the gated gap (30.1, pass);
  - every 60 m view: REPORTED;
  - west lane 10 m: **FAIL** ("no gated value gap to judge it by").

## The full bar at `SKY_ENERGY` 0.60 with the split: stopped at Forward+ west lane 60 m

On v3 with the split ring, the bar ran in order (Forward+ first, at 10, then 30, then 60 m). It stopped after 13
runs. Logs and shots are in `g-sky/logs/final060/` and `g-sky/shots/final060/`.

| Forward+ view | Lot-backed edge (pairs, SE) | Sky-backed (reported) | Result |
|---|---|---|---|
| corgi base 10 m | Footing 22.7 (366, 0.6); BagWall 27.5 (11, sky-backed only → gap 30.1+); FloodMast 40.4 (170) | BagWall 25.8, FloodMast 26.7 | PASS |
| cat base 10 m | FloodMast 25.1 (227); body 39.7 | — | PASS |
| west lane 10 m | Container20 37.2 (1215); BagWall 41.6 (286) | Container20 28.3 | PASS |
| east lane 10 m | Pipe 35.6 (198) | 36.1 | PASS |
| slab approach 10 m | BagWall 28.7 (640) | — | PASS |
| corgi base 30 m | Footing 20.9 (130); BagWall 18.1 (45, 1.5); FloodMast 22.9 (109) | BagWall 16.3 | PASS |
| cat base 30 m | FloodMast 33.7 (68) | — | PASS |
| west lane 30 m | Container20 **17.4** (645, 0.2); BagWall 28.2 (112) | Container20 4.8 | PASS (it was the 11.9 failure) |
| east lane 30 m | Pipe 33.3 (177) | 23.4 | PASS |
| slab approach 30 m | BagWall 23.8 (147) | — | PASS |
| corgi base 60 m | Footing 15.4 (87); BagWall 16.0 (65); FloodMast 23.1 (59) | — | PASS |
| cat base 60 m | (the ballast has no clear view, as in item 11) | — | PASS |
| **west lane 60 m** | **Container20 13.2 (248, 0.6) < 15**; BagWall 17.1 (72) | Container20 13.8 | **FAIL: stopped** |

Not run: Forward+ east lane and slab approach at 60 m, all 15 Compatibility runs, and the shots. The headless suite
ran after the stop: **27 / 27 PASS** with the split test.

**Why: the fog, not the ring.** This failure is Lot-backed, so the split does not cause it and cannot hide it. The
same ring on HEAD's W13 sky reads **16.8** (244 pairs): in 23.1, out 6.3. On v3 at 0.60 it reads in 24.9 and **out
11.7**: the far Lot behind the container is lighter.

The fog is the horizon "as the sky shows it". Its colour is now the receipt's horizon (linear luminance 0.082) ×
`fog_light_energy` 0.60, about 0.049. W13's was (0.11, 0.13, 0.17) sRGB × 1, about 0.015. So it is about 3.3×
brighter, and at 60 m the exponential fog (density 0.0045) and the aerial perspective (0.3) lift the Lot behind the
piece. The container's body is unchanged in kind: 35.4 / 37.5 / 37.5 at 10 / 30 / 60 m, with 4.1 / 6.4 / 7.5 with
the read off.

**Not tuned; a ruling is needed.** The candidates, none of them measured:
1. Raise Forward+'s Container20 fill (×1.32 now). The 30 m body is 37.5 against the 40 ceiling, so there is about
   2.5 L\* of headroom.
2. Fog energy below the sky's (it breaks "fog = horizon as the sky shows it", which `test_look_sky` pins:
   `fog_light_energy == SKY_ENERGY`), or a lower fog density.
3. Report the 60 m edge like the 60 m gap: 60 m is past the fight distances, and the AIR pass owns the haze.

## The Container20 fill sweep (lead's ruling: measure the knob before loosening any bar)

This ran in a private copy; the shipped rows are unchanged. Compatibility west lane 60 m as shipped is 12.2 ± 0.5
(15.7 on W13), so its margin is gone too, and its row was swept the same way (+6 / +12 / +18 %). Logs are in
`g-sky/logs/sweep/`.

| Forward+ fill | west 10 m: edge ± SE / body / std | west 30 m | west 60 m | east lane 60 m Pipe | |
|---|---|---|---|---|---|
| ×1.32 (shipped) | 37.2 ± 0.4 / 35.4 / std 12.6 vs ≥4.0 ok | 17.4 ± 0.2 / 37.5 / std 10.9 vs ≥7.1 ok | 13.2 ± 0.6 / 37.5 / std 12.7 vs ≥6.1 ok | 18.1 ± 0.9 (59) | fails |
| ×1.40 | 37.8 ± 0.4 / 36.3 / std 12.5 vs ≥4.0 ok | 18.2 ± 0.2 / 38.1 / std 10.7 vs ≥7.1 ok | 13.8 ± 0.6 / 38.0 / std 12.6 vs ≥6.1 ok | 18.1 ± 0.9 (59) | fails |
| ×1.48 | 38.4 ± 0.4 / 37.2 / std 12.4 vs ≥4.0 ok | 18.9 ± 0.2 / 38.7 / std 10.5 vs ≥7.1 ok | 14.4 ± 0.6 / 38.4 / std 12.4 vs ≥6.1 ok | 18.1 ± 0.9 (59) | fails |
| ×1.56 | 38.9 ± 0.4 / 38.0 / std 12.3 vs ≥4.0 ok | 19.6 ± 0.2 / 39.3 / std 10.3 vs ≥7.1 ok | 15.0 ± 0.6 / 38.9 / std 12.2 vs ≥6.1 ok | 18.1 ± 0.9 (59) | fails |

| Compatibility fill | west 10 m | west 30 m | west 60 m | east lane 60 m Pipe | |
|---|---|---|---|---|---|
| ×2.2 (shipped) | 21.5 ± 0.4 / 37.2 / std 17.7 vs ≥2.4 ok | 17.0 ± 0.3 / 33.7 / std 10.4 vs ≥7.5 ok | 12.2 ± 0.5 / 35.0 / std 11.0 vs ≥6.6 ok | 8.4 ± 1.3 (31) | fails |
| ×2.33 | 23.2 ± 0.4 / 39.3 / std 17.9 vs ≥2.4 ok | 18.7 ± 0.3 / 35.6 / std 10.5 vs ≥7.5 ok | 13.3 ± 0.5 / 36.6 / std 11.1 vs ≥6.6 ok | 8.4 ± 1.3 (31) | fails |
| ×2.46 | 24.9 ± 0.4 / 41.4 / std 18.0 vs ≥2.4 ok | 20.3 ± 0.3 / 37.5 / std 10.6 vs ≥7.5 ok | 14.6 ± 0.5 / 38.3 / std 11.3 vs ≥6.6 ok | 8.4 ± 1.3 (31) | fails |
| ×2.6 | 26.7 ± 0.4 / 43.5 / std 18.1 vs ≥2.4 ok | 22.0 ± 0.3 / 39.4 / std 10.7 vs ≥7.5 ok | 16.0 ± 0.5 / 40.0 / std 11.4 vs ≥6.6 ok | 8.4 ± 1.3 (31) | fails |

- **No value meets both bars.**
  - Forward+ × 1.56 reaches 15.0 ± 0.6, which the test still fails, with the 30 m body at 39.3.
  - Compatibility × 2.6 clears 60 m (16.0) but breaks the 10 m ceiling (43.5).
- **A second 60 m Lot-backed failure turned up:** Compatibility east lane Pipe, 8.4 ± 1.3 (31 pairs; 17.4 on W13). It
  is the same fog cause, and no container value moves it.
- **The status waits for the lead** (option 3: a logged known limit, the AIR pass owns the haze). COVER.md § 4b
  carries the same tables.

## Option 3 (lead's ruling, 2026-10-23): the edge is gated at 10 / 30 m and REPORTED at 60 m

The fight distances are bot ai_range 7–24 m and rifle falloff 24–48 m (`tuning.gd:32-33`). At 60 m the read belongs
to the haze, which the horizon fog sets by design, and no per-renderer fill row clears it without breaking the ceiling
(see the sweep).

`test_look_cover.gd` changes:
- `EDGE_GATED_MAX` = 30.
- `_edge_verdict(lot_n, lot_edge, d)` returns ok / FAIL (< 15 at ≤ 30 m) / REPORTED (< 15 farther) / SKY ONLY.
- A REPORTED edge prints its pairs and mean ± SE, so it never passes silently.
- The headless self-check has 8 cases, including a 60 m edge of 5 → REPORTED and a 30 m edge of 14 → FAIL.
- Mutants, all killed headless:
  - E1: 60 m gated too;
  - E2: 30 m reported too;
  - E3: REPORTED → ok.

**Known limits, the AIR pass's targets** (Lot-backed edge at 60 m, `SKY_ENERGY` 0.60):
1. Forward+ west lane 60 m Container20: **13.2 ± 0.6** (248 pairs; 16.8 on W13).
2. Compatibility west lane 60 m Container20: **12.2 ± 0.5** (205 pairs; 15.7 on W13).
3. Compatibility east lane 60 m Pipe: **8.4 ± 1.3** (31 pairs; 17.4 on W13).
4. Compatibility corgi base 60 m BagWall[3]: **14.7 ± 1.2** (60 pairs; 21.5 on W13).
5. Compatibility slab approach 60 m BagWall[13]: **10.5 ± 0.6** (71 pairs; 17.9 on W13).

All five are measured in this bar (30 of 30 runs PASS, `g-sky/logs/final/`), and each prints REPORTED. The lead
accepted all five as named known limits under the same ruling.

**The rule.** The AIR pass must raise each toward ≥ 15, or bring a measured ruling. Any later pass that lowers one by
more than 2 SE is a regression.

- **Limit:** Godot loads EXR files through its tinyexr module, which is in editor builds. The game runs on the editor binary (`npm run godot`). An exported build would need that module, or a non-EXR path.
