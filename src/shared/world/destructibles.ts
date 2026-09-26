// X1 destructibles — breakable world props as pure data (no three, no rng, no Math.random).
//
//   wall_boards  the Garage's boarded-up breach wall (built in garage.ts: it is a section of the east wall).
//                Explosion-only: shots bounce off; generic blasts barely scratch it; the Breacher's Dig Charge is the
//                key (x3 damage, and a charge planted against it gets a short breaching fuse — BREACH).
//   tuna_stack   the cats' hoard: a pallet with a 3-2-1 pyramid of giant tuna cans (14 cans). Shots and blasts.
//   crate_stack  three wooden crates in the yard, for fun. Shots and blasts.
//
// Every destructible is built with its own Kit, so its colliders (`boxes`) and its looks (`prims` intact, `rubble`
// broken) never enter WorldData.props / prims: the sim's destruct system owns the colliders and the client's
// destructible view owns the meshes. Geometry helpers here (oriented-box closest point / distance) are shared by the
// authority (blast falloff, shot hits, breach reach) and the tests.
import type { Destructible, DestructKind, PropBox, VisualPrim } from './world-types';
import { Kit, type Frame } from './kit';
import { hash2 } from './noise';

export interface DestructRule {
  /** Default hit points. */
  hp: number;
  /** Hitscan damage multiplier (0 = shots bounce off). */
  shotMult: number;
  /** Damage multiplier for generic explosions (tennis mortar, kart wrecks, boss blasts). */
  blastMult: number;
  /** Damage multiplier for the Breacher's Dig Charge. */
  chargeMult: number;
  /** Damage multiplier for a kart ramming it (the kart's ram damage; 0 = karts just bounce off). */
  ramMult: number;
  /** A Dig Charge planted within BREACH.reach of it (while it stands) blows BREACH.fuse s after arming. */
  breach: boolean;
  /** How far bots hear it break (m). */
  noise: number;
}

/**
 * Damage rules per kind. Wall: one Dig Charge within 2.6 m breaks it (70 x falloff x 3 >= 150), a tennis-mortar
 * blast does <= 34 (five direct hits), rifles nothing. Stacks: a mortar landing within ~2.3 m, 6 rifle shots.
 */
export const DESTRUCT_KINDS: Record<DestructKind, DestructRule> = {
  wall_boards: { hp: 150, shotMult: 0, blastMult: 0.4, chargeMult: 3, ramMult: 0, breach: true, noise: 60 },
  // A kart at ~10 m/s flattens a crate stack; the heavier tuna hoard needs ~11.5 m/s (a boosted run-up).
  tuna_stack: { hp: 80, shotMult: 1, blastMult: 1.5, chargeMult: 2, ramMult: 1.5, breach: false, noise: 35 },
  crate_stack: { hp: 60, shotMult: 1, blastMult: 1.5, chargeMult: 2, ramMult: 1.5, breach: false, noise: 30 },
};

/** Breaching: a Dig Charge planted within `reach` m of a standing breach wall blows `fuse` s after it arms. */
export const BREACH = { reach: 2.6, fuse: 1.5 } as const;

// ------------------------------------------------------------------------------------------------ geometry

export interface P3 { x: number; y: number; z: number }

/** Rotation matrix of a PropBox (Euler 'YXZ': yaw, then pitch about local X, then roll about local Z), row-major. */
function rotOf(b: PropBox, m: number[]): void {
  const cy = Math.cos(b.rotY), sy = Math.sin(b.rotY), cp = Math.cos(b.pitch ?? 0), sp = Math.sin(b.pitch ?? 0);
  const cr = Math.cos(b.roll ?? 0), sr = Math.sin(b.roll ?? 0);
  m[0] = cy * cr + sy * sp * sr; m[1] = -cy * sr + sy * sp * cr; m[2] = sy * cp;
  m[3] = cp * sr; m[4] = cp * cr; m[5] = -sp;
  m[6] = -sy * cr + cy * sp * sr; m[7] = sy * sr + cy * sp * cr; m[8] = cy * cp;
}
const M = [0, 0, 0, 0, 0, 0, 0, 0, 0];

