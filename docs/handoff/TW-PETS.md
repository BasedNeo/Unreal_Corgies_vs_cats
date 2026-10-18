# TW-PETS (W17): the twin's slab match draws Godot's PLACEHOLDER pets

**Card.** The W17 AAA 30 m team read (`docs/qa/w17/AAA-30M.md`, baseline `f7f45b5`) failed on the twin: its slab match
drew the W7 K2 hardened kits (faction camo, team colour on small trim), while Godot draws the W13 R-PETS / W14 TEAM
PLACEHOLDER pets in team-painted barding. This lane ports those pets to the twin's slab match: port, do not
reinterpret. Godot is the product and wins any clash.

**Verdict (30 m, run on `f7f45b5` + this lane's files, `--baseline` the QA-30M baseline): twin WebGL PASS, twin
WebGPU high PASS (both FAIL at the baseline); Godot Compatibility PASS and Godot Forward+ FAIL, both unchanged; no
regression (exit 0).** Teams went from ΔE 17–27 / greyscale ΔL\* 7–17 to ΔE 57–63 / greyscale 20.5–26.7, and every
edge is 22.7 or more. Species now reads by body, ears and tail, as in Godot.

**Base.** HEAD `f7f45b5` (the CI-green tip). Nothing staged or committed (the lead owns git). Measured on private
copies only. The shared tree holds other lanes' work, which this lane did not touch.

## 1. Files

| Path | Lines | What |
|---|---|---|
| `src/client/views/slab-pet.ts` | new | The slab pet: an `Avatar` (`root`, `height`, `update`, `trigger`, `muzzleWorld`, `dispose`) built from Godot's numbers. One merged mesh per (species, team) with five groups (coat, accent, dark, plate, band), plus one shared rifle mesh with two groups (metal, band). Geometry is shared and ref-counted. Materials come only from the style factory's `pbr()`. |
| `src/client/views/entity-views.ts` | 16 (import), 36–37 (option `mode`), 40–41 (`drawsSlabPets`), 85, 89, 92, 97–100, 107 | The one switch. `drawsSlabPets(mode)` is true for `'slab'` only. In that mode every player and bot is a slab pet, keyed `pet:<species>:<team>`, with no look, squad kit or rank. Bosses are unchanged, and every other mode keeps `createCharacter`. |
| `src/client/main.ts` | 136 | `mode: () => net?.mode ?? ''`: the welcome's mode, the same `net.mode` that `faceSlab` already reads. |
| `tests/unit/slab-pet.test.ts` | new | 23 tests (section 4). |
| `docs/handoff/TW-PETS.md` | new | This file. |

Not touched: `src/sim`, `src/host`, `src/shared` (collision is still the sim's capsule; hit boxes, aim heights and
movement are unchanged), the HUD (the `PLACEHOLDER PETS` tag stays, PARITY F14), the kit, style tokens and style code,
and other lanes' paths. `labs/lineup.ts` (QA-30M's) is not this lane's file. QA-30M adopted this lane's section 5 patch into it (the slab mode as a typed variable, and the matte reading `userData.petSurfaces`), and the landed lab carries it.

## 2. What was ported, and the Godot line each number came from

Godot 4 lines, as of `f7f45b5`.

