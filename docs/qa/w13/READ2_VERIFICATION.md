# W13 READ2: team cue at 30 m at night after R-PETS2 (independent verifier Q-READ2)

**Verdict: CONDITIONAL.** The sides now separate by the team part alone: red vs white in colour, dark vs light
without hue. But Corgi Company shows no blue at range, and without hue the cue is one small patch. Species reads.

## Setup
- BEFORE: `a64ce51`.
- AFTER: `a64ce51` plus the working-tree `pet_model.gd` (`86e4951d`) and `pet_materials.gd` (`c2f8862a`). This
  equals `000ecbc` (committed during this check) for Godot.
- Godot 4.7.2, xvfb, llvmpipe.

```
… --rendering-method gl_compatibility --rendering-driver opengl3 --audio-driver Dummy -- --lineup 30 [--lineup-side] --shot <png> --frames 240
… -- --bots-only --2v2 --demo --shot <png> --frames 240 --cam 21,3,21:0,0.6,0      (+ facing on Forward+)
```

Checked in order: 1:1 frames, 3x crops, then CIE L\* and Machado deuteranopia and protanopia.

## AFTER [BEFORE]
| Shot | Cat Cadre cue | Corgi Company cue | Species |
|---|---|---|---|
| Facing, Compat | chest panel 5x4 px, 21 red px [5], L\* 47 | panel 7x6 px, L\* 86, **C\* 6**: white [bib L\* 85] | yes; blue cat shade gone |
| Facing, Forward+ | 20 red px [6], L\* 29 | L\* 74, C\* 8 | yes |
| Side, Compat | split straps resolve (2 px red, 2 px gap, 2 px red); 23 red px [12] | solid strap 5x7 px, C\* 8; blue px 30 → **14** | yes |
| Bots camera | 50 red px [28], L\* 45 on a coat at L\* 55 | panel 7x7 px, L\* 74, C\* 7 | yes |

The crosshair still covers the facing corgi's head (`LINEUP_AIM_LIFT`, outside this patch).

## Without hue: `read2-gray-cvd.jpg`
- With the coat masked, the panels are L\* 47-51 vs 86-87 (about 4:1). They separate in L\*, deuteranopia and
  protanopia.
- On the pet, each panel is only about 2:1 against its own coat, and head on both panels have the same shape.

## Why not PASS
1. **Corgi Company's cue is not blue.** Authored at C\* 23, it renders at C\* 3-8: white, about ΔE 7 from the old
   bib. The HUD teaches blue (`#8DB0E9`). The corgi side reads only as "no red".
2. **Without hue at 1:1, the code is one 5x4 px dark patch on the cat.** The corgi's light chest is unchanged. It
   reads in the crops but is marginal at native size.

## To PASS
- Make the rendered corgi cue a nameable blue: C\* ≥ 20 and ≥ 15 L\* above the coat. Measure the rendered pixels.
- Give the head-on panels a pattern difference (solid vs split).
- Lower `LINEUP_AIM_LIFT`.

## Images
- Native frames: `read2-{face,face-fplus,side,bots}-before-after.jpg`
- 3x crops: `read2-crops-3x.jpg`
- L\*, CVD and masked team part: `read2-gray-cvd.jpg`
