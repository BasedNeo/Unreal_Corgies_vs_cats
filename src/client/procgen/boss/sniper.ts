// OWNER: boss lane (E1). Madame Pointillé, the Dot Artiste — the Siamese sniper elite's model.
//
// Built from the character lane's kit, like B1's pilot (species plan, fur/face builder, 47-bone skeleton,
// CharacterAnimator with its face rig and aim layer, the Overwatch laser rifle), at 1.4× a cat, plus her own
// gear (original look): a black turtleneck, a crimson ascot whose striped tails stream over her left shoulder,
// a paintbrush tucked behind her right ear, and a tilted crimson beret with a black stalk. Siamese points
// (cream body, dark mask/ears/paws/tail) and ice-blue eyes read at range; the beret + scarf silhouette
// separates her from the Overwatch rank-and-file (boonie + mast).
//
// Implements the Avatar contract, driven only by the AvatarFrame the host builds for any entity:
//   flags → boss state (SniperAct/stage/phase 2/progress: packBossFlags) → crouch before a leap, expression,
//   phase 2 (the beret flies off, the tail puffs up), a shot flash; aimYawOffset/aimPitch → aim layer;
//   speed/vy/grounded/anim → locomotion and air poses; dead → the death flop (the sim tumbles her off).
// The laser beam, dot, glint and leap marker are drawn by the telegraph FX from the snapshot (truthful).
//
// Draw calls: body (1 skinned) + rifle (1) + rifle emitter glow (1) + beret (1) = 4 (W13: no crease ink).
import * as THREE from 'three/webgpu';
import type { Avatar, AvatarFrame } from '../../views/avatar';
import { toon, glow } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { RigInstance, type RigTemplate } from '../../anim/rig';
import { CharacterAnimator } from '../../anim/character-animator';
import type { Expression } from '../../anim/face';
import { approach, smooth01 } from '../../anim/springs';
import { Anim, EFlag, Species, Team } from '../../../shared/types';
import { MeshBuilder, ellipsoid, sweep, ring, ellipseLoop, type ColorFn, type V3 } from '../characters/mesh-builder';
import { buildBody } from '../characters/body';
import { buildRigTemplate, computeJoints, SIDES, SX } from '../characters/skeleton';
import { planFor, CAT_COATS, type BodyPlan, type Coat } from '../characters/species';
import { buildWeapon, type WeaponGeo } from '../characters/weapons';
import { mixHex } from '../characters/colors';
import { SniperAct, BossStage, unpackBossFlags, type BossFlagState, type SniperDef } from '../../../shared/content/bosses';

const P = PALETTE;
/** Mesh detail (between the hero 0.86 and B1's pilot 0.93): she is seen at 40–90 m, and up close in labs. */
export const SNIPER_DETAIL = 0.9;
export const SNIPER_FACE_DETAIL = 1.0;
/** Bump when the model changes appearance. */
export const SNIPER_MODEL_VERSION = 1;

const CRIMSON = P.teamCats;
const CRIMSON_DARK = mixHex(P.teamCats, P.ink, 0.35);
const BLACK = mixHex(P.catBlack, P.ink, 0.2);
const WOOD = mixHex(P.fenceWood, P.accent, 0.25);

export function pointilleCoat(): Coat {
  const base = CAT_COATS.find((c) => c.name === 'siamese') ?? CAT_COATS[0];
  // a touch creamier body and bluer, brighter eyes than the rank-and-file Siamese
  return { ...base, name: 'pointille', base: mixHex(P.catSiamese, P.catWhite, 0.25), iris: mixHex(P.glowCyan, P.teamCorgis, 0.3) };
}

export function pointillePlan(coat: Coat): BodyPlan {
  const p = planFor(Species.Cat, coat, 'infiltrator'); // lean build
  p.ear = { ...p.ear, tip: [p.ear.tip[0] + 0.015, p.ear.tip[1] + 0.04, p.ear.tip[2]], w: p.ear.w * 1.08 };
  p.tail = { ...p.tail, r: p.tail.r.map((r) => r * 1.1) };
  return p;
}

