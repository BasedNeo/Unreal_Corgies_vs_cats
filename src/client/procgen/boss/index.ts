// OWNER: B1 boss lane. createBossAvatar() — the Vac-Tank with Baron Von Floof at the controls,
// implementing the shared Avatar contract (src/client/views/avatar.ts) so the lead routes
// EntityKind.Boss states to it from entity-views (see docs/handoff/B1.md).
//
// Everything the model does is derived from the AvatarFrame the host already builds for characters:
//   speed → treads/wheels · aimYawOffset/aimPitch → turret + laser barrel · hpFrac → hit shudder/flash,
//   damage state, pilot mood · flags → boss state (attack, stage, phase 2, progress; packBossFlags)
//   → telegraph glows, brush spin, mortar wind-up, lid pop, kitten hatch · dead → defeat + pilot eject.
// trigger() accepts the usual actions ('hit', 'land', 'death', 'fire') and boss ability names.
//
// Draw calls: mech (1 skinned toon) + mech glow red (1) + mech glow gold (1) + pilot (1 skinned toon)
// + crown jewel glow (1) = 5 ≤ 8. Triangles ≈ 13–14k ≤ 15k (see stats).
import * as THREE from 'three/webgpu';
import type { Avatar, AvatarFrame } from '../../views/avatar';
import { toon, glow } from '../../style/style-webgpu.js';
import { PALETTE } from '../../style/style-tokens.js';
import { RigInstance } from '../../anim/rig';
import { Spring, approach, smooth01, elasticOut } from '../../anim/springs';
import type { Expression } from '../../anim/face';
import { Anim, type TeamId } from '../../../shared/types';
import {
  BossAttack, BossStage, BOSS_ABILITY, bossByIndex, unpackBossFlags, type BossDef, type BossFlagState,
} from '../../../shared/content/bosses';
import { buildMechRig, buildMechGeometry, type MechGeometry } from './mech';
import { createPilot, PILOT_SCALE, type Pilot } from './pilot';

export { createBossTelegraphFx, bossTelegraphFx, type BossTelegraphFx, type TelegraphPrimitive } from './telegraph-fx';

export const BOSS_TRI_BUDGET = 15000;
export const BOSS_DRAW_BUDGET = 8;
/** Bump when the boss model changes appearance. */
export const BOSS_MODEL_VERSION = 1;

export interface BossAvatarOptions {
  /** BOSSES index (EntityState.cls of the boss entity). */
  boss?: number;
  seed?: number;
  team?: TeamId;
  isLocal?: boolean;
}

export interface BossAvatarStats { triangles: number; drawCalls: number; bones: number; pilotTriangles: number; mechTriangles: number }

export interface BossAvatar extends Avatar {
  def: BossDef;
  stats: BossAvatarStats;
  mech: THREE.SkinnedMesh;
  pilot: Pilot;
  /** Decoded boss state from the last frame (for labs/tests). */
  state: BossFlagState;
  /** Force a pilot expression (lab); null returns to the automatic mood. */
  setExpression(e: Expression | null): void;
}

interface MechAsset {
  rig: ReturnType<typeof buildMechRig>;
  geo: MechGeometry;
  boneInverses: THREE.Matrix4[];
  refs: number;
}
const assets = new Map<string, MechAsset>();

function acquireMech(def: BossDef): MechAsset {
  const key = `${def.id}:v${BOSS_MODEL_VERSION}`;
  let a = assets.get(key);
  if (!a) {
    const rig = buildMechRig();
    a = { rig, geo: buildMechGeometry(rig, def), boneInverses: RigInstance.bindMatrices(rig).map((m) => m.invert()), refs: 0 };
    assets.set(key, a);
  }
  a.refs++;
  return a;
}

