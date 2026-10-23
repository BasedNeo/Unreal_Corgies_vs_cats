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

## W15 Sprint D, item 11 (web half): the cover read on the twin

The full report is `docs/qa/w15/COVER.md`, section "Web". HEAD 54a0abf plus every working-tree file. Nothing is
committed.

**Code.**
- `style-tokens.js`: `STYLE.cover`.
  - Floor, ceil, power 3 and the moon colour are Godot's. The test parses them from `look.gd` and `kit_wet.gdshader`.
  - Fill 0.15 and sheen 0.25 are the web's.
  - No dim. Godot dropped its 0.6, and the twin followed (see "the DO NOT LAND fixes" below).
- `style-webgpu.js`: `pbr({ coverTop, coverBase })` puts Godot's `kit_wet.gdshader` rule on a kit material.
  - On the cover zone, the emission gets a fill of the luminance-held albedo plus the moon sheen.
  - The albedo is left as it was, on and off the zone. The mast pole and the lamp heads stay dark lines because
    nothing lights them, not because of a dim.
  - New exports: `STYLE_COVER` (the uniforms: on, fill, sheen), `setCoverRead()`, `coverPeakLuminance()`,
    `COVER_ALL` and `PBR_COVER_BASE`.
- `kit-glb.ts`:
  - `KitPiece.cover`: all for Container20, BagWall, Pipe and Footing; 1.25 m for the FloodMast; 0 for the FloodLamp.
  - `kitPbrOpts()`.
  - A `coverBase` per-vertex float on the FloodMast batch, so its zone is measured from each foot.

**Tests.** `tests/unit/kit-cover.test.ts`:
- **The cover set.** It recomputes Godot's `cover_table` from the shared colliders and the master GLBs' LOD0 bounds,
  and checks it against `KitPiece.cover`.
- **The material terms:**
  - the values;
  - fill and sheen only on cover pieces, and the emission really reads `STYLE_COVER`;
  - the mast's zone measured from the foot;
  - the lamp left as it was (no emission, and the same colour as without the cover read);
  - the knobs start at the tokens;
  - the peak emission × exposure stays under the bloom threshold;
  - the A/B switch adds no material.
- **Mutants, first pass (7), each of which fails the test.** The verification then found 8 of its 10 surviving. The
  current list is under "the DO NOT LAND fixes" below.
  - the mast marked as cover;
  - the lamps marked as cover;
  - the fill off (token 0);
  - the emission over the bloom threshold (fill 8);
  - the fill dropped from the material while the token stays;
  - the mast zone not read from the foot;
  - a non-cover piece that glows.

**Metric.** `labs/cover.html` and `labs/cover-metric.mjs` run Godot's measure on the web: the same samples, play
camera, turn search, masks, edge read and value gap. The worst cover read goes from 3.0 (15 of 23 views under the bar)
to 17.2 (none under). The minimum value gap goes from −0.1 to 24.7 (24.4 after the dim drop; see below). Draws are
identical in every view (2106 → 2106).

**Why not Godot's 0.45 / 0.30?** On the web they also hold the bar (worst 22.0), but they turn the containers and
pipes near-white (L\* 51–54). I swept nine pairs. 0.15 / 0.25 is the darkest that keeps about 2 L\* of margin
(L\* 35–40 bodies).

**Shots.** `docs/qa/w15/cover-web-{corgi-base,cat-base,west-lane,east-lane}.jpg` each show three panels: before,
Godot's values on the web, and the web's values. I looked at each.

**Open.**
- The concrete pipes lose their moonlit blue: chroma C\* 14 → 5. A fill tinted toward the moon colour would keep it.
  That is a rule change, so it is Godot's call first.
- The `stylize` (toon) A/B path of the kit carries no cover read.

### Item 11: the DO NOT LAND fixes (lead, after the verification)

Base: a fresh copy of HEAD 7a671f1 plus every working-tree file. Nothing is committed.

**The dim is gone (lead-approved, to match Godot).**
- g-atmos dropped Godot's non-cover dim (albedo × 0.6) because it had no measurable effect.
- On the web it had kept the mast pole 0.1–0.6 L\* darker, against gaps of 24.4 or more.
- `STYLE.cover.dim` and `STYLE_COVER.dim` are removed. `colorNode` is the plain wet albedo, as Godot's
  `ALBEDO = wet_alb`. The lab and the metric no longer take a dim.
- The mast pole and the lamp heads stay dark lines because nothing lights them, not because of a dim.

**Back faces.**
- In `coverRead`, the graze now uses `normalViewGeometry.mul(faceDirection)`.
- The kit GLBs are double-sided here (all five cover masters), while Godot culls back faces. Before this fix, a wall
  seen from inside took the full sheen.
