// The Lot's prop catalog: every solid piece emits its collider and its visual together (Kit.solid / solidCyl /
// slab), with the collider's standing surface equal to the visual top (tests/unit/lot-world.test.ts checks it).
// Decals (stencils, pallet gaps, rust streaks, window glass) are 'noink' prims a few cm proud of a face and are not
// standing surfaces. Pure data, no three, no Math.random (callers pass a seeded rng for jitter).
import type { Lamp } from '../world-types';
import { Kit, type Frame } from '../kit';
import { yawToward } from '../queries';
import { CONTAINER, FLOOD, GANGWAY, HEAP, SCAFFOLD } from './layout';

export type HeightFn = (x: number, z: number) => number;

/** Lowest terrain under a yawed rect footprint (corners, edge midpoints, centre): props sit on it, never float. */
export function groundMin(height: HeightFn, x: number, z: number, hx: number, hz: number, yaw = 0): number {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  let lo = Infinity;
  for (const u of [-1, 0, 1]) for (const v of [-1, 0, 1]) {
    const lx = u * hx, lz = v * hz;
    lo = Math.min(lo, height(x + lx * c + lz * s, z - lx * s + lz * c));
  }
  return lo;
}

/**
 * A sloped solid slab (gangway, scaffold ramp): top face from `top` to `bot` (edge centres, world), `width` across,
 * `thick` below the top face. Collider and visual share one transform (the same math as Frame.ramp).
 */
export function slab(kit: Kit, type: string, top: [number, number, number], bot: [number, number, number], width: number, thick: number, col: string): void {
  const [tx, ty, tz] = top, [bx, by, bz] = bot;
  const dx = bx - tx, dy = by - ty, dz = bz - tz;
  const hl = Math.hypot(dx, dz), len = Math.hypot(hl, dy);
  const yaw = Math.atan2(dx, dz), pitch = Math.atan2(-dy, hl);
  const sp = Math.sin(pitch), cp = Math.cos(pitch);
  const nx = sp * Math.sin(yaw), ny = cp, nz = sp * Math.cos(yaw);
  const cx = (tx + bx) / 2 - (nx * thick) / 2, cy = (ty + by) / 2 - (ny * thick) / 2, cz = (tz + bz) / 2 - (nz * thick) / 2;
  kit.colBox(type, cx, cy, cz, width / 2, thick / 2, len / 2, yaw, pitch, 0);
  kit.prims.push({ s: 'box', x: cx, y: cy, z: cz, a: width, b: thick, c: len, yaw, pitch, col, bev: 0.04 });
}

// ============================================================================================ site-office container
/**
 * Site-office container: long axis z, open ends (walk through), a side door, 0.3 m floor, corner posts, end headers,
 * high windows, corrugation stripes, two ceiling tubes. `door.side` +1 = east face (+x), -1 = west.
 */
