// Palette helpers: every character color is a PALETTE token or a mix of two tokens.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../../style/style-tokens.js';

const a = new THREE.Color(), b = new THREE.Color();

/** Mix two palette hex colors (linear-space lerp) → hex. */
export function mixHex(x: number, y: number, t: number): number {
  return a.setHex(x).lerp(b.setHex(y), t).getHex();
}

/** A HARDENED palette token if the style lane has added it (docs/handoff/K2.md), else the mix that stands in for it. */
const tok = (name: string, fallback: number): number => (PALETTE as Record<string, number>)[name] ?? fallback;

// --- HARDENED gear colours (docs/design/HARDENED.md › Palette) ------------------------------------
// Faction gear is the camo: corgis hazard ochre + gunmetal/black, cats oxblood + charcoal + brass. The team signal
// colours (PALETTE.teamCorgis* / teamCats*) never go on it; they ride shoulder plates, armbands and lamps (gear.ts).
export const INK = PALETTE.ink;
/** Hazard ochre (≈ #c8952a): corgi armour paint. */
export const OCHRE = tok('hazardOchre', mixHex(PALETTE.accent, PALETTE.grassDark, 0.34));
/** Gunmetal / black camo blocks on the ochre. */
export const CAMO_BLACK = tok('camoBlack', mixHex(PALETTE.hullDark, INK, 0.7));
/** Blued / parkerized steel. */
export const GUNMETAL = tok('gunmetal', mixHex(PALETTE.hullDark, INK, 0.62));
/** Bare metal where paint has chipped through. */
export const WORN_STEEL = tok('steel', mixHex(PALETTE.concrete, PALETTE.hullDark, 0.28));
/** Oxblood (darker and browner than the crimson team signal, so the signal pops on it): cat armour paint. */
export const OXBLOOD = tok('oxblood', mixHex(PALETTE.roof, INK, 0.5));
/** Charcoal: cat camo stripes. */
export const CHARCOAL = tok('charcoal', mixHex(PALETTE.catGrey, INK, 0.84));
export const BRASS = tok('brass', mixHex(PALETTE.accentHot, PALETTE.fenceDark, 0.42));
export const OLIVE = tok('olive', mixHex(PALETTE.grassDark, PALETTE.fenceDark, 0.45));
export const KHAKI = tok('khaki', mixHex(PALETTE.fenceWood, PALETTE.grassDry, 0.35));
/** Dark under-suit (arms, legs, gloves). */
export const UNDERSUIT = tok('underSuit', mixHex(PALETTE.catBlack, INK, 0.38));
/**
 * W9 K3 under-suit value lift (docs/handoff/K3.md): the near-black `underSuit` (sRGB luma 35) made the limbs vanish
 * under dusk (docs/qa/W7_GALLERY.md, "35 m lineup"). The field suits keep the hardened palette but carry a value
 * (luma ~70): corgis a dark olive drab (it sits with the ochre and gunmetal plates), cats a lifted warm charcoal (below
 * the brass, next to the charcoal camo). Both stay under the plates' and the fur's value and are never a team hue
 * (tested). Measured: it reads wherever the suit is lit; at 35 m the backs sit on the ramp floor and albedo barely moves
 * the image (even a 4x suit), so value at that range is a lighting job (P4's rim light). The `underSuit` token itself
 * is the style lane's; only the characters' suits read these.
 */
export const SUIT_CORGI = mixHex(UNDERSUIT, OLIVE, 0.6);
export const SUIT_CAT = mixHex(mixHex(CHARCOAL, INK, 0.45), mixHex(PALETTE.catGrey, OXBLOOD, 0.12), 0.2);
/** Wet yard mud on boots, knees and fur. */
export const MUD = tok('mud', mixHex(PALETTE.mulch, PALETTE.dirt, 0.35));
/** Healed scar: pale pink, hairless skin. */
export const SCAR = mixHex(PALETTE.catWhite, PALETTE.danger, 0.32);


/** Integer lattice hash → [0, 1) (pure: same point, same value on every machine). */
function latticeHash(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841) ^ Math.imul(z | 0, 0xcb1ab31f) ^ Math.imul(s | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/**
 * Smooth 3D value noise in [0, 1] (trilinear over a hashed unit lattice, smoothstep weights). Coat patches
 * (merle marbling, calico) are painted from model-space positions with it, so every part of the body agrees
 * on where a patch is, and the same kit always gets the same patches (no RNG state).
 */
export function valueNoise3(x: number, y: number, z: number, seed = 0): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const fx = x - xi, fy = y - yi, fz = z - zi;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy), sz = fz * fz * (3 - 2 * fz);
  const l = (i: number, j: number, k: number) => latticeHash(xi + i, yi + j, zi + k, seed);
  const x00 = l(0, 0, 0) + (l(1, 0, 0) - l(0, 0, 0)) * sx, x10 = l(0, 1, 0) + (l(1, 1, 0) - l(0, 1, 0)) * sx;
  const x01 = l(0, 0, 1) + (l(1, 0, 1) - l(0, 0, 1)) * sx, x11 = l(0, 1, 1) + (l(1, 1, 1) - l(0, 1, 1)) * sx;
  const y0 = x00 + (x10 - x00) * sy, y1 = x01 + (x11 - x01) * sy;
  return y0 + (y1 - y0) * sz;
}

// --- battle wear (vertex colours; model space, so every part of a kit agrees and the same kit is always the same) --

/** Mud creeping up from the ground: full at y = 0, gone by `to` (m), patchy. */
export function muddy(hex: number, x: number, y: number, z: number, to = 0.24): number {
  if (y >= to) return hex;
  const m = (1 - y / to) * (0.3 + 0.6 * valueNoise3(x * 9, y * 9 + 4, z * 9, 7));
  return mixHex(hex, MUD, Math.min(0.85, m));
}

/**
 * Wet, matted fur: darker clumps (wet fur darkens and parts) plus mud low down. The coat keeps its hue, so a red corgi
 * is still a red corgi, just one that has been out in the rain for a week.
 */
export function weatherFur(hex: number, x: number, y: number, z: number): number {
  const n = valueNoise3(x * 14 + 1.3, y * 14, z * 14, 41);
  const c = n > 0.52 ? mixHex(hex, INK, Math.min(0.3, (n - 0.52) * 0.9)) : hex;
  return muddy(c, x, y, z, 0.2);
}

/** Faction paint scheme for armour plates. */
export interface Paint {
  base: number;
  camo: number;
  /** Bare metal at chips and worn edges. */
  chip: number;
  /** Camo feature size (1/m): blotches for corgis; cats wear stripes (tiger camo). */
  scale: number;
  stripes: boolean;
}

/**
 * Painted armour at a model-space point: faction paint, camo blocks (or stripes), chipped to bare metal in speckles
 * and wherever `edge` > 0.5 (a plate's rim), grimy and muddy low down.
 */
export function paintAt(p: Paint, x: number, y: number, z: number, edge = 0): number {
  const s = p.scale;
  const n = p.stripes ? Math.sin(y * s * 5.2 + x * 2 + valueNoise3(x * 5, y * 5, z * 5, 3) * 4.5) : valueNoise3(x * s + 7.1, y * s, z * s, 13) * 2.4 - 1.2;
  let c = n > (p.stripes ? 0.45 : 0.42) ? p.camo : p.base; // camo on about a quarter of the paint
  if (edge > 0.5 || valueNoise3(x * 33, y * 33 + 2, z * 33, 23) > 0.8) c = p.chip;
  return muddy(c, x, y, z, 0.2);
}
