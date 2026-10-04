# TW-LOOK (W13): the web takes the Godot look; the ink and HARDENED are retired

**Card.** Retire the ink outlines and the HARDENED comic look on the web. The web look becomes the locked Wave 12
stylised-realistic night of the Godot build: wet asphalt, a muted night, sodium floodlight glints, and readable
separation between coat, armour plate and rifle metal. No new ink anywhere. The design doc is
`docs/design/LOOK.md`; `docs/design/HARDENED.md` now carries a "retired" banner.

**Base.** HEAD `71d05d5`. Nothing staged or committed. The proof ran in a private copy (`git archive HEAD` plus the
files below) on private vite servers: :5191 = HEAD, :5192 = this lane.

## Files (all owned by this lane)

| Path | What |
|---|---|
| `src/client/style/style-webgpu.js` | Rewritten; keeps the API, see below |
| `src/client/style/style-tokens.js` | The Godot night values (marked `[godot]`) |
| `src/client/style/style-utils.js` | Ramp helpers removed; `smoothNormalsByPosition(…, angleDeg?)` |
| `src/client/style/floodlights.js` | Sodium colour, Godot's falloff (decay 0.9), real-light-only pools |
| `src/client/world/sky.ts` | The locked night sky, fog and rig |
| `src/client/world/materials.ts` | Terrain = Godot's wet paved asphalt; world materials from the factory |
| `src/client/world/world-palette.ts` | Comments only, plus `sodium` |
| `tests/unit/style-look.test.ts` | **New**; replaces `tests/unit/style-hardened.test.ts`, which is **deleted** |
| `tests/unit/style-p4.test.ts` | Updated to the new look |
| `tests/unit/style-p5.test.ts` | Updated to the new look |
| `tests/unit/render-budget.test.ts` | Updated: these tests asserted the old ink hull counts |
| `tests/unit/cosmetics-looks.test.ts` | Updated: these tests required crease ink on rigid meshes |
| `docs/design/LOOK.md` | **New** |
| `docs/design/HARDENED.md` | Banner only |
| `docs/handoff/TW-LOOK.md` | **New**, this file |

## What changed

**Pipeline.** `buildComicOutput` / `createComicPipeline` are now aliases of `buildStyleOutput` /
`createStylePipeline`:
- one `StyleScenePass` (a `PassNode` subclass, with no outline pass);
- bloom on emissives only (threshold 1.3, strength 0.7);
- `× STYLE_EXPOSURE`, then AgX at 1.5;
- Godot's grade: contrast 1.06, saturation 0.85, and the per-channel colour-correction curve. Team-hue and chroma
  protection is kept.

`uniforms.thickness` / `uniforms.inkFar` are 0. They exist only because `engine/renderer.ts` `installInkLod` still
reads them.

