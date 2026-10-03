# W15 p-art: character reference sheets (Grok Imagine)

**Status: reference only, not shipped.** The in-game pets stay the PLACEHOLDER models (`engines/godot/game/pet_model.gd`).
These sheets are inputs for the future character-mesh step. Contact sheet: `docs/qa/w15/art-contact-sheet.jpg`.

| Character | Path | Meaning |
|---|---|---|
| **Cat Cadre cat** | **PATH A** | Master, front, side and back meet the proportion checks against the placeholder. Every kept image has the cool blue-grey coat |
| **Corgi Company corgi** | **PATH B** (fallback) | The images are **design and material reference only, NOT image-to-3D inputs**. Proportions come from `condition/*_fit.png` and `condition/rig.json`. Only the side view (`corgi_side_right.jpg`) meets the PATH A thresholds |

Round 1 (2026-10-01) failed an independent check on three majors, and this document is the patched version
(2026-10-03):
- the corgi's proportions missed the spec;
- the cat's coat was warm taupe, not cool grey;
- the spend cap's memory was an untracked file.

## What was made
- **16 kept images** in `assets/incoming/w15-char-refs/corgi/` and `cat/` (JPEG quality 88, longest side ≤ 1536 px).
  - Per character: a front three-quarter **master**, **front**, **side** (right: the rifle side) and **back**.
  - Three details: **head**, **vest + chest shield**, **rifle on its harness mount**.
  - One **wet-night in-situ** frame.
- **Provenance:**
  - `raw/`: the 16 raw downloads, byte for byte, 5.96 MB;
  - `provenance/*.c2pa.json`: their embedded C2PA manifests;
  - `ledger.jsonl` and `LEDGER.md`: every call, and the sha256 of all 90 raw outputs and all 9 guides.
- **27 condition renders** of the placeholders (`condition/`, free, Godot) and `condition/rig.json`.
- **Tools:**
  - `engines/godot/tools/ref_rig.gd`: the condition rig;
  - `tools/art/grok-sheets.mjs`: the ledgered API caller, with mock-API tests in `tools/art/grok-sheets.test.mjs`;
  - `tools/art/w15-prompts.mjs`: prompts and jobs;
  - `tools/art/w15-guide.py` and `w15-guides.json`: proportion guides;
  - `tools/art/w15-measure.py` and `w15-measure.json`: the measurements below;
  - `tools/art/w15-export.py`: delivery and the contact sheet;
  - `tools/art/w15-provenance.py`: C2PA export and raw copies.

## Round 1 method (2026-10-01, c001–c025, $3.322)
1. **Condition renders.** `ref_rig.gd` builds each pet through `game/pet.gd`, as the match does: the merged model, and
   the rifle at pet.gd's mount. It renders them orthographically on plain mid-grey under camera-relative studio lights.
2. **API facts.**
   - Image models: `grok-imagine-image` ($0.02) and `grok-imagine-image-2.0` (low or medium quality × 1k / 1.5k / 2k,
     $0.04–0.08). Prices come from `GET /v1/image-generation-models`.
   - Every response carries `usage.cost_in_usd_ticks`, which is the ledger's cost.
   - An edit also bills each input image: $0.01 on 2.0.
3. **Master.** Image to image from the condition render on 2.0 kept the pose and where the shield and rifle sit. The
   text-only results drifted, and the 1.0 model copied the placeholder's blocks.
4. **Views.** One view per call from [master, fit render], at medium quality and 1.5k; I chose this over one turnaround
   sheet, which left about 400 px per view.
5. **Details and in-situ**, from the master and the chosen views.

## Patch (2026-10-03, c026–c045, $3.090)
**Cap fix first, before any new spend** (`tools/art/grok-sheets.mjs`):
- The spend is max(`PRIOR_SPEND_FLOOR_USD`, ledger sum). The floor is the committed spend: $6.412 after c045, raised in
  the same commit as any ledger growth. (The first patch set it at $3.322; the closing fix raised it.)