- No measured view moved by more than 0.1 L\*.

**The test sees the rule.** `tests/unit/kit-cover.test.ts` now does three things.
- **It parses Godot's shared terms from Godot's files:**
  - from `look.gd`: the cover table and the FloodMast's 1.25 m zone (`COVER`); floor, ceil and power on every
    renderer (`COVER_VALUES`); the moon colour (`COVER_SHEEN_COLOR`);
  - from `kit_wet.gdshader`: the luminance weights and the near-black window.
  - The fill and sheen gains are per renderer. They are not parsed or compared, because g-atmos is still tuning them.
- **It walks the FloodMast's built emissive graph** and checks:
  - a `step` whose first operand is `positionWorld.y − coverBase` and whose second is `KIT_FLOODMAST_COVER`, which
    equals `look.gd`'s value;
  - `STYLE_COVER.on`;
  - the clamp at [floor, ceil];
  - Godot's luminance weights and near-black window;
  - the power;
  - the moon colour (linear);
  - a `FrontFacingNode` under the power's operand.
- **It checks that neither side has a dim:**
  - no dim key in `COVER_VALUES`;
  - `_cover_params` sets none;
  - `kit_wet.gdshader` has no dim uniform and keeps `ALBEDO = wet_alb;`;
  - `STYLE.cover` and `STYLE_COVER` have no dim;
  - every kit piece's colour graph matches, node for node, the one it has without the cover read.

**Mutants (26).** Each was applied alone to a second fresh copy and run against `kit-cover.test.ts`. Every one fails
it (exit 1). The script is `scratchpad/i11-mut.py`.

| Mutant | Change | Caught by |
|---|---|---|
| M1 | `KIT_FLOODMAST_COVER` 1.25 → 0 | the cover set vs the colliders; no step in the emission |
| M1b | the step's second operand → 0 | the step's second operand is the zone's top |
| M1c | the step's operands swapped | the step's first operand is the foot-relative height |
| M2 | the luminance clamp removed | the clamp [floor, ceil] |
| M3 | the sheen power → 1 | the sheen power |
| M4, M4b | (the dim) | **N/A**: the dim was dropped to match Godot. It moved the pole ~0.4 L\* against a gap of ≥ 24.7. D1–D4 and GD1–GD4 replace them |
| M5 | the emission not masked to the zone | the emission is masked by the cover step; the zone from the foot |
| M6 | the sheen colour → sodium | the moon's colour (linear) |
| M7 | the clamp's ceil → 2.8 | the clamp [floor, ceil] |
| G1 | `look.gd` FloodMast 1.25 → 0.6 | the piece table vs `look.gd` `COVER` |
| G2 | `look.gd` Forward+ floor / ceil → 0.10 / 0.40 | floor vs `look.gd` |
| G2b | `look.gd` Forward+ power → 1.5 | power vs `look.gd` |
| G3 | `look.gd` moon → sodium | `sheenColor` vs `look.gd` |
| G4 | `kit_wet` luminance weights → Rec.601 | the luminance weights of `kit_wet.gdshader` |
| G5 | `kit_wet` near-black window 0.04 → 0.1 | the near-black window of `kit_wet.gdshader` |
| BF | back face: `.mul(faceDirection)` removed | the graze turns its normal to the viewer |
| T1 | token ceil → 2.8 | ceil vs `look.gd` |
| T2 | token power → 1 | power vs `look.gd` |
| T3 | token moon → sodium | `sheenColor` vs `look.gd`; the moon's colour in the graph |
| D1 | web: the dim back on the zone (`colorNode × mix(0.6, 1, cover)`) | the colour graph vs without the cover read |
| D2 | web: the dim back on the lamp (`colorNode × 0.6`) | the same, on the FloodLamp |
| D3 | web: `STYLE.cover.dim` back | `STYLE.cover` has no dim |
| D4 | web: `STYLE_COVER.dim` back | `STYLE_COVER` has no dim |
| GD1 | Godot: `"dim": 0.6` back in `COVER_VALUES` | `look.gd` `COVER_VALUES` has no dim |
| GD2 | Godot: `ALBEDO = wet_alb * mix(0.6, …)` | `kit_wet`: the albedo is the wet albedo |
| GD3 | Godot: a `cover_dim` uniform back | `kit_wet` has no dim uniform |
| GD4 | Godot: `_cover_params` sets `cover_dim` | `_cover_params` sets no dim |

**The metric fails under the bar.**
- `labs/cover-metric.mjs` exits 1 with `COVER FAIL: …` when:
  - any cover read is under 15;
  - any value gap is under 10;
  - the draws grow by more than 5 %;
  - or no cover view was measured.
