// World palette: the style tokens' PALETTE plus the extra backyard colors the West Yard needs.
// PROPOSED for src/client/style/style-tokens.js (lead-owned): move WORLD_EXTRA into PALETTE when
// convenient — every key here is referenced by name from src/shared/world/west-yard.ts.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../style/style-tokens.js';

export const WORLD_EXTRA: Record<string, number> = {
  sand: 0xe6cf8f,
  siding: 0xe9dcc2,
  siding2: 0xd9c9a8,
  trim: 0xf4efe6,
  glass: 0x2e5b6b,
  metal: 0x6b7280,
  fenceDark2: 0xb58a55,
  underDeck: 0x3a2a1e,
  brickDark: 0x8a4232,
  stone: 0xa39d92,
  stoneDark: 0x77726b,
  terracotta: 0xc4673d,
  pink: 0xe8739a,
  flowerYellow: 0xf2c94c,
  purple: 0x9277c9,
  tomato: 0xd9463a,
  leaf: 0x4f8f3a,
  leafDark: 0x2f6b2e,
  leafLight: 0x86b84a,
  hedge: 0x3b7a34,
  hedgeLight: 0x559443,
  bark: 0x7a5236,
  barkDark: 0x553824,
  sisal: 0xcdb07c,
  sisalDark: 0xa98d5c,
  cardboard: 0xc99d63,
  cardboardDark: 0x9c7445,
  hoseGreen: 0x3fae55,
  trampMat: 0x2f4f86,
  trampRing: 0x6f95cf,
  teamCatsDark: 0x9e2438,
  plasticBlue: 0x3d9be0,
  duck: 0xf6d24a,
  clover: 0x4f9a3a,
  daisy: 0xece6d6,
  // ---- G1: The Garden ----
  cabbage: 0xb7d67a,
  lettuce: 0x9fcf5a,
  tomatoGreen: 0x8fb04a,
  wire: 0x8f98a3,
  trimShade: 0xd8d0c2,
  bamboo: 0xcdb67a,
  bambooDark: 0x9c8650,
  twine: 0xcfb68a,
  bean: 0x5f9e3c,
  beanPod: 0x74b545,
  compost: 0x4a3222,
  eggshell: 0xf1e9d8,
  banana: 0xf2d24a,
  pumpkin: 0xe8862f,
  pumpkinLight: 0xf29a3a,
  pumpkinDark: 0xc4661f,
  zucchini: 0x3f7d3a,
  zucchiniLight: 0x86b75c,
  brass: 0xc9a13b,
  sunflower: 0xf6c327,
  sunflowerDark: 0x5a3a1c,
  zinnia: 0xe0457b,
  marigold: 0xf29a2e,
  cosmos: 0xe59ad8,
  terracottaDark: 0x9e4f2e,
  tallGrass: 0x7fb043,
  tallGrassDry: 0xc2b85a,
  corn: 0x6c9a3a,
  cornLeaf: 0x7fae45,
  cornCob: 0xf0c94a,
  // ---- D3: The Garage + The Rooftops ----
  garageSiding: 0xa9bcc6,
  garageSiding2: 0x9aaeb9,
  garageInside: 0xece3d2,
  garageDoor: 0x7f9aa8,
  roofTar: 0x5d5956,
  roofGravel: 0x7a746d,
  oilStain: 0x3b3834,
  carBody: 0x6cc2ae,
  carDark: 0x2f4f4a,
  toolRed: 0xe2583a,
  pegboard: 0xc9a877,
  plywood: 0xdcb57c,
  plywoodDark: 0xb98f58,
  shedSage: 0x93b28a,
  shedSageDark: 0x6d8c66,
  lampTube: 0xfff1d2,
  lampPool: 0xf6ecd6,
  // ---- X1: destructibles (tuna-can stacks, crate stacks, the breach wall's rubble) ----
  tin: 0xc9ced6,
  tinDark: 0x8e959f,
  tunaLabel: 0x2f86cf,
  tunaLabel2: 0xe5683a,
  tunaFish: 0xf3e2b8,
  splinter: 0xf0cf94,
  scorch: 0x6a5e52,
  crateStencil: 0x5a3b1f,
  // ---- E4: the Yard War front (fortifications.ts, battle-dressing.ts). The first block mirrors keys the style PALETTE
  // also has: PALETTE wins when it has them, these keep the world building if a key is renamed.
  sandbag: 0x8b7a57, khaki: 0x8f8160, canvas: 0x9c8c66, olive: 0x535a35, oliveDark: 0x363b24,
  gunmetal: 0x3a3e44, rust: 0x7a3e22, steel: 0x7d848b, oxidized: 0x56615c, mud: 0x3a2e23, sodium: 0xff8c33,
  tennisFelt: 0xb8c448,       // grimy tennis-ball felt (ammo crates, spent balls)
  brassCasing: 0xb8913f,      // spent casings
  soot: 0x1d1813,             // blast scorch core
  ash: 0x6d665c,              // scorch rim ash
  mudWet: 0x2a2119,           // churned mud, ruts
  camoA: 0x5a6439, camoB: 0x8a7e53, camoC: 0x3c4129,
  bannerRag: 0xd6cdb8,        // torn banner edge / bleached cloth, crate stencils
  crateOlive: 0x6f7446,       // tennis-ball ammo crates (olive drab that survives the night grade)
  cable: 0x1f2124,
};

