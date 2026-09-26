// One shared skeleton template (47 bones ≤ 48) for every species. Species/variants only move rest
// positions and scales, so every procedural animation retargets across corgis and cats for free.
import type { RigTemplate } from '../../anim/rig';
import type { BodyPlan } from './species';

export const BONE_NAMES = [
  'root', 'hips', 'spine', 'chest', 'neck', 'head', 'jaw', 'tongue',
  'ear1.L', 'ear2.L', 'ear1.R', 'ear2.R',
  'brow.L', 'brow.R',
  'eyeSocket.L', 'eye.L', 'pupil.L', 'lidUp.L', 'lidLo.L',
  'eyeSocket.R', 'eye.R', 'pupil.R', 'lidUp.R', 'lidLo.R',
  'xEyes',
  'tail1', 'tail2', 'tail3', 'tail4',
  'clav.L', 'upperArm.L', 'foreArm.L', 'hand.L',
  'clav.R', 'upperArm.R', 'foreArm.R', 'hand.R',
  'thigh.L', 'shin.L', 'foot.L',
  'thigh.R', 'shin.R', 'foot.R',
  'weapon', 'butt',
  // K1: mouth corners (smirk, grin, snarl) — they bend the ink mouth line drawn on the muzzle / pads.
  'mouth.L', 'mouth.R',
] as const;
export type BoneName = (typeof BONE_NAMES)[number];

const PARENT: Record<BoneName, BoneName | null> = {
  root: null, hips: 'root', spine: 'hips', chest: 'spine', neck: 'chest', head: 'neck', jaw: 'head', tongue: 'jaw',
  'ear1.L': 'head', 'ear2.L': 'ear1.L', 'ear1.R': 'head', 'ear2.R': 'ear1.R',
  'brow.L': 'head', 'brow.R': 'head',
  'eyeSocket.L': 'head', 'eye.L': 'eyeSocket.L', 'pupil.L': 'eye.L', 'lidUp.L': 'eyeSocket.L', 'lidLo.L': 'eyeSocket.L',
  'eyeSocket.R': 'head', 'eye.R': 'eyeSocket.R', 'pupil.R': 'eye.R', 'lidUp.R': 'eyeSocket.R', 'lidLo.R': 'eyeSocket.R',
  xEyes: 'head',
  tail1: 'hips', tail2: 'tail1', tail3: 'tail2', tail4: 'tail3',
  'clav.L': 'chest', 'upperArm.L': 'clav.L', 'foreArm.L': 'upperArm.L', 'hand.L': 'foreArm.L',
  'clav.R': 'chest', 'upperArm.R': 'clav.R', 'foreArm.R': 'upperArm.R', 'hand.R': 'foreArm.R',
  'thigh.L': 'hips', 'shin.L': 'thigh.L', 'foot.L': 'shin.L',
  'thigh.R': 'hips', 'shin.R': 'thigh.R', 'foot.R': 'shin.R',
  weapon: 'chest', butt: 'hips',
  'mouth.L': 'head', 'mouth.R': 'head',
};

export type P3 = [number, number, number];
const add = (a: P3, b: P3): P3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const lerp3 = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mx = (p: P3, s: number): P3 => [p[0] * s, p[1], p[2]];

/** Rest joint positions (model space) derived from a body plan. Shared by rig and mesh builders. */
export interface Joints {
  head: P3; headTop: P3;
  shoulder: Record<'L' | 'R', P3>; elbow: Record<'L' | 'R', P3>; wrist: Record<'L' | 'R', P3>; handTip: Record<'L' | 'R', P3>;
  armDir: Record<'L' | 'R', P3>; foreDir: Record<'L' | 'R', P3>;
  hip: Record<'L' | 'R', P3>; knee: Record<'L' | 'R', P3>; ankle: Record<'L' | 'R', P3>; toe: Record<'L' | 'R', P3>;
  eye: Record<'L' | 'R', P3>; brow: Record<'L' | 'R', P3>; earBase: Record<'L' | 'R', P3>; earMid: Record<'L' | 'R', P3>; earTip: Record<'L' | 'R', P3>;
}

export const SIDES = ['L', 'R'] as const;
/** Character-space x sign per side: L = -X, R = +X (the character's right when facing -Z). */
export const SX = { L: -1, R: 1 } as const;

