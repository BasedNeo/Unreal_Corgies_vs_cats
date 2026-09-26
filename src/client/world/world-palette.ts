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
  trampMat: 0x2b2a33,
  teamCatsDark: 0x9e2438,
  plasticBlue: 0x3d9be0,
  duck: 0xf6d24a,
  clover: 0x4f9a3a,
  daisy: 0xece6d6,
};

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