| Twin (`slab-pet.ts`) | Godot source |
|---|---|
| `PET_SURFACES` / `RIFLE_SURFACES` | `pet_model.gd` 25–26 |
| `GAP` 0.15, `TRIM` 0.04 | `pet_model.gd` 31, 33 |
| `corgi()`: body, bib, legs and socks, neck, head, fox muzzle, nose, eyes, ears (hinged at the skull, ±13°, cream inside), stub tail, vest, collar, chest | `pet_model.gd` `_corgi` 95–119 |
| `cat()`: body and haunches, bib, long legs, neck, head, muzzle, nose, eyes, cone ears (±12°), the 7-point S-tail (`0.68 + 0.78 t`, `0.42 + 0.2 t + 0.12 sin(TAU t)`, radius 0.065 → 0.045), vest, collar, chest | `pet_model.gd` `_cat` 122–151 |
| `vest()`: inner = length − 2 TRIM. Corgi Company one solid block. Cat Cadre two blocks split by a GAP plate tube. Open TRIM rims at both ends (radius + 0.012) | `pet_model.gd` `_vest` 157–171 |
| `chest()`: tucked back 8°. Corgi Company a solid shield with a pointed bottom on a 0.025 m-proud ochre backing; Cat Cadre a square plate split by a GAP strip | `pet_model.gd` `_chest` 178–194 |
| `collar()`: a 0.06 m ring, `along` of the way up the neck | `pet_model.gd` `_collar` 198–199 |
| `rifle()`: three metal boxes/cylinder, a band strip, muzzle at (0, 0.015, −0.47) | `pet_model.gd` `rifle` 54–74 (59–62, 72) |
| `Kit`: `at` (Euler **YXZ**, Godot's `Basis.from_euler` default), `pivot`, `along`, normals by the inverse transpose, part boxes; segments ellipsoid 12/6, capsule 16/6, cylinder 12/1, tube 12/1 (open), capsule segment 10/2; PrismMesh (apex up) | `pet_model.gd` 251–374 (259–272, 281–341, 361–374) |
| `PET_LOOK.team` 2f6fd6 / c9344a | `pet_materials.gd` 18; `tuning.gd` 10 (`TEAM_COLORS`); `PALETTE.teamCorgis/teamCats` |
| `band` (0.1843, 0.4353, 0.8392) / (0.4335, 0.1122, 0.1596), `bandEnergy` 1.15 / 1.0 | `pet_materials.gd` 24, 28 |
| `ochre`, `coat` (corgi, cat), `accent`, `dark`, `furFill` 0.6 / 0.9 | `pet_materials.gd` 29, 30, 34, 35, 36, 42 |
| roughness coat 0.42, accent 0.5, dark 0.25, band 0.6, plate 0.38, metal 0.32; metallic plate 0.1, metal 0.9; metal colour (0.23, 0.23, 0.24) | `pet_materials.gd` 70, 84, 91, 98–99, 113–117 |
| Self-light: coat and accent = their colour × FUR_FILL; band = BAND × BAND_ENERGY; plate = BAND × BAND_ENERGY × the band mask | `pet_materials.gd` 77–81, 92–94, 103–107 |
| The plate's texture: 128 rows, the team band in rows 0–43 and ochre below, the mask the same rows; object-space triplanar at uv1_scale 1.4 (Godot's `P = VERTEX × 1.4 × (1, −1, 1)`) | `pet_materials.gd` 95–97, 156–185 (165, 182) |
| Sharing: band and plate per team, dark and metal one each. Godot caches coat and accent per (species, team) (its key keeps the team); the twin shares them per species, with identical values | `pet_materials.gd` 52–57 |
| `RIFLE_MOUNT` (0.27, 0.64, −0.3) / (0.22, 0.76, −0.22) | `pet.gd` 91 |
| `update()`: the model turns to the aim yaw (EntityViews turns the root to its body yaw, so the model takes `aimYawOffset`). The rifle pitches with the aim, clamped to ±0.9. The model hides while dead. No bob, no lean, no hit reaction. | `pet.gd` 185–186, 209, 224 |
| `root.userData.placeholder` | `pet_model.gd` 43 (`set_meta("placeholder", true)`) |

**The texture means (measured, not parsed).** Godot's fur and wear textures are FastNoiseLite noise, which the twin
does not port as patterns. They enter as their exact means, measured in Godot 4.7.2 from `pet_materials.gd` itself (a
headless script calling `_fur(species)` and `_wear()` over every texel, srgb→linear):

| | linear mean | multiplies |
|---|---|---|
| fur, corgi | 0.7424 | coat and accent albedo **and** emission (`EMISSION_OP_MULTIPLY`, lines 68 and 79–80) |
| fur, cat | 0.5082 | as above |
| wear | 0.6926 | band and metal albedo (90, 114); the band's emission has no texture |

