# W17 AAA 30 m team read (QA-30M): the baseline

Lane QA-30M, the fresh checker of the W17 AAA look pass (card W17-AAA-QA in `docs/design/AAA_PLAN.md`; the 30 m check
in `docs/design/NORTH_STAR.md`). This run is the **baseline before pass 1 (SKY)**. It fixes the method, the views and
the numbers that every later pass is held to. QA-30M made nothing it checks.

**Baseline at `f7f45b5`, under the lead's rulings of 2026-10-17 (the silhouette bar is the edge contrast ≥ 15 L\*):
Godot Compatibility PASS · Godot Forward+ FAIL · twin WebGL FAIL · twin WebGPU high FAIL.** Per the card, a FAIL now is
a finding and does not block pass 1. What a later pass may not do is regress: see "The regression rule" below. From
pass 1 on, `--baseline` turns the check into that rule.

**The baseline's twin frames show the W7 K2 kits, from before TW-PETS.** TW-PETS (2026-10-18, uncommitted at the time
of writing) makes the twin's slab match draw Godot's PLACEHOLDER pets (`src/client/views/slab-pet.ts`). The lab
follows it: it asks `EntityViews` for the slab match's mode, and its matte reads the slab pet's surface groups. Any run
on a tree that holds TW-PETS therefore measures the slab pets. Its twin numbers are held, by the regression rule,
against this K2 baseline, which is the floor and not a like-for-like pair. The tool records which builder drew the
bots (`petBuilder: slab | k2` in each twin view's JSON, `pets: …` in its log line). See "After TW-PETS" below.

- **Godot Compatibility passes with room to spare.** Teams ΔE 66–75 in colour, 49–61 in both colour-blind views and
  ΔL\* 33–36 in greyscale. Every edge is 26.6–50.3 \|ΔL\*\| across the four images. An earlier run of the face view
  (90 settle frames, not 60) gave the same matte and the same numbers to the digit.
- **Godot Forward+ fails on one number, which sits at the bar.** It is the head-on Cat's edge: 14.7 in colour,
  14.7 in greyscale, 14.4 in deuteranopia (bar 15; protanopia passes at 15.3). Everything else passes, including
  teams (ΔE 46–58, greyscale 25–30) and the side-on Cat, whose edge is 16.1. Under the old mean-vs-ring check that
  side-on Cat failed at ΔL\* 1.3: its light coat and dark crimson vest sit on either side of the barrier's lightness, so
  the means cancel while the outline still separates. The cause is the background, not the pets. Forward+ lifts the
  ring behind the bots by 15–17 L\* (the floodlit barrier and the volumetric haze in front of it: the Cat's ring goes
  from L\* 18.5 to 33.0 head on), while the pets lose only 1–5 L\*. Reported as it falls, with no fitting.
- **The twin fails on team, through its armour (a real finding, lead ruling).** Head on: ΔE 19.5, greyscale ΔL\* 8.0,
  deuteranopia 12.1, protanopia 11.1. Side on: 17.4 / 9.0 / 8.1 / 11.4. On the horizon, colour, greyscale and
  protanopia pass, but deuteranopia is 15.9. Its silhouettes all pass (edges 20.0–34.2). The twin's slab pets are the
  W7 K2 faction-camo kits: the Corgi's ochre camo renders L\* 50–51 C\* 18–23 and the Cat's oxblood L\* 33–43
  C\* 22–27, close in lightness and both dull. Their team colour is on trim that does not carry at 30 m (armbands,
  patch, lamps); of the team colour, only the shoulder-plate tops fall inside the armour. Godot's pets are the W13/W14
  PLACEHOLDER pets with team-painted barding. The lead is opening a parity card; this lane changes nothing there.
- **Twin WebGL and twin WebGPU high agree.** Teams ΔE and every edge agree within 1.0, and every number within 1.9
  (the Corgi's coat L\* head on). The face frames differ by 0.02/255 on average and the mattes by 3 px. Both run the
  twin's `high` tier, and at this SHA nothing differs by backend. The splat (WebGPU high only) is the first thing that
  will separate them.
- **The horizon view is the margin the BACKDROP pass spends.** Today every pet's edge there is 25.2–50.3 in every
  config and image: lit pets on the plateau lip against a dark sky and hoarding. Brightening that background by 20 L\*
  still leaves every edge at 16.1 or more; at +30 L\*, Forward+'s horizon edges drop below 15 (see the regression
  rule).
- **Species reads** in all Godot views. In the twin it reads by head colour and ear shape only (see below).

## Setup

- **Tree:** `f7f45b5`, the CI-green tip (CI run 162), measured on a private copy made by the tool:
  `git archive f7f45b5` into `scratchpad/qa30m/base/tree`, the shared `node_modules` linked, and a fresh Godot
  `--import`. The shared tree holds other lanes' uncommitted work (tw-look: `kit-glb.ts`, `world-view.ts`,
  `labs/cover.ts`; BL-DCC: `tools/blender`, `assets/sky`), so nothing was measured there. `labs/lineup.*` is new in
  this lane, and the tool copies it into any tree that predates it. The lab still draws with that tree's own
  builders. Date: 2026-10-17.
- **Godot:** 4.7.2-stable (`Godot_v4.7.2-stable_linux.x86_64`) under `xvfb-run` at 1280x720.
  - Compatibility = `--rendering-method gl_compatibility --rendering-driver opengl3`: OpenGL on llvmpipe (Mesa
    25.2.8), look quality MEDIUM (its default).
  - Forward+ = the project default: Vulkan on lavapipe (it reports itself as "llvmpipe"), look quality HIGH, with
    SSR, SSAO and volumetric fog.
