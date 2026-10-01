// style-tokens.js — the single source of truth for the Corgis vs Cats look on the web.
// Every material, light and post effect reads from here, so changing the look = editing one file.
// LOOK (docs/design/LOOK.md): stylised-realistic, locked in Wave 12 by the Godot build (engines/godot/look/, the main
// build: it wins any disagreement); on the web since Wave 13. A muted, moonlit overcast night after rain: wet asphalt,
// sodium floodlight glints, PBR materials with readable separation between coat, armour plate and rifle metal. No ink
// outlines, no crease lines, no stepped toon bands (the HARDENED comic look is retired, docs/design/HARDENED.md).
// Values marked [godot] are copied from engines/godot/look/ (look.gd, night_sky.gdshader, wet_ground.gdshader,
// kit_wet.gdshader, pet_materials.gd); colours given as Godot `source_color` triplets are sRGB, converted to linear
// where they are used. Team SIGNAL colours (teamCorgis*/teamCats*) are fixed: the HUD and the team trims use them.

export const PALETTE = {
  void: 0x1c212b,        // sky fallback / background: the night's horizon haze [godot fog_light_color = SKY_HORIZON]
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
  // warm black: the UI's ink colour and dark details (pupils, wicks). Never an outline: the web draws no ink lines.
  ink: 0x1a120c,
  // --- world: muted, weathered materials (wet soil browns, olive/khaki, oxidized metal, rust) ---
  grass: 0x5d7437, grassDark: 0x34442a, grassDry: 0x8a8453,
  dirt: 0x6e5139, mulch: 0x3f2d21, concrete: 0x8f8b84, brick: 0x7e4535,
  fenceWood: 0x93795a, fenceDark: 0x5e4a34, roof: 0x4f3531, water: 0x3f6b78,
  // the wet night asphalt [godot wet_ground asphalt_light / asphalt_dark]
  asphalt: 0x4d4d4d, asphaltWet: 0x2b2b2d, mud: 0x3a2e23, soilDark: 0x2c231b,
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
  // --- coats (fur stays warm; the night and the rain do the grit) ---
  corgiOrange: 0xe38a3a, corgiCream: 0xf6e7cf, corgiRed: 0xb4562a, corgiTri: 0x2a211c,
  catGrey: 0x7d8591, catBlack: 0x2b2a33, catGinger: 0xd9822b, catWhite: 0xf0ece4, catSiamese: 0xe8dcc8, catCream: 0xd8c3a0,
  // --- team SIGNAL colours: unchanged (HUD, trims) ---
  teamCorgis: 0x2f6fd6, teamCorgisTrim: 0xf2c14e,
  teamCats: 0xc9344a, teamCatsTrim: 0x2b2a33,
  // --- emissives only (bloom) ---
  laserRed: 0xff3b3b, tennisBall: 0xd7f542,
  sodium: 0xff9e47,         // high-pressure sodium, ~2100 K [godot look.gd SODIUM (1.0, 0.62, 0.28)]
};

/**
 * Surface presets for toon({ surface }) (every field can also be passed directly to toon()). PBR values:
 * rough 0..1 (dry roughness; the night's wetness lowers it) · metal 0..1 · grime 0..1 (dark blotches, streaks on walls) ·
 * wear 0..1 (chipped, lighter edges where the surface curves hard) · mud 0..1 (splash band near the object's local
 * y = 0) · fade 0..1 (sun-bleached, desaturated albedo) · wetK 0..1 (how much rain soaks it; 0 = sheltered) · puddle 0..1
 * (flat up-facing parts pool water; compiled in only for materials created with puddle > 0).
 * The pet trio follows the Godot pet materials once wet [godot pet_materials.gd: coat 0.42; plate 0.38 / metal 0.1 under a
 * glossy clearcoat (0.12); rifle metal 0.32 / metal 0.9]: on a pet's side at the night's wetness the coat reads ~0.48
 * (broad sheen), the plate ~0.29 (the clearcoat's tighter gloss, without a clearcoat pass), the rifle ~0.32 metal —
 * three clearly separate highlights on one pet.
 */
