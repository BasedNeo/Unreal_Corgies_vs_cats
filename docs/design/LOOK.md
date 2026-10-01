# LOOK — stylised-realistic (locked Wave 12; HARDENED retired Wave 13)

The owner locked the look in Wave 12 as **stylised-realistic**: a muted, moonlit overcast night after rain on The Lot.
That means wet asphalt, sodium floodlight glints, and readable material separation between a wet coat, scuffed
armour plate and rifle metal. **There are no ink outlines, no crease lines and no stepped toon bands.** The HARDENED
comic look (`docs/design/HARDENED.md`) is retired.

**Source of truth.** The Godot build is the main build. Its look lives in `engines/godot/look/` (`look.gd`,
`night_sky.gdshader`, `wet_ground.gdshader`, `kit_wet.gdshader`, `prims_wet.gdshader`, `pet_materials.gd`). When the web
and Godot disagree, Godot wins. The web has used the same look since Wave 13. Its numbers live in
`src/client/style/style-tokens.js`, where every value copied from Godot is marked `[godot]`.

## Pillars (kept from HARDENED; they are about play, not ink)
1. **Veterans, not mascots.** The humour is in the soldiering, not in softness.
2. **Readable in a firefight.** Team first (silhouette and team trim), class second, detail third. The team signal
   colours are locked: corgis blue and gold, cats crimson and black. Grit lives in materials and light, never in noisy
   silhouettes.
3. **One image.** Characters, weapons and the world share one material system, one light rig and one grade.

## Rendering (web)
- **Materials.** `toon()` / `toonMaterial()` keep their parameters but return a `StyleMaterial`, a PBR
  `MeshStandardNodeMaterial`.
  - Roughness and metalness come per surface: `SURFACES` presets, or per-vertex `surface` values.
  - Procedural TSL weathering: grime, wall streaks, edge wear, a mud band and fade.
  - The night's wetness darkens porous albedo and lowers roughness (most on metal and paint, most on tops). Puddles
    pool on flat ground.
  - `pbr()` keeps an authored GLB's own maps and gets the same wetness (the Godot `kit_wet` rules).
  - `glow()` stays unlit for emissives.
  - `stylize()` converts imported materials to `StyleMaterial` and adds nothing else.
  - `addCreaseInk()` is a no-op that returns `null`.
- **Pet materials** (Godot `pet_materials.gd`). On a pet's side, once wet:
  - coat: about 0.48 roughness, a broad sheen;
  - plate: about 0.29, the tight gloss of Godot's clearcoat;
  - rifle: 0.32, metal 0.9.

  The character rim + fill (`STYLE.rim`) stands in for Godot's rim sheen and self-lit coat: away from the floods, a pet
  reads by its rim, not as a black shape.
- **Night** (Godot `look.gd`, `night_sky.gdshader`):
  - Sky: a blue-black zenith over a low cold-slate cloud deck, brighter around the hidden moon; through the breaks, faint
    stars and the moon's disc. The horizon is a cold haze.
  - Moon: the key light. Cool, Godot energy 0.5, shadow-mapped, and no specular (no glint on the puddles).
  - Ambient: half the sky, half a cold moonlit colour, at Godot energy 1.6 (the hemisphere light). A weak sky fill
    lights the faces turned away from the moon, but not inside interiors.
  - Fog: exponential, horizon-tinted with 30 % aerial perspective, plus a height mist.
  - Godot light energies are multiplied by π for three.js (`STYLE.energyScale`).
- **Wet ground** (Godot `wet_ground.gdshader`):
  - On The Lot, trodden ground (dirt, mulch, gravel, mud, ruts, scorch) is wet paved asphalt: a dark binder with light
    aggregate, paving lanes with tar-sealed joints and patch repairs, cracks on old surfaces, and coarse grit on
    slopes. Its palette colour only shades it, by luminance.
  - On the West Yard the dirt paths stay dirt (it is a back yard), with the same wetness and puddles.
  - Roughness: a wet film at 0.3–0.45 and tar at 0.18. Puddles sit on the flat at roughness 0.03 with a stronger
    mirror, a damp rim and rain ripples.
  - The night never dries: wetness never drops below `STYLE.wet.floor`, so The Lot reads wet in its dry first minute.
- **Floods.** Sodium (#ff9e47), spot angle 32°, and Godot's slow falloff (decay 0.9), so the wet ground catches their
  glints. A tier's light budget sets how many floods get a real light; the others get fake pools.
- **Post:**
  - one scene pass (no outline pass);
  - bloom on emissives only (HDR threshold 1.3, strength 0.7);
  - AgX at exposure 1.5;
  - Godot's grade: contrast 1.06 about 0.5, saturation 0.85, and the per-channel colour-correction curve (teal shadows,
    warm highlights). Team hues and strong chroma keep their saturation when a storm dims it.

## Web-only differences (deliberate; Godot has no equivalent)
- **Weather.** Storms darken the sky and the lights, rain and fog thicken the fog, lightning flashes the sky and draws a
  bolt, and a faint screen-space rain sheet runs. The Godot night has fixed weather.
- **High cameras** see through more fog (`STYLE.night.highFog`), so the crane overview at 114 m reads.
- **Time of day.** It is kept as an API (and in the authority's schedule) but no longer changes the image.
- **Reflections.** The browser has no SSR, SSAO or volumetric fog. A fake sky reflection (`STYLE_ENV`) gives wet
  surfaces something to mirror, and lamp halos stand in for the volumetric glow.
- **No comic words.** The FX no longer pop onomatopoeia ("POW!", "BARK!"). Hit markers, the kill feed and damage
  feedback stay.

## Rules
- All materials go through the style factory (`toon()`, `toonMaterial()`, `glow()`, `stylize()`, `pbr()`).
- No new ink anywhere: no outline pass, no `LineSegments2` crease sets, no inverted hulls, no comic words.
- Look changes come from the Godot build first. Copy its values into `style-tokens.js` and mark them `[godot]`.
