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
