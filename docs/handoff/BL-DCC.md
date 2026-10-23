# BL-DCC handoff: the Blender lane of the W17 AAA look pass (card W17-AAA-BL)

**Status:** pass 1 SKY done (v3, §SKY); pass 2 WET done (§WET); pass 4 BACKDROP done (§BACKDROP); pass 4 SPLAT baked, UNTRAINED (§SPLAT). Nothing is staged or
committed: the lead owns git.
- **One file outside the lane's owned paths changed:** `tools/assets/validate-glb.mjs`. It gained a `--backdrop` mode on
  the lead's ruling, with its kit behaviour unchanged.
- **Untouched:** PARITY.md, PROGRESS.md, assets/manifest.json, .gitattributes (the lead's own working-tree edit adds
  `*.exr binary`), tools/check-boundaries.mjs, and every tw-look / g-atmos file.
- **Base:** the work began on `f7f45b5`. The branch `claude/practical-johnson-uh8g33` is now at `c010d64`, and this lane's
  files are uncommitted on top of it.

The rule from `tools/assets/README.md` holds here too: **the scripts are the source.** No `.blend` is kept or
committed (NORTH_STAR's `lot_backdrop.blend` means the script that builds it). Every build is seeded and meant to
write the same bytes twice (shown for the sky at look-check size, §SKY). `$BLENDER` below is the Blender 5.2.2 Linux x64 binary (here
`$S/blender/blender-5.2.2-linux-x64/blender`); the scripts refuse any other version. Every command runs from the repo
root. `$S` = `/tmp/claude-0/-home-user/4eb0b9e5-129d-5c0b-ac58-7a3e7a57c134/scratchpad` (scratch, never in the repo).

## Shared: `tools/blender/bllib.py`

The shared half of every script in the lane (sky_source, wet_mask, backdrop / backdrop_glb, splat_set, bake_splat):

| Helper | What it gives |
|---|---|
| `lot()`, `floods()`, `bounds()`, `heights()` | the world data from `engines/godot/data/the_lot.json` (the export of `buildTheLot`), with its sha256 for receipts; `heights()` checks the heights file against the sha256 the JSON records. No hand-typed world numbers |
| `g2b(p)` | game (x, y up, z) → Blender (x, −z, y), the same map as `tools/assets/kitlib.py` |
| `cycles(...)`, `quiet_metadata()` | a fixed Cycles CPU setup (seed 1717, 4 threads, adaptive sampling, OIDN) and no stamp metadata |
| `render_exr(...)` | renders and writes an EXR **without Cycles' render-time statistics in its header** (see §SKY determinism) |
| `pano_camera(...)` | the equirect camera at euler (90, 0, 180): the image is in Godot's SKY_COORDS |
| `sky_world(...)` | a Blender world that shows the SOURCE the right way round (for the backdrop and splat renders) |
| `Clock`, `facts()`, `write_receipt()` | wall and CPU seconds (all threads), the load at start, file facts, the receipt JSON with the licence line |

## SKY (pass 1): the night sky SOURCE (v3, current)

**SKY READY (v3).** One equirect both engines sample: Godot's `night_sky.gdshader` and the twin's EXRLoader sky. Fog colour = the receipt's horizon colour.
v3 answers g-atmos's verdict on v2 at the real hero camera ("broken stratocumulus and wisps over a flat, clear slate
sky"). It is one continuous rain deck: thick and thin parts of the same overcast, no clear gaps. The path, the axes,
the projection, the receipt format, the horizon / zenith fields and the seam fix are unchanged.

| File | Bytes | What |
|---|---|---|
| `assets/sky/lot_night_sky.exr` | 2,836,718 (2.84 MB) | the SOURCE: 2048x1024 equirect, single-part scanline OpenEXR, ZIP, RGB half float, scene-linear Rec.709, Standard view transform |
| `assets/sky/lot_night_sky.png` | 623,126 (0.62 MB) | 8-bit AgX preview, for eyes only |
| `assets/sky/lot_night_sky.receipt.json` | 9,662 | as before, plus **`sky.measures.hero_camera`** (v3) |
| `tools/blender/sky_source.py` | 36,647 | the script (v3 deck, hero-camera tile measures, `--border` tuning aid) |
| `tools/blender/bllib.py` | 13,910 | shared helpers (unchanged) |
| `tests/unit/aaa-receipts.test.ts` | 11,964 at the v3 hand-back | then 8 sky tests (v3: the hero-camera tile bounds, zenith ≤ horizon); the file now holds 22 tests for all four deliverables (§SPLAT Test) |

EXR sha256 `1f6e85debb827a217b63de0bf7549b18c466a6c2b08c93a4b6e3ce869c774857`; PNG sha256 `6eb856b329b86ab56834a12d1c37f7e3d430f1d32d9c42553dbdb7e6643f94e5`. New binaries: 3.46 MB.

**Rebuild** (repo root; 481 s wall / 971 CPU-s at load 7.83):

```
"$BLENDER" --background --factory-startup --python tools/blender/sky_source.py
```

Other modes:
- Look check: `-- --w 768 --h 384 --spp 16 --out <scratch>/look`.
- Axes: `-- --markers 1 --w 256 --h 128 --spp 4 --out <scratch>/markers`.
- Measures of any EXR: `-- --measure <exr>`.
- Tuning only: `-- --border 1 --out <scratch>/x`. It renders the hero camera's sky region at full resolution; the test
  refuses a product receipt with `border` 1.

### Colours (the receipt, read back from the EXR)

| | linear Rec.709 | sRGB-encoded |
|---|---|---|
| **horizon** (rows 511-512, = fog) | `(0.068469, 0.084701, 0.095001)`, luminance 0.0820 | `(0.29018, 0.32217, 0.34065)` |
| **zenith** (rows 0-1) | `(0.050667, 0.064053, 0.076399)`, luminance 0.0621 | `(0.24948, 0.28072, 0.3063)` |

- The horizon is the same as v2 to within 0.0001, so the fog does not move. It keeps r ≤ b, and its luminance is
  ≤ 0.10.
- The zenith is brighter than v2's (the gaps are cloud now) but still below the horizon.
- Luminance by band: 0..3 deg 0.0786, 3..10 deg 0.0712, 10..30 deg 0.0645, 30..60 deg 0.0720, 60..90 deg 0.0639.

### v3 measures (EXR linear)

**At g-atmos's real hero camera:** eye (0, 1.38, −10) → (−12, 40, 72), bearing 188, pitch 25, vertical fov 72,
1280x720. Measured on the top 330 px, 16 px tiles.

| | v2 (my measure) | v2 (g-atmos, in-engine) | **v3** | ask | reference |
|---|---|---|---|---|---|
| tiles at the gap floor (< 1.25 x p10) | 45 % | 46 % | **18 %** | ≤ 25 % | 9-23 % |
| flat tiles (std/mean < 3 %) | 46 % | 35 % | **7 %** | ≤ 10 % | 2-3 % |
| p90/p10 | 3.01 | 3.63 | **2.77** | 2.5-4.5 | 3.0-5.9 |
| r/b, g/b in frame | 0.679, 0.851 | 0.58, 0.82 (after the grade) | **0.691, 0.853** | v2's | |
| mean luminance in frame | 0.0788 | | 0.0733 | about v2's | |

- **Flood patches** (5-25 deg up, ±10 deg of each tower's bearing): r/b pit_west 0.919, pit_east 1.055, heap_west 1.066, heap_east 1.011. Between the flood pairs: 0.694, 0.684. Ask:
  ≥ 0.7.
- **Overhead (40-90 deg):** r/b 0.668, g/b 0.844.
- **Method** (also in `sky.measures.method`):
  - The frame is sampled bilinearly from the EXR, as the engine's linear filter does.
  - The gap floor counts the tiles whose mean luminance is below 1.25 x p10 of the band's pixels. Flat counts the tiles
    with std/mean < 3 %.
- **Calibration on v2:** my gap floor matches g-atmos's (45 against 46 %). My flat count is stricter (46 against
  35 %), because the EXR has no rain or grain. My p90/p10 reads lower (3.01 against 3.63).

**What changed for v3** (each is a parameter or constant in the receipt):
- **A continuous deck.** One density field mapped over a wide edge (`edge` 0.10, `body` 0.15). The thin parts are an
  underlit lower overcast (`under`: gap-end albedo 0.06, lit from below like the billows), not clear sky. Contrast
  comes from thicker and thinner parts of one deck.
- **Billows, not wisps.** 400 m masses (`mass`). The wind rolls and the 40 m wisps are almost gone (`roll` 0.1,
  `wisp` 0.08).
- **No flat tiles.** A fine albedo mottle (`mottle` 0.3, 14 m and 50 m noise) over the whole deck, faded with
  distance (1.5-5 km) so it cannot alias into streaks.
- **The low deck merges into the haze.** The haze blend is linear from `fog0` 400 m to `fog_far` 4 km (v2:
  smoothstep to 12 km), so below about 15 deg the deck melts into the horizon haze. No thin streaks remain at 5-15 deg.
- **Light and hue.**
  - `amb` 0.035 (v2 0.065): the continuous deck catches more of the light from below, so this keeps the mean and the
    zenith under the horizon.
  - `AMB_TINT` (0.64, 0.85, 1.0): back to v2's in-frame hue.
  - The sodium (floods, rings, flood clusters) is unchanged, so the warm underlight over the lamps stays.

**Tune trail** (`$S/bl-dcc/sky/v3/`):

| run | change | hero cam p90/p10 | gap | flat | note |
|---|---|---|---|---|---|
| e1-e3 (512) | gap albedo 0.22-0.3 | 1.4-1.5 | 49-63 % | 22-56 % | the whole deck lit; zenith 0.11-0.12 > horizon |
| f1-f3 (768) | wide edge, under 0.08-0.12 | 1.8-2.0 | 21-24 % | 65-70 % | too bright; **flat cannot be judged at 768** (a tile is 2.7 texels), hence `--border` |
| g2 (border, full res, 32 spp) | under 0.06, mottle 0.3 | 2.05 | 21 % | 4 % | continuous but no billows |
| h1 (border, 32 spp) | edge 0.12, body 0.15 | 2.62 | 18 % | 5 % | the read; hue then corrected |
| product, edge 0.12 (64 spp) | | **2.49** | 19 % | 6 % | the test failed it (more samples, less spread) |
| k2 (border, 64 spp) | edge 0.10 | 2.88 | 18 % | 7 % | chosen |
| **product** | | **2.77** | **18 %** | **7 %** | |

**Contact sheet: `$S/bl-dcc/contact_v3.jpg`.** It has v2 and v3 at the real hero camera, on the pit floods' bearing
and overhead, the reference, and the tile measures in the header.

**Determinism (v3):** **byte-identical at full size.** The final v3 code was rendered twice at 2048x1024 s64: the product, then a re-run to `$S/bl-dcc/sky/v3/full_rerun`. Both have EXR sha256 `1f6e85debb827a217b63de0bf7549b18c466a6c2b08c93a4b6e3ce869c774857` and PNG `6eb856b329b86ab56834a12d1c37f7e3d430f1d32d9c42553dbdb7e6643f94e5`, and `cmp` is silent for both (load 6-8; each run about 8-9 min).

**Seam:** the wrap step on the v3 preview is 0.47 against an ordinary neighbour step of 0.53 (ratio 0.9).

**Test:** `npx vitest run tests/unit/aaa-receipts.test.ts` → **8 passed**.
- New for v3:
  - the hero camera's definition, the gap floor ≤ 25 %, flat ≤ 10 % and p90/p10 in [2.5, 4.5];
  - the product receipt is not a `border` render;
  - the zenith is no brighter than the horizon, from the file.
- Removed: v2's billow check on my estimated framing (the real camera replaces it).
- It bites. `$S/bl-dcc/scripts/break_receipt.sh` with `BREAK=hash`, `patch` or `tiles` gives 1 failed | 7 passed,
  exit 1, each time:
  - hash: `assets/sky/lot_night_sky.exr sha256: expected '1f6e85debb82…' to be '0f6e85debb82…'`;
  - patch: `flood_pit_west patch r/b (file) vs receipt: expected 0.9191… to be close to 0.969`;
  - tiles (v2's numbers in the receipt): `tiles at the gap floor (%): expected 45 to be less than or equal to 25`.
- It also caught a real miss: the first v3 product had p90/p10 2.489, and the test failed it before I handed it over.

**Honest limits (v3)**
- **The texture is finer and grainier than the reference's soft billows.** The mottle that keeps tiles from being flat
  shows as grain in nearest-sampled previews. In-engine bilinear filtering softens it, but at the hero camera the deck
  is still more "textured overcast" than "soft billows". A softer mottle trades straight back into flat tiles
  (`mottle` 0.15 gave 44 % flat).
- **p90/p10 sits at the low end of the band** (2.77 here). g-atmos's in-engine numbers read higher than mine on v2
  (3.63 against 3.01).
- **Flood patches: no change needed.** They read 0.92-1.07 here; their windows sit at 5-25 deg, where the deck now
  melts into the cool haze.
- **The EXR grew** to 2.84 MB.
- The v1/v2 limits still hold: the Lot's own floods hardly light the deck, the sky is a still, and `far` squares its
  energy. (The `.gitattributes` gap is closed: the lead's working-tree edit adds `*.exr binary`.)

### Files to land (SKY)

```
tools/blender/bllib.py
tools/blender/sky_source.py
assets/sky/lot_night_sky.exr
assets/sky/lot_night_sky.png
assets/sky/lot_night_sky.receipt.json
tests/unit/aaa-receipts.test.ts
docs/handoff/BL-DCC.md
```

### History: v2 (superseded; the §SKY text as handed back for v2)

**SKY READY (v2).** One equirect both engines sample: Godot's `night_sky.gdshader` (g-atmos) and the twin's EXRLoader
sky (tw-look). Fog colour = the receipt's horizon colour in both. v2 answers the engines' in-engine verdict on v1
("too flat, too blue, not lit from below"); the path, the axes, the receipt format, the horizon / zenith fields and
the seam fix are unchanged.

| File | Bytes | What |
|---|---|---|
| `assets/sky/lot_night_sky.exr` | 2,626,659 (2.63 MB) | the SOURCE: 2048x1024 equirect, OpenEXR single-part scanline, ZIP, RGB **half float**, scene-linear Rec.709, Standard view transform (no tonemap) |
| `assets/sky/lot_night_sky.png` | 539,992 (0.54 MB) | 8-bit AgX preview, **for eyes only** (engines sample the EXR) |
| `assets/sky/lot_night_sky.receipt.json` | 8,885 | paths, bytes, sha256, every parameter and recipe constant, world-data hash, lights, axes, horizon / zenith colours, **`sky.measures`** (v2), timings, rebuild command, licence |
| `tools/blender/sky_source.py` | | the script (the source; no .blend) |
| `tools/blender/bllib.py` | | the lane's shared helpers (above; unchanged by v2) |
| `tests/unit/aaa-receipts.test.ts` | | the receipt test (deliverable 5, sky part; v2 bounds added) |

EXR sha256 `7916cd7795598c5da3d1e518034ab88ddcf4aef8359819ff10482c1118533b2a`; PNG sha256 `ec175e24dc542a2c43ade138e9cb697695537a71d77ca4875c8fc2dba405c8bc`.
v1 for the record: EXR sha256 `541faeb7de170e51fcf376128c886aeb9f1e3c6682efede08d2ede0860d87e18` (1,958,504 bytes).

**Rebuild** (repo root; 551 s wall / 1045 CPU-s here at load 8.86):

```
"$BLENDER" --background --factory-startup --python tools/blender/sky_source.py
```

- Look check (the card's 768x384 s16): `... sky_source.py -- --w 768 --h 384 --spp 16 --out <scratch>/look`.
- Axis proof: `... sky_source.py -- --markers 1 --w 256 --h 128 --spp 4 --out <scratch>/markers` (exit 0 = PASS; v2: PASS).
- Measures of any SOURCE-convention EXR, no render: `... sky_source.py -- --measure <file.exr>` (prints JSON).

#### The colours the engines use (from the receipt, read back from the EXR file)

| | linear Rec.709 (mean of the rows, every column) | sRGB-encoded | rows |
|---|---|---|---|
| **horizon** (= fog colour) | `(0.068412, 0.084637, 0.094876)` | `(0.29006, 0.32205, 0.34043)` | 511 and 512 (either side of the horizon) |
| **zenith** | `(0.037889, 0.048946, 0.058615)` | `(0.21475, 0.24512, 0.26854)` | 0 and 1 |

- The horizon barely moved from v1 `(0.068413, 0.084725, 0.094945)`, so the fog colour stays where g-atmos tuned it.
  Its linear luminance is `sky.horizon_lum` = 0.0819 (≤ 0.10), and r ≤ b.
- The zenith is darker than in v1 (v1 `(0.044577, 0.063056, 0.087282)`).
- Luminance by band: 0..3 deg 0.0754, 3..10 deg 0.0584, 10..30 deg 0.0601, 30..60 deg 0.0776, 60..90 deg 0.0649. The horizon haze is the lightest band, and the zenith is darker than the horizon.
  The 30-60 deg band is now as bright as the horizon, because the lit cloud masses sit there.
- The EXR's peak is 0.27441 linear.
- Below the horizon the EXR is still a constant dark ground `(0.006, 0.0062, 0.0068)`.

#### v2: the asks, measured in the EXR (linear, before any tonemap)

| | v1 | **v2** | ask | reference (g-atmos) |
|---|---|---|---|---|
| hero framing: billow p90/p10 | 1.34 | **2.83** | ≥ 2.5 | 3.0-5.9 |
| hero framing: r/b, g/b | 0.536, 0.737 | **0.713, 0.865** | | |
| overhead (40-90 deg, every bearing): r/b, g/b | 0.525, 0.734 | **0.671, 0.845** | 0.65-0.70, about 0.86 | |
| flood patches r/b (5-25 deg, ±10 deg of each tower's bearing) | pit_west 0.564, pit_east 0.608, heap_west 0.547, heap_east 0.542 | **pit_west 0.832, pit_east 0.855, heap_west 0.938, heap_east 0.900** | ≥ 0.7 | |
| control: same window at bearings 90 and 270 (between the flood pairs) | 0.524, 0.541 | **0.657, 0.643** | lower than the patches | |
| hero framing: mean luminance | 0.0623 | 0.0696 | about v1's (the engines' exposure) | |
| horizon: luminance, r ≤ b | 0.0773, yes | 0.0819, yes | ≤ 0.10, r ≤ b | |

Billow p90/p10 at pitch 20 around the compass (`sky.measures.ring_pitch20`): 0°: 2.67, 45°: 2.16, 90°: 2.30, 135°: 2.74, 180°: 2.85, 225°: 2.37, 270°: 2.58, 315°: 2.60. The minimum is
2.16. Three of the eight bearings (45, 90, 225) are below 2.5: those framings hold fewer
masses. The ask is met at the hero framing.

**Method** (also in `sky.measures.method`). All numbers come from the EXR's linear values, read back from the
written file. `measures()` in `sky_source.py` computes them:
- **Views:** a nearest-texel perspective resample, vertical fov 72, 16:9, 384 px wide. Only sky texels at elevation
  ≥ 5 deg count (billows, not the horizon haze gradient).
- **billow:** p90/p10 of Rec.709 luminance.
- **r/b and g/b:** the ratio of the channel means.
- **Hero framing:** bearing 193 deg (0 = game -Z, 90 = +X: the SKY_COORDS u x 360), toward the tower crane from the
  slab, pitch 20. This is **my estimate from g-atmos's hero shot** (crane mast centre-right, horizon about 3/4 down
  the frame). The exact hero camera is not in the repo; g-atmos measures in-engine at the real one.
- **Flood patches:** the equirect texels within ±10 deg of each flood tower's bearing from the yard centre (from
  `the_lot.json` `floodlights[].pos`) and 5-25 deg up.
- Calibration: v1 measured this way gives billow 1.34 at the hero framing; g-atmos measured 1.42 in-engine. The
  method agrees.

**What changed for v2, and why.** Each item is a parameter or a recipe constant in the receipt.
- **The root cause of "flat and blue": v1's bright parts were the thin cloud.** The skyglow above shone through the
  gaps at about 0.08 radiance, against about 0.03 for the thick cloud. So the deck was blue, and its contrast ran the
  wrong way. v2 inverts it:
  - The gaps get `thin` 0.2 of the skyglow and an albedo of 0.10, so they are dark.
  - The masses (albedo 0.62) are lit by the ambient from below (`amb` 0.065, `AMB_TINT` (0.70, 0.88, 1.0): the target
    hue) and `fill` 4.5.
  - The gap glow is tinted toward the same hue (`TRANSLUCENT` thin end (0.66, 0.80, 0.80), was (0.58, 0.66, 0.80)).
- **Cloud masses, not streaks.**
  - The field is a 320 m mass noise (`mass`), shifted by a 1.6 km coverage noise and cut by a smoothstep (`cover`
    0.52, `edge` 0.05), so masses have edges and dark gaps between them.
  - `body` 0.25 shades each mass from its edge to its centre: rounded billows, not flat plates.
  - The wind rolls (`roll` 0.25) and the 40 m wisps (`wisp` 0.3) now live inside the masses.
- **No streak band above the horizon.** Rolls and wisps fade out with camera-ray length (`lod0` 1.5 km to `lod1`
  5 km). The far deck is smooth masses melting into the haze. I looked for the streaks in every view: none left.
- **Warm sodium underbelly on the flood towers' bearings.**
  - The geometry: seen from the yard, the deck directly above a tower is at 65-68 deg elevation, while the towers'
    lamp heads are at 8-11 deg.
  - So a warm patch 5-25 deg up on a tower's bearing has to be deck 0.6-3.4 km out on that bearing.
  - v2 adds a seeded cluster of upward sodium cones beyond each tower on its bearing (`cl_n` 12 per tower,
    `cl_w` 70 kW, bearing sigma `cl_spread` 9 deg, 0.7-2.2 km; stream `random.Random(seed + 1)`, so the yard and far
    rings keep v1's layout): the yard's lit apron continuing past the towers.
  - Because the deck it lights is far away, the patch hardly shifts as the camera moves around the Lot. A halo baked
    at 120 m would.
- **Unchanged:** the far ring cones, the yard ring, the Lot's four floods, the haze (so the horizon / fog colour),
  the axes, the seam overscan.

**Tune trail** (512x256 s16 unless noted; renders and sheets in `$S/bl-dcc/sky/v2/`):

| run | change | hero billow | overhead r/b, g/b | patches r/b | read by eye |
|---|---|---|---|---|---|
| a0 | masses + clusters (150 kW), thin 1.0 | 1.82 | 0.71, 0.83 | 1.43-1.91 | gaps still glow blue; orange blobs |
| b3 | thin 0.2, amb 0.04, clusters 50 kW | 3.66 | 0.72, 0.86 | 0.95-1.14 | one flat light field with dark holes |
| c2 | cover 0.52, body 0.25 | 2.62 | 0.64, 0.83 | 0.84-0.95 | dark base, lighter billows; too dark (lum 0.040) |
| d3 | amb 0.065, fill 4.5, greener tints, clusters 70 kW | 2.78 | 0.64, 0.85 | 0.79-0.89 | right; overhead r/b just under 0.65 |
| look768 | AMB_TINT r 0.70 (the product recipe), 768x384 | 2.81 | 0.67, 0.85 | 0.82-0.95 | right |
| **product** | 2048x1024 s64 | **2.83** | **0.67, 0.84** | **0.83-0.94** | right |

Images: **`$S/bl-dcc/contact_v2.jpg`**. It has the v1 and v2 equirects, the same four views for each (hero, the pit
floods' bearing, between the floods, overhead), the reference, and both sets of measures in the header. The v1 sheet
is `$S/bl-dcc/contact.jpg`.

#### Axes (proved, not assumed)

The camera is at game (0, 2, 0), turned (90, 0, 180) deg: the image is in Godot's SKY_COORDS, u = 0 down game -Z, 0.25
+X, 0.5 +Z, 0.75 -X, v = 0 the zenith.
- `--markers 1` renders coloured spheres on the game axes and measured -Z at u 0.9996 (wraps to 0), +X 0.2503, +Z
  0.5003, -X 0.7496, +Y at v 0.016: PASS (re-run for v2: PASS).
- The same run shows that image as a Blender world through `bllib.sky_world()` and re-renders it: same u within 0.001.
  This is what the backdrop and splat renders will use.
- The markers EXR is at `$S/bl-dcc/sky/markers_256.exr` (scratch, 256x128). g-atmos's axis test already uses it.

#### Determinism and the seam

- **v1: byte-identical at full size.** The coordinator's own re-run (`$S/lead-skycheck/full_b`) wrote EXR sha256
  `541faeb7…`, the same as my product.
- **v2:** **byte-identical at full size.** The final v2 code was rendered twice at 2048x1024 s64: the product, then a re-run to `$S/bl-dcc/sky/v2/full_rerun`. Both have EXR sha256 `7916cd7795598c5da3d1e518034ab88ddcf4aef8359819ff10482c1118533b2a` and PNG sha256 `ec175e24dc542a2c43ade138e9cb697695537a71d77ca4875c8fc2dba405c8bc`, and `cmp` is silent for both. The run times differed (551 s and 490 s wall at load 8), but not the output.
- **How:** Cycles always writes its render, sync and total times into the EXR header, and the stamp switches do not
  cover them. `bllib.render_exr` renders to a temporary EXR and copies the pixels bit for bit (half → float32 → half is
  exact) into a plain float image that is saved instead. Stamp metadata and 8-bit dither are off too.
- **No seam at u = 0 / 1.** The camera renders 32 overscan columns past each side of the seam (`wrap`) and
  `render_exr` cuts them off. v2 product: the wrap step on the preview is 0.49 against an ordinary neighbour step of
  0.43 (ratio 1.1), the same as any other column. The first v1 render, before the fix, had 4x.

#### The receipt test

```
npx vitest run tests/unit/aaa-receipts.test.ts
```

Result on v2: **1 file, 7 tests passed.** For the sky it checks:
- the licence line, the rebuild command, spp 64 and seed 1717;
- the EXR's bytes and sha256, and from its own header: 2048x1024, B/G/R all HALF, ZIP, single-part scanline;
- the horizon and zenith colours, **re-derived in Node** from the EXR's ZIP blocks;
- **v2:** the horizon has r ≤ b and luminance ≤ 0.10, from the file;
- **v2:** each flood patch r/b is **re-derived from the file** (bearings computed from `the_lot.json`), matches the
  receipt within 0.005, is ≥ 0.7, and is warmer than both control windows;
- **v2:** the hero billow ≥ 2.5 and the method is recorded (from the receipt: the perspective resample is not redone
  in Node);
- the PNG's bytes, sha256 and 2048x1024 8-bit RGB.

It bites. Run `$S/bl-dcc/scripts/break_receipt.sh` (scratch copy, `AAA_RECEIPTS_ROOT`):

```
broke outputs.exr.sha256: 7916cd779559 -> 0916cd779559
 FAIL  ... > the EXR matches its receipt and is 2048x1024 half-float RGB, ZIP, single-part scanline
AssertionError: assets/sky/lot_night_sky.exr sha256: expected '7916cd7795598c5da3d1e518034ab88ddcf4a…' to be '0916cd7795598c5da3d1e518034ab88ddcf4a…'
      Tests  1 failed | 6 passed (7)
vitest exit 1
```

and `BREAK=patch` (a receipt claiming a warmer patch than the file has):

```
broke sky.measures.flood_patches[0].rb: 0.832 -> 0.882
 FAIL  ... > v2: warm sodium patches on each flood tower's bearing, 5-25 deg up, r/b >= 0.7 and warmer than between them ...
AssertionError: flood_pit_west patch r/b (file) vs receipt: expected 0.8319254098169624 to be close to 0.882, received difference is 0.050074590183037615, but expected 0.005
      Tests  1 failed | 6 passed (7)
vitest exit 1
```

#### Honest limits (v2)

- **The deck reads as broken cloud more than the reference's continuous overcast.** v2 has distinct lighter masses
  with large dark gaps. The reference is a dark overcast with lighter mottling. Raising `cover` toward 0.5 and
  lowering `edge` would merge the masses, at the cost of contrast. This is the ruling to make in-engine.
- **Contrast varies by bearing:** 2.16-2.86 around the compass at pitch 20. The hero framing passes; three framings
  (45, 90, 225 deg) are under 2.5.
- **The hero framing is my estimate** (see Method). g-atmos's in-engine number at the real hero camera decides.
- **The flood patches are warm streaks low on the deck, not a glow:** r/b 0.83-0.94 at 5-25 deg. They fill the window
  partly. The lamp halos themselves are the AIR pass (halo cards per flood), not the sky.
- **The EXR grew** from 1.96 MB to 2.63 MB (more structure for ZIP to store).
- The rest stands from v1:
  - The Lot's own four floods hardly light the deck (192 W each).
  - The sky is a still.
  - `far` squares the far ring's energy.
  - Timings are from the shared box at load 8-11.
  - `.gitattributes` had no `*.exr binary` line then (not my file). The lead's working-tree edit now adds it.
  - The scripts refuse any Blender but 5.2.2.

### History: v1 (superseded)

- v1 was the spike judge's set (dist 0.3, stretch 0.55, power 0.04, kelvin 3000, glow_g 0.036, glow_b 0.043, far 0.6).
  On my look check that set put rust-brown patches overhead, so v1 added three changes:
  - the far ring as upward 140 deg cones (`far_cone`, so its warmth stays low);
  - a teal ambient from below (`amb`);
  - a cool horizon haze, as the lightest band (`haze` 1.6), because it is also the fog colour.
- In engine it was a clear step up from the procedural deck but "too flat, too blue, not yet lit from below".
- Its contact sheet is `$S/bl-dcc/contact.jpg`, its tune renders are in `$S/bl-dcc/sky/tune/`, and the scratch copy
  of the v1 product is in `$S/bl-dcc/sky/v2/v1_product.*`.

## WET (pass 2): the Lot asphalt's wet mask

**WET READY.** One world-aligned mask both engines sample for the Lot's ground.

| File | Bytes | What |
|---|---|---|
| `assets/lot/lot_wet_mask.png` | 2,728,809 (2.73 MB) | 2048 x 2048, 8-bit RGB, **non-colour data**: R puddle, G damp, B glint |
| `assets/lot/lot_wet_mask.receipt.json` | 3,843 | file facts, every parameter, the world-data hashes, **the transform**, the coverage, `west_yard` (the zeroed texels), timings, rebuild, licence |
| `tools/blender/wet_mask.py` | 18,005 | the script (numpy fields + a Cycles top-down render) |

PNG sha256 `9b5ca33f8874498a81abe6861321ded577008c8718e16390529582e3eab1edc2`. It replaces `05ab05ff…`, which left up to
3/255 in column 25, west of the fence (see the West Yard below).

**Rebuild** (repo root; 68 s wall / 78 CPU-s at load 8.1):

```
"$BLENDER" --background --factory-startup --python tools/blender/wet_mask.py
```

### The transform (in the receipt; read from `the_lot.json` bounds, never typed)

- **Source:** the world bounds. Origin (top-left texel corner) = game `(-156, -156)`.
  Span 312 x 312 m. **0.15234375 m per texel.**
- **Axes:** image right = game +X; image down = game +Z (row 0 = minZ).
- **Texel centre:** `x = -156 + (u + 0.5) * 0.15234375; z = -156 + (v + 0.5) * 0.15234375`.
- **In a shader:** `uv = ((x - minX) / (maxX - minX), (z - minZ) / (maxZ - minZ)), v = 0 at the top row`. That is Godot's UV origin; three.js textures need `flipY = false` to use the
  same uv.

### What each channel is (all from `the_lot.json`)

- **R, puddle.** A priority-flood depression fill of the Lot heights (upsampled to 0.5 m, plus seeded 5 cm
  micro-relief), with water capped `cap` 2.5 cm above each basin's local floor (6 m window), so water sits in the
  lowest hollows of low ground. Only on flat ground (slope < 0.2).
  - **Off cover feet:** no puddle within 1.5 m of the footprint of any of the 156 ground-standing sim
    colliders (rotated boxes and cylinders; the perimeter walls are not cover), ramping back in over 3 m.
  - **Out of the ditches:** the four `water` zones are water already.
  - Puddle edges are broken below the grid by seeded noise (±6 mm).
- **G, damp.** Broad seeded patches, wetter on flat ground, always 1 under and around puddles and in the ditches.
- **B, glint.** The floods' pools: a 22 m Gaussian around each `floodlights[].target`, strongest on standing water.
- **The West Yard is dry.** Every channel is exactly 0 on the outer side of the west fence line (`fences[]`:
  x = −152, face −1), over the full half-plane.
  - The fields zero the half-plane before the render.
  - After quantising, every texel whose whole cell lies west of the line is set to 0 in numpy. That is columns 0-25:
    column 25 spans x −152.19 to −152.04, and 53,248 texels are zeroed in all. The receipt's `west_yard` records this.
  - Without that step, the render's 1 px filter left up to 3/255 in column 25: 425 texels, R on 88 and G on 425. The
    verifier caught it.
  - Column 26 straddles the line, and so does the 0.5 m interpolation ramp: both lie under the fence foot.

### Coverage (the receipt; re-derived from the PNG by the test)

| channel | > 0.5 | > 0.1 | mean |
|---|---|---|---|
| R puddle | 2.3 % | 3.24 % | 0.0236 |
| G damp | 67.24 % | 95.34 % | 0.6233 |
| B glint | 0.47 % | 10.52 % | 0.03 |

On the 0.5 m grid: 2.84 % of cells hold water deeper than 1 cm;
0.23 % lost it to the cover-feet clearance; the West Yard strip is
3.81 % of the grid.

### Look check and the change it made

- **Look check** (512 px, 4 spp; `$S/bl-dcc/wet/contact_look512.jpg`): the spike's 5 cm cap turned the corgi pit's
  flat floor (−2.4 m) into one sheet of water.
- **Change:** `cap` 0.025. The pit now holds broken puddles in its lowest (west) half, scattered puddles sit in the
  yard's hollows (2.3 % of texels), and the raised heap drains.
- **Contact sheet: `$S/bl-dcc/contact_wet.jpg`.** It has three panels, plus zooms on the Foundation (corgi pit), the
  Scaffolds (heap) and Container Canyon:
  - a top-down map of the Lot built from `the_lot.json`: hillshaded heights, every prim's footprint, the fence
    (orange), the ditch water (blue), and the four floods with their aim lines;
  - the raw mask;
  - the mask over the map in the same texel frame: puddles cyan, glint amber, damp darkening.
- **Alignment:** the ditches, craters, pit outline and cleared cover feet line up with the map.

### Determinism

Two full runs of the fixed code (the product, and `-- --out $S/bl-dcc/wet_det/lot_wet_mask`) write byte-identical
PNGs: sha256 `9b5ca33f8874498a81abe6861321ded577008c8718e16390529582e3eab1edc2`, `cmp` silent.
- The numpy half is seeded (`default_rng(1717)`).
- The Cycles render is emission only: 16 spp, no adaptive sampling, no denoiser, 4 threads.
- The image goes through `bllib.render_exr` (no metadata) and is quantised once, then saved as non-colour 8-bit.

### Test

`npx vitest run tests/unit/aaa-receipts.test.ts` → **22 passed** in all; the WET section has 4 tests:
- the licence line, the rebuild command and 16 spp;
- the PNG's bytes, sha256 and 2048 x 2048 8-bit RGB;
- the transform equals the `the_lot.json` bounds (origin, span, m per texel = span / 2048, axes);
- the file itself, decoded in Node (inflate plus the five PNG row filters):
  - each channel's % > 0.5 matches the receipt;
  - each channel has > 1 % of texels above 0.1, and < 90 % above 0.5;
  - every texel of columns 0-25 (every cell wholly west of the fence line, its east edge ≤ x = −152) is 0. The bound
    is computed from the receipt's transform and the fence, and checked against both edges.

It bites. `$S/bl-dcc/scripts/break_wet.sh` now copies all four AAA assets; each mode exits 1:
- `BREAK=hash`: `assets/lot/lot_wet_mask.png sha256: expected '9b5ca33f8874…' to be '0b5ca33f8874…'`, then
  1 failed | 21 passed.
- `BREAK=transform` (an origin typed 1 m off): `expected [ -155, -156 ] to deeply equal [ -156, -156 ]`, then
  1 failed | 21 passed.
- `BREAK=yard`: column 25 given G = 3/255 on every row, with the receipt's hash and bytes updated to match.
  `West Yard texels are all 0 (it stays dirt): expected 6144 to be +0`, then 1 failed | 21 passed.
- **The old product fails the tightened test.** The bound was `floor(...) − 2` (columns 0-24) and is now
  `floor(...) − 1` (columns 0-25). Run against the old `05ab05ff…` mask, it gives
  `West Yard texels are all 0 (it stays dirt): expected 604 to be +0`. The fixed mask passes.

It also caught two real misses of mine before I handed over:
- the first product left two 4 m corners beyond the hoarding damp, west of the fence;
- the next one had a 0.5 m damp fringe just west of the fence line.

Both are fixed (the half-plane rule, and the ramp moved inside). A third, the column-25 filter bleed, got past the old
`− 2` bound. The verifier found it, and it is now fixed in the mask and covered by the test.

### Honest limits

- **Puddles come from the heights grid** (1 m, upsampled to 0.5 m) plus seeded micro-relief. They follow real low
  ground at that scale, not the asphalt's per-texel detail.
- **The cover clearance uses the sim's colliders.** A purely visual prop with no collider (if any) is not cleared.
- **The pit's east half is dry** because its floor drains west. That is real low ground, but the engines may want
  more water there for the hero shots.
- **The engines own the shading** (puddle roughness, the lamp-streak term, SSR / probes). The mask is data only.
- The PNG is 2.73 MB of noisy 8-bit data. New binaries for the lane so far: about 6.2 MB of the 25 MB budget.

### Files to land (WET)

```
tools/blender/wet_mask.py
assets/lot/lot_wet_mask.png
assets/lot/lot_wet_mask.receipt.json
tests/unit/aaa-receipts.test.ts
docs/handoff/BL-DCC.md
```

## BACKDROP (pass 4): the skyline GLB

**BACKDROP READY.** One GLB for Godot and the twin's low and medium tiers (and the floor everywhere, AAA_PLAN
ruling 1).

| File | Bytes | What |
|---|---|---|
| `assets/backdrop/lot_backdrop.glb` | 3,981,692 (3.98 MB; first build 6.61 MB) | +Y up, metres; root `Backdrop_Lot_01` (no transform) with one mesh per material: **8 draws, 73,086 triangles**, indexed |
| `assets/backdrop/lot_backdrop.receipt.json` | 5,381 | file facts, draws, triangles, the distance-rule results, `limits` (what `--backdrop` checks), the weld report (with `glb_weld.mjs`'s path and sha256), the fresh import, the masters' hashes, timings, rebuild, licence |
| `tools/blender/backdrop.py` | 22,837 | builds the scene (importable); run as a script, renders the look views and the fog view |
| `tools/blender/backdrop_glb.py` | 9,032 | builds, checks the distance rules, joins by material, exports, welds, fresh-imports, writes the receipt |
| `tools/blender/glb_weld.mjs` | 2,050 | the lossless size pass (node, glTF-Transform) |
| `tools/assets/validate-glb.mjs` | | gains `--backdrop` (below); the kit rules are unchanged |

GLB sha256 `d6066756f8426eab3e95ece40fb80557a1c0e24c1e366a133ce65472f85004b5`.

**Rebuild** (repo root; 44 s wall; needs `node` for the weld):

```
"$BLENDER" --background --factory-startup --python tools/blender/backdrop_glb.py
node tools/assets/validate-glb.mjs assets/backdrop/lot_backdrop.glb --backdrop
```

Look views: `"$BLENDER" --background --factory-startup --python tools/blender/backdrop.py -- --out <scratch>/look`
(about 151 s for four views and the fog view, 960 x 540 at 32 spp).

### What is in it (everything seeded; everything read from the shared data)

- **The six kit masters** (`assets/masters/*.glb`: LOD1 for the containers' front row, the pipes, footings, masts
  and lamps; LOD2 for the containers behind and for the bag walls):
  - 166 containers in 1-4 high stacks, in a port yard on the south, east
    and north bands 222-300 m out;
  - 60 bag-wall modules along the front;
  - 15 pipe segments on 20 footings
    (the footings also stand at the tower cranes' bases);
  - 12 flood towers, each a mast with three lamp heads
    (36 heads) facing the Lot.
- **New crane and gantry silhouettes** from beams and lattice trusses, shaded smooth: 6 ship-to-shore cranes,
  5 tower cranes and 7 rubber-tyred gantries (bearings and distances in the receipt, `build.cranes`).
- **68 sodium lamp cards:** emissive icospheres on the flood heads, the cranes, the gantries and the
  container fronts. `BD_SodiumLamp`: emissive (1, 0.55, 0.22), strength 30 (`KHR_materials_emissive_strength`).
- **A dark wet apron** from 165 m to 1.5 km at y = 0 (the Lot's terrain edge is at 0), so nothing floats.
- **Kept clear of what the game already draws beyond the fence:** none of it may land within the clearance of the
  330 `the_lot.json` prims beyond 165 m (the far rooftops, the trees, the
  neighbours' house, the tower crane), or on the West Yard side of the west fence. That is why the west side is empty,
  and the north band thin.

**The 8 draws (materials):** the six kit materials (their textures scaled to 256² PNG: the nearest piece is 216 m
away), `BD_DarkSteel` (cranes, gantries, the apron) and `BD_SodiumLamp`.

### Size: 6.61 MB → 3.98 MB (−40 %), same 8 draws

Blender's exporter already indexes and shares identical vertices, so welding alone did little (150,123 → 149,346
vertices). The size came from flat shading and dense far-away pieces:
- **The crane and gantry steel is shaded smooth.** At 400-900 m a beam's shading model is invisible, and smooth
  corners share vertices.
- **The bag walls use LOD2** (1.1 m tall, 219 m away). Triangles went from 91,326 to 73,086.
- **`glb_weld.mjs`** (glTF-Transform, lossless): it drops `TEXCOORD_0` from the two untextured materials (never read),
  then runs `weld()` (merges only fully identical vertices), `dedup()` and `prune()`. On this build: 4,230,688 →
  3,981,692 bytes, 86,114 → 83,045 vertices.
- **Deterministic:** three builds (scratch try3, the product, a re-run to scratch) wrote byte-identical GLBs
  (`d6066756f842…`, `cmp` silent).
- **The tests still pass:** 16 in `aaa-receipts.test.ts` (with the `--backdrop` test below) and the 10 kit-validator
  tests. Godot still loads it (below).

### The rules, checked per object before export (`rules` in the receipt)

| rule | measured |
|---|---|
| kit pieces and lamps at max(\|x\|, \|z\|) ≥ 216 m | nearest 216.57 m |
| cranes and gantries, every vertex 400-900 m from the centre | 416.42-897.39 m |
| nothing inside \|x\|, \|z\| < 165 m (the apron starts there) | nearest vertex 165.0 m (after the fresh import) |
| ≤ 8 draws, no `COL_` | 8 draws, `COL_` nodes [] |

The build stops (exit 1, `BACKDROP RULES FAILED`) if any rule breaks.

### The three proofs

1. **Fresh import into an empty Blender scene** (in `backdrop_glb.py`): 9 objects (the root and 8 meshes), the 8
   materials, 73,086 triangles, nearest vertex 165.0 m, no `COL_`.
2. **`node tools/assets/validate-glb.mjs assets/backdrop/lot_backdrop.glb --backdrop` → VALIDATE: PASS:** 8 draws
   (max 8), 73,086 triangles, nearest vertex 165 m (radius 165 m, from the receipt), 18 textures at 256².
   - In kit mode (no flag) it fails, as it should, on two kit rules: the root name (`Kit_…`/`Char_…`) and the children
     (only `_LOD0|1|2` and `COL_`).
   - **The `--backdrop` mode** (`validateBackdrop()` in `tools/assets/validate-glb.mjs`, edited for this mode only, as
     ruled). It is a separate function and does not touch the kit path. Its rules:
     - one scene, one root `Backdrop_<Set>_<NN>` with no transform;
     - any children (BD_ families, kit meshes), no `COL_` node anywhere, no LOD chain required;
     - TRIANGLES with finite positions;
     - every vertex at max(\|x\|, \|z\|) ≥ the receipt's `limits.min_cheb_m` (`--receipt <file>`, default
       `<stem>.receipt.json`; or `--min-dist <m>`);
     - draws (primitives) ≤ 8, or the receipt's `limits.draws_max` if lower;
     - textures square, power of two, ≤ 1024.
   - **The kit behaviour is unchanged.** The HEAD validator (`git show HEAD:…`, run from scratch) and the edited one
     give byte-identical output and exit codes on all twelve kit GLBs (the six masters and the six web variants): all
     PASS. `tests/unit/glb-validate.test.ts`: 10 passed, before and after.
   - **Unit test** (`aaa-receipts.test.ts`): the product passes with its receipt's limits (draws and triangles equal the
     receipt's). An in-memory copy fails on every rule broken in it:
     - the root renamed (`breaks Backdrop_<Set>_<NN>`);
     - a node renamed `COL_Pipe` (`a backdrop has no collision`);
     - the lamp mesh moved to the centre (`inside the 165 m radius`);
     - a ninth primitive added (`9 draws (primitives) > 8`).
3. **`GODOT=…/Godot_v4.7.2-stable_linux.x86_64 bash tools/godot/run.sh assets/backdrop/lot_backdrop.glb`**: Godot
   imports and draws it.
   - Both the editor import and the runtime `GLTFDocument` parse load the same tree: `Backdrop_Lot_01`, then 8
     `MeshInstance3D`, one surface each.
   - The triangles add up to 73,086 (bag walls 5,760, containers 23,242, steel 37,244, flood lamps 1,224,
     masts 1,416, footings 1,400, pipes 1,440, lamp cards 1,360).
   - `run.sh` exits 1 on its kit checks only ("missing lot_backdrop_LOD0/1/2 mesh", "no COL_ boxes", "no node named
     lot_backdrop"). **Those checks do not apply to a backdrop.** `run.sh` is not my file, and I left it as it is.

### Look check (`$S/bl-dcc/contact_backdrop.jpg`)

**What the sheet shows:** Cycles, 32 spp, lit by the v3 sky SOURCE (`bllib.sky_world`) and a sodium light at every
lamp card. A flat dark floor stands in for the Lot, which is not in these renders. Four views from inside the Lot,
the fog view, and the reference:
- the hero eye (0, 1.38, −10) toward bearing 188;
- the south fence toward 188;
- east;
- north.

**What reads:** toward the hero bearing, a port skyline. Ship-to-shore cranes and tower cranes stand over container
stacks, the yard lamps are lit, and the sodium streaks run long across the wet apron. The reference's foreground
structures (the lamp-post tower and the crane leg close by) are the Lot's own kit, not the backdrop.

### Fog: the far-fog cap inputs (the lead's ruling: a cap on the backdrop band, the Lot's fog unchanged)

**Method:** the hero view (eye (0, 1.38, −10), bearing 188) and its depth render. Fog is look.gd's
`1 − exp(−0.0045 d)`, coloured with the sky receipt's horizon. On the backdrop band (d ≥ 216 m) it is capped:
`min(fog, cap)`. The sky is not fogged in this composite.
- L* is CIE L* of the AgX display image.
- "Cranes" = the texels at depth 400-900 m (the ship-to-shore cranes, tower cranes and gantries); "containers" =
  216-300 m.
- Each is compared with the sky texels in the same rows.
- Uncapped fogged share: 216 m 62 %, 300 m 74 %, 400 m 84 %, 600 m 93 %, 900 m 98 %.

| max fog at ≥ 216 m | cranes L* | **cranes − sky ΔL*** | containers ΔL* | sky L* |
|---|---|---|---|---|
| no cap (density 0.0045) | 32.0 | **+1.5** (lighter than the sky: ghosts) | −2.7 | 30.5 |
| 0.7 | 28.0 | **−2.4** | −2.9 | 30.5 |
| 0.6 | 26.0 | **−4.4** | −4.7 | 30.5 |
| 0.5 | 23.8 | **−6.6** | −6.9 | 30.5 |
| 0.4 | 21.4 | −9.0 | −9.2 | 30.5 |
| 0.3 | 18.7 | −11.8 | −11.9 | 30.5 |
| no fog | 7.5 | −23.0 | −22.7 | 30.5 |

- **The reference, measured the same way** (structure p10 against sky p90 in a window): −22 (its right crane boom),
  −25 (its background lattice tower), −36 (its left lamp tower).
- **By eye** (`$S/bl-dcc/contact_fogcap.jpg`): 0.7 still reads as ghosts. 0.6 is borderline. **0.5 is the first cap
  where the cranes read as dark hazy silhouettes**, as in the reference's background.
- **To reach the reference's contrast (about −22 ΔL*) the cap would have to be near 0** at these distances. 0.3-0.4
  keep more of the haze.
- **My input: a cap of 0.5** (cranes −6.6 ΔL*), or 0.4 (−9.0) if the lead wants them closer to the reference.
- The containers at 216-300 m track the cranes within 0.3 L*.

### Determinism

Three builds of the same code wrote byte-identical GLBs (`d6066756f842…`, `cmp` silent): the scratch try3,
the product, and `-- --out $S/bl-dcc/backdrop/rerun`.

### Test

`npx vitest run tests/unit/aaa-receipts.test.ts` → **22 passed** in all; the BACKDROP section has 5 tests:
- checks the licence line and the rebuild command;
- checks the receipt's `weld.script_sha256` against `tools/blender/glb_weld.mjs` in the repo. The GLB was rebuilt to
  record it: it is byte-identical, `d6066756…`;
- reads the GLB with glTF-Transform:
  - draws (primitives) ≤ 8, materials ≤ 8, and matching the receipt;
  - no node named `COL_…`;
  - every vertex (world matrices applied) at max(|x|, |z|) ≥ 165 m;
  - the triangles equal the receipt's;
  - +Y up: the apron lies on y = 0, nothing dips more than 0.5 m below, and the crane tops reach above 100 m;
- runs the `--backdrop` validator test (above);
- checks the receipt's distance rules.

It bites. Run `$S/bl-dcc/scripts/break_bd.sh`; each mode exits 1:
- `BREAK=hash`: a broken GLB hash, 1 failed | 21 passed;
- `BREAK=weld`: `weld.script_sha256` zeroed, 1 failed | 21 passed;
- `BREAK=col` (counts from the 16-test run): a GLB copy with `BD_Pipe_01` renamed `COL_Pipe`, and the receipt's hash
  updated to match, 2 failed | 14 passed: `node COL_Pipe: no collision in a backdrop`, and the `--backdrop` validator test, which also sees the
  `COL_` node.

### Honest limits

- **The fog:** see above. Without a cap of about 0.5 or lower, the skyline is lost.
- **Only 12 flood towers and 15 pipe segments** fit between the game's own scenery ring (trees at 215-260 m,
  rooftops at 285-330 m). The north and west bands are thin by rule, not by choice.
- **The cranes are box-beam and wireframe silhouettes:** right at 400-900 m in haze, plain up close.
- **No aviation red lights:** a ninth material would break the 8-draw budget.
- **The splat** (§SPLAT) is baked from these same surfaces.

### Files to land (BACKDROP)

```
tools/blender/backdrop.py
tools/blender/backdrop_glb.py
tools/blender/glb_weld.mjs
tools/assets/validate-glb.mjs        (the --backdrop mode only)
assets/backdrop/lot_backdrop.glb
assets/backdrop/lot_backdrop.receipt.json
tests/unit/aaa-receipts.test.ts
docs/handoff/BL-DCC.md
```

## SPLAT (pass 4): the backdrop splat, BAKED and UNTRAINED

`assets/backdrop/lot_backdrop_untrained.spz`: **3,436,508 bytes, 300,000 splats**, SPZ v3 (gzip), SH degree 0,
sha256 `a4ac822d3f5e…`. Receipt: `assets/backdrop/lot_backdrop_untrained.receipt.json` (label **UNTRAINED**,
`fine_tune: NOT RUN`). Nothing is inside the 165 m crop: the nearest centre is at 165.032 m (max(|x|, |z|), checked
on the stored fixed-point positions). The splat reaches out to 1,112 m and up to 177 m. It needs no trainer and no AGPL
tool, so it can ship as it is.

The receipt writes every path outside the repo as `<scratch>/<name>`: `params.set`, `rebuild`,
`training_set.path_scratch`. It records `splat_set.py`'s sha256, which equals the hash the set was rendered with.
Rebuilding after that change wrote the same .spz bytes (`a4ac822d…`).

Rebuild (from the repo root; the training set goes to scratch and never lands):

```
"$BLENDER" --background --factory-startup --python tools/blender/splat_set.py -- --out $S/bl-dcc/train      # 30 min
"$BLENDER" --background --factory-startup --python tools/splat/bake_splat.py -- --set $S/bl-dcc/train       # 31 s
node tools/splat/spz_check.mjs assets/backdrop/lot_backdrop_untrained.spz                                  # PASS
```

### The training set (`tools/blender/splat_set.py`, scratch only: `$S/bl-dcc/train/`, 118 MB)

- **150 views** at 768x432 and 32 spp (Cycles CPU), vertical fov 50°. They are seeded (1717):
  - bearings stratified over 360° (view i near i × 2.4°);
  - the eye anywhere in the play bounds (|x|, |z| ≤ 150 m), 1.5-20 m up;
  - pitch −3° to +12°.
- **Every 10th view is held out** (15 views); none of them is used for colour.
- **The scene is `backdrop.build()`,** the same code as the GLB, lit by the v3 sky SOURCE and a sodium light at every
  lamp card. **The Lot is camera-invisible:** its stand-in floor `LookGround` takes part in the light but is never
  seen. The view transform is Standard, with no baked haze.
- **Each view also has a 1-spp ray-length depth** (float16 `.npy`, 0 = sky), used for the bake's visibility test.
- **`transforms.json` uses the nerfstudio / OpenSplat layout:** OPENCV with fl_x = fl_y = 463.2, cx and cy, and
  `frames[].transform_matrix` as camera-to-world. It is in **game axes** (x, y up, z; OpenGL camera axes), the same
  space as the GLB and the splat. Each frame also records `eye_game`, `bearing_deg`, `pitch_deg` and `held_out`.
  `set.receipt.json` records the timings and the transforms' sha256 (`e4f4f713…`, which the splat receipt repeats).
- **Time:** 1,795 s wall (beauty 1,708 s, about 11 s a view at load 6-7), under `nice -n 10`.

### The bake (`tools/splat/bake_splat.py`)

1. **Candidates (2 × the budget), seeded:**
   - 510k on the pieces, area-weighted over every triangle (432,583 m²);
   - 90k on the apron, from the crop out to the GLB apron's edge (165-1,500 m). These are log-uniform in radius, so the
     spacing grows with distance (2.7 m at 165 m, 7.5 m at 450 m, 25 m at 1,500 m) and stays about constant on screen.
2. **Colour:** each candidate is projected into the 135 colour views. A view counts when:
   - its depth render agrees within 1 % + 1 m + the depth change across 1.5 px at that grazing angle;
   - and |cos| ≥ 0.15 (0.02 on the apron, which eye height only ever sees at a grazing angle).

   The colour is the |cos|-weighted mean of the bilinear display values (sRGB, Standard).
3. **Select:**
   - 374,130 of the candidates are seen. About 40 % of the pieces' area is never seen from the play area: container
     bottoms, stacked faces and far sides.
   - The budget is drawn from the seen candidates only: 255,000 on the pieces and 45,000 on the apron.
   - Each surfel's sigma comes from the kept spacing: min(½ spacing, ½ the shortest edge of its triangle), so thin
     beams stay thin, with 2 cm along the normal. The median is 0.51 m and the maximum 9.1 m (far apron).
   - Opacity is 0.95 (apron 0.9).
4. **Encode (SPZ v3, the layout three 0.186.1's `SPZLoader` reads):**
   - 24-bit positions with 12 fractional bits (±2,048 m);
   - colour = 0.5 + SH_C0 × f_dc;
   - log scales;
   - smallest-three quaternions that turn +Z onto the normal;
   - gzip with mtime 0.

   The receipt keeps 16 sample splats with the values three must decode, worked out from the **stored bytes**:
   - the int24 position;
   - the colour bytes through three's `COLOR_LUT` (a Uint8ClampedArray, which rounds half to even);
   - the covariance from the rebuilt quaternion.

**Space and colour conventions** (in the receipt):
- **Space:** game axes, the twin's world, with no 3DGS y-down flip.
- **Colour:** display values of the Standard renders. The twin applies its own tonemap and fog, like the GLB.

### `tools/splat/spz_check.mjs` (three's own SPZLoader, in Node)

`node tools/splat/spz_check.mjs <file.spz> [--receipt f] [--json]`. It also exports `checkSpz()` and `SPLAT` for the
test. It calls `SPZLoader.parse` and requires position (3), covariance (6) and normalised color (4) attributes. It then
checks:
- splats ≤ 300k and bytes ≤ 15 MB (a receipt can only tighten these limits, never loosen them);
- everything is finite, every covariance diagonal is > 0, and no alpha is 0;
- every decoded centre is at max(|x|, |z|) ≥ 165 m;
- the receipt: label UNTRAINED, the sha256, bytes and count, and all 16 samples. Positions must match exactly as
  float32, colour bytes exactly, and covariances to 1e-5 relative.

Result on the product: `SPZ CHECK: PASS (300000 splats, 3436508 bytes, three SPZLoader)`, 16/16 samples, exit 0.

### Look check (`$S/bl-dcc/contact_splat.jpg`)

**How it was made:**
- The splat panels are a **CPU EWA splatter** of three's own SPZLoader decode (`$S/bl-dcc/scripts/splat_render.mjs`).
  It is a contact-sheet tool, not the twin's renderer.
- They are composited over the same Cycles sky pixels as the reference panel.
- The hero reference is the **landed GLB, imported** into Blender, lit the same way, with Cycles at 32 spp, Standard,
  960x540, from the hero eye (0, 1.38, −10), bearing 188, pitch 8, vfov 72 (`$S/bl-dcc/scripts/hero_glb.py`).

**Measured on backdrop pixels:**

| | PSNR (backdrop px) | coverage |
|---|---|---|
| hero eye, splat vs the GLB | 26.15 dB | 0.996 |
| 15 held-out views, splat vs Cycles | mean **26.95 dB** (23.86-29.46) | 0.93-1.00 |

**What I saw:**
- At the hero eye the splat and the GLB line up: the same cranes, stacks, lamp points and skyline, in the same places
  and colours.
- The difference images are thin outlines at every edge, the ½-spacing blur of an untrained bake.
- The near apron's lamp pools are smeared. They are view-dependent in Cycles (wet gloss), and an SH-0 bake averages
  them.
- The GLB's glossy band just under the horizon (sky reflected at a grazing angle) is a darker diffuse average in the
  splat.

**One change it made:** the first bake kept only 156,789 splats and showed sky through a band under the horizon.
- The cause: the apron stopped at 450 m, and the cos ≥ 0.15 rule rejected nearly every grazing view of the ground, so
  only 4.5k apron splats survived.
- The fix: 2× candidates drawn down to the budget, a slope-aware depth test, apron min_cos 0.02, and a log-radial apron
  out to the GLB's 1,500 m edge.
- Held-out PSNR went from 25.02 to 26.95 dB.

### Determinism

The bake was re-run to scratch (`--out $S/bl-dcc/splat_det/…`) and wrote a **byte-identical .spz** (`cmp` silent,
`a4ac822d…`). The receipt differs only in `outputs.path`, `params.out`, `rebuild` and `timing`. The training set is a
Cycles render at a fixed seed and threads; the bake reads it as data.

### `tools/splat/build_opensplat.sh`: a recipe, NOT RUN

It is a fetch-and-build recipe for **OpenSplat v1.2.2**, pinned to commit `62fd86fe3b62644b65890557ad9bf397abdc7cfb`
(checked with `git ls-remote` on 2026-10-23). It uses CPU libtorch 2.2.1 (cxx11 ABI), pinned by sha256 `13b7f53c…`
(182,681,505 bytes, hashed by streaming the download, never saved) and built with `-DGPU_RUNTIME=CPU`. Its guards:
- it refuses to run without `OPENSPLAT_SIGNOFF=yes`;
- it refuses a build dir inside the repo, before it creates anything;
- it checks the clone's commit against the pin.

Only `bash -n` and the two refusals were exercised. Nothing was fetched or built, and nothing was fine-tuned:
OpenSplat is AGPL-3.0 and waits on the owner (AAA_PLAN decision 1).

**Known gap before any fine-tune:** OpenSplat's nerfstudio reader needs sparse points (`ply_file_path`), and random
initialisation is unsupported (its issue 7). `transforms.json` carries none. The bake's centres are the obvious seed.

**`tools/splat/ply_scrub` is not built.** AAA_PLAN's lane card lists it. Its job is to crop, budget and scrub a
*trained* PLY before conversion, so it lands with the fine-tune, after the owner's sign-off. The baked splat needs
none: the bake writes the .spz directly, already cropped and within budget.

### Test

`npx vitest run tests/unit/aaa-receipts.test.ts` → **22 passed**: sky 8, WET 4, BACKDROP 5, SPLAT 4, plus one test
over all four receipts that **no receipt carries an absolute path** (scratch is written `<scratch>/…`). The SPLAT
section checks:
- the UNTRAINED label (receipt and output), the licence, the rebuild command, `fine_tune: NOT RUN`, and the training
  set (150 views, 768x432, 32 spp);
- the receipt's `training_set.splat_set_script_sha256` against `tools/blender/splat_set.py` in the repo. It must also
  equal the hash in the set's own `set.receipt.json` (`rendered_by_script_sha256`: the set was rendered by that
  script), and `path_scratch` must be `<scratch>/…`;
- that the file matches its receipt;
- the limits: ≤ 300k splats, ≤ 15 MB, and a receipt never looser than the card;
- the header, read directly: magic, v3, count, SH 0;
- `checkSpz` through three's SPZLoader: no errors, count, nearest centre ≥ 165 m, and every sample;
- an in-test break: one splat moved to (0, 0, 0) in a temp copy must fail on both the crop and the hash.

It bites. Run `$S/bl-dcc/scripts/break_splat.sh`; each mode exits 1:
- `BREAK=hash`: 2 failed | 20 passed (the sha256 line, and spz_check's sha256 error);
- `BREAK=crop`: a copy with splat 1000 moved to the Lot centre, and the receipt's hash and bytes updated to match.
  1 failed | 21 passed: `1 splats inside the crop: max(|x|,|z|) < 165 m (nearest 0.000 m)`;
- `BREAK=path`: an absolute `/tmp/…` path in `params.set`. 1 failed | 21 passed (the no-absolute-paths test);
- `BREAK=setsha`: `splat_set_script_sha256` zeroed. 1 failed | 21 passed (`splat_set.py is the one in the repo`).

`npm run gate:fast` on the fixed state: **GATE PASS**. Typecheck ok, boundaries ok, unit 160 files, 1462 passed and 4
skipped, at load 12-14. (The earlier run's one failure, the `lot-world` build-time test at load 7, did not recur. Run
alone it had passed 16/16.)

### Honest limits

- **UNTRAINED:**
  - colours are a view-independent average (SH 0);
  - edges are blurred to about half the local spacing;
  - the wet apron's gloss and lamp pools are averaged, not reflected;
  - a fine-tune would fix all three, and waits on the owner.
- **Coverage:** only surfaces seen from inside the play bounds, 1.5-20 m up, are in it. A camera outside that envelope
  (a high flyover) will find holes: the backs of containers and the tops of high stacks.
- **The apron ends where the training views stop seeing it** (about 1.1 km), short of the GLB's 1.5 km edge. Under
  the fog that is invisible.
- **The comparison images come from a CPU splatter written for this sheet**, not from three's GaussianSplat renderer.
  The twin lane (TW-SPLAT) owns the real look and the colour contract.

### Files to land (SPLAT)

```
tools/blender/splat_set.py
tools/splat/bake_splat.py
tools/splat/spz_check.mjs
tools/splat/build_opensplat.sh       (recipe only; not run)
assets/backdrop/lot_backdrop_untrained.spz
assets/backdrop/lot_backdrop_untrained.receipt.json
tests/unit/aaa-receipts.test.ts
docs/handoff/BL-DCC.md
```

**All new binaries together:** 13.61 MB (13,606,853 bytes) of the 25 MB cap:
- sky EXR 2,836,718 bytes;
- sky PNG 623,126 bytes;
- wet mask 2,728,809 bytes;
- GLB 3,981,692 bytes;
- SPZ 3,436,508 bytes.