- **Real API runs are closed** (`REAL_RUNS_OPEN = false`), the lead's closing change. Two more checks showed that no
  local ledger can be the only memory of real spend: `--new-budget` could hide up to $6.41 of new spend inside the
  floor, and restoring the ledger from git (or running a second copy of it) hides every call made since the last
  commit. So `run` refuses, before any request, any API that is not http://127.0.0.1 or http://localhost (the tests'
  mock), unless --dry is given (--dry, like `prices`, only GETs the free model list). Requests never follow a redirect,
  so a local URL cannot hand a request to another host. Reopening is a code change made with the owner; while open, a
  real call also needs the ledger tracked by git, unmodified and summing to the floor, so each call's row is committed
  with the raised floor before the next. That check cannot see a call whose row was discarded (git restore or stash, a
  second clone): before any reopening, set a provider-side spend limit on the xAI key or team for the remaining
  $5.588. There is no override flag.
- A lost or emptied ledger, or one cut below the floor, is refused: `run` exits 2, before any request, when the ledger
  is missing, has 0 rows, or sums below the floor. (A ledger cut back to exactly the floor is accepted; that is the
  case the closed real runs cover.)
- One exclusive lockfile (`<ledger>.lock`, `wx` / `O_EXCL`) is held by every command that writes the ledger: `run`,
  `review` and `tools/art/w15-export.py`.
- The ledger is written to a `.tmp` file and renamed over the old one; `w15-export.py` does the same with `os.replace`.
- Each new row records `prompt_sha256`.
- A job must name its resolution.
- Thirteen mock-API tests (`node --test tools/art/grok-sheets.test.mjs`) cover these. They include an empty ledger, a
  below-floor ledger, the export under a held lock, and a guard that the committed ledger never sums above the floor.
  Mutating each feature fails its test (9 of 9 mutations caught).

**PATH A edits** (`grok-imagine-image-2.0`, `/v1/images/edits`, medium, 1.5k, n = 2):
- **Guides first (free).** `w15-guide.py` warps the kept image toward the target: it repeats a torso band, scales the
  ears or tail about their roots, raises the head, and recolours the coat to `#7d8591` / `#d9dde3`. Guides are never
  delivered; their sha256 is in the ledger and LEDGER.md.
- **Try 1:** inputs [kept image, guide], with the prompt "keep everything, take the proportions of the guide".
  - It worked for the corgi side's body and ears and for the cat's coat.
  - The corgi's front, back and head ears barely moved, and neither did the cat's tail or ears.
- **Try 2:** the guide alone, with the prompt "re-render cleanly at exactly these proportions". This reproduces the
  guide's proportions closely (the cat side came out at its guide's 1.88 / 1.50).
- **Corgi.** Two tries each on the front, back and head reached E/H of only 1.04, 1.29 and 0.93 (≥ 1.35 needed),
  because the model draws big cheeks and jaws that raise the head height. By the lead's rule I stopped editing the
  corgi after its second failed try and took **PATH B**. Its kept images are still the closest to spec of all the tries.
- **Cat.** Try 2 passed on all four main views: **PATH A**. Coat-only edits fixed the four detail and in-situ images.

## Measurements
Method: `tools/art/w15-measure.py`, with landmarks in `tools/art/w15-measure.json`, read off 10–50 px grids by eye.
Landmarks are good to about ±10 px, so ratios are good to about ±0.05. The placeholder renders are measured the same
way, as the targets.

**Definitions:**
- **VB**, the visible back: ground to the top of the vest over the torso.
- **body**: the rump to the chest shield's rear edge.
- **tip**: ground to the ear tip (corgi) or the tail tip (cat), over VB.
- **E/H**: ear tip to the midpoint of the ear's base, over crown to chin. In the back view, H runs from the crown to
  the collar.
- **tail/ear**: the tail tip's height over the ear tip's height. Orthographic front and back views keep heights;
  rig.json gives 1.504 / 1.196 = 1.26.
- **coat**: the median coat pixel's B − R and hue.