function releaseMech(def: BossDef): void {
  const key = `${def.id}:v${BOSS_MODEL_VERSION}`;
  const a = assets.get(key);
  if (!a || --a.refs > 0) return;
  assets.delete(key);
  a.geo.body.dispose(); a.geo.glowRed.dispose(); a.geo.glowGold.dispose();
}

const _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
const TAU = Math.PI * 2;

export function createBossAvatar(opts: BossAvatarOptions = {}): BossAvatar {
  const def = bossByIndex(opts.boss ?? 0);
  const seed = (opts.seed ?? 1) >>> 0;
  const asset = acquireMech(def);
  const rig = new RigInstance(asset.rig);
  const b = asset.rig.index;
  const bodyMat = toon({ color: 0xffffff, vertexColors: true });
  const flashMat = toon({ color: 0xffffff, vertexColors: true, emissive: 0x5a2a1e, emissiveIntensity: 1 });
  const mech = new THREE.SkinnedMesh(asset.geo.body, bodyMat);
  mech.name = 'boss_vactank';
  mech.add(rig.root);
  mech.bind(new THREE.Skeleton(rig.bones, asset.boneInverses), new THREE.Matrix4());
  mech.castShadow = true;
  mech.receiveShadow = false;
  const glowRed = new THREE.SkinnedMesh(asset.geo.glowRed, glow(PALETTE.laserRed, 1.35));
  glowRed.name = 'boss_glow_red';
  glowRed.bind(mech.skeleton, new THREE.Matrix4());
  const glowGold = new THREE.SkinnedMesh(asset.geo.glowGold, glow(PALETTE.accentHot, 1.6));
  glowGold.name = 'boss_glow_gold';
  glowGold.bind(mech.skeleton, new THREE.Matrix4());

  const root = new THREE.Group();
  root.name = `boss_${def.id}`;
  root.add(mech, glowRed, glowGold);

  const pilot = createPilot(seed ^ 0xba7);
  // hips on the seat: the seated (drive) pose drops the hips 0.1 m below the standing hip height
  const seatDrop = (pilot.rig.tpl.modelRest[pilot.rig.tpl.index.hips * 3 + 1] - 0.1) * PILOT_SCALE;
  pilot.root.position.set(0, -seatDrop, 0);
  rig.bones[b.seat].add(pilot.root);

  const mechTris = asset.geo.triangles;
  const pilotTris = (pilot.skinned.geometry.index!.count + pilot.jewel.geometry.index!.count) / 3;
  const stats: BossAvatarStats = { triangles: mechTris + pilotTris, drawCalls: 5, bones: asset.rig.names.length, pilotTriangles: pilotTris, mechTriangles: mechTris };
  root.userData.boss = stats;

  // ---------------- animation state
  const st: BossFlagState = { attack: 0, stage: 0, phase2: false, progress: 0 };
  let t = 0, stageT = 0, prevAttack = -1, prevStage = -1, first = true;
  let wheel = 0, brushA = 0, brushSpeed = 1.5, spinA = 0, spinRate = 0, ext = 0, crouch = 0;
  let lidT = -1, lidGone = false;
  let deathT = -1, ejectT = -1, pilotFree = false;
  const pilotVel = new THREE.Vector3(), pilotSpin = new THREE.Vector3();
  let prevHp = 1, flashT = 0, prevSpeed = 0, accel = 0, prevGrounded = true;
  let forcedExpr: Expression | null = null;
  let squint = 0, hatchOpen = 0, blinkT = 1.5 + (seed % 7) * 0.3, blink = 0;
  let mortarRise = 0, shotsSeen = 0;
  const shudder = new Spring(420, 0.25), landSq = new Spring(160, 0.35), recoil = new Spring(500, 0.4);
  const antP = new Spring(60, 0.18), antR = new Spring(60, 0.18);
  const plateFly = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const plateBones = [b.plateL, b.plateR, b.plateF];
  const plateDir = [[-1, 0.3], [1, 0.4], [-0.6, -0.8]];
  const lidPos = new THREE.Vector3(), lidVel = new THREE.Vector3(), lidRot = new THREE.Vector3();
  const pilotFrame: AvatarFrame = { speed: 0, vy: 0, grounded: true, anim: Anim.Drive, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false };

  const popLid = (instant: boolean) => {
    if (lidT >= 0 || lidGone) return;
    if (instant) { lidGone = true; return; }
    lidT = 0;
    lidPos.set(0, 0, 0);
    lidVel.set(1.2 + (seed % 3) * 0.3, 9.5, 2.2);
    lidRot.set(0, 0, 0);
  };

  const startDeath = () => {
    if (deathT >= 0) return;
    deathT = 0;
    popLid(false);
    shudder.impulse(9);
  };

  const eject = () => {
    if (pilotFree) return;
    pilotFree = true;
    ejectT = 0;
    root.updateMatrixWorld(true);
    root.attach(pilot.root);
    pilotVel.set(-2.2, 15.5, 6.5);
    pilotSpin.set(7.5, 1.5, 4.5);
    forcedExpr = 'terrified';
  };

  const onEnterStage = (attack: number, stage: number) => {
    if (attack === BossAttack.PhaseShift) popLid(false);
    if (attack === BossAttack.Mortar && stage === BossStage.Active) shotsSeen = 0;
    if (attack === BossAttack.Laser && stage === BossStage.Active) recoil.impulse(-3);
  };

  const pose = rig.pose;

  const avatar: BossAvatar = {
    root,
    height: def.height,
    def,
    stats,
    mech,
    pilot,
    state: st,
    setExpression(e) { forcedExpr = e; },

    update(f: AvatarFrame, dtIn: number) {
      const dt = Math.min(Math.max(dtIn, 0), 0.1);
      t += dt;
      unpackBossFlags(f.flags, st);
      if (first) {
        first = false; prevHp = f.hpFrac;
        if (st.phase2) popLid(true);
        if (f.dead) { deathT = 10; lidGone = true; }
      }
      if (st.attack !== prevAttack || st.stage !== prevStage) {
        stageT = 0;
        onEnterStage(st.attack, st.stage);
        prevAttack = st.attack; prevStage = st.stage;
      } else stageT += dt;
      if (st.phase2) popLid(false);
      if (f.dead) startDeath();
      // hits: shudder + brief warm flash
      if (!f.dead && f.hpFrac < prevHp - 0.0005) { shudder.impulse(Math.min(6, 1.5 + (prevHp - f.hpFrac) * 400)); flashT = 0.07; }
      prevHp = f.hpFrac;
      if (f.grounded && !prevGrounded) landSq.impulse(-4);
      prevGrounded = f.grounded;
      if (dt > 0) accel = approach(accel, (f.speed - prevSpeed) / dt, 6, dt);
      prevSpeed = f.speed;
      flashT = Math.max(0, flashT - dt);
      mech.material = flashT > 0 ? flashMat : bodyMat;

      const a = st.attack, s = st.stage;
      const tele = s === BossStage.Telegraph, active = s === BossStage.Active;
      const dying = deathT >= 0;

      // ---------------- drive: wheels + treads
      wheel -= (f.speed * dt) / 0.34;
      // ---------------- side brushes: lazy robot-vacuum spin, whirl for the brush spin attack
      const spinning = a === BossAttack.Spin && (tele || active);
      const wantBrush = dying ? 0 : spinning ? (active ? 32 : 6 + 24 * smooth01(stageT / 0.9)) : 1.6;
      brushSpeed = approach(brushSpeed, wantBrush, spinning ? 5 : 2, dt);
      brushA = (brushA + brushSpeed * dt) % (TAU * 100);
      ext = approach(ext, spinning ? 1 : 0, spinning ? 5 : 3, dt);
      crouch = approach(crouch, spinning && tele ? 1 : 0, 6, dt);
      spinRate = approach(spinRate, a === BossAttack.Spin && active ? 13 : 0, a === BossAttack.Spin && active ? 4 : 2.5, dt);
      spinA = (spinA + spinRate * dt) % TAU;
      if (spinRate < 0.05 && Math.abs(spinA) > 1e-3) spinA = approach(spinA > Math.PI ? spinA - TAU : spinA, 0, 3, dt);

      pose.clear();
      for (const n of ['wheelL0', 'wheelL1', 'wheelL2', 'wheelR0', 'wheelR1', 'wheelR2']) pose.r(b[n], wheel, 0, 0);
      const bob = dying ? 0 : Math.sin(t * 17) * 0.012 + Math.sin(t * 2.1) * 0.01;
      pose.o(b.treadL, 0, Math.max(0, Math.sin(wheel * 1.3)) * 0.015 * Math.min(1, f.speed), 0);
      pose.o(b.treadR, 0, Math.max(0, Math.sin(wheel * 1.3 + 1)) * 0.015 * Math.min(1, f.speed), 0);

      // ---------------- chassis: hum, lean into acceleration, hit shudder, spin, landing squash, defeat sag
      const sh = shudder.step(0, dt), sq = landSq.step(0, dt);
      const lean = Math.max(-0.08, Math.min(0.08, -accel * 0.03));
      const deathSag = dying ? smooth01(deathT / 0.8) : 0;
      pose.o(b.chassis, Math.sin(t * 61) * sh * 0.02, bob - crouch * 0.1 + sq * 0.06 - deathSag * 0.35, Math.cos(t * 53) * sh * 0.015);
      pose.r(b.chassis, lean + deathSag * 0.08, spinA, Math.sin(t * 47) * sh * 0.02 + deathSag * 0.12);
      pose.r(b.brushL, 0, brushA, 0);
      pose.r(b.brushR, 0, -brushA, 0);
      pose.o(b.brushL, -0.85 * ext, -0.4 * ext, -0.2 * ext);
      pose.o(b.brushR, 0.85 * ext, -0.4 * ext, -0.2 * ext);
      const brushGlow = spinning ? (active ? 1.25 : 0.6 + 0.5 * Math.abs(Math.sin(t * 12))) : 0.0001;
      pose.s(b.glowBrushL, brushGlow); pose.s(b.glowBrushR, brushGlow);

      // cat-eye headlights: blink, squint while telegraphing, wide when hurt, dark when defeated
      blinkT -= dt;
      if (blinkT <= 0) { blink = 0.16; blinkT = 2.5 + ((seed + Math.floor(t)) % 5) * 0.7; }
      blink = Math.max(0, blink - dt);
      squint = approach(squint, tele || (active && a !== BossAttack.Kittens) ? 1 : 0, 10, dt);
      const hurtWide = flashT > 0 ? 1.25 : 1;
      const eyeY = dying ? (deathT < 0.25 && Math.sin(deathT * 70) > 0 ? 0.6 : 0.0001) : Math.max(0.08, (1 - 0.6 * squint) * hurtWide * (blink > 0 ? 0.12 : 1));
      pose.s(b.eyeL, 1, eyeY, 1); pose.s(b.eyeR, 1, eyeY, 1);
      pose.r(b.eyeL, 0, 0, 0.25 * squint); pose.r(b.eyeR, 0, 0, -0.25 * squint);

      // cardboard plates: one flaps loose when badly hurt; all blow off on defeat
      for (let i = 0; i < 3; i++) {
        const pb = plateBones[i];
        if (dying) {
          const k = Math.max(0, deathT - 0.08 * i);
          const [dx, dz] = plateDir[i];
          plateFly[i].set(dx * 4.5 * k, 5 * k - 9 * k * k, dz * 4.5 * k);
          pose.o(pb, plateFly[i].x, plateFly[i].y, plateFly[i].z);
          pose.r(pb, k * 5 * (i + 1), k * 3, k * 4);
          if (k > 1.2) pose.s(pb, 0.0001);
        } else if (i === 0 && f.hpFrac < 0.35) {
          pose.r(pb, 0, 0, -0.45 - 0.08 * Math.sin(t * 6));
          pose.o(pb, 0, -0.12, 0);
        }
      }

      // rear kitten hatch
      const hatchWant = (a === BossAttack.Kittens && (tele || active)) || (a === BossAttack.PhaseShift && stageT > def.phase2.kittensAt - 0.4 && stageT < def.phase2.kittensAt + 1.3) ? 1 : 0;
      hatchOpen = approach(hatchOpen, hatchWant, hatchWant ? 7 : 3, dt);
      pose.r(b.hatch, -1.35 * hatchOpen, 0, 0);

      // antenna: springy
      const ap = antP.step(-accel * 0.04 + sh * 0.05, dt), ar = antR.step(Math.sin(t * 1.3) * 0.03 + spinRate * 0.02, dt);
      pose.r(b.antenna, ap, 0, ar);

      // ---------------- turret + laser barrel (aim from the snapshot yaw/pitch)
      const yawOff = dying ? f.aimYawOffset * (1 - deathSag) : f.aimYawOffset;
      pose.r(b.turret, 0, yawOff, dying ? deathSag * 0.1 : 0);
      const pitch = dying ? -0.45 * deathSag : Math.max(-0.65, Math.min(0.55, f.aimPitch));
      const rc = recoil.step(0, dt);
      pose.r(b.barrel, pitch + (a === BossAttack.Laser && active ? Math.sin(t * 90) * 0.006 : 0), 0, 0);
      pose.o(b.barrel, 0, 0, -rc * 0.05);
      const lensK = dying ? 0.0001 : a === BossAttack.Laser ? (active ? 2.3 : tele ? 1 + 0.9 * (0.5 + 0.5 * Math.sin(t * (12 + 20 * st.progress))) : 1) : 1;
      pose.s(b.lens, lensK);
      // siren beacon: pulses through every telegraph
      const alarm = !dying && (tele || a === BossAttack.PhaseShift);
      pose.s(b.bulb, alarm ? 0.85 + 0.7 * Math.max(0, Math.sin(t * 16)) : dying ? 0.0001 : 0.75);
      pose.r(b.beacon, 0, alarm ? t * 9 : 0, 0);

      // mortar: tubes rise and wobble during the wind-up, kick at each launch
      mortarRise = approach(mortarRise, a === BossAttack.Mortar && (tele || active) ? 1 : 0, 6, dt);
      if (a === BossAttack.Mortar && active) {
        const stagger = def.mortar.stagger;
        while (shotsSeen < (st.phase2 ? def.mortar.countP2 : def.mortar.count) && stageT >= shotsSeen * stagger) { recoil.impulse(-2.5); shotsSeen++; }
      }
      const mk = recoil.x;
      pose.o(b.mortar, 0, mortarRise * 0.16 + (a === BossAttack.Mortar ? Math.max(0, -mk) * 0.12 : 0), 0);
      pose.r(b.mortar, a === BossAttack.Mortar && tele ? Math.sin(t * 30) * 0.04 : 0, 0, 0);

      // lid: pops off in phase 2 (spins away, then gone)
      if (lidGone) pose.s(b.lid, 0.0001);
      else if (lidT >= 0) {
        lidT += dt;
        lidVel.y -= 22 * dt;
        lidPos.addScaledVector(lidVel, dt);
        lidRot.x += 6 * dt; lidRot.z += 3.5 * dt;
        pose.o(b.lid, lidPos.x, lidPos.y, lidPos.z);
        pose.r(b.lid, lidRot.x, 0, lidRot.z);
        const k = lidT < 0.08 ? elasticOut(lidT / 0.08) : 1;
        pose.s(b.lid, k);
        if (lidT > 1.35) { lidGone = true; pose.s(b.lid, 0.0001); }
      }

      // ---------------- pilot
      if (dying) deathT += dt;
      if (dying && deathT >= 0.45) eject();
      let expr: Expression = st.phase2 ? 'furious' : 'smug';
      if (f.hpFrac < 0.2) expr = 'terrified';
      if (a === BossAttack.Laser && (tele || active)) expr = 'happy'; // the Baron can't resist his own red dot
      if (a === BossAttack.Mortar && tele) expr = 'derp';             // hhhk... hairball
      if (a === BossAttack.Spin && active) expr = 'derp';             // dizzy
      if (a === BossAttack.PhaseShift || (a === BossAttack.Kittens && tele)) expr = 'furious';
      if (dying) expr = 'terrified';
      pilot.setExpression(forcedExpr ?? expr);
      pilotFrame.hpFrac = f.hpFrac;
      pilotFrame.aimPitch = Math.max(-0.35, Math.min(0.35, f.aimPitch)) * 0.7;
      pilotFrame.firing = a === BossAttack.Laser && active;
      if (pilotFree) {
        ejectT += dt;
        pilotVel.y -= 20 * dt;
        pilot.root.position.addScaledVector(pilotVel, dt);
        pilot.root.rotation.x += pilotSpin.x * dt;
        pilot.root.rotation.y += pilotSpin.y * dt;
        pilot.root.rotation.z += pilotSpin.z * dt;
        pilotFrame.anim = Anim.Fall; pilotFrame.grounded = false; pilotFrame.vy = pilotVel.y;
        // "blasting off again": shrink to a twinkle high above the wreck
        const k = ejectT < 1.25 ? 1 : Math.max(0.0001, 1 - (ejectT - 1.25) / 0.45);
        pilot.root.scale.setScalar(PILOT_SCALE * k);
        pilot.jewel.scale.setScalar(ejectT > 1.25 && ejectT < 1.9 ? 1 + 10 * Math.sin(((ejectT - 1.25) / 0.65) * Math.PI) : 1);
        pilot.root.visible = ejectT < 1.95;
      } else {
        pilotFrame.anim = Anim.Drive; pilotFrame.grounded = true; pilotFrame.vy = 0;
      }
      pilot.update(pilotFrame, dt);

      rig.evaluate();
      _v.set(0, 0, 0); _q.identity(); _s.set(1, 1, 1);
      rig.apply(_v, _q, _s);
    },

    trigger(action: string, strength = 1) {
      switch (action) {
        case 'hit': shudder.impulse(Math.min(6, 1.5 + strength)); flashT = 0.07; pilot.animator.trigger('hit', strength); break;
        case 'land': landSq.impulse(-Math.min(6, 2 + strength * 0.3)); break;
        case 'death': startDeath(); break;
        case 'fire': recoil.impulse(-1.2); break;
        case BOSS_ABILITY.lidPop: popLid(false); break;
        case BOSS_ABILITY.eject: startDeath(); if (deathT < 0.45) deathT = 0.45; break;
        case BOSS_ABILITY.mortarShell: recoil.impulse(-2.5); break;
        case BOSS_ABILITY.intro: landSq.impulse(-1); break;
      }
    },

    muzzleWorld(target: THREE.Vector3) {
      const lens = rig.bones[b.lens];
      lens.updateWorldMatrix(true, false);
      return lens.getWorldPosition(target);
    },

    dispose() {
      pilot.dispose();
      mech.skeleton.dispose();
      releaseMech(def);
    },
  };
  // settle into a first pose so the first rendered frame is never the bind pose
  avatar.update({ speed: 0, vy: 0, grounded: true, anim: Anim.Idle, flags: 1, aimPitch: 0, aimYawOffset: 0, hpFrac: 1, dead: false, firing: false, aiming: false, sprinting: false }, 1 / 60);
  first = true;
  void _e;
  return avatar;
}
