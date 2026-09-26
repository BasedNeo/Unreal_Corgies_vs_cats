# Style Guide — Corgis vs Cats
Agents read this before creating or changing ANY visual asset. Values that code uses live in
`src/client/style/style-tokens.js`; this file explains intent. Keep both in sync.

## One-line pitch of the look
**HARDENED (Wave 7, `docs/design/HARDENED.md` overrides v1):** a stylized-real war comic at dusk. Veteran pets in
weathered gear, a thin warm-black ink line for readability, a soft 4-band ramp with specular where it matters (wet
ground, armor, metal), grime / wear / mud from procedural masks, a warm low key with a cool rim, haze that layers the
distance, sodium floodlights pooling on wet ground, and a gritty grade (teal shadows, warm highlights, grain,
vignette). Team signal colours (corgis blue + gold, cats crimson + black) stay saturated so a teammate pops against
the desaturated yard. Only emissives bloom (lamps, muzzle flashes, tracers, laser pointers, cores).

## Units & orientation
1 unit = 1 meter · +Y up · characters/vehicles face −Z · feet/bases at y = 0 · characters ≈ 1.2 m (pet scale:
backyard objects ≈ ×4 real size).

## Palette (hex → role) — see style-tokens.js PALETTE
| Role | Hex | Used for |
|---|---|---|
| **world (HARDENED dusk)** grass / grassDark / grassDry | #5d7437 / #34442a / #8a8453 | olive-drab lawn, khaki dry grass |
| dirt / mulch / mud / soilDark | #6e5139 / #3f2d21 / #3a2e23 / #2c231b | wet soil, trenches, mud splash |
| asphalt / asphaltWet / concrete | #34363a / #1f2124 / #8f8b84 | pads, paths, bunkers |
| olive / khaki / canvas / sandbag | #535a35 / #8f8160 / #9c8c66 / #8b7a57 | tarps, sacks, crates |
| gunmetal / steel / oxidized / rust | #3a3e44 / #7d848b / #56615c / #7a3e22 | metal props, weapons |
| **corgi gear** hazardOchre / ochreWorn / camoBlack / underSuit | #c8952a / #8f6a2c / #2b2d30 / #202327 | plates, camo blocks, under-suit |
| **cat gear** charcoal / charcoalDark / oxblood / brass | #38363b / #1f1d21 / #5c1d23 / #a8843f | plates, webbing, buckles |
| sodium | #ffa53f | floodlights (emissive + light) |
| fenceWood / fenceDark / roof / brick | #93795a / #5e4a34 / #4f3531 / #7e4535 | weathered structures |
| corgiOrange / corgiCream / corgiRed / corgiTri | #e38a3a / #f6e7cf / #b4562a / #2a211c | corgi coats |
| catGrey / catBlack / catGinger / catWhite / catSiamese | #7d8591 / #2b2a33 / #d9822b / #f0ece4 / #e8dcc8 | cat coats |
| teamCorgis / trim | #2f6fd6 / #f2c14e | **signal only**: armbands, shoulder marks, visor/helmet lamps, UI (never camo) |
| teamCats / trim | #c9344a / #2b2a33 | **signal only**: same (locked by tests/unit/style-hardened.test.ts) |
| laserRed / tennisBall / glowCyan | #ff3b3b / #d7f542 / #6ff7ff | emissives only (bloom) |
| ink | #1a120c | outlines, creases, UI strokes |

## Shapes
- Silhouette first: species, team and class readable at 50 m and at thumbnail size.
- Big heads (≈ 1/3 of height), huge expressive ears, oversized hands/paws, chunky gear.
- Props: exaggerated, slightly bent, rounded bevels; detail clustered, not sprinkled.
- Original designs only — evoke a genre (cartoon war comic), never copy a franchise's characters, logos, UI or fonts.

## Rendering
Ramp 4 soft bands (floor 0.14, softness 0.075) · ink thickness 0.0026 (far cap 6 m) · crease 35° / 1.1 px ·
bloom only on emissives (threshold 0.95) · ACES · grade: contrast 0.42, saturation 0.86 (chroma > 0.3 protected),
split tone teal/warm, grain 0.045 (mids), vignette 0.62 · max pixel ratio 1.5.

## Materials (style factory v2: `toon()` / `toonMaterial()` / `glow()` / `stylize()`)
- `toon({ color, vertexColors, surface, rough, metal, grime, wear, mud, fade, wetK, puddle, ink, surfaceAttr })`:
  one cached, inked material per params. Pick a **surface preset** (`SURFACES` in style-tokens.js): `fur`, `cloth`,
  `armor`, `metal`, `weapon`, `world`, `wood`, `ground`, `foliage`, `water`, `plastic`, `default`; override single
  values when needed. Weathering is procedural (TSL noise in object space, world space for merged world meshes): no
  textures, no downloads.
- Mixed parts in ONE merged mesh (fur + plates + buckles): `paintSurface(THREE, geometry, SURFACES.armor, start, end)`
  per part and `toon({ vertexColors: true, surfaceAttr: true })`.
- `toonMaterial(p)`: the same material uncached, for code that sets its own nodes (`colorNode`, `normalNode`,
  `positionNode`, `roughnessNode` = per-pixel base roughness, `wetNode` = extra wetness).
- `ink: false` = toon-lit without the ink hull (foliage that sways, water, decals, glass).
- Wet: the weather's `wet` darkens porous albedo, turns roughness to a sheen, and (`puddle > 0`, e.g. `ground`) fills
  flat low spots with near-mirror puddles that reflect the sky and the floodlights.
- Detail per tier, fixed at build (`setStyleDetail`, done by the renderer): low = ramp + wet + sky reflection only.

## Lights
- Default battle mood: overcast dusk (sun ≤ 42° elevation, clear weather keeps ≥ 42 % cloud), warm low key, cool rim,
  ground haze. Weather (overcast → rain → storm) darkens, greys and wets everything through the same rig.
- Sodium floodlights: `createFloodlights({ tier })` from `src/client/style/floodlights.js`; add every floodlight
  while the world builds (a real light count change recompiles every material); budget high 4 / medium 2 / low 0 real
  spot lights, all floodlights get a lamp glow, a halo and a fake ground pool (3 draws in total).

## Budgets
| Class | Tris (LOD0) | Draw calls |
|---|---|---|
| Hero character | ≤ 6k | ≤ 6 |
| NPC/bot character | ≤ 3.5k | ≤ 5 |
| Boss | ≤ 15k | ≤ 8 |
| Prop | ≤ 3k | ≤ 2 |
| Frame | 60 fps reference, ≤ 1.5 M tris visible, ≤ 400 draw calls |

## Don'ts
No one-off materials outside `toon()`/`toonMaterial()`/`glow()` · no team signal colour as camo · no textures for
weathering (TSL masks) · no lights added after the first frame · no copying existing franchises · no `Math.random()`
in generators.