Head on at 30 m (twin WebGL), the coats rendered L\* 58 (corgi) and 73 (cat) without the means, against Godot
Compatibility's 48 and 54. With them, they render 53 and 63.

**The pin.** `tests/unit/slab-pet.test.ts` (`TEXTURE_PIN`) records three things together:
- the sha256 of the exact source the means depend on: `33bd14252a9042df2ea0213a39fb8647fdac5375bef31ac1671309e2577f0b8d`.
  That is the bodies of `_noise`, `_fur` and `_wear`, taken by function text (the `func` line and its indented lines),
  not by line numbers, plus any `pet_materials.gd` constant they read (none at `f7f45b5`);
- the means measured from that source: fur 0.7424 / 0.5082, wear 0.6926;
- the command that measures them again (`MEASURE_TEXTURES`).

The test also checks that the pinned set is closed (the bodies call no other file function) and that `PET_LOOK` uses
exactly the recorded values. If the noise code changes, it fails with "re-measure the fur/wear means: <command>".

To re-measure, run this from the repo root, with `$GODOT` set to a Godot 4 binary (here
`…/scratchpad/pglb1/Godot_v4.7.2-stable_linux.x86_64`). It copies `pet_materials.gd` into a throwaway project, so it
never imports the game project:

```
D=$(mktemp -d) && mkdir -p $D/look && cp engines/godot/look/pet_materials.gd $D/look/ && printf 'config_version=5\n' > $D/project.godot && printf '%s\n' 'extends SceneTree' 'func _init():' '    var pm = load("res://look/pet_materials.gd").new()' '    for k in ["fur0", "fur1", "wear"]:' '        var img: Image = (pm._wear() if k == "wear" else pm._fur(int(k[3]))).get_image()' '        var s := 0.0' '        for y in img.get_height():' '            for x in img.get_width():' '                s += img.get_pixel(x, y).srgb_to_linear().r' '        print("MEAN %s %.4f" % [k, s / (img.get_width() * img.get_height())])' '    quit()' > $D/m.gd && "$GODOT" --headless --path $D -s res://m.gd | grep MEAN
```

It prints `MEAN fur0 0.7424`, `MEAN fur1 0.5082` and `MEAN wear 0.6926`; this was run verbatim from the test's string.
After a change, update `TEXTURE_PIN` (the hash and the values) and `PET_LOOK.furMean` / `wearMean` together.

## 3. Not ported, or different (limits)

- **Texture patterns.** The fur stripes, the wear mottling and the plate's grime blotches and bare-metal scuffs
  (`_plate` lines 166–169) are not ported. The plate's band rows are ported exactly.
- **Triplanar.** The plate uses one projection per triangle, by its normal's dominant axis. Godot blends the three
  projections by |normal|. This only shows where a ring's normal is near 45°.
- **Rim sheen and clearcoat.** Godot's rim (`rim 0.55, rim_tint 0.35`, on coat **and** accent: `pet_materials.gd` 65, 72–74) has no `pbr()` term, so it is not ported. The plate's clearcoat (0.6 / 0.12, Forward+ only, 108–111) is not ported either.
- **Mipmaps.** Godot builds mipmaps for its fur, wear, plate and band-mask images (`pet_materials.gd` 150, 171, 183, 197). The twin's plate and band-mask `DataTexture`s are `LinearFilter` with no mipmaps (`slab-pet.ts` 454), so at range the band/ochre boundary point-samples instead of blending. Not measured.
- **Lightness (PARITY P3a).** The twin's coats render lighter than Godot Compatibility's, by 5–9 L\* head on and side on (corgi 53 / 54 vs 48 / 45; cat 63 / 63 vs 54 / 54) and by 1–3 on the horizon (48 / 60 vs 47 / 57). The Cat Cadre crimson renders 10–11 lighter (armour L\* 40 / 40 vs 29 / 30; horizon 33 vs 31), and the Corgi Company blue 3–7 darker (61 / 60 / 60 vs 65 / 63 / 67). The greyscale team gap is therefore 20.3–26.7, against Compatibility's 32.7–36.3 (bar 10). The pets' numbers are Godot's, so the gap is in what draws them: the twin's look (exposure 1.5 against Godot's 1.25, three's AgX, the lights), the texture patterns and the rim. **This is not investigated, and not barred.**
- **Step-up catch-up.** `pet.gd` `step_offset` (145–147) belongs to Godot's own movement. The twin's snapshots already
  move the pet smoothly.