/** Closest point of an oriented box to (x, y, z) into `out`; returns the distance (0 inside). */
export function boxClosestPoint(b: PropBox, x: number, y: number, z: number, out: P3): number {
  rotOf(b, M);
  const dx = x - b.x, dy = y - b.y, dz = z - b.z;
  // local = R^T d, clamped to the half extents, back to world
  const lx = Math.max(-b.hx, Math.min(b.hx, M[0] * dx + M[3] * dy + M[6] * dz));
  const ly = Math.max(-b.hy, Math.min(b.hy, M[1] * dx + M[4] * dy + M[7] * dz));
  const lz = Math.max(-b.hz, Math.min(b.hz, M[2] * dx + M[5] * dy + M[8] * dz));
  out.x = b.x + M[0] * lx + M[1] * ly + M[2] * lz;
  out.y = b.y + M[3] * lx + M[4] * ly + M[5] * lz;
  out.z = b.z + M[6] * lx + M[7] * ly + M[8] * lz;
  return Math.hypot(x - out.x, y - out.y, z - out.z);
}

const tmp: P3 = { x: 0, y: 0, z: 0 };
/** Distance from a point to the nearest box of a destructible (0 inside); closest point into `out` if given. */
export function destructDistance(d: Destructible, x: number, y: number, z: number, out?: P3): number {
  let best = Infinity;
  for (const b of d.boxes) {
    const r = boxClosestPoint(b, x, y, z, tmp);
    if (r < best) { best = r; if (out) { out.x = tmp.x; out.y = tmp.y; out.z = tmp.z; } }
  }
  return best;
}

/** World AABB of a box (exact for yaw-only boxes, conservative otherwise). */
export function boxAabb(b: PropBox): { x0: number; x1: number; y0: number; y1: number; z0: number; z1: number } {
  rotOf(b, M);
  const ex = Math.abs(M[0]) * b.hx + Math.abs(M[1]) * b.hy + Math.abs(M[2]) * b.hz;
  const ey = Math.abs(M[3]) * b.hx + Math.abs(M[4]) * b.hy + Math.abs(M[5]) * b.hz;
  const ez = Math.abs(M[6]) * b.hx + Math.abs(M[7]) * b.hy + Math.abs(M[8]) * b.hz;
  return { x0: b.x - ex, x1: b.x + ex, y0: b.y - ey, y1: b.y + ey, z0: b.z - ez, z1: b.z + ez };
}

// ------------------------------------------------------------------------------------------------ builders

export interface DestructBuild {
  id: string; tag: string; kind: DestructKind;
  /** Anchor (ground point under the center) and facing; the frames passed to build/rubble sit there. */
  x: number; y: number; z: number; yaw: number;
  build(f: Frame): void;
  rubble(f: Frame): void;
  hp?: number;
}

/** Runs the builders on private kits and packs the result (center = middle of the boxes' bounds). */
export function makeDestructible(o: DestructBuild): Destructible {
  const kit = new Kit(), rk = new Kit();
  o.build(kit.frame(o.x, o.y, o.z, o.yaw));
  o.rubble(rk.frame(o.x, o.y, o.z, o.yaw));
  if (kit.cylinders.length || rk.props.length || rk.cylinders.length) throw new Error(`destructible ${o.id}: boxes only, and rubble is visual only`);
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const b of kit.props) {
    const a = boxAabb(b);
    x0 = Math.min(x0, a.x0); x1 = Math.max(x1, a.x1); y0 = Math.min(y0, a.y0); y1 = Math.max(y1, a.y1); z0 = Math.min(z0, a.z0); z1 = Math.max(z1, a.z1);
  }
  return {
    id: o.id, tag: o.tag, kind: o.kind, x: o.x, y: o.y, z: o.z, yaw: o.yaw,
    hp: o.hp ?? DESTRUCT_KINDS[o.kind].hp,
    boxes: kit.props.map((b) => ({ ...b, type: o.kind })),
    prims: kit.prims, rubble: rk.prims,
    cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, cz: (z0 + z1) / 2,
  };
}

/** Deterministic jitter in [-1, 1) for prop dressing (never gameplay). */
const jit = (i: number, k: number, seed: number) => hash2(i, k, seed) * 2 - 1;

// ---- tuna-can stack: a pallet + a 3x3 / 2x2 / 1 pyramid of giant cans (1.5 m tall, 2.6 m square)

const CAN = { r: 0.4, h: 0.42, gap: 0.82 };
const PALLET = { w: 2.6, h: 0.22 };
/** Height of a tuna stack's top can (m above its ground). */
export const TUNA_STACK_HEIGHT = PALLET.h + 3 * CAN.h;

