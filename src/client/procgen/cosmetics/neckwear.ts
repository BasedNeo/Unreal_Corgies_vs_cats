// OWNER: C3 cosmetics lane. Neckwear meshes: bandana, name tag, spiked collar, bow tie. Each one takes the spot of
// the team collar (the body is then built without it, see gear.ts `collar`), is skinned to the body skeleton
// (band + bandana flap blend chest → neck like the collar did; hanging parts ride the neck bone rigidly) and is one
// extra draw with the body's vertex-colour toon material, so the outline pass inks it like the fur.
//
// Budget: the dropped team collar + tag frees ~100 triangles; every item stays ≤ NECK_TRI_BUDGET, so the tightest kit
// (corgi overwatch, hero tier: 5,970 with the collar) still fits the 6,000 hero budget with any neckwear.
// Readability: neckwear stays below the head (never touches the class headgear outline, K1) and uses no team hue
// (green, purple, leather, steel, dark teal), so a look never paints the other team's colour on anyone.
import type * as THREE from 'three/webgpu';
import { PALETTE } from '../../style/style-tokens.js';
import { mixHex } from '../characters/colors';
import { MeshBuilder, ellipsoid, sweep, ring, SURF, type Prim, type V3 } from '../characters/mesh-builder';
import { buildRigTemplate } from '../characters/skeleton';
import { armourCollar, chestPlateFront } from '../characters/gear';
import { neckTube, ruffShape } from '../characters/body';
import type { BodyPlan } from '../characters/species';
import type { ClassId } from '../../../shared/types';

/** Neckwear ids with a mesh (neck_none = the team collar, built into the body). */
export const NECKWEAR_IDS = ['neck_bandana', 'neck_nametag', 'neck_spiked', 'neck_bowtie'] as const;
export type NeckwearId = (typeof NECKWEAR_IDS)[number];
export const isNeckwearId = (id: string): id is NeckwearId => (NECKWEAR_IDS as readonly string[]).includes(id);

/** Per item: what dropping the team collar frees on the tightest kit (corgi overwatch, hero: 6,000 − 5,868). */
export const NECK_TRI_BUDGET = 132;

const P = PALETTE;
/** Bandana cloth: garden green (no team hue), a darker rolled band, cream edge. */
const CLOTH = mixHex(P.grass, P.teal, 0.5);
const CLOTH_DARK = mixHex(CLOTH, P.ink, 0.3);
/** Bow tie: purple (far from team blue, crimson and gold). */
const BOW = mixHex(P.danger, P.teamCorgis, 0.5);
const BOW_KNOT = mixHex(BOW, P.ink, 0.35);
const LEATHER = mixHex(mixHex(P.fenceDark, P.mulch, 0.3), P.ink, 0.35);
const STEEL_LIGHT = mixHex(P.concrete, P.catWhite, 0.4);
const STEEL = mixHex(P.concrete, P.catBlack, 0.45);
const STRAP = mixHex(P.tealDark, P.ink, 0.3);

/** Height of the band above the neck bone: the team collar's spot. */
const BAND_LIFT = 0.045;

// --- where the neck is ---------------------------------------------------------------------------------------

/** Far intersection of a ray (origin o, direction d, xz-plane) with an ellipse (centre c, radii a, b); 0 if none. */
function rayEllipse(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, a: number, b: number): number {
  const px = (ox - cx) / a, pz = (oz - cz) / b, qx = dx / a, qz = dz / b;
  const A = qx * qx + qz * qz, B = 2 * (px * qx + pz * qz), C = px * px + pz * pz - 1;
  const disc = B * B - 4 * A * C;
  if (disc < 0) return 0;
  return Math.max(0, (-B + Math.sqrt(disc)) / (2 * A));
}

/**
 * Loop of `n` points around the neck at height `y` (model space, first point at the front, -Z), clearing the neck
 * tube, the chest ruff (body.ts) and, on HARDENED plans, the armour collar (gear.ts) by `margin`: a band that sits on
 * the fluffy ruff instead of sinking into it. The shapes come from the character builders, so a thicker neck or a new
 * ruff moves the neckwear with them.
 */
