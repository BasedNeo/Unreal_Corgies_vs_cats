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