### Corgi: thresholds body/VB ≥ 1.85, ear tip/VB ≥ 1.9, E/H ≥ 1.35; team-paint share 0.35–0.38
| View | Placeholder | Round 1 | Try 1 | Try 2 | Kept | Verdict |
|---|---|---|---|---|---|---|
| side | body 1.96, tip 1.94, E/H 1.65, paint 0.407 | c013_0: 1.40, 1.68, 0.90, 0.278 | **c026_1: 1.92, 1.96, 1.42, 0.376** (c026_0: 1.80, 1.86) | – | c026_1 | **PASS** |
| master (3/4) | – | c008_1: E/H 0.86, paint 0.272 | c027_0: E/H 1.11, paint 0.295 | (stopped) | c027_0 | fail (PATH B) |
| front | E/H 1.49 | c012_0: 0.69 | c028_0: 0.75 | c031_0: 1.04 (c031_1: 0.85) | c031_0 | fail |
| back | E/H 1.69 | c014_0: 1.18 | c029_0: 1.02 | c032_0: 1.29 | c032_0 | fail |
| head (3/4) | – | c018_1: 0.79 | c030_0: 0.81 | c033_1: 0.93 (c033_0: 0.88) | c033_1 | fail |

### Cat: tail tip ≈ 1.88 × VB, ear tip ≈ 1.50 × VB; coat B > R with a blue hue (#7d8591 is 215°)
| View | Placeholder | Round 1 | Try 1 | Try 2 / coat edit | Kept | Verdict |
|---|---|---|---|---|---|---|
| side | tail 1.86, ear 1.46 | c016_0: 1.60, 1.30, B−R −22 (hue 22°) | c034_0: 1.62, 1.30, +17 | **c038_1: 1.88, 1.50, +15 (220°)** | c038_1 | **PASS** |
| master (3/4, VB at the rear vest) | tail 1.79, ear 1.29 | c009_0: 1.62, 1.24, −22 | c035_1: 1.70, 1.24, +13 | **c039_0: 1.80, 1.31, +9 (227°)** | c039_0 | **PASS** |
| front | tail/ear 1.26 | c015_1: 1.24, −32 | c036_1: 1.34 | **c040_1: 1.23, +13 (240°)** | c040_1 | **PASS** |
| back | tail/ear 1.26 | c017_0: 1.25, −20 | c037: 1.24 | **c041_0: 1.25, +9 (227°)** | c041_0 | **PASS** |
| head | – | c021_1: −2 (30°) | – | c042_1: +10 (210°) | c042_1 | coat PASS |
| armour | – | c022_0: −22 (22°) | – | c043_1: +11 (229°) | c043_1 | coat PASS |
| rifle | – | c023_0: −19 (22°) | – | c044_1: +7 (231°) | c044_1 | coat PASS |
| in-situ (night; measured in a box on the head) | – | c025_0: −20 (18°) | – | c045_0: +27 (224°) | c045_0 | coat PASS |

The four detail images are coat-only edits: their proportions are the round-1 ones.

## Costs
| | Calls | Images | USD |
|---|---:|---:|---:|
| Round 1 (c001–c025) | 25 | 50 | 3.322 |
| Patch, corgi (c026–c033) | 8 | 16 | 1.250 |
| Patch, cat (c034–c045) | 12 | 24 | 1.840 |
| **Total** (`grok-imagine-image` 2 calls $0.062; `grok-imagine-image-2.0` 43 calls $6.350) | **45** | **90 (16 kept, 74 rejected)** | **6.412** |

- The owner's cap is $12; the stop line is $11.00; the expected patch spend was about $2.5–3.5.
- Every call was pre-checked and reserved on disk before it left. Every cost is the response's own `usage`.

## What is consistent, and what is not
**Consistent across every kept image of a character:**
- **The coats**, after the patch:
  - the corgi: warm ochre-tan with a white bib, muzzle and socks;
  - the cat: cool blue-grey tabby with a pale muzzle and chest, in every one of its 8 images. The master is the palest
    (B−R +2..+10, depending on the classifier): take the albedo from #7d8591, not from the sheets.

  This corrects round 1's claim that the coats were consistent: the cat was warm taupe (B − R −19 to −32, hue about
  22°), not cool grey.