- **Twin:** vite from the tree, with a private dep cache. Playwright Chromium 141 (`/opt/pw-browsers/chromium-1194`)
  on SwiftShader at 1280x720. Both configs run the `high` quality tier, which is also the twin's default, so `&webgl`
  alone is high too.
  - WebGL2 = `labs/lineup.html?kit=glb&webgl` (ANGLE).
  - WebGPU = `?kit=glb&q=high`, with `--enable-unsafe-webgpu --enable-features=Vulkan
    --use-webgpu-adapter=swiftshader`. It also needs a **TEST-ONLY shim**: Chromium 141 rejects three r186's string
    `swizzle` in `createView`, so the shim strips it.
  - The lab reported `backend: webgpu` for the WebGPU config. Both twin configs are **read back from an 8-bit render
    target** (`readRenderTargetPixelsAsync`), not taken as page screenshots, which miss a WebGPU canvas. On WebGL the
    rows are flipped. The flip was checked against the frame by eye.
- **Load:** every render batch waited for load5 < 8. Renders ran at nice 10, one renderer at a time. Two other lanes
  (tw-look, BL-DCC) were rendering on the same 4 cores, at load 6–9. The full baseline run took about 30 minutes:
  Godot Compatibility about 1.5 min per view, Forward+ about 3 min, each twin config 3–5 min.

### The views: the same pets, ground and camera in all four configs

| View | Where the bots stand | Camera |
|---|---|---|
| face | Godot's own `--lineup 30` search (`match.gd _place_lineup`), centred on the Corgi pit's flood pool (the target of flood_pit_east, (-22, -2.4, -108)) instead of the slab. Wet asphalt under the sodium flood. Corgi bot at (-21.78, -2.40, -107.13), Cat bot at (-22.22, -2.40, -108.87), both facing the human | the play camera: the human stands 30 m away at (-51.12, -2.40, -100.79), with the boom camera at (-54.06, -1.03, -99.32) aimed 1.5 m over the bots (`LINEUP_AIM_LIFT`), fov 72 |
| side | the same spot, with the bots turned side on the way `--lineup-side` places them: 1.4 m off the centre, facing along the row (Corgi at (-21.66, -2.40, -106.64), Cat at (-22.34, -2.40, -109.36)). `--lineup-side`'s own bearing search picked a spot where a crate hides both bots (checked by eye), so this view keeps the face view's clear bearing | as face |
| horizon | the Cat plateau's front lip (terrain is 4.6 m high from z 95). Corgi at (75.40, 4.60, 95.80), Cat at (72.60, 4.60, 95.80), side on | the play camera on the yard below: the human at (74.00, 0.02, 65.80), 30 m south (bearing 180), camera at (73.28, 0.90, 62.59). The yard is walled by a hoarding about 9.6 m high (z 152 behind the bots), which hides the far horizon from every yard-level view where the pets stand no higher than the camera. Here the bots stand above the hoarding line, against the band the BACKDROP pass fills |

The twin copies Godot's camera (origin, basis, fov 72, near, far) and the pets' feet and yaw from Godot's JSON, so
both engines frame the same scene. The tool also reports how far each run's lineup has moved from this baseline; it
was "unchanged" here, and the Compatibility and Forward+ lineups are identical. The twin's pets are its own: they go
through `EntityViews` in the slab match's mode, the same path `main.ts` uses for every bot.
- At `f7f45b5` (the baseline) that path is `createCharacter`: the Assault kit the slab gives everyone, with the bots'
  seeded look. The seeds are 1 for the Corgi bot, 2 for the Cat bot and 101 for the human, and none is a veteran.
  These are not the slab sim's own seeds.
- With TW-PETS that path is the slab pet: one model per species and team, with no seed, look or rank.

Rain is off in both engines, because streaks are noise in a pixel metric. In Godot the rain particles are hidden; the
twin uses the slab twin's opening night with rain 0, as `labs/cover.ts` does. Godot's HUD is hidden too. READ3 already
reported the crosshair tick crossing a facing pet's head, and that is a HUD check, not this one.

### The matte: how the tool knows which pixel is what

Each view is two frames of the **same state**:

1. the normal frame;
2. a **known-colour matte**: no AA, no post, no fog, black sky, every mesh unlit.

| Matte colour | Corgi bot | Cat bot |
|---|---|---|
| Armour | 255,0,0 | 255,255,0 |
| Coat | 0,255,0 | 0,255,255 |
| The rest of the pet | 0,0,255 | 255,0,255 |

Everything else is black. Opaque occluders are kept; transparent geometry and particles are hidden.

- **Godot:** unshaded `StandardMaterial3D` overrides, MSAA off, a black linear environment.
- **Twin:** `MeshBasicNodeMaterial`s drawn straight into the render target, with no pipeline and no tone mapping.

In every view checked by eye (`aaa30m-crops-4x.jpg`), the matte matched the normal frame pixel for pixel.

- **Armour:**
  - Godot: the `plate` and `band` surfaces (vest, chest shield, collar).
  - Twin slab pets (TW-PETS): the same `plate` and `band` groups (`userData.petSurfaces`).
  - Twin K2 kits (the baseline): the `SURF.armor` vertices (plate carrier, shoulder plates, helmet, armoured boots,
    class kit).
- **Coat:** Godot `coat`; twin slab pets `coat`; twin K2 kits `SURF.fur`.
- **The rest of the pet** counts only in the silhouette:
  - Godot and the twin's slab pets: accent, eyes and nose, the whole rifle (its band strip too).
  - Twin K2 kits: suit, skin, eyes, belt and pouches, the unit patch and armbands, weapon, glows, neckwear.

