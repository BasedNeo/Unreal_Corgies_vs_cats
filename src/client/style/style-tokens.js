// style-tokens.js — the single source of truth for the Corgis vs Cats look (from threejs-toon-comic-style-system).
// Every material, light and post effect reads from here, so changing the look = editing one file.
// Look: sunlit suburban backyard at pet scale, warm key light, cool sky rim, chunky ink outlines.
// Keys used by the style system (void, hull*, accent*, glow*, ink, skin*) are kept; project keys added below.

export const PALETTE = {
  void: 0x9ccfe6,        // sky fallback / background
  tealDark: 0x2c5d52,
  teal: 0x3f8a74,
  tealLight: 0x8fd1b5,
  hullLight: 0xf1e6cf,   // painted siding, cream
  hull: 0xc9b99a,
  hullDark: 0x6d5f4b,
  accent: 0xf29a2e,      // corgi orange
  accentHot: 0xffd04a,   // tennis-ball / gold
  danger: 0xd8374a,      // cat crimson
  skinLight: 0xf6e7cf,
  skinMid: 0xe38a3a,
  skinDark: 0x8a4d24,
  glowCyan: 0x6ff7ff,
  glowOrange: 0xff9b3d,
  ink: 0x1a120c,
  // --- project palette ---
  grass: 0x6fa83a, grassDark: 0x3f6e2a, grassDry: 0xa9b04e,
  dirt: 0x9b6b43, mulch: 0x5b3a26, concrete: 0xb8b2a6, brick: 0xa4513d,
  fenceWood: 0xc79a62, fenceDark: 0x8b6238, roof: 0x7b3f35, water: 0x4fb3d9,
  corgiOrange: 0xe38a3a, corgiCream: 0xf6e7cf, corgiRed: 0xb4562a, corgiTri: 0x2a211c,
  catGrey: 0x7d8591, catBlack: 0x2b2a33, catGinger: 0xd9822b, catWhite: 0xf0ece4, catSiamese: 0xe8dcc8, catCream: 0xd8c3a0,
  teamCorgis: 0x2f6fd6, teamCorgisTrim: 0xf2c14e,
  teamCats: 0xc9344a, teamCatsTrim: 0x2b2a33,
  laserRed: 0xff3b3b, tennisBall: 0xd7f542,
};

export const STYLE = {
  toonSteps: 3,
  bandFloor: 0.42,
  // farCap (m): beyond it the ink keeps a constant WORLD width, so it thins with distance like comic atmospheric
  // linework instead of swallowing distant characters (K1: at 35 m a 12×30 px corgi was a solid ink blob).
  outline: { thickness: 0.0035, alpha: 1, farCap: 8 },
  crease: { angleDeg: 35, widthPx: 1.4 },
  bloom: { strength: 0.6, radius: 0.3, threshold: 0.9 },
  grade: {
    shadowTint: [0.86, 0.95, 1.06],
    highlightTint: [1.06, 1.02, 0.92],
    saturation: 1.12,
    vignette: 0.45,
    grain: 0.02,
  },
  lights: {
    key: { color: 0xfff0d6, intensity: 2.4, dir: [0.55, 0.9, 0.35] },
    rim: { color: 0x9fd8ff, intensity: 1.1, dir: [-0.5, 0.35, -0.8] },
    ambientSky: 0xa8d8f0, ambientGround: 0x5a4a30, ambientIntensity: 1.1,
  },
  maxPixelRatio: 1.5,
};