- **The side's armour:**
  - Corgi Company: a cobalt vest with ochre trims, a pointed shield on an ochre rim, a blue collar;
  - Cat Cadre: a dark crimson vest with an ochre band, a square crimson shield with a vertical ochre stripe, a crimson
    collar.
- **The rifle** sits on the **right** shoulder with the muzzle forward. Mouths are closed, both pets stand on all
  fours, the fur and paint are realistic, and there is no ink.
- **The leather straps and buckles were PROMPTED, not drift.** "leather straps" is in every style fragment from v1 on
  (`F.style`, `F2.style`), and the patch prompts list them as something to keep. The placeholder has none.

**Not consistent:** see the next two sections. The corgi's proportions are by design not authoritative (PATH B). Each
view is framed on its own, so the views are not same-scale orthographics.

## Not consistent with the placeholder: armour is sized from pet_model.gd, not the sheets
Measured on the raw files (`raw/`; method as above, by eye on 25 px grids, ±10 px). The placeholder values are
`pet_model.gd`'s geometry (`_vest`, `_chest`, `_collar`) and the condition renders.

**Chest shield.** `pet_model.gd`: the shield is 0.50 m wide, and on the corgi an ochre backing adds a 0.025 m rim each
side (0.55 m outer). Seen head-on it is at least the body's width: corgi vest 0.52 m, head 0.42 m; cat vest 0.36 m,
head 0.30 m.

| Image (head-on) | Shield / body width | Shield / head width | Target |
|---|---|---|---|
| corgi, round 1 (c012_0) | 0.69 | 0.88 | ≥ 1.0 / ≥ 1.31 (0.55 m over a 0.42 m head) |
| corgi, kept (c031_0): shield 420 px rim to rim, torso 565, cheeks 457 | **0.74** | **0.92** | ≥ 1.0 / ≥ 1.31 |
| cat, kept (c040_1): shield 394 px, body below it 311, cheeks 284 | **1.27** | **1.39** | about 1.39 / 1.67 |

The corgi's shield is still too small; the cat's is near target. **Build the shield at pet_model.gd's size.**

**Vest.** `pet_model.gd`: corgi 0.80 m long, 63 % of the 1.26 m torso; cat 0.72 m, 84 % of the 0.86 m torso. Both have
0.04 m ochre rims at BOTH ends; Cat Cadre adds ONE 0.15 m ochre band in the middle.

| Image (side) | Vest / torso length | Rims |
|---|---|---|
| corgi, round 1 (c013_0) | about 0.48 | both ends |
| corgi, kept (c026_1): x 430–990 of a rump-to-shield 245–1140 | **0.63** (target 0.63) | both ends, ochre, but wider than 0.04 m |
| cat, kept (c038_1): x 560–925 of 495–1005 | **0.72** (target 0.84) | a wide rear rim, **no front rim**, one middle band |

**Team-paint share of the silhouette** (blue or crimson pixels over all pet pixels; `team_share` in w15-measure.py):

| View | Corgi placeholder | Corgi round 1 | Corgi kept | Cat placeholder | Cat round 1 | Cat kept |
|---|---:|---:|---:|---:|---:|---:|
| side | 0.407 | 0.278 | **0.376** (classifier-sensitive: 0.33–0.39 under RGB thresholds; placeholder 0.40) | 0.357 | 0.217 | 0.235 |
| front | 0.369 | 0.219 | 0.199 | 0.417 | 0.265 | **0.317** |
| back | 0.058 | 0.147 | 0.138 | 0.354 | 0.078 | 0.090 |
| 3/4 master | 0.393 | 0.272 | 0.295 | 0.388 | 0.286 | **0.323** |