**Materials.**
- `toon()` / `toonMaterial()` return a `StyleMaterial`, a `MeshStandardNodeMaterial` lit by `StyleLightingModel`
  (three's physical model).
  - It adds a sky reflection; the moon and the fill light add no specular; the interiors keep working; the character
    rim and fill now keep the albedo's own hue.
  - The weathering masks are kept. The night's wetness never drops below `STYLE.wet.floor` (0.75), so the Lot reads
    wet in its dry first minute.
  - New hooks: `puddleNode`. `roughnessNode` and `wetNode` keep their meaning.
  - The tags `'toon'` and `'toon-noink'` are kept as the factory family names. Nothing is a toon material any more.
- `addCreaseInk()` returns `null` and adds nothing.
- `stylize()` adds no ink and leaves normals alone.
- `pbr()` uses the same lighting model and the `kit_wet` wet rules.

**Terrain.** Trodden ground (dirt, mulch, gravel, mud, scorch) is Godot's `wet_ground` asphalt:
- binder and aggregate, paving lanes with tar joints, patch repairs, warped cellular cracks, grit on slopes;
- the palette colour shades it by luminance only;
- wet film roughness 0.3–0.45, puddles at 0.03 with F0 ×1.8, a damp rim, rain ripples.

Lawn stays lawn.

## Godot values copied (from `engines/godot/look/`, working tree re-checked at 03:35, mid-G-ATMOS)

**From `look.gd`:**

| Setting | Value |
|---|---|
| SODIUM | (1.0, 0.62, 0.28) → `0xff9e47` |
| MOON_DIR | (-0.4, 0.55, -0.73) |
| MOON_COLOR | (0.62, 0.72, 0.95) |
| Moon energy | 0.5 |
| FLOOD_ENERGY | 38 |
| Flood spot | 32°, angle attenuation 1.6, attenuation 0.9 |
| Ambient | colour (0.2, 0.25, 0.36), sky contribution 0.5, energy 1.6 |
| Tone map | AgX, exposure 1.5 (Godot's AgX contrast 1.3 has no three.js knob) |
| Glow | threshold 1.3, intensity 0.7 |
| Fog | horizon colour (0.11, 0.13, 0.17), density 0.0045, sky affect 0.15, aerial 0.3, height 1, height density 0.03 |
| Grade | contrast 1.06, saturation 0.85, curve keys 0 / 0.22 / 0.6 / 1 |
| WET_DARKEN / WET_ROUGH | 0.7 / 0.55 |

**From `night_sky.gdshader`:**

| Setting | Value |
|---|---|
| zenith | (0.03, 0.042, 0.08) |
| horizon | (0.11, 0.13, 0.17) |
| cloud_lit | (0.17, 0.19, 0.24) |
| cloud_dark | (0.045, 0.055, 0.08) |
| moon | (0.82, 0.87, 1.0) ×3 |
| stars | (0.75, 0.8, 0.95) ×0.6 |
| cover | 0.74 |

**From `wet_ground.gdshader`:**

| Setting | Value |
|---|---|
| asphalt dark / light | 0.17 / 0.3 |
| aggregate | 0.4 |
| tar | 0.025 |
| Scales | grain 9, aggregate 0.8, crack 26 |
| Panel | 4.5 × 14, joint 0.08 |
| Puddles | scale 24, cut 0.6, roughness 0.03 |
| Roughness | wet 0.3–0.45, slope 0.62, slope albedo ×0.55 |
| detail_strength | 0.35 |
| Vertex-colour mix | 0.3 (luminance) |
| Darkening | wet ×0.7, damp ×0.8, puddle ×0.6 |

**From `pet_materials.gd`:**

| Material | Value |
|---|---|
| coat | roughness 0.42 |
| plate | roughness 0.38, metal 0.1, clearcoat 0.12 |
| rifle | roughness 0.32, metal 0.9 |

G-ATMOS was still changing these files while I worked. Re-diff them before integrating.

## Follow-up (lead, W13): the retired ink costs nothing, no comic words, The Lot-only asphalt

**Ink removed.**
- `engine/renderer.ts`: `installInkLod` and the ink helpers are gone. `outputNodesOf().withoutBloom` now keeps
  `STYLE_EXPOSURE`. `buildStyleOutput` no longer returns `uniforms`, and `STYLE.crease` is down to `angleDeg`.
- Crease line sets are deleted from:
  - `world/prim-mesh.ts` (`creaseEdges`, `creaseTiles`, `inkMaterial`, `CREASE_DRAW_DISTANCE`, `Builder.lines`);
  - `world/destruct-view.ts` (`setCreases` stays as a no-op for world-view);
  - `vehicles/parts.ts` (`PartBuilder` collects no lines) and the four vehicle models;
  - `vehicles/index.ts`, `interact/views.ts` + `models.ts`, `abilities/views.ts` + `models.ts`.
- `tools/char-audit.mjs` now flags any ink line instead of requiring one.

**Normals.** `prim-mesh` `primGeometry(p)` no longer smooths for the hull: boxes, cylinders and cones keep hard edges
(welded within the crease angle). `PartBuilder` does the same.

**`tintWater`** now takes `THREE.NodeMaterial`, and `createWaterMaterial` returns `WorldMaterial`.

**Comic words.** The onomatopoeia billboards are gone: `fx/onomatopoeia.ts`, `onomatopoeia-view.ts` and their test
are deleted, and `fx/index.ts` no longer pops words (fx now makes at most 3 draws). Hit sparks, splats, the kill feed
and damage feedback stay.

**Ground.** `createTerrainMaterial({ ground })`: `'asphalt'` (The Lot) or `'yard'` (the default; West Yard dirt stays
dirt). The one line outside the owned list is in `world-view.ts`, which passes
`ground: data.map === 'the_lot' ? 'asphalt' : 'yard'`.

**Tests updated:** `render-budget`, `destruct-view`, `vehicle-views`, `lot-world`, `style-look`.

**Draws, The Lot:**
- Static count: props went from 36 meshes + 86 crease line sets (11,532 segments, about 69 k triangles) to 36 + 0. On
  the West Yard: 83 sets (27,994 segments) → 0.
- Live, `labs/lot.html?bm=lot_corgi_base&wx=rain`: 155 draws and 272,941 triangles at HEAD; 146 draws and 245,357
  triangles now.

## INK-DEAD (lead, W13): the dead ink code removed

These are now gone:
- `tools/perf-render.mjs` hull counting;
- `QualityProfile.propCreases` and `.outlines`, world-view's `setPropCreases` / `destruct.setCreases`, and
  `DestructView.setCreases`;
- the `weaponInk` / `keepInk` paths in `procgen/characters/index.ts` and `boss/sniper.ts`, and `addCreaseInk` itself;
- the labs' `inkMinPx` / `inkmin`, `HardenedToonMaterial` (now `StyleMaterial`), and the `addCreaseInk` calls in
  `labs/weapons.ts`;
- the test assertions that only existed for them (quality-tiers, render-budget, boss-avatar, characters, vehicle-views,
  style-look).

The look and the draws are unchanged.

## NEED (outside this lane)
1. The particle SDF rims (`fx/particle-mesh.ts`, `decal-mesh.ts`) are the FX lane's call.
2. The card's URL `?map=the-lot` falls back to the West Yard. The map id is `the_lot`.

## Proof (private copy = HEAD + these files)

**Tests.**
- `CI=1 npx vitest run`, one full run: 139 of 143 files passed, 1222 of 1230 tests passed, 4 failed.
- All 4 failures are sim timing budgets under load 20–30, in files that import none of this lane's code:
  - ai p95 2.19 ms (budget 1.5);
  - interact-yard 0.085 ms (budget 0.08);
  - vehicles-yard 1.37 ms (budget 1.2);
  - a match test that timed out.
- At idle, HEAD fails the ai budget the same way (p95 3.78 ms).
- The style tests pass (44).
- `npx tsc --noEmit`: clean.

**Shots.** Taken with `tools/probe.mjs` on a private vite server; my copy only raises the screenshot timeout, because
frames took 7–50 s here.
- `?map=the_lot&webgl&autoplay` at 300 s, and `?webgl&autoplay` (the West Yard). Console: no errors.
- `labs/lot.html?bm=lot_corgi_base&wx=rain&webgl&hud=0`: the Godot base bookmark, HEAD against this lane. The only
  console error is the lab's `/favicon.ico` 404, which HEAD shows too.
- I looked at every shot. There are no ink lines. The ground reads as wet asphalt, with sodium pools and glints in the
  puddles.

Files: `docs/qa/w13/web-noink-lot.jpg`, `web-noink-yard.jpg`, `web-look-lot-before-after.jpg` (top row: the lab at
the bookmark; bottom row: autoplay).

## W15 (coordinator): the last comic FX retired on the web twin
The look lock is stylised-realistic, so the takedown pop and the hit splat go. The change is global and as small as
it could be.

**Takedown.**
- `deathPoof` is gone. `takedownDust` (`fx/presets.ts`) replaces it: 8 wet-night smoke puffs, 6 dark grit chunks and
  6 fur tufts.
- The puffs swell then shrink out (HoldShrink, not Pop) and the grit falls back to the ground and bounces.
- The fur tufts stay.
- Gone: the white puffs, the Pop curve, the three glowing accentHot stars, the ink rims (param 0) and the halftone.
- New colours `smokeNight`, `smokeNightLight` and `grit`: 0x4b5057 ×0.18, 0x6b7076 ×0.16 and 0x2f2d2b ×0.2.
- The scale is low on purpose. Particles are unlit, and the night exposure lifts them hard. At ×0.9 the grey showed
  as 0xb7b5b2 on screen; it now shows as about 0x585c60 to 0x62666a (lab render, not the committed shot).

**Hits.**
- `comicSplat`, its `splat` and `splatHi` colours, and its call in `fx/index.ts` ('hit') are gone.
- The surface impacts are unchanged. `furHit` was changed in the patch round below.
- `Shape.Splat`, `Shape.Star` and `Curve.Pop` stay. Their other callers: the hairball goo, the respawn, pickup and
  ordnance sparkles, and `furHit`.

**Tests.**
- `fx-particles`: the takedown spawns no glow and only Puff, Chunk and Tuft (never Star). The dust and grit are
  dark, near-neutral greys (max < 0.12, spread < 0.02). No particle has a rim or halftone. The recipe source has no
  `Shape.Star`, `Curve.Pop`, `p.glow`, `C.white` or `Fade.Soft`. `deathPoof` is gone.
- `fx-weapons`: `comicSplat` is gone from the module and from `fx/index.ts`. The 'hit' case calls `P.furHit` only.
- Mutation check: putting a Star back in the takedown, or a second recipe call in 'hit', fails both tests.

**Shot.** `docs/qa/w15/fx-takedown-web.jpg` is tw-view's live `?mode=slab&webgl&slabHurt` killing hit (tick 3842,
FX age 0.200 s; dust measured rgb(62,55,62)-(71,67,78)); see TW-VIEW.md. The first-round lab before/after is retired
and not in the repo.

### W15 patch round (lead: Sprint B check BLOCKER)
The killing hit sends 'hit' then 'death' in the same tick (`src/sim/combat/damage.ts`), so `furHit` still bloomed
comic FX over every rifle takedown.

**`furHit` (`fx/presets.ts`).**
- Removed:
  - the white stuffing puffs, which used Curve.Pop and ink;
  - the four gold Pop Stars on a crit.
- Changed:
  - the tufts and the team chunk now have param 0 (no ink);
  - the impact flash is a soft `Shape.Glow`, not a spiky `Shape.Burst`.
- `C.stuffing` is deleted; nothing else used it.

**Night scale.** Coat and team solids on both the hit and the takedown now carry `FUR_NIGHT` = ×0.35. At full
strength the cat's grey tufts showed as #c6c6c0, near white. The lead asked for this on the takedown tufts; I applied
it to the hit's tufts and team chunk too, because the cap test covers every particle.

**Test.** A new test in `fx-particles` spawns `furHit` and `takedownDust` into one fresh pool, for cat and corgi,
crit and plain, at two densities. For every particle it checks:
- the shape is not Star, Burst or Splat;
- `misc.z` is 0;
- the pool's curve field is never Pop (the field index is proven first);
- the solids are opaque;
- tufts stay at or under 0.21 for a cat and 0.32 for a corgi, and other solids at or under 0.3;
- the only glow is a single `Shape.Glow`.

**Mutant checks.** Each of these fails the test: a Star put back in `furHit`; the stuffing loop (it fails on ink,
and on Pop alone with param 0); white takedown tufts; full-strength hit tufts; Burst instead of Glow; the team
chunk inked.

**Wording.** The `presets-weapons` header, the `fx-weapons` test title and LOOK.md now read: "fur tufts, one team
chunk and a soft glow; no ink, no Pop, no stars".

**Shot.** `docs/qa/w15/fx-takedown-web.jpg` is tw-view's live `?mode=slab&webgl&slabHurt` killing hit (tick 3842,
FX age 0.200 s; dust measured rgb(62,55,62)-(71,67,78)); see TW-VIEW.md.