- **Tessellation.** The primitives come from three's geometry classes at Godot's segment counts (Godot's `rings` → rings
  + 1 rows). Vertex placement around each ring may start at a different angle.
- **Shadows.** The pets cast shadows (Godot's default). Like the twin's characters, they do not receive them.
- **Height.** `height` (nameplates) is the head's top: 0.96 m for the corgi, 1.065 m for the cat. The ears and the S-tail
  rise above it. Nameplates are hidden in a slab match anyway.
- **Shots and e2e ran on SwiftShader.** The full game rendered at 0.13–0.4 fps under load 7–9. The match shots are
  WebGL, high tier. No real GPU was used, and the reference-desktop look stays with a human.
- **Cost.** 7 draws per pet per pass (5 + 2), as Godot's: a 2 v 2 adds 28 draws. Triangles: corgi 2,876 / 2,992 and cat
  3,708 / 3,824 (Corgi Company / Cat Cadre), plus 108 for the rifle. No frame-time measurement was made; on SwiftShader
  it would not mean anything.

## 4. Tests

`tests/unit/slab-pet.test.ts` (Vitest, Node) has 23 tests:

1. **Parsed from Godot's files:**
   - The surfaces, GAP, TRIM and Kit's segments.
   - For each of `_corgi`, `_cat`, `_vest`, `_chest`, `_collar` and `rifle()`, compared with the twin's transliteration:
     - every numeric literal, in order: 124 / 122 / 29 / 47 / 1 / 30;
     - every primitive call, with its surface and its part.
   - From `pet_materials.gd`: every colour, energy, fill, roughness and metallic value, the plate's rows and its scale,
     and which textures sit where. `tuning.gd` `TEAM_COLORS`.
   - From `pet.gd`: the rifle mount, the pitch clamp, and the turn, hide and show lines.
   - The texture means: the sha256 of `_noise`, `_fur` and `_wear` (by function text, plus any constant they read),
     the measured values next to it, and the re-measure command in the failure message. `PET_LOOK` must equal the
     recorded values (section 2).
   - The built materials carry all of these values, under Godot's sharing rule.
2. **The built pet:**
   - One mesh per pet with five groups in order, and the rifle with two: 7 draws.
   - Only `StylePbrMaterial` (`userData.style 'pbr'`), no lines, the placeholder tag, and the HUD's
     `PLACEHOLDER PETS` tag.
   - Godot's `test_read_pets.gd` checks, run on the twin's geometry:
     - **silhouettes:** corgi length/back 1.91, cat 1.11, legs, ears, the tail S as the tallest part;
     - **the vest over the back, flanks and chest:** the band is as wide as the torso and spans its middle and its back.
       Godot's orthographic coverage rasteriser is ported, with team share ≥ `MIN_TEAM_SHARE` and paint ≥ 60 % of the
       armour, side on and head-on. The chest panel is ≥ 0.30 × 0.25 m, in front and centred;
     - **pattern:** it follows the team, not the species (1/1 solid, 2/2 split, features ≥ 0.15 m);
     - **team colours:** locked hues; Corgi Company paint ≥ 1.25× its coat's self-light and Cat Cadre's coat ≥ 3× its
       paint; the sides ≥ 3:1 apart; every emission peak < 0.85 × the bloom threshold.
   - The plate's triplanar v: −1.4 y on side and front faces, 1.4 z on top faces.
   - **Godot's own boxes (PARITY P3d).** Every part's model-space box must be within 1 cm of the box Godot's
     `layout(species, team)` reports, for all four (species, team) pairs. The cat's tail centre line must be Godot's to
     0.1 mm. The worst gap is 7.3 mm, on the neck capsule's tessellation. The boxes are recorded in the test as
     `GODOT_PARTS` / `GODOT_CAT_TAIL`, dumped by Godot 4.7.2 from `pet_model.gd` at `f7f45b5`. To regenerate:
     1. Copy `engines/godot/game/{pet_model,tuning}.gd` into a throwaway project's `game/` (`project.godot` =
        `config_version=5`).
     2. Add `<S>/confirm-l1/pets/gdgeo/dump.gd`. It writes each `PM.layout(sp, tm).parts` AABB as position + end
        (`snappedf 0.0001`) and `.tail` to `res://out.json`.
     3. Run `"$GODOT" --headless --path <dir> -s res://dump.gd`, and paste the boxes into the test.
   - **The prisms point the right way.** Godot's PrismMesh has its apex up. Slicing the triangles at a height: the
     corgi's ear is < 6 cm wide near its tip and over 3× that just above the head. The Corgi Company shield is < 15 cm
     wide near its point and > 45 cm at its top.