export const SURFACES = {
  default: { rough: 0.62, metal: 0, grime: 0.3, wear: 0.3, mud: 0, fade: 0, wetK: 1, puddle: 0 },
  fur: { rough: 0.55, metal: 0, grime: 0.18, wear: 0, mud: 0.45, fade: 0, wetK: 1, puddle: 0 },
  cloth: { rough: 0.9, metal: 0, grime: 0.4, wear: 0.15, mud: 0.4, fade: 0.1, wetK: 1, puddle: 0 },
  armor: { rough: 0.34, metal: 0.1, grime: 0.45, wear: 0.65, mud: 0.4, fade: 0, wetK: 1, puddle: 0 },
  metal: { rough: 0.38, metal: 0.85, grime: 0.35, wear: 0.5, mud: 0, fade: 0, wetK: 1, puddle: 0 },
  weapon: { rough: 0.36, metal: 0.9, grime: 0.3, wear: 0.7, mud: 0, fade: 0, wetK: 0.6, puddle: 0 },
  world: { rough: 0.78, metal: 0, grime: 0.42, wear: 0.35, mud: 0.35, fade: 0.28, wetK: 1, puddle: 0 },
  wood: { rough: 0.82, metal: 0, grime: 0.5, wear: 0.4, mud: 0.4, fade: 0.3, wetK: 1, puddle: 0 },
  ground: { rough: 0.62, metal: 0, grime: 0, wear: 0, mud: 0, fade: 0.18, wetK: 1, puddle: 0.32 },
  foliage: { rough: 0.6, metal: 0, grime: 0.08, wear: 0, mud: 0, fade: 0.35, wetK: 0.8, puddle: 0 },
  water: { rough: 0.06, metal: 0, grime: 0, wear: 0, mud: 0, fade: 0, wetK: 0, puddle: 0 },
  plastic: { rough: 0.35, metal: 0, grime: 0.3, wear: 0.25, mud: 0.3, fade: 0.15, wetK: 1, puddle: 0 },
};