### The metric (`tools/aaa-30m.mjs`, from the PNG pair only)

- **Colour space:** CIE L\*a\*b\* (D65) from the displayed sRGB. Greyscale = L\*, so the teams' greyscale distance is
  a ΔL\*.
- **Colour-blind views:** Machado, Oliveira & Fernandes (2009) deuteranopia and protanopia matrices at severity 1,
  applied in linear RGB and clamped.
- **Per bot:** armour px and their share of the pet's pixels; mean L\* and C\* of armour and coat; ΔL\* of armour
  minus its own coat.
- **Teams:** ΔE (CIE76) between the two armours' mean L\*a\*b\*.
- **Silhouette (barred):** the **edge contrast**. For every pet pixel next to the background (4-way), the tool
  compares the pixel 2 px further inside with the pixel 2 px past the first background pixel, and takes the mean
  \|ΔL\*\|. This is how `labs/cover-metric.mjs` reads the cover edge. It is computed in all four images: colour,
  greyscale, deuteranopia and protanopia.
- **Reported, not barred:** the pet's mean L\* minus the mean L\* of its **ring** (the matte's background pixels
  within 2 px, Chebyshev, of the silhouette), in all four images.

**The bar** (card W17-AAA-QA; lead rulings of 2026-10-17):

- teams ΔE ≥ 20 in colour, deuteranopia and protanopia, and ΔL\* ≥ 10 in greyscale;
- every pet's edge \|ΔL\*\| ≥ 15 in all four images, the same edge bar the cover read uses. The ruling's reason: the
  check asks whether a pet's outline separates from what is behind it, and a light/dark split pet can average to its
  background and still read;
- species reads (ears, tail, body) in a 1:1 crop, judged by eye from the crops.

**Armour** keeps this lane's definition (lead ruling): the large plates, vest and shield. Armbands, patches and lamps
are trim that does not carry at 30 m (Q-READ2: a pet is about 7 × 20 px there).

A bot with fewer than 30 px, or fewer than 6 armour px, fails as not resolved. A config passes only if every view
passes.

## The re-check: every pass runs this, unchanged

```
cd /home/user/Unreal_Corgies_vs_cats      # any checkout that has tools/aaa-30m.mjs and the SHA
node tools/aaa-30m.mjs run --sha <the pass's SHA> --out <scratchpad>/aaa30m-<pass> \
  --baseline <scratchpad>/qa30m/base --godot <scratchpad>/pglb1/Godot_v4.7.2-stable_linux.x86_64
```

`<scratchpad>/qa30m/base` holds the baseline's saved frames, masks and JSON (`f7f45b5`). The tool re-measures those
frames with its current metric every time, and never trusts stored numbers. If that directory is lost, rebuild it
with `node tools/aaa-30m.mjs run --sha f7f45b5 --out <dir>`:

- Compatibility repeats to the digit.
- Forward+ repeats within 0.11 on every barred number (measured below).
- The twin's two backends agree within 1.9 (a repeat of the same twin config was not run).

The baseline itself was run as `node tools/aaa-30m.mjs run --sha f7f45b5 --out <scratchpad>/qa30m/base --godot …`
and then re-measured with `node tools/aaa-30m.mjs measure --out <scratchpad>/qa30m/base`.

What a run does:

1. archives the SHA into `<out>/tree`, links `node_modules` and runs the Godot import;
2. writes its Godot helper (a SceneTree script, embedded in the tool) into that copy for the run, and removes it after;
3. renders 4 configs x 3 views;
4. measures, prints the tables below and the view-drift line, and writes `results.json`, `results.md` and
   `sheets/aaa30m-*.jpg`.

Exit codes:

- Without `--baseline`: 0 = PASS in every config; 1 = a FAIL; 2 = something could not be measured.
- With `--baseline`, the exit code is the regression verdict: 0 = no regression; 1 = a regression, with each
  regressed number listed beside its baseline value; 2 = a view not measured, or the lineup moved by more than 5 cm.
- Caveats: the regression rule compares barred numbers only. A matte with unknown codes (`FAIL: <n> matte px with an
  unknown code`) fails the config's verdict, but it is not a regression, so a `--baseline` run can exit 0 over a FAIL
  line: read the verdict lines as well. A render that fails leaves an older `<cfg>-<view>.png/.json` in place, so use a
  fresh `--out` for every run (PARITY G34, G35).
  - **Both are fixed in the tool since the fresh confirm (2026-10-18).**
    - G34: the matte's integrity is now a barred item (`matte unknown-code`, must stay 0 px). A config that goes
      PASS → FAIL on unknown codes exits 1. Mutant: 400 px of the saved Compatibility face matte painted white, run
      with `measure --baseline` → exit 1, "matte unknown-code: 0 -> 400 px … passed at the baseline, fails now".
    - G35: `run` deletes each view's old files before rendering it, and exits 2 on any failed render ("RENDER
      FAILED"). Mutant: `run --godot /bin/false` on an `--out` that held the baseline's face frames → exit 2; the
      old frames were deleted and nothing was measured.
    - A fresh `--out` per run is still good practice.

Other modes:

- `node tools/aaa-30m.mjs measure --out <dir>` re-measures saved frames.
- `--mutate` paints the Cat bot's armour pixels with the Corgi bot's mean armour colour, so the bar must fail.
- `--mutate-ring <ΔL*> [--mutate-views horizon]` shifts L\* of the background within 3 px of either bot (the ring
  the edge reads) in those views. Mutants work in memory and never write over the frames.
