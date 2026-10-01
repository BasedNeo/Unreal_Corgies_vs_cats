# R-PETS (W13): the placeholder pets, shaped and coloured to read at 30 m at night

**Card.** In the Godot game's play camera at 30 m, at night, a stranger should be able to tell a corgi from a cat and
Corgi Company from Cat Cadre by coat colour, ears, tail and the team band. The pets stay PLACEHOLDER (the HUD label and
the placeholder naming are kept). Closed mouths, no tongue, no clay look, no ink outlines. This lane made the change;
an independent verifier judges whether it reads. This file only says what changed and what was measured.

**Base.** HEAD `71d05d5`. Nothing staged or committed. Godot 4.7.2, Compatibility (`gl_compatibility` / `opengl3`) on
Mesa llvmpipe under xvfb. Every number below comes from a command I ran. Private copies in
`…/scratchpad/r-pets/` (`head` = plain HEAD, `work` = HEAD + my files, `lhead` / `lwork` = the same plus G-MOVE's
working-tree `game/match.gd` and `game/pet.gd` for `--lineup`).

## 1. Files (all mine)

| Path | What |
|---|---|
| `engines/godot/game/pet_model.gd` | Rewritten silhouettes (below). Every part of a pet is merged into one `ArrayMesh` with one surface per material (coat, accent, dark, plate, band), built once per (species, team) and shared by every pet of that kind. `layout(species, team)` exposes the mesh, the named parts' model-space AABBs, the tail's centre line and the band pattern, for the tests. Same public API: `build(species, team, look)` and `rifle(species, team, look)` (the rifle is one mesh too: metal + band, with its `Muzzle` marker). |
| `engines/godot/look/pet_materials.gd` | New kinds `accent`, `dark`, `band` (through the existing `Look.pet_material`, no `look.gd` change). Cooler, lighter cat coat. Team band colours with a luminance difference. The emission operator fix (below). Team-only kinds (`band`, `plate`) and the species-free kinds (`dark`, `metal`) share one cached material across species. |
| `engines/godot/tests/test_read_pets.gd` | New: silhouette proportions, coat hue, band hue + luminance + pattern, glow threshold, draws per pet, no mouth/tongue, no outline, placeholder tag. |
| `docs/qa/w13/pets-*.jpg` | The shots (section 4). |
| `docs/handoff/R-PETS.md` | This file. |

## 2. What changed

**Silhouettes** (model space, metres, origin at the feet; from `Model.layout()`):

| | Corgi | Cat |
|---|---|---|
| Body length / back height | 1.26 / 0.66 = **1.91** (long and low) | 0.86 / 0.77 = **1.11** |
| Body width | 0.48 | 0.30 (slimmer) |
| Legs | 0.24 (short, white socks) | 0.53 (long) |
| Ears (one, AABB w x h) | 0.24 x 0.52, upright, taller than the 0.36 m head, tips 0.37 m above it, cream inside | 0.14 x 0.21, pointed cones |
| Tail | a stub (0.16 m) | 0.9 m, held up in an S (two bends), top at 1.50 m: the tallest part of the cat |
| Face | fox: a pointed white muzzle cone, white cheeks, dark nose and eyes, no mouth | round head, small flat pale muzzle, no mouth |
| Chest | white bib | pale chest |

At W12 the corgi's ears were 0.32 m prisms and its back carried a full-width plate; the cat's tail was a curl whose
upper half glowed in the team trim. The glowing trims are gone (they were above the glow threshold, below).

**Coats** (`pet_materials.gd`): corgi warm ochre/tan `(0.72, 0.46, 0.26)` (unchanged); cat a cool silver-blue tabby
`(0.64, 0.66, 0.71)` (was `(0.56, 0.54, 0.52)`), tabby stripes a little less dark (0.55 instead of 0.35 of the coat).
Accent: corgi white `(0.95, 0.91, 0.84)`, cat pale grey.

