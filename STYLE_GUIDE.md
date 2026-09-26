# Style Guide — Corgis vs Cats
Agents read this before creating or changing ANY visual asset. Values that code uses live in
`src/client/style/style-tokens.js`; this file explains intent. Keep both in sync.

## One-line pitch of the look
Hand-inked backyard war comic: chunky cartoon animals and giant household props, warm-black ink, 3-band toon
light, sunlit greens and corgi oranges against crimson-and-black cat forces; only lasers, tennis-ball tracers and
power cores glow.

## Units & orientation
1 unit = 1 meter · +Y up · characters/vehicles face −Z · feet/bases at y = 0 · characters ≈ 1.2 m (pet scale:
backyard objects ≈ ×4 real size).

## Palette (hex → role) — see style-tokens.js PALETTE
| Role | Hex | Used for |
|---|---|---|
| grass / grassDark / grassDry | #6fa83a / #3f6e2a / #a9b04e | lawn, foliage |
| dirt / mulch / concrete / brick | #9b6b43 / #5b3a26 / #b8b2a6 / #a4513d | paths, beds, patio, walls |
| fenceWood / fenceDark / roof | #c79a62 / #8b6238 / #7b3f35 | structures |
| corgiOrange / corgiCream / corgiRed / corgiTri | #e38a3a / #f6e7cf / #b4562a / #2a211c | corgi coats |
| catGrey / catBlack / catGinger / catWhite / catSiamese | #7d8591 / #2b2a33 / #d9822b / #f0ece4 / #e8dcc8 | cat coats |
| teamCorgis / trim | #2f6fd6 / #f2c14e | corgi armor, UI |
| teamCats / trim | #c9344a / #2b2a33 | cat armor, UI |
| laserRed / tennisBall / glowCyan | #ff3b3b / #d7f542 / #6ff7ff | emissives only (bloom) |
| ink | #1a120c | outlines, creases, UI strokes |

## Shapes
- Silhouette first: species, team and class readable at 50 m and at thumbnail size.
- Big heads (≈ 1/3 of height), huge expressive ears, oversized hands/paws, chunky gear.
- Props: exaggerated, slightly bent, rounded bevels; detail clustered, not sprinkled.
- Original designs only — evoke a genre (cartoon war comic), never copy a franchise's characters, logos, UI or fonts.

## Rendering
Toon bands 3 · band floor 0.42 · ink thickness 0.0035 · crease 35° · bloom only on glow · grain 0.02 ·
vignette 0.45 · max pixel ratio 1.5.

## Budgets
| Class | Tris (LOD0) | Draw calls |
|---|---|---|
| Hero character | ≤ 6k | ≤ 6 |
| NPC/bot character | ≤ 3.5k | ≤ 5 |
| Boss | ≤ 15k | ≤ 8 |
| Prop | ≤ 3k | ≤ 2 |
| Frame | 60 fps reference, ≤ 1.5 M tris visible, ≤ 400 draw calls |

## Don'ts
No one-off materials outside `toon()`/`glow()` · no copying existing franchises · no `Math.random()` in generators.