interface SniperAsset {
  key: string;
  template: RigTemplate;
  boneInverses: THREE.Matrix4[];
  body: THREE.BufferGeometry;
  beret: THREE.BufferGeometry;
  /** Beret pivot (head-bone local) — it spins off around this point. */
  beretPivot: V3;
  weapon: WeaponGeo;
  plan: BodyPlan;
  headTop: number;
  triangles: number;
  refs: number;
}

const assets = new Map<string, SniperAsset>();

function buildSniperAsset(key: string): SniperAsset {
  const coat = pointilleCoat();
  const plan = pointillePlan(coat);
  const template = buildRigTemplate(plan);
  const j = computeJoints(plan);
  const mb = new MeshBuilder(template);
  // HARDENED (K2): a scar through her left eye and a bitten ear (the marks of an elite), wet fur.
  const face = buildBody(mb, plan, coat, SNIPER_DETAIL, SNIPER_FACE_DETAIL, { weathered: true, scars: 1, scarSide: 'L', notch: true });
  const H = plan.headY;

  mb.begin('pointille');
  // black turtleneck over the torso (ribbed hem), rolled collar
  const T = plan.torso;
  const jk: V3[] = [], jr: [number, number][] = [];
  for (let i = 1; i <= 6; i++) { jk.push([0, T.y[i], T.z[i] - 0.003]); jr.push([T.rx[i] * 1.08 + 0.012, T.rz[i] * 1.1 + 0.012]); }
  const sweater: ColorFn = (_x, y) => (y < T.y[1] + 0.035 ? (Math.sin(_x * 120) > 0 ? BLACK : mixHex(BLACK, P.catGrey, 0.25)) : BLACK);
  mb.add(sweep(jk, jr, 12, { up: [1, 0, 0], capStart: 1, capEnd: 0, capStartLen: 0.4 }), sweater, { auto: ['hips', 'spine', 'chest'] });
  mb.add(ring(ellipseLoop([0, plan.neckY + 0.02, -0.008], [0.112, 0, 0], [0, 0, 0.102], 14), [0.03, 0.026], 5, [0, 1, 0]), BLACK, { auto: ['chest', 'neck'] });
  // sleeves to the elbow
  for (const s of SIDES) {
    const sh = j.shoulder[s], el = j.elbow[s], k = SX[s];
    mb.add(sweep([[sh[0] - 0.015 * k, sh[1] + 0.008, sh[2]], [(sh[0] + el[0]) / 2, (sh[1] + el[1]) / 2, (sh[2] + el[2]) / 2], el],
      [[plan.armR[0] * 1.28, plan.armR[0] * 1.28], [plan.armR[0] * 1.22, plan.armR[0] * 1.22], [plan.armR[1] * 1.3, plan.armR[1] * 1.3]], 8, { up: [0, 0, 1], capStart: 1, capEnd: 1 }),
    BLACK, { auto: [`clav.${s}`, `upperArm.${s}`, `foreArm.${s}`] });
  }
  // crimson ascot: a band above the collar, a puffed bib on the chest, a knot at her left and two white-striped
  // tails streaming back over the shoulder (breaks the silhouette from the side and from behind)
  const ny = plan.neckY + 0.06;
  const stripes: ColorFn = (_x, y) => (Math.sin(y * 70) > 0.6 ? P.catWhite : CRIMSON);
  mb.add(ring(ellipseLoop([0, ny, -0.01], [0.118, 0, 0], [0, 0, 0.108], 14), [0.026, 0.022], 5, [0, 1, 0]), CRIMSON, { auto: ['neck', 'head'] });
  const bibRz = T.rz[5] * 1.1 + 0.012, bibZ = T.z[5];
  mb.add(ellipsoid([0, plan.neckY - 0.035, bibZ - bibRz - 0.012], [0.085, 0.075, 0.035], 10, 6), CRIMSON, { auto: ['chest', 'neck'] });
  const knot: V3 = [-0.1, ny - 0.01, -0.07];
  mb.add(ellipsoid(knot, [0.042, 0.037, 0.037], 8, 5), CRIMSON_DARK, { rigid: 'neck' });
  const tailA: V3[] = [knot, [-0.17, ny - 0.02, 0.0], [-0.22, ny - 0.07, 0.12], [-0.25, ny - 0.14, 0.23]];
  const tailB: V3[] = [knot, [-0.15, ny - 0.05, -0.02], [-0.19, ny - 0.14, 0.08], [-0.2, ny - 0.22, 0.15]];
  for (const path of [tailA, tailB]) {
    mb.add(sweep(path, [[0.02, 0.03], [0.012, 0.038], [0.01, 0.04], [0.006, 0.034]], 5, { up: [0, 1, 0], capStart: 1, capEnd: 1 }), stripes, { auto: ['neck', 'chest'] });
  }
  // a paintbrush tucked behind the right ear (+X), a red dot of paint on the tip
  const e = j.earTip.R ?? [0.2, H + 0.5, 0];
  const bA: V3 = [0.16, H + 0.18, 0.08], bB: V3 = [e[0] + 0.02, H + 0.36, 0.1];
  mb.add(sweep([bA, bB], [[0.012, 0.012], [0.009, 0.009]], 6, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), WOOD, { rigid: 'head' });
  mb.add(ellipsoid([bB[0] + 0.012, bB[1] + 0.04, bB[2] + 0.005], [0.016, 0.04, 0.016], 6, 5), P.catBlack, { rigid: 'head' });
  mb.add(ellipsoid([bB[0] + 0.016, bB[1] + 0.078, bB[2] + 0.006], [0.012, 0.014, 0.012], 5, 4), P.laserRed, { rigid: 'head' });
  const body = mb.build();

  // beret: its own rigid mesh (built around its own centre so it tumbles naturally when it flies off),
  // placed on the head bone in phase 1
  const bm = new MeshBuilder(null);
  const c: V3 = [-0.045, H + 0.37, 0.035];
  const tilt = new THREE.Euler(-0.18, 0.2, 0.34, 'YXZ');
  const at = (x: number, y: number, z: number): V3 => {
    const v = new THREE.Vector3(x, y, z).applyEuler(tilt);
    return [v.x, v.y, v.z];
  };
  bm.add(ellipsoid(at(0, 0.012, 0), [0.205, 0.062, 0.195], 16, 7, { p: 2.4, rot: [tilt.x, tilt.y, tilt.z] }), (_x, y) => (y < -0.02 ? CRIMSON_DARK : CRIMSON));
  const band: V3[] = [];
  for (let i = 0; i < 16; i++) { const a = (i / 16) * Math.PI * 2; band.push(at(Math.cos(a) * 0.158, -0.03, Math.sin(a) * 0.15)); }
  bm.add(ring(band, [0.018, 0.016], 4, at(0, 1, 0)), CRIMSON_DARK);
  bm.add(sweep([at(0.01, 0.06, 0), at(0.02, 0.105, 0.01)], [[0.011, 0.011], [0.008, 0.008]], 6, { up: [0, 0, 1], capStart: 1, capEnd: 1 }), BLACK);
  const beret = bm.build();
  const beretPivot: V3 = [c[0] - j.head[0], c[1] - j.head[1], c[2] - j.head[2]];

  const weapon = buildWeapon('overwatch', Team.Cats, SNIPER_DETAIL);
  const boneInverses = RigInstance.bindMatrices(template).map((m) => m.invert());
  const triangles = mb.triangles + bm.triangles + weapon.triangles;
  return {
    key, template, boneInverses, body, beret, beretPivot, weapon, plan,
    headTop: Math.max(face.headTop, c[1] + 0.09), triangles, refs: 0,
  };
}

