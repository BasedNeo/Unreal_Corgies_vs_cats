// Species + variant parameter tables (theme data — swap this file to re-theme the cast).
// One anthropomorphic biped body plan; corgi and cat differ only in these numbers and colors.
// Units: meters, character space: feet at y = 0, facing -Z, +X = the character's right.
import { PALETTE } from '../../style/style-tokens.js';
import { Species, type ClassId, type SpeciesId } from '../../../shared/types';
import { mixHex } from './colors';

export type CoatPattern = 'plain' | 'sable' | 'tri' | 'tabby' | 'points' | 'tux' | 'sphynx' | 'merle' | 'calico';

export interface Coat {
  name: string;
  base: number;       // main fur
  light: number;      // muzzle / bib / socks / cheeks
  dark: number;       // saddle, cap, stripes, points
  pattern: CoatPattern;
  nose: number;
  innerEar: number;
  iris: number;       // iris colour (HARDENED corgis: amber / copper; merle: ice blue)
  brow: number;
  socks: boolean;     // light paws
  tongue: number;
  /** Third fur colour of patched coats (calico orange). */
  accent?: number;
}

/**
 * Body shape family from the seed. It never changes with a look (C3): a look repaints the coat, so the rig, the
 * silhouette and every class read stay exactly the seeded ones. Chonk = wide cat, sphynx = hairless cat.
 */
export type Breed = 'corgi' | 'cat' | 'chonk' | 'sphynx';

/** The breed a seeded coat implies (chonk and sphynx are cat body variants; everything else is the plain plan). */
export function breedOfCoat(species: SpeciesId, coat: Coat): Breed {
  if (species !== Species.Cat) return 'corgi';
  return coat.name === 'chonk' ? 'chonk' : coat.pattern === 'sphynx' ? 'sphynx' : 'cat';
}

export interface BodyPlan {
  species: 'corgi' | 'cat';
  // legs (x = half hip width)
  hipX: number; hipY: number; kneeY: number; kneeZ: number; ankleY: number; ankleZ: number;
  thighR: number; shinR: number;
  foot: { len: number; w: number; h: number; toeZ: number; heelZ: number };
  // torso
  hipsY: number; spineY: number; chestY: number; neckY: number; headY: number;
  torso: { y: number[]; rx: number[]; rz: number[]; z: number[] };
  butt: { x: number; y: number; z: number; r: number } | null;
  // arms
  shoulder: [number, number, number]; armAngle: number; upperLen: number; foreLen: number;
  armR: [number, number]; handR: number;
  // head (head-bone local)
  cranium: { c: [number, number, number]; r: [number, number, number] };
  cheek: { c: [number, number, number]; r: [number, number, number]; tufts: number };
  muzzle: { base: [number, number, number]; tip: [number, number, number]; rBase: [number, number]; rTip: [number, number] } | null;
  pads: { c: [number, number, number]; r: number } | null;   // cat whisker pads
  nose: { c: [number, number, number]; r: [number, number, number] };
  jaw: { pivot: [number, number, number]; a: [number, number, number]; b: [number, number, number]; r: [number, number] };
  /** Eye x/y (head-local; z is solved so `protrude` of the eye's depth sits outside the cranium). */
  eye: { c: [number, number, number]; r: number; scale: [number, number, number]; tilt: number; look: number; protrude: number };
  brow: { c: [number, number, number]; r: [number, number, number] };
  ear: { base: [number, number, number]; tip: [number, number, number]; w: number; d: number; mid: number };
  tail: { base: [number, number, number]; pts: [number, number, number][]; r: number[]; fluffy: boolean };
  /** Hairless body (sphynx): no fur tufts on the ruff / pants, whatever the coat paint. */
  hairless?: boolean;
  /** Neck radii [x, z] at the chest (default 0.1 × 0.095); HARDENED veterans have thicker necks. */
  neckR?: [number, number];
  /** HARDENED (K2) proportions: veteran build, collar ruff, armour collar. */
  hardened?: boolean;
}

// --- coats -------------------------------------------------------------------------------------
const P = PALETTE;
const pink = mixHex(P.catWhite, P.danger, 0.32);
const darkPink = mixHex(P.corgiTri, P.danger, 0.55);
const tonguePink = mixHex(P.danger, P.catWhite, 0.38);
/** HARDENED corgi eyes: amber irises (the mood board's squint), not black buttons. */
const amber = mixHex(P.corgiOrange, P.accentHot, 0.3);
const copper = mixHex(P.corgiOrange, P.corgiRed, 0.3);

