// The Lot's edges and skyline: plywood hoarding (N, E, S) with the site gate, the West Yard's board fence (W) with
// the West Yard itself reading beyond it, the neighbours' house over the north hoarding, the tower crane south of the
// lot, and a ring of rooftops and trees. Everything outside LOT_EDGE is visual only (unreachable, no colliders).
import type { FenceRun } from '../world-types';
import type { Kit } from '../kit';
import type { Rng } from '../noise';
import { CRANE, GATE, LOT_EDGE } from './layout';

export const HOARD_H = 9.6;
export const FENCE_H = 8;
const PANEL = 4.8;

/** Solid wall along a straight run (collider only) + an invisible blocker above it up to +60 m. */
function wallCollider(kit: Kit, type: string, x0: number, z0: number, x1: number, z1: number, h: number, thick: number): void {
  const len = Math.hypot(x1 - x0, z1 - z0), yaw = Math.atan2(x1 - x0, z1 - z0);
  const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
  kit.colBox(type, cx, (h - 2) / 2, cz, thick / 2, (h + 2) / 2, len / 2 + 0.3, yaw);
  kit.colBox('boundary', cx, h + 30, cz, 0.4, 30, len / 2 + 0.5, yaw);
}

/**
 * Hoarding along a side: plywood panels (alternating olive tones, hazard-striped signs every few panels), posts and
 * raking struts on the outside. `inward` is the unit normal pointing into the lot.
 */
function hoardingRun(kit: Kit, x0: number, z0: number, x1: number, z1: number, inward: [number, number], gate?: { t0: number; t1: number }): void {
  const len = Math.hypot(x1 - x0, z1 - z0), dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const yaw = Math.atan2(dx, dz);               // local +z along the run, local +x = (dz, -dx)
  const n = Math.round(len / PANEL), w = len / n;
  // local x sign that points into the lot
  const lxIn = Math.sign(inward[0] * dz - inward[1] * dx) || 1;
  const T = 0.3;
  wallCollider(kit, 'hoarding', x0 - inward[0] * T / 2, z0 - inward[1] * T / 2, x1 - inward[0] * T / 2, z1 - inward[1] * T / 2, HOARD_H, T);
  const f = kit.frame(x0, 0, z0, yaw);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) * w;
    const inGate = gate && t > gate.t0 && t < gate.t1;
    f.box(-lxIn * T / 2, HOARD_H / 2 - 0.1, t, T, HOARD_H + 0.2, w - 0.05, inGate ? 'gunmetal' : i % 2 ? 'olive' : 'oliveDark', { bev: 0.05 });
    if (inGate) {
      // gate leaves: steel frame + diagonal hazard bars on the inner face
      f.box(lxIn * 0.03, HOARD_H / 2, t, 0.06, HOARD_H - 0.6, w - 0.6, 'steel', { g: 'noink', bev: 0 });
      f.box(lxIn * 0.07, HOARD_H * 0.45, t, 0.06, 0.5, w * 1.1, 'hazardOchre', { g: 'noink', bev: 0, pitch: 0.9 });
    } else if (i % 7 === 3) {
      // a site-safety sign on the inner face (hazard board with a black band)
      f.box(lxIn * 0.03, 5.2, t, 0.06, 3.2, 2.6, 'hazardOchre', { g: 'noink', bev: 0 });
      f.box(lxIn * 0.06, 5.9, t, 0.06, 0.5, 2.2, 'camoBlack', { g: 'noink', bev: 0 });
    }
    // posts at the panel joints, outside
    f.box(-lxIn * (T + 0.25), HOARD_H / 2, i * w, 0.4, HOARD_H + 0.4, 0.4, 'gunmetal', { bev: 0 });
    if (i % 2 === 0) f.box(-lxIn * (T + 2.4), 4.2, i * w + 0.01, 0.3, 9.4, 0.3, 'gunmetal', { roll: -lxIn * 0.5, bev: 0 });
  }
  f.box(-lxIn * (T + 0.25), HOARD_H / 2, len, 0.4, HOARD_H + 0.4, 0.4, 'gunmetal', { bev: 0 });
}

/** Board-fence colliders for a FenceRun (boards are drawn by the client's fence view) + a blocker above. */
function fenceColliders(kit: Kit, f: FenceRun): void {
  wallCollider(kit, 'fence', f.x0, f.z0, f.x1, f.z1, f.h, 0.6);
}