function acquire(): SniperAsset {
  const key = `pointille:v${SNIPER_MODEL_VERSION}`;
  let a = assets.get(key);
  if (!a) { a = buildSniperAsset(key); assets.set(key, a); }
  a.refs++;
  return a;
}

function release(a: SniperAsset): void {
  if (--a.refs > 0) return;
  assets.delete(a.key);
  a.body.dispose(); a.beret.dispose(); a.weapon.geometry.dispose(); a.weapon.glow?.dispose();
}

export interface SniperAvatarStats { triangles: number; drawCalls: number; bones: number }

export interface SniperAvatar extends Avatar {
  kind: 'sniper';
  def: SniperDef;
  stats: SniperAvatarStats;
  skinned: THREE.SkinnedMesh;
  animator: CharacterAnimator;
  beret: THREE.Mesh;
  /** Decoded boss state from the last frame (labs/tests). */
  state: BossFlagState;
  /** Force an expression (lab); null returns to the automatic mood. */
  setExpression(e: Expression | null): void;
}

const _p = new THREE.Vector3();

export function createSniperAvatar(def: SniperDef, seed: number): SniperAvatar {
  const asset = acquire();
  const rig = new RigInstance(asset.template);
  const bi = asset.template.index;
  const bodyMat = toon({ color: 0xffffff, vertexColors: true, surfaceAttr: true, surface: 'fur' } as Parameters<typeof toon>[0]);
  const skinned = new THREE.SkinnedMesh(asset.body, bodyMat);
  skinned.name = 'boss_sniper_body';
  skinned.add(rig.root);
  skinned.bind(new THREE.Skeleton(rig.bones, asset.boneInverses), new THREE.Matrix4());
  skinned.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, 0.6, 0), 1.7);
  skinned.boundingBox = new THREE.Box3(new THREE.Vector3(-1.2, -0.2, -1.2), new THREE.Vector3(1.2, 1.9, 1.2));
  skinned.castShadow = true;
  // rifle (rigid) + emitter glow, like the character lane's weapons
  const weapon = new THREE.Mesh(asset.weapon.geometry, toon({ color: 0xffffff, vertexColors: true, surface: 'weapon', ...asset.weapon.finish } as Parameters<typeof toon>[0])); // X3: the Longshot's paint finish
  weapon.name = 'boss_sniper_rifle';
  weapon.castShadow = true;
  rig.bones[bi.weapon].add(weapon);
  let drawCalls = 2;
  if (asset.weapon.glow) {
    const g = new THREE.Mesh(asset.weapon.glow, glow(asset.weapon.glowColor, 2.6));
    g.name = 'boss_sniper_emitter';
    weapon.add(g);
    drawCalls++;
  }
  const muzzle = new THREE.Object3D();
  muzzle.name = 'muzzle';
  muzzle.position.fromArray(asset.weapon.muzzle);
  weapon.add(muzzle);
  // beret on the head bone (pivot = its centre, so it can tumble away)
  const beret = new THREE.Mesh(asset.beret, toon({ color: 0xffffff, vertexColors: true }));
  beret.name = 'boss_sniper_beret';
  beret.castShadow = true;
  const beretHome = new THREE.Group();
  beretHome.name = 'beret_home';
  rig.bones[bi.head].add(beretHome);
  beretHome.add(beret);
  beret.position.fromArray(asset.beretPivot);
  drawCalls++;

  const root = new THREE.Group();
  root.name = `boss_${def.id}`;
  const body = new THREE.Group();
  body.name = 'boss_sniper_scale';
  body.scale.setScalar(def.scale);
  body.add(skinned);
  root.add(body);

  const animator = new CharacterAnimator(rig, {
    species: 'cat', quadruped: false, seed: seed >>> 0, leftGrip: asset.weapon.leftGrip, muzzle: asset.weapon.muzzle,
    handReach: asset.plan.handR * 0.75, backZ: 0.3,
  });
  animator.yawSource = root;

  const st: BossFlagState = { attack: 0, stage: 0, phase2: false, progress: 0 };
  let forced: Expression | null = null;
  let crouch = 0, tailPuff = 0, shotFlash = 0, t = 0;
  let beretT = -1, beretGone = false;
  const beretVel = new THREE.Vector3(), beretSpin = new THREE.Vector3();
  const tailIdx = bi.tail1 * 3;

  const popBeret = (instant: boolean) => {
    if (beretT >= 0 || beretGone) return;
    if (instant) { beretGone = true; beret.visible = false; return; }
    beretT = 0;
    root.updateMatrixWorld(true);
    root.attach(beret); // keep its world pose, then fly in the avatar's space
    beretVel.set(-1.4, 5.6, 1.6);
    beretSpin.set(4.5, 7, 2.5);
  };

  const frame: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: Anim.Idle, flags: EFlag.Grounded, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };
  let first = true;

  const avatar: SniperAvatar = {
    kind: 'sniper',
    root,
    height: def.height,
    def,
    stats: { triangles: asset.triangles, drawCalls, bones: asset.template.names.length },
    skinned,
    animator,
    beret,
    state: st,
    setExpression(e) { forced = e; },

    update(f: AvatarFrame, dtIn: number) {
      const dt = Math.min(Math.max(dtIn, 0), 0.1);
      t += dt;
      unpackBossFlags(f.flags, st);
      if (first) { first = false; if (st.phase2) popBeret(true); }
      if (st.phase2) popBeret(false);
      const a = st.attack, s = st.stage;
      // crouch before a leap (the readable wind-up), spring back up in the air
      crouch = approach(crouch, a === SniperAct.Leap && s === BossStage.Telegraph ? 1 : 0, a === SniperAct.Leap && s === BossStage.Telegraph ? 9 : 6, dt);
      body.position.y = -0.16 * crouch * def.scale;
      body.scale.set(def.scale * (1 + 0.06 * crouch), def.scale * (1 - 0.1 * crouch), def.scale * (1 + 0.06 * crouch));
      // phase 2: the tail puffs up (bottle-brush) — an angry Siamese reads from across the yard
      tailPuff = approach(tailPuff, st.phase2 && !f.dead ? 1 : 0, 3, dt);
      const puff = 1 + 0.45 * smooth01(tailPuff);
      rig.baseScale[tailIdx] = puff; rig.baseScale[tailIdx + 1] = 1 + 0.15 * smooth01(tailPuff); rig.baseScale[tailIdx + 2] = puff;
      shotFlash = a === SniperAct.Track && s === BossStage.Active ? 1 : Math.max(0, shotFlash - dt * 4);
      // mood
      let expr: Expression = st.phase2 ? 'furious' : 'smug';
      if (a === SniperAct.Track && s === BossStage.Telegraph) expr = st.progress > 0.55 ? 'smug' : 'determined';
      if (a === SniperAct.Track && s !== BossStage.Telegraph) expr = 'smug';
      if (a === SniperAct.Lob && s !== BossStage.Recover) expr = 'derp';           // hhhk... hairball
      if (a === SniperAct.Stagger) expr = 'derp';                                   // right in the lens
      if (a === SniperAct.PhaseShift) expr = 'furious';
      if (a === SniperAct.Leap) expr = 'happy';                                     // wheee
      if (f.hpFrac < 0.2) expr = 'terrified';
      if (f.dead) expr = 'terrified';
      animator.setExpression(forced ?? expr);
      frame.speed = f.speed; frame.vy = f.vy; frame.grounded = f.grounded; frame.anim = f.anim; frame.flags = f.flags;
      frame.aimPitch = f.aimPitch; frame.aimYawOffset = f.aimYawOffset; frame.hpFrac = f.hpFrac; frame.dead = f.dead;
      frame.firing = f.firing || shotFlash > 0.5;
      frame.aiming = !f.dead && (f.aiming || a === SniperAct.Track || a === SniperAct.None || a === SniperAct.Intro) && a !== SniperAct.Leap && a !== SniperAct.Stagger;
      frame.sprinting = false;
      animator.update(frame, dt);
      // the flying beret
      if (beretT >= 0 && !beretGone) {
        beretT += dt;
        beretVel.y -= 16 * dt;
        beret.position.addScaledVector(beretVel, dt);
        beret.rotation.x += beretSpin.x * dt; beret.rotation.y += beretSpin.y * dt; beret.rotation.z += beretSpin.z * dt;
        if (beretT > 1.5) { beretGone = true; beret.visible = false; }
      }
    },

    trigger(action: string, strength = 1) {
      switch (action) {
        case 'beret_off': popBeret(false); break;
        case 'shot_spoiled': animator.trigger('hit', 2); break;
        case 'hit': case 'fire': case 'death': case 'land': case 'jump': case 'kill': case 'spawn': case 'emote':
          animator.trigger(action, strength);
          break;
      }
    },

    muzzleWorld(target: THREE.Vector3) {
      muzzle.updateWorldMatrix(true, false);
      return muzzle.getWorldPosition(target);
    },

    dispose() {
      skinned.skeleton.dispose();
      release(asset);
    },
  };
  void _p;
  avatar.update(frame, 1 / 60);
  first = true;
  return avatar;
}