export const CORGI_COATS: Coat[] = [
  { name: 'red', base: P.corgiOrange, light: P.corgiCream, dark: P.corgiRed, pattern: 'plain', nose: P.corgiTri, innerEar: mixHex(P.corgiCream, P.danger, 0.12), iris: amber, brow: mixHex(P.corgiRed, P.corgiTri, 0.55), socks: true, tongue: tonguePink },
  { name: 'sable', base: mixHex(P.corgiOrange, P.corgiRed, 0.35), light: P.corgiCream, dark: mixHex(P.corgiRed, P.corgiTri, 0.45), pattern: 'sable', nose: P.corgiTri, innerEar: mixHex(P.corgiCream, P.danger, 0.12), iris: copper, brow: mixHex(P.corgiRed, P.corgiTri, 0.75), socks: true, tongue: tonguePink },
  { name: 'tri', base: P.corgiOrange, light: P.corgiCream, dark: P.corgiTri, pattern: 'tri', nose: P.corgiTri, innerEar: mixHex(P.corgiCream, P.danger, 0.1), iris: copper, brow: mixHex(P.corgiOrange, P.corgiCream, 0.35), socks: true, tongue: tonguePink },
];

export const CAT_COATS: Coat[] = [
  { name: 'tabby', base: P.catGrey, light: P.catWhite, dark: mixHex(P.catGrey, P.catBlack, 0.6), pattern: 'tabby', nose: pink, innerEar: pink, iris: mixHex(P.tealLight, P.grass, 0.4), brow: mixHex(P.catGrey, P.catBlack, 0.85), socks: false, tongue: tonguePink },
  { name: 'siamese', base: P.catSiamese, light: P.catWhite, dark: mixHex(P.hullDark, P.corgiTri, 0.35), pattern: 'points', nose: mixHex(P.hullDark, P.corgiTri, 0.5), innerEar: mixHex(P.hullDark, P.danger, 0.2), iris: mixHex(P.glowCyan, P.teamCorgis, 0.45), brow: mixHex(P.hullDark, P.corgiTri, 0.7), socks: false, tongue: tonguePink },
  { name: 'chonk', base: mixHex(P.catGrey, P.catWhite, 0.25), light: P.catWhite, dark: P.catGrey, pattern: 'plain', nose: pink, innerEar: pink, iris: P.accentHot, brow: mixHex(P.catGrey, P.catBlack, 0.75), socks: true, tongue: tonguePink },
  { name: 'sphynx', base: mixHex(P.catCream, P.danger, 0.12), light: mixHex(P.catCream, P.catWhite, 0.4), dark: mixHex(P.catCream, P.danger, 0.3), pattern: 'sphynx', nose: darkPink, innerEar: mixHex(P.catCream, P.danger, 0.3), iris: mixHex(P.grassDry, P.tealLight, 0.3), brow: mixHex(P.catCream, P.corgiTri, 0.55), socks: false, tongue: tonguePink },
  { name: 'tuxedo', base: P.catBlack, light: P.catWhite, dark: P.catBlack, pattern: 'tux', nose: pink, innerEar: pink, iris: mixHex(P.accentHot, P.grass, 0.35), brow: mixHex(P.catGrey, P.catWhite, 0.2), socks: true, tongue: tonguePink },
  { name: 'ginger', base: P.catGinger, light: P.corgiCream, dark: mixHex(P.catGinger, P.corgiRed, 0.7), pattern: 'tabby', nose: pink, innerEar: pink, iris: mixHex(P.accentHot, P.grass, 0.55), brow: mixHex(P.corgiRed, P.corgiTri, 0.6), socks: false, tongue: tonguePink },
];

export function coatsFor(species: SpeciesId): Coat[] { return species === Species.Cat ? CAT_COATS : CORGI_COATS; }

// Earned coats (C3 cosmetics) that no seed rolls: they only come from a look.
/** Blue merle: silver-grey fur marbled with black, white blaze/bib/socks, copper brows. */
export const MERLE_COAT: Coat = { name: 'merle', base: mixHex(P.catGrey, P.catWhite, 0.2), light: P.catWhite, dark: mixHex(P.catBlack, P.corgiTri, 0.5), pattern: 'merle', nose: P.corgiTri, innerEar: mixHex(P.corgiCream, P.danger, 0.12), iris: mixHex(P.glowCyan, P.catGrey, 0.55), brow: mixHex(P.corgiOrange, P.corgiRed, 0.35), socks: true, tongue: tonguePink };
/** Calico: white with big ginger and black patches (white muzzle, bib and paws). */
export const CALICO_COAT: Coat = { name: 'calico', base: P.catWhite, light: P.catWhite, dark: P.catBlack, accent: P.catGinger, pattern: 'calico', nose: pink, innerEar: pink, iris: mixHex(P.accentHot, P.grass, 0.45), brow: mixHex(P.catGrey, P.catBlack, 0.7), socks: true, tongue: tonguePink };