function tunaCan(f: Frame, lx: number, y0: number, lz: number, label: string, emblem: boolean): void {
  const { r, h } = CAN;
  f.cyl(lx, y0 + h / 2, lz, r, h - 0.08, r, label, { seg: 12 });
  for (const y of [y0 + 0.04, y0 + h - 0.04]) f.cyl(lx, y, lz, r + 0.02, 0.08, r + 0.02, 'tin', { seg: 12 });
  f.cyl(lx, y0 + h + 0.004, lz, r - 0.06, 0.008, r - 0.06, 'tinDark', { seg: 12, g: 'noink' });              // lid
  f.torus(lx + 0.14, y0 + h + 0.02, lz, 0.1, 0.028, 'tin', { pitch: Math.PI / 2, seg: 10, g: 'noink' });     // pull tab
  if (emblem) {
    // a fish on the label, facing out from the stack's center (thin axis radial)
    const yaw = lx === 0 && lz === 0 ? 0 : Math.atan2(lx, lz);
    const ox = Math.sin(yaw) * (r - 0.005), oz = Math.cos(yaw) * (r - 0.005);
    f.sphere(lx + ox, y0 + h / 2, lz + oz, 0.17, 0.09, 0.035, 'tunaFish', { yaw, seg: 10, g: 'noink' });
    // tail fin behind the body (local -X along the label), tip pointing at the body
    f.cone(lx + ox - Math.cos(yaw) * 0.2, y0 + h / 2, lz + oz + Math.sin(yaw) * 0.2, 0.08, 0.1, 'tunaFish', { yaw, roll: -Math.PI / 2, seg: 3, g: 'noink' });
  }
}

function pallet(f: Frame, seed: number): void {
  const { w, h } = PALLET;
  for (const x of [-1, 0, 1]) f.box(x * (w / 2 - 0.16), 0.06, 0, 0.3, 0.12, w, 'fenceDark', { bev: 0.03 });
  for (let k = 0; k < 6; k++) {
    const z = -w / 2 + 0.17 + (k * (w - 0.34)) / 5;
    f.box(jit(k, 1, seed) * 0.03, h - 0.05, z, w, 0.1, 0.32, k % 2 ? 'fenceWood' : 'fenceDark2', { bev: 0.03 });
  }
}

/** A tuna-can stack standing on the ground at (x, y, z). `seed` varies labels and rubble. */
export function tunaStack(id: string, x: number, y: number, z: number, yaw: number, seed: number): Destructible {
  const { h, gap } = CAN;
  return makeDestructible({
    id, tag: 'tuna_stack', kind: 'tuna_stack', x, y, z, yaw,
    build(f) {
      pallet(f, seed);
      let k = 0;
      for (const [n, layer] of [[3, 0], [2, 1], [1, 2]] as const) {
        const y0 = PALLET.h + layer * h;
        for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
          const lx = (i - (n - 1) / 2) * gap, lz = (j - (n - 1) / 2) * gap;
          const outer = n === 1 || i === 0 || j === 0 || i === n - 1 || j === n - 1;
          tunaCan(f, lx, y0, lz, hash2(k++, 7, seed) < 0.72 ? 'tunaLabel' : 'tunaLabel2', outer && (n < 3 || (i + j) % 2 === 0));
        }
      }
      // colliders: a stepped pyramid (pallet + bottom layer, middle layer, top can)
      f.colBox('tuna', 0, (PALLET.h + h) / 2, 0, PALLET.w, PALLET.h + h, PALLET.w);
      f.colBox('tuna', 0, PALLET.h + 1.5 * h, 0, 2 * gap, h, 2 * gap);
      f.colBox('tuna', 0, PALLET.h + 2.5 * h, 0, gap, h, gap);
    },
    rubble(f) {
      // snapped pallet slats, squashed cans, loose lids: all low (<= 0.3 m), nothing to trip on
      for (let k = 0; k < 5; k++) {
        const a = jit(k, 2, seed) * 0.5, off = jit(k, 3, seed) * 0.5;
        f.box(off, 0.05, -1.0 + k * 0.5, 1.6 + jit(k, 4, seed) * 0.6, 0.08, 0.3, k % 2 ? 'fenceWood' : 'fenceDark2', { yaw: a, bev: 0.02 });
      }
      for (let k = 0; k < 7; k++) {
        const a = (k / 7) * Math.PI * 2 + jit(k, 5, seed) * 0.4, d = 0.6 + (hash2(k, 6, seed)) * 1.3;
        const cx = Math.cos(a) * d, cz = Math.sin(a) * d, hh = 0.1 + hash2(k, 8, seed) * 0.12;
        f.cyl(cx, hh / 2 + 0.02, cz, CAN.r, hh, CAN.r * 1.08, hash2(k, 9, seed) < 0.7 ? 'tunaLabel' : 'tunaLabel2', { seg: 12, roll: jit(k, 10, seed) * 0.15 });
        f.cyl(cx, hh + 0.03, cz, CAN.r * 0.95, 0.03, CAN.r * 0.95, 'tin', { seg: 12, roll: jit(k, 10, seed) * 0.15 });
      }
      for (let k = 0; k < 3; k++) f.cyl(jit(k, 11, seed) * 1.6, 0.012, jit(k, 12, seed) * 1.6, 0.34, 0.02, 0.34, 'tinDark', { seg: 10, g: 'noink' });
      f.cyl(0, 0.006, 0, 1.25, 0.01, 1.05, 'oilStain', { seg: 14, g: 'noink' });                                    // tuna juice
    },
  });
}

