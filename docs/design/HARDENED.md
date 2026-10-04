> **RETIRED (Wave 13).** The web look is now the locked Wave 12 **stylised-realistic** look of the Godot build. See
> `docs/design/LOOK.md`. This file is kept as history: its ink outlines, crease lines, stepped toon bands and dusk grade
> are gone, and its pillars (veterans, readability, one image) carry on in LOOK.md.

# HARDENED — art & feel bible v2 (the Yard War)

Owner direction (2026-09-26): the first pass reads too cartoony and soft. Shift hard toward **battle-hardened
warriors** while keeping the humorous animal soul. References (mood only; never copy assets or designs):
Conker: Live & Reloaded multiplayer bases (functional military bases, trenches, fortifications, terminals,
sandbags, watchtowers, scarred battlefields, practical lighting) and the owner's mood board
`docs/design/refs/hardened-corgi-hero.jpg` + `hardened-corgi-sheet.webp`: an armored corgi soldier, hazard-yellow
and black weathered plate armor over a dark under-suit, wet fur, a serious squint, a battered rifle, rain on
asphalt at dusk, sodium floodlights, cranes and containers.

This file overrides MASTER_PLAN §3 where they differ. Numbers live in `src/client/style/style-tokens.js`.

## Pillars
1. **Veterans, not mascots.** Pets who have fought this war for years: armor plates, straps, pouches, dog tags,
   scars, mud and wet fur, a squint. Proportions heavier and more grounded (thicker neck/chest/forearms, planted
   stance); still unmistakably corgi (short legs, big ears, fox face) and cat (lithe, tail, ears, whiskers).
2. **The humor is in the soldiering, not the softness.** Pets taking pet things deadly seriously: kibble-sack
   sandbags, tennis-ball ammo crates, a bird-feeder watchtower, a "BEWARE OF DOG" sign as bunker armor, taunts,
   comic onomatopoeia (grittier lettering), exaggerated recoil on a tiny body.
3. **Readable in a firefight.** Team first (silhouette + trim), class second (K1 silhouettes stay: helmet or
   headgear shape per class), then detail. Grit lives in materials and lighting, never in noisy silhouettes.
4. **One image.** Characters, weapons and the world share one material system, one light rig and one grade.

## Look
- **Rendering:** stylized-real comic. Keep a thin warm-black ink line (silhouette/creases) for readability, but
  lighting is no longer flat 3-band: soft ramp with specular/sheen where it matters (wet ground, armor, metal),
  roughness variation, grime/wear/edge damage from procedural TSL masks (world/object space, no textures).
- **Palette:**
  - world: desaturated dusk: wet asphalt/soil browns, olive and khaki canvas, oxidized metal, rust.
  - corgi faction gear: hazard ochre (≈ #c8952a) and gunmetal/black camo plates over a dark under-suit.
  - cat faction gear: charcoal and oxblood with brass buckles.
  - **Team signal colours stay:** corgis blue + gold, cats crimson + black, on armbands, shoulder markings, visor
    and helmet lamps, and HUD. They never become the camo, so a teammate's signal pops against the dusk.
- **Lighting:**
  - default battle mood: overcast dusk or storm (the existing weather system: overcast / rain / storm) with a
    low warm key, a cool rim, and sodium floodlights (warm point lights, pooled) at bases;
  - wet ground reflects the lights when `wet > 0`;
  - atmospheric haze or fog sells depth.
  - Clear sunny weather still exists, graded grittier.
- **Grade:** teal shadows / warm highlights, contrast up, saturation down a notch, film grain, vignette. Bloom
  only on emissives (muzzle flash, tracers, lamps, laser pointers).
- **FX:**
  - fire: muzzle flash with a light pulse; tracers; ejected casings.
  - impacts by surface: dirt puffs, sparks on metal, wood splinters, water splashes.
  - persistent bullet holes and scorch decals with a pooled cap.
  - hits on pets: fur tufts and a soft team-colour chunk, never blood and no comic splat (W15: no ink, no Pop, no stars; docs/design/LOOK.md). Keep it rated for everyone.
  - hit confirmation: hitmarker, a thud and a small camera punch. Everything has a budget.

## Budgets (unchanged; MASTER_PLAN §8.7)
Visible triangles ≤ 1.5 M · draw calls ≤ 400 · 60 fps on a mid laptop at the high tier · sim tick p95 ≤ 3 ms ·
download ≤ 5 MB gz. Current (Q3, 3b3bfb3): 1.43 M tris / 305 draws in a live high TDM, so new detail must pay
for itself (instancing, LODs, merged kits, cheap TSL masks instead of geometry, low tier stays cheap).

## Process
Each lane loads its skills, works from fixed camera bookmarks (`tools/probe.mjs`, the `qa-*` shot tools) and
hands back before/after screenshots it actually looked at (iteration coach: one change per loop, evidence per
change). All materials go through the style factory (`toon()` / `glow()` / `stylize()` or its successors), and
the style audit must stay green.