// --- body plans ----------------------------------------------------------------------------------

/** Corgi: long torso, stubby legs, huge upright ears, fox-like muzzle, fluffy rear, stub tail. */
export function corgiPlan(): BodyPlan {
  return {
    species: 'corgi',
    hipX: 0.1, hipY: 0.31, kneeY: 0.18, kneeZ: -0.02, ankleY: 0.075, ankleZ: 0.0,
    thighR: 0.078, shinR: 0.058,
    foot: { len: 0.2, w: 0.066, h: 0.055, toeZ: -0.135, heelZ: 0.055 },
    hipsY: 0.36, spineY: 0.47, chestY: 0.58, neckY: 0.71, headY: 0.77,
    torso: {
      y: [0.24, 0.3, 0.38, 0.46, 0.54, 0.62, 0.7, 0.76],
      rx: [0.13, 0.175, 0.198, 0.2, 0.19, 0.175, 0.15, 0.105],
      rz: [0.12, 0.16, 0.18, 0.18, 0.165, 0.148, 0.128, 0.095],
      z: [0.0, 0.0, -0.012, -0.018, -0.01, 0.0, 0.004, 0.008],
    },
    butt: { x: 0.078, y: 0.34, z: 0.12, r: 0.125 },
    shoulder: [0.17, 0.64, -0.03], armAngle: 0.55, upperLen: 0.17, foreLen: 0.155,
    armR: [0.056, 0.049], handR: 0.068,
    cranium: { c: [0, 0.2, 0.0], r: [0.24, 0.22, 0.21] },
    cheek: { c: [0.118, 0.095, -0.09], r: [0.1, 0.078, 0.095], tufts: 1 },
    muzzle: { base: [0, 0.125, -0.12], tip: [0, 0.1, -0.3], rBase: [0.1, 0.078], rTip: [0.055, 0.045] },
    pads: null,
    nose: { c: [0, 0.122, -0.325], r: [0.042, 0.031, 0.031] },
    jaw: { pivot: [0, 0.075, -0.09], a: [0, 0.05, -0.11], b: [0, 0.056, -0.262], r: [0.07, 0.031] },
    eye: { c: [0.094, 0.2, 0], r: 0.058, scale: [1, 1.12, 0.78], tilt: 0.0, look: 0.1, protrude: 0.5 },
    brow: { c: [0.092, 0.3, 0], r: [0.05, 0.017, 0.018] },
    ear: { base: [0.12, 0.31, 0.01], tip: [0.22, 0.62, 0.03], w: 0.08, d: 0.03, mid: 0.45 },
    tail: { base: [0, 0.44, 0.19], pts: [[0, 0.44, 0.19], [0, 0.48, 0.25], [0, 0.52, 0.28], [0, 0.55, 0.3], [0, 0.57, 0.31]], r: [0.06, 0.065, 0.055, 0.04, 0.02], fluffy: true },
  };
}