- `--noise <n>` or `--noise-<config> <n>` overrides the noise floor.
- `--configs` and `--views` narrow a run.
- `--tree <dir>` measures an existing archive copy. It refuses a git checkout.
- A twin-only run with no fresh Godot JSON uses the baseline lineup baked into the tool.

## Results at `f7f45b5`, one table per config

Armour L\*/C\* and coat L\*/C\* are in colour. The edge is the barred silhouette number (failing values in bold). "Pet
vs ring" is the pet's mean L\* minus its ring's, reported only. Re-measured from the saved frames with
`node tools/aaa-30m.mjs measure --out <scratchpad>/qa30m/base`.

### Godot Compatibility: PASS

| View | Pet | Armour px (share) | Armour L*/C* | Coat L*/C* | ΔL* armour−coat | Edge \|ΔL*\| colour / grey / deutan / protan (bar ≥ 15) | Pet vs ring ΔL* colour / grey / deutan / protan (reported) |
|---|---|---|---|---|---|---|---|
| face | Corgi Company | 47 of 118 (40%) | 65/28 | 48/28 | 16.8 | 33.8 / 33.8 / 33.9 / 33.9 | 36.3 / 36.3 / 36.1 / 36.4 |
| face | Cat Cadre | 34 of 88 (39%) | 29/46 | 54/4 | -24.9 | 26.7 / 26.7 / 27.1 / 26.6 | 25.0 / 25.0 / 26.1 / 22.9 |
| side | Corgi Company | 95 of 210 (45%) | 63/27 | 45/30 | 18.6 | 39.1 / 39.1 / 39.5 / 38.5 | 40.2 / 40.2 / 40.1 / 40.3 |
| side | Cat Cadre | 56 of 113 (50%) | 30/40 | 54/4 | -23.2 | 31.1 / 31.1 / 31.8 / 29.8 | 17.5 / 17.5 / 18.7 / 15.2 |
| horizon | Corgi Company | 103 of 199 (52%) | 67/25 | 47/27 | 19.8 | 49.8 / 49.8 / 50.3 / 48.8 | 50.9 / 50.9 / 51.0 / 50.6 |
| horizon | Cat Cadre | 54 of 130 (42%) | 31/41 | 57/4 | -25.5 | 44.7 / 44.7 / 45.5 / 43.4 | 36.4 / 36.4 / 37.8 / 34.0 |

| View | Teams ΔE colour | ΔL* grey | ΔE deutan | ΔE protan | Bar |
|---|---|---|---|---|---|
| face | 74.9 | 36.2 | 61.0 | 55.9 | PASS |
| side | 66.0 | 32.7 | 54.6 | 50.2 | PASS |
| horizon | 66.1 | 36.3 | 50.6 | 48.7 | PASS |

### Godot Forward+: FAIL

| View | Pet | Armour px (share) | Armour L*/C* | Coat L*/C* | ΔL* armour−coat | Edge \|ΔL*\| colour / grey / deutan / protan (bar ≥ 15) | Pet vs ring ΔL* colour / grey / deutan / protan (reported) |
|---|---|---|---|---|---|---|---|
| face | Corgi Company | 47 of 118 (40%) | 56/29 | 47/24 | 8.4 | 17.8 / 17.8 / 17.4 / 18.7 | 14.9 / 14.9 / 14.5 / 15.6 |
| face | Cat Cadre | 34 of 88 (39%) | 28/32 | 50/5 | -22.0 | **14.7** / **14.7** / **14.4** / 15.3 | 8.2 / 8.2 / 8.5 / 7.6 |
| side | Corgi Company | 94 of 210 (45%) | 54/30 | 43/30 | 11.3 | 25.0 / 25.0 / 24.8 / 25.4 | 21.9 / 21.9 / 21.4 / 22.7 |
| side | Cat Cadre | 56 of 113 (50%) | 29/29 | 50/4 | -20.6 | 16.1 / 16.1 / 15.8 / 16.7 | 1.3 / 1.3 / 1.9 / 0.3 |
| horizon | Corgi Company | 103 of 199 (52%) | 52/33 | 37/26 | 14.8 | 39.3 / 39.3 / 39.8 / 38.4 | 39.7 / 39.7 / 39.6 / 39.6 |
| horizon | Cat Cadre | 54 of 130 (42%) | 22/30 | 45/3 | -22.8 | 34.2 / 34.2 / 34.7 / 33.3 | 27.4 / 27.4 / 28.4 / 25.6 |

| View | Teams ΔE colour | ΔL* grey | ΔE deutan | ΔE protan | Bar |
|---|---|---|---|---|---|
| face | 58.1 | 27.8 | 52.4 | 47.6 | FAIL: cat edge colour \|ΔL*\| 14.7 (< 15); cat edge grey \|ΔL*\| 14.7 (< 15); cat edge deutan \|ΔL*\| 14.4 (< 15) |
| side | 54.7 | 24.9 | 51.0 | 46.1 | PASS |
| horizon | 57.7 | 30.0 | 50.7 | 46.4 | PASS |

### twin WebGL: FAIL