- Otherwise it prints `COVER PASS` and exits 0. The bar is checked on the first config: the built values, by default.
- I chose the lab script's exit code over a gate e2e. Its CI cost is none: it is a local run, about 35 min on
  SwiftShader for the 29 views. A gate e2e would add that to every CI run, or cover only a subset.
- **M5,** run on views 0, 2, 3, 4 and 5 at 30 m: `COVER FAIL`, exit 1. The mast poles light up to L\* 32.7 and 31.3,
  so the gaps fall to 0.8 and 2.6, both under 10.
- **Shipped,** the full run: `COVER PASS`, exit 0.
  - The worst cover read is 17.2, with none of 23 under the bar.
  - The minimum value gap is **24.4** (corgi base, 60 m). It was 24.7 with the dim.
  - Draws are 2106 → 2106.
  - Against the first run, one cover read moved: the west-lane container at 30 m, 19.8 → 19.7.
- **Shots:** `cover-web-*.jpg` were retaken with the shipped code. I looked at each, and they look the same as the
  first ones.

**Proof.**
- `tsc` exit 0, and the labs typecheck (`labs/cover.ts`) exit 0.
- Boundaries PASS.
- The 14 touched unit files are green (166 tests): kit-cover, render-budget, lot-atmosphere, the five glb-* files, the
  four style-* files, cosmetics-looks and net-look.

### Item 11: Godot's final rule mirrored, and the lead's new bar (2026-10-10)

Base: a fresh copy of HEAD 7a671f1 plus every working-tree file, including g-atmos's final `look.gd`,
`kit_wet.gdshader` and `test_look_cover.gd`. Nothing is committed.

**Mirrored (shared rule, both renderers).**
- **The up-facing sheen mask.** In `coverRead`, the graze is × (1 − smoothstep(0.85, 0.97, y)), where y is
  `normalWorldGeometry.mul(faceDirection).y`: the world normal as seen, turned to the viewer on a back face like the
  graze's own.
  - The edges are `STYLE.cover.upFace` = [0.85, 0.97]. `kit-cover.test.ts` parses them from `kit_wet.gdshader`, which
    reads `* (1.0 - smoothstep(0.85, 0.97, wnrm.y))`.
  - The mask is on the sheen only.
- **The value gap on the body mean.** `cover-metric.mjs` measures the body as Godot's `_body` does: the mean L\*, its
  std and the mean C\* over the visible pixels, every 2nd px. The gap is now the darkest cover body against the
  brightest pole body. Before, it was the edge-inner L\*.

**Not mirrored (lead ruling).** `COVER_SCALE` (per-piece Forward+ gains) and `cover_sat` (1.0 on both renderers). The
web keeps fill 0.15 and sheen 0.25.

**The test sees the mask.** In the FloodMast's built emissive graph, `kit-cover.test.ts` checks:
- a `smoothstep` with `kit_wet.gdshader`'s edges;
- its x is the y of `normalWorldGeometry` × the face direction;
- `1 −` that smoothstep multiplies the sheen's `pow` (the graze), not the fill.

`STYLE.cover.upFace` must equal the parsed edges, and if Godot drops the mask, the parse fails by name.

**New mutants (8).** All fail `kit-cover.test.ts`. With the earlier 26 that makes 34, all re-run on a fresh copy: 34
of 34 fail, and the shipped code passes 8 of 8.

| Mutant | Change | Caught by |
|---|---|---|
| UP1 | the mask removed (`rim = graze`) | a smoothstep with `kit_wet`'s up-facing edges |
| UP2 | the edges swapped | the same |
| UP3 | the view-space normal instead of the world normal | its x is the y of the world normal |
| UP4 | the world normal not turned to the viewer | the same |
| UP5 | the mask on the whole emission, the fill included | the mask multiplies the graze (the sheen only) |
| UP6 | token edges → 0.6 / 0.9 | the edges vs `kit_wet.gdshader` |
| GUP1 | Godot's edges → 0.6 / 0.9 | the same |
| GUP2 | Godot's mask removed | `kit_wet.gdshader`: the graze × (1 − smoothstep(lo, hi, wnrm.y)) |

The M6, T2 and D3 anchors moved with the code (`.mul(rim)`, `upFace` after `power`). The mutants themselves are
unchanged.

**The metric with the mask.** This is the full shipped run on the old bar, reproduced exactly in a second fresh run.
- The worst edge is **16.3** (the east-lane pipe at 60 m; it was 17.2). None of 23 views is under 15.
- The minimum body gap is **23.8** (corgi base, 60 m).
- Draws are 2106 → 2106, equal in every view.
- The mask lowered only views with flat tops in sight: the bag-wall tops, the pipe crowns, the ballast's top. The
  west-lane container floor no longer washes out: it shows its own paint (`cover-web-west-lane.jpg`).