export function container(kit: Kit, x: number, y0: number, z: number, col: string, stripe: string, door: { side: 1 | -1; z: number }, lamps: Lamp[]): void {
  const { L, W, H, wall, floor, doorW, doorH } = CONTAINER;
  const f = kit.frame(x, y0, z, 0);
  f.solid('container_floor', 0, floor / 2, 0, W, floor, L, 'gunmetal', { bev: 0.04 });
  f.solid('container_roof', 0, H - 0.2, 0, W, 0.4, L, col, { bev: 0.08 });
  const wallTop = H - 0.4, wallH = wallTop;
  for (const s of [-1, 1] as const) {
    const wx = s * (W / 2 - wall / 2);
    const segs: [number, number][] = door.side === s
      ? [[-L / 2, door.z - z - doorW / 2], [door.z - z + doorW / 2, L / 2]]
      : [[-L / 2, L / 2]];
    for (const [a, b] of segs) f.solid('container_wall', wx, wallH / 2, (a + b) / 2, wall, wallH, b - a, col, { bev: 0.06 });
    if (door.side === s) {
      const dz = door.z - z;
      f.solid('container_wall', wx, (doorH + wallTop) / 2, dz, wall, wallTop - doorH, doorW, col, { bev: 0.06 });
      // door frame (proud trim) + the door leaf swung open against the wall
      f.box(wx + s * 0.24, doorH / 2, dz - doorW / 2 - 0.15, 0.1, doorH, 0.3, 'trim', { g: 'noink', bev: 0 });
      f.box(wx + s * 0.24, doorH / 2, dz + doorW / 2 + 0.15, 0.1, doorH, 0.3, 'trim', { g: 'noink', bev: 0 });
      f.box(wx + s * 0.24, doorH + 0.15, dz, 0.1, 0.3, doorW + 0.6, 'trim', { g: 'noink', bev: 0 });
      // the leaf swings toward the container's middle (never past its ends)
      const leafZ = dz - Math.sign(dz || 1) * (doorW / 2 + 0.3 + (doorW - 0.2) / 2);
      f.solid('container_door', wx + s * 0.45, doorH / 2 + 0.05, leafZ, 0.3, doorH - 0.2, doorW - 0.2, 'steel', { bev: 0.05 });
    }
    // corrugation stripes on the outer face (skip the door opening), windows high on the wall, a rust streak
    for (let zz = -L / 2 + 1.2; zz < L / 2 - 0.9; zz += 1.6) {
      if (door.side === s && Math.abs(zz - (door.z - z)) < doorW / 2 + 0.7) continue;
      f.box(s * (W / 2 + 0.02), wallH / 2, zz, 0.04, wallH - 1.2, 0.35, stripe, { g: 'noink', bev: 0 });
    }
    for (const wz of [-6.5, 6.5]) {
      if (door.side === s && Math.abs(wz - (door.z - z)) < doorW / 2 + 2) continue;
      f.box(s * (W / 2 + 0.05), 6.6, wz, 0.1, 3.0, 4.2, 'trim', { g: 'noink', bev: 0 });
      f.box(s * (W / 2 + 0.08), 6.6, wz, 0.1, 2.4, 3.6, 'glass', { g: 'noink', bev: 0 });
    }
    f.box(s * (W / 2 + 0.06), 3.4, -2.4 * s, 0.08, 3.6, 0.9, 'rust', { g: 'noink', bev: 0 });
  }
  // corner posts and end headers (inside the wall/roof envelope)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.solid('container_post', sx * (W / 2 - 0.3), H / 2, sz * (L / 2 - 0.3), 0.6, H, 0.6, 'gunmetal', { bev: 0.05 });
  for (const sz of [-1, 1]) f.solid('container_header', 0, H - 0.7, sz * (L / 2 - 0.3), W - 1.2, 0.6, 0.6, 'gunmetal', { bev: 0.05 });
  // roof edge trim + a hazard band along the eaves (decals)
  for (const s of [-1, 1]) f.box(s * (W / 2 + 0.05), H - 0.2, 0, 0.1, 0.3, L, 'hazardOchre', { g: 'noink', bev: 0 });
  // two fluorescent tubes under the roof (lamps view: glowing tubes)
  for (const lz of [-5, 5]) {
    const [lx, ly, lzW] = f.w(0, H - 1.0, lz);
    lamps.push({ x: lx, y: ly, z: lzW, len: 3.2, yaw: 0, col: 'lampTube' });
    f.box(0, H - 0.72, lz, 0.5, 0.18, 3.6, 'metal', { g: 'noink', bev: 0 });
  }
}