| View | Pet | Armour px (share) | Armour L*/C* | Coat L*/C* | ΔL* armour−coat | Edge \|ΔL*\| colour / grey / deutan / protan (bar ≥ 15) | Pet vs ring ΔL* colour / grey / deutan / protan (reported) |
|---|---|---|---|---|---|---|---|
| face | Corgi Company | 34 of 122 (28%) | 50/18 | 66/26 | -15.8 | 33.8 / 33.8 / 34.2 / 33.2 | 22.0 / 22.0 / 22.1 / 21.8 |
| face | Cat Cadre | 20 of 96 (21%) | 42/27 | 64/3 | -21.2 | 27.0 / 27.0 / 27.0 / 27.1 | 11.7 / 11.7 / 11.5 / 12.0 |
| side | Corgi Company | 38 of 133 (29%) | 51/23 | 64/26 | -12.9 | 29.4 / 29.4 / 30.1 / 28.3 | 16.7 / 16.7 / 17.0 / 16.3 |
| side | Cat Cadre | 36 of 109 (33%) | 42/26 | 58/4 | -16.5 | 20.1 / 20.1 / 20.0 / 20.4 | 5.1 / 5.1 / 5.1 / 5.1 |
| horizon | Corgi Company | 41 of 125 (33%) | 50/20 | 58/17 | -8.1 | 30.3 / 30.3 / 30.7 / 29.7 | 29.7 / 29.7 / 30.3 / 28.8 |
| horizon | Cat Cadre | 29 of 107 (27%) | 33/22 | 59/7 | -26.2 | 26.3 / 26.3 / 27.0 / 25.2 | 25.3 / 25.3 / 26.3 / 23.7 |

| View | Teams ΔE colour | ΔL* grey | ΔE deutan | ΔE protan | Bar |
|---|---|---|---|---|---|
| face | 19.5 | 8.0 | 12.1 | 11.1 | FAIL: teams colour ΔE 19.5 (< 20); teams grey ΔL* 8.0 (< 10); teams deutan ΔE 12.1 (< 20); teams protan ΔE 11.1 (< 20) |
| side | 17.4 | 9.0 | 8.1 | 11.4 | FAIL: teams colour ΔE 17.4 (< 20); teams grey ΔL* 9.0 (< 10); teams deutan ΔE 8.1 (< 20); teams protan ΔE 11.4 (< 20) |
| horizon | 26.7 | 17.2 | 15.9 | 20.5 | FAIL: teams deutan ΔE 15.9 (< 20) |

### twin WebGPU high: FAIL

| View | Pet | Armour px (share) | Armour L*/C* | Coat L*/C* | ΔL* armour−coat | Edge \|ΔL*\| colour / grey / deutan / protan (bar ≥ 15) | Pet vs ring ΔL* colour / grey / deutan / protan (reported) |
|---|---|---|---|---|---|---|---|
| face | Corgi Company | 34 of 122 (28%) | 50/19 | 64/25 | -14.1 | 33.1 / 33.1 / 33.4 / 32.5 | 21.0 / 21.0 / 21.1 / 20.8 |
| face | Cat Cadre | 21 of 96 (22%) | 43/27 | 64/3 | -20.8 | 27.0 / 27.0 / 27.0 / 27.0 | 11.9 / 11.9 / 11.7 / 12.2 |
| side | Corgi Company | 39 of 133 (29%) | 51/23 | 64/26 | -12.8 | 29.6 / 29.6 / 30.3 / 28.5 | 16.8 / 16.8 / 17.1 / 16.4 |
| side | Cat Cadre | 36 of 109 (33%) | 42/26 | 58/4 | -16.4 | 20.1 / 20.1 / 20.0 / 20.3 | 5.2 / 5.2 / 5.1 / 5.1 |
| horizon | Corgi Company | 41 of 125 (33%) | 50/20 | 58/17 | -8.1 | 30.3 / 30.3 / 30.7 / 29.7 | 29.7 / 29.7 / 30.3 / 28.8 |
| horizon | Cat Cadre | 29 of 107 (27%) | 33/22 | 59/7 | -26.2 | 26.3 / 26.3 / 27.0 / 25.2 | 25.4 / 25.4 / 26.3 / 23.7 |

| View | Teams ΔE colour | ΔL* grey | ΔE deutan | ΔE protan | Bar |
|---|---|---|---|---|---|
| face | 19.4 | 7.2 | 12.4 | 10.8 | FAIL: teams colour ΔE 19.4 (< 20); teams grey ΔL* 7.2 (< 10); teams deutan ΔE 12.4 (< 20); teams protan ΔE 10.8 (< 20) |
| side | 17.2 | 8.9 | 8.0 | 11.4 | FAIL: teams colour ΔE 17.2 (< 20); teams grey ΔL* 8.9 (< 10); teams deutan ΔE 8.0 (< 20); teams protan ΔE 11.4 (< 20) |
| horizon | 26.7 | 17.2 | 15.9 | 20.5 | FAIL: teams deutan ΔE 15.9 (< 20) |

Views vs the baseline lineup: unchanged (every camera and pet within 5 cm; the Compatibility and Forward+ lineups are
identical).

## Bar verdicts at the baseline (edge bar)