// ---- crate stack: two crates side by side + one on top (1.3 m crates)

const CRATE = 1.3;

function crate(f: Frame, lx: number, y0: number, lz: number, yaw: number, dark: boolean): void {
  const s = CRATE, c = f.sub(lx, y0, lz, yaw);
  c.solid('crate', 0, s / 2, 0, s, s, s, dark ? 'fenceDark2' : 'fenceWood', { bev: 0.07 });
  for (const y of [0.09, s - 0.09]) c.box(0, y, 0, s + 0.05, 0.18, s + 0.05, 'fenceDark', { bev: 0.04 });   // bands
  for (const sd of [-1, 1]) {
    c.box(0, s / 2, sd * (s / 2 + 0.012), s * 1.2, 0.14, 0.03, 'fenceDark', { roll: sd * 0.785, g: 'noink', bev: 0 });
    c.box(sd * (s / 2 + 0.012), s / 2, 0, 0.03, 0.14, s * 1.2, 'fenceDark', { pitch: sd * 0.785, g: 'noink', bev: 0 });
  }
  // stencilled paw on two faces
  for (const [x, z, y2] of [[0, s / 2 + 0.03, 0], [s / 2 + 0.03, 0, Math.PI / 2]] as const) {
    c.sphere(x, s * 0.55, z, 0.2, 0.17, 0.02, 'crateStencil', { yaw: y2, seg: 10, g: 'noink' });
  }
}

/** A stack of three wooden crates standing on the ground at (x, y, z). */
export function crateStack(id: string, x: number, y: number, z: number, yaw: number, seed: number): Destructible {
  const s = CRATE;
  return makeDestructible({
    id, tag: 'crate_stack', kind: 'crate_stack', x, y, z, yaw,
    build(f) {
      crate(f, -0.7, 0, 0, jit(1, 1, seed) * 0.08, false);
      crate(f, 0.7, 0, 0.05, jit(2, 1, seed) * 0.08, true);
      crate(f, 0.1, s, 0.02, 0.18 + jit(3, 1, seed) * 0.1, false);
    },
    rubble(f) {
      for (let k = 0; k < 9; k++) {
        const a = jit(k, 20, seed) * Math.PI, d = hash2(k, 21, seed) * 1.8;
        f.box(Math.cos(a) * d, 0.04 + (k % 3) * 0.05, Math.sin(a) * d, 1.2 + hash2(k, 22, seed) * 0.5, 0.07, 0.22,
          k % 3 === 0 ? 'fenceDark2' : k % 3 === 1 ? 'fenceWood' : 'splinter', { yaw: jit(k, 23, seed) * 1.6, bev: 0.02 });
      }
      f.box(0.3, 0.1, -0.2, 1.3, 0.18, 0.12, 'fenceDark', { yaw: 0.4, bev: 0.03 });                                   // a band
      f.cyl(0, 0.006, 0, 1.9, 0.01, 1.6, 'dirt', { seg: 12, g: 'noink' });                                            // scuffed ground
    },
  });
}

/** The prims of a destructible in one state (the client view builds both). */
export function destructPrims(d: Destructible, broken: boolean): readonly VisualPrim[] {
  return broken ? d.rubble : d.prims;
}