/** The gangway up to a container roof: a sloped steel slab, a landing flush with the roof, posts under both. */
export function gangway(kit: Kit, roofY: number): void {
  const G = GANGWAY;
  slab(kit, 'gangway', [G.x, roofY, G.zTop], [G.x, 0, G.zLow], G.width, 0.3, 'steel');
  const [z0, z1] = G.landing;
  const lx0 = -69.7, lx1 = G.x + G.width / 2;
  const f = kit.frame(0, 0, 0, 0);
  f.solid('gangway_landing', (lx0 + lx1) / 2, roofY - 0.15, (z0 + z1) / 2, lx1 - lx0, 0.3, z1 - z0, 'steel', { bev: 0.04 });
  for (const px of [lx0 + 0.25, lx1 - 0.25]) for (const pz of [z0 + 0.25, z1 - 0.25]) f.solid('gangway_post', px, (roofY - 0.3) / 2, pz, 0.3, roofY - 0.3, 0.3, 'gunmetal', { bev: 0 });
  // posts under the slab (their tops meet its underside)
  for (const pz of [-50, -56]) {
    const t = (pz - G.zLow) / (G.zTop - G.zLow);
    const under = t * roofY - 0.3 / Math.cos(Math.atan2(roofY, G.zTop - G.zLow)) - 0.05;
    f.solid('gangway_post', G.x, under / 2, pz, 0.3, under, 0.3, 'gunmetal', { bev: 0 });
  }
  // hazard nosing at the top and the foot (decals)
  f.box(G.x, roofY + 0.015, G.zTop - 0.3, G.width - 0.1, 0.03, 0.5, 'hazardOchre', { g: 'noink', bev: 0 });
}

// ============================================================================================ cement-bag wall
/**
 * A wall of cement bags ("sandbags") from (x0, z0) to (x1, z1): `rows` rows of 0.55 m, staggered (half bags at the
 * row ends of odd rows), one collider box. An even bag count keeps the top row's joints off the wall's centre.
 */
export function bagWall(kit: Kit, height: HeightFn, x0: number, z0: number, x1: number, z1: number, rows = 2): { x: number; z: number; len: number; yaw: number; top: number } {
  const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
  let n = Math.max(2, Math.round(len / 2.4));
  if (n % 2) n++;
  const bl = len / n, D = 1.6, BH = 0.55;
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  const y0 = groundMin(height, cx, cz, D / 2, len / 2, yaw) - 0.04;
  const f = kit.frame(cx, y0, cz, yaw);
  f.colBox('bags', 0, (rows * BH) / 2, 0, D, rows * BH, len);
  for (let r = 0; r < rows; r++) {
    // even rows: n full bags; odd rows: a half bag, n - 1 full bags, a half bag (running bond)
    const lens = r % 2 ? [bl / 2, ...Array<number>(n - 1).fill(bl), bl / 2] : Array<number>(n).fill(bl);
    let z = -len / 2;
    lens.forEach((l, k) => {
      // (W9: pale paper cement sacks, a canvas one in three: the W8 sandbag browns read near-black in the canyon's shade)
      f.box(0, r * BH + BH / 2, z + l / 2, D, BH, l, (r + k) % 3 === 1 ? 'canvas' : 'bannerRag', { bev: Math.min(0.15, l / 4) });
      z += l;
    });
  }
  // printed bands on the outer face of the top row (decals)
  for (let k = 0; k < n; k += 2) f.box(D / 2 + 0.02, rows * BH - BH / 2, -len / 2 + bl * (k + 0.5), 0.04, 0.16, bl * 0.5, 'khaki', { g: 'noink', bev: 0 });
  return { x: cx, z: cz, len, yaw, top: y0 + rows * BH };
}

// ============================================================================================ pallets, crates
/** A stack of n pallets (0.6 m each), footprint w (local x) by d (local z); gaps drawn as dark decals. Returns the top. */
export function palletStack(kit: Kit, height: HeightFn, x: number, z: number, yaw: number, n: number, w = 4.8, d = 4.0): number {
  const y0 = groundMin(height, x, z, w / 2, d / 2, yaw) - 0.03;
  const f = kit.frame(x, y0, z, yaw);
  const H = n * 0.6;
  f.solid('pallet', 0, H / 2, 0, w, H, d, 'plywood', { bev: 0.05 });
  for (let i = 0; i < n; i++) {
    const gy = i * 0.6 + 0.3;
    for (const s of [-1, 1]) {
      for (const gx of [-1.2, 1.2]) f.box(gx, gy, s * (d / 2 + 0.015), 1.3, 0.28, 0.03, 'fenceDark', { g: 'noink', bev: 0 });
      f.box(s * (w / 2 + 0.015), gy, 0, 0.03, 0.28, d - 1.6, 'fenceDark', { g: 'noink', bev: 0 });
    }
    f.box(0, (i + 1) * 0.6 - 0.02, d / 2 + 0.016, w - 0.3, 0.035, 0.03, 'plywoodDark', { g: 'noink', bev: 0 });
  }
  return y0 + H;
}