/**
 * E4: weathering values per palette key for the style factory's per-vertex `surface` attribute (rough, metal, grime,
 * wear; dry PBR values, the night's wetness lowers the roughness). Keys not listed use the 'world' preset.
 */
// half-metal: with metal >= 0.8 the PBR diffuse is x (1 - metal) and, with only the night sky to reflect, poles go
// near-black (K2)
const SURF_METAL: [number, number, number, number] = [0.42, 0.5, 0.35, 0.45];
const SURF_RUST: [number, number, number, number] = [0.82, 0.25, 0.55, 0.3];
const SURF_WOOD: [number, number, number, number] = [0.82, 0, 0.5, 0.4];
const SURF_CLOTH: [number, number, number, number] = [0.9, 0, 0.42, 0.15];
const SURF_PAINT: [number, number, number, number] = [0.6, 0, 0.38, 0.45];
const SURF_GLASS: [number, number, number, number] = [0.12, 0, 0.12, 0];
const SURF_LEAF: [number, number, number, number] = [0.75, 0, 0.08, 0];
const SURF_STONE: [number, number, number, number] = [0.86, 0, 0.45, 0.3];
export const SURF_WORLD: [number, number, number, number] = [0.78, 0, 0.42, 0.35];
const SURFACE_OF: Record<string, [number, number, number, number]> = {};
for (const k of ['metal', 'steel', 'gunmetal', 'tin', 'tinDark', 'wire', 'brass', 'brassCasing', 'cable', 'catBlack']) SURFACE_OF[k] = SURF_METAL;
for (const k of ['rust', 'oxidized']) SURFACE_OF[k] = SURF_RUST;
for (const k of ['fenceWood', 'fenceDark', 'fenceDark2', 'plywood', 'plywoodDark', 'bark', 'barkDark', 'bamboo', 'bambooDark', 'olive', 'oliveDark', 'crateOlive', 'underDeck', 'trim', 'splinter', 'sisal', 'sisalDark']) SURFACE_OF[k] = SURF_WOOD;
for (const k of ['sandbag', 'khaki', 'canvas', 'cardboard', 'cardboardDark', 'tennisFelt', 'camoA', 'camoB', 'camoC', 'bannerRag', 'twine']) SURFACE_OF[k] = SURF_CLOTH;
for (const k of ['teamCorgis', 'teamCats', 'teamCatsDark', 'teamCorgisTrim', 'teamCatsTrim', 'danger', 'accent', 'accentHot', 'plasticBlue', 'duck', 'toolRed', 'carBody', 'garageDoor', 'garageSiding', 'garageSiding2', 'siding', 'siding2', 'hullLight', 'catWhite']) SURFACE_OF[k] = SURF_PAINT;
for (const k of ['glass', 'water']) SURFACE_OF[k] = SURF_GLASS;
for (const k of ['leaf', 'leafDark', 'leafLight', 'hedge', 'hedgeLight', 'tallGrass', 'corn', 'cornLeaf', 'bean', 'lettuce', 'cabbage', 'zucchini']) SURFACE_OF[k] = SURF_LEAF;
for (const k of ['concrete', 'brick', 'brickDark', 'stone', 'stoneDark', 'terracotta', 'terracottaDark', 'roof', 'roofTar', 'roofGravel']) SURFACE_OF[k] = SURF_STONE;

/** Weathering (rough, metal, grime, wear) for a palette key (E4). */
export function worldSurface(key: string): readonly [number, number, number, number] {
  return SURFACE_OF[key] ?? SURF_WORLD;
}

const colorCache = new Map<string, THREE.Color>();

/** Linear-space color for a palette key (style tokens first, then the world extras). */
export function worldColor(key: string): THREE.Color {
  let c = colorCache.get(key);
  if (!c) {
    const hex = (PALETTE as Record<string, number>)[key] ?? WORLD_EXTRA[key];
    if (hex === undefined) throw new Error(`world palette: unknown color key '${key}'`);
    c = new THREE.Color(hex);
    colorCache.set(key, c);
  }
  return c;
}

export function worldHex(key: string): number {
  const hex = (PALETTE as Record<string, number>)[key] ?? WORLD_EXTRA[key];
  if (hex === undefined) throw new Error(`world palette: unknown color key '${key}'`);
  return hex;
}
