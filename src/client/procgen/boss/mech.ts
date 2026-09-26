// The Vac-Tank chassis: a robot vacuum turned war machine (original design). Tread undercarriage,
// crimson disc body with a cat face (glowing slit eyes, whisker grille, angry brows), side brushes,
// taped-on cardboard armor with doodles, a rotating turret with a pen-style laser-pointer cannon,
// paper-towel-roll hairball mortars, a siren beacon, a domed dust-bin lid with cardboard cat ears and
// a hatch the pilot's head pokes out of, a rear kitten hatch and a pennant antenna.
//
// Every rigid part is skinned 100 % to one bone of a small mech skeleton, so the whole machine is ONE
// skinned draw call (+ two glow draw calls sharing the same skeleton). Units: m, feet at y = 0, faces -Z.
import * as THREE from 'three/webgpu';
import type { RigTemplate } from '../../anim/rig';
import { PALETTE } from '../../style/style-tokens.js';
import { mixHex } from '../characters/colors';
import { MeshBuilder, ellipsoid, sweep, ring, mirrorX, xform, ellipseLoop, type ColorFn, type Prim, type V3 } from '../characters/mesh-builder';
import { puck, rbox, tube, lathe, wedge } from './prims';
import type { BossDef } from '../../../shared/content/bosses';

const P = PALETTE;
export const COL = {
  crimson: P.teamCats,
  crimsonDark: mixHex(P.teamCats, P.ink, 0.45),
  black: P.catBlack,
  blackLite: mixHex(P.catBlack, P.catGrey, 0.35),
  steel: P.concrete,
  steelDark: mixHex(P.concrete, P.catBlack, 0.45),
  gold: P.accentHot,
  goldDark: mixHex(P.accentHot, P.accent, 0.55),
  card: P.fenceWood,
  cardDark: P.fenceDark,
  tape: mixHex(P.concrete, P.catWhite, 0.35),
  ink: P.ink,
  bristle: mixHex(P.accentHot, P.accent, 0.3),
  pinkEar: mixHex(P.catWhite, P.danger, 0.32),
  hairball: mixHex(P.catGrey, P.dirt, 0.45),
  white: P.catWhite,
} as const;

// ------------------------------------------------------------------ skeleton

interface BoneSpec { name: string; parent: string | null; head: V3; tail?: V3 }

export const MECH_BONES: BoneSpec[] = [
  { name: 'root', parent: null, head: [0, 0, 0] },
  { name: 'treadL', parent: 'root', head: [-1.35, 0.55, 0] },
  { name: 'treadR', parent: 'root', head: [1.35, 0.55, 0] },
  { name: 'wheelL0', parent: 'treadL', head: [-1.74, 0.5, -0.9] },
  { name: 'wheelL1', parent: 'treadL', head: [-1.74, 0.5, 0] },
  { name: 'wheelL2', parent: 'treadL', head: [-1.74, 0.5, 0.9] },
  { name: 'wheelR0', parent: 'treadR', head: [1.74, 0.5, -0.9] },
  { name: 'wheelR1', parent: 'treadR', head: [1.74, 0.5, 0] },
  { name: 'wheelR2', parent: 'treadR', head: [1.74, 0.5, 0.9] },
  { name: 'chassis', parent: 'root', head: [0, 1.85, 0] },
  { name: 'brushL', parent: 'chassis', head: [-1.95, 1.22, -1.6] },
  { name: 'brushR', parent: 'chassis', head: [1.95, 1.22, -1.6] },
  { name: 'glowBrushL', parent: 'brushL', head: [-1.95, 1.22, -1.6] },
  { name: 'glowBrushR', parent: 'brushR', head: [1.95, 1.22, -1.6] },
  { name: 'eyeL', parent: 'chassis', head: [-0.92, 2.0, -2.26] },
  { name: 'eyeR', parent: 'chassis', head: [0.92, 2.0, -2.26] },
  { name: 'plateL', parent: 'chassis', head: [-2.47, 2.3, 0.1] },
  { name: 'plateR', parent: 'chassis', head: [2.47, 2.3, 0.1] },
  { name: 'plateF', parent: 'chassis', head: [-1.62, 2.28, -1.86] },
  { name: 'hatch', parent: 'chassis', head: [0, 1.45, 2.42] },
  { name: 'antenna', parent: 'chassis', head: [-1.5, 2.45, 1.45], tail: [-1.5, 3.9, 1.45] },
  { name: 'turret', parent: 'root', head: [0, 2.45, 0] },
  { name: 'barrel', parent: 'turret', head: [0, 2.8, -1.05], tail: [0, 2.8, -2.3] },
  { name: 'lens', parent: 'barrel', head: [0, 2.8, -2.32] },
  { name: 'mortar', parent: 'turret', head: [0, 3.0, 0.92] },
  { name: 'beacon', parent: 'turret', head: [-0.98, 3.0, 0.42] },
  { name: 'bulb', parent: 'beacon', head: [-0.98, 3.2, 0.42] },
  { name: 'lid', parent: 'turret', head: [0, 3.0, 0.05] },
  { name: 'seat', parent: 'turret', head: [0, 3.05, 0.12] },
];