export const STYLE = {
  // Godot light energy → three.js intensity: Godot scales a light's energy by π before its BRDF (so energy 1 lights a
  // white Lambert face to 1); three's lights do not.
  energyScale: Math.PI,
  // The locked night [godot look.gd + night_sky.gdshader, G-ATMOS W13]. Sky colours are the sky shader's uniforms
  // (sRGB); `dir` points to the moon. A blue-black zenith over a low cold-slate cloud deck lit from above by a hidden
  // moon (brighter around it and at its thin edges); through the breaks a darker sky, faint stars and the moon's disc;
  // the horizon is a cold haze (no warm sodium wash).
  night: {
    sky: {
      zenith: [0.03, 0.042, 0.08], horizon: [0.11, 0.13, 0.17], cloudLit: [0.17, 0.19, 0.24], cloudDark: [0.045, 0.055, 0.08],
      moon: [0.82, 0.87, 1.0], star: [0.75, 0.8, 0.95], cloudCover: 0.74, moonEnergy: 3.0, starEnergy: 0.6, energy: 1.0,
    },
    // the moon behind the cloud deck: cool, weak, no specular (a hard glint on the puddles blew out the overview)
    moon: { dir: [-0.4, 0.55, -0.73], color: [0.62, 0.72, 0.95], energy: 0.5 },
    // ambient [godot: half the (dark) sky, half a cold moonlit fill colour, energy 1.6]: the hemisphere light carries it
    ambient: { color: [0.2, 0.25, 0.36], skyContribution: 0.5, energy: 1.6 },
    // the sky's fill (the rig's `skyFill` directional, no shadow, diffuse only): a little shape on the faces turned
    // from the moon; shut out of WorldData.interiors (STYLE.interior). A web stand-in for Godot's directional sky
    // ambient (and its SSAO), energy in Godot units.
    fill: { color: [0.55, 0.62, 0.75], energy: 0.12, up: 0.35 },
    // exponential fog (1 - e^(-density d), ~59 % at 200 m on The Lot) the colour of the horizon haze, 30 % aerial
    // perspective, 15 % on the sky itself, plus the height mist below `height` m. `lotScale`: The Lot's map fog scale
    // (world-view: 118 / (edge + 1) = 0.75): the density is Godot's on The Lot and scales with the map size on the
    // others (W9 L3), e.g. the smaller West Yard 0.006.
    fog: { color: [0.11, 0.13, 0.17], density: 0.0045, skyAffect: 0.15, aerial: 0.3, height: 1.0, heightDensity: 0.03, lotScale: 0.75 },
    // highFog (sky.ts update, a web addition for the crane overview at 114 m): the distance fog thins for high cameras,
    // from 1 at `from` m to `floor` over `span` m; the floor falls with the weather's fog multiplier ^ `wx`, so a storm
    // overview sees through the rain's extra density; cameras under ~77 m (players) are unchanged.
    highFog: { from: 12, span: 130, floor: 0.5, wx: 0.5 },
  },
  // Wet night asphalt for the terrain's trodden ground [godot wet_ground.gdshader, G-ATMOS W13]: a dark grey binder
  // (two wear scales, older greyer panels) with light aggregate stones; paving lanes along z with tar-sealed joints, a
  // rare cross joint and patch repairs; a crack network on old surfaces; slopes (berms, banks) are coarse dark wet grit
  // (× `slopeDark`), rougher, with no joints or puddles. The palette colour only shades it (`shade` of its luminance), never tints it. Wet: the albedo
  // darkens to `darken`, the film is rough `wetRough` (stones rougher), tar 0.18; puddles (a noise mask on the flat,
  // `puddleCut`: higher = fewer) are `puddleRough` mirrors with a stronger F0 (× `puddleF0`) and a damp rim.
  ground: {
    asphaltDark: [0.17, 0.17, 0.175], asphaltLight: [0.3, 0.3, 0.3], aggregate: [0.4, 0.4, 0.39], tar: [0.025, 0.025, 0.028],
    grainScale: 9, aggScale: 0.8, crackScale: 26, panel: [4.5, 14], joint: 0.08,
    puddleScale: 24, puddleCut: 0.6, puddleRough: 0.03, wetRough: [0.3, 0.45], slopeRough: 0.62, slopeDark: 0.55, detailStrength: 0.35,
    shade: 0.3, darken: 0.7, dampAlbedo: 0.8, dampRough: 0.6, puddleAlbedo: 0.6, puddleF0: 1.8,
  },
  // Crease angle (deg): the procedural geometry's auto-smooth (style-utils smoothNormalsByPosition: edges sharper than
  // this stay hard under the PBR shading). No crease lines are drawn anywhere (W13).
  crease: { angleDeg: 35 },
  // Bloom on emissives only [godot glow]: HDR threshold above anything lit, intensity 0.7, no whole-frame bloom.
  bloom: { strength: 0.7, radius: 0.35, threshold: 1.3 },
  // Display-space grade after tone mapping [godot adjustments; AgX at `exposure` (Godot also deepens AgX's contrast to 1.3,
  // which three's AgX has no knob for)]: brightness, contrast about 0.5, saturation about the
  // channel mean, then the colour-correction curve (per channel, piecewise linear: teal shadows, warm highlights).
  // `signalChroma` / `signalHue*`: pixels with strong chroma (lamps, tracers) or near a team hue keep their saturation
  // when the weather pulls it down (the team trims stay readable in a storm).
  grade: {
    brightness: 1.0,
    contrast: 1.06,
    saturation: 0.85,
    curve: {
      offsets: [0, 0.22, 0.6, 1],
      colors: [[0, 0.008, 0.02], [0.205, 0.225, 0.24], [0.61, 0.6, 0.585], [1, 0.985, 0.95]],
    },
    signalChroma: [0.2, 0.42],
    signalHueDeg: 26,
    signalHueChroma: [0.05, 0.13],
    exposure: 1.5,
  },
  toneMapping: 'agx',
  // The light rig (createStyleLights; the sky drives it): the moon as the key (shadow-mapped, diffuse only), the sky
  // fill, and the hemisphere light as the sky ambient. Intensities in three units (Godot energy × energyScale).
  lights: {
    key: { color: 0x9eb8f2, intensity: 0.5 * Math.PI, dir: [-0.4, 0.55, -0.73] },
    rim: { color: 0x8c9ebf, intensity: 0.12 * Math.PI, dir: [0.4, 0.35, 0.73] },
    ambientSky: 0x2b3446, ambientGround: 0x252c3c, ambientIntensity: 1.6 * Math.PI,
  },
  // Weathering masks (TSL, object space = bind pose for characters, world space for merged world meshes). Frequencies
  // in 1/m. Edge wear: curvature (rad/m) from screen-space normal/position derivatives.
  weathering: {
    grimeTint: [0.32, 0.29, 0.26], grimeFreq: 2.2, grimeDetailFreq: 7.5, streakFreq: [5.5, 0.6],
    wearTint: [1.3, 1.24, 1.16], wearLift: 0.05, wearFreq: 11, edgeCurvature: [3.5, 11],
    mudColor: 0x3a2e23, mudLine: 0.32,
    fadeTint: [1.04, 1.0, 0.92],
  },
  // Wetness [godot look.gd WET_DARKEN / WET_ROUGH, kit_wet]: porous (non-metal) albedo darkens to `darken`, roughness
  // falls to × `roughPorous` on porous surfaces and × `rough` on metal and paint, up-facing faces a further × `top`;
  // walls soak `sideSoak`, undersides `underSoak`. `floor`: the locked night never dries (Godot's look is always wet:
  // its kit pieces sit at 0.75–1 wetness), so the weather's wetness only adds to it.
  wet: { darken: 0.7, rough: 0.55, roughPorous: 0.85, top: 0.8, sideSoak: 0.6, underSoak: 0.2, puddleAlbedo: 0.6, puddleRough: 0.03, floor: 0.75 },
  // The sky reflection (no env map: the sky's zenith / horizon / ground colours by reflection direction). `stormDim`:
  // the reflected sky darkens with the weather's `dark`.
  env: { intensity: 1.0, stormDim: 0.55 },
  // Character rim + fill (W9 P4, toon({ rim })): a view-dependent cool rim (Fresnel edge) plus a flat fill, both as
  // light on the albedo (hue and saturation kept, so team colours get brighter, not paler), growing with distance: the
  // night's readability term [godot pet_materials.gd: the coat's rim sheen plus its faint self-lit fill, "away from the
  // floods a pet was a black silhouette"; Godot's fill is 0.7–0.9 of the coat colour, the web's is lighter because it
  // reaches every part of a pet, plates and gear too]. Characters only; no real light, no new pass.
  // gain: the edge, a multiple of the albedo × `color`; fill: a multiple of the albedo (its own hue), at `near` / `far`
  // metres; power: edge falloff (1 − N·V)^power.
  // fogCut: the share of the fog a rim material (a character) sheds, so a pet keeps its value through a storm's haze.
  rim: { color: 0xa9c0e6, power: 2.2, near: 8, far: 30, nearGain: 0.35, farGain: 1.1, nearFill: 0.2, farFill: 0.55, fogCut: 0.6 },
  // W10 P5 interiors (WorldData.interiors, style-webgpu.js STYLE_INTERIORS): the sky fill (an unshadowed directional) and
  // the character rim + fill stay out of tunnels and containers. A surface is inside when the point `probe` m in front
  // of it (along its normal: the air it faces) is inside a box, feathered over `feather` m from the faces (probe >
  // feather, so an inner wall on a box face is fully shut while its outer shell stays lit). `charKeep`: the share of the
  // character rim + fill a pet keeps inside. `charSky`: the share of the sky fill a pet keeps inside. `max`: boxes per
  // world (a fixed uniform array).
  interior: { probe: 0.45, feather: 0.4, charKeep: 0.25, charSky: 1, max: 16 },
  // pbr() (authored PBR GLB assets, the shared kit): `env` scales the sky reflection (× env.intensity), `wetK` how much
  // the night's wetness reaches the asset, `normalScale` / `aoIntensity` multiply the asset's own; `interiors`: the sky
  // fill stays out of WorldData.interiors. `wrap` / `shadeFloor` 0: plain N.L like every other material (W11's toon
  // ramp match is gone with the ramp). `paintTint` (per call) tints only the paint mask (baseColor alpha) with the
  // geometry's per-instance `paintTint`; detail: two world-space noise scales (1/m) as a bump (m), albedo mottling and
  // roughness breakup, `scratch` micro-scratch strength (0 = none) at `scratchFreq` (1/m, x/z then y); `rivulets` rain
  // running down walls; `puddle` coverage on flat tops.
  pbr: {
    env: 1.0, wetK: 0.85, normalScale: 1.0, aoIntensity: 0.6, interiors: true, wrap: 0, shadeFloor: 0, paintTint: false,
    detailFreq: [3.1, 23], detailBump: [0.004, 0.0007], detailAlbedo: 0.07, detailRough: 0.08,
    scratch: 0.4, scratchFreq: [1.3, 12], rivulets: 0.8, puddle: 0.35,
  },
  // Sodium floodlights (style/floodlights.js) [godot look.gd floods: SODIUM (1.0, 0.62, 0.28) ~2100 K, FLOOD_ENERGY 38,
  // spot angle 32°, angle attenuation 1.6 (a soft edge: penumbra 0.8 here), distance attenuation 0.9]: real spot lights up to the tier's budget (lights cost every lit pixel and adding one
  // recompiles every material, so the count is fixed at build), fake light pools beyond it. `decay` is Godot's distance
  // exponent (three's SpotLight decay), so the pools throw as far as Godot's; `intensity` (cd at decay 0.9) is set so
  // The Lot's towers (battle-dressing scales them by throw) light their pools about as Godot's energy 38 does.
  floodlight: {
    color: 0xff9e47, intensity: 132, decay: 0.9, range: 34, angle: 0.559, penumbra: 0.8, poolRadius: 7, poolWithLight: 0,
    poolGain: 0.12, budget: { high: 4, medium: 2, low: 0 },
  },
  maxPixelRatio: 1.5,
};
