# W14 READ3: team cue at 30 m at night (Q-READ3)

**Verdict: PASS.** At native size on both renderers, each side reads by hue and by lightness, also in greyscale and colour-blind views. Species reads. The claimed Cat Cadre split pattern does not resolve.

## Setup
- BEFORE: `3b9b956`. AFTER: `3b9b956` plus only the working-tree `pet_model.gd` (`a5a9aed3`) and `pet_materials.gd` (`f2273b7a`).
- Godot 4.7.2, xvfb 1280x720, llvmpipe/lavapipe.

```
… [--rendering-method gl_compatibility --rendering-driver opengl3] --audio-driver Dummy -- --lineup 30 [--lineup-side] --shot <png> --frames 240
… -- --bots-only --2v2 --demo --shot <png> --frames 240 --cam 21,3,21:0,0.6,0
```
Checked 1:1 frames, then 3x crops, then CIE L\*/C\*. Greyscale is L\*. Colour-blind views apply Machado deuteranopia and protanopia matrices (ImageMagick `-color-matrix`, linear RGB).

## AFTER [BEFORE]
Armour px (share of pet), L\*/C\*, ΔL\* vs own coat.

| Shot | Corgi Company | Cat Cadre |
|---|---|---|
| Face, Compat | 47 (48%), 77/23, +41 [white, C\* 6] | 39 (39%), 35/49, −26 [21 px] |
| Face, Forward+ | 47 (50%), 58/33, +27 [C\* 8] | 32 (34%), 24/33, −23 [20 px] |
| Side, Compat | 87 (44%), 76/23, +25 | 47 (35%), 34/48, −33 [23 px] |
| Side, Forward+ | 87 (45%), 57/33, +17 | 42 (27%), 24/33, −26 [18 px] |
| Bots, Compat | 52 (46%), 64/30, +35 | 24 (28%), 26/39, −28 |
| Bots, Forward+ | 62 (38%), 53/34, +19 | 71 (22%), 24/35, −27 |

## Findings
- **(a) Holds.** Corgi Company is a nameable blue, (149,194,230) on Compatibility and (80,144,196) on Forward+. Cat Cadre is red: crimson on Compatibility, dark maroon on Forward+.
- **(b) Holds, by area and lightness.** Armour is 22-50% of each pet. Corgi Company armour is L\* 53-77 and Cat Cadre armour L\* 24-35; each sits at least 17 L\* off its own coat, in opposite directions. In the deuteranopia and protanopia views the blue stays blue and the crimson turns dark olive-grey, ΔE 24-65 against the coat.
- **The pattern does not read.** Head-on, the ochre strip shows only as a C\* dip (49 to 41) with no ochre pixel. Side on, the vest's only break is the rifle (also in BEFORE). Unlit at night, the ochre is as dark as the crimson.
- **(c) Holds in every shot.** Corgi: tan head, big ears, low body. Cat: grey coat, pointed ears, long legs, S-shaped tail.
- Outside this patch: the crosshair tick still crosses the facing corgi's head. A Corgi-held slab's outline is the armour blue, so a corgi on the edge merges with it.

## Fix (does not block)
Make the Cat Cadre split light and ≥ 0.25 m wide, or drop the pattern claim (`pet_model.gd`).

## Images
`read3-{face,side,bots}-{compat,fplus}-before-after.jpg` (1:1 frames), `read3-crops-3x.jpg`, `read3-gray-cvd.jpg`