- Round 1's main views were 0.08–0.29 against the placeholder's 0.35–0.42 (its back views aside).
- Only the corgi side now reaches the target band, at 0.376 (classifier-sensitive: 0.33–0.39 under RGB thresholds;
  placeholder 0.40). The cat's views rose but stay under the placeholder.
- The back views are low on both species because the rump and tail cover the vest. The placeholder's corgi back is
  low too (0.058).
- **Take the paint layout and its share from pet_model.gd.**

## Sheet conflicts: resolve to pet_model.gd
Wherever a sheet and `engines/godot/game/pet_model.gd` / `rig.json` disagree, **pet_model.gd wins**. The sheets
supply surface design and materials only. This list merges the independent verifier's items with my re-checks of the
kept images (2026-10-03).

| Topic | pet_model.gd (wins) | What the sheets show (re-checked on the kept images) |
|---|---|---|
| Shield size and place | centred on the chest, at least body width head-on (above); built facing forward (−Z) with an 8 degree tuck, per `_chest` | the side views draw the shield turned about 45 degrees to show its face: build it facing forward (−Z) with the 8 degree tuck instead. The corgi shield is 0.74× body width (c031_0). **Still holds:** in the back views the shield sticks out on the animal's left only, about 60 px on the corgi (c032_0; round 1's c014_0 was about 55 px) and about 59 px on the cat (c041_0), so it reads as offset to one side |
| Shield surface | the corgi's is a flat, solid panel on an ochre backing; the cat's is two crimson blocks and one centred ochre strip | **Partly changed:** round 1 had rivets and a centre crease only in corgi_detail_armour. The kept corgi front (c031_0) and master (c027_0) shields now show the crease and corner rivets too, and the back vest (c032_0) shows rivets and panel seams. Treat them as texture-level wear at most; keep the shield a flat panel. The cat front's ochre stripe is centred (stripe centre x 604 against shield centre 599) and 0.27 of its width (target 0.30): that one agrees |
| Magazine | none (the rifle is a receiver, barrel, grip and band strip) | **Still holds:** a magazine appears only in corgi_detail_armour (c019_1) |
| Vest length and rims | corgi 0.80 m, cat 0.72 m, 0.04 m ochre rims at both ends | the corgi vest now matches in length (0.63 of the torso), with wide rims. **Still holds for the cat:** no front ochre rim (c038_1, c039_0) |
| Cat Cadre pattern | ONE 0.15 m ochre band around the vest, ONE centred strip on the shield | **Still holds:** from behind (c041_0) the vest reads as several concentric ochre stripes, and from the side (c038_1) the wide rear rim reads as a second band. Model one band |
| Team-paint share | as measured on the placeholder (table above) | under-painted on every view but the corgi side |
| **The rifle** | ONE rifle for both species: `pet_model.gd rifle()`, a 0.34 m receiver, a 0.32 m barrel, a grip, **a team-colour band strip on top**, the muzzle at −0.47 m. Mounted at pet.gd's offsets (corgi 0.27, 0.64, −0.30; cat 0.22, 0.76, −0.22) | **Still holds:** two different designs, the corgi's a pistol-grip receiver with a round barrel, the cat's a boxy receiver with a vented side panel. Both read as real-world compact machine pistols, a **trade-dress risk for original IP**, and neither has the team band. **Neither generated rifle design is to be copied into a mesh or texture.** Their receivers also carry the illegible micro-marks listed in LICENSE.md |
| Straps | none | brown leather straps and buckles (prompted): optional detail at most, never covering the team paint |
| Ears, tail, body | rig.json | the corgi's ears and body in every view but the side (PATH B); the cat's details keep round-1 proportions |
| Views among themselves | – | the corgi head close-up (c033_1) has smaller ears than its side (c026_1); the corgi master's torso is longer than its front and back imply; each view is framed separately |