/** An ammo crate (tennis balls for the corgis, tuna tins for the cats): stencil band + an emblem decal. */
export function ammoCrate(kit: Kit, height: HeightFn, x: number, z: number, yaw: number, team: 0 | 1): void {
  const w = 2.6, h = 1.8, d = 1.8;
  const y0 = groundMin(height, x, z, w / 2, d / 2, yaw) - 0.03;
  const f = kit.frame(x, y0, z, yaw);
  f.solid('crate', 0, h / 2, 0, w, h, d, team === 0 ? 'fenceWood' : 'oliveDark', { bev: 0.08 });
  for (const s of [-1, 1]) {
    f.box(0, h * 0.7, s * (d / 2 + 0.02), w - 0.2, 0.26, 0.04, 'crateStencil', { g: 'noink', bev: 0 });
    f.sphere(0, h * 0.38, s * (d / 2 + 0.03), 0.36, 0.36, 0.05, team === 0 ? 'tennisBall' : 'tin', { g: 'noink', seg: 10 });
  }
  for (const s of [-1, 1]) f.box(s * (w / 2 + 0.02), h / 2, 0, 0.04, h - 0.3, 0.3, team === 0 ? 'teamCorgisTrim' : 'teamCats', { g: 'noink', bev: 0 });
}

// ============================================================================================ middle clutter
/** Upright cable drum: flanges + a wound core; the collider is the flange cylinder. */
export function cableDrum(kit: Kit, height: HeightFn, x: number, z: number, cable: string, r = 2.4, h = 3.2): void {
  const y0 = groundMin(height, x, z, r * 0.8, r * 0.8) - 0.05;
  const f = kit.frame(x, y0, z, 0);
  f.colCyl('drum', 0, h / 2, 0, r, h / 2);
  for (const y of [0.18, h - 0.18]) f.cyl(0, y, 0, r, 0.36, r, 'plywoodDark', { seg: 16 });
  f.cyl(0, h / 2, 0, r * 0.84, h - 0.7, r * 0.84, cable, { seg: 16 });
  f.cyl(0, h + 0.02, 0, 0.5, 0.04, 0.5, 'gunmetal', { seg: 10, g: 'noink' });
}

/** A bundle of rebar (square bars, flush) on three timber bearers. */
export function rebarBundle(kit: Kit, height: HeightFn, x: number, z: number, yaw: number, len = 18): void {
  const y0 = groundMin(height, x, z, 0.9, len / 2, yaw) - 0.04;
  const f = kit.frame(x, y0, z, yaw);
  for (const lz of [-len / 2 + 1.5, 0, len / 2 - 1.5]) f.solid('bearer', 0, 0.2, lz, 1.8, 0.4, 0.6, 'fenceDark', { bev: 0.05 });
  f.colBox('rebar', 0, 0.4 + 0.45, 0, 1.2, 0.9, len);
  // bars flush side by side; their ends are staggered by 0.5 m but stay inside the collider
  for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) f.box(-0.45 + c * 0.3, 0.4 + 0.15 + r * 0.3, (c + r) % 2 ? 0.25 : -0.25, 0.3, 0.3, len - 0.5, 'rust', { bev: 0 });
  for (const lz of [-len / 3, len / 3]) f.box(0, 0.85, lz, 1.26, 0.96, 0.14, 'wire', { g: 'noink', bev: 0 });
}

/** Traffic cone. Collider: the rubber base (exact) + an upright cylinder inscribed in the lower cone (a cone can't be
 *  a box or an upright cylinder; tests check the cylinder stays inside the visual). */