## W15 Sprint D, item 13: the dead ink helpers and the comic leftovers (TW-LOOK)
HEAD b222e37. The look is stylised-realistic, so the twin now carries no ink, no halftone, no toon bands and no
comic death face. Nothing is committed.

**Removed, each with a grep showing no caller is left** (src, labs, tools, server):
- `buildComicOutput` and `createComicPipeline`, the comic-named aliases in `style/style-webgpu.js`.
  - Callers left: none. One comment in `world/world-view.ts:34` still names the second; that file is not mine.
- `capInkDistance` and the `inkfar` parameter in `labs/characters.ts`. This was the lab-only outline-pass patch; there
  is no outline pass any more. No callers left.
- The `userData.styleInk` checks in `labs/characters.ts` and `labs/look.ts`.
  - Nothing sets `styleInk`, so the checks were always false.
  - The lab copies are gone. Copies outside my paths stay, listed under NEED.
- Particles:
  - `Shape.Star` (3), `Shape.Burst` (6) and `Curve.Pop` (1) are gone, with their SDFs and the Pop size curve. The ids
    stay unused so the other ids keep their values.
  - The solid shader's ink rim (`INK`, the rim mix) is gone, along with the halftone screen-door (`screenCoordinate`
    dots), the two-tone toon crescent and the seven-lobe puff cutout.
  - `resetSpec`'s default ink width (0.2) is now 0. Every non-ring `S.param` is removed from the presets; param is
    ring thickness only.