/** Cat: slimmer, longer legs, round head, wide cheeks, tall pointed ears, long curling tail. */
export function catPlan(chonk = false): BodyPlan {
  const w = chonk ? 1.22 : 1;
  return {
    species: 'cat',
    hipX: 0.085 * (chonk ? 1.15 : 1), hipY: 0.37, kneeY: 0.22, kneeZ: -0.035, ankleY: 0.08, ankleZ: 0.015,
    thighR: 0.065 * (chonk ? 1.2 : 1), shinR: 0.048 * (chonk ? 1.15 : 1),
    foot: { len: 0.17, w: 0.056, h: 0.048, toeZ: -0.115, heelZ: 0.05 },
    hipsY: 0.42, spineY: 0.51, chestY: 0.6, neckY: 0.72, headY: 0.77,
    torso: {
      y: [0.3, 0.36, 0.43, 0.5, 0.57, 0.64, 0.71, 0.77],
      rx: [0.11 * w, 0.15 * w, 0.17 * w, 0.172 * w, 0.165 * w, 0.15 * w, 0.135, 0.1],
      rz: [0.1 * w, 0.135 * w, 0.155 * w, 0.155 * w, 0.14 * w, 0.13 * w, 0.115, 0.085],
      z: [0.0, -0.005, -0.015 * w, -0.02 * w, -0.012, 0.0, 0.004, 0.006],
    },
    butt: null,
    shoulder: [0.155, 0.66, -0.03], armAngle: 0.55, upperLen: 0.17, foreLen: 0.155,
    armR: [0.05 * (chonk ? 1.15 : 1), 0.043 * (chonk ? 1.1 : 1)], handR: 0.058,
    cranium: { c: [0, 0.19, 0.0], r: [0.25 * (chonk ? 1.06 : 1), 0.205, 0.205] },
    cheek: { c: [0.14, 0.085, -0.06], r: [0.115 * (chonk ? 1.12 : 1), 0.08, 0.095], tufts: 1 },
    muzzle: null,
    pads: { c: [0.037, 0.09, -0.19], r: 0.048 },
    nose: { c: [0, 0.13, -0.217], r: [0.028, 0.019, 0.019] },
    jaw: { pivot: [0, 0.075, -0.11], a: [0, 0.05, -0.13], b: [0, 0.05, -0.19], r: [0.046, 0.026] },
    eye: { c: [0.1, 0.2, 0], r: 0.066, scale: [1.02, 1.0, 0.72], tilt: 0.1, look: 0.08, protrude: 0.52 },
    brow: { c: [0.1, 0.3, 0], r: [0.046, 0.015, 0.016] },
    ear: { base: [0.13, 0.28, 0.0], tip: [0.2, 0.5, 0.005], w: 0.09, d: 0.026, mid: 0.4 },
    tail: { base: [0, 0.4, 0.14], pts: [[0, 0.4, 0.14], [0, 0.36, 0.3], [0, 0.44, 0.44], [0, 0.62, 0.5], [0, 0.76, 0.44]], r: [0.045, 0.042, 0.04, 0.037, 0.032], fluffy: false },
  };
}

/** Seat eyes and brows on the cranium surface (so any cranium size keeps the face intact). */
function seatFace(p: BodyPlan): BodyPlan {
  const c = p.cranium.c, r = p.cranium.r;
  const surfZ = (x: number, y: number) => {
    const k = 1 - (x / r[0]) ** 2 - ((y - c[1]) / r[1]) ** 2;
    return c[2] - r[2] * Math.sqrt(Math.max(0.02, k));
  };
  const e = p.eye;
  e.c = [e.c[0], e.c[1], surfZ(e.c[0], e.c[1]) + e.r * e.scale[2] * (1 - 2 * e.protrude)];
  p.brow.c = [p.brow.c[0], p.brow.c[1], surfZ(p.brow.c[0], p.brow.c[1]) - p.brow.r[2] * 0.2];
  return p;
}

/**
 * Class body builds (K1 readability at range): the silhouette carries the role before any gear does.
 * Breacher is broad and heavy-limbed, Infiltrator lean. Widths scale the torso, shoulders and limbs.
 */
export const CLASS_BUILD: Partial<Record<ClassId, { width: number; depth: number; limb: number; shoulder: number }>> = {
  breacher: { width: 1.14, depth: 1.08, limb: 1.16, shoulder: 0.024 },
  infiltrator: { width: 0.88, depth: 0.9, limb: 0.9, shoulder: -0.014 },
};

function applyBuild(p: BodyPlan, cls: ClassId | undefined): BodyPlan {
  const b = cls ? CLASS_BUILD[cls] : undefined;
  if (!b) return p;
  p.torso = { ...p.torso, rx: p.torso.rx.map((r) => r * b.width), rz: p.torso.rz.map((r) => r * b.depth) };
  if (p.butt) p.butt = { ...p.butt, x: p.butt.x * b.width, r: p.butt.r * (1 + (b.width - 1) * 0.6) };
  p.shoulder = [p.shoulder[0] + b.shoulder, p.shoulder[1], p.shoulder[2]];
  p.armR = [p.armR[0] * b.limb, p.armR[1] * b.limb];
  p.thighR *= b.limb; p.shinR *= b.limb;
  p.hipX *= 1 + (b.width - 1) * 0.5;
  return p;
}

/**
 * Scale every head-local measure (cranium, cheeks, muzzle / pads, nose, jaw, eyes, brows, ears) about the head bone,
 * so the face stays in proportion. seatFace re-seats the eyes and brows afterwards.
 */