## Reproduce
The exact renders are byte-identical only on the measured setup: Godot 4.7.2 Compatibility on Mesa 25.2.8 llvmpipe
(LLVM 20.1.2). Another GPU, driver or Godot version will rasterise differently. The rig never overwrites the committed
`condition/` set unless `--out` names it.
```bash
G=<path to Godot 4.7.2 binary>                     # e.g. Godot_v4.7.2-stable_linux.x86_64
# 1. condition renders (free) into an absolute temp dir, then compare with the committed set
OUT=$(mktemp -d)/ref-rig
xvfb-run -a -s "-screen 0 1280x720x24" $G --path engines/godot --rendering-method gl_compatibility \
  --rendering-driver opengl3 --audio-driver Dummy --script res://tools/ref_rig.gd -- --out "$OUT"
for f in assets/incoming/w15-char-refs/condition/*; do cmp "$f" "$OUT/$(basename "$f")"; done
# 2. the cap's tests (a mock API; no cost), prices (free), then one job at a time (pre-checked, ledgered)
node --test tools/art/grok-sheets.test.mjs
export W15_ART_SCRATCH=/some/scratch/dir           # raw downloads land in $W15_ART_SCRATCH/raw
node tools/art/grok-sheets.mjs prices
python3 tools/art/w15-guide.py cat_side             # a free guide in $W15_ART_SCRATCH/guides
node tools/art/grok-sheets.mjs run cat_patch2_side --dry   # the estimate and the prompt, no call
node tools/art/grok-sheets.mjs run cat_patch2_side          # while REAL_RUNS_OPEN = false this exits 2 (shown for the record)
node tools/art/grok-sheets.mjs review c038_1_cat_patch2_side.jpg keep "<why>" --as cat/cat_side_right.jpg
# 3. measure, deliver, provenance, summaries
python3 tools/art/w15-measure.py
python3 tools/art/w15-export.py
<venv with c2pa-python 0.38>/bin/python tools/art/w15-provenance.py
node tools/art/grok-sheets.mjs summary && node tools/art/grok-sheets.mjs prompts
```
- Generation is not deterministic: a rerun costs money and returns new images. The sha256 values identify the kept
  ones, and `raw/` holds them.
- Jobs that take `raw:` or `guide:` inputs need those files in the scratch dir. The kept raws are in `raw/`; the guides
  are rebuilt free by `w15-guide.py`, and their sha256 is in LEDGER.md.

## Next step: meshes (blocked), per character
No mesh was made. The Stage 1 image-to-3D path is still **blocked**: `api.cloud.scenario.com` is denied and no Scenario
key is set. The two characters take different routes:
- **Cat (PATH A).** Image-to-3D may take `cat_master_threequarter`, `cat_front`, `cat_side_right` and `cat_back`.
  Then check the result against `rig.json`: back 0.77 m, vest top 0.80 m, tail tip 1.50 m, ear tip 1.20 m, capsule
  r 0.33 h 1.26. Resolve the conflicts above to pet_model.gd: one ochre band, one centred shield stripe, the canonical
  rifle with its team band.
- **Corgi (PATH B).** Do **not** feed these images to image-to-3D. Build the corgi from `condition/*_fit.png` and
  `rig.json`: a body 1.26 m long, the back at 0.66 m, the vest top at 0.68 m, the ear tips at 1.33 m, capsule r 0.36
  h 1.20. A Blender script (the proven path for the kit pieces), or image-to-3D on the condition renders, would do.
  Then texture and detail it from the sheets: fur, the cobalt paint and its wear, the shield, the collar, the in-situ
  wet look. `corgi_side_right` is the one corgi image whose proportions also match.
- **Both:** size the armour from pet_model.gd (the shield, the vest, the paint share), and build the rifle as
  pet_model.gd `rifle()` with its team band; neither generated rifle design is copied. Keep the team paint layout and
  the solid / split pattern of pet_model.gd. Its rules are a team-paint area
  seen head-on and side on, pattern features of at least 0.15 m, and each team's lightness offset from its own coat.
  Then Blender clean-up → `validate-glb.mjs` → the Godot import, behind a flag until the owner rates it against the
  placeholder at 30 m. Rigging and animation remain a human step.
