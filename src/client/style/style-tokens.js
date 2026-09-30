// style-tokens.js — the single source of truth for the Corgis vs Cats look (from threejs-toon-comic-style-system).
// Every material, light and post effect reads from here, so changing the look = editing one file.
// Look v2 (W7 S4, docs/design/HARDENED.md): stylized-real comic at dusk. Thin warm-black ink, a soft 4-band ramp with
// specular where it matters, weathered materials (grime / wear / roughness from procedural TSL masks), wet sheen in
// rain, overcast dusk light (warm low key, cool rim, haze), sodium floodlights, a gritty grade.
// Keys used by the style system (void, hull*, accent*, glow*, ink, skin*) are kept; project keys added below.
// Team SIGNAL colours (teamCorgis*/teamCats*) are fixed: the HUD and the team trims use them and they must pop
// against the desaturated world, so they never become camo and the grade protects saturated pixels.

export const PALETTE = {
  void: 0x4c5663,        // sky fallback / background: overcast dusk slate
  tealDark: 0x2c5d52,
  teal: 0x3f8a74,
  tealLight: 0x8fd1b5,
  hullLight: 0xd9cfbb,   // painted siding, weathered cream
  hull: 0xa89c86,
  hullDark: 0x5a5042,
  accent: 0xf29a2e,      // corgi orange
  accentHot: 0xffd04a,   // tennis-ball / gold
  danger: 0xd8374a,      // cat crimson
  skinLight: 0xf6e7cf,
  skinMid: 0xe38a3a,
  skinDark: 0x8a4d24,
  glowCyan: 0x6ff7ff,
  glowOrange: 0xff9b3d,
  ink: 0x1a120c,
  // --- world (HARDENED: desaturated dusk; wet soil browns, olive/khaki, oxidized metal, rust) ---
  grass: 0x5d7437, grassDark: 0x34442a, grassDry: 0x8a8453,
  dirt: 0x6e5139, mulch: 0x3f2d21, concrete: 0x8f8b84, brick: 0x7e4535,
  fenceWood: 0x93795a, fenceDark: 0x5e4a34, roof: 0x4f3531, water: 0x3f6b78,
  asphalt: 0x34363a, asphaltWet: 0x1f2124, mud: 0x3a2e23, soilDark: 0x2c231b,
  olive: 0x535a35, oliveDark: 0x363b24, khaki: 0x8f8160, canvas: 0x9c8c66, sandbag: 0x8b7a57,
  gunmetal: 0x3a3e44, oxidized: 0x56615c, rust: 0x7a3e22, steel: 0x7d848b,
  // --- faction gear (never the team signal: signal colours ride on armbands, shoulder marks, visors, lamps) ---
  // Names match the K2 lookups in procgen/characters/colors.ts (hazardOchre, oxblood, charcoal).
  hazardOchre: 0xc8952a,    // corgi hazard-ochre plate
  ochreWorn: 0x8f6a2c,      // ochre under grime
  camoBlack: 0x2b2d30,      // corgi gunmetal / black camo blocks
  underSuit: 0x202327,      // dark under-suit (both factions)
  charcoal: 0x38363b,       // cat charcoal plates
  charcoalDark: 0x1f1d21,
  oxblood: 0x5c1d23,        // cat oxblood paint / webbing
  brass: 0xa8843f,          // cat brass buckles
  // --- coats (fur stays warm; the grade and weather do the grit) ---
  corgiOrange: 0xe38a3a, corgiCream: 0xf6e7cf, corgiRed: 0xb4562a, corgiTri: 0x2a211c,
  catGrey: 0x7d8591, catBlack: 0x2b2a33, catGinger: 0xd9822b, catWhite: 0xf0ece4, catSiamese: 0xe8dcc8, catCream: 0xd8c3a0,
  // --- team SIGNAL colours: unchanged (HUD, trims) ---
  teamCorgis: 0x2f6fd6, teamCorgisTrim: 0xf2c14e,
  teamCats: 0xc9344a, teamCatsTrim: 0x2b2a33,
  // --- emissives only (bloom) ---
  laserRed: 0xff3b3b, tennisBall: 0xd7f542, sodium: 0xffa53f,
};

/**
 * Surface presets for toon({ surface }) (every field can also be passed directly to toon()).
 * rough 0..1 (0.08 mirror .. 1 chalk) · metal 0..1 · grime 0..1 (dark blotches, streaks on walls) · wear 0..1 (chipped,
 * lighter edges where the surface curves hard) · mud 0..1 (splash band near the object's local y = 0) ·
 * fade 0..1 (sun-bleached, desaturated albedo) · wetK 0..1 (how much rain soaks it; 0 = sheltered) · puddle 0..1 (flat
 * up-facing parts pool near-mirror water when wet; compiled in only for materials created with puddle > 0).
 */