export function trafficCone(kit: Kit, height: HeightFn, x: number, z: number, yaw: number): void {
  const y0 = height(x, z) - 0.03;
  const f = kit.frame(x, y0, z, yaw);
  f.solid('cone_base', 0, 0.1, 0, 1.5, 0.2, 1.5, 'catBlack', { bev: 0.05 });
  f.cone(0, 0.2 + 1.2, 0, 0.62, 2.4, 'accent', { seg: 12 });
  f.cyl(0, 1.25, 0, 0.36, 0.42, 0.45, 'catWhite', { seg: 12, g: 'noink' });
  f.colCyl('cone', 0, 0.2 + 0.62, 0, 0.29, 0.62);
}

/** Traffic barrel (upright, exact cylinder collider) with reflective bands. */
export function trafficBarrel(kit: Kit, height: HeightFn, x: number, z: number): void {
  const y0 = height(x, z) - 0.05;
  const f = kit.frame(x, y0, z, 0);
  f.solidCyl('barrel', 0, 1.4, 0, 0.95, 2.8, 1.0, 'accent', { seg: 14 });
  for (const y of [0.9, 1.9]) f.cyl(0, y, 0, 1.0, 0.34, 1.01, 'catWhite', { seg: 14, g: 'noink' });
  f.cyl(0, 2.85, 0, 0.7, 0.1, 0.8, 'catBlack', { seg: 12, g: 'noink' });
}

/** A skip under a tarp: a solid steel body, a tarp cap, lifting lugs. */
export function skip(kit: Kit, height: HeightFn, x: number, z: number, yaw: number): void {
  const L = 12, W = 6, H = 4.2;
  const y0 = groundMin(height, x, z, W / 2, L / 2, yaw) - 0.05;
  const f = kit.frame(x, y0, z, yaw);
  f.solid('skip', 0, H / 2, 0, W, H, L, 'hazardOchre', { bev: 0.12 });
  f.solid('skip', 0, H + 0.2, 0, W + 0.4, 0.4, L + 0.4, 'olive', { bev: 0.18 });
  for (const s of [-1, 1]) {
    f.box(s * (W / 2 + 0.05), H * 0.55, 0, 0.1, 0.5, L - 1, 'rust', { g: 'noink', bev: 0 });
    for (const lz of [-3.5, 3.5]) f.box(s * (W / 2 + 0.06), H * 0.8, lz, 0.12, 0.8, 0.5, 'gunmetal', { g: 'noink', bev: 0 });
  }
  for (const s of [-1, 1]) f.box(0, H * 0.45, s * (L / 2 + 0.05), W - 0.6, 0.6, 0.1, 'camoBlack', { g: 'noink', bev: 0 });
}

// ============================================================================================ floodlight tower
/**
 * Mobile floodlight tower: ballast block, mast, a lamp bar with FLOOD.heads housings aimed at `aim` (pitched down at
 * it). Pushes one sodium Lamp per head (the glowing lens bar) and returns the heads' world positions (S4's lights).
 */
export function floodTower(kit: Kit, height: HeightFn, x: number, z: number, aim: readonly [number, number], lamps: Lamp[]): [number, number, number][] {
  const y0 = groundMin(height, x, z, 1.6, 1.6) - 0.05;
  const base = kit.frame(x, y0, z, 0);
  base.solid('flood_base', 0, 0.6, 0, 3.2, 1.2, 3.2, 'hazardOchre', { bev: 0.12 });
  base.box(0, 1.215, 0, 2.6, 0.03, 2.6, 'camoBlack', { g: 'noink', bev: 0 });
  for (const s of [-1, 1]) base.box(s * 1.62, 0.6, 0, 0.04, 0.5, 2.6, 'camoBlack', { g: 'noink', bev: 0 });
  const M = FLOOD.mast;
  base.solidCyl('flood_mast', 0, 1.2 + (M - 1.2) / 2, 0, 0.3, M - 1.2, 0.4, 'gunmetal', { seg: 10 });
  const yaw = Math.atan2(aim[0] - x, aim[1] - z);
  const gy = height(aim[0], aim[1]);
  const pitch = Math.atan2(y0 + M - gy, Math.hypot(aim[0] - x, aim[1] - z));
  const head = kit.frame(x, y0 + M, z, yaw);
  head.solid('flood_bar', 0, 0.2, 0, 6.4, 0.4, 0.4, 'gunmetal', { bev: 0.05 });
  const out: [number, number, number][] = [];
  for (let i = 0; i < FLOOD.heads; i++) {
    const lx = -2.4 + i * 1.6;
    head.solid('flood_head', lx, 0.95, 0.2, 1.3, 0.95, 0.7, 'camoBlack', { pitch, bev: 0.06 });
    // lens: a glowing sodium bar on the housing's front face (local +z, pitched)
    const fz = 0.2 + 0.36 * Math.cos(pitch), fy = 0.95 - 0.36 * Math.sin(pitch);
    const [wx, wy, wz] = head.w(lx, fy, fz);
    lamps.push({ x: wx, y: wy, z: wz, len: 1.05, yaw: yaw + Math.PI / 2, col: 'sodium' });
    out.push([wx, wy, wz]);
  }
  return out;
}

