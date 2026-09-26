// Baron Von Floof — the Vac-Tank's pilot: a smug, oversized Maine Coon built with the character lane's
// kit (species plan, fur/face builder, 45-bone skeleton, CharacterAnimator with its face rig), plus his
// own accessories: lion-like mane, lynx ear tufts, a tilted crown with a jewel, a monocle on a chain,
// a crimson officer's jacket with gold epaulettes and a curled whisker moustache. Original design.
import * as THREE from 'three/webgpu';
import { toon, glow } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { Species, Anim } from '../../../shared/types';
import type { AvatarFrame } from '../../views/avatar';
import { RigInstance, type RigTemplate } from '../../anim/rig';
import { CharacterAnimator } from '../../anim/character-animator';
import type { Expression } from '../../anim/face';
import { MeshBuilder, ellipsoid, sweep, ring, ellipseLoop, type ColorFn, type V3 } from '../characters/mesh-builder';
import { buildBody } from '../characters/body';
import { buildRigTemplate, computeJoints, SIDES, SX } from '../characters/skeleton';
import { planFor, type BodyPlan, type Coat } from '../characters/species';
import { mixHex } from '../characters/colors';

const P = PALETTE;
/** Pilot scale relative to a regular cat (Maine Coons are big; bosses are bigger). */
export const PILOT_SCALE = 1.75;
export const PILOT_DETAIL = 0.93;

export function baronCoat(): Coat {
  return {
    name: 'mainecoon',
    base: mixHex(P.dirt, P.catGrey, 0.42),
    light: mixHex(P.catWhite, P.corgiCream, 0.35),
    dark: mixHex(P.mulch, P.corgiTri, 0.45),
    pattern: 'tabby',
    nose: mixHex(P.brick, P.catWhite, 0.35),
    innerEar: mixHex(P.catWhite, P.danger, 0.3),
    iris: P.accentHot,
    brow: mixHex(P.mulch, P.corgiTri, 0.6),
    socks: true,
    tongue: mixHex(P.danger, P.catWhite, 0.38),
  };
}

export function baronPlan(coat: Coat): BodyPlan {
  const p = planFor(Species.Cat, coat);
  p.tail = { ...p.tail, fluffy: true, r: p.tail.r.map((r) => r * 1.35) };
  p.ear = { ...p.ear, tip: [p.ear.tip[0] + 0.01, p.ear.tip[1] + 0.03, p.ear.tip[2]], w: p.ear.w * 1.05 };
  return p;
}

export interface PilotAsset {
  template: RigTemplate;
  boneInverses: THREE.Matrix4[];
  body: THREE.BufferGeometry;
  jewel: THREE.BufferGeometry;
  plan: BodyPlan;
  headTop: number;
  triangles: number;
}

