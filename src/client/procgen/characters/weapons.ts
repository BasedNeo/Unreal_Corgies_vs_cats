// Class weapon props, HARDENED (X3, docs/design/HARDENED.md): weighty, worn, pet-sized tools of war. Hard-surface
// kit bashing from boxes, lofted slabs and flat-capped prisms (far more parts per triangle than the old blobby
// superellipsoids), painted per faction (corgis: hazard ochre + gunmetal, cats: oxblood + charcoal + brass), with
// baked wear: lit tops, grimy undersides, chipped paint at corners (seeded by position, so every kit agrees).
// One pet joke per gun, played straight: dog tag or collar bell charm, the mousetrap snap bar, the laser-pointer
// emitter, tennis-ball rounds, the sprinkler head, the frisbee.
//
// Contract (unchanged, used by characters/index.ts, boss/sniper.ts and the animator): weapon-local frame with the
// origin at the right-hand grip, barrel along -Z, +Y up. One rigid vertex-coloured mesh (crease ink allowed) plus
// one glow part (sights, emitters, ammo) in a single emissive colour. Triangles per weapon never exceed the pre-X3
// counts (WEAPON_TRI_BUDGET), because the character kit budget (6,000 hero / 3,500 NPC) is shared with K2's armor.
import * as THREE from 'three/webgpu';
import { PALETTE } from '../../style/style-tokens.js';
import { Team, type ClassId, type TeamId } from '../../../shared/types';
import { mixHex } from './colors';
import { teamColors } from './gear';
import { MeshBuilder, sweep, isLite, orientOutward, type ColorFn, type Prim, type V3 } from './mesh-builder';

export interface WeaponGeo {
  geometry: THREE.BufferGeometry;
  glow: THREE.BufferGeometry | null;
  glowColor: number;
  /** Left-hand (support) grip point, weapon-local. */
  leftGrip: V3;
  /** Muzzle point, weapon-local. */
  muzzle: V3;
  triangles: number;
  /** Weapon id from the class kit (src/shared/content/classes.ts). */
  id: string;
  /**
   * Material finish hint for the style factory (X3): how metallic / worn / grimy / rough this weapon is (0..1). The kit
   * renders with the body's vertex-colour toon material today; once S4's weathered toon() params land, the kit can
   * pass these through (docs/handoff/X3.md). Also on `geometry.userData.weaponFinish`.
   */
  finish: { metal: number; wear: number; grime: number; rough: number };
}

/**
 * Triangle ceilings per weapon (hero / NPC detail): the pre-X3 counts. The character budgets are nearly full
 * (hero kit 5,970 / 6,000 at C3), so a weapon may get more detail only by spending its own triangles better.
 */
export const WEAPON_TRI_BUDGET: Record<string, { hero: number; npc: number }> = {
  squeaker_rifle: { hero: 498, npc: 338 },
  snap_pistol: { hero: 314, npc: 240 },
  laser_longshot: { hero: 490, npc: 384 },
  tennis_mortar: { hero: 414, npc: 324 },
  sprinkler_cannon: { hero: 375, npc: 301 },
  frisbee_launcher: { hero: 304, npc: 194 },
};

// ---------------------------------------------------------------------------------------------
// Faction finishes (every colour is a palette token or a mix of two)

interface Finish {
  /** Bare blued/parkerized metal: receivers, barrels. */
  metal: number;
  /** Worn-through metal at chipped edges. */
  worn: number;
  /** Dark polymer / rubber: grips, pads. */
  polymer: number;
  /** Faction paint on furniture (stock, handguard, housings). */
  paint: number;
  /** Second faction tone (camo blocks, charms). */
  paint2: number;
  /** Small fittings (charms, buckles, sight posts). */
  fitting: number;
  /** Canvas / tape / sling. */
  canvas: number;
  /** Bore / slots / ports (near-ink). */
  hole: number;
}

// S4's HARDENED tokens when present (style-tokens.js), else mixes of the v1 palette.
const T = PALETTE as Record<string, number>;
const INK = PALETTE.ink;
const GUNMETAL = T.gunmetal ?? mixHex(PALETTE.hullDark, INK, 0.62);
const WORN_STEEL = T.steel ?? mixHex(PALETTE.concrete, PALETTE.hullDark, 0.28);
const POLYMER = mixHex(INK, PALETTE.catBlack, 0.45);
const HOLE = mixHex(INK, PALETTE.catBlack, 0.15);
const OLIVE = T.canvas !== undefined ? mixHex(T.canvas, T.oliveDark ?? T.olive ?? T.canvas, 0.75) : mixHex(PALETTE.grassDark, PALETTE.fenceDark, 0.45);
/** HARDENED corgi gear: hazard ochre (≈ #c8952a). */
const OCHRE = T.hazardOchre ?? mixHex(PALETTE.accentHot, PALETTE.fenceDark, 0.38);
/** HARDENED cat gear: oxblood, charcoal, brass. */
const OXBLOOD = T.oxblood ?? mixHex(PALETTE.danger, INK, 0.5);
const CHARCOAL = T.charcoal ?? mixHex(PALETTE.catBlack, INK, 0.25);
const BRASS = T.brass ?? mixHex(PALETTE.accentHot, PALETTE.fenceDark, 0.42);

