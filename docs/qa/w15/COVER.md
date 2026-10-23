# Cover read (W15 Sprint D, item 11)

**Card (owner's words).** "Cover read using the existing six GLBs; draw budget stays inside P-GLB4."

**Defect.** At night, from the play camera at each base and along the approach lanes, a player cannot tell at a
glance which kit pieces stop bullets (cover) and which do not (thin or decorative).

**Rules.**
- No new meshes, placements, map or collider changes.
- Draw calls within +5 %.
- The look lock holds: stylised-realistic wet night, no ink, no outlines, no glow over the threshold.

## Godot (lane g-atmos)

**Base.** Measured on `71defe3` plus the item 11 files; landed on `e6837d5`, which changes no look or world file
between the two (the lead's fresh confirm re-ran the suite there: 26/26).

**This is the third pass, on the lead's round-3 ruling.**
- **The judge's finding.** On Forward+, the round-2 read turned the small cover pieces into flat cream blocks: the
  Footing at 10 m read at L\* 45.7 with std 3.5 (7.8 with the read off). The web found the same "flattening" on dark
  views.
- **The causes.**
  - The old rule held each texel's luminance in [0.22, 0.28], so the fill was nearly uniform by construction.
  - Any constant emission compresses L\*, which is about the cube root of Y.
- **What changed.** The shared rule now keeps the albedo's texture and fades in the floods' cones (section 2). The bar
  is the lead's new one (section 3).

### 1. Which kit pieces are cover

**Method.** I read the shared collision data: `engines/godot/data/the_lot.json` `colliders`, exported from
`src/shared/world/lot` (`props.ts` `bagWall` / `footing` / `container` / `floodTower`, `pipes.ts` `addPipe`). These
are the same boxes and cylinders `world/world.gd _build_colliders` builds on physics layer 1.

**Rules applied:**
- **Every world collider stops the rifle.** `game/tuning.gd` `RAY_MASK` = world plus hitboxes. So "stops bullets"
  alone does not make a piece cover.
- **A piece is cover where it shields a standing pet.** Per placement, I stack the piece's colliders that are at least
  1 m across (a pet is 0.72 m wide) up from the ground. Each must start no more than 0.35 m above the one below. If
  the stack reaches 0.6 m (a pet's centre of mass; the corgi stands 1.2 m, the cat 1.26 m), that height is the
  piece's cover height.
- The table is computed and printed by `tests/test_look_cover.gd` (`cover_table`). Heights are over the ground.

| Piece | Stops bullets? | Collider height | Cover for a pet? |
|---|---|---|---|
| `Kit_Lot_BagWall_01` | yes | 0.85–1.06 m, 1.6 m deep | **yes**: covers the body; the top of a pet's head shows over the lowest walls |
| `Kit_Lot_Footing_01` | yes | 1.36 m, 3.2 m block | **yes**, full cover |
| `Kit_Lot_Pipe_01` | yes | 5.68 m (12 facet boxes, walk-through) | **yes**, full cover |
| `Kit_Lot_Container20_01` | yes | 10.4 m; walls 0.4 m thick | **yes**: the walls. The open ends and the door are gaps |
| `Kit_Lot_FloodMast_01` | yes | ballast 1.09 m, 3.2 m block; mast cylinder 0.8 m wide, from 1.1 to 21.9 m | **ballast: yes. Mast: no** (thinner than 1 m, and above a pet's head) |
| `Kit_Lot_FloodLamp_01` | yes | heads at 22.3–23.4 m | **no**: overhead, shields nobody |


### 2. The rule (shared with the web twin)

It lives in `look/kit_wet.gdshader`, whose header states it with exact constants, and `look/look.gd`. No `world.gd`
hook is needed. On a piece's cover zone (mesh-local height under `Look.COVER`: the whole piece, the FloodMast's bottom
1.25 m, no FloodLamp), the emission adds a fill and a sheen.

**The fill keeps the albedo's texture.**
- One gain per piece: `clamp(m, 0.22, 0.28) / m`, where `m` = `Look.COVER_MEAN[piece]`. This replaces the per-texel
  clamp.
- `m` is the piece's mean base-colour luminance. It is the mean over every texel of its GLB's base-colour PNG, at full
  resolution with alpha ignored, of the Rec. 709 luminance of the sRGB-decoded channels.
- The headless test recomputes `m` from the GLB files.

| Piece | `m` |
|---|---|
| BagWall | 0.1409 |
| Footing | 0.1251 |
| Pipe | 0.1405 |
| Container20 | 0.1312 |
| FloodMast | 0.0661 |
| FloodLamp | 0.0597 |

**An outlier guard.** A texel's held luminance is then kept in [0.08, 0.5]:
- 0.08 lifts near-black frames and seams. A container's dark frame is its silhouette.
- 0.5 bounds white decals.
- The guard catches outliers only: every view keeps at least its read-off L\* spread (section 4).

**Saturation:** × `cover_sat`.

**The pool fade.** The fill is × `(1 − cover_pool × pool)`:
- `pool` = the strongest flood cone the fragment stands in: max over the Lot's floods of
  `smoothstep(cos 32°, cos 16°, dot(normalize(P − lamp), normalize(target − lamp)))`;
- the floods are `World.floodlights()`, the shared `WorldData.floodlights`;
- 32° is the floods' own spot angle.

All six footings and 7 of 16 bag walls stand in a cone.

**The sheen** (unchanged): the moon's colour × `(1 − N·V)^3` on the geometric normal, × `(1 − smoothstep(0.85, 0.97,
world N.y))`, so it is never on a flat up-facing face.

**No dim.** The albedo is left as it was.

**Per-renderer gains** (`Look.COVER_VALUES`):

| Renderer | fill | sheen | sat | pool |
|---|---|---|---|---|
| Forward+ / Mobile | 0.38 | 0.5 | 1.0 | 0.2 |
| Compatibility | 0.5 | 0.35 | 1.0 | 0.2 |

The band [0.22, 0.28], the guard [0.08, 0.5] and the power 3 are the same on both renderers and pinned.

**Per-piece scales** (`Look.COVER_SCALE`, one row per renderer):

| Renderer | Piece | Scale | Why |
|---|---|---|---|
| Forward+ | Footing | fill × 1.47 | Every footing is in a cone. 1.47 × 0.8 = the 0.45 its 60 m edge needs |
| Forward+ | BagWall | fill × 0.97, sheen × 0.6 | The corgi-rim bags (in a cone) at 10 m |
| Forward+ | FloodMast | fill × 0.82 (× 0.84 until W17 G-SKY, § 4b) | The cat-base ballast at 10 m |
| Forward+ | Container20 | fill × 1.32, sat × 1.3 | The near-black frame is its silhouette at 30 m; the paint is greyed by AgX |
| Compatibility | Container20 | fill × 2.2, sheen × 0.5 | Compatibility crushes the dark frame to black; half the sheen keeps the glow bound |

**Why Godot's pool gain is only 0.2.**
- No Godot view is flood-lit. The read-off body is 0.5–18.6 L\* on every view, both renderers, so the bar's "lit" case
  never applies here.
- A strong fade removes the footings' read. In the round-3 sweep, at pool 0.6 the Footing's 60 m edge fell to 12.1.
- At 0.2 the fade does one job: it holds the in-cone corgi-rim bags under the ceiling while the open slab bags keep
  their 60 m edge.

**A/B toggle:** `Look.set_cover_read(on)` or `-- --cover-read off`.

### 3. The metric and the bar

**Camera, placements and views:**
- The play camera: 1.5 m over the ground, fov 72, 1280 × 720, at 10 / 30 / 60 m.
- The placements and the 23 cover views plus 6 mast-pole views are as in round 2.
- The ballast / pole split is at the material's 1.25 m.

**Per view, the test renders:**
- the frame with the read on;
- the frame with the read off;
- two mask pairs: visible pixels, and the whole outline drawn alone.

**Measures:**
- **Edge** = the mean |ΔL\*| across the exterior silhouette, 2 px in against 2 px out. Since W17 G-SKY (§ 4b), each
  pair is classed by its outside sample: **Lot-backed** (Lot geometry) or **sky-backed** (the depth buffer at or past
  0.98 × the camera's far plane, from a sky-mask frame per view).
- **Body** = the visible pixels' mean L\*, L\* std and C\*.

**Bars** (asserted by `test_look_cover.gd`, shared with the web):
- **Ceiling:** a dark view (body < 35 L\* with the read off) may be lifted to 40 L\* at most at 10 and 30 m. A
  flood-lit view (≥ 35 off) may be lifted by 5 L\* at most there.
- **No flattening:** at every view and distance, body L\* std with the read on ≥ 0.85 × with it off.
- **Edge** ≥ 15 L\* at every cover view **at 10 and 30 m** (the fight distances, like the gap), over its **Lot-backed**
  pairs, when there are at least 30 of them (`EDGE_MIN_LOT`). At 60 m a Lot-backed edge under 15 is REPORTED with its
  pairs and mean ± SE (`EDGE_GATED_MAX` = 30; the known limits are in § 4b). The sky-backed pairs are printed beside it,
  not gated: a silhouette against the sky is the AIR / backdrop passes' read. A view with fewer than 30 Lot-backed
  pairs is "sky-backed only". At 10 / 30 m it is judged by the gated value gap at its place and fails if there is
  none. At 60 m it is reported. These are the lead's rulings of 2026-10-23 (§ 4b).
- **Value gap** ≥ 10 L\* at 10 and 30 m, the fight distances: at each base, the darkest cover body against the mast
  pole's body. At 60 m the gap is reported, not gated; the edge bar holds there. This is the lead's ruling of
  2026-10-12.
- **Draws** ×1.000 (lead ruling): gated exactly by the headless draw-item check (`test_look_cover.gd`, read on against
  off); the rendered run's `DRAW_GROWTH` 1.05 is only a tolerance.

**Reported, not asserted:**
- Forward+ std and C\* against Compatibility's. One run sees one renderer.
- The gap at 60 m.
- The sky-backed edge, and the all-pairs edge (the pre-W17 metric), on each view's `ring:` line.
- The Lot-backed edge at 60 m, when it is under 15: REPORTED, with n and mean ± SE.

### 4. Results

**Logs:** `scratchpad/g-cover2/logs/r3f/` (Forward+) and `logs/r3c/` (Compatibility).
- One `run.gd -- --only look_cover` run per place and distance (section 8).
- Values are body L\* / L\* std / C\*.
- "std ×" is std with the read on ÷ std with it off. The bar is 0.85.

| Place | Piece | m | F+ off | F+ on | F+ std x | F+ edge | Compat off | Compat on | Compat std x | Compat edge |
|---|---|---|---|---|---|---|---|---|---|---|
| corgi base | Footing | 10 | 13.3 / 7.8 / 7.4 | 38.7 / 9.6 / 13.7 | 1.23 | 25.1 | 8.5 / 9.3 / 8.0 | 26.0 / 12.0 / 13.4 | 1.29 | 22.7 |
| corgi base | Footing | 30 | 15.6 / 4.7 / 7.8 | 37.2 / 8.9 / 13.3 | 1.89 | 21.5 | 9.9 / 7.9 / 7.6 | 27.5 / 11.3 / 11.9 | 1.43 | 24.3 |
| corgi base | Footing | 60 | 13.8 / 3.5 / 6.3 | 29.3 / 8.3 / 9.0 | 2.37 | 15.9 | 10.0 / 7.0 / 6.4 | 23.0 / 11.2 / 8.7 | 1.60 | 21.2 |
| corgi base | BagWall | 10 | 17.3 / 12.3 / 5.1 | 39.1 / 12.6 / 6.1 | 1.02 | 47.7 | 16.5 / 14.0 / 8.5 | 32.7 / 16.0 / 8.5 | 1.14 | 47.4 |
| corgi base | BagWall | 30 | 17.7 / 10.2 / 5.2 | 37.4 / 11.6 / 6.5 | 1.14 | 33.4 | 18.6 / 13.4 / 7.9 | 35.6 / 13.4 / 8.4 | 1.00 | 33.3 |
| corgi base | BagWall | 60 | 13.9 / 6.8 / 4.8 | 27.6 / 8.6 / 4.2 | 1.26 | 19.5 | 16.3 / 11.5 / 6.9 | 27.6 / 13.6 / 6.5 | 1.18 | 21.5 |
| corgi base | FloodMast ballast | 10 | 1.2 / 1.2 / 1.7 | 32.6 / 16.5 / 18.4 | 13.75 | 44.4 | 0.5 / 0.1 / 1.3 | 20.4 / 14.1 / 18.4 | 141.00 | 32.9 |
| corgi base | FloodMast ballast | 30 | 9.5 / 1.5 / 4.5 | 33.8 / 13.2 / 14.6 | 8.80 | 24.1 | 0.5 / 0.1 / 1.3 | 21.8 / 12.4 / 18.5 | 124.00 | 26.2 |
| corgi base | FloodMast ballast | 60 | 13.6 / 0.6 / 5.0 | 27.7 / 9.7 / 10.0 | 16.17 | 24.9 | 0.5 / 0.0 / 2.1 | 19.8 / 10.0 / 12.7 | n/a (off std 0) | 26.3 |
| cat base | FloodMast ballast | 10 | 4.8 / 4.4 / 5.3 | 39.8 / 12.4 / 24.0 | 2.82 | 26.8 | 2.8 / 3.3 / 3.7 | 33.7 / 11.2 / 34.0 | 3.39 | 26.6 |
| cat base | FloodMast ballast | 30 | 7.1 / 3.9 / 5.7 | 36.8 / 10.4 / 26.8 | 2.67 | 36.3 | 4.4 / 3.8 / 5.1 | 35.5 / 7.8 / 37.1 | 2.05 | 39.7 |
| west lane | Container20 | 10 | 3.7 / 4.6 / 4.4 | 35.1 / 12.7 / 12.3 | 2.76 | 40.5 | 1.5 / 2.3 / 3.2 | 36.7 / 17.9 / 11.7 | 7.78 | 24.0 |
| west lane | Container20 | 30 | 4.9 / 8.4 / 4.1 | 36.9 / 11.1 / 10.2 | 1.32 | 18.6 | 3.2 / 8.7 / 2.8 | 32.2 / 10.8 / 8.4 | 1.24 | 19.4 |
| west lane | Container20 | 60 | 5.0 / 7.3 / 5.5 | 36.0 / 13.5 / 10.6 | 1.85 | 21.8 | 3.2 / 8.3 / 4.3 | 31.9 / 12.0 / 6.8 | 1.45 | 20.5 |
| west lane | BagWall | 10 | 12.5 / 9.9 / 6.8 | 39.2 / 12.9 / 3.5 | 1.30 | 43.4 | 7.6 / 7.8 / 7.2 | 31.1 / 16.1 / 2.8 | 2.06 | 40.1 |
| west lane | BagWall | 30 | 9.6 / 7.6 / 7.3 | 32.2 / 13.1 / 3.0 | 1.72 | 31.2 | 7.1 / 7.4 / 7.4 | 28.1 / 16.5 / 3.1 | 2.23 | 29.6 |
| west lane | BagWall | 60 | 8.2 / 4.9 / 8.0 | 27.6 / 8.4 / 4.3 | 1.71 | 19.2 | 8.5 / 5.9 / 9.4 | 28.3 / 11.5 / 4.2 | 1.95 | 20.9 |
| east lane | Pipe | 10 | 8.1 / 5.6 / 9.0 | 38.4 / 7.5 / 4.6 | 1.34 | 50.2 | 3.8 / 3.3 / 8.7 | 27.3 / 9.7 / 6.2 | 2.94 | 46.4 |
| east lane | Pipe | 30 | 7.3 / 4.7 / 9.2 | 31.9 / 6.7 / 5.6 | 1.43 | 39.2 | 5.1 / 4.1 / 9.4 | 25.3 / 9.5 / 6.5 | 2.32 | 35.8 |
| east lane | Pipe | 60 | 6.3 / 3.6 / 9.3 | 25.5 / 5.9 / 7.8 | 1.64 | 26.6 | 7.0 / 4.9 / 10.8 | 24.7 / 8.6 / 7.8 | 1.76 | 29.4 |
| slab approach | BagWall | 10 | 4.4 / 4.3 / 6.5 | 37.9 / 11.1 / 4.9 | 2.58 | 35.6 | 1.2 / 2.4 / 2.6 | 22.2 / 9.9 / 2.9 | 4.12 | 29.1 |
| slab approach | BagWall | 30 | 6.9 / 3.2 / 10.4 | 33.1 / 11.3 / 4.5 | 3.53 | 23.1 | 0.9 / 1.0 / 2.7 | 20.2 / 9.5 / 2.7 | 9.50 | 24.7 |
| slab approach | BagWall | 60 | 9.9 / 2.5 / 13.2 | 28.8 / 7.5 / 4.5 | 3.00 | 19.5 | 2.1 / 2.1 / 5.0 | 18.5 / 7.7 / 2.7 | 3.67 | 17.9 |


**Against the bar:**

| Check | Forward+ | Compatibility |
|---|---|---|
| Views lit by the floods (off ≥ 35) | none | none |
| Dark-view ceiling at 10 / 30 m (≤ 40) | all 16 pass; highest 39.8 (cat ballast 10 m) | all 16 pass; highest 36.7 (container 10 m) |
| No flattening (std × ≥ 0.85), all 23 | all pass; lowest × 1.02 (corgi-rim bags, 10 m) | all pass; lowest × 1.00 (corgi-rim bags, 30 m) |
| Edge ≥ 15, all 23 | all pass; lowest 15.9 (Footing 60 m) | all pass; lowest 17.9 (slab bags 60 m) |
| Value gap ≥ 10 at 10 / 30 m | all pass: corgi base 30.7 / 13.2; cat base 38.8 / 34.7 | all pass: corgi base 19.9 / 20.4; cat base 33.2 / 33.6 |
| Value gap at 60 m (reported) | corgi base **7.8** (known item, below) | corgi base 18.1 |
| Draws, read on vs off at 30 m | 127 vs 127 (× 1.000) | 153 vs 153 (× 1.000) |
| Split runs through `run.gd` | 15 of 15 PASS with the gap gated at 10 / 30 m (the 60 m gap prints as REPORTED) | 15 of 15 PASS |

**The 60 m row: the corgi-base gap on Forward+, 7.8. A known item for W17 AIR (the lead's ruling, 2026-10-12).**
- **The ruling.** Item 11's Godot half is accepted. The gap bar is gated at 10 and 30 m, the fight distances, as the
  lift rule is; at 60 m it is reported. The 7.8 is logged for the W17 AIR pass, which retunes the haze that lights the
  mast pole. No distance-dependent fill is added now: it would add a shared term the AIR pass would undo.
- **What it compares.** The darkest cover piece there is the rim BagWall, at 27.6, against the mast pole at 19.8.
  Forward+'s volumetric sodium haze lights the pole to about 20–22 L\* from 30 m out. Compatibility has no volumetric
  fog, and its pole stays at 1–2.
- **Why no constant gain reaches it.** The same piece must sit at 40 or under at 10 m and at 29.8 or over at 60 m, and
  the haze pulls the far body toward the pole's value. Measured with this rule on Forward+:

  | Global fill | Bags 10 m | Bags 60 m | Footing 10 m | Footing 60 m | Gap at 60 m | Ceiling |
  |---|---|---|---|---|---|---|
  | 0.45 | 45.3 | 30.7 | 37.9 | 29.3 | 6.5 | fails |
  | 0.8 | 53.8 | 38.4 | 47.7 | 35.6 | 12.8 | fails, by 14 |

  The pool fade and the per-piece scales act on the same fragments at 10 m and at 60 m, so they cannot separate the
  distances.
- **The test follows the ruling** (`GAP_GATED_MAX` = 30 m, `_gap_verdict()`). The Forward+ `corgi base` /
  `COVER_D=60` run passes and prints `gap 7.8  REPORTED (gated at <= 30 m only)`; at 30 m it gates (13.2, PASS).
- **Mutant proof:**
  - **H28** drops the 30 m gate (`GAP_GATED_MAX` 30 → 10). It fails headless: the gate's self-check (a gap of 5 at
    30 m must FAIL) sits in the CI part of `test_look_cover.gd`.
  - **H29** gates 60 m too (the rendered verdict called with distance 0). It passes headless, as the self-check is
    untouched. It fails the Forward+ `corgi base` / `COVER_D=60` run:
    `FAIL ... cover vs non-cover at corgi base|60: darkest cover L* 27.6, mast pole L* 19.8 (gap < 10.0)`.

**Forward+ against Compatibility, at 10 / 30 m (reported).**
- Forward+ std ≥ Compatibility's in 7 of 16 views; C\* in 8 of 16.
- Compatibility crushes dark tones and so spreads L\* and chroma further. Forward+'s AgX compresses and greys them. On
  Forward+ the read now keeps each piece's own texture (std × 1.02–16 against read-off), but not Compatibility's
  contrast.
- Raising Forward+'s sat would lift C\* where it falls short (bags, ballasts, pipe). It was not tuned: by the lead's
  ruling this comparison is report-only.

Not measured:
- The cat-base ballast at 60 m: no clear line of sight from the Cat approach in ±80°.
- The FloodLamp heads: overhead and not cover.

### 4b. W17 G-SKY: the SOURCE sky, the FloodMast fill, the split edge ring and the 60 m fog limit

Godot draws the shared sky SOURCE `assets/sky/lot_night_sky.exr` (BL-DCC's v3, sha 1f6e85de…, accepted as the art).
The fog is the receipt's horizon at `SKY_ENERGY` (0.60, ruled), and the Lot's sky ambient is held at item 11's level
(`SKY_LIGHT_ENERGY` 0.12). G-ATMOS.md § G-SKY has the full record. Logs are in the session scratchpad under `g-sky/`.

**1. Forward+ FloodMast fill × 0.84 → × 0.82** (ruling (b), on v2). The brighter sky moved the cat-base ballast's MSAA
mask edge, and the ceiling read 40.2 at 10 m. At × 0.82 it is 39.8, and it stays at 39.7–39.8 on v3. The ballast
edges hold at 10, 30 and 60 m. The FloodMast's glow peak is 0.805.

**2. The split edge ring** (lead's ruling, 2026-10-23; § 3). Under a lit overcast deck, the old ring tested the sky by
accident: Forward+ west lane 30 m read 11.9 because the container's dark top rail sits at the deck's value.

Proof on HEAD's W13 sky (all 15 runs × both renderers):
- The all-pairs edge reproduces § 4's numbers in every view.
- In rings with no sky pairs, the Lot-backed edge equals it exactly.
- Numbers move only where sky pairs were in the ring.
- The one verdict change is the corgi-rim bags at 10 / 30 m on both renderers. They sit above eye height, so they
  have 3–26 Lot pairs. They become "sky-backed only" and pass on the corgi-base gap: 30.8 / 13.2 on Forward+,
  19.9 / 20.4 on Compatibility.

Mutants:
- **A:** the container darkened to its ground's value is killed by the gated Lot-backed edge on both renderers (0.6 to
  3.0 L\*).
- **B:** every ring classed as sky never passes silently. Views are judged by the gated gap at 10 / 30 m, REPORTED at
  60 m, and FAIL where there is no gap.

`EDGE_MIN_LOT` = 30 (three times the 10-pair skip rule; about 3.6 m of silhouette at 60 m; SE 0.6–1.9 L\* on the
smallest sky-free rings).

**3. The bar on v3 at 0.60 with the split.** Forward+ passes 12 runs: every place at 10 and 30 m, and corgi base and
cat base at 60 m. West lane 30 m is now Container20 Lot-backed 17.4. It **stops at west lane 60 m: Container20
Lot-backed 13.2 ± 0.6** (248 pairs). Compatibility west lane 60 m is 12.2 ± 0.5. Compatibility east lane 60 m is
**Pipe 8.4 ± 1.3** (31 pairs).

On W13 these were 16.8, 15.7 and 17.4. **The cause is the fog, not the ring:** these pairs are Lot-backed. The fog is
the receipt horizon × 0.60, about 3.3× brighter than W13's, and at 60 m it lifts the far Lot behind the piece:
Forward+ container out L\* goes from 6.3 to 11.7.

**4. The per-renderer knob, measured** (lead's ruling: sweep the Container20 fill before any bar is loosened; private
copy only). Each cell is the Lot-backed edge ± SE / body L\* / std against its 0.85 × read-off floor. The verdict is the
test's own.

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

- **Forward+:** no value in the ruled range clears 60 m. × 1.56 reads 15.0 ± 0.6 and is still a FAIL by the test (just
  under 15). Its 30 m body is 39.3 against the 40 ceiling, so the knob runs out of ceiling before the edge clears its
  SE.
- **Compatibility:** × 2.6 clears 60 m (16.0) but breaks the 10 m ceiling (43.5). × 2.46 fails both (14.6; 41.4).
- **East lane Pipe at 60 m:** it does not move with the container fill. On Compatibility it fails as shipped (8.4
  ± 1.3).
- **The glow bound holds at the top values:** Container20 peak 1.080 on Forward+ at × 1.56, and 1.152 on
  Compatibility at × 2.6, against 1.3.

**Status: no value meets both bars, so the shipped rows are unchanged** (Forward+ × 1.32, Compatibility × 2.2).

**5. Option 3** (lead's ruling, 2026-10-23). The edge is gated at 10 and 30 m and REPORTED at 60 m, like the gap. The
fight distances are bot ai_range 7–24 m and rifle falloff 24–48 m. At 60 m the read belongs to the haze that the
fog = horizon contract sets. Headless mutants E1 (60 m gated), E2 (30 m reported) and E3 (REPORTED → ok) are killed.

**Known limits** (a PARITY-style DIFF; the AIR pass's targets; Lot-backed edge at 60 m, at `SKY_ENERGY` 0.60):

| Known limit | Lot-backed edge (pairs) | W13 |
|---|---|---|
| Forward+ west lane 60 m Container20 | 13.2 ± 0.6 (248) | 16.8 |
| Compatibility west lane 60 m Container20 | 12.2 ± 0.5 (205) | 15.7 |
| Compatibility east lane 60 m Pipe | 8.4 ± 1.3 (31) | 17.4 |
| Compatibility corgi base 60 m BagWall[3] | 14.7 ± 1.2 (60) | 21.5 |
| Compatibility slab approach 60 m BagWall[13] | 10.5 ± 0.6 (71) | 17.9 |

All five are measured in this bar (v3 at 0.60, 30 of 30 runs PASS); each prints REPORTED, and the lead accepted all five as named known limits.

**Rule:** the AIR pass must raise each toward ≥ 15, or bring a measured ruling. Any later pass that lowers one by more
than 2 SE (its printed SE) is a regression: `test_look_cover.gd` `EDGE_LIMITS_60` fails it, and any other 60 m
edge under 15 (not a named limit) fails too, as does a named limit that turns "sky-backed only". `SKY_FAR_FRAC` is
pinned to [0.95, 1) headless (the fresh verifier's mutant c).

### 5. Draw budget (P-GLB4)

| Check | Result |
|---|---|
| The test's own A/B (30 m views, read on vs off), summed over the five 30 m runs | Forward+ 127 vs 127; Compatibility 153 vs 153 (× 1.000) |
| Headless (CI) structural check | one MultiMesh per piece plus KitShadow; the look's own draw items are unchanged when the read toggles |
| Why | the read is uniforms and a branch in the same material: no mesh, placement or collider |

### 6. Shots

All are the test's own views (no HUD), JPEG quality 80. "Now" is this pass (`shots/r3f`, `shots/r3c`); "HEAD" is
`7a671f1`.

| File | View |
|---|---|
| `cover-godot-fplus-small-10m.jpg` | **Forward+ at 10 m, the small pieces.** Rows: the corgi-base Footing, the corgi-rim BagWall, the cat-base ballast. Columns: HEAD, round 2, now. 1500 px |
| `cover-godot-fplus-10m.jpg` | **Forward+ at 10 m:** the west-lane container and the east-lane pipe. Columns: HEAD, the first pass, now. 1500 px |
| `cover-godot-corgi-base.jpg` | 30 m from a pit footing |
| `cover-godot-corgi-base-10m.jpg` | 10 m below the west mast's ballast |
| `cover-godot-cat-base.jpg` | 30 m from the east heap mast |
| `cover-godot-west-lane.jpg` | the containers at 30 m |
| `cover-godot-east-lane.jpg` | the pipes at 30 m |

The last five are 2 × 2 grids, 1200 px: rows before (HEAD) / after, columns Compatibility / Forward+.

**What I see:**
- **The small pieces, Forward+ 10 m.**
  - Round 2's flat cream blocks are gone.
  - The Footing shows its stencils and concrete wear.
  - The rim bags show each sack's weave, seams and shading.
  - The ballast shows its yellow and black stripes and its scuffs.
  - All are lifted clear of the dark lot, at a lower value than round 2's.
- **Container and pipe, Forward+ 10 m.**
  - The container keeps its blue-grey paint with rust, a darker inside wall and a rust-orange floor. The floor is the
    most saturated thing in the lane. Its hue is the paint's; sat × 1.3 pushes it.
  - The pipe is light-grey concrete with its stains and pocks, not the first pass's smooth cream.
- **The 30 m grids.**
  - Every cover piece is a lit value with its own texture.
  - The containers' frames read as dark-grey outlines (lifted by the guard), not black.
  - The mast poles and lamp housings stay dark lines.
  - The night stays night: sky and ground are unchanged.

### 7. The look lock

| Check | Result |
|---|---|
| `LOOK` | still `"stylised-realistic"` |
| Outlines | none (`test_look_scene` `outline_scan` PASS) |
| Glow | each piece's brightest texel, max(r, g, b) exposed, is under the threshold of 1.3 (asserted per piece and renderer; table below) |
| Night, sky, ground, floods | unchanged in item 11; W17 G-SKY swaps the sky for the shared SOURCE (§ 4b), with the Lot's sky ambient held at item 11's level |
| `test_look_contract` | PASS |

**The glow bound (item 11b): max(r, g, b), texel by texel.** Godot 4.7.2's glow keys on a pixel's brightest
channel, not on its luminance. The round-3 luminance bound therefore under-read one piece: Compatibility's FloodMast,
asserted at 0.90, peaks at 0.942.

`_glow_check()` now runs every texel of each cover piece's GLB base colour through the shader's own rule. It uses:
- the ORM metal, for the porous darkening;
- each placement's paint tint;
- the brightest wet factor, `mix(1, WET_DARKEN, 0.75)` = 0.775;
- no pool fade;
- a full sheen on top.

It takes max(r, g, b) of the emission, × exposure 1.5, and asserts the result under 1.3. These numbers match the
verifier's independent `glowpeak.py` to the third decimal:

| Piece | Forward+ | Compatibility |
|---|---|---|
| Container20 | 1.016 | 1.010 |
| Footing | 0.873 | 0.652 |
| Pipe | 0.817 | 0.665 |
| FloodMast (ballast) | 0.809 | 0.942 |
| BagWall | 0.591 | 0.725 |

- The highest is 1.016, 0.28 under the threshold.
- The bound is exact per texel. The GPU's filtering blends texels, and the read is not proven never to exceed the
  brightest texel's peak; the 0.28 of headroom covers that.

### 8. Limits and how to run it

- **Software renderers only** (llvmpipe, lavapipe).
- **Prims that stop bullets** are outside the card's six GLBs, as in round 2.
- **Headless (CI)** runs:
  - the collider table;
  - `COVER_MEAN` against the GLBs;
  - the shader-rule pins (`SHADER_RULE`), including the zone's height `ly = VERTEX.y` and the lens's own emission;
  - that the shader writes `EMISSION` exactly twice, and that the cover block, from the lens's `EMISSION =` on, is
    exactly the pinned statements in order, with nothing inserted between them and nothing after, and that the rule's
    inputs outside it (`wet_alb`, `ly`, `wpos`, `wnrm`) are each written exactly once;
  - the band, guard and power pins;
  - the moon colour: `Look.COVER_SHEEN_COLOR` is (0.62, 0.72, 0.95), and every cover material receives it;
  - each renderer's values and per-piece scales, through `cover_scale()` and `_cover_params()` called for
    `forward_plus`, `mobile` and `gl_compatibility`. The gains themselves are gated by the rendered bar, not
    headless: the verifier's Forward+ pool 0.2 → 0 passes headless and fails corgi base 10 m (Footing 42.4 > 40);
  - the floods on every material;
  - the glow bound on max(r, g, b) (§7);
  - the draw shape;
  - the A/B toggle: `set_cover_read(false)` zeroes every cover material's fill and sheen, and `set_cover_read(true)`
    restores them.

  Of 29 mutants of the rule and the gates (21 in `scratchpad/g-cover2/mut.py`, 8 in `scratchpad/g-cover2/mut11b.py`),
  28 fail it headless; H29, which gates the 60 m gap, fails the rendered run instead (§4). The item 11b follow-up
  adds the verifier's MY4 (`held *= 3.0;` before the pool loop) and MY5 (`pool = 0.0;` before `EMISSION +=`), each
  inserted between two pins; the contiguous-block check fails both headless. The final verification added X2
  (`wet_alb *= 3.0;` before the block: headless PASS, rendered Compatibility west lane 10 m Container20 66.8 > 40) and X3
  (`ly -= 0.3;` after the vertex pin); the write-once check fails both headless. The 29 include:
  - H5 (the band's floor ignored);
  - H6 (the power hard-coded to 2);
  - H11 (the up-face mask removed);
  - H14 (the mask inverted);
  - Forward+'s scales applied on Compatibility;
  - the gate inverted;
  - item 11b's eight: an extra emission term after the rule (V6, two forms); the toggle ignored or never restored
    (V7, two forms); `ly` moved; the moon colour not sent, or moved; and a Compatibility FloodMast fill × 1.8 that
    the old luminance bound passed and the max-channel bound catches (1.552).
- **The rendered bar runs per place and distance.** The whole set takes 10+ min on a software Forward+, past
  `run.gd`'s 600 s watchdog, so it is split into 15 runs, each through `run.gd` and under the watchdog. A place's mast
  pole always comes with it, so every run still checks the gap:

  ```
  cd engines/godot
  for d in 10 30 60; do for p in "corgi base" "cat base" "west lane" "east lane" "slab approach"; do
    COVER_ONLY="$p" COVER_D=$d xvfb-run -a godot --path . \
      --rendering-method forward_plus --rendering-driver vulkan \
      --script res://tests/run.gd -- --only look_cover || echo "FAIL $p $d"
  done; done
  ```

  - For Compatibility, use `--rendering-method gl_compatibility --rendering-driver opengl3`.
  - Longest single run: Forward+ 243 s (west lane, 30 m, at load average 14–21 on 4 cores, while other lanes ran);
    Compatibility 89 s.
  - On a box loaded harder still, a place can be split further: `COVER_ONLY="corgi base/Footing"` and so on.
- **The web's parse test.** `tests/unit/kit-cover.test.ts` passes 11/11 against these files: it parses the shared
  terms from `look.gd` and `kit_wet.gdshader` and recomputes COVER_MEAN from the master GLBs within 0.0005.

## Web (lane tw-look)

The slab twin draws The Lot's six kit GLBs with `pbr()` (`?kit=glb`, the slab default).

### 1. The cover set (Godot's, from the same colliders)

- `kit-glb.ts` gives each piece a `cover` value. It is `COVER_ALL` for Container20, BagWall, Pipe and Footing; 1.25 m
  (the ballast) for the FloodMast; and 0 for the FloodLamp.
- `tests/unit/kit-cover.test.ts` recomputes Godot's `cover_table` from the shared colliders:
  - the colliders come from `createWorldData(1, 'the_lot')`, through Godot's `OWNER` map;
  - each placement's footprint comes from the master GLB's LOD0 bounds;
  - the constants are Godot's: `SHIELD_W` 1 m, `GROUND_EPS` 0.35 m, `BODY_H` 0.6 m.
- The test checks the piece table against the computed table. The numbers match section 1:

| Piece | Cover up to | Collider top | `cover` |
|---|---|---|---|
| Container20 | 10.40 m | 10.40 m | all |
| BagWall | 0.85 m | 1.06 m | all |
| Pipe | 5.68 m | 5.68 m | all |
| Footing | 1.36 m | 1.36 m | all |
| FloodMast | 1.09 m | 21.93 m | 1.25 m (ballast) |
| FloodLamp | 0 | 23.50 m | none |

### 2. The rule (Godot's, copied) and the web's gains

The rule is `kit_wet.gdshader`'s cover block, copied into `style-webgpu.js` `coverRead()` as
`docs/handoff/G-ATMOS.md` "The rule the web twin mirrors" specifies. On the cover zone the emission adds:

```
held  = wet albedo × clamp(mean, 0.22, 0.28) / max(mean, 1e-4)        mean = the piece's COVER_MEAN
        each texel's luminance kept in [0.08, 0.5] (black → grey 0.08), saturation × sat
pool  = max over the floods of smoothstep(0.848, 0.961, dot(normalize(world pos − lamp), aim))
emission += held × fill × (1 − pool_k × pool)
          + moon × sheen × (1 − N·V)³ × (1 − smoothstep(0.85, 0.97, world normal y))
```

- **Shared, copied exactly:**
  - the band (0.22, 0.28), the guard (0.08, 0.5), the power 3, the up-face edges (0.85, 0.97) and the cone
    (0.848, 0.961);
  - the luminance weights, the 1e-4 guards and the moon colour (0.62, 0.72, 0.95, sRGB);
  - `COVER`, and `COVER_MEAN` (`KitPiece.coverMean`);
  - the floods: `WorldData.floodlights`, the same data as Godot's `the_lot.json`, at most 8.
  - `kit-cover.test.ts` parses every one of these from `look.gd` and `kit_wet.gdshader`. It also recomputes
    `COVER_MEAN` from the master GLBs' baseColor images, within 0.0005 of Godot's table on all six.
- **Web-only:**
  - The sheen's normals (the graze's and the up-face mask's) are turned to the viewer on a back face, because the kit
    GLBs are double-sided here while Godot culls back faces.
  - The FloodMast's zone is measured from each placement's foot through the `coverBase` vertex float.
  - **The tier decides the pool's floods** (W17 item 11b; PARITY P2a). Godot builds all 4 floods at every quality.
    The web gives them real lights only within the tier's budget (high 4, medium 2, low 0). So the pool term counts the
    floods only at a tier that lights them, and none at low, where nothing would replace the faded fill
    (`kit-glb.ts` `kitLitFloods`). `world-view.ts` passes the kit view the same `q` its lamps take.
  - The albedo is left as it was, on the zone and off it (no dim).
  - `setCoverRead(on)` is a uniform A/B: same material, same draws.

**The gains: per build, the web's own.** All four were measured with the metric below, against the lead's bar.

| | fill | sheen | sat | pool | Per-piece scale |
|---|---|---|---|---|---|
| **Web** | **0.16** | **0.10** | **1.0** | **1.0** | **Container20 fill ×2.1, FloodMast fill ×0.85** |
| Godot Forward+ | 0.38 | 0.5 | 1.0 | 0.2 | `COVER_SCALE`: Footing, BagWall, FloodMast, Container20 |
| Godot Compatibility | 0.5 | 0.35 | 1.0 | 0.2 | Container20 |

**Why these gains.** Each one is set by a bar it would otherwise break:
- **pool 1.0:** the fill is gone inside a flood's cone. The corgi-base footings and rim bag walls stand in the pool at
  L\* 39–41 before any read; at pool 0.2 the footing was lifted +7.2 (bar: ≤ 5).
- **sheen 0.10:** the pool does not touch the sheen (shared rule), so the sheen alone lifts the lit rim bag wall.
  - Above 0.13 the lift at 30 m breaks the bar: +5.1 at sheen 0.15 in the full-run order. At 30 m a view keeps the
    previous view's LOD (the `KIT_LOD_HYST` band, 28.5–31.5 m); measured alone it is +2.8.
  - Below about 0.10 the pipe's edge at 60 m drops under 15. At fill 0.15 it was 14.3 at sheen 0.05 and 13.7 at 0.
- **fill 0.16:** the pipe's edge at 60 m needs it (15.1). The west-lane bag wall at 10 m, a dark view, sets the top:
  39.5 at 0.16, at or under 40.
- **sat 1.0:** saturation keeps luminance, so it moves no bar.

**The per-piece scales** are allowed by lead ruling, fill only, each in [0.5, 2.5]. Every value is pinned in
`kit-cover.test.ts`, with a mutant each.
- **High and medium** (`KIT_COVER_SCALE`): Container20 and FloodMast.
- **Low** (`KIT_COVER_SCALE_LOW`, W17 item 11b): a second row laid over the first at q=low only. The web's tier plays
  the part of Godot's renderer, whose `COVER_SCALE` has a row per renderer. It holds Footing, BagWall and Pipe.
  Container20 and FloodMast keep their high/medium values at low. It is tuned at the game's real low profile (shadow
  pass and bloom off, low style detail; see the metric's tier convention below).

| Piece | Scale | Measured reason |
|---|---|---|
| Container20 | fill ×2.1 | Its silhouette at 30 m is its near-black frame, which the guard holds at 0.08. At the global fill its edge at 30 m was 14.6 (×2.0) and 7.1 (×1). At ×2.1 it is 16.2. At ×2.3 its body at 10 m reaches 39.8, too close to the 40 ceiling. |
| FloodMast | fill ×0.85 | Its mean of 0.0661 gives the ballast a ×3.3 gain. At the global fill the cat-base ballast, a dark view, went over 40: 40.6 at fill 0.15. At ×0.85 it is 37.7 / 38.9 at 10 / 30 m. |
| Footing (low only) | fill ×1.32 | At low, with no pool, the pit footing's 60 m edge is 12.55 at ×1, against the low tier's lit ground decal around it. Its 10 / 30 m body (a dark view at low) allows at most ×1.32: 39.7 / 39.9 (×1.33 gives 39.8 / 39.97; ×1.35 puts the 10 / 30 m body at 40.04 / 40.2). At ×1.5 the 60 m edge is still 14.95, and the 10 / 30 m body is 41.6 / 41.7. So 14.1 at 60 m remains (below). |
| BagWall (low only) | fill ×0.75 | At low the corgi-rim walls are no longer lit and take the whole fill: 42.1 / 42.6 at 10 / 30 m at ×1, over 40. At ×0.75 they are 39.0 / 39.7, and the lane walls keep edge ≥ 18.0. |
| Pipe (low only) | fill ×1.05 | At low its 60 m edge is 14.95 at ×1. At ×1.05 it is 15.2, with its 10 m body at 39.3 and its std ratio at 0.66 (floor 0.60). ×1.1 puts the 10 m body at 39.9. |

**Glow.** The peak emission is a texel at the guard's cap × the fill (outside every pool) plus a full sheen:
luminance 0.5 × 0.16 × 2.1 + 0.10 × 0.48 = 0.22. Exposed (×1.5) that is 0.32, against the bloom threshold of 1.3.
The test asserts it with the largest per-piece scale.

### 3. The metric and the bar

**Tools.** `labs/cover.html` is the lab and `labs/cover-metric.mjs` runs it. The lab loads The Lot and the kit, with
rain off and the clock still.

**Camera.** It is Godot's play camera: 1.5 m over the ground, fov 72, 1280 × 720. It stands 10, 30 or 60 m from
each of Godot's `SAMPLES`, toward the same approach points. The turn search (0, ±20 … ±80°) is the same, with a clear
line of sight through the shared colliders and the terrain.

**Frames per view:**
1. The normal frame, with the cover read off and then on.
2. A mask frame: the part in flat colour, everything else black. These are its visible pixels.
3. The same mask drawn alone. This is its whole outline.

**Measures** (Godot's):
- **Edge** (`_edge_read`): the mean |ΔL\*| from 2 px inside the visible part to 2 px outside the outline.
- **Body** (`_body`): the mean L\*, its std and the mean C\* of the visible pixels, every 2nd pixel.

**The bar** (lead ruling, shared with Godot; it is `cover-metric.mjs`'s exit code):
- **Edge:** ≥ 15 at every distance.
- **Gap:** the darkest cover body against the brightest mast-pole body, ≥ 10 at 10 and 30 m. At 60 m it is reported,
  not gated.
- **Ceiling,** at 10 and 30 m on every cover piece:
  - a dark view (read-off body < 35) stays ≤ 40 with the read on;
  - a lit view (read-off body ≥ 35) is lifted ≤ 5.
- **Std:** in every view, the std with the read on is ≥ 0.85 × the read-off std. Two samples have calibrated floors,
  each its measured best minus 0.05 (below).
- **Draws:** equal in every view.

`REGATE=<results.json>` re-applies the bar to a saved run, and `GATE=<config>` bars another config of a sweep.

**The calibrated std floors** (lead ruling: the measured best ratio, holding every other bar, minus 0.05):

| Sample | Floor | Measured best | At | Why 0.85 is out of reach |
|---|---|---|---|---|
| east lane Pipe[0] | **0.60** | 0.65 (its worst view, 60 m) | fill 0.16, sheen 0.10, pool 1, ×2.1 / ×0.85 | Its read-off std is shading across the cylinder (L\* 15, std 8.5), not texture. Any fill that holds its 60 m edge at 15 compresses that shading in L\*. Every measured config that held the edge was at 0.56–0.65; sheen 0 gives 0.84 but edge 13.7. |
| corgi base BagWall[3] (the lit rim) | **0.59** | 0.64 (30 m) | the same | Its fill is pooled away; the sheen flattens it. It keeps 0.85 only at sheen ≤ ~0.03 (0.98 at 0), and below sheen 0.10 the pipe's edge fails. |

Every other sample keeps 0.85.

**Results**, the shipped values, the full 29-view run: read off → on.

| Place | Piece | m | Off: body / std / C\* / edge | **On: body / std / C\* / edge** | Class | Lift | Std kept (floor) | Bars |
|---|---|---|---|---|---|---|---|---|
| corgi base | Footing | 10 | 39.0 / 11.0 / 25.7 / 23.2 | **39.2 / 10.7 / 25.6 / 23.1** | lit | +0.1 | ×0.97 | edge ✓ lift ✓ std ✓ draws ✓ |
| corgi base | Footing | 30 | 40.9 / 8.9 / 25.9 / 29.9 | **40.9 / 8.9 / 25.9 / 29.9** | lit | +0.0 | ×1.00 | edge ✓ lift ✓ std ✓ draws ✓ |
| corgi base | Footing | 60 | 34.2 / 8.3 / 21.3 / 18.0 | **34.2 / 8.3 / 21.3 / 18.9** | - |  | ×1.00 | edge ✓ std ✓ draws ✓ |
| corgi base | BagWall | 10 | 39.6 / 17.2 / 16.2 / 30.2 | **42.3 / 14.1 / 15.9 / 29.5** | lit | +2.7 | ×0.82 (0.59) | edge ✓ lift ✓ std ✓ draws ✓ |
| corgi base | BagWall | 30 | 39.3 / 16.5 / 15.4 / 30.4 | **43.4 / 10.6 / 15.8 / 29.6** | lit | +4.1 | ×0.64 (0.59) | edge ✓ lift ✓ std ✓ draws ✓ |
| corgi base | BagWall | 60 | 33.5 / 13.6 / 14.0 / 22.0 | **34.7 / 13.0 / 13.4 / 16.5** | - |  | ×0.96 (0.59) | edge ✓ std ✓ draws ✓ |
| corgi base | FloodMast ballast | 10 | 3.0 / 3.4 / 3.1 / 6.7 | **26.9 / 15.2 / 15.9 / 29.8** | dark |  | ×4.49 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| corgi base | FloodMast ballast | 30 | 4.0 / 3.4 / 2.7 / 4.9 | **28.8 / 12.8 / 14.5 / 26.9** | dark |  | ×3.80 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| corgi base | FloodMast ballast | 60 | 5.2 / 2.2 / 3.1 / 3.0 | **25.9 / 10.6 / 11.1 / 25.6** | - |  | ×4.85 | edge ✓ std ✓ draws ✓ |
| corgi base | FloodMast pole | 10 | 1.0 / 1.9 / 1.9 / 12.4 | **1.0 / 2.0 / 1.9 / 15.0** | pole |  | ×1.07 | std ✓ draws ✓ |
| corgi base | FloodMast pole | 30 | 4.2 / 7.5 / 4.9 / 12.0 | **4.2 / 7.5 / 4.9 / 12.9** | pole |  | ×1.00 | std ✓ draws ✓ |
| corgi base | FloodMast pole | 60 | 4.2 / 3.8 / 5.5 / 10.8 | **4.2 / 3.8 / 5.5 / 11.3** | pole |  | ×1.00 | std ✓ draws ✓ |
| cat base | FloodMast ballast | 10 | 12.2 / 9.2 / 9.7 / 13.1 | **37.7 / 11.1 / 22.1 / 29.3** | dark |  | ×1.22 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| cat base | FloodMast ballast | 30 | 14.7 / 7.0 / 8.3 / 8.2 | **38.9 / 7.3 / 22.3 / 30.5** | dark |  | ×1.05 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| cat base | FloodMast pole | 10 | 1.1 / 1.7 / 2.7 / 11.6 | **1.9 / 4.7 / 2.9 / 13.7** | pole |  | ×2.74 | std ✓ draws ✓ |
| cat base | FloodMast pole | 30 | 3.6 / 6.3 / 4.9 / 12.0 | **3.6 / 6.3 / 4.9 / 12.0** | pole |  | ×1.00 | std ✓ draws ✓ |
| cat base | FloodMast pole | 60 | 3.0 / 1.2 / 6.4 / 10.8 | **3.0 / 1.2 / 6.4 / 11.3** | pole |  | ×1.00 | std ✓ draws ✓ |
| west lane | Container20 | 10 | 6.8 / 7.8 / 6.9 / 5.7 | **39.4 / 10.8 / 7.6 / 26.8** | dark |  | ×1.39 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| west lane | Container20 | 30 | 7.2 / 7.7 / 6.3 / 7.7 | **37.1 / 9.0 / 4.5 / 16.2** | dark |  | ×1.17 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| west lane | Container20 | 60 | 6.5 / 5.9 / 9.4 / 5.9 | **36.0 / 10.0 / 5.1 / 19.2** | - |  | ×1.71 | edge ✓ std ✓ draws ✓ |
| west lane | BagWall | 10 | 20.5 / 12.6 / 7.6 / 16.4 | **39.5 / 12.4 / 1.7 / 36.6** | dark |  | ×0.98 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| west lane | BagWall | 30 | 18.8 / 11.4 / 8.3 / 15.1 | **37.4 / 11.9 / 1.6 / 28.8** | dark |  | ×1.04 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| west lane | BagWall | 60 | 17.3 / 9.9 / 9.0 / 11.5 | **34.8 / 10.2 / 2.4 / 20.2** | - |  | ×1.03 | edge ✓ std ✓ draws ✓ |
| east lane | Pipe | 10 | 15.3 / 8.5 / 13.3 / 10.7 | **38.6 / 5.6 / 3.6 / 25.0** | dark |  | ×0.66 (0.6) | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| east lane | Pipe | 30 | 15.7 / 8.0 / 13.7 / 8.4 | **36.5 / 5.6 / 4.1 / 16.0** | dark |  | ×0.70 (0.6) | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| east lane | Pipe | 60 | 16.6 / 6.7 / 14.3 / 8.2 | **34.8 / 4.4 / 5.1 / 15.1** | - |  | ×0.65 (0.6) | edge ✓ std ✓ draws ✓ |
| slab approach | BagWall | 10 | 13.0 / 8.6 / 6.8 / 12.4 | **39.3 / 9.8 / 2.7 / 36.2** | dark |  | ×1.14 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| slab approach | BagWall | 30 | 11.7 / 7.0 / 7.5 / 8.1 | **35.3 / 10.6 / 2.5 / 27.8** | dark |  | ×1.52 | edge ✓ ≤40 ✓ std ✓ draws ✓ |
| slab approach | BagWall | 60 | 10.6 / 6.1 / 8.5 / 5.2 | **31.7 / 9.2 / 1.8 / 24.2** | - |  | ×1.51 | edge ✓ std ✓ draws ✓ |

**Gap** (darkest cover body against the brightest pole body; gated at 10 and 30 m):

| Place | m | Darkest cover | Pole | Gap |
|---|---|---|---|---|
| corgi base | 10 | 26.9 | 1.0 | 26.0 |
| corgi base | 30 | 28.8 | 4.2 | 24.5 |
| corgi base | 60 | 25.9 | 4.2 | 21.7 (reported) |
| cat base | 10 | 37.7 | 1.9 | 35.9 |
| cat base | 30 | 38.9 | 3.6 | 35.3 |

**Verdict:** `COVER PASS`, exit 0.
- The worst edge is 15.1 (the pipe at 60 m); none of 23 is under 15.
- The minimum gap is 24.5 at 10 and 30 m.
- Dark bodies are 26.9–39.5. The lit lifts are +0.0 to +4.1.
- The worst std ratios are the pipe's 0.65 (floor 0.60) and the rim bag wall's 0.64 (floor 0.59). Every view of
  every other sample keeps ≥ 0.97.
- Draws are 2106 → 2106, equal in every view.

**The tiers** (W17 item 11b), each the full 29 views at the shipped values, each at the game's own profile for the
tier (the render context's shadows, bloom and style detail, and the world view's floods and scale row), pixel ratio 1:
- **q=high:** `COVER PASS`, identical to e75c591 to the last digit on every view. High is the render context's default
  profile, so passing the tier changes nothing there.
- **q=med:** `COVER PASS`, close to high but not identical:
  - its edges are within 0.9 L\* of high's and its bodies within 0.3, from the medium world's own knobs (two real flood
    lights instead of four, among others) and its style detail;
  - against item 11b's first med run, which left the render context at high, the medium style detail alone moves
    values by at most 0.12;
  - worst edge 15.1, minimum gap 21.7, the rim bag wall's std ratio 0.64 (floor 0.59), draws 2106 → 2106.
- **q=low:** 28 of 29 pass (exit 1). The residual is Footing[1] at 60 m: edge 14.1 against 15 (8.2 with the read off).
  It is logged in PARITY P2a as a known low-tier limit; the tier is web-only and not gated. At low:
  - Footing[1] edge 16.8 / 31.7 at 10 / 30 m, body 39.7 / 39.9;
  - the rim BagWall[3] body 39.0 / 39.7 at 10 / 30 m, std ratio 0.80 / 0.73 (floor 0.59);
  - the Pipe's edges 24.1 / 16.1 / 15.2, its 10 m body 39.3, std ratio ≥ 0.66 (floor 0.60);
  - the lane bag walls' edges ≥ 18.0; the minimum gap is 26.1 at 10 and 30 m (23.0 at 60 m, reported);
  - draws equal per view (1151 → 1151: no shadow pass at low).
- The numbers item 11b first gave for low (28 of 29, Footing ×1.35, residual 14.3) were measured with the lab's render
  context left at high (shadows, bloom and high style detail on), so they were not the game's low tier. They are
  superseded by these.

Not measured:
- **The cat-base ballast at 60 m.** No clear line of sight from the cat approach within ±80°, as in Godot.
- **The lamp heads.** They are overhead. They carry no cover read (cover 0) and stay dark lines because nothing lights
  them; there is no dim.

**The gate catches a broken rule.** Two runs show it:
- **M5,** the emission not masked to the zone, on views 0, 2, 3, 4 and 5 at 30 m: exit 1. The mast poles light up, so
  the gaps fall to −0.3 and 2.9.
- **The sweeps.** Every gain set but the shipped one fails something:
  - fill 0.15, sheen 0.25, pool 0.2, no scales: 12 failures on 20 views (lifts, ceilings, flattening, the container's
    30 m edge at 7.1);
  - sheen 0.15: the rim bag wall's lift at 30 m (+5.1 in the full-run order; +2.8 measured alone, see the LOD note
    above);
  - sheen 0.10 at fill 0.15: the pipe's 60 m edge (14.8).

**Cost.** The metric is a local run, not a CI gate: about 35 min on SwiftShader for the 29 views on an idle machine.

### 4. Draws (P-GLB4)

- **Per view, off vs on:** identical in every one of the 29 views. Summed: 2106 → 2106 (×1.000).
- **Why:** the cover read is uniforms and nodes in the same material, plus one vertex float on the FloodMast batch.
  There is no new mesh, placement or collider. The floods are constants in the material: a per-world list, at most 8.
- **Tests:** render-budget and lot-atmosphere are green.

### 5. The night and the look lock

- **The night stays a night.** The bodies land at L\* 26–40, or within 5 of their read-off value inside a flood pool.
  The sky does not move.
- **No ink or outline:** the item 13 guards still pass.
- **Nothing blooms:** see the peak emission above.

### 6. Shots

- **`cover-web-{corgi-base,cat-base,west-lane,east-lane}.jpg`:** 1000 px rows from the play camera at 30 m, no HUD.
  Each row is BEFORE (read off) | AFTER (the web's values).
- **`cover-web-montage.jpg`:** every cover view at 30 m, read off | read on, one row each.

I looked at each row:
- **The container** goes from a dark navy box to a pale grey one at L\* 37–39, with its frames and door readable.
  It is the brightest of the dark views, just under 40.
- **The pipes** go from navy to light grey concrete, and their spotted texture stays (the per-piece gain, not a
  per-texel band).
- **The bag walls on the lanes** come up to the sacks' pale value.
- **The flood-lit footings and rim bag walls** look as they were: the fill is pooled away and the sheen is low.
- **The ballasts** lift to a mid value. The mast poles stay dark lines.
- **The night stays dark:** sky and ground do not move.

**Limits:**
- **Chroma.** The fill carries the albedo's own colour, and here the albedo is grey concrete, grey paint or pale sacks.
  So the moonlight's blue drops where the fill dominates: the pipe's C\* goes 13–14 → 4–5, the lane bag walls' 7–9 →
  about 2. The ballast gains chroma (its own paint); the container's moves either way (4–9). Godot's Forward+ restores some with sat and `COVER_SCALE`. The
  web's sat is 1.0, because saturation moves no bar and a higher sat was not asked for.
- **The container interiors** take the fill too (the whole piece is cover), so an open container reads light inside.
  Godot does the same.
- **Software renderer only** (SwiftShader / WebGL2).
- **Quality tier.** The gate is measured at q=high, the lab's and Settings' default. q=med passes at its own profile,
  close to high but not identical (edges within 0.9 L\*, bodies within 0.3).
- **q=low (W17 item 11b; PARITY P2a):** the tier gate on the floods plus the low row.
  - 28 of 29 views pass at the real low profile. Footing[1] at 10 / 30 m goes from edge 12.2 / 10.9 (read off) to
    16.8 / 31.7.
  - **Known low-tier limit:** Footing[1] at 60 m reads 14.1 (8.2 with the read off), against 15. The footing cannot
    hold both its 60 m edge and its 10 / 30 m ceiling with one fill scale, and no third knob was added (lead ruling).
  - The low tier is web-only and not the gated config.
- **Reproduce:**
  ```
  npx vite --port 5190
  node labs/cover-metric.mjs out http://localhost:5190/
  ```
  - `CONFIGS=fill:sheen[:sat:pool[:container:mast[:footing:bagwall[:pipe]]]],...` sweeps the gains and the tier row's
    scales (the bar is checked on the first, or on `GATE=`). A piece with no scale in the tier's row has no uniform to
    sweep.
  - `Q=low|med|high` picks the tier (default high), as `main.ts` does: the lab hands it to the render context (shadows,
    bloom, style detail) and to the world view, whose lamps and kit both take it.
  - **The pixel ratio is pinned at 1 at every tier** (a measurement convention). The lab computes each part's rect in
    the canvas's drawing-buffer pixels, and the metric reads it from a 1280 × 720 screenshot in CSS pixels. Those agree
    only at ratio 1: at low's own 0.85 the rect lands on the wrong pixels, and the 30 and 60 m views read 0 px. Ratio 1
    is also the grid Godot's metric reads (1280 × 720 native).
  - `VIEWS=i:d,...` runs a subset. A subset can differ from the full run in the second decimal (run order): Pipe[0] at
    60 m reads edge 8.30 / 15.09 alone against 8.24 / 15.08 in the full run. Compare full runs.
  - The exit code is the verdict: 0 on `COVER PASS`, 1 on `COVER FAIL`.