// ============================================================================================ portable toilet
export function portableToilet(kit: Kit, height: HeightFn, x: number, z: number, yaw: number): void {
  const W = 4.4, H = 9.2;
  const y0 = groundMin(height, x, z, W / 2, W / 2, yaw) - 0.05;
  const f = kit.frame(x, y0, z, yaw);
  f.solid('toilet', 0, H / 2, 0, W, H, W, 'plasticBlue', { bev: 0.25 });
  f.solid('toilet', 0, H + 0.3, 0, W + 0.4, 0.6, W + 0.4, 'catWhite', { bev: 0.25 });
  f.box(0, 3.9, W / 2 + 0.03, 2.8, 7.2, 0.06, 'trimShade', { g: 'noink', bev: 0 });
  f.box(1.0, 4.0, W / 2 + 0.08, 0.3, 0.9, 0.08, 'teamCats', { g: 'noink', bev: 0 });     // the "occupied" tab
  f.box(0, 7.9, W / 2 + 0.07, 1.6, 0.25, 0.06, 'catBlack', { g: 'noink', bev: 0 });       // vent slot
  f.solidCyl('toilet_vent', 1.3, H + 1.3, -1.3, 0.3, 1.4, 0.3, 'catWhite', { seg: 8 });
}

// ============================================================================================ scaffold (cat base)
/**
 * The cats' scaffold on the heap's north edge: 5 bays, deck 1 (+4.4 over the heap top) along the whole run with
 * north/south toe boards (0.6 m: chest cover), a crow's nest (+8.8) over bay 4 reached by a ramp in bay 3's south
 * half, ramps from the heap top at both ends, standards, ledgers, overhead rails, facade braces, a cat banner.
 */