- The dead pet's X eyes. The `xEyes` mesh group is gone from `procgen/characters/body.ts`, along with its `onEye`
  helper, and the rig line that scaled them in is gone from `anim/character-animator.ts`.

**What replaced the visible pieces:**
- **Solid particles.**
  - One draw, alpha-blended, depth-tested, with no depth write.
  - Puffs are soft, translucent blobs: alpha (1 − smoothstep(0, 1, r))^1.3 × 0.85.
  - Other solids keep a crisp edge with an anti-aliased band.
  - Colour is flat, with a soft top-lit gradient.
  - `Fade.Soft` is real alpha now.
- **Curves.** Every Pop is HoldShrink, growing from 40 % of its final size, in sprint, jump, land and world-hit dust
  and in the explosion fireballs.
- **Flashes.** The muzzle flash, the laser end, the weapon muzzle core and the metal-impact flash use `Shape.Glow`
  instead of Burst. The hairball fuse glint uses Glow instead of Star.
- **Respawn.** A soft team glow pooled on the ground plus six small rising glow motes. No ring, no stars.
- **Pickup.** Five soft gold motes rising.
- **Dead face** (`anim/face.ts`). The lids shut (lidUp 1, lidLo 0.6), the jaw is slack at 0.12, the ears are down and
  the tongue stays in. The eyeballs are no longer hidden on death; the lids cover them.