export const SURFACES = {
  default: { rough: 0.62, metal: 0, grime: 0.3, wear: 0.3, mud: 0, fade: 0, wetK: 1, puddle: 0 },
  fur: { rough: 0.85, metal: 0, grime: 0.22, wear: 0, mud: 0.5, fade: 0, wetK: 1, puddle: 0 },
  cloth: { rough: 0.9, metal: 0, grime: 0.4, wear: 0.15, mud: 0.4, fade: 0.1, wetK: 1, puddle: 0 },
  armor: { rough: 0.42, metal: 0.25, grime: 0.45, wear: 0.65, mud: 0.4, fade: 0, wetK: 1, puddle: 0 },
  metal: { rough: 0.38, metal: 0.85, grime: 0.35, wear: 0.5, mud: 0, fade: 0, wetK: 1, puddle: 0 },
  weapon: { rough: 0.45, metal: 0.6, grime: 0.3, wear: 0.7, mud: 0, fade: 0, wetK: 0.6, puddle: 0 },
  world: { rough: 0.78, metal: 0, grime: 0.42, wear: 0.35, mud: 0.35, fade: 0.28, wetK: 1, puddle: 0 },
  wood: { rough: 0.82, metal: 0, grime: 0.5, wear: 0.4, mud: 0.4, fade: 0.3, wetK: 1, puddle: 0 },
  ground: { rough: 0.92, metal: 0, grime: 0, wear: 0, mud: 0, fade: 0.18, wetK: 1, puddle: 0.32 },
  foliage: { rough: 0.75, metal: 0, grime: 0.08, wear: 0, mud: 0, fade: 0.35, wetK: 0.8, puddle: 0 },
  water: { rough: 0.1, metal: 0, grime: 0, wear: 0, mud: 0, fade: 0, wetK: 0, puddle: 0 },
  plastic: { rough: 0.35, metal: 0, grime: 0.3, wear: 0.25, mud: 0.3, fade: 0.15, wetK: 1, puddle: 0 },
};