- **M5** still fails it (exit 1): the body gaps fall to −0.3 and 2.9.

**The lead's new bar,** in `cover-metric.mjs`'s exit-code gate:
- At 10 and 30 m on every cover piece, a dark view (read-off body < 35) stays ≤ 40, and a lit view is lifted by
  ≤ 5 L\*.
- Every view keeps ≥ 0.85 of its read-off L\* std.
- Edge ≥ 15, gap ≥ 10, and draws ×1.000 per view.
- `REGATE=<results.json>` re-applies the bar to a saved run.

**Under the new bar the shipped web FAILS (exit 1) with 20 failures.** The table is in COVER.md (Web, section 3).
- **Lifts over 5:** the corgi-base footing (+8.9 at 10 m, +7.2 at 30 m) and the rim bag wall (+12.0 and +12.5). Both
  stand in the flood pool at L\* 39–41 before any read. The footing at 30 m is 40.9 with the read off, so no web gain
  can bring it under 40.
- **Over 40:** the west-lane bag wall at 10 m (40.1).
- **Flattened (std kept < 0.85), 15 views:**
  - footing ×0.62 / 0.69 / 0.71;
  - rim bag wall ×0.53 / 0.44 / 0.69;
  - cat-base ballast ×0.42 / 0.48;
  - west-lane bag wall ×0.59 / 0.73 / 0.74;
  - pipe ×0.56 / 0.51 / 0.53;
  - slab bag wall ×0.67 at 10 m.
- **Pass:** the container (×0.91 / 0.95) and the corgi-base ballast (×2.1).
- **Why the dark views flatten:** a constant emission compresses L\* spread, because L\* is close to a cube root. The
  pool-aware fill (g-atmos, option c) will cover the lit views. The dark-view flattening needs the shared design to
  address it too.

**Waiting** for g-atmos's pool-aware fill rule, to mirror as named.

**Proof (this round).**
- **Checks:** `tsc` exit 0, the labs typecheck exit 0, boundaries PASS, and the 14 touched unit files pass (166
  tests). All on a fresh copy of HEAD plus the working tree.
- **Mutants:** 34 of 34 fail `kit-cover.test.ts`.
- **Metric,** on the old bar: M5 fails (exit 1) and the shipped run passes (exit 0). A second fresh full run gave the
  same 29 views to the last digit.
- **The new bar** re-applied to that run (`REGATE`): exit 1, with 20 failures (4 lift, 1 over 40, 15 flattened).
- **Live end to end** on the corgi footing and the pipe at 10 m: exit 1, with the same numbers.
- **Shots:** `cover-web-*.jpg` retaken with the mask in. I looked at all four.

### Item 11: the shared rule mirrored (g-atmos's round 3), the scales and the floors (2026-10-12 to 10-17)

Base: a fresh copy of HEAD e6837d5 plus the item 11 working-tree files only; tw-view's UI files are left out. Nothing
is committed.

**The rule,** copied from `kit_wet.gdshader` and `docs/handoff/G-ATMOS.md` "The rule the web twin mirrors", in
`style-webgpu.js` `coverRead()`:
- **The fill:** the wet albedo × the piece's own gain, clamp(COVER_MEAN, 0.22, 0.28) / max(COVER_MEAN, 1e-4).
  - The old per-texel band is gone.
  - Each texel's luminance is kept in [0.08, 0.5], and black becomes grey 0.08.
  - Then × sat.
  - Then × fill × (1 − pool_k × the strongest flood cone): smoothstep(0.848, 0.961) on the world position.
- **The sheen:** unchanged (the moon, the graze, the up-face mask), with no pool on it.
- **The data:**
  - `KitPiece.coverMean` (`KIT_COVER_MEAN`) is Godot's `COVER_MEAN`.
  - The floods come from `kitCoverFloods(WorldData)`. `splitLotKitPrims` carries them, and `createLotKitView` passes
    them to each piece's material.
- **The knobs:** `STYLE.cover` gains `lo`, `cap`, `cone`, `sat` and `pool`. `STYLE_COVER` gains the `sat` and `pool`
  uniforms.

**The web's per-build values** (measured; lead rulings of 2026-10-12):
- **Gains:** fill 0.16, sheen 0.10, sat 1.0, pool 1.0.
- **Per-piece fill scales** (`KIT_COVER_SCALE`; Container20 and FloodMast only, each in [0.5, 2.5]):
  - **Container20 ×2.1.** Its 30 m silhouette is its near-black frame, which the guard holds at 0.08. Its edge there
    is 7.1 at ×1, 14.6 at ×2.0 and 16.2 at ×2.1. At ×2.3 its 10 m body is 39.8.
  - **FloodMast ×0.85.** Its ×3.3 gain put the cat-base ballast, a dark view, at 40.6. It is 37.7 / 38.9 at ×0.85.