/** Perimeter: hoarding N / E / S (gate on the east side), the West Yard's board fence W. */
export function perimeter(kit: Kit): FenceRun[] {
  const E = LOT_EDGE;
  hoardingRun(kit, -E, -E, E, -E, [0, 1]);                                   // north
  hoardingRun(kit, E, -E, E, E, [-1, 0], { t0: GATE.z0 + E, t1: GATE.z1 + E }); // east (runs +z from z = -E)
  hoardingRun(kit, E, E, -E, E, [0, -1]);                                    // south
  const west: FenceRun = { x0: -E, z0: -E, x1: -E, z1: E, h: FENCE_H, face: -1 };
  fenceColliders(kit, west);
  // corner posts where the fence meets the hoarding
  for (const z of [-E, E]) {
    const c = kit.frame(-E, 0, z, 0);
    c.box(0, (FENCE_H + 0.8) / 2, 0, 0.9, FENCE_H + 0.8, 0.9, 'fenceDark', { bev: 0.12 });
    c.cone(0, FENCE_H + 1.1, 0, 0.62, 0.9, 'fenceDark', { seg: 4, yaw: Math.PI / 4 });
  }
  return [west];
}

// ============================================================================================ skyline
/** Gable house block (visual): facade faces -z in its frame. */
function house(kit: Kit, x: number, z: number, yaw: number, w: number, d: number, h: number, ridge: number, wall: string, windows = 4): void {
  const f = kit.frame(x, 0, z, yaw);
  f.box(0, h / 2, 0, w, h, d, wall, { bev: 0.4 });
  f.box(0, h + 0.6, 0, w + 3, 1.2, d + 3, 'trim', { bev: 0.3 });
  const half = d / 2 + 1.5, pitch = Math.atan2(ridge, half), len = Math.hypot(half, ridge) + 0.6;
  for (const s of [-1, 1]) f.box(0, h + 1.2 + ridge / 2, (s * half) / 2, w + 5, 1.2, len, 'roof', { pitch: s * pitch, bev: 0.3 });
  f.box(0, h + 1.8 + ridge, 0, w + 5.5, 1.0, 1.4, 'roof', { bev: 0.3 });
  for (const s of [-1, 1]) for (let i = 0; i < windows; i++) {
    const wx = -w / 2 + (w * (i + 0.5)) / windows;
    for (const wy of [h * 0.3, h * 0.72]) {
      f.box(wx, wy, s * (d / 2 + 0.3), 7, 6, 0.6, 'trim', { g: 'noink', bev: 0.1 });
      f.box(wx, wy, s * (d / 2 + 0.55), 5.8, 4.8, 0.3, 'glass', { g: 'noink', bev: 0.05 });
    }
  }
  f.box(w * 0.3, h + ridge * 0.7 + 5, d * 0.1, 3.4, 12, 3.4, 'brick', { bev: 0.2 });
}

function roundTree(kit: Kit, rng: Rng, x: number, z: number, s: number): void {
  const t = kit.frame(x, 0, z, 0);
  t.cyl(0, 9 * s, 0, 1.6 * s, 18 * s, 2.4 * s, 'bark', { seg: 8 });
  for (let k = 0; k < 4; k++) {
    const a = k * 1.9 + rng.range(0, 0.6), r = rng.range(7, 10) * s;
    t.sphere(Math.cos(a) * 5 * s, (22 + (k % 2) * 6) * s, Math.sin(a) * 5 * s, r, r * 0.85, r, k % 2 ? 'leafDark' : 'leaf', { g: 'soft', seg: 9 });
  }
}

/**
 * The world around the lot: the West Yard beyond the west fence (its house, big tree and cat shed, at their real
 * West Yard positions shifted so the yard's east fence is this fence), the neighbours' house over the north
 * hoarding, a ring of rooftops and trees.
 */
