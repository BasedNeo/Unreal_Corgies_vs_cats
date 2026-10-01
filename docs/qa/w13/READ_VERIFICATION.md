# W13 READ: pets at 30 m at night (independent verifier Q-READ)

**Verdict: CONDITIONAL.** (a) Species: yes, by coat colour, and side on by silhouette. (b) Team: only through species
(`match.gd` sets species = team). The band is not a native-size cue and fails without hue.

## Setup
HEAD `71d05d5`. AFTER = `git archive HEAD` + the working tree's `engines/godot/**` and `assets/masters/**`
(`pet_model.gd` md5 `68d9edea`, `pet_materials.gd` `7ed50ada`). BEFORE = the same, with those two files from HEAD.
Godot 4.7.2, xvfb, llvmpipe.
```
… --rendering-method gl_compatibility --rendering-driver opengl3 --audio-driver Dummy -- --lineup 30 [--lineup-side] --shot <png> --frames 240
… -- --bots-only --2v2 --demo --shot <png> --frames 240 --cam 21,3,21:0,0.6,0
```
Facing also on Forward+. At about 15 px/m a head-on pet is 6-8 x 20-23 px; the strap is 3 px; the split pattern
never resolves.

## Lineup, facing (Compatibility and Forward+ alike): `read-lineup-face-*.jpg`
| Cue | Before | After |
|---|---|---|
| Coat | dark-grey cat, grey-tan corgi | cool-grey cat; corgi with a white bib and tan head. Just separable at native size |
| Ears, tail | – | 1-3 px; only in the crop |
| Band | pink plate | cat: 8-10 red px; corgi: **about 5 blue px** |
| HUD | the crosshair's lower arm covers the Corgi bot's head (`LINEUP_AIM_LIFT`) | same |

## Lineup, side on: `read-lineup-side-compat.jpg`
| Cue | Before | After |
|---|---|---|
| Silhouette | partly readable | S tail vs a long, low body with an upright ear. Readable at native size |
| Coat | dark grey vs grey-tan | grey vs tan, clear |
| Band | pale plate | corgi strap pale blue (L\* 77, about 35 px); cat strap pink (L\* 55, about 16 px). Small |

## Bots camera: `read-bots-cam-compat.jpg`
| Cue | After (the frames are not like for like) |
|---|---|
| Coat | a grey cat and a tan corgi with a white chest. Species reads |
| Band | 1-2 px. The team colour that reads is the slab outline; pets carry no marker |

Crops: `read-crops-3x.jpg`.

## Without hue: `read-gray-cvd.jpg`
- **Greyscale** (`-colorspace Gray` and L\*): the red strap merges into the grey coat; the corgi's strap is a faint
  patch. **The band does not separate the teams.**
- **Deuteranopia and protanopia:** the coats become khaki vs blue-grey, so species survives. The red strap is lost;
  the blue strap stays.
- **The cat coat reads blue in shade:** 17-23 px per cat at hue 190-250°. More than its red pixels head-on.

## To PASS
1. Put the team colour on a part seen head-on, at least 0.3 m across: a chest panel or a bandana.
2. Make each band contrast with its own coat in lightness: a dark crimson band on the cat, a near-white blue band on
   the corgi. Use pattern features of 0.15 m or more.
3. Take the blue cast out of the cat coat's shadows.
4. Lower `LINEUP_AIM_LIFT` so the crosshair clears the bots.