- **Why each gain:**
  - **pool 1.0** zeroes the fill in the flood pools: the footing's lift is +0.1, against +7.2 at pool 0.2.
  - **sheen** sits in a window: 0.15 lifts the rim bag wall +5.1 at 30 m (in the full-run order; at 30 m a view keeps
    the previous view's LOD, and measured alone it is +2.8), while 0.05 or less drops the pipe's 60 m edge under 15.
  - **fill 0.16** holds that edge at 15.1, and keeps the west-lane bag wall at 10 m at 39.5.

**The calibrated std floors** (lead ruling: the measured best ratio, holding every other bar, minus 0.05):
- **east lane Pipe[0]: 0.60.** Its best is 0.65 at the shipped values. Its read-off std is shading across the
  cylinder, not texture. Every config that held its 60 m edge was at 0.56–0.65.
- **corgi base BagWall[3] (the lit rim): 0.59.** Its best is 0.64 (30 m) at the shipped values. It keeps 0.85 only at
  sheen ≈ 0, where the pipe's edge fails.
- Every other sample keeps 0.85.

**The bar,** in `cover-metric.mjs`'s exit-code gate (`REGATE` / `GATE` re-apply it to a saved run):
- edge ≥ 15 at every distance;
- gap ≥ 10 at 10 and 30 m, reported at 60 m;
- at 10 and 30 m: a dark view (read-off < 35) stays ≤ 40, and a lit view is lifted ≤ 5;
- std kept ≥ 0.85, or the sample's floor, in every view;
- draws equal per view.

**Result,** the full 29 views at the shipped values: `COVER PASS`, exit 0.
- Worst edge 15.1 (the pipe at 60 m).
- Gap ≥ 24.5 at 10 and 30 m.
- Dark bodies 26.9–39.5; lit lifts +0.0 to +4.1.
- Std kept: the pipe ×0.65 and the rim bag wall ×0.64, above their floors; every other sample ×0.97 or more.
- Draws 2106 → 2106.
- The full table is in COVER.md (Web, section 3).

**Shots:**
- `cover-web-{corgi-base,cat-base,west-lane,east-lane}.jpg`, BEFORE | AFTER, retaken.
- `cover-web-montage.jpg`: every cover view at 30 m, off | on.
- I looked at each.

**Tests.** `kit-cover.test.ts` has 11 tests.
- **Shared terms parsed from Godot's files:**
  - the band, guard, power, up-face edges and cone;
  - the luminance weights, the 1e-4 guards and the moon;
  - `COVER`, `COVER_MEAN` and the floods (against Godot's `the_lot.json`).
- **COVER_MEAN** recomputed from the master GLBs' baseColor images, within 0.0005 of the table.
- **Every cover piece's built graph:**
  - its gain, guard and sat;
  - one cone per flood, on the world position with that flood's lamp and aim;
  - `1 − pool × cones` on the fill only;
  - `STYLE_COVER.fill` as is, or × the piece's pinned scale uniform;
  - moon × sheen × graze, with no pool on it.
- **The gains and scales pinned, and the glow bound** with the largest scale.
- The old near-black window and per-texel band asserts are gone, because Godot no longer has them.

**Mutants: 52, each run alone on a fresh copy. All 52 fail `kit-cover.test.ts`, and the shipped code passes 11 of 11.**
The script is `scratchpad/i11-mut2.py`.
- **The 31 earlier mutants:** M1/M1b/M1c, M3, M5, M6, BF, T1–T3, G1, G2, G2b, G3, G4, D1–D4, GD1–GD4, UP1–UP6, GUP1,
  GUP2. Their anchors moved with the code.
- **New in this round (21):**

| Mutant | Change | Caught by |
|---|---|---|
| M7 | the band's ceil → 2.8 (in the per-piece gain) | the gain clamp(COVER_MEAN, floor, ceil) |
| N1 | the old per-texel band back | the gain clamp(COVER_MEAN, floor, ceil) |
| N2 | the pool dropped | a cone per flood |
| N3 | the pool on the sheen too | the fill plus the sheen |
| N4 | the pool on the view position | cone 0: dot(normalize(positionWorld − lamp), aim) |
| N5 | BagWall COVER_MEAN +10 % | BagWall vs look.gd COVER_MEAN |
| N6 | the guard removed | the guard clamp(lum(held), lo, cap) |
| N7 | a scale on the Footing | the Footing's pbr() options; its scale uniform |
| N8 | a dark-view lift: fill × 3 in the shader | held × the fill |
| N9 | sat ignored | mix(vec3(lum(held)), held, STYLE_COVER.sat) |
| N10 | the token cone swapped | the cone vs kit_wet.gdshader |
| N11 | a flood aim not normalised | the aim is a unit vector |
| N12 | the gain divided by the clamped mean | / max(mean, 1e-4) |
| N13 | the gain removed | the gain clamp(...) |
| S1 | Container20 scale → 1.0 | the pinned scales; the container's scale uniform |
| S2 | FloodMast scale → 1.0 | the pinned scales; the mast's scale uniform |
| S3 | a scale on the Pipe too | the pinned scales (Container20 and FloodMast only) |
| S4 | the scale ignored in the shader | STYLE_COVER.fill × its scale |
| GC1 | Godot's cone drifts | the cone vs kit_wet.gdshader |
| GG1 | Godot's guard drifts | lo vs look.gd |
| GM1 | Godot's COVER_MEAN drifts | Footing vs look.gd COVER_MEAN |

**Proof:**
- `tsc` exit 0, the labs typecheck exit 0, boundaries PASS.
- The 14 touched unit files pass (169 tests).
- The metric: the full shipped run passes (exit 0). Each other gain set swept fails the gate on something.

**Known limit:** `createKitView` passing the floods to the material has no unit test, because no test builds a kit
view. A broken pass shows in the metric as lit-view lifts.

## §11b: item 11b-WEB, PARITY P2a (web q=low) and the web half of P2c (gate holes m4 / m5)

Base: a fresh copy of HEAD f7f45b5 (item 11 landed as e75c591) plus these files only. Nothing is committed.

**Changed files:**
- `src/client/assets/kit-glb.ts`:
  - `kitLitFloods(floods, quality)` and the `KitQuality` type;
  - `KIT_COVER_SCALE_LOW` and `kitCoverScale(name, quality)`, which replaces the static `KitPiece.coverScale`;
  - `kitPbrOpts(piece, floods, quality)`;
  - `createKitView` and `createLotKitView` take `quality` and a test `load`.
- `src/client/world/world-view.ts:109`, one line, by the lead's leave: `createLotKitView(kitSplit, kitLook, { far: edge + 8, quality: q })`. Before it, the kit view never learned the tier; the lamps (`createLampsView(data, { quality: q })`) did.
- `labs/cover.ts`:
  - the tier (`?q=`) goes to `createWorldView`, which hands it to the lamps and to the kit, as in the game;
  - `values()` resets the scales to the tier's row.
- `labs/cover-metric.mjs`: CONFIGS also take the Footing and BagWall scales.
- `tests/unit/kit-cover.test.ts`: pins the low row, its range, and the tier selecting the row.
- `tests/unit/kit-cover-wiring.test.ts` (new): builds the Lot's kit view with stand-in GLBs at high, med and low.
- `docs/qa/w15/COVER.md` (Web section).

**P2a, the fix.** At a tier whose floods have no real light (`STYLE.floodlight.budget` low 0), the pool term has no
floods, so nothing fades the fill where nothing lights the piece. High (4) and medium (2) keep all 4 floods, so
their numbers are unchanged. Medium moves its 2 real lights to the floods nearest the camera.

**P2a, the low row, first pass** (superseded by the §11b follow-up; lead ruling 2026-10-17: a tier row of the existing per-piece scale, fill only, in [0.5, 2.5]):
- `KIT_COVER_SCALE_LOW`, laid over `KIT_COVER_SCALE` at q=low only: Footing ×1.35 and BagWall ×0.75.
- Container20 ×2.1 and FloodMast ×0.85 apply at every tier, from the one row.
- This is the simplest shape a test can pin: one extra table, and a selector `kitCoverScale`.
- The sweep at Q=low (Footing ×1.3 / 1.4 / 1.5, BagWall ×0.8 / 0.85 / 0.9, then the chosen ×1.35 / ×0.75):
  - Footing 60 m edge against 10 / 30 m body: ×1.3 gives 14.1 and 39.2 / 39.3; ×1.4 gives 14.5 and 40.2 / 40.4; ×1.5
    gives 14.98 and 41.3 / 41.3; ×1.35 gives 14.3 and 39.7 / 39.8.
  - No Footing scale holds both its 60 m edge ≥ 15 and its 10 / 30 m body ≤ 40. So, per the ruling, there is no third
    knob: ×1.35 is the most the ceiling allows.
  - BagWall: ×0.85 gives the rim 40.1 / 40.8 (over); ×0.8 gives 39.5 / 40.2; ×0.75 gives 38.8 / 39.6. The lane walls'
    edges stay ≥ 18.1.

**Results**, the full 29 views per tier:

| Tier | Gate | Against e75c591 |
|---|---|---|
| high | `COVER PASS`, exit 0 | identical to the last digit, all 29 views (my item 11 final run and the lead's web/full/shipped) |
| med | `COVER PASS`, exit 0 | identical to the last digit, all 29 views (the lead's judge/med run) |
| low | exit 1, **one residual** | 28 of 29 pass |

The low tier at the shipped values (**superseded, see §11b follow-up:** these low numbers, and the sweep above, were
measured with the lab's render context left at high, so shadows, bloom and high style detail were on):
- **Footing[1], edge** (read off → on): 10 m 12.2 → 17.0, 30 m 10.7 → 32.0, **60 m 8.2 → 14.3 (the residual, under 15)**.
- **Footing[1], body:** 39.7 / 39.8 at 10 / 30 m.
- **Rim BagWall[3]:** body 38.8 / 39.6, edges 24.2 / 24.6 / 15.7. Its std ×0.80 / 0.73 stays above its 0.59 floor.
- **Lane bag walls:** edges ≥ 18.1.
- Draws are 2054 → 2054 per view (low's own scene).
- The residual goes to PARITY P2a as a known low-tier limit (lead).

**P2c, the web gate holes.** `kit-cover-wiring.test.ts` builds `createLotKitView` as `world-view` does, with a
stand-in GLB per piece, and checks:
- the floods reach every cover material: 4 cones at high and med, 0 at low;
- each material's fill scale is its tier's row;
- the FloodMast batch carries each placement's foot height (the Lot's mast feet are not 0), and its material reads it;
- no other piece carries a cover base;
- `world-view.ts` passes `quality: q` to `createLotKitView` and to `createLampsView`. This is a source pin, so the
  styleDetail fallback (for other callers) cannot stand in for it.

**Mutants (13).** Each was applied alone to a private copy, and every one fails:
- All 13 fail `npx vitest run tests/unit/kit-cover-wiring.test.ts tests/unit/kit-cover.test.ts`, exit 1, on the final
  code.
- W1 (m4), W3 (m5), W8 (the low row at med) and W6 (world-view drops `quality`) also ran CI's whole unit run
  (`npx vitest run`, 157 files, one worker, nice 10), and each exits 1. The unmutated baseline is 157 files passed,
  1386 tests passed and 4 skipped, exit 0.
  - W1: the wiring file fails, 2 tests.
  - W3: the wiring file fails, 1 test.
  - W8: kit-cover and the wiring file fail.
  - W6: the wiring file's source pin fails.
- The W8 and W6 runs also tripped the CPU-time budgets of `ai-nav-links` and `lot-tdm` (3.1 to 3.6 s against 3 s) under
  the box's load from other lanes. Those files are unchanged, they import neither mutated file, and they pass
  unmutated on an idle box.

| Mutant | Change | Caught by |
|---|---|---|
| W1 (m4) | createLotKitView passes no floods | kit-cover-wiring: the flood cones at high and med |
| W2 (m4b) | createKitView passes no floods to the material | the same |
| W3 (m5) | coverBase 0 | kit-cover-wiring: each placement's foot |
| W4 (m5b) | no coverBase attribute | kit-cover-wiring: the coverBase attribute |
| W5 | kitLitFloods ignores the tier | kitLitFloods at low; 0 cones at low |
| W6 | world-view stops passing `quality` | the source pin |
| W7 | the old wiring (all floods at every tier) | 0 cones at low |
| W8 | the low row applied at med | kit-cover rows; wiring: the scale at med |
| W9 | the low row ignored | kit-cover rows; wiring: the scale at low |
| W10 | the low row's Footing 1.35 → 1.0 | kit-cover: the pinned low row |
| W11 | the material ignores the tier | wiring: the scale at low |
| W12 | createLotKitView drops the tier | wiring: the scale at low |
| W13 | the high row's Container20 2.1 → 2.2 | kit-cover: the pinned high and med rows |

### §11b follow-up: B1, the real low profile (lead ruling 2026-10-18)

The verifier's B1: `labs/cover.ts` built its render context without the tier, so `Q=low` measured with the shadow
pass, bloom and high style detail on. The game's low tier turns shadows and bloom off (`engine/quality.ts`). The low
numbers above (Footing ×1.35, residual 14.3) are superseded by these.

**Changed files (this pass):**
- `labs/cover.ts`: the tier goes to `createRenderContext(…, { quality: toQualityTier(tier) })` as `main.ts` passes it,
  then `ctx.adaptive.setBounds(1, 1)`.
  - Measurement convention: the pixel ratio is pinned at 1 at every tier. `view()` computes the part's rect in the
    canvas's drawing-buffer pixels, and the metric reads it from a 1280 × 720 screenshot in CSS pixels. These agree only
    at ratio 1. At low's own 0.85 the rect lands on the wrong pixels, and the 30 and 60 m views read 0 px. Ratio 1 is
    also the grid Godot's metric reads.
- `labs/cover-metric.mjs`: CONFIGS take a ninth field, the Pipe's scale.
- `src/client/assets/kit-glb.ts`: `KIT_COVER_SCALE_LOW` is now Footing ×1.32, BagWall ×0.75 and Pipe ×1.05, with its
  reasons re-measured. The ×1.5 figure is corrected.
- `tests/unit/kit-cover.test.ts`: pins the new low row.
- `tests/unit/kit-cover-wiring.test.ts`: adds a behaviour check. `createWorldView` is built at high, med and low, with
  `kit-glb` wrapped so that `kitFlag` is `'pbr'` and the GLBs are stand-ins. The tier it hands `createLotKitView` must be
  its own, and the kit's materials must carry that tier's cones (4 / 4 / 0) and scale row. The verifier's
  `q === 'low' ? 'high' : q` mutant passes the source pin but fails this check. The source pin stays.
- `docs/qa/w15/COVER.md`, Web section: the low row, the tiers, the convention, and the fixes the verifier asked for.

**The low row, re-tuned at the real low profile** (Q=low, ratio 1). All values are fill only, in [0.5, 2.5].

| Piece | At ×1 | Sweep | Chosen |
|---|---|---|---|
| Footing[1] | 60 m edge 12.55 | ×1.3 / 1.31 / 1.32 / 1.33 / 1.35 / 1.5: 60 m edge 14.01 / 14.09 / 14.12 / 14.16 / 14.3 / 14.95; 30 m body 39.64 / 39.76 / 39.89 / 39.97 / 40.2 / 41.7 | **×1.32** (×1.33 clears the ceiling by only 0.03) |
| Rim BagWall[3] | body 42.1 / 42.6 at 10 / 30 m | ×0.75 / 0.65 / 0.6: 39.0 / 37.6 / 36.8 at 10 m; lane edges at 60 m 18.0 / 17.2 / 16.8 | **×0.75** (lowering it does not help the footing) |
| Pipe[0] | 60 m edge 14.95 | ×1.05 / 1.1: 60 m 15.20 / 15.4; 10 m body 39.28 / 39.9; std ×0.66 in both | **×1.05** |

**Results** (the full 29 views per tier, exit code = verdict):

| Tier | Result |
|---|---|
| high | `COVER PASS`, exit 0. Identical to e75c591: 0 differing values against the item 11 final run. |
| med | `COVER PASS`, exit 0, at its own profile. Edges are within 0.9 L\* of high's and bodies within 0.3; against the first med run (render context left at high), within 0.12. Worst edge 15.1, gap 21.7, draws 2106 → 2106. |
| low | exit 1, **28 of 29**. The residual is Footing[1] at 60 m: edge 14.12 against 15 (8.24 read off). |

The low tier at the shipped row:
- Footing[1]: edges 16.8 / 31.7, body 39.7 / 39.9 at 10 / 30 m.
- Rim BagWall[3]: body 39.0 / 39.7, std ×0.80 / 0.73.
- Pipe[0]: edges 24.1 / 16.1 / 15.2, std ≥ ×0.66.
- Lane bag walls: edges ≥ 18.0. The minimum gap is 26.1 at 10 and 30 m (23.0 at 60 m, reported).
- Draws: 1151 → 1151 (no shadow pass).

Stop at (c): no footing scale holds both its 60 m edge and its 10 / 30 m ceiling. The residual goes to PARITY P2a
(lead).

**Mutants (16), this pass.** All 16 fail `npx vitest run` on the two cover files, on the final code. This adds three
to W1–W13:
- W14: world-view swaps the tier (`q === 'low' ? 'high' : q`). Caught by the wiring's createWorldView check at low.
- W15: the low row drops the Pipe. Caught by kit-cover.
- W16: the Pipe 1.05 → 1.1. Caught by kit-cover.

W10 is now Footing 1.32 → 1.0.

CI's whole unit run (`npx vitest run`, nice 10) was run on a fresh copy of HEAD c010d64 plus these files:
- The baseline: 159 files passed, 1440 tests passed and 4 skipped, exit 0.
- W8 (the low row at med): exit 1. Only kit-cover and kit-cover-wiring fail, 3 tests.
- W14 (world-view swaps the tier): exit 1. Only kit-cover-wiring fails (the createWorldView check at low), 1 test.