export function skyline(kit: Kit, rng: Rng): void {
  // The West Yard: its east fence (x = +100 in yard coordinates) is the lot's west fence (x = -152).
  const WY = -LOT_EDGE - 100;
  house(kit, WY - 44, -122, Math.PI, 84, 44, 28, 12, 'siding', 5);                        // the house (facade south)
  {
    const t = kit.frame(WY - 52, 0, 22, 0);                                                  // the big tree
    t.cyl(0, 10, 0, 2.7, 20, 4, 'bark', { seg: 12 });
    t.sphere(0, 30, 0, 11, 9, 11, 'leaf', { g: 'soft', seg: 12 });
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + rng.range(-0.2, 0.2), d = i % 2 ? 12 : 8, r = 7 + rng.range(0, 2.5);
      t.sphere(Math.cos(a) * d, 25 + (i % 3) * 3.5, Math.sin(a) * d, r, r * 0.82, r, i % 3 === 0 ? 'leafDark' : 'leaf', { g: 'soft', seg: 10 });
    }
  }
  {
    const s = kit.frame(WY + 47, 0, 88, 0);                                                  // the cats' shed
    s.box(0, 3.5, 0, 26, 7, 16, 'teamCats', { bev: 0.2 });
    for (const k of [-1, 1]) s.box(0, 8.8, (k * 9.1) / 2, 28.4, 0.5, 10, 'catBlack', { pitch: k * 0.4, bev: 0.15 });
  }
  // the neighbours' house north of the lot, and their garden trees
  house(kit, -14, -198, 0, 96, 40, 26, 13, 'siding2', 5);
  roundTree(kit, rng, 58, -178, 1.15);
  roundTree(kit, rng, -86, -176, 1.0);
  // a ring of far rooftops and trees (silhouettes in the haze)
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2 + 0.2, d = 285 + (i % 2) * 45;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (x < -200 && Math.abs(z) < 190) continue;                                             // the West Yard is there
    if (Math.abs(x + 14) < 90 && z < -150 && z > -260) continue;                              // the neighbours' house
    const f = kit.frame(x, 0, z, Math.atan2(x, z));
    f.box(0, 12, 0, 54, 24, 30, i % 2 ? 'hullLight' : 'siding2', { bev: 0.4 });
    f.box(0, 30.5, -8, 58, 1.4, 19, 'roof', { pitch: -0.62, bev: 0.3 });
    f.box(0, 30.5, 8, 58, 1.4, 19, 'roof', { pitch: 0.62, bev: 0.3 });
  }
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * Math.PI * 2 + 0.11, d = 215 + (i % 3) * 22;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    if (x < -180 && Math.abs(z) < 150) continue;
    if (Math.hypot(x - CRANE.x, z - CRANE.z) < 30) continue;
    roundTree(kit, rng, x + rng.range(-6, 6), z + rng.range(-6, 6), rng.range(0.8, 1.25));
  }
}

// ============================================================================================ tower crane
/** A thin lattice member between two world points (box, no bevel: 12 triangles). */
function member(kit: Kit, a: [number, number, number], b: [number, number, number], t: number, col: string): void {
  const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
  const hl = Math.hypot(dx, dz), len = Math.hypot(hl, dy);
  // box local +z along the member: yaw about y, then pitch (positive tilts +z down)
  const yaw = hl > 1e-6 ? Math.atan2(dx, dz) : 0, pitch = Math.atan2(-dy, hl);
  kit.prims.push({ s: 'box', x: (a[0] + b[0]) / 2, y: (a[1] + b[1]) / 2, z: (a[2] + b[2]) / 2, a: t, b: t, c: len, yaw, pitch, col, bev: 0 });
}

/**
 * Tower crane (visual only, outside the lot): square lattice mast, slewing ring, cab, apex, a triangular lattice jib
 * over the lot, a counter-jib with ballast, a trolley, and a pallet of cement bags hanging on the hook.
 * Returns the jib's direction, top height and hook point (bookmarks, M3 lamps).
 */