3. **Over time:** it faces the aim yaw, pitches the rifle (clamped), hides while dead and on `trigger('death')`, and
   shows again on `trigger('spawn')`. The rifle is the model's child: it is hidden while dead, and its world yaw is the
   body yaw + `aimYawOffset`. Other triggers do nothing. The muzzle sits at the pitched barrel tip.
   `height` is the head's top.
4. **The switch and sharing:**
   - `drawsSlabPets` is true for `slab` only, across all 7 modes, and `main.ts` passes the welcome's mode.
   - In EntityViews, slab draws a pet for every player and bot. A pet running sideways keeps its model on the aim yaw.
     Each of the 6 other modes draws `createCharacter`, rebuilt in place, and the pets' geometry is released.
   - Geometry and materials are shared per (species, team). Dispose frees the geometry only when the last pet goes, and
     a second dispose is a no-op.

**Commands and results** (shared tree, `nice -n 10`):

| Command | Result |
|---|---|
| `npx vitest run tests/unit/slab-pet.test.ts` | 23 passed |
| `npx vitest run tests/unit/slab-pet.test.ts tests/unit/slab-*.test.ts tests/unit/char-k3-squads.test.ts tests/unit/cosmetics-rank.test.ts tests/unit/fx-particles.test.ts tests/unit/style-no-comic.test.ts` (the touched code, every slab test, and every other test that drives EntityViews) | 11 files, 179 passed |
| `npx tsc --noEmit` | exit 0 |
| `node tools/check-boundaries.mjs` | PASS |
| the whole unit suite on the private tree (`f7f45b5` + this lane's files): `npx vitest run --maxWorkers=2` | 157 files: 1400 passed, 4 skipped, exit 0 (run before the texture pin and P3d tests were added; those then passed alone and in the 11-file run) |
| `npx playwright test tests/e2e/modes.spec.ts tests/e2e/smoke.spec.ts tests/e2e/locker.spec.ts --workers=1` on the private tree (its own port 4183, so no other lane's `dist/` or port 4173 is touched) | 9 passed (4.9 min): both SLAB tests on The Lot (HUD, kit, PLACEHOLDER PETS tag, no nameplates; the winner screen and the R / Enter rematch), CORE RUSH, BASE ASSAULT, ADVENTURE, both smoke tests and both locker tests |

**Mutants** (`scratchpad/twpets/mutants.py`). Each mutant is one edit in a scratch copy (never the shared tree), then
the test file is run and the copy restored. The unmutated copy passes. Each mutant must fail; the failing tests are
listed.

| # | Mutant | Fails (the tests named) |
|---|---|---|
| 1 | swap the team colours (the BAND constants) | the pet_materials.gd parse; team colours |
| 2 | swap the paint at the use site (each pet wears the other side's band) | the built materials; team colours |
| 3 | drop the vest (geometry: the `band` part is never put) | the vest covers the back, flanks and chest |
| 4 | drop the vest (delete the cat's `vest()` call) | `_cat()` numbers; the vest covers…; the pattern follows the team |
| 5 | use it in TDM (`drawsSlabPets` also true for `team-deathmatch`) | `drawsSlabPets`; EntityViews (TDM must draw `createCharacter`); sharing (left-over pets) |
| 6 | `main.ts` does not hand EntityViews the mode | the main.ts wiring |
| 7 | dispose frees the shared geometry at the first release | sharing and dispose |
| 8 | a number drifts (GAP 0.15 → 0.12) | the pet_model.gd constants |
| 9 | a primitive on the wrong surface (the corgi's bib in `coat`) | `_corgi()` calls and surfaces |
| 10 | the pattern follows the species, not the team | the team pattern |
| 11 | the model does not face the aim yaw | over time; EntityViews (running sideways); sharing |
| 12 | the pet stays visible while dead | over time; EntityViews; sharing |
| 13 | the rifle pitch clamp drifts (0.9 → 1.2) | the pet.gd parse |
| 14 | the plate loses its self-light | the built materials |
| 15 | a raw three `MeshStandardMaterial` on the body | one mesh / style factory only; team colours; EntityViews; sharing |
| 16 | an extra draw (a second body mesh) | one mesh, 7 draws; EntityViews; sharing |
| 17 | the plate's triplanar loses Godot's y flip | the plate's triplanar v |
| 18 | the cat's tail is not an S (`0.12 sin` → `0`) | `_cat()` numbers; the silhouettes |
| 19 | the fur mean is not applied to the coat | the built materials |
| 20 | the team paint loses its self-light | the built materials; team colours |

All 20 are killed, and the unmutated copy passes. The first run had **one survivor**: changing the measured means
themselves (`furMean: [1, 1]`) passed, because the test read the same constant. The texture pin closes it. The
unmutated copy passes 21/21, and both of these fail 1 of 21:

| # | Mutant | Fails |
|---|---|---|
| 21 | `PET_LOOK.furMean` → `[1, 1]` (the former survivor) | the texture pin: "PET_LOOK.furMean is not the measured fur mean: expected [1, 1] to deeply equal [0.7424, 0.5082]" |
| 22 | a one-character edit inside Godot's `_fur` (`var strand := 0.85` → `0.86`, in the scratch copy's `pet_materials.gd`) | the texture pin: "re-measure the fur/wear means: <the command>", sha256 `33bd1425…` expected, `e936c8ef…` received |

**PARITY P3d.** The fresh confirm found three mutants that survived the 21-test file. The unmutated file now passes
23/23, each of the three fails, and mutants 1–20 still all fail (rerun on the 23-test file):

| # | Mutant | Fails |
|---|---|---|
| MB | the rifle on the root (`root.add(rifle)`) | over time: "the rifle hides while dead: expected true to be false"; EntityViews and sharing (left-over pets) |
| MA | the prism apex flipped (`A = [-w, h], B = [w, h], C = [0, -h]`) | Godot's boxes: "0_0 ear_l [0]: twin −0.3143, Godot −0.2018"; the prisms: "the ear narrows to its tip: expected 0.178 to be less than 0.06" |
| ME | `Kit.segment` length + 2r (`a.distanceTo(b) + 2 * radius`) | Godot's boxes: "0_0 neck [1]: twin 0.2286, Godot 0.3504" |

## 5. The 30 m check (QA-30M's tool, unchanged)

```
node tools/aaa-30m.mjs run --tree <S>/aaa30m-pets/tree --out <S>/aaa30m-pets \
  --baseline <S>/qa30m/base --godot <S>/pglb1/Godot_v4.7.2-stable_linux.x86_64          # exit 0
```

`S` is `/tmp/claude-0/-home-user/4eb0b9e5-129d-5c0b-ac58-7a3e7a57c134/scratchpad`.

**The tree.** `<S>/aaa30m-pets/tree` is the QA-30M baseline archive of `f7f45b5`, with its Godot import and the shared
`node_modules` link, plus only:
- this lane's three source files (sha256 in `<S>/twpets/tree-hashes.txt`, equal to the shared tree's);
- a two-part patch to its **copy** of `labs/lineup.ts` (`<S>/twpets/lineup-lab.diff`, 13 lines).

`--tree` was used, not `--sha`: no commit holds this state, and the tool's SHA stamp would have been a lie.

**QA-30M adopted the lab patch** (landed `labs/lineup.ts` :72-74, :122, :172-174), with one change: the mode is passed as a typed variable, not an object literal (AAA-30M.md, "After TW-PETS").
1. The lab plays the slab twin's mode: `new EntityViews(scene, { …, mode: () => 'slab' })`. Without it, the lab draws
   the K2 kits that no slab match draws any more.
2. The matte reads a slab pet's groups (`mesh.userData.petSurfaces`): the body's plate and band are armour, its coat is
   coat, and everything else (accent, dark, the whole rifle) is the rest. This is Godot's matte, `aaa-30m.mjs`
   827–838.

The matte fitted the frame in every crop.

### Verdicts

| Config | Teams ΔE colour / ΔL\* grey / ΔE deutan / ΔE protan (face · side · horizon) | Lowest edge \|ΔL\*\| (4 images) | Species 1:1 | Verdict | Baseline |
|---|---|---|---|---|---|
| Godot Compatibility | 74.9/36.2/61.0/55.9 · 66.0/32.7/54.6/50.2 · 66.1/36.3/50.6/48.7 | 26.5 (Cat, face, protan) | reads | **PASS** | PASS (same numbers) |
| Godot Forward+ | 58.1/27.8/52.4/47.6 · 54.7/24.9/51.0/46.1 · 57.7/30.0/50.7/46.4 | **14.5** (Cat, face, deutan; colour and grey 14.7) | reads | **FAIL** | FAIL (14.7 / 14.7 / 14.4: within the noise floor, its own background) |
| twin WebGL | 57.3/20.9/47.2/40.3 · 58.2/20.5/49.4/42.1 · 62.9/26.7/51.7/45.4 | 23.2 (Cat, face, protan) | reads | **PASS** | FAIL (19.5/8.0/12.1/11.1 · 17.4/9.0/8.1/11.4 · 26.7/17.2/15.9/20.5) |
| twin WebGPU high | 57.0/20.9/47.0/40.1 · 58.2/20.5/49.4/42.1 · 62.9/26.7/51.7/45.4 | 22.7 (Cat, face, protan) | reads | **PASS** | FAIL (19.4/7.2/12.4/10.8 · 17.2/8.9/8.0/11.4 · 26.7/17.2/15.9/20.5) |

**Regression vs `<S>/qa30m/base`:** none. The views are unchanged (every camera and pet within 5 cm).

**Twin per pet (WebGL; WebGPU within 0.4).**

| View | Pet | Armour px | Armour L\*/C\* | Coat L\*/C\* | Edge colour / grey / deutan / protan |
|---|---|---|---|---|---|
| face | Corgi Company | 48 of 120 (40%) | 61/32 | 53/35 | 27.7 / 27.7 / 27.9 / 27.6 |
| face | Cat Cadre | 34 of 87 (39%) | 40/43 | 63/5 | 23.5 / 23.5 / 23.9 / 23.2 |
| side | Corgi Company | 95 of 211 (45%) | 60/31 | 54/36 | 30.4 / 30.4 / 30.9 / 30.1 |
| side | Cat Cadre | 55 of 111 (50%) | 40/41 | 63/5 | 24.8 / 24.8 / 25.4 / 23.7 |
| horizon | Corgi Company | 103 of 199 (52%) | 60/31 | 48/28 | 42.3 / 42.3 / 43.2 / 41.0 |
| horizon | Cat Cadre | 53 of 129 (41%) | 33/39 | 60/1 | 41.2 / 41.2 / 42.2 / 39.6 |

The armour pixel counts are Godot Compatibility's to within 2 px in every view (Godot: 47/118, 34/88, 95/210, 56/113,
103/199, 54/130). The pets cover the same pixels from the same camera.

**Species, by eye from `aaa30m-crops-4x.jpg`.** In every twin view, as in Godot:
- head on: the tan corgi with two big upright ears over a blue vest and shield; the grey cat with its S-tail rising as a
  column above its head and a crimson vest;
- side on and on the horizon: the long, low corgi with its stub tail against the leggy cat with its S-tail.

The human's own pet now shows from behind in the foreground of the twin frames (big ears, blue vest), as in Godot's.

The full numbers are in `<S>/aaa30m-pets/results.md`, and the sheets in `<S>/aaa30m-pets/sheets/`.

## 6. Shots (all looked at)

| Shot | What it shows |
|---|---|
| `<S>/aaa30m-pets/sheets/aaa30m-crops-4x.jpg` | Godot Compatibility, Godot Forward+, twin WebGL and twin WebGPU, face / side / horizon at 4x, each beside its matte: the same pets in all four |
| `<S>/aaa30m-pets/sheets/aaa30m-face-1x.jpg`, `-side-1x.jpg`, `-horizon-1x.jpg` | 1:1 crops, all four configs |
| `<S>/aaa30m-pets/sheets/aaa30m-gray-cvd-face.jpg` | Colour, greyscale, deuteranopia and protanopia. The blue stays light and blue; the crimson goes dark (olive in the CVD views), as in Godot |
| `<S>/twpets/shot-1v1-slabcam-{0,1,2}.png` and `-crop4x.png` | **1 v 1** in the twin: `?mode=slab&webgl&autoplay&cam=slab&slabWin=999&slabTime=900` (Godot's slab spectator orbit). The Cat Cadre bot holds the slab, read at 4x: pointed ears, grey legs, S-tail, crimson barding, the dark rifle. The local corgi stays at its spawn (autoplay does not move the human) |
| `<S>/twpets/shot-2v2-slabcam-{0..3}.png`, `shot-2v2-crops3x.png` | **2 v 2** (`&2v2`): both Cat Cadre cats on the slab in a firefight, with tracers and muzzle flashes from the pets' `muzzleWorld`. The feed shows "Cat 4 > Pup 1": the Corgi bot is down or on its way back in every slab frame, so no corgi is on the slab in these |
| `<S>/twpets/shot-2v2-follow-0.png` | **2 v 2**, the follow camera at the start: my corgi from behind. Blue barding with its dark rear rim, tan haunches, white socks, stub tail, upright ears, the rifle on the right side |
| `<S>/twpets/probe-1v1-follow.png` | The first look (`tools/probe.mjs '?mode=slab&webgl&autoplay' 90`), before the texture means, under the winner screen's dim |

Godot's references: `docs/qa/w14/read3-crops-3x.jpg`, `read3-bots-compat-before-after.jpg`.

## 7. Notes for the lead

- **QA-30M's lab** already carries the section 5 patch in the landing set (AAA-30M.md "After TW-PETS"); nothing is left to apply. `<S>/twpets/lineup-lab.diff` is history only.
- **`ARCHITECTURE.md`** (views): the line could read `views/ Avatar contract, entity-views (entity → avatar;
  slab-pet.ts: the slab match's Godot PLACEHOLDER pets), nameplates`. This was not edited; the file is the lead's.
- **The measured texture means** are the one Godot-derived number CI cannot re-derive. The source hash catches an edit
  to the noise code, but not a Godot engine change to FastNoiseLite itself.