const sstep = (e0: number, e1: number, x: number) => { const t = Math.min(1, Math.max(0, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };

export function buildPilotAsset(q = PILOT_DETAIL): PilotAsset {
  const coat = baronCoat();
  const plan = baronPlan(coat);
  const template = buildRigTemplate(plan);
  const j = computeJoints(plan);
  const mb = new MeshBuilder(template);
  const face = buildBody(mb, plan, coat, q);
  const H = plan.headY;
  const crimson = P.teamCats, gold = P.accentHot, goldDark = mixHex(P.accentHot, P.accent, 0.5);

  mb.begin('baron');
  // lion mane: a big tufted ruff around the neck and jowls
  const maneN = 16;
  mb.add(ellipsoid([0, plan.neckY + 0.005, 0.0], [0.27, 0.13, 0.23], maneN, 8, {
    mod: (u, v) => 1 + 0.2 * (Math.round(u * maneN) % 2) * sstep(0.35, 0.75, v) + 0.06 * Math.sin(u * 37),
  }), (x, y, z) => (z < -0.05 || y < plan.neckY - 0.04 ? coat.light : mixHex(coat.base, coat.light, 0.4)), { auto: ['chest', 'neck', 'head'] });
  // lynx tufts on the ear tips
  for (const s of SIDES) {
    const t = j.earTip[s];
    mb.add(sweep([t, [t[0] + 0.015 * SX[s], t[1] + 0.05, t[2]], [t[0] + 0.035 * SX[s], t[1] + 0.1, t[2]]], [[0.018, 0.018], [0.012, 0.012], [0.004, 0.004]], 5, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), coat.dark, { rigid: `ear2.${s}` });
  }
  // officer's jacket: crimson coat over the torso, gold buttons down the front
  const T = plan.torso;
  const jk: V3[] = [], jr: [number, number][] = [];
  for (let i = 1; i <= 6; i++) { jk.push([0, T.y[i], T.z[i] - 0.004]); jr.push([T.rx[i] * 1.1 + 0.012, T.rz[i] * 1.12 + 0.012]); }
  const jacket: ColorFn = (x, y, z) => {
    if (z < -0.08 && Math.abs(x) < 0.028 && Math.sin(y * 62) > 0.55) return gold;
    if (z < -0.06 && Math.abs(x) < 0.045) return mixHex(crimson, P.ink, 0.35);
    if (y < T.y[1] + 0.03) return goldDark; // hem
    return crimson;
  };
  mb.add(sweep(jk, jr, 12, { up: [1, 0, 0], capStart: 1, capEnd: 0, capStartLen: 0.4 }), jacket, { auto: ['hips', 'spine', 'chest'] });
  for (const s of SIDES) {
    const k = SX[s];
    const sh = j.shoulder[s], el = j.elbow[s];
    // sleeve (upper arm) with a gold cuff, epaulette with fringe
    mb.add(sweep([[sh[0] - 0.02 * k, sh[1] + 0.01, sh[2]], [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2], el], [[plan.armR[0] * 1.3, plan.armR[0] * 1.3], [plan.armR[0] * 1.25, plan.armR[0] * 1.25], [plan.armR[1] * 1.35, plan.armR[1] * 1.35]], 8, { up: [0, 0, 1], capStart: 1, capEnd: 1 }),
      (_x, y) => (y < el[1] + 0.035 ? gold : crimson), { auto: [`clav.${s}`, `upperArm.${s}`, `foreArm.${s}`] });
    mb.add(ellipsoid([sh[0] + 0.005 * k, sh[1] + 0.035, sh[2]], [0.085, 0.03, 0.075], 10, 5, {
      mod: (u, v) => 1 + 0.35 * (Math.round(u * 10) % 2) * sstep(0.55, 0.85, v),
    }), gold, { auto: [`clav.${s}`, 'chest'] });
  }
  // medals on the chest (left breast = -X side)
  for (const [x, y, c] of [[-0.085, plan.chestY + 0.02, gold], [-0.13, plan.chestY + 0.0, P.danger]] as const) {
    mb.add(ellipsoid([x, y, -0.2], [0.028, 0.034, 0.012], 8, 4), c, { rigid: 'chest' });
    mb.add(ellipsoid([x, y + 0.045, -0.195], [0.016, 0.02, 0.008], 5, 3), P.teamCorgisTrim, { rigid: 'chest' });
  }
  // tilted crown between the ears (+ jewel glow on the head bone)
  const crownC: V3 = [0.02, H + 0.36, 0.02];
  const tilt = 0.24;
  const cr = 0.12;
  const rot = new THREE.Euler(-0.08, 0, tilt, 'YXZ');
  const toCrown = (x: number, y: number, z: number): V3 => {
    const v = new THREE.Vector3(x, y, z).applyEuler(rot);
    return [crownC[0] + v.x, crownC[1] + v.y, crownC[2] + v.z];
  };
  const band: V3[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; band.push(toCrown(Math.cos(a) * cr, 0, Math.sin(a) * cr)); }
  mb.add(ring(band, [0.028, 0.02], 5), gold, { rigid: 'head' });
  for (let i = 0; i < 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * Math.PI * 2;
    const base = toCrown(Math.cos(a) * cr, 0.01, Math.sin(a) * cr), tip = toCrown(Math.cos(a) * cr * 1.08, 0.1, Math.sin(a) * cr * 1.08);
    mb.add(sweep([base, tip], [[0.03, 0.03], [0.006, 0.006]], 5, { up: [0, 0, 1], capStart: 1, capEnd: 1, capEndLen: 1.5 }), gold, { rigid: 'head' });
    mb.add(ellipsoid(toCrown(Math.cos(a) * cr * 1.1, 0.115, Math.sin(a) * cr * 1.1), [0.016, 0.016, 0.016], 5, 3), P.catWhite, { rigid: 'head' });
  }
  // monocle over the right eye (+X), chain down to the mane
  const e = plan.eye.c;
  const mc: V3 = [e[0] + 0.004, H + e[1] + 0.002, e[2] - 0.045];
  mb.add(ring(ellipseLoop(mc, [0.078, 0, 0], [0, 0.078, 0], 16), [0.013, 0.011], 4, [0, 0, -1]), gold, { rigid: 'head' });
  mb.add(ellipsoid(mc, [0.072, 0.072, 0.008], 12, 3), mixHex(P.catWhite, P.glowCyan, 0.3), { rigid: 'head' });
  mb.add(sweep([[mc[0] + 0.07, mc[1] - 0.03, mc[2]], [mc[0] + 0.1, mc[1] - 0.14, mc[2] + 0.02], [0.13, plan.neckY + 0.04, -0.14]], [[0.007, 0.007], [0.007, 0.007], [0.007, 0.007]], 4, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), gold, { auto: ['head', 'neck'] });
  // curled "waxed" whisker moustache from the whisker pads
  const pd = plan.pads;
  if (pd) {
    for (const s of SIDES) {
      const k = SX[s];
      for (const dy of [0.012, -0.014]) {
        const y0 = H + pd.c[1] + dy, z0 = pd.c[2] - 0.01;
        const path: V3[] = [[0.04 * k, y0, z0], [0.11 * k, y0 + 0.005, z0 + 0.01], [0.18 * k, y0 + 0.03, z0 + 0.03], [0.21 * k, y0 + 0.075, z0 + 0.03], [0.19 * k, y0 + 0.1, z0 + 0.02]];
        mb.add(sweep(path, path.map((_, i) => [0.009 * (1 - i * 0.12), 0.009 * (1 - i * 0.12)] as [number, number]), 4, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), P.catWhite, { rigid: 'head' });
      }
    }
  }
  const body = mb.build();

  // jewel (glow) in head-bone space
  const jg = new MeshBuilder(null);
  const jc = toCrown(0, 0.03, -cr - 0.012);
  jg.add(ellipsoid([jc[0] - j.head[0], jc[1] - j.head[1], jc[2] - j.head[2]], [0.03, 0.036, 0.02], 8, 4), 0xffffff);
  const jewel = jg.build();
  const boneInverses = RigInstance.bindMatrices(template).map((m) => m.invert());
  return { template, boneInverses, body, jewel, plan, headTop: Math.max(face.headTop, crownC[1] + 0.13), triangles: mb.triangles + jg.triangles };
}

export interface Pilot {
  root: THREE.Group;
  rig: RigInstance;
  animator: CharacterAnimator;
  skinned: THREE.SkinnedMesh;
  jewel: THREE.Mesh;
  /** Head top in the pilot's own space (unscaled). */
  headTop: number;
  update(f: AvatarFrame, dt: number): void;
  setExpression(e: Expression | null): void;
  dispose(): void;
}

let shared: PilotAsset | null = null;
let refs = 0;

export function acquirePilotAsset(): PilotAsset {
  if (!shared) shared = buildPilotAsset();
  refs++;
  return shared;
}

function releasePilotAsset(): void {
  if (--refs > 0 || !shared) return;
  shared.body.dispose();
  shared.jewel.dispose();
  shared = null;
}

export function createPilot(seed: number): Pilot {
  const asset = acquirePilotAsset();
  const rig = new RigInstance(asset.template);
  const skinned = new THREE.SkinnedMesh(asset.body, toon({ color: 0xffffff, vertexColors: true }));
  skinned.name = 'boss_pilot';
  skinned.add(rig.root);
  skinned.bind(new THREE.Skeleton(rig.bones, asset.boneInverses), new THREE.Matrix4());
  skinned.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.8);
  skinned.castShadow = true;
  const bi = asset.template.index;
  // Maine Coon proportions: bigger head, fuller chest
  const setScale = (name: string, x: number, y = x, z = x) => { const i = bi[name] * 3; rig.baseScale[i] = x; rig.baseScale[i + 1] = y; rig.baseScale[i + 2] = z; };
  setScale('head', 1.08);
  setScale('chest', 1.08, 1, 1.06);
  const jewel = new THREE.Mesh(asset.jewel, glow(P.laserRed, 1.35));
  jewel.name = 'boss_pilot_jewel';
  rig.bones[bi.head].add(jewel);
  const root = new THREE.Group();
  root.name = 'boss_pilot_root';
  root.scale.setScalar(PILOT_SCALE);
  root.add(skinned);
  const plan = asset.plan;
  const animator = new CharacterAnimator(rig, {
    species: 'cat', quadruped: false, seed, leftGrip: [0, 0, 0], muzzle: [0, 0, -0.3], handReach: plan.handR * 0.75, backZ: 0.3,
  });
  const f: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: Anim.Drive, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
  animator.setExpression('smug');
  animator.update(f, 1 / 60);
  let disposed = false;
  return {
    root, rig, animator, skinned, jewel, headTop: asset.headTop,
    update(frame, dt) { animator.update(frame, dt); },
    setExpression(e) { animator.setExpression(e); },
    dispose() {
      if (disposed) return;
      disposed = true;
      skinned.skeleton.dispose();
      releasePilotAsset();
    },
  };
}