export function towerCrane(kit: Kit, target: [number, number]): { dir: [number, number]; top: number; hook: [number, number, number]; tip: [number, number, number] } {
  const { x, z, mast: M, jib: J, counter: C } = CRANE;
  const Y = 'hazardOchre';
  const base = kit.frame(x, 0, z, 0);
  base.box(0, 1.5, 0, 12, 3, 12, 'concrete', { bev: 0.3 });
  const hw = 2.4;                                                        // mast half width
  const corners: [number, number][] = [[-hw, -hw], [hw, -hw], [hw, hw], [-hw, hw]];
  for (const [cx, cz] of corners) member(kit, [x + cx, 3, z + cz], [x + cx, M, z + cz], 0.45, Y);
  const SEC = 6;
  for (let y = 3, k = 0; y + SEC <= M + 0.01; y += SEC, k++) {
    for (let f = 0; f < 4; f++) {
      const [ax, az] = corners[f], [bx, bz] = corners[(f + 1) % 4];
      const up = k % 2 === 0;
      member(kit, [x + ax, up ? y : y + SEC, z + az], [x + bx, up ? y + SEC : y, z + bz], 0.22, Y);
      if (k % 3 === 0) member(kit, [x + ax, y, z + az], [x + bx, y, z + bz], 0.22, Y);
    }
  }
  const dir: [number, number] = [target[0] - x, target[1] - z];
  const dl = Math.hypot(dir[0], dir[1]);
  dir[0] /= dl; dir[1] /= dl;
  const yaw = Math.atan2(dir[0], dir[1]);
  const top = kit.frame(x, M, z, yaw);                                   // local +z along the jib
  top.cyl(0, 0.6, 0, 3.4, 1.2, 3.4, 'gunmetal', { seg: 14 });
  top.box(0, 2.2, 0, 6, 2, 6, Y, { bev: 0.2 });
  top.box(3.2, 4.2, 3.4, 3.6, 4, 4, 'gunmetal', { bev: 0.25 });          // cab
  top.box(3.2, 4.6, 5.45, 3.0, 2.2, 0.12, 'glass', { g: 'noink', bev: 0 });
  // apex (A-frame) and tie bars
  const w = (lx: number, ly: number, lz: number): [number, number, number] => top.w(lx, ly, lz);
  const apex = w(0, 20, 0);
  for (const s of [-1, 1]) for (const e of [-1, 1]) member(kit, w(s * 2.2, 3.2, e * 2.2), apex, 0.4, Y);
  // jib: two bottom chords + a top chord, lacing on both slanted sides
  const JB = 3.4, JT = 6.6;
  for (const s of [-1, 1]) member(kit, w(s * 1.4, JB, 3), w(s * 0.5, JB, J), 0.35, Y);
  member(kit, w(0, JT, 3), w(0, JB + 1, J), 0.35, Y);
  const JS = 6;
  for (let d = 3; d + JS <= J; d += JS) {
    const t0 = (d - 3) / (J - 3), t1 = (d + JS - 3) / (J - 3);
    const bw0 = 1.4 - 0.9 * t0, bw1 = 1.4 - 0.9 * t1, th1 = JT - (JT - JB - 1) * t1;
    for (const s of [-1, 1]) member(kit, w(s * bw0, JB, d), w(0, th1, d + JS), 0.18, Y);
    member(kit, w(-bw0, JB, d), w(bw1, JB, d + JS), 0.16, Y);
  }
  // counter-jib with ballast blocks
  for (const s of [-1, 1]) member(kit, w(s * 1.6, JB, -3), w(s * 1.6, JB, -C), 0.4, Y);
  for (let d = -6; d > -C; d -= 5) member(kit, w(-1.6, JB, d), w(1.6, JB, d), 0.25, Y);
  for (let i = 0; i < 3; i++) top.box(0, JB - 1.6, -C + 2.2 + i * 2.1, 4.2, 3.2, 2, 'concrete', { bev: 0.15 });
  member(kit, apex, w(0, JB + 1, J * 0.62), 0.14, 'steel');
  member(kit, apex, w(0, JB, -C + 1), 0.14, 'steel');
  // trolley, hoist cable, hook block and a hanging pallet of cement bags
  const hookD = J * 0.58;
  top.box(0, JB - 0.6, hookD, 2.4, 1.2, 2.4, 'gunmetal', { bev: 0.1 });
  const hookY = 40;
  top.cyl(0, (JB - 1.2 + (hookY - M)) / 2, hookD, 0.06, JB - 1.2 - (hookY - M), 0.06, 'catBlack', { seg: 4, g: 'noink' });
  top.box(0, hookY - M - 0.8, hookD, 1.4, 1.6, 1.0, Y, { bev: 0.15 });
  top.box(0, hookY - M - 5.4, hookD, 4.8, 0.6, 4.0, 'plywood', { bev: 0.05 });
  for (let r = 0; r < 2; r++) for (let c = 0; c < 2; c++) top.box(-1.2 + c * 2.4, hookY - M - 4.8 + r * 0.55, hookD, 2.3, 0.55, 3.8, r ? 'canvas' : 'sandbag', { bev: 0.15 });
  for (const s of [-1, 1]) top.cyl(s * 1.2, hookY - M - 3.2, hookD, 0.04, 3.2, 0.04, 'catBlack', { seg: 4, g: 'noink', roll: s * 0.35 });
  const hook = w(0, hookY - M - 5.4, hookD), tip = w(0, JB, J);
  return { dir, top: M, hook, tip };
}