function finishFor(team: TeamId): Finish {
  if (team === Team.Cats) {
    return { metal: mixHex(CHARCOAL, GUNMETAL, 0.5), worn: mixHex(WORN_STEEL, BRASS, 0.25), polymer: POLYMER, paint: OXBLOOD, paint2: CHARCOAL, fitting: BRASS, canvas: mixHex(CHARCOAL, OLIVE, 0.35), hole: HOLE };
  }
  return { metal: GUNMETAL, worn: WORN_STEEL, polymer: POLYMER, paint: OCHRE, paint2: mixHex(GUNMETAL, INK, 0.2), fitting: WORN_STEEL, canvas: OLIVE, hole: HOLE };
}

// ---------------------------------------------------------------------------------------------
// Hard-surface primitives. uv.x carries a face tag for painting: 0..5 = -x,+x,-y,+y,-z,+z (boxes) · 6 = side,
// 7 = start cap, 8 = end cap (prisms). Faces get their own vertices so each can be toned; normals are still
// welded by position in MeshBuilder (outline-safe hull), and hard edges come back as crease ink.

const FACE = { nx: 0, px: 1, ny: 2, py: 3, nz: 4, pz: 5, side: 6, cap0: 7, cap1: 8 } as const;

/**
 * Hexahedron from 8 corners: 0..3 = the -Z section (x-y-, x+y-, x+y+, x-y+), 4..7 = the +Z section (same order).
 * Lofted slabs, tapered stocks, slanted grips and plain boxes are all this. 12 triangles.
 */
function hexa(c: V3[]): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  // [corner ids, face tag]
  const quads: [number, number, number, number, number][] = [
    [0, 3, 7, 4, FACE.nx], [1, 5, 6, 2, FACE.px], [0, 4, 5, 1, FACE.ny], [3, 2, 6, 7, FACE.py], [0, 1, 2, 3, FACE.nz], [4, 7, 6, 5, FACE.pz],
  ];
  let cx = 0, cy = 0, cz = 0;
  for (const p of c) { cx += p[0] / 8; cy += p[1] / 8; cz += p[2] / 8; }
  for (const [a, b, cc, d, tag] of quads) {
    const A = c[a], B = c[b], C = c[cc], D = c[d];
    // Orient each quad outward from the body centre (robust to any corner layout).
    const ux = B[0] - A[0], uy = B[1] - A[1], uz = B[2] - A[2], vx = C[0] - A[0], vy = C[1] - A[1], vz = C[2] - A[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const fx = (A[0] + B[0] + C[0] + D[0]) / 4 - cx, fy = (A[1] + B[1] + C[1] + D[1]) / 4 - cy, fz = (A[2] + B[2] + C[2] + D[2]) / 4 - cz;
    const base = pos.length / 3;
    for (const P of [A, B, C, D]) { pos.push(P[0], P[1], P[2]); uv.push(tag, 0); }
    if (nx * fx + ny * fy + nz * fz >= 0) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    else idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  }
  return { pos, uv, idx };
}

/** Axis-aligned box (center, half extents), optionally narrower on top (`topK` × half width) — a cheap chamfer read. */
function box(c: V3, h: V3, topK = 1): Prim {
  const [x, y, z] = c, [a, b, d] = h, t = a * topK;
  return hexa([[x - a, y - b, z - d], [x + a, y - b, z - d], [x + t, y + b, z - d], [x - t, y + b, z - d],
    [x - a, y - b, z + d], [x + a, y - b, z + d], [x + t, y + b, z + d], [x - t, y + b, z + d]]);
}

/** A slab section: centre (y, z) on the x = 0 plane, half width along x, half depth across the slab's long axis. */
type Section = [y: number, z: number, halfW: number, halfD: number];

/**
 * Slab between two sections (grips, magazines): the long axis runs from s0's centre to s1's centre in the YZ plane,
 * and each section is a rectangle across it. Slanted and tapered parts for 12 triangles.
 */
function slab(s0: Section, s1: Section): Prim {
  let ty = s1[0] - s0[0], tz = s1[1] - s0[1];
  const l = Math.hypot(ty, tz) || 1;
  ty /= l; tz /= l;
  const ay = -tz, az = ty; // across the long axis, in the YZ plane
  const ring = ([y, z, w, d]: Section): V3[] => [
    [-w, y - ay * d, z - az * d], [w, y - ay * d, z - az * d], [w, y + ay * d, z + az * d], [-w, y + ay * d, z + az * d],
  ];
  return hexa([...ring(s0), ...ring(s1)]);
}

/**
 * Flat-capped n-gon prism along an axis ('x' | 'y' | 'z') from a0 to a1 at the other two coordinates (p, q), radius
 * r0 → r1. Cap faces are tagged (bores, lenses). `open` leaves the caps off (bands). 2n (+2(n-2)) triangles.
 */