export function hugLoop(plan: BodyPlan, y: number, margin: number, n: number): V3[] {
  const nt = neckTube(plan);
  const t = Math.min(1, Math.max(0, (y - nt.y0) / (nt.y1 - nt.y0)));
  const nz = nt.z1 * t, nrx = nt.r0[0] + (nt.r1[0] - nt.r0[0]) * t, nrz = nt.r0[1] + (nt.r1[1] - nt.r0[1]) * t;
  // Chest ruff: no tufts on its upper half.
  const ru = ruffShape(plan);
  const ry = (y - ru.c[1]) / ru.r[1];
  const s = Math.abs(ry) < 1 ? Math.sqrt(1 - ry * ry) : 0;
  const ac = plan.hardened ? armourCollar(plan) : null;
  const inCollar = ac && Math.abs(y - ac.y) < ac.h;
  const cz = -0.04;
  const out: V3[] = [];
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2, dx = Math.sin(th), dz = -Math.cos(th);
    let r = rayEllipse(0, cz, dx, dz, 0, nz, nrx, nrz);
    if (s > 0) r = Math.max(r, rayEllipse(0, cz, dx, dz, 0, ru.c[2], ru.r[0] * s, ru.r[2] * s));
    if (ac && inCollar) r = Math.max(r, rayEllipse(0, cz, dx, dz, 0, ac.cz, ac.rx + ac.t, ac.rz + ac.t));
    r += margin;
    out.push([dx * r, y, cz + dz * r]);
  }
  return out;
}

/** Front of the chest ruff (and the armour collar) at height y (the most forward z, x = 0), with the ruff's tufts. */
function ruffFrontZ(plan: BodyPlan, y: number): number {
  const ru = ruffShape(plan);
  const ry = (y - ru.c[1]) / ru.r[1];
  let z = -0.02;
  if (Math.abs(ry) < 1) z = ru.c[2] - ru.r[2] * Math.sqrt(1 - ry * ry) * (ry < 0 ? 1 + ru.tuft : 1);
  const ac = plan.hardened ? armourCollar(plan) : null;
  if (ac && Math.abs(y - ac.y) < ac.h) z = Math.min(z, ac.cz - ac.rz - ac.t);
  return z;
}

// --- primitives ---------------------------------------------------------------------------------------------