export function scaffold(kit: Kit): { deckY: number; nestY: number } {
  const S = SCAFFOLD, base = HEAP.top, Y1 = base + S.deck, Y2 = base + S.nest, T = 0.3, TOE = 0.6;
  const f = kit.frame(0, 0, 0, 0);
  const zc = (S.z0 + S.z1) / 2, D = S.z1 - S.z0;
  const xs: number[] = [];
  for (let x = S.x0; x <= S.x1 + 1e-6; x += S.bay) xs.push(x);
  // deck 1 (one slab per bay) + board lines
  for (let i = 0; i + 1 < xs.length; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    f.solid('scaffold_deck', cx, Y1 - T / 2, zc, S.bay, T, D, 'plywood', { bev: 0.04 });
    for (let k = 1; k < 5; k++) f.box(cx, Y1 + 0.006, S.z0 + (D * k) / 5, S.bay - 0.2, 0.012, 0.06, 'plywoodDark', { g: 'noink', bev: 0 });
  }
  // nest (deck 2) over bay 4, ramp in bay 3's south half
  const nx0 = xs[3], nx1 = xs[4], rz0 = S.z0 + D / 2 - 0.15, rz1 = S.z1 - 0.15;
  f.solid('scaffold_deck', (nx0 + nx1) / 2, Y2 - T / 2, zc, nx1 - nx0, T, D, 'plywood', { bev: 0.04 });
  slab(kit, 'scaffold_ramp', [nx0, Y2, (rz0 + rz1) / 2], [xs[2], Y1, (rz0 + rz1) / 2], rz1 - rz0, T, 'fenceWood');
  // ramps from the heap top onto deck 1 at both ends (centred on the deck width)
  const rw = 2.4;
  slab(kit, 'scaffold_ramp', [S.x0, Y1, zc], [S.x0 - S.rampRun, base, zc], rw, T, 'fenceWood');
  slab(kit, 'scaffold_ramp', [S.x1, Y1, zc], [S.x1 + S.rampRun, base, zc], rw, T, 'fenceWood');
  // toe boards: deck 1 north + south (south stops short of the nest ramp's foot? no: the ramp is inside it), nest sides
  const toe = (x0: number, x1: number, z: number, y: number) => f.solid('toe_board', (x0 + x1) / 2, y + TOE / 2, z, x1 - x0, TOE, 0.15, 'fenceWood', { bev: 0.03 });
  const toeZ = (z0: number, z1: number, x: number, y: number) => f.solid('toe_board', x, y + TOE / 2, (z0 + z1) / 2, 0.15, TOE, z1 - z0, 'fenceWood', { bev: 0.03 });
  toe(S.x0, S.x1, S.z0 + 0.075, Y1);
  toe(S.x0, S.x1, S.z1 - 0.075, Y1);
  toe(nx0, nx1, S.z0 + 0.075, Y2);
  toe(nx0, nx1, S.z1 - 0.075, Y2);
  toeZ(S.z0 + 0.15, rz0, nx0 + 0.075, Y2);                  // nest west edge: north half (the ramp arrives south)
  toeZ(S.z0 + 0.15, S.z1 - 0.15, nx1 - 0.075, Y2);           // nest east edge
  // standards (vertical tubes) at every frame, both faces; the nest frames run up past deck 2
  for (const x of xs) for (const z of [S.z0, S.z1]) {
    const top = (x === nx0 || x === nx1 ? Y2 : Y1) + 2.6;
    f.solidCyl('standard', x, (base + top) / 2, z, 0.12, top - base, 0.12, 'steel', { seg: 8 });
    f.box(x, base + 0.03, z, 0.6, 0.06, 0.6, 'gunmetal', { g: 'noink', bev: 0 });
  }
  // ledgers under the deck slabs (along x, both faces) and transoms (along z) at every frame
  f.solid('ledger', (S.x0 + S.x1) / 2, Y1 - T - 0.1, S.z0 + 0.1, S.x1 - S.x0, 0.2, 0.2, 'steel', { bev: 0 });
  f.solid('ledger', (S.x0 + S.x1) / 2, Y1 - T - 0.1, S.z1 - 0.1, S.x1 - S.x0, 0.2, 0.2, 'steel', { bev: 0 });
  for (const x of xs) f.solid('ledger', x, Y1 - T - 0.1, zc, 0.2, 0.2, D - 0.4, 'steel', { bev: 0 });
  f.solid('ledger', (nx0 + nx1) / 2, Y2 - T - 0.1, S.z0 + 0.1, nx1 - nx0, 0.2, 0.2, 'steel', { bev: 0 });
  f.solid('ledger', (nx0 + nx1) / 2, Y2 - T - 0.1, S.z1 - 0.1, nx1 - nx0, 0.2, 0.2, 'steel', { bev: 0 });
  // overhead guard rails (2.4 m over the decks: above a pet's head, the scaffold read) on the north face
  f.solid('rail', (S.x0 + S.x1) / 2, Y1 + 2.4, S.z0 - 0.15, S.x1 - S.x0, 0.2, 0.2, 'steel', { bev: 0 });
  f.solid('rail', (nx0 + nx1) / 2, Y2 + 2.4, S.z0 - 0.15, nx1 - nx0, 0.2, 0.2, 'steel', { bev: 0 });
  f.solid('rail', (nx0 + nx1) / 2, Y2 + 2.4, S.z1 + 0.15, nx1 - nx0, 0.2, 0.2, 'steel', { bev: 0 });
  // facade braces in the end bays (north face, outside the standards). The low end meets its standard 1.8 m up, over a
  // pet's head: a brace down to heap level wedged pets walking the heap-top path under it (W9 F2: a bot pinned 6.5 s
  // at (15.3, 96); the nav probe at the cell centre cleared it by 0.13 m).
  const braceLo = base + 1.8;
  for (const [xa, xb] of [[xs[0], xs[1]], [xs[4], xs[5]]]) {
    const len = Math.hypot(xb - xa, Y1 - T - braceLo), roll = Math.atan2(Y1 - T - braceLo, xb - xa) * (xa === xs[0] ? 1 : -1);
    f.solid('brace', (xa + xb) / 2, (braceLo + Y1 - T) / 2, S.z0 - 0.35, len, 0.2, 0.2, 'steel', { roll, bev: 0 });
  }
  // cat banner hanging off deck 1's north edge (cloth: visual only, above head height) + a flag on the nest
  for (const bx of [xs[1] + 4.8, xs[4] + 4.8]) {
    f.box(bx, Y1 - 2.2, S.z0 - 0.45, 6.4, 3.6, 0.12, 'teamCats', { g: 'soft', bev: 0.04 });
    f.box(bx, Y1 - 3.7, S.z0 - 0.47, 6.4, 0.5, 0.14, 'catBlack', { g: 'soft', bev: 0.04 });
  }
  f.solidCyl('flag_pole', nx1 - 0.6, Y2 + 4.2, S.z1 - 0.6, 0.12, 8.4, 0.14, 'metal', { seg: 8 });
  f.box(nx1 - 0.6 - 2.3, Y2 + 7.1, S.z1 - 0.6, 4.4, 2.8, 0.12, 'teamCats', { g: 'soft', bev: 0.04 });
  f.box(nx1 - 0.6 - 2.3, Y2 + 6.0, S.z1 - 0.6, 4.4, 0.5, 0.14, 'catBlack', { g: 'soft', bev: 0.04 });
  f.sphere(nx1 - 0.6, Y2 + 8.5, S.z1 - 0.6, 0.35, 0.35, 0.35, 'catBlack', { seg: 8 });
  return { deckY: Y1, nestY: Y2 };
}