function prism(axis: 'x' | 'y' | 'z', p: number, q: number, a0: number, a1: number, r0: number, r1: number, n: number, open = false, rot = 0): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  const put = (a: number, u: number, v: number): void => {
    if (axis === 'z') pos.push(p + u, q + v, a);
    else if (axis === 'x') pos.push(a, p + u, q + v);
    else pos.push(p + u, a, q + v);
  };
  const ringAt = (a: number, r: number, tag: number) => {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const ang = rot + (i / n) * Math.PI * 2;
      put(a, Math.cos(ang) * r, Math.sin(ang) * r);
      uv.push(tag, i / n);
    }
    return base;
  };
  const s0 = ringAt(a0, r0, FACE.side), s1 = ringAt(a1, r1, FACE.side);
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    idx.push(s0 + i, s0 + j, s1 + j, s0 + i, s1 + j, s1 + i);
  }
  if (!open) {
    const c0 = ringAt(a0, r0, FACE.cap0), c1 = ringAt(a1, r1, FACE.cap1);
    for (let i = 1; i < n - 1; i++) { idx.push(c0, c0 + i + 1, c0 + i); idx.push(c1, c1 + i, c1 + i + 1); }
  }
  // Consistent winding: side quads outward (checked against the axis), caps outward.
  const prim = { pos, uv, idx };
  return open ? fixBand(prim, axis, p, q) : orientOutward(prim);
}

/** Open bands have no volume to orient by: make every triangle face away from the axis. */
function fixBand(pr: Prim, axis: 'x' | 'y' | 'z', p: number, q: number): Prim {
  const P = pr.pos;
  for (let t = 0; t < pr.idx.length; t += 3) {
    const a = 3 * pr.idx[t], b = 3 * pr.idx[t + 1], c = 3 * pr.idx[t + 2];
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
    const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    // Outward = from the axis line to the vertex (the axis component removed).
    const ox = axis === 'x' ? 0 : P[a] - p;
    const oy = axis === 'y' ? 0 : P[a + 1] - (axis === 'x' ? p : q);
    const oz = axis === 'z' ? 0 : P[a + 2] - q;
    if (nx * ox + ny * oy + nz * oz < 0) { const s = pr.idx[t + 1]; pr.idx[t + 1] = pr.idx[t + 2]; pr.idx[t + 2] = s; }
  }
  return pr;
}

/** Flat strap (sling, hose, snap bar) along a polyline: a 4-sided sweep with open ends (never seen end-on). */
function strap(path: V3[], w: number, t: number, up: V3 = [1, 0, 0]): Prim {
  return sweep(path, path.map(() => [t, w] as [number, number]), 4, { up, capStart: 0, capEnd: 0 });
}

/** Low-poly ball (charms, tennis rounds): a diamond-ish UV sphere, W × H. */
function ball(c: V3, r: number, W: number, H: number): Prim {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  pos.push(c[0], c[1] + r, c[2]); uv.push(FACE.side, 0);
  for (let j = 1; j < H; j++) {
    const th = (j / H) * Math.PI;
    for (let i = 0; i < W; i++) {
      const ph = (i / W) * Math.PI * 2 + (j % 2) * (Math.PI / W);
      pos.push(c[0] + Math.sin(th) * Math.cos(ph) * r, c[1] + Math.cos(th) * r, c[2] + Math.sin(th) * Math.sin(ph) * r);
      uv.push(FACE.side, j / H);
    }
  }
  const bot = pos.length / 3;
  pos.push(c[0], c[1] - r, c[2]); uv.push(FACE.side, 1);
  const row = (j: number, i: number) => 1 + (j - 1) * W + (i % W);
  for (let i = 0; i < W; i++) idx.push(0, row(1, i + 1), row(1, i));
  for (let j = 1; j < H - 1; j++) for (let i = 0; i < W; i++) idx.push(row(j, i), row(j, i + 1), row(j + 1, i + 1), row(j, i), row(j + 1, i + 1), row(j + 1, i));
  for (let i = 0; i < W; i++) idx.push(row(H - 1, i), row(H - 1, i + 1), bot);
  return orientOutward({ pos, uv, idx });
}

// ---------------------------------------------------------------------------------------------
// Painting: tone by face, grime underneath, chipped paint / worn metal at corners (position hash).

function hash3(x: number, y: number, z: number, s: number): number {
  let h = Math.imul(Math.round(x * 997) | 0, 0x8da6b343) ^ Math.imul(Math.round(y * 991) | 0, 0xd8163841) ^ Math.imul(Math.round(z * 983) | 0, 0xcb1ab31f) ^ Math.imul(s | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 13), 0x5bd1e995);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

interface PaintOpts {
  /** Chance a corner shows worn metal through (0..1). */
  chip?: number;
  /** Chipped colour (default: the finish's worn metal). */
  chipTo?: number;
  /** Cap face colours for prisms (bores, lens rims). */
  cap0?: number;
  cap1?: number;
  /** Top-face lightening and bottom-face darkening (0..1). */
  lit?: number;
  grime?: number;
}