| Config | Teams (ΔE ≥ 20 colour/CVD, ΔL\* ≥ 10 grey) | Silhouettes (edge \|ΔL\*\| ≥ 15, four images) | Species (1:1) | Verdict |
|---|---|---|---|---|
| Godot Compatibility | pass in all 3 views (lowest: deuteranopia 50.6, protanopia 48.7, greyscale 32.7) | pass (lowest: the Cat's 26.6, protanopia, head on) | reads | **PASS** |
| Godot Forward+ | pass in all 3 views (lowest: protanopia 46.1, greyscale 24.9) | **fail**: the head-on Cat 14.7 / 14.7 / 14.4 (protanopia 15.3 passes); the side-on Cat passes at 16.1 | reads | **FAIL** |
| twin WebGL | **fail** head on (19.5 / 8.0 / 12.1 / 11.1) and side on (17.4 / 9.0 / 8.1 / 11.4); horizon fails on deuteranopia only (15.9) | pass (lowest: the side-on Cat's 20.0, deuteranopia) | head colour and ears only | **FAIL** |
| twin WebGPU high | **fail**, as WebGL (19.4 / 7.2 / 12.4 / 10.8; 17.2 / 8.9 / 8.0 / 11.4; horizon deuteranopia 15.9) | pass (lowest 20.0) | head colour and ears only | **FAIL** |

Under the superseded mean-vs-ring bar (≥ 8), the first baseline also failed the side-on Cat in Forward+ (1.3) and in
both twin configs (5.1 and 5.2), and passed Forward+'s head-on Cat in colour (8.2). Those means are still printed, as
reported numbers only.

## Species read (the 1:1 pixels, seen at 4x nearest-neighbour in `aaa30m-crops-4x.jpg`)

- **Godot, both renderers:**
  - Head on: the Corgi has a tan head with two big upright ears over a blue vest. The Cat is grey, with its S-tail
    rising as a thin column above its head and a crimson vest.
  - Side on and on the horizon: the long, low Corgi with a stub tail against the leggy Cat with its S-tail, readable
    at native size. This matches READ3.
- **Twin:** both bots are upright soldiers of the same height, holding rifles. Species reads by head colour and ear
  shape only: a tan head with large ears against a grey head with pointed ears.
  - The body does not separate them.
  - No tail resolves.
  - On the horizon, both are dark shapes 17–19 px tall, and the ear shapes are the only cue.
  - This is a PLACEHOLDER-era finding (CHAR is parked), so it is recorded and not barred by the tool.

## Mutation: the bar catches a recoloured Cat armour

**Engine-level, on a scratch copy only.** `scratchpad/qa30m/mut/tree` is a copy of the `f7f45b5` archive and never
touched the shared tree. In it, the Cat armour was recoloured to the Corgi's:

- Godot `look/pet_materials.gd`: `BAND[1] = BAND[0]` (the Corgi blue) and `BAND_ENERGY[1] = 1.15`. The Cat's band
  and the band on its plates now take the Corgi's paint and energy.
- Twin `procgen/characters/gear.ts`: `factionGear('cat').paint` is the Corgi's (ochre camo), and
  `teamColors(Team.Cats)` returns the Corgi's.

The run was `node tools/aaa-30m.mjs run --tree <scratchpad>/qa30m/mut/tree --out <scratchpad>/qa30m/mut/out
--configs compat,webgl`, and it **exited 1**.

| Config · view | Baseline teams ΔE colour / ΔL\* grey / ΔE deutan / ΔE protan | Mutant | Verdict |
|---|---|---|---|
| Godot Compatibility · face | 74.9 / 36.2 / 61.0 / 55.9 | 0.4 / 0.4 / 0.4 / 0.4 | PASS → **FAIL** |
| Godot Compatibility · side | 66.0 / 32.7 / 54.6 / 50.2 | 1.4 / 1.3 / 1.4 / 1.4 | PASS → **FAIL** |
| Godot Compatibility · horizon | 66.1 / 36.3 / 50.6 / 48.7 | 2.8 / 1.2 / 2.8 / 2.6 | PASS → **FAIL** |
| twin WebGL · face | 19.5 / 8.0 / 12.1 / 11.1 | 9.8 / 3.8 / 9.8 / 8.5 | FAIL → FAIL, further below the bar |
| twin WebGL · side | 17.4 / 9.0 / 8.1 / 11.4 | 3.2 / 1.0 / 1.6 / 2.1 | FAIL → FAIL |
| twin WebGL · horizon | 26.7 / 17.2 / 15.9 / 20.5 | 4.2 / 1.7 / 3.6 / 3.0 | FAIL → FAIL; its colour, greyscale and protanopia passes are lost |

**Image-level, all four configs.** `node tools/aaa-30m.mjs measure --out <scratchpad>/qa30m/base --mutate` paints
each Cat armour pixel with the Corgi's mean armour colour. Every config fails, with teams ΔE 0.4–5.4:

| Config | Teams ΔE (face / side / horizon) |
|---|---|
| Godot Compatibility | 1.3 / 2.0 / 2.2 |
| Godot Forward+ | 0.5 / 0.4 / 1.7 |
| twin WebGL | 4.8 / 4.2 / 5.4 |
| twin WebGPU high | 4.6 / 4.2 / 5.4 |

The image is `aaa30m-mutation.jpg`.

## The regression rule for every later pass (lead ruling 2026-10-17; `--baseline <dir>`)

`run` and `measure` take `--baseline <dir>`. The tool re-measures the baseline's saved frames with its current metric
and compares every barred number, view by view:

- **A number that passes at the baseline must still pass.** As the lead ruled it, the rule is per config: a config
  that passes keeps passing. **This lane applies it per number,** which is a stricter reading. Without that, a number
  that passes inside an already-failing config could fall through the bar unnoticed. Example: Forward+'s horizon edges
  (33–40) could drop below 15, and only the head-on Cat would be failing at the baseline. **Lead: overrule if the
  per-config reading is meant.**
- **A number that fails at the baseline may not fall by more than the noise floor:** 2 L\* for edges and greyscale,
  2 ΔE for teams. Pixel counts have no floor. **Forward+ needs no more.** A second Forward+ render of the baseline
  (`run --tree <scratchpad>/qa30m/base/tree --out <scratchpad>/qa30m/fplus-repeat --configs fplus --baseline …`,
  exit 0) moved no barred number by more than 0.11. Its masks were identical, and the frames differ only in
  19–36k px of animated sky and haze, away from the pets. Compatibility repeats to the digit. The volumetric
  reprojection settles inside the 60 frames the tool waits.
- **Output and exit code.** Exit 1 lists each regressed number with its baseline and new value. Exit 2 means a view
  is missing or the lineup moved by more than 5 cm, because then the numbers are not like for like.

**Proof by mutants on the saved baseline frames** (in memory; the frames are not touched), each run as
`node tools/aaa-30m.mjs measure --out <scratchpad>/qa30m/base --baseline <scratchpad>/qa30m/base <mutant>`:

| Mutant | Exit | What regressed |
|---|---|---|
| none (`--mutate-ring 0`: the L\* shift's round trip) | 0 | nothing: identical numbers |
| horizon ring darkened 20 L\* (`--mutate-ring -20`) | 0 | nothing. The rings are already L\* 7–16 and clamp at 0, so every edge rises |
| horizon ring brightened 20 L\* (`--mutate-ring 20`) | 0 | nothing. Every edge falls (Compatibility's Corgi 49.8 → 31.6, Forward+'s Cat 34.2 → 18.1, the twin's Cat 26.3 → 16.3), but all stay ≥ 15 (lowest 16.1), so no bar is crossed. Correct by the rule |
| horizon ring brightened 30 L\* (`--mutate-ring 30`) | **1** | 5 numbers: Forward+ · horizon · Cat edge 34.2 → 14.3 (colour and grey), 34.7 → 13.9 (deuteranopia), 33.3 → 15.0 (protanopia); Corgi edge in deuteranopia 39.8 → 15.0. All five "passed at the baseline, fails now" |
| horizon ring brightened 40 L\* | **1** | 8 numbers, all Forward+ horizon edges (Corgi 39.3 → 13.2, Cat 34.2 → 13.5 in colour) |
| Compatibility, horizon ring +50 and +60 | 0 | nothing. Compatibility's pets have both light and dark parts (the Cat's L\* 57 coat with its L\* 31 crimson vest), so as the background lightens past one part, the edge pairs on the other part gain. A uniform background shift cannot hide them |
| Cat armour = Corgi armour (`--mutate`), Compatibility and twin WebGL | **1** | 24 numbers. Clause 1: Compatibility's 12 team numbers go from passing to failing (head on, colour 74.9 → 1.3, greyscale 36.2 → 1.2). Clause 2: the twin's already-failing team numbers fall by 4.1–14.6 (head on, colour 19.5 → 4.8, greyscale 8.0 → 3.0), and its passing horizon numbers start failing (colour 26.7 → 5.4) |
| Forward+, face ring +5 and +10 (`--mutate-views face`) | **1** | At +5: the head-on Cat's protanopia edge 15.3 → 14.4, "passed at the baseline, fails now". Its already-failing colour edge falls only 14.7 → 13.7, within the noise floor, so it is not listed. At +10: that edge is 14.3, and the Corgi's face edge also crosses (17.8 → 14.7 in colour and grey, 17.4 → 14.2 in deuteranopia) |

## After TW-PETS (2026-10-18): the lab draws the slab pets

TW-PETS made the twin's slab match draw Godot's PLACEHOLDER pets. Its 13-line patch to a private copy of
`labs/lineup.ts` was reviewed and adopted with one change: the slab mode is passed as a typed variable, not as an
object literal. A tree from before TW-PETS (`f7f45b5`) has no `mode` option, so a literal would be a TypeScript
excess-property error there; the variable typechecks at both, and at runtime the older `EntityViews` simply ignores it.
The lab typechecks clean against `f7f45b5` and against `f7f45b5` + TW-PETS. The matte maps a slab pet's groups exactly
as Godot's matte does: plate and band are armour, coat is coat, and accent, dark and the whole rifle are the rest.

- **(a) The metric is unchanged.** `node tools/aaa-30m.mjs measure --out <scratchpad>/qa30m/base --baseline
  <scratchpad>/qa30m/base` exits 0, with tables identical to the re-measure above.
- **(b) The twin, with the slab pets.** The run was `node tools/aaa-30m.mjs run --tree <scratchpad>/qa30m/pets/tree
  --out <scratchpad>/qa30m/pets --configs webgl,webgpu --baseline <scratchpad>/qa30m/base`.
  - The tree is the `f7f45b5` archive plus TW-PETS's `slab-pet.ts`, `entity-views.ts` and `main.ts` (sha256 equal to
    TW-PETS's list) and its test, plus this lab. It is a `--tree`, not `--sha`, because no commit holds that state.
  - Only the twin configs were rendered, with the baked baseline lineup. Every view logged `pets: slab`.
  - The first run's JSON had its lineup overwritten by the new builder field: a tool bug, now fixed (the field is
    `petBuilder`). The six JSONs were restored from the baked lineup the run used, and the saved frames were
    re-measured. Exit 0: **twin WebGL PASS, twin WebGPU high PASS, no regression against the K2 baseline.**

| Config | Teams ΔE colour / ΔL\* grey / ΔE deutan / ΔE protan (face · side · horizon) | Lowest edge | TW-PETS's own run |
|---|---|---|---|
| twin WebGL | 57.6/20.3/47.8/40.6 · 58.1/20.6/49.3/42.1 · 62.9/26.7/51.7/45.3 | 22.8 (Cat, face, protanopia) | 57.3/20.9/47.2/40.3 · 58.2/20.5/49.4/42.1 · 62.9/26.7/51.7/45.4; lowest 23.2 |
| twin WebGPU high | 57.5/20.4/47.7/40.6 · 57.1/20.4/48.3/41.2 · 62.9/26.7/51.7/45.3 | 22.8 (Cat, face, protanopia) | 57.0/20.9/47.0/40.1 · 58.2/20.5/49.4/42.1 · 62.9/26.7/51.7/45.4; lowest 22.7 |

Every difference is within 0.7, except WebGPU side on (1.1), and all are inside the noise floor. TW-PETS's run took
its twin lineup from a fresh Godot JSON at full precision; this one used the tool's baked lineup (4 decimals), which
moves a pixel here and there. A twin pass from here on measures these pets. Frames and sheets are in
`<scratchpad>/qa30m/pets/`.

Species, by eye from `<scratchpad>/qa30m/pets/sheets/aaa30m-crops-4x.jpg`: in every twin view, the long, low corgi with
upright ears and a blue vest, and the leggy cat with its S-tail and crimson vest, as in Godot. Species now reads by
body, ears and tail in all four configs. The twin's greyscale team gap (20.3–26.7) stays below Godot Compatibility's
(32.7–36.3) and Forward+'s (24.9–30.0); this is PARITY P3a.

## Images (`docs/qa/w17/`, each under 400 KB)

| File | What it shows |
|---|---|
| `aaa30m-face-1x.jpg` | the four configs, face view, 1:1 crops (400x225) around the bots |
| `aaa30m-side-1x.jpg` | the same, side view |
| `aaa30m-horizon-1x.jpg` | the same, horizon view (the bots on the plateau lip, above the hoarding line) |
| `aaa30m-full-horizon.jpg` | the horizon view, full frames at half size: what the BACKDROP pass will fill behind the bots |
| `aaa30m-crops-4x.jpg` | every config and view at 4x nearest-neighbour, each beside its matte (the species read; the matte's fit) |
| `aaa30m-gray-cvd-face.jpg` | face view at 3x in colour, greyscale (L\*), deuteranopia and protanopia, all four configs |
| `aaa30m-gray-cvd-horizon.jpg` | the same, horizon view |
| `aaa30m-mutation.jpg` | the mutation proof, baseline vs mutant at 4x: Godot Compatibility face and horizon, twin WebGL face |

All eight images show the `f7f45b5` baseline, so their twin cells show the K2 kits. The post-TW-PETS sheets are in
`<scratchpad>/qa30m/pets/sheets/`, which is not in the repo. `aaa30m-mutation.jpg` is composed by hand from the mutant
run; the other seven are the tool's own sheets.

Every run writes the same sheets to `<out>/sheets/` (plus `aaa30m-full-face.jpg`), so a pass can put its "after"
images beside these.

## Honest limits

- **Software rasterisers only.** Godot used llvmpipe (OpenGL) and lavapipe (Vulkan); the twin used SwiftShader
  (ANGLE GL and WebGPU). There are **no real-GPU numbers**. A desktop GPU runs the same shaders, but its precision,
  AA and driver colour paths can move these means by a few units. The reference-desktop check stays with a human.
- **Small samples.** At 30 m a bot is 88–210 px, and its armour is 20–103 px. A mean over 20 px moves visibly with a
  one-pixel change in the matte's fit.
  - Godot Compatibility repeated to the digit. Two runs (60 and 90 settle frames) gave identical mattes and
    identical numbers; the frames differ only in 6,376 px of animated sky and water.
  - Forward+ repeated within 0.11 on every barred number (a second render; identical masks).
  - The twin's two backends agree within 1.9. A repeat of the same twin config was not run.
  - A pass's change smaller than the noise floor (2 L\* / 2 ΔE) is noise, not a result.
- **Rulings applied (lead, 2026-10-17).**
  - The silhouette bar is the edge contrast ≥ 15 in all four images. The pet-vs-ring mean is reported only.
  - Armour keeps this lane's definition: plates, vest and shield, not trim. The twin's team FAIL is a real finding;
    the parity card for the twin's W7 K2 faction-camo kits against Godot's team-painted barding is the lead's.
  - The edge bar sits close to some numbers. Forward+'s head-on Cat is at 14.4–15.3, and the side-on Cat at
    15.8–16.7. A pass that touches the floods, the haze or the ground behind the pit's bots will move them.
- **The views are chosen, not exhaustive.** There are three views at one spot each.
  - The flood views use the Corgi pit's pool only.
  - The horizon view was placed by hand: it is the one place found where a yard-level camera sees the bots above the
    9.6 m hoarding (the pets have to stand higher than the camera).
  - Godot's side view reuses the face view's spot, because `--lineup-side`'s own search picked a spot hidden by a
    crate.
  - The tool reports if a later tree moves any of these.
- **Not like the live game in four ways.**
  - Rain is off.
  - Godot's HUD is hidden.
  - The twin is framed by Godot's play camera (fov 72), not by the twin's own third-person camera.
  - The twin's bots use fixed seeds (1, 2), not the slab sim's, and the lab draws no slab read-out (the slab is out of
    every view).
- **Not measured:**
  - frame times (not this card's job; any number here would be a software-rasteriser number);
  - species read by a machine: it is judged by eye from the crops;
  - the HUD over the pets;
  - rain on;
  - the twin's low and medium tiers;
  - any browser but Chromium 141. Its WebGPU needs the test-only swizzle shim; desktop Chrome, Firefox and Safari are
    untested.
- **Housekeeping.** Before the tool gave its vite server a private dep cache, two development runs of the twin
  rewrote the shared `node_modules/.vite` dep cache at 21:27. It is a regenerable cache and no source was touched,
  but another lane's dev server may have re-optimised once.