export function buildMechRig(): RigTemplate {
  const n = MECH_BONES.length;
  const index: Record<string, number> = {};
  MECH_BONES.forEach((b, i) => { index[b.name] = i; });
  const parent = new Int16Array(n), modelRest = new Float32Array(n * 3), restLocal = new Float32Array(n * 3);
  const restScale = new Float32Array(n * 3).fill(1), tail = new Float32Array(n * 3);
  MECH_BONES.forEach((b, i) => {
    parent[i] = b.parent ? index[b.parent] : -1;
    modelRest.set(b.head, i * 3);
    const t = b.tail ?? [b.head[0], b.head[1] + 0.1, b.head[2]];
    tail.set(t, i * 3);
    const ph = b.parent ? MECH_BONES[index[b.parent]].head : [0, 0, 0];
    restLocal.set(b.parent ? [b.head[0] - ph[0], b.head[1] - ph[1], b.head[2] - ph[2]] : b.head, i * 3);
  });
  return { names: MECH_BONES.map((b) => b.name), parent, modelRest, restLocal, restScale, tail, index };
}

// ------------------------------------------------------------------ geometry

export interface MechGeometry {
  body: THREE.BufferGeometry;
  glowRed: THREE.BufferGeometry;
  glowGold: THREE.BufferGeometry;
  triangles: number;
  sections: Map<string, number>;
}

const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

/** Paw print doodle (pad + 4 toe beans) flat on a surface: centre c, outward normal yaw `yaw`, size s. */
function pawPrint(mb: MeshBuilder, c: V3, yaw: number, s: number, bone: string, color: number): void {
  const nx = -Math.sin(yaw), nz = -Math.cos(yaw);
  const tx = Math.cos(yaw), tz = -Math.sin(yaw);
  const at = (u: number, v: number): V3 => [c[0] + tx * u + nx * 0.005, c[1] + v, c[2] + tz * u + nz * 0.005];
  mb.add(ellipsoid(at(0, -0.02 * s), [0.075 * s, 0.06 * s, 0.075 * s], 8, 4, { rot: [0, yaw, 0] }), color, { rigid: bone });
  for (const [u, v] of [[-0.085, 0.07], [-0.03, 0.105], [0.03, 0.105], [0.085, 0.07]]) {
    mb.add(ellipsoid(at(u * s, v * s), [0.03 * s, 0.036 * s, 0.03 * s], 6, 3, { rot: [0, yaw, 0] }), color, { rigid: bone });
  }
}