function painter(F: Finish, seed: number) {
  return (base: number, o: PaintOpts = {}): ColorFn => {
    const chip = o.chip ?? 0, chipTo = o.chipTo ?? F.worn, lit = o.lit ?? 0.14, grime = o.grime ?? 0.22;
    return (x, y, z, u) => {
      let c = base;
      if (u === FACE.cap0 && o.cap0 !== undefined) return o.cap0;
      if (u === FACE.cap1 && o.cap1 !== undefined) return o.cap1;
      if (u === FACE.py) c = mixHex(c, F.worn, lit);
      else if (u === FACE.ny) c = mixHex(c, INK, grime);
      else if (u === FACE.nx || u === FACE.nz) c = mixHex(c, INK, grime * 0.35);
      if (chip > 0 && hash3(x, y, z, seed) < chip) c = mixHex(c, chipTo, 0.62);
      return c;
    };
  };
}

// Per-part style surfaces [rough, metal, grime, wear] (the `surface` vertex attribute of S4's weathered toon; used when
// the weapon material reads it with surfaceAttr, else the per-weapon `finish` applies to the whole gun).
type Surf = readonly [number, number, number, number];
const S_METAL: Surf = [0.36, 0.85, 0.35, 0.55];
const S_PAINT: Surf = [0.55, 0.15, 0.45, 0.75];
const S_POLY: Surf = [0.78, 0, 0.35, 0.25];
const S_CANVAS: Surf = [0.92, 0, 0.5, 0.1];
const S_TAPE: Surf = [0.7, 0, 0.4, 0.35];

// ---------------------------------------------------------------------------------------------