export const STYLE = {
  // Ramp: soft bands over half-lambert (N.L * 0.5 + 0.5). A low floor gives real form shadows (v1: 3 hard bands, floor
  // 0.42, which lit the back of everything at 42 % = the soft, flat cartoon read).
  toonSteps: 4,
  bandFloor: 0.14,
  ramp: { softness: 0.075, terminator: 0.5, texels: 64 },
  // farCap (m): beyond it the ink keeps a constant WORLD width, so it thins with distance like comic atmospheric
  // linework instead of swallowing distant characters (K1: at 35 m a 12×30 px corgi was a solid ink blob).
  outline: { thickness: 0.0026, alpha: 1, farCap: 6 },
  crease: { angleDeg: 35, widthPx: 1.1 },
  bloom: { strength: 0.55, radius: 0.35, threshold: 0.95 },
  // Display-space grade after tone mapping. Split tone is additive (teal shadows / warm highlights), contrast is an
  // S-curve around `pivot`, saturation is pulled down but pixels with strong chroma (team signals, lamps, tracers)
  // keep theirs (`signalChroma`). Grain is luminance-weighted (strongest in the mids), vignette is elliptical.
  grade: {
    shadowTint: [-0.018, 0.006, 0.03],
    highlightTint: [0.035, 0.012, -0.03],
    contrast: 0.42,
    pivot: 0.42,
    saturation: 0.86,
    signalChroma: [0.2, 0.42],
    // W9 P4 team signal protection by hue: pixels near a team hue (the signal colours below, ± signalHueDeg) keep their
    // saturation from a lower chroma up (signalHueChroma), so storms (which dim saturation and wash chroma) never grey
    // the blue / crimson trims out. The hues are the locked team signal colours (PALETTE.teamCorgis, teamCats).
    signalHueDeg: 26,
    signalHueChroma: [0.05, 0.13],
    // W9 P4: exposure 1.0 → 1.25 and vignette 0.62 → 0.5 (with the sky's dusk fill, sky.ts rimI / rimUp) lift the dark
    // dusk bookmarks (deck, flank: luma 31–36) above 45 while every bookmark's contrast rises (docs/handoff/P4.md).
    // Exposure scales every light alike, so the sodium pools keep their saturation; the fill carries the backlit faces.
    vignette: 0.5,
    grain: 0.045,
    exposure: 1.25,
  },
  toneMapping: 'aces',
  lights: {
    key: { color: 0xffc58a, intensity: 2.3, dir: [0.55, 0.9, 0.35] },
    rim: { color: 0x86a9d9, intensity: 1.35, dir: [-0.5, 0.35, -0.8] },
    ambientSky: 0x6d7c90, ambientGround: 0x2e261d, ambientIntensity: 0.95,
  },
  // Weathering masks (TSL, object space = bind pose for characters, world space for merged world meshes). Frequencies
  // in 1/m. Edge wear: curvature (rad/m) from screen-space normal/position derivatives.
  weathering: {
    grimeTint: [0.32, 0.29, 0.26], grimeFreq: 2.2, grimeDetailFreq: 7.5, streakFreq: [5.5, 0.6],
    wearTint: [1.3, 1.24, 1.16], wearLift: 0.05, wearFreq: 11, edgeCurvature: [3.5, 11],
    mudColor: 0x3a2e23, mudLine: 0.32,
    fadeTint: [1.04, 1.0, 0.92],
  },
  // Wet (weather `wet` 0..1): porous albedo darkens, roughness drops toward a sheen, up-facing surfaces soak most.
  // A soaked lawn gets a sheen, not a mirror (wet rough = rough * roughKeep + rough): mirrors belong to puddles.
  wet: { darken: 0.52, rough: 0.08, roughKeep: 0.55, sideSoak: 0.6, underSoak: 0.2, puddleAlbedo: 0.3 },
  // Fake environment reflection (no env map): the sky's zenith/horizon/ground colours by reflection direction.
  // `stormDim`: the reflected sky darkens with the weather's `dark` (storm puddles mirror a black sky, not a pale one).
  env: { intensity: 0.62, stormDim: 0.55 },
  // Character rim + fill (W9 P4, toon({ rim })): a view-dependent cool rim (Fresnel edge) plus a flat fill, both as
  // light on the albedo (hue and saturation kept, so team colours get brighter, not paler), growing with distance: a
  // subtle comic rim up close, a real lift at range where a pet is 20–30 px of mostly ink and the dusk ramp floor
  // (K3: at 35 m the suit's albedo barely moved the image; light does). Characters only; no real light, no new pass.
  // gain/fill: multiples of the albedo (× color) at `near` / `far` metres; power: edge falloff (1 − N·V)^power.
  // fogCut: the share of the atmospheric fog/haze a rim material (a character) sheds, so a pet keeps its value and team
  // colour through a storm's haze at range (storm: ~52 % fog at 35 m → ~21 %); near characters are barely fogged anyway.
  rim: { color: 0xa9c0e6, power: 2.2, near: 8, far: 30, nearGain: 0.35, farGain: 1.1, nearFill: 0.0, farFill: 0.45, fogCut: 0.6 },
  // W10 P5 interiors (WorldData.interiors, style-webgpu.js STYLE_INTERIORS): the sky fill (an unshadowed directional) and
  // the character rim + fill stay out of tunnels and containers. A surface is inside when the point `probe` m in front
  // of it (along its normal: the air it faces) is inside a box, feathered over `feather` m from the faces (probe >
  // feather, so an inner wall on a box face is fully shut while its outer shell stays lit). `charKeep`: the share of the
  // character rim + fill a pet keeps inside. `max`: boxes per world (a fixed uniform array).
  interior: { probe: 0.45, feather: 0.4, charKeep: 0.25, max: 16 },
  // W11 P-GLB1 pbr() (authored PBR GLB assets): `env` scales the fake sky reflection (× env.intensity), `wetK` how much the
  // weather's wetness reaches the asset, `normalScale` / `aoIntensity` multiply the asset's own; `interiors`: the sky fill
  // stays out of WorldData.interiors like it does for toon().
  pbr: { env: 1.0, wetK: 0.85, normalScale: 1.0, aoIntensity: 1.0, interiors: true },
  // Battle mood: clear weather still keeps broken cloud and haze (the sky never looks like a picnic).
  // highFog (sky.ts update): the distance fog thins for high cameras, from 1 at `from` m to `floor` over `span` m; W10 P5:
  // the floor falls with the weather's fog multiplier ^ `wx` (storm x3.0 -> floor 0.29), so a storm overview (The Lot's
  // crane view, 114 m) sees through the rain's extra density; cameras under ~77 m (players, the West Yard) are unchanged.
  mood: { minCloud: 0.42, haze: 0.35, hazeHeight: 7, sunMaxElevation: 42, highFog: { from: 12, span: 130, floor: 0.5, wx: 0.5 } },
  // Sodium floodlights (style/floodlights.js): real spot lights up to the tier's budget (lights cost every lit pixel
  // and adding one recompiles every material, so the count is fixed at build), fake light pools beyond it.
  floodlight: {
    color: 0xffa53f, intensity: 900, range: 34, angle: 0.62, penumbra: 0.55, poolRadius: 7, poolWithLight: 0.3,
    budget: { high: 4, medium: 2, low: 0 },
  },
  maxPixelRatio: 1.5,
};