export function computeJoints(p: BodyPlan): Joints {
  const head: P3 = [0, p.headY, 0];
  const j = {} as Joints;
  j.head = head;
  j.headTop = add(head, [0, p.cranium.c[1] + p.cranium.r[1], 0]);
  j.shoulder = { L: [0, 0, 0], R: [0, 0, 0] }; j.elbow = { L: [0, 0, 0], R: [0, 0, 0] }; j.wrist = { L: [0, 0, 0], R: [0, 0, 0] };
  j.handTip = { L: [0, 0, 0], R: [0, 0, 0] }; j.armDir = { L: [0, 0, 0], R: [0, 0, 0] }; j.foreDir = { L: [0, 0, 0], R: [0, 0, 0] };
  j.hip = { L: [0, 0, 0], R: [0, 0, 0] }; j.knee = { L: [0, 0, 0], R: [0, 0, 0] }; j.ankle = { L: [0, 0, 0], R: [0, 0, 0] }; j.toe = { L: [0, 0, 0], R: [0, 0, 0] };
  j.eye = { L: [0, 0, 0], R: [0, 0, 0] }; j.brow = { L: [0, 0, 0], R: [0, 0, 0] };
  j.earBase = { L: [0, 0, 0], R: [0, 0, 0] }; j.earMid = { L: [0, 0, 0], R: [0, 0, 0] }; j.earTip = { L: [0, 0, 0], R: [0, 0, 0] };
  for (const s of SIDES) {
    const k = SX[s];
    const sh: P3 = [p.shoulder[0] * k, p.shoulder[1], p.shoulder[2]];
    const a = p.armAngle;
    const d1: P3 = norm([Math.sin(a) * k, -Math.cos(a), -0.08]);
    const d2: P3 = norm([Math.sin(a * 0.85) * k, -Math.cos(a * 0.85), -0.28]);
    const el = add(sh, scale(d1, p.upperLen));
    const wr = add(el, scale(d2, p.foreLen));
    j.shoulder[s] = sh; j.elbow[s] = el; j.wrist[s] = wr; j.armDir[s] = d1; j.foreDir[s] = d2;
    j.handTip[s] = add(wr, scale(d2, p.handR * 1.5));
    j.hip[s] = [p.hipX * k, p.hipY, 0];
    j.knee[s] = [p.hipX * k, p.kneeY, p.kneeZ];
    j.ankle[s] = [p.hipX * k, p.ankleY, p.ankleZ];
    j.toe[s] = [p.hipX * k, 0.03, p.foot.toeZ];
    j.eye[s] = add(head, mx(p.eye.c, k));
    j.brow[s] = add(head, mx(p.brow.c, k));
    j.earBase[s] = add(head, mx(p.ear.base, k));
    j.earTip[s] = add(head, mx(p.ear.tip, k));
    j.earMid[s] = lerp3(j.earBase[s], j.earTip[s], p.ear.mid);
  }
  return j;
}

/** Right mouth corner (head-local, +X side): where the lip line tucks under the cheek. */
export function mouthCorner(p: BodyPlan): P3 {
  return p.muzzle ? muzzlePoint(p, 1.15, p.muzzle.base[2] - 0.055, 0.6) : padPoint(p, -0.4, 0.6);
}

/**
 * Point on the lower edge of the right cat whisker pad (head-local): `a` is the angle around the pad
 * seen from the front (-π/2 = bottom, 0 = outer side); `out` pushes it off the surface.
 */
export function padPoint(p: BodyPlan, a: number, out = 0): P3 {
  const pd = p.pads!, rx = pd.r, ry = pd.r * 0.82, rz = pd.r * 0.85, e = 0.93;
  return [pd.c[0] + rx * e * Math.cos(a), pd.c[1] + ry * e * Math.sin(a), pd.c[2] - rz * Math.sqrt(1 - e * e) - 0.0055 * out];
}

/**
 * Point on the corgi muzzle surface (head-local): angle `th` from the bottom (0) toward the +X side
 * (π/2), at depth z, pushed out by `out` × the lip-line radius. Follows the sweep in body.ts: linear
 * between the base / mid / tip rings, then the rounded end cap.
 */
export function muzzlePoint(p: BodyPlan, th: number, z: number, out = 0): P3 {
  const m = p.muzzle!;
  const mid = lerp3(m.base, m.tip, 0.55);
  const rings: [number, number, number, number][] = [ // z, cy, rVert, rHoriz
    [m.base[2], m.base[1], m.rBase[1], m.rBase[0]],
    [mid[2], mid[1], ((m.rBase[1] + m.rTip[1]) / 2) * 1.02, ((m.rBase[0] + m.rTip[0]) / 2) * 1.05],
    [m.tip[2], m.tip[1], m.rTip[1], m.rTip[0]],
  ];
  let cy: number, rv: number, rh: number;
  if (z <= m.tip[2]) {
    const L = Math.max(m.rTip[0], m.rTip[1]) * 0.8;
    const k = Math.sqrt(Math.max(0, 1 - Math.min(1, (m.tip[2] - z) / L) ** 2));
    cy = m.tip[1]; rv = m.rTip[1] * k; rh = m.rTip[0] * k;
  } else {
    const i = z >= rings[1][0] ? 0 : 1;
    const a = rings[i], b = rings[i + 1];
    const t = Math.min(1, Math.max(0, (z - a[0]) / (b[0] - a[0])));
    cy = a[1] + (b[1] - a[1]) * t; rv = a[2] + (b[2] - a[2]) * t; rh = a[3] + (b[3] - a[3]) * t;
  }
  const lip = 0.0055 * out;
  return [(rh + lip) * Math.sin(th), cy - (rv + lip) * Math.cos(th), z];
}

/**
 * Headgear cut over the cranium, as polar angles in units of π (0 = the top of the head): the front edge sits
 * above the brows, the sides above the cheeks (ears poke through), the back drops over the nape.
 */
export interface HeadCut { front: number; back: number; side?: number }