**The emission operator bug (found here, pre-existing since W12).** `BaseMaterial3D.emission_operator` defaults to ADD,
so emission = (colour + emission texture) x energy, not colour x texture:
- the plate's band mask added 1.0 over the band: `(band + 1) x 1.0` is 2.1-2.2 x exposure, above the glow threshold, and
  the rest of the plate emitted the band colour over the ochre. So the plate read as a pale glowing block on both teams
  (the "pink" on the cat's back in the W12 shots). Isolated in a probe: `scratchpad/r-pets/probe/plate_iso.png`.
- the coat fill added the grey fur texture: `0.28 x (coat + fur)`, a grey wash that pulled both coats toward the same
  pale grey.
Now `EMISSION_OP_MULTIPLY` on coat, accent and plate. The coat fill is the coat's own colour x fur at energy 0.7 (corgi)
and 0.9 (cat; the striped grey needs more to be as easy to see as the saturated corgi).

**Team band (with the lead's second-cue note).** Self-lit harness straps around the torso plus a collar, in the band
material; the plate's band uses the same colours. The locked hues are kept (hue checked to 0.01 of `2f6fd6` /
`c9344a`); the values differ:
- Corgi Company: `2f6fd6` lightened 0.3 = `(0.429, 0.605, 0.888)`, energy 1.0, **one solid strap** 0.20 m wide.
- Cat Cadre: `c9344a` darkened 0.15 = `(0.670, 0.173, 0.247)`, energy 1.2, **a split strap**: two 0.08 m straps with a
  0.04 m gap over the same extent.
- Emitted luminance 0.320 vs 0.130 (2.5:1; the locked hues alone are about 1.07:1). The pattern resolves up close; at
  30 m a strap is 1-2 px, so there the cues are hue and luminance.
- Glow: peak emitted channel x exposure 1.25 is 0.95 (Corgi band) and 0.61 (Cat band), under the threshold 1.3. The
  test fails anything at or above 85 % of it, counting an ADD-operator texture as +1.0.

**Draw cost per pet** (one pass; model + rifle; `probe/probe_draws.gd`):

| | HEAD | after |
|---|---|---|
| Corgi | 26 mesh instances = 26 draws, 4232 triangles | 2 mesh instances, **7 draws**, 3356 triangles |
| Cat | 24 draws, 3448 triangles | **7 draws**, 4524 triangles |

Shadow passes scale the same way (one draw per surface per shadowed light).

## 3. Tests

- `--only read_pets`: PASS. `--only look`: PASS (`test_look_contract`, `test_look_scene`).
- Full suite in the private copy (HEAD + my files + the lead's uncommitted `--only` runner): **11/11 PASS**,
  `GODOT TESTS: PASS`, 74 s under load.
- The new test bites: in a mutation copy each of these fails it, with the named message: band colours set back to the
  locked values at equal energy (luminance 0.168 vs 0.154); the plate's emission back to ADD (2.20 > threshold); corgi
  ears 0.15 x 0.25; the cat tail straight (0 bends); the cat coat = the corgi coat; the Cat Cadre band solid; 20 extra
  mesh instances per pet (27 draws > 8). Unmutated: PASS.

## 4. Proof images

All Compatibility, 1280x720, xvfb, llvmpipe, `--frames 240`, `--look-stats` added to both runs of each pair.
`G=…/pglb1/Godot_v4.7.2-stable_linux.x86_64`; run from the private copy's root.

**A. 30 m camera (the card's command).** `xvfb-run -a -s "-screen 0 1280x720x24" $G --path engines/godot
--rendering-method gl_compatibility --rendering-driver opengl3 --audio-driver Dummy -- --bots-only --2v2 --demo
--shot <png> --frames 240 --cam 21,3,21:0,0.6,0 --look-stats`, in `head` (before) and `work` (after).
- `pets-30m-before.jpg`, `pets-30m-after.jpg`, stacked with a 3x crop of the slab: `pets-30m-before-after.jpg`.
- Output: before `draws=243 objects=365 primitives=491220`; after `draws=87 objects=260 primitives=483916`.
- The bots fight in `--demo` and did not fight the same way: in the before frame two pets stand on the slab (two cats);
  in the after frame the kill feed shows Corgi Bot 1 and Cat Bot 1 down and one cat stands. So these two frame totals
  are not like for like; use B for the draw comparison.
- What changed in the frame: before, two cats with pale plates and pink-tipped tails; after, one cat, light grey, the
  tail standing above its head, a red strap.

**B. Play camera, `--lineup 30`** (G-MOVE's option; their working-tree `game/match.gd` and `game/pet.gd` copied into
both `lhead` and `lwork`, md5 `88897e4a…` / `d845d90c…`): `… -- --lineup 30 --shot <png> --frames 240 --look-stats`.
- `pets-lineup30-before.jpg`, `pets-lineup30-after.jpg`, stacked with a 6x crop of the two bots:
  `pets-lineup30-before-after.jpg`.
- Output: before `draws=222 objects=349 primitives=421148`; after `draws=93 objects=220 primitives=418920`. The same
  three pets (you, the Corgi bot, the Cat bot) stand still in both, so this is the like-for-like frame figure:
  **-129 draws** for three pets, all passes.
- What changed in the frame: the Corgi bot (right of centre) is orange-tan with a white chest and muzzle under two
  upright ears (before: greyish with a pale plate); the Cat bot (left) is a light grey column with a red strap and the
  tail standing above its head (before: a pink-tipped tail); the player's corgi in the foreground shows the long body,
  the blue strap and collar, the ochre saddle and the stub tail (before: a glowing pale-blue plate).
- In this option the bots face the camera, so the side-on cues (the corgi's body length, the cat's S tail) are
  foreshortened; and the crosshair and the SLAB marker sit on top of the two bots at 30 m.

**C. Probes (not the game; for the construction).** `scratchpad/r-pets/probe/probe_lineup.gd` and `probe_night.gd`
(scenes of their own: the four pets, corgi/cat x both teams, no world):
- `pets-probe-closeup-before-after.jpg`: plain key light, close.
- `pets-probe-30m-void-before-after.jpg`: dark void, a dim sodium key, AgX, the play camera's 72 deg FOV at 30 m,
  1280x720, 4x crop.
In both, the top row is HEAD and the bottom row is this change.

## 5. Not done / for the next lane

- I did not grade any image as readable; that is the verifier's call.
- A side-on lineup (bots turned 90 deg to the line of sight) would show the silhouette cues the head-on lineup hides.
  That would need a `--lineup` variant in `game/match.gd` (G-MOVE's file).
- The hitbox is still pet.gd's capsule (1.2 / 1.26 m); the cat's tail now rises to 1.5 m, so a shot at the tail tip
  misses. Cosmetic, but a verifier may notice it.
- Every figure is from software rendering (llvmpipe), on 4 cores shared with other lanes.