function scaleHead(p: BodyPlan, s: number): void {
  const v = (a: [number, number, number]): [number, number, number] => [a[0] * s, a[1] * s, a[2] * s];
  const r2 = (a: [number, number]): [number, number] => [a[0] * s, a[1] * s];
  p.cranium = { c: v(p.cranium.c), r: v(p.cranium.r) };
  p.cheek = { ...p.cheek, c: v(p.cheek.c), r: v(p.cheek.r) };
  if (p.muzzle) p.muzzle = { base: v(p.muzzle.base), tip: v(p.muzzle.tip), rBase: r2(p.muzzle.rBase), rTip: r2(p.muzzle.rTip) };
  if (p.pads) p.pads = { c: v(p.pads.c), r: p.pads.r * s };
  p.nose = { c: v(p.nose.c), r: v(p.nose.r) };
  p.jaw = { pivot: v(p.jaw.pivot), a: v(p.jaw.a), b: v(p.jaw.b), r: r2(p.jaw.r) };
  p.eye = { ...p.eye, c: v(p.eye.c), r: p.eye.r * s };
  p.brow = { c: v(p.brow.c), r: v(p.brow.r) };
  p.ear = { ...p.ear, base: v(p.ear.base), tip: v(p.ear.tip), w: p.ear.w * s, d: p.ear.d * s };
}

/**
 * HARDENED proportions (docs/design/HARDENED.md › Pillars 1): veterans, not mascots. A slightly smaller head on a
 * heavier frame: broader chest and shoulders, a thick neck, thick forearms, a wider planted stance, and heavy low
 * brows (the squint lives in the face rig). Corgis keep their short legs, big ears and fox muzzle; cats get about
 * half the bulk, so they stay lithe.
 */
function harden(p: BodyPlan): BodyPlan {
  const k = p.species === 'cat' ? 0.55 : 1;
  const chest = [0, 0, 0.01, 0.03, 0.06, 0.09, 0.12, 0.2];
  const depth = [0, 0, 0.01, 0.02, 0.04, 0.06, 0.08, 0.14];
  p.torso = { ...p.torso, rx: p.torso.rx.map((r, i) => r * (1 + k * chest[i])), rz: p.torso.rz.map((r, i) => r * (1 + k * depth[i])) };
  p.neckR = [0.1 * (1 + 0.18 * k), 0.095 * (1 + 0.16 * k)];
  p.shoulder = [p.shoulder[0] + 0.014 * k, p.shoulder[1], p.shoulder[2]];
  p.armR = [p.armR[0] * (1 + 0.06 * k), p.armR[1] * (1 + 0.16 * k)];
  p.handR *= 1 + 0.04 * k;
  p.thighR *= 1 + 0.05 * k;
  p.shinR *= 1 + 0.08 * k;
  p.hipX *= 1 + 0.08 * k;
  scaleHead(p, 1 - 0.05 * (p.species === 'cat' ? 0.7 : 1));
  // Leaner cheeks (less baby-fat round, more jaw; the fluff stays, tufted) and smaller eyes (less mascot, more squint).
  p.cheek = { ...p.cheek, r: [p.cheek.r[0] * 0.88, p.cheek.r[1] * 0.92, p.cheek.r[2] * 0.95] };
  p.eye = { ...p.eye, r: p.eye.r * 0.9 };
  p.hardened = true;
  // Heavy brow ridge, set low over the eyes.
  p.brow = { c: [p.brow.c[0] * 1.02, p.brow.c[1] - 0.012, p.brow.c[2]], r: [p.brow.r[0] * 1.14, p.brow.r[1] * 1.45, p.brow.r[2] * 1.3] };
  return p;
}

export function planFor(species: SpeciesId, coat: Coat, cls?: ClassId, hardened = false): BodyPlan {
  return planForBreed(species, breedOfCoat(species, coat), cls, hardened);
}

/**
 * `hardened` (the playable cast since K2) applies the HARDENED veteran proportions. Bosses built from these plans
 * (boss/pilot.ts, boss/sniper.ts) keep the classic ones their outfits were fitted to.
 */
export function planForBreed(species: SpeciesId, breed: Breed, cls?: ClassId, hardened = false): BodyPlan {
  const raw = planForRaw(species, breed);
  return seatFace(applyBuild(hardened ? harden(raw) : raw, cls));
}

function planForRaw(species: SpeciesId, breed: Breed): BodyPlan {
  if (species === Species.Cat) {
    const p = catPlan(breed === 'chonk');
    if (breed === 'sphynx') {
      // Hairless: bigger ears, no cheek tufts, whip-thin tail.
      p.ear = { ...p.ear, tip: [0.23, 0.54, 0.01], w: 0.1 };
      p.cheek = { ...p.cheek, r: [0.1, 0.075, 0.09], tufts: 0 };
      p.tail = { ...p.tail, r: [0.034, 0.03, 0.026, 0.022, 0.016] };
      p.hairless = true;
    }
    return p;
  }
  return corgiPlan();
}