**Tests.**
- In `fx-particles`:
  - **The vocabulary.** Shape has no Star or Burst, Curve has no Pop, and the default param is 0.
  - **Every exported recipe, run for real.** That is 29 recipes across `presets`, `presets-weapons` and
    `presets-ordnance`, with every gun, surface, species, team and crit. Nothing may spawn a retired shape or a curve
    outside {Linear, HoldShrink}, and no solid except a ring may carry a param.
  - **Coverage.** A recipe that is exported but not in the list fails the test.
  - **Respawn and pickup.** They spawn Glow only.
  - **The particle shader.** Its source has no ink colour, halftone, crescent, lobed puff, star or burst SDF. The
    solid material is transparent, with no depth write, normal blending and an opacity node.
- New file, `tests/unit/style-no-comic.test.ts`:
  - no comic-, ink-, outline-, crease- or halftone-named style export;
  - no ink experiment, `inkfar`, `styleInk` or comic wording in `labs/*.ts`;
  - a dead face (both species) has its tongue in, its lids shut and no smile;
  - no vertex of a built pet (corgi and cat, hero and NPC) is skinned to the `xEyes` joint;
  - the animator never names `b.xEyes`.
- `style-look`: the alias assertions are removed.
- **Mutant checks.** 16 mutants, each run against its test, and each one fails it:
  - in the shader: ink colour back, halftone back, crescent back, lobed puff back, solids opaque again;
  - in the presets: default param 0.2, Star in respawn, Burst in the muzzle flash, Pop on sprint dust, ink on grass
    tufts, the respawn ring;
  - elsewhere: the style alias, the lab ink experiment, the lab `styleInk` check, the X eyes, the tongue on death.