export function buildMechGeometry(rig: RigTemplate, def: BossDef): MechGeometry {
  const mb = new MeshBuilder(rig);
  const red = new MeshBuilder(rig);
  const gold = new MeshBuilder(rig);
  const R = def.radius;

  // ---------------- undercarriage: treads, road wheels, belly
  mb.begin('treads');
  for (const side of [-1, 1] as const) {
    const bone = side < 0 ? 'treadL' : 'treadR';
    const cx = 1.35 * side;
    const treadColor: ColorFn = (x, _y, z) => (Math.abs(x) > 1.62 && Math.sin(z * 11) > 0.35 ? COL.blackLite : COL.black);
    mb.add(ellipsoid([cx, 0.56, 0], [0.37, 0.5, 1.52], 18, 10, { p: 3.2, mod: (_u, _v, dx, _dy, dz) => (Math.abs(dx) < 0.6 ? 1 + 0.035 * Math.max(0, Math.sin(dz * 22)) : 1) }), treadColor, { rigid: bone });
    // fender over the tread (crimson mudguard)
    mb.add(rbox([cx, 1.1, 0], [0.4, 0.08, 1.5], 12, 4, 4), COL.crimsonDark, { rigid: bone });
    for (let k = 0; k < 3; k++) {
      const wb = `wheel${side < 0 ? 'L' : 'R'}${k}`;
      const z = (k - 1) * 0.9;
      const wx = 1.74 * side;
      mb.add(puck([wx, 0.5, z], 0.34, 0.07, 12, 4, { p: 4, rot: [0, 0, Math.PI / 2] }), COL.steel, { rigid: wb });
      mb.add(puck([wx + 0.07 * side, 0.5, z], 0.15, 0.05, 8, 3, { p: 3, rot: [0, 0, Math.PI / 2] }), COL.crimson, { rigid: wb });
      // spoke nub so the rotation reads
      mb.add(rbox([wx + 0.05 * side, 0.5 + 0.22, z], [0.03, 0.06, 0.04], 4, 3, 3), COL.steelDark, { rigid: wb });
    }
  }
  mb.add(ellipsoid([0, 1.0, 0], [1.02, 0.36, 1.25], 14, 6, { p: 3 }), COL.black, { rigid: 'root' });

  // ---------------- chassis disc (the robot vacuum)
  mb.begin('chassis');
  const deck = def.deckY;
  const chassisColor: ColorFn = (x, y, z) => {
    const r = Math.hypot(x, z);
    if (y > deck - 0.07) return r > 2.05 ? COL.crimson : r > 1.98 ? COL.gold : COL.black;
    if (y < 1.36) return COL.black;
    if (y > 1.52 && y < 1.6) return COL.black; // seam line
    return COL.crimson;
  };
  mb.add(puck([0, 1.85, 0], 2.42, 0.6, 40, 10, { p: 4.5 }), chassisColor, { rigid: 'chassis' });
  mb.add(puck([0, 1.32, 0], 2.18, 0.1, 28, 4, { p: 3 }), COL.black, { rigid: 'chassis' });
  // rubber bumper around the front half
  const bump: V3[] = [];
  for (let i = 0; i <= 14; i++) { const a = -1.9 + (3.8 * i) / 14; bump.push([Math.sin(a) * 2.5, 1.66, -Math.cos(a) * 2.5]); }
  mb.add(sweep(bump, bump.map(() => [0.2, 0.12] as [number, number]), 8, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), COL.steelDark, { rigid: 'chassis' });
  // turret ring on the deck
  mb.add(puck([0, deck + 0.05, 0], 1.46, 0.08, 28, 3, { p: 4 }), COL.blackLite, { rigid: 'chassis' });

  // cat face on the bumper side: slit eyes (glow + pupil), angry brows, whisker grille, "w" mouth
  mb.begin('face');
  for (const side of [-1, 1] as const) {
    const bone = side < 0 ? 'eyeL' : 'eyeR';
    const yaw = -0.4 * side;
    const ex = 0.92 * side, ey = 2.0, ez = -2.26;
    const nx = -Math.sin(yaw), nz = -Math.cos(yaw);
    mb.add(ellipsoid([ex - nx * 0.02, ey, ez - nz * 0.02], [0.34, 0.24, 0.09], 12, 5, { rot: [0, yaw, 0] }), COL.black, { rigid: 'chassis' });
    gold.add(ellipsoid([ex + nx * 0.03, ey, ez + nz * 0.03], [0.28, 0.19, 0.07], 12, 5, { rot: [0, yaw, 0] }), 0xffffff, { rigid: bone });
    mb.add(ellipsoid([ex + nx * 0.085, ey, ez + nz * 0.085], [0.075, 0.18, 0.035], 6, 4, { rot: [0, yaw, 0] }), COL.ink, { rigid: bone });
    // brow: slanted down toward the middle (angry)
    mb.add(rbox([ex + nx * 0.06 - 0.03 * side, ey + 0.29, ez + nz * 0.06], [0.3, 0.05, 0.05], 8, 3, 3, [0, yaw, 0.32 * side]), COL.ink, { rigid: 'chassis' });
    // whiskers (bumper grille bars sweeping outward)
    for (let k = 0; k < 3; k++) {
      const y0 = 1.9 - k * 0.14;
      const a0 = 0.55 * side, a1 = (1.05 + k * 0.08) * side;
      const pts: V3[] = [];
      for (let s = 0; s <= 4; s++) { const a = a0 + (a1 - a0) * (s / 4); const r = 2.5 + 0.04 * Math.sin((s / 4) * Math.PI); pts.push([Math.sin(a) * r, y0 + (s / 4) * 0.12 * (1 - k), -Math.cos(a) * r]); }
      mb.add(sweep(pts, pts.map(() => [0.028, 0.028] as [number, number]), 5, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), COL.white, { rigid: 'chassis' });
    }
  }
  // "w" mouth under the eyes
  {
    const pts: V3[] = [];
    for (let s = 0; s <= 8; s++) { const u = s / 8; const a = (u - 0.5) * 0.5; pts.push([Math.sin(a) * 2.47, 1.76 - 0.06 * Math.abs(Math.sin(u * Math.PI * 2)), -Math.cos(a) * 2.47]); }
    mb.add(sweep(pts, pts.map(() => [0.03, 0.03] as [number, number]), 5, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), COL.ink, { rigid: 'chassis' });
  }

  // side brushes (robot-vacuum sweepers) under the front rim
  mb.begin('brushes');
  for (const side of [-1, 1] as const) {
    const bone = side < 0 ? 'brushL' : 'brushR';
    const c: V3 = [1.95 * side, 1.22, -1.6];
    mb.add(puck([c[0], c[1] + 0.04, c[2]], 0.3, 0.09, 14, 3, { p: 4 }), COL.black, { rigid: bone });
    mb.add(puck([c[0], c[1] + 0.12, c[2]], 0.14, 0.05, 8, 3, { p: 3 }), COL.gold, { rigid: bone });
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * Math.PI * 2 + side * 0.3;
      const dx = Math.cos(a), dz = Math.sin(a);
      mb.add(ellipsoid([c[0] + dx * 0.52, c[1] - 0.08, c[2] + dz * 0.52], [0.42, 0.07, 0.13], 8, 4, {
        rot: [0, -a, -0.18], mod: (u, v) => 1 + 0.22 * (Math.round(u * 8) % 2) * sstep(0.25, 0.75, v),
      }), (x, _y, z) => (Math.hypot(x - c[0], z - c[2]) > 0.72 ? COL.bristle : COL.goldDark), { rigid: bone });
    }
    gold.add(ring(ellipseLoop([c[0], c[1] - 0.02, c[2]], [1.02, 0, 0], [0, 0, 1.02], 18), 0.045, 4), 0xffffff, { rigid: side < 0 ? 'glowBrushL' : 'glowBrushR' });
  }

  // cardboard armor plates with doodles + tape
  mb.begin('cardboard');
  const plate = (bone: string, cx: number, cy: number, cz: number, yaw: number, hw: number, hh: number) => {
    mb.add(rbox([cx, cy, cz], [hw, hh, 0.05], 10, 5, 5, [0, yaw, 0]), (x, y, z) => {
      const nx = -Math.sin(yaw), nz = -Math.cos(yaw);
      const tx = Math.cos(yaw), tz = -Math.sin(yaw);
      const u = (x - cx) * tx + (z - cz) * tz, v = y - cy;
      const edge = Math.abs(u) > hw * 0.86 || Math.abs(v) > hh * 0.8;
      void nx; void nz;
      return edge ? COL.cardDark : COL.card;
    }, { rigid: bone });
    // tape strips at two corners
    const tx = Math.cos(yaw), tz = -Math.sin(yaw), nx = -Math.sin(yaw), nz = -Math.cos(yaw);
    for (const s of [-1, 1]) {
      mb.add(rbox([cx + tx * hw * 0.8 * s + nx * 0.055, cy + hh * 0.7, cz + tz * hw * 0.8 * s + nz * 0.055], [0.16, 0.05, 0.012], 4, 3, 4, [0, yaw, 0.7 * s]), COL.tape, { rigid: bone });
    }
    return { nx, nz, tx, tz };
  };
  // left + right side plates (outer normal faces ±X): yaw ±π/2
  for (const side of [-1, 1] as const) {
    const bone = side < 0 ? 'plateL' : 'plateR';
    const yaw = side < 0 ? Math.PI / 2 : -Math.PI / 2;
    const cx = 2.47 * side, cy = 1.88, cz = 0.15;
    plate(bone, cx, cy, cz, yaw, 0.78, 0.36);
    pawPrint(mb, [cx + side * 0.055, cy, cz], yaw, 1.5, bone, COL.ink);
  }
  // front-left plate with tally marks (corgis "vacuumed")
  {
    const yaw = 0.72;
    const cx = -1.62, cy = 1.94, cz = -1.86;
    const f = plate('plateF', cx, cy, cz, yaw, 0.46, 0.27);
    for (let k = 0; k < 4; k++) mb.add(rbox([cx + f.tx * (-0.24 + k * 0.12) + f.nx * 0.056, cy, cz + f.tz * (-0.24 + k * 0.12) + f.nz * 0.056], [0.018, 0.15, 0.01], 3, 3, 3, [0, yaw, 0]), COL.ink, { rigid: 'plateF' });
    mb.add(rbox([cx + f.nx * 0.058, cy, cz + f.nz * 0.058], [0.3, 0.018, 0.01], 3, 3, 3, [0, yaw, 0.45]), COL.ink, { rigid: 'plateF' });
  }

  // rear: kitten hatch (dust-bin door), exhausts, pennant antenna
  mb.begin('rear');
  mb.add(rbox([0, 1.84, 2.48], [0.62, 0.34, 0.07], 10, 5, 5), COL.crimsonDark, { rigid: 'hatch' });
  mb.add(rbox([0, 2.05, 2.56], [0.2, 0.04, 0.04], 5, 3, 3), COL.gold, { rigid: 'hatch' });
  pawPrint(mb, [0, 1.78, 2.555], Math.PI, 1.2, 'hatch', COL.gold);
  for (const [x, z, h] of [[1.25, 1.72, 0.75], [1.6, 1.35, 0.6]] as const) {
    mb.add(tube([x, deck - 0.05, z], [x, deck + h, z], [0.13, 0.15], 10), COL.steel, { rigid: 'chassis' });
    mb.add(puck([x, deck + h, z], 0.16, 0.04, 10, 3, { p: 3 }), COL.black, { rigid: 'chassis' });
  }
  mb.add(tube([-1.5, deck - 0.05, 1.45], [-1.5, 3.95, 1.45], [0.035, 0.022], 6), COL.black, { rigid: 'antenna' });
  mb.add(wedge([-1.5, 3.7, 1.72], [0.02, 0.3, 0.2], 6, 5, [Math.PI / 2 - 0.1, 0, 0]), COL.crimson, { rigid: 'antenna' });
  mb.add(ellipsoid([-1.5, 3.98, 1.45], [0.06, 0.06, 0.06], 6, 4), COL.gold, { rigid: 'antenna' });

  // ---------------- turret (rotates with the aim)
  mb.begin('turret');
  const drumColor: ColorFn = (x, y, z) => {
    const r = Math.hypot(x, z);
    if (y > 2.93) return r > 1.12 ? COL.gold : r > 0.62 ? COL.black : COL.crimsonDark; // floor of the cockpit
    return y > 2.84 ? COL.black : COL.crimson;
  };
  mb.add(puck([0, 2.72, 0], 1.3, 0.28, 30, 8, { p: 4 }), drumColor, { rigid: 'turret' });
  // throne back (seen once the lid is gone): crimson velvet with gold piping and a crowned top
  mb.add(rbox([0, 3.28, 0.82], [0.62, 0.5, 0.12], 10, 6, 4, [-0.18, 0, 0]), mixHex(COL.crimson, P.mulch, 0.25), { rigid: 'turret' });
  for (let k = -1; k <= 1; k++) mb.add(ellipsoid([k * 0.38, 3.86 - Math.abs(k) * 0.08, 0.93], [0.1, 0.13, 0.08], 6, 4), COL.gold, { rigid: 'turret' });
  // control levers with red knobs
  for (const side of [-1, 1]) {
    mb.add(tube([0.3 * side, 2.95, -0.42], [0.33 * side, 3.28, -0.58], 0.035, 6), COL.steelDark, { rigid: 'turret' });
    mb.add(ellipsoid([0.33 * side, 3.31, -0.6], [0.07, 0.07, 0.07], 6, 4), COL.crimson, { rigid: 'turret' });
  }
  // laser-pointer cannon: a giant pen-style pointer on a bracket
  mb.begin('laser');
  mb.add(rbox([0, 2.75, -0.95], [0.26, 0.2, 0.2], 6, 4, 4), COL.black, { rigid: 'turret' });
  const barrelPath: V3[] = [[0, 2.8, -0.95], [0, 2.8, -1.4], [0, 2.8, -1.95], [0, 2.8, -2.22]];
  mb.add(sweep(barrelPath, [[0.19, 0.19], [0.2, 0.2], [0.19, 0.19], [0.24, 0.24]], 14, {
    up: [0, 1, 0], capStart: 2, capEnd: 1, capEndLen: 0.25,
    mod: (t) => 1 + (t > 0.28 && t < 0.36 ? 0.1 : 0) + (t > 0.5 && t < 0.56 ? 0.1 : 0),
  }), (_x, _y, z) => (z < -2.12 ? COL.black : z > -1.42 && z < -1.3 ? COL.crimson : COL.steel), { rigid: 'barrel' });
  mb.add(rbox([0, 3.03, -1.45], [0.045, 0.035, 0.42], 4, 3, 4), COL.gold, { rigid: 'barrel' }); // pen clip
  mb.add(ellipsoid([0, 3.0, -1.02], [0.07, 0.06, 0.07], 6, 4), COL.crimson, { rigid: 'barrel' }); // push button
  red.add(ellipsoid([0, 2.8, -2.3], [0.19, 0.19, 0.08], 12, 5), 0xffffff, { rigid: 'lens' });
  // hairball mortar: three taped paper-towel tubes, hairballs peeking out
  mb.begin('mortar');
  for (let k = -1; k <= 1; k++) {
    const x = k * 0.34, bz = 0.92, lean = 0.4;
    const top: V3 = [x, 3.62, bz + Math.sin(lean) * 0.66];
    mb.add(tube([x, 2.96, bz], top, 0.14, 10, 0.2), (_x, y) => (Math.sin(y * 18) > 0.6 ? COL.cardDark : COL.card), { rigid: 'mortar' });
    mb.add(ellipsoid([top[0], top[1] - 0.02, top[2]], [0.11, 0.08, 0.11], 7, 4, { mod: (u, v) => 1 + 0.2 * (Math.round(u * 7) % 2) * sstep(0.2, 0.5, v) }), COL.hairball, { rigid: 'mortar' });
  }
  mb.add(rbox([0, 3.25, 1.05], [0.52, 0.06, 0.18], 6, 3, 4, [0.4, 0, 0]), COL.tape, { rigid: 'mortar' });
  // warning beacon (siren) on the turret
  mb.add(puck([-0.98, 3.02, 0.42], 0.15, 0.06, 10, 3, { p: 4 }), COL.black, { rigid: 'beacon' });
  red.add(ellipsoid([-0.98, 3.17, 0.42], [0.12, 0.14, 0.12], 8, 5), 0xffffff, { rigid: 'bulb' });

  // ---------------- dust-bin lid (pops off in phase 2): dome with a hatch + cardboard cat ears
  mb.begin('lid');
  const lidColor: ColorFn = (_x, y) => {
    if (y < 3.02) return COL.gold;
    if (y > 3.16 && y < 3.25) return COL.black; // band
    return COL.crimson;
  };
  mb.add(lathe([0, 0, 0.05], [[1.36, 2.97], [1.35, 3.03], [1.28, 3.14], [1.12, 3.27], [0.94, 3.36], [0.8, 3.41], [0.7, 3.43]], 32), lidColor, { rigid: 'lid' });
  mb.add(ring(ellipseLoop([0, 3.44, 0.05], [0.7, 0, 0], [0, 0, 0.7], 22), [0.07, 0.07], 5), COL.gold, { rigid: 'lid' });
  for (const side of [-1, 1]) {
    const c: V3 = [1.02 * side, 3.5, 0.1];
    const rot: V3 = [0, 0, -0.5 * side];
    mb.add(wedge(c, [0.4, 0.56, 0.07], 8, 6, rot), COL.card, { rigid: 'lid' });
    mb.add(wedge([c[0] - 0.02 * side, c[1] - 0.05, c[2] - 0.06], [0.25, 0.38, 0.03], 6, 5, rot), COL.pinkEar, { rigid: 'lid' });
    mb.add(rbox([0.9 * side, 3.2, 0.1], [0.2, 0.06, 0.015], 4, 3, 4, [0, 0, -0.9 * side]), COL.tape, { rigid: 'lid' }); // taped on
  }

  const body = mb.build();
  const glowRed = red.build();
  const glowGold = gold.build();
  const bound = new THREE.Sphere(new THREE.Vector3(0, R * 0.95, 0), R * 2.1);
  for (const g of [body, glowRed, glowGold]) g.boundingSphere = bound.clone();
  return { body, glowRed, glowGold, triangles: mb.triangles + red.triangles + gold.triangles, sections: mb.sections };
}

export type { Prim };
export { mirrorX, xform };