/** Polar angle (radians) of a headgear cut at azimuth ph (0 = front, -Z). */
export function cutAngle(ph: number, front: number, backA: number, sideA?: number): number {
  const c = Math.cos(ph), side = sideA ?? Math.min(0.43, (front + backA) / 2);
  return (side + (front - side) * Math.max(0, c) + (backA - side) * Math.max(0, -c)) * Math.PI;
}

export function norm(v: P3): P3 { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; }
export function scale(v: P3, s: number): P3 { return [v[0] * s, v[1] * s, v[2] * s]; }

export function buildRigTemplate(p: BodyPlan): RigTemplate {
  const j = computeJoints(p);
  const n = BONE_NAMES.length;
  const heads: Record<string, P3> = {};
  const tails: Record<string, P3> = {};
  const scales: Record<string, P3> = {};
  const set = (name: BoneName, h: P3, t: P3, s?: P3) => { heads[name] = h; tails[name] = t; if (s) scales[name] = s; };
  const hd = j.head;
  set('root', [0, 0, 0], [0, p.hipsY, 0]);
  set('hips', [0, p.hipsY, 0], [0, p.spineY, 0]);
  set('spine', [0, p.spineY, 0], [0, p.chestY, 0]);
  set('chest', [0, p.chestY, 0], [0, p.neckY, 0]);
  set('neck', [0, p.neckY, 0], hd);
  set('head', hd, j.headTop);
  const jawP = add(hd, p.jaw.pivot);
  set('jaw', jawP, add(hd, p.jaw.b));
  const tongue = add(jawP, [0, -0.004, -0.05]);
  set('tongue', tongue, add(tongue, [0, 0, -0.07]));
  for (const s of SIDES) {
    set(`ear1.${s}`, j.earBase[s], j.earMid[s]);
    set(`ear2.${s}`, j.earMid[s], j.earTip[s]);
    set(`brow.${s}`, j.brow[s], add(j.brow[s], [0.01 * SX[s], 0, 0]));
    const es: P3 = [p.eye.scale[0], p.eye.scale[1], p.eye.scale[2]];
    set(`eyeSocket.${s}`, j.eye[s], j.eye[s], es);
    set(`eye.${s}`, j.eye[s], j.eye[s]);
    set(`pupil.${s}`, j.eye[s], j.eye[s]);
    set(`lidUp.${s}`, j.eye[s], j.eye[s]);
    set(`lidLo.${s}`, j.eye[s], j.eye[s]);
    const clavH: P3 = [0.05 * SX[s], j.shoulder[s][1] - 0.01, 0];
    set(`clav.${s}`, clavH, j.shoulder[s]);
    set(`upperArm.${s}`, j.shoulder[s], j.elbow[s]);
    set(`foreArm.${s}`, j.elbow[s], j.wrist[s]);
    set(`hand.${s}`, j.wrist[s], j.handTip[s]);
    set(`thigh.${s}`, j.hip[s], j.knee[s]);
    set(`shin.${s}`, j.knee[s], j.ankle[s]);
    set(`foot.${s}`, j.ankle[s], j.toe[s]);
  }
  set('xEyes', add(hd, p.cranium.c), add(hd, p.cranium.c));
  const tp = p.tail.pts;
  for (let i = 0; i < 4; i++) set(`tail${i + 1}` as BoneName, tp[i], tp[i + 1]);
  set('weapon', [0.12, p.chestY, -0.25], [0.12, p.chestY, -0.55]);
  const butt: P3 = p.butt ? [0, p.butt.y, p.butt.z] : [0, p.hipsY - 0.04, 0.1];
  set('butt', butt, add(butt, [0, 0, 0.06]));
  for (const s of SIDES) { const c = add(hd, mx(mouthCorner(p), SX[s])); set(`mouth.${s}`, c, c); }

  const parent = new Int16Array(n);
  const modelRest = new Float32Array(n * 3), restLocal = new Float32Array(n * 3), restScale = new Float32Array(n * 3), tail = new Float32Array(n * 3);
  const index: Record<string, number> = {};
  BONE_NAMES.forEach((name, i) => { index[name] = i; });
  // Rest scale accumulates down the chain (children of a scaled socket live in its scaled space).
  const worldScale: P3[] = [];
  BONE_NAMES.forEach((name, i) => {
    const par = PARENT[name];
    parent[i] = par ? index[par] : -1;
    const h = heads[name], t = tails[name], s = scales[name] ?? [1, 1, 1];
    modelRest.set(h, i * 3); tail.set(t, i * 3); restScale.set(s, i * 3);
    const ws: P3 = par ? [worldScale[index[par]][0] * s[0], worldScale[index[par]][1] * s[1], worldScale[index[par]][2] * s[2]] : s;
    worldScale.push(ws);
    if (par) {
      const ph = heads[par], pws = worldScale[index[par]];
      restLocal.set([(h[0] - ph[0]) / pws[0], (h[1] - ph[1]) / pws[1], (h[2] - ph[2]) / pws[2]], i * 3);
    } else restLocal.set(h, i * 3);
  });
  return { names: BONE_NAMES, parent, modelRest, restLocal, restScale, tail, index };
}