**Shots.** They are in `docs/qa/w15/deadink-web-*.jpg`, each a 1200 × 675 frame over a ×2 zoom of the effect. I
looked at each one.
- They come from a private copy on vite port 5180, which I stopped by PID, at
  `?mode=slab&webgl&autoplay&slabHurt&slabWin=999&slabTime=3600`.
- The harness is a private Playwright init script and is not in the tree. It holds the worker's messages and steps the
  page clock 1/60 s per frame while each 1280 × 720 frame renders. Between shots the page draws at 320 × 180.
- Page time held per shot: run 0.117 s, takedown 0.100 s, respawn 0.117 s.
- `run`: Shift+W sprint dust, a small soft translucent puff.
- `takedown`: the death panel. There is translucent dark dust, grit chunks and coat-scaled tufts; no stars, no white
  pop and no ink.
- `respawn`: the soft blue ground glow and motes.
- `dead-face`: `labs/characters.html?view=portrait&anim=death&t=1.5`, cat and corgi. The lids are shut, with no X
  eyes and no tongue.

### Item 13 follow-up (lead): the rest of the dead ink helpers
HEAD 54a0abf. The lead handed me these files for this card.

**Deleted:**
- The dead `userData.styleInk` checks, in:
  - `procgen/characters/silhouette.ts`;
  - `procgen/cosmetics/readability.ts`;
  - `camera/third-person.ts`;
  - the `abilities-views` and `vehicle-views` tests (only the dead `LineSegments2 → styleInk` line; the real style
    assertions stay).
- The `xEyes` bone in `procgen/characters/skeleton.ts` (name, parent, rest). The template is now 46 bones. Nothing
  read the bone: the mesh and the rig line were already gone.
- The `creases` and `creaseDeg` options of `stylize()`, which were never honoured. They are gone from its JSDoc type and
  from its callers: `adventure/views.ts` (two calls), `assets/kit-glb.ts`, the `glb-validate` test and the
  `style-look` test. TypeScript now rejects them (allowJs).

**Fixed:** the `world/world-view.ts:34` comment now names `createStylePipeline`.

**Grep proof.** `styleInk`, `createComicPipeline`, `buildComicOutput`, `xEyes`, `creases` and `creaseDeg` have no
hits in src, labs, tools or tests outside the guarding test. The only other matches are "increases" and "decreases".

**Tests.** `style-no-comic`:
- **The scan.** It reads every .ts, .js and .mjs file under src, labs and tests (except itself). It fails on
  `styleInk`, `createComicPipeline` or `buildComicOutput`.
- **The bones.** `xEyes` is in neither `BONE_NAMES` nor any built pet's skeleton.

**Mutants.** There are 8, and each one fails its test:
- a `styleInk` check back in silhouette, readability or third-person;
- the dead branch back in either view test;
- the comic alias back in the world-view comment;
- the `xEyes` bone back;
- `creases: false` back at a `stylize()` caller (tsc TS2353).

### Item 13: the verifier's CONDITIONAL fixes
HEAD 54a0abf plus the Sprint D working tree.

1. **Sort order (the blocker).**
   - Solids are alpha-blended now, so `renderOrder` 1 drew them before the water (2) and the blob shadows (2), which
     then painted over them.
   - `PARTICLE_RENDER_ORDER` in `fx/particle-mesh.ts` is now solid 3.5 and glow 5. Solids draw after the water,
     the blob shadows and the floodlight pools (3), and before the rain sheet (4) and the glows.
   - Test: it builds The Lot's real water view, `EntityViews`' `blob_shadows` and the floodlight pools, and checks that
     solids draw above each of them and below the glows. Setting the order back to 1, by the constant or by a literal at
     the mesh, fails the test.