/** A banner pole (team colours) planted on the ground. */
export function bannerPole(f: Frame, team: 0 | 1): void {
  const main = team === 0 ? 'teamCorgis' : 'teamCats', trim = team === 0 ? 'teamCorgisTrim' : 'catBlack';
  f.solid('banner_base', 0, 0.3, 0, 1.6, 0.6, 1.6, 'concrete', { bev: 0.08 });
  f.solidCyl('banner_pole', 0, 0.6 + 6.5, 0, 0.16, 13, 0.2, 'metal', { seg: 8 });
  f.box(-2.45, 11.4, 0, 4.6, 3.0, 0.14, main, { g: 'soft', bev: 0.04 });
  f.box(-2.45, 10.2, 0, 4.6, 0.6, 0.16, trim, { g: 'soft', bev: 0.04 });
  f.sphere(0, 13.75, 0, 0.42, 0.42, 0.42, trim, { seg: 10 });
}

/** Concrete footing block (the foundation grid in the pit) with formwork boards on two sides. */
export function footing(kit: Kit, height: HeightFn, x: number, z: number, yaw: number): void {
  const w = 3.2, h = 1.4;
  const y0 = groundMin(height, x, z, w / 2, w / 2, yaw) - 0.04;
  const f = kit.frame(x, y0, z, yaw);
  f.solid('footing', 0, h / 2, 0, w, h, w, 'concrete', { bev: 0.06 });
  for (const s of [-1, 1]) f.box(s * (w / 2 + 0.02), h * 0.5, 0, 0.04, h - 0.2, w - 0.2, 'plywood', { g: 'noink', bev: 0 });
  f.box(0.6, h + 0.012, -0.4, 1.2, 0.024, 0.9, 'oilStain', { g: 'noink', bev: 0 });
}

export { yawToward };