/** Closed convex primitive from points + triangles; each triangle is wound to face away from the centroid. */
function convex(pos: number[], idx: number[]): Prim {
  const n = pos.length / 3;
  let cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < n; i++) { cx += pos[3 * i]; cy += pos[3 * i + 1]; cz += pos[3 * i + 2]; }
  cx /= n; cy /= n; cz /= n;
  for (let t = 0; t < idx.length; t += 3) {
    const a = 3 * idx[t], b = 3 * idx[t + 1], c = 3 * idx[t + 2];
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const mx = (pos[a] + pos[b] + pos[c]) / 3 - cx, my = (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3 - cy, mz = (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3 - cz;
    if (nx * mx + ny * my + nz * mz < 0) { const k = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = k; }
  }
  return { pos, uv: new Array((pos.length / 3) * 2).fill(0), idx };
}

/** Pyramid spike: `sides`-gon base of radius r at `base`, apex `len` along unit `dir` (sides + sides − 2 tris). */
function spike(base: V3, dir: V3, r: number, len: number, sides = 4): Prim {
  const up: V3 = Math.abs(dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  // u = up ⊥ dir, w = dir × u
  const k = up[0] * dir[0] + up[1] * dir[1] + up[2] * dir[2];
  let u: V3 = [up[0] - k * dir[0], up[1] - k * dir[1], up[2] - k * dir[2]];
  const ul = Math.hypot(u[0], u[1], u[2]); u = [u[0] / ul, u[1] / ul, u[2] / ul];
  const w: V3 = [dir[1] * u[2] - dir[2] * u[1], dir[2] * u[0] - dir[0] * u[2], dir[0] * u[1] - dir[1] * u[0]];
  const pos: number[] = [], idx: number[] = [];
  for (let i = 0; i < sides; i++) {
    const a = (i / sides) * Math.PI * 2 + Math.PI / sides, c = Math.cos(a) * r, s = Math.sin(a) * r;
    pos.push(base[0] + u[0] * c + w[0] * s, base[1] + u[1] * c + w[1] * s, base[2] + u[2] * c + w[2] * s);
  }
  pos.push(base[0] + dir[0] * len, base[1] + dir[1] * len, base[2] + dir[2] * len);
  for (let i = 0; i < sides; i++) idx.push(i, (i + 1) % sides, sides);
  for (let i = 1; i < sides - 1; i++) idx.push(0, i + 1, i);
  return convex(pos, idx);
}

/** Box from a centre, half extents and a yaw-free frame (12 triangles): tag bars, links. */
function box(c: V3, h: V3): Prim {
  const pos: number[] = [];
  for (const sx of [-1, 1]) for (const sy of [-1, 1]) for (const sz of [-1, 1]) pos.push(c[0] + sx * h[0], c[1] + sy * h[1], c[2] + sz * h[2]);
  // vertex i = (sx, sy, sz) bits 4 / 2 / 1
  const idx = [0, 1, 3, 0, 3, 2, 4, 6, 7, 4, 7, 5, 0, 4, 5, 0, 5, 1, 2, 3, 7, 2, 7, 6, 0, 2, 6, 0, 6, 4, 1, 5, 7, 1, 7, 3];
  return convex(pos, idx);
}

/** Flat triangle "fin" (a thin wedge) from a root edge to a tip: fish tails. 8 triangles. */
function wedge(root: V3, halfH: number, tip: V3, halfT: number, tipH: number): Prim {
  const pos = [
    root[0], root[1] + halfH, root[2] - halfT, root[0], root[1] - halfH, root[2] - halfT,
    root[0], root[1] + halfH, root[2] + halfT, root[0], root[1] - halfH, root[2] + halfT,
    tip[0], tip[1] + tipH, tip[2], tip[0], tip[1] - tipH, tip[2],
  ];
  const idx = [0, 1, 4, 1, 5, 4, 2, 4, 3, 3, 4, 5, 0, 4, 2, 1, 3, 5, 0, 2, 1, 1, 2, 3];
  return convex(pos, idx);
}

const norm2 = (x: number, z: number): [number, number] => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };

// --- the items ----------------------------------------------------------------------------------------------

type Builder = (mb: MeshBuilder, plan: BodyPlan, cls: ClassId) => void;
const BAND: { auto: string[] } = { auto: ['chest', 'neck'] };
const NECK = { rigid: 'neck' } as const;

/** Bandana: a rolled cloth band + a triangle flap over the chest ruff down onto the chest plate's top trim. */
const bandana: Builder = (mb, plan, cls) => {
  const yb = plan.neckY + BAND_LIFT;
  const loop = hugLoop(plan, yb, 0.012, 8);
  mb.add(ring(loop, [0.016, 0.011], 4, [0, 1, 0]), CLOTH_DARK, BAND);
  const zf = loop[0][2];
  const plate = chestPlateFront(plan, cls);
  const tipY = Math.max(plate.top - 0.012, plan.neckY - 0.07);
  const midY = (yb + tipY) / 2;
  const tipZ = Math.min(plate.z, ruffFrontZ(plan, tipY)) - 0.013;
  const midZ = Math.min(ruffFrontZ(plan, midY) - 0.014, (zf + tipZ) / 2);
  const path: V3[] = [[0, yb - 0.004, zf + 0.002], [0, midY, midZ], [0, tipY, tipZ]];
  // Diamond cross-section (4 sides): thin along the depth axis (up = +Z), wide along x, a soft centre fold.
  mb.add(sweep(path, [[0.007, 0.064], [0.007, 0.036], [0.006, 0.008]], 4, { up: [0, 0, 1], capStart: 1, capEnd: 1, capStartLen: 0.2, capEndLen: 0.9 }), CLOTH, BAND);
  // Knot at the back of the neck.
  const back = loop[4];
  mb.add(ellipsoid([back[0], back[1] - 0.006, back[2] + 0.012], [0.028, 0.02, 0.016], 5, 3), CLOTH_DARK, NECK);
};

/** Bow tie: a thin band and a purple bow (two lobes + knot) at the throat, in front of the ruff. */
const bowtie: Builder = (mb, plan) => {
  const yb = plan.neckY + BAND_LIFT - 0.004;
  const loop = hugLoop(plan, yb, 0.009, 8);
  mb.add(ring(loop, [0.01, 0.008], 3, [0, 1, 0]), BOW_KNOT, BAND);
  const f = loop[0];
  const c: V3 = [0, yb - 0.012, f[2] - 0.014];
  for (const k of [-1, 1]) {
    mb.add(ellipsoid([c[0] + k * 0.036, c[1], c[2] + 0.004], [0.036, 0.026, 0.012], 5, 4, { p: 2.4, rot: [0, 0.18 * k, 0.12 * k] }), BOW, NECK);
  }
  mb.add(ellipsoid([c[0], c[1], c[2] - 0.004], [0.014, 0.017, 0.013], 5, 3), BOW_KNOT, NECK);
};

/** Spiked collar: a broad dark leather band with steel pyramid studs all round. */
const spiked: Builder = (mb, plan) => {
  const yb = plan.neckY + BAND_LIFT;
  const loop = hugLoop(plan, yb, 0.014, 8);
  mb.add(ring(loop, [0.02, 0.013], 4, [0, 1, 0]), LEATHER, BAND);
  // Studs point outward and up (a punk collar), so head-on they read as spikes, not flat squares.
  const up = 0.55, k = 1 / Math.hypot(1, up);
  for (const p of loop) {
    const [dx, dz] = norm2(p[0], p[2] + 0.04);
    mb.surface(SURF.metal).add(spike([p[0] + dx * 0.008, p[1] + 0.004, p[2] + dz * 0.008], [dx * k, up * k, dz * k], 0.0135, 0.046), STEEL_LIGHT, NECK);
  }
};

/** Name tag: a dark teal strap with a big steel tag at the throat: a dog bone (corgi) or a fish (cat). */
const nametag: Builder = (mb, plan) => {
  const yb = plan.neckY + BAND_LIFT;
  const loop = hugLoop(plan, yb, 0.01, 8);
  mb.add(ring(loop, [0.012, 0.009], 3, [0, 1, 0]), STRAP, BAND);
  const f = loop[0];
  // The tag hangs right under the strap (its top tucks behind it): no separate link, 12 triangles of margin.
  const ty = yb - (plan.species === 'corgi' ? 0.036 : 0.032);
  const tz = Math.min(f[2], ruffFrontZ(plan, ty)) - 0.012;
  mb.surface(SURF.metal);
  if (plan.species === 'corgi') {
    // Bone: a short bar between two knobby ends.
    mb.add(box([0, ty, tz], [0.03, 0.009, 0.005]), STEEL, NECK);
    for (const k of [-1, 1]) mb.add(ellipsoid([k * 0.034, ty, tz], [0.016, 0.024, 0.008], 5, 4, { p: 2.3 }), STEEL, NECK);
  } else {
    // Fish: an oval body + a forked tail fin.
    mb.add(ellipsoid([0.008, ty, tz], [0.032, 0.02, 0.008], 6, 4), STEEL, NECK);
    mb.add(wedge([-0.018, ty, tz], 0.006, [-0.048, ty, tz], 0.004, 0.018), STEEL, NECK);
  }
};

const BUILDERS: Record<NeckwearId, Builder> = { neck_bandana: bandana, neck_bowtie: bowtie, neck_spiked: spiked, neck_nametag: nametag };

// --- cache --------------------------------------------------------------------------------------------------

export interface NeckwearAsset {
  key: string;
  id: NeckwearId;
  geometry: THREE.BufferGeometry;
  triangles: number;
  refs: number;
}

const cache = new Map<string, NeckwearAsset>();

/**
 * Shared neckwear geometry for one body plan (species + breed + class build: the band hugs that neck and the flap
 * lands on that chest plate). Ref-counted: every acquire needs one releaseNeckwear().
 */
export function acquireNeckwear(id: NeckwearId, plan: BodyPlan, planKey: string, cls: ClassId): NeckwearAsset {
  const key = `${planKey}:${id}`;
  let a = cache.get(key);
  if (a) { a.refs++; return a; }
  const mb = new MeshBuilder(buildRigTemplate(plan));
  // Style surface (the body's toon material reads it with surfaceAttr): cloth and leather, steel studs and tags.
  mb.begin(id).surface(plan.hardened ? SURF.leather : SURF.cloth);
  BUILDERS[id](mb, plan, cls);
  const geometry = mb.build();
  geometry.name = `neckwear_${id}`;
  a = { key, id, geometry, triangles: mb.triangles, refs: 1 };
  cache.set(key, a);
  return a;
}

export function releaseNeckwear(a: NeckwearAsset): void {
  if (--a.refs > 0) return;
  cache.delete(a.key);
  a.geometry.dispose();
}

/** Live cached neckwear geometries (leak tests). */
export function neckwearCacheSize(): number { return cache.size; }