2. **Drops.**
   - New `Shape.Drop` (12): the same disc as a Puff, but drawn crisp; only shape 0 gets the soft puff alpha.
   - These use it: the water spray, the water-impact splash drops, the hairball goo drip and the soil spray column.
     The soil spray is now a crisp clod; a lobed `Splat` read as a little flower.
   - Test: those recipes spawn Drop, and the water impact's only soft Puff is its mist. Mutants that put the spray or
     the impact drops back on Puff, or that change the `isPuff` line, fail it. The soft-alpha check matches only that
     one source line: a second path that draws Drop soft (for example
     `select(isPuff.or(aCol.w.greaterThan(11.5)), soft, crisp)`) passes every test (confirm round, mutant G2).
3. **Guard gaps.** The shader test now walks the built node graph instead of the source.
   - The solid colour graph may only contain the particle colour, the uv gradient, mix, smoothstep, arithmetic and
     scalar constants. A term that reads the shape's distance node, a constant colour, a select or a
     uniform fails. A darkening edge rebuilt from uv arithmetic (a smoothstep of p.x² + p.y²) is not caught (mutant G3).
   - The opacity and mask graphs may not contain a `ScreenNode`, `fract`, `mod` or `%`. A dither or halftone built
     from the view position (`positionView` with `sin`, or `x − floor(x)`) is not caught (mutants G4, G4b).
   - The verifier's M2 and M4 now fail, and so do a darkened-fill rim with no colour constant and a `screenUV` + `fract`
     opacity halftone.
   - **M5.** A direct test: no vertex with luminance < 0.05 is skinned to an eye, socket or lid bone. The darkest real
     ones are the irises, above 0.1. The verifier's mutant, X bars on `eye.L` and `eye.R`, fails it.
4. **Stale text.** `ARCHITECTURE.md:101` now says "skeleton (46 bones)". The takedown note in `fx/presets.ts` now says
   the puffs are soft and translucent, peaking at alpha 0.85.
5. **Dead-face shot.** `docs/qa/w15/deadink-web-dead-face.jpg` is retaken as before (HEAD) over after, in
   `labs/characters.html?view=portrait&anim=death&t=1.5&bare=1`.
   - The cameras were found from the dead pose's head and eye bones: over the head at `cam=-0.71,0.72,0.90`, and on
     the chin side at `cam=-0.03,0.70,0.38`.
   - Before: the X eyes on the corgi and the cat, and the corgi's pink tongue out.
   - After: lids shut, no X, mouth shut, no tongue. I looked at it.
   - Sort and drops: `docs/qa/w15/deadink-web-sort-drops.jpg` comes from a private lab in the proof copy, a version of
     the verifier's `vsort`. It shows the shipped order against renderOrder 1, and Drop against Puff, over the real
     water material and a blob-shadow disc.

**Known limit.** All solid particles are one alpha-blended draw that writes no depth. Inside that draw, overlapping
particles are not depth-sorted: the pool swap-removes dead slots, so the draw order is spawn order. A far chunk can
draw over a nearer puff. At these sizes and lifetimes I have not seen it read wrong. Sorting per frame would cost CPU
on the hot path, so I left it. Solids also write no depth. So a later transparent layer that lies behind a particle
paints over it: the rain sheet and the adventure sentry cones (4) and the floodlight halos (5). Before Sprint D the
opaque solids hid them. The draw-order test checks that solids are above the water, the blob shadows and the pools and
below the glows. The order relative to the rain sheet is not tested.

**Proof.** All of it ran in a private copy of HEAD 54a0abf plus every working-tree change, including other lanes' files.
- tsc and boundaries pass.
- 225 tests in 21 files pass: the fx, style, render-budget, ordnance-client, lot-atmosphere, view, glb and character
  tests.
- Mutants: the 10 new ones plus the earlier 16 and 8 were all re-run, and all 34 fail their test. The private copy was
  restored after each one.
