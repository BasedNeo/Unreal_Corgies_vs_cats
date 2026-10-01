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

## NEED (outside this lane)
1. `tools/perf-render.mjs` still counts hulls (harmless). `quality.ts` `propCreases` and world-view's
   `setPropCreases` are now no-ops and can go.
2. The `weaponInk` paths in `procgen/characters/index.ts` and `boss/sniper.ts`, and the `keepInk` flags, are dead code.
3. Labs: `labs/look.ts` (`type HardenedToonMaterial`), `labs/weapons.ts` (`addCreaseInk` returns `null`) and the
   labs' `inkMinPx` option.
4. Particle SDF rims (`fx/particle-mesh.ts`, `decal-mesh.ts`) are the FX lane's call.
5. The card's URL `?map=the-lot` falls back to the West Yard. The map id is `the_lot`.

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