export function buildWeapon(cls: ClassId, team: TeamId, q: number): WeaponGeo {
  const tc = teamColors(team);
  const F = finishFor(team);
  const cat = team === Team.Cats;
  const lite = isLite(q);
  const mb0 = new MeshBuilder(null);
  const gl = new MeshBuilder(null);
  const paint = painter(F, cls.length * 31 + team);
  // Parts are added through `mb`, which tags each with a style surface from its tone (MeshBuilder.surface, when the
  // character kit's builder has it).
  const surfOf = new Map<unknown, Surf>();
  const canSurf = typeof (mb0 as unknown as { surface?: unknown }).surface === 'function';
  const mb = {
    add(p: Prim, color: number | ColorFn): void {
      if (canSurf) (mb0 as unknown as { surface(s: Surf): void }).surface(surfOf.get(color) ?? S_TAPE);
      mb0.add(p, color);
    },
  };
  // Tones, each registered with its style surface
  const tagged = (c: ColorFn, s: Surf) => { surfOf.set(c, s); return c; };
  const metalBare = (o: PaintOpts) => tagged(paint(F.metal, o), S_METAL);
  const paint2 = (o: PaintOpts) => tagged(paint(F.paint2, o), S_PAINT);
  const paintMain = (o: PaintOpts) => tagged(paint(F.paint, o), S_PAINT);
  const fitting = (o: PaintOpts) => tagged(paint(F.fitting, o), S_METAL);
  const canvas = tagged(paint(F.canvas, { lit: 0.1 }), S_CANVAS);
  const metal = metalBare({ chip: 0.28, chipTo: F.worn, lit: 0.18 });
  const painted = paintMain({ chip: 0.34, chipTo: F.metal, lit: 0.12 });
  const polymer = tagged(paint(F.polymer, { chip: 0.12, chipTo: F.worn, lit: 0.1 }), S_POLY);
  const hole = F.hole;
  surfOf.set(hole, S_METAL);
  const n6 = lite ? 5 : 6, n8 = lite ? 6 : 8, n10 = lite ? 8 : 10;
  /** A faction charm on a sling swivel: a stamped dog tag (corgis) or a collar bell (cats). */
  const charm = (p: V3) => {
    if (lite) return;
    if (cat) mb.add(ball([p[0], p[1] - 0.022, p[2]], 0.013, 5, 3), fitting({ lit: 0.3 }));
    else mb.add(box([p[0], p[1] - 0.026, p[2]], [0.003, 0.018, 0.012]), tagged(paint(F.worn, { lit: 0.25 }), S_METAL));
  };
  let leftGrip: V3 = [0, -0.02, -0.2], muzzle: V3 = [0, 0.06, -0.5], glowColor: number = PALETTE.tennisBall, id = '';
  let fin = { metal: 0.3, wear: 0.5, grime: 0.4, rough: 0.62 };

  switch (cls) {
    case 'assault': { // Squeaker Rifle / Hairball Repeater: battered bullpup-length assault rifle, banana mag, optic
      id = 'squeaker_rifle';
      // receiver (slightly narrower top = chamfered read), top rail
      mb.add(box([0, 0.05, -0.06], [0.042, 0.052, 0.17], 0.82), metal);
      mb.add(box([0, 0.111, -0.09], [0.017, 0.009, 0.15]), metalBare({ chip: 0.4, lit: 0.3 }));
      // handguard (faction paint) + barrel + muzzle brake with a dark bore
      mb.add(box([0, 0.055, -0.305], [0.037, 0.043, 0.09], 0.8), painted);
      mb.add(prism('z', 0, 0.06, -0.39, -0.52, 0.016, 0.016, n6), metal);
      mb.add(prism('z', 0, 0.06, -0.515, -0.585, 0.026, 0.024, n8, false, Math.PI / 8), metalBare({ chip: 0.5, cap1: hole, lit: 0.2 }));
      mb.add(box([0, 0.1, -0.375], [0.009, 0.024, 0.011]), metal); // front sight post / gas block
      // optic on a riser mount
      mb.add(box([0, 0.128, -0.09], [0.016, 0.012, 0.04]), metal);
      mb.add(prism('z', 0, 0.158, -0.015, -0.165, 0.027, 0.027, n8, false, Math.PI / 8), paint2({ chip: 0.35, cap1: hole, cap0: hole }));
      gl.add(prism('z', 0, 0.158, -0.012, -0.016, 0.011, 0.011, n6), 0); // eyepiece glow (the lens you see from behind)
      // curved banana mag (two lofted slabs) + base plate
      mb.add(slab([0.0, -0.105, 0.026, 0.036], [-0.1, -0.115, 0.027, 0.037]), metal);
      mb.add(slab([-0.1, -0.115, 0.027, 0.037], [-0.185, -0.16, 0.028, 0.038]), metal);
      mb.add(box([0, -0.192, -0.163], [0.031, 0.009, 0.043]), paintMain({ chip: 0.5 }));
      // pistol grip (slanted), foregrip, trigger guard
      mb.add(slab([0.005, 0.0, 0.017, 0.026], [-0.1, 0.035, 0.019, 0.028]), polymer);
      mb.add(slab([0.012, -0.24, 0.016, 0.02], [-0.085, -0.228, 0.018, 0.022]), polymer);
      // stock: lofted, drops toward the butt; rubber pad
      mb.add(hexa([[-0.034, 0.0, 0.11], [0.034, 0.0, 0.11], [0.03, 0.095, 0.11], [-0.03, 0.095, 0.11],
        [-0.038, -0.05, 0.28], [0.038, -0.05, 0.28], [0.032, 0.088, 0.28], [-0.032, 0.088, 0.28]]), painted);
      mb.add(box([0, 0.02, 0.29], [0.04, 0.074, 0.012]), polymer);
      // charging handle
      mb.add(box([0.052, 0.075, -0.02], [0.011, 0.008, 0.009]), metal);
      if (!lite) {
        mb.add(box([0, -0.012, -0.03], [0.008, 0.012, 0.03]), metal); // trigger guard
        mb.add(box([0, 0.105, 0.18], [0.024, 0.016, 0.06]), polymer); // cheek riser
        mb.add(box([0.043, 0.07, -0.055], [0.002, 0.014, 0.032]), hole); // ejection port
        for (const s of [-1, 1]) mb.add(box([0.038 * s, 0.055, -0.3], [0.002, 0.018, 0.05]), hole); // handguard vents
        mb.add(prism('z', 0, 0.158, -0.16, -0.185, 0.031, 0.031, n8, false, Math.PI / 8), metalBare({ cap1: hole })); // sun hood
        // sling along the right side: rear swivel on the stock, a shallow sag past the mag, front swivel
        mb.add(strap([[0.041, -0.035, 0.24], [0.047, -0.07, 0.1], [0.047, -0.075, -0.1], [0.044, -0.03, -0.3], [0.041, 0.018, -0.36]], 0.008, 0.002), canvas);
      }
      // team tape on the handguard (signal colour stays readable), second band of trim
      mb.add(box([0, 0.055, -0.36], [0.04, 0.046, 0.011], 0.8), tc.main);
      if (!lite) mb.add(box([0, 0.055, -0.338], [0.04, 0.046, 0.005], 0.8), tc.trim);
      charm([0.04, -0.03, 0.245]);
      glowColor = PALETTE.tennisBall;
      leftGrip = [0, -0.035, -0.235]; muzzle = [0, 0.06, -0.595];
      fin = { metal: 0.35, wear: 0.65, grime: 0.4, rough: 0.62 };
      break;
    }
    case 'infiltrator': { // Snap Pistol / Claw Snapper: heavy suppressed sidearm, weapon light, mousetrap snap bar
      id = 'snap_pistol';
      mb.add(box([0, 0.078, -0.075], [0.026, 0.025, 0.118], 0.8), metal); // slide
      mb.add(box([0, 0.037, -0.07], [0.024, 0.018, 0.098]), paint2({ chip: 0.25 })); // frame
      mb.add(slab([0.02, 0.012, 0.025, 0.028], [-0.09, 0.045, 0.027, 0.03]), polymer); // grip
      mb.add(box([0, -0.002, -0.035], [0.007, 0.017, 0.028]), metal); // trigger guard
      mb.add(prism('z', 0, 0.078, -0.19, -0.36, 0.024, 0.024, n8, false, Math.PI / 8), metalBare({ chip: 0.3, cap1: hole })); // suppressor
      mb.add(box([0, 0.004, -0.14], [0.016, 0.014, 0.042]), paintMain({ chip: 0.35 })); // light / laser module
      gl.add(prism('z', 0, 0.004, -0.182, -0.186, 0.011, 0.011, n6), 0);
      mb.add(box([0, 0.106, -0.18], [0.004, 0.006, 0.006]), metal); // front sight
      mb.add(box([0, -0.094, 0.047], [0.028, 0.007, 0.032]), metal); // mag base
      // the mousetrap snap bar riding the slide (the one joke, in worn brass)
      mb.add(strap([[-0.03, 0.09, 0.02], [-0.03, 0.125, -0.06], [0.03, 0.125, -0.06], [0.03, 0.09, 0.02]], 0.006, 0.006, [0, 0, 1]), tagged(paint(BRASS, { lit: 0.3 }), S_METAL));
      if (!lite) {
        for (const s of [-1, 1]) {
          mb.add(box([0.026 * s, 0.078, 0.02], [0.0015, 0.016, 0.018]), hole); // slide serrations
          mb.add(box([0.027 * s, -0.035, 0.03], [0.002, 0.034, 0.02]), paintMain({ chip: 0.3 })); // grip panels
        }
        mb.add(box([0, 0.106, 0.03], [0.012, 0.006, 0.006]), metal); // rear sight
        mb.add(box([0, 0.095, 0.05], [0.006, 0.012, 0.008]), metal); // hammer
      }
      mb.add(box([0, 0.078, -0.26], [0.026, 0.026, 0.009], 1), tc.main); // team band on the can
      charm([0.02, -0.09, 0.05]);
      glowColor = PALETTE.laserRed;
      leftGrip = [-0.034, -0.04, 0.012]; muzzle = [0, 0.078, -0.37];
      fin = { metal: 0.45, wear: 0.5, grime: 0.3, rough: 0.55 };
      break;
    }
    case 'overwatch': { // Laser Longshot / Red Dot Lance: bolt-action heavy sniper, big glass, laser-pointer emitter
      id = 'laser_longshot';
      mb.add(box([0, 0.045, -0.02], [0.03, 0.038, 0.16], 0.82), metal); // receiver
      mb.add(prism('z', 0, 0.05, -0.18, -0.66, 0.02, 0.017, n8, false, Math.PI / 8), metal); // heavy barrel
      mb.add(prism('z', 0, 0.05, -0.655, -0.74, 0.03, 0.03, n8, false, Math.PI / 8), metalBare({ chip: 0.45, cap1: hole })); // emitter housing
      gl.add(prism('z', 0, 0.05, -0.74, -0.745, 0.018, 0.018, n8), 0); // the laser pointer's eye
      mb.add(box([0, 0.03, -0.29], [0.031, 0.03, 0.12], 0.8), painted); // forend
      // scope: tube, objective and ocular bells, rings
      mb.add(prism('z', 0, 0.128, 0.05, -0.2, 0.021, 0.021, n8, false, Math.PI / 8), paint2({ chip: 0.3 }));
      mb.add(prism('z', 0, 0.128, -0.2, -0.285, 0.023, 0.035, n10, false, 0), paint2({ chip: 0.35, cap1: hole }));
      mb.add(prism('z', 0, 0.128, 0.05, 0.1, 0.025, 0.027, n8, false, Math.PI / 8), paint2({ cap1: hole }));
      gl.add(prism('z', 0, 0.128, -0.285, -0.289, 0.026, 0.026, n8), 0); // objective glint
      for (const z of [-0.12, 0.02]) mb.add(box([0, 0.098, z], [0.024, 0.02, 0.012]), metal);
      // bolt, magazine, grip, thumbhole stock + pad + cheek riser
      mb.add(box([0.05, 0.062, 0.06], [0.02, 0.006, 0.006]), metal);
      mb.add(box([0, -0.03, -0.04], [0.022, 0.036, 0.036]), metal);
      mb.add(slab([0.005, 0.0, 0.017, 0.026], [-0.1, 0.035, 0.019, 0.028]), polymer);
      mb.add(hexa([[-0.03, -0.005, 0.14], [0.03, -0.005, 0.14], [0.028, 0.08, 0.14], [-0.028, 0.08, 0.14],
        [-0.034, -0.07, 0.36], [0.034, -0.07, 0.36], [0.03, 0.07, 0.36], [-0.03, 0.07, 0.36]]), painted);
      mb.add(box([0, 0.0, 0.37], [0.036, 0.074, 0.012]), polymer);
      if (!lite) {
        mb.add(box([0, 0.098, 0.25], [0.022, 0.016, 0.08]), polymer); // cheek riser
        mb.add(box([0.062, 0.062, 0.06], [0.008, 0.01, 0.01]), polymer); // bolt knob
        for (const s of [-1, 1]) mb.add(box([0.016 * s, -0.004, -0.41], [0.005, 0.006, 0.11]), metal); // folded bipod legs
        mb.add(box([0, 0.0, -0.3], [0.024, 0.008, 0.016]), metal); // bipod yoke
        mb.add(box([0, 0.16, -0.06], [0.009, 0.014, 0.009]), metal); // elevation turret
        mb.add(box([0.034, 0.128, -0.06], [0.013, 0.009, 0.009]), metal); // windage turret
      }
      mb.add(box([0, 0.045, 0.3], [0.036, 0.05, 0.012], 0.85), tc.main); // team band on the stock
      charm([0.035, -0.05, 0.3]);
      glowColor = PALETTE.laserRed;
      leftGrip = [0, -0.005, -0.2]; muzzle = [0, 0.05, -0.75];
      fin = { metal: 0.35, wear: 0.5, grime: 0.35, rough: 0.6 };
      break;
    }
    case 'breacher': { // Tennis Mortar / Yarnball Lobber: stubby launcher tube, hinged breech, carry handle, ball bandolier
      id = 'tennis_mortar';
      mb.add(prism('z', 0, 0.08, 0.14, -0.37, 0.068, 0.066, n10, false, 0), paintMain({ chip: 0.38, chipTo: F.metal, cap1: hole, cap0: F.metal })); // tube
      mb.add(prism('z', 0, 0.08, -0.35, -0.43, 0.078, 0.078, n10, false, 0), metalBare({ chip: 0.45, cap1: hole })); // muzzle ring
      mb.add(box([0, 0.08, 0.17], [0.07, 0.07, 0.04], 0.85), metal); // breech block
      mb.add(box([-0.075, 0.06, 0.15], [0.008, 0.018, 0.022]), metal); // hinge
      mb.add(strap([[0, 0.15, 0.1], [0, 0.2, 0.06], [0, 0.2, -0.14], [0, 0.15, -0.2]], 0.014, 0.01, [1, 0, 0]), metal); // carry handle
      mb.add(slab([0.015, 0.02, 0.018, 0.026], [-0.09, 0.05, 0.02, 0.028]), polymer); // pistol grip
      mb.add(slab([0.015, -0.17, 0.016, 0.02], [-0.08, -0.16, 0.018, 0.022]), polymer); // front grip
      mb.add(box([0, 0.08, 0.225], [0.06, 0.062, 0.016]), polymer); // shoulder pad
      // tennis-ball rounds in a side bandolier (felt, not lamps: HARDENED keeps bloom for real emitters)
      const balls = lite ? 2 : 3;
      const felt = tagged(paint(PALETTE.tennisBall, { lit: 0.08, grime: 0.3 }), S_CANVAS);
      for (let i = 0; i < balls; i++) mb.add(ball([0.087, 0.07, -0.08 + i * 0.07], 0.029, lite ? 5 : 6, lite ? 3 : 4), felt);
      gl.add(box([0, lite ? 0.152 : 0.19, -0.3], [0.004, 0.004, 0.004]), 0); // the leaf sight's lit pip (on the tube at NPC detail)
      mb.add(box([0.07, 0.07, -0.01], [0.012, 0.02, 0.1]), canvas); // bandolier strip
      if (!lite) {
        mb.add(prism('z', 0, 0.08, -0.22, -0.26, 0.07, 0.07, n10, true, 0), tc.trim); // hazard stripe band
        mb.add(box([0, 0.165, -0.3], [0.022, 0.02, 0.004]), metal); // leaf sight
        mb.add(strap([[-0.074, 0.03, 0.18], [-0.078, -0.01, 0.06], [-0.078, -0.012, -0.16], [-0.074, 0.03, -0.3]], 0.01, 0.002), canvas);
      }
      mb.add(prism('z', 0, 0.08, -0.29, -0.33, 0.07, 0.07, n10, true, 0), tc.main); // team band
      charm([-0.074, 0.03, 0.18]);
      glowColor = PALETTE.tennisBall;
      leftGrip = [0, -0.035, -0.165]; muzzle = [0, 0.08, -0.44];
      fin = { metal: 0.25, wear: 0.7, grime: 0.5, rough: 0.68 };
      break;
    }
    case 'warden': { // Sprinkler Cannon / Hiss Blaster: pump riot gun off a garden sprinkler — pressure tank, hose, nozzle
      id = 'sprinkler_cannon';
      mb.add(box([0, 0.055, -0.03], [0.036, 0.048, 0.1], 0.82), metal); // receiver
      mb.add(prism('z', 0, 0.075, -0.12, -0.43, 0.026, 0.026, n8, false, Math.PI / 8), metal); // barrel
      mb.add(prism('z', 0, 0.028, -0.12, -0.37, 0.019, 0.019, n6), metal); // magazine tube
      mb.add(box([0, 0.03, -0.26], [0.03, 0.03, 0.065], 0.85), painted); // pump
      // sprinkler nozzle: flared head with a dark throat
      mb.add(prism('z', 0, 0.075, -0.42, -0.475, 0.032, 0.052, n10, false, 0), fitting({ chip: 0.3, cap1: hole, lit: 0.25 }));
      // pressure tank on top + glowing sight glass (cyan water)
      mb.add(prism('z', 0, 0.15, 0.06, -0.2, 0.034, 0.034, n10, false, 0), paintMain({ chip: 0.35, chipTo: F.metal }));
      gl.add(box([0.034, 0.15, -0.07], [0.002, 0.005, 0.055]), 0); // sight glass
      mb.add(slab([0.01, 0.045, 0.018, 0.026], [-0.095, 0.075, 0.02, 0.028]), polymer); // grip
      mb.add(hexa([[-0.03, 0.0, 0.07], [0.03, 0.0, 0.07], [0.028, 0.09, 0.07], [-0.028, 0.09, 0.07],
        [-0.034, -0.035, 0.22], [0.034, -0.035, 0.22], [0.03, 0.08, 0.22], [-0.03, 0.08, 0.22]]), painted); // stubby stock
      mb.add(box([0, 0.022, 0.23], [0.036, 0.062, 0.012]), polymer); // pad
      if (!lite) {
        for (const z of [-0.23, -0.29]) mb.add(box([0, 0.03, z], [0.033, 0.033, 0.006], 0.85), polymer); // pump ribs
        for (let i = 0; i < 3; i++) { // nozzle spokes
          const a = (i / 3) * Math.PI * 2 + Math.PI / 2;
          mb.add(box([Math.cos(a) * 0.05, 0.075 + Math.sin(a) * 0.05, -0.465], [0.008, 0.008, 0.012]), fitting({ lit: 0.3 }));
        }
        mb.add(strap([[-0.03, 0.15, 0.06], [-0.05, 0.12, 0.1], [-0.05, 0.05, 0.1], [-0.037, 0.04, 0.04]], 0.009, 0.009, [0, 0, 1]), tagged(paint(F.polymer, { lit: 0.15 }), S_POLY)); // hose
        for (let i = 0; i < 3; i++) mb.add(box([0.037, 0.03 + i * 0.022, 0.15], [0.005, 0.009, 0.022]), i === 1 ? paintMain({ lit: 0.2 }) : tagged(paint(PALETTE.danger, { lit: 0.2 }), S_POLY)); // side-saddle shells
      }
      mb.add(prism('z', 0, 0.15, -0.14, -0.165, 0.037, 0.037, n10, true, 0), tc.main); // team band on the tank
      charm([0.037, -0.04, 0.2]);
      glowColor = PALETTE.glowCyan;
      leftGrip = [0, -0.005, -0.26]; muzzle = [0, 0.075, -0.48];
      fin = { metal: 0.3, wear: 0.55, grime: 0.45, rough: 0.62 };
      break;
    }
    case 'skyraider': { // Frisbee Launcher / Saucer Flinger: flat flywheel launcher with a loaded disc
      id = 'frisbee_launcher';
      mb.add(box([0, 0.03, -0.08], [0.07, 0.03, 0.16], 0.9), painted); // body
      for (const s of [-1, 1]) mb.add(box([0.078 * s, 0.05, -0.2], [0.018, 0.028, 0.045]), metal); // flywheel housings
      // the loaded disc (team trim) with a glowing rim band
      mb.add(prism('y', 0, -0.18, 0.076, 0.094, 0.1, 0.1, lite ? 8 : 12, false, 0), tagged(paint(tc.trim, { cap1: mixHex(tc.trim, PALETTE.catWhite, 0.2), lit: 0.1 }), S_POLY));
      gl.add(prism('y', 0, -0.18, 0.083, 0.088, 0.102, 0.102, lite ? 8 : 12, true, 0), 0);
      mb.add(slab([0.005, 0.0, 0.017, 0.026], [-0.1, 0.035, 0.019, 0.028]), polymer); // grip
      mb.add(slab([0.005, -0.17, 0.016, 0.02], [-0.08, -0.16, 0.018, 0.022]), polymer); // foregrip
      mb.add(hexa([[-0.03, 0.0, 0.08], [0.03, 0.0, 0.08], [0.028, 0.06, 0.08], [-0.028, 0.06, 0.08],
        [-0.032, -0.04, 0.22], [0.032, -0.04, 0.22], [0.03, 0.06, 0.22], [-0.03, 0.06, 0.22]]), metal); // skeleton stock
      mb.add(box([0, 0.01, 0.23], [0.034, 0.055, 0.012]), polymer);
      if (!lite) {
        mb.add(prism('y', 0, 0.07, 0.06, 0.09, 0.075, 0.075, 10, false, 0), paint2({ lit: 0.12, chip: 0.2 })); // spare disc stack
        mb.add(box([0, 0.12, -0.02], [0.008, 0.02, 0.01]), metal); // sight post
      }
      mb.add(box([0, 0.03, 0.03], [0.072, 0.032, 0.012], 0.9), tc.main); // team band
      charm([0.03, -0.03, 0.2]);
      glowColor = PALETTE.glowCyan;
      leftGrip = [0, -0.035, -0.165]; muzzle = [0, 0.085, -0.3];
      fin = { metal: 0.2, wear: 0.5, grime: 0.3, rough: 0.58 };
      break;
    }
  }
  const geometry = mb0.build();
  geometry.userData.weaponFinish = fin;
  const glow = gl.triangles > 0 ? gl.build() : null;
  return { geometry, glow, glowColor, leftGrip, muzzle, triangles: mb0.triangles + gl.triangles, id, finish: fin };
}
