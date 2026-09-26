// Procedural character animation, authored in code and shared by every species (one skeleton).
// Layers (in order): locomotion blend (idle / walk-run cycle) → full-body overrides (zoomies on all
// fours, cat sprint, air, slide, swim, drive, emote) → upper-body aim (pitch + twist) → one-shots
// (recoil, hit, flip, land squash) → death flop → face → spring secondary motion (ears, tail, fluff,
// tongue) → FK → weapon placement in rig space → two-bone arm IK onto the weapon grips.
import * as THREE from 'three/webgpu';
import { Anim, EFlag } from '../../shared/types';
import { mulberry32 } from '../../shared/rng';
import type { AvatarFrame } from '../views/avatar';
import { PoseBuffer, type RigInstance } from './rig';
import { Spring, approach, clamp01, smooth01, elasticOut } from './springs';
import { FaceController, type Expression, type FaceParams } from './face';

export interface AnimSpec {
  species: 'corgi' | 'cat';
  /** Corgi sprint drops onto all fours ("zoomies"); cats sprint upright. */
  quadruped: boolean;
  seed: number;
  /** Weapon-local support-hand grip and muzzle. */
  leftGrip: [number, number, number];
  muzzle: [number, number, number];
  /** Hand mitten reach beyond the wrist (m). */
  handReach: number;
  /** Chest-local distance to clear the back (sling position). */
  backZ: number;
}

type Side = 'L' | 'R';
const SIDES: Side[] = ['L', 'R'];
const SX = { L: -1, R: 1 } as const;

// Lid rotations (radians about the socket's X axis). Lids are 75° spherical caps: the upper lid's
// edge sits at elevation a + 15°, so a = 0.85 hides it above the visible eye and a = -1.35 closes it
// past the bottom; the lower lid mirrors that (edge at a - 15°).
const LID_UP_OPEN = 0.85, LID_UP_CLOSED = -1.35;
const LID_LO_OPEN = -0.85, LID_LO_CLOSED = 0.2;

const _m = new THREE.Matrix4(), _m2 = new THREE.Matrix4();
const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _q3 = new THREE.Quaternion();
const _e = new THREE.Euler(0, 0, 0, 'YXZ');
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _v3 = new THREE.Vector3();
const _pAim = new THREE.Vector3(), _pLow = new THREE.Vector3(), _pSling = new THREE.Vector3(), _pCheer = new THREE.Vector3();
const _qAim = new THREE.Quaternion(), _qLow = new THREE.Quaternion(), _qSling = new THREE.Quaternion(), _qCheer = new THREE.Quaternion();
const _one = new THREE.Vector3(1, 1, 1);
const _target = new THREE.Vector3(), _pole = new THREE.Vector3(), _grip = new THREE.Vector3(), _sh = new THREE.Vector3();
const _rootPos = new THREE.Vector3(), _rootScale = new THREE.Vector3(), _rootQuat = new THREE.Quaternion();

export class CharacterAnimator {
  readonly face: FaceController;
  private b: Record<string, number>;
  private tmp: PoseBuffer;
  private t = 0;
  private phase = 0;
  private gallop = 0;
  private rng: () => number;
  // Smoothed layer weights.
  private w = { move: 0, run: 0, zoom: 0, sprint: 0, air: 0, slide: 0, swim: 0, drive: 0, aim: 0, sling: 0, cheer: 0, death: 0 };
  // One-shots.
  private recoil = new Spring(700, 0.42);
  private hit = new Spring(260, 0.38);
  /** Smug head toss after a kill (chin up + a little roll). */
  private toss = new Spring(150, 0.32);
  private hitSide = 1;
  private squash = new Spring(260, 0.3);
  private flipT = -1;
  private spawnT = -1;
  private emoteT = -1;
  private deathT = -1;
  private airTime = 0;
  private lastFireTrig = -10;
  private autoFireT = 0;
  private lastHitTrig = -10;
  private lastLandTrig = -10;
  private lastJumpTrig = -10;
  // Edge detection.
  private prev = { grounded: true, dead: false, hp: 1, speed: 0, yaw: 0, vy: 0, first: true };
  private accel = 0;
  private yawRate = 0;
  // Secondary motion.
  private earP = { L: new Spring(110, 0.3), R: new Spring(110, 0.3) };
  private earR = { L: new Spring(110, 0.3), R: new Spring(110, 0.3) };
  private earTip = { L: new Spring(160, 0.22), R: new Spring(160, 0.22) };
  private tailY = [new Spring(90, 0.35), new Spring(90, 0.32), new Spring(90, 0.3), new Spring(90, 0.28)];
  private tailX = [new Spring(90, 0.35), new Spring(90, 0.32), new Spring(90, 0.3), new Spring(90, 0.28)];
  private butt = new Spring(180, 0.22);
  private twitchT: number;
  private twitchSide: Side = 'L';
  private wagEnv = 0;
  /** 0..1 blend into the Ear Glide pose (EFlag.Gliding): ears spread out like wings. */
  private glideW = 0;
  private legTwitch = 0;
  /** Seeded idle personality: head tilt, hip cock, chest twist, stance width, breathing rate. */
  private persona: { tilt: number; hip: number; twist: number; splay: number; breath: number; look: number };
  /** Body facing yaw is read from the avatar root each frame (for turn rate). */
  yawSource: THREE.Object3D | null = null;
  /** Per-instance body scale (root). */
  bodyScale = 1;

  constructor(private readonly rig: RigInstance, private readonly spec: AnimSpec) {
    this.b = rig.tpl.index as Record<string, number>;
    this.tmp = new PoseBuffer(rig.tpl.names.length);
    this.rng = mulberry32(spec.seed ^ 0xa11ce);
    this.face = new FaceController(spec.seed, spec.species === 'cat');
    this.twitchT = 1 + this.rng() * 3;
    const r = () => this.rng() * 2 - 1;
    this.persona = { tilt: r() * 0.09, hip: r() * 0.05, twist: r() * 0.08, splay: 0.03 + this.rng() * 0.06, breath: 0.28 + this.rng() * 0.1, look: this.rng() * 10 };
  }

  setExpression(e: Expression | null): void { this.face.forced = e; }

  trigger(action: string, strength = 1): void {
    switch (action) {
      case 'fire': this.lastFireTrig = this.t; this.recoil.impulse(-9 * Math.min(2, strength)); break;
      case 'hit': this.lastHitTrig = this.t; this.hitSide = this.rng() < 0.5 ? -1 : 1; this.hit.impulse(11 * Math.min(2, Math.max(0.4, strength))); this.earImpulse(-4, 3); this.face.hurt(); break;
      // Scored a kill (host: GameEvent death with by = this entity): smug grin + head toss + ear flick.
      case 'kill': this.face.kill(); this.toss.impulse(4.5); this.earImpulse(2, -2); break;
      case 'jump':
        this.lastJumpTrig = this.t;
        if (!this.prev.grounded && this.airTime > 0.05) this.flipT = 0; // double jump → forward flip
        this.squash.impulse(3.2); this.earImpulse(3, 0);
        break;
      case 'land': {
        this.lastLandTrig = this.t;
        const s = Math.min(1.6, 0.35 + Math.max(0, strength) * 0.07);
        this.squash.impulse(-5.5 * s); this.earImpulse(-3 * s, 4 * s); this.butt.impulse(-2.5 * s);
        break;
      }
      case 'death': if (this.deathT < 0) this.deathT = 0; break;
      case 'spawn': this.spawnT = 0; this.deathT = -1; this.w.death = 0; break;
      case 'emote': this.emoteT = 0; break;
    }
  }

  private earImpulse(pitch: number, roll: number): void {
    for (const s of SIDES) { this.earP[s].impulse(pitch); this.earR[s].impulse(roll * -SX[s]); this.earTip[s].impulse(pitch * 1.4); }
  }

  update(f: AvatarFrame, dtIn: number): void {
    const dt = Math.min(Math.max(dtIn, 0), 0.1);
    this.t += dt;
    const { b, rig, spec } = this;
    const pose = rig.pose;
    const isCorgi = spec.species === 'corgi';

    // --- edge detection (works even when the host only feeds state, no triggers) ------------
    const yaw = this.yawSource ? this.yawSource.rotation.y : 0;
    if (this.prev.first) { this.prev.yaw = yaw; this.prev.speed = f.speed; this.prev.first = false; this.prev.dead = f.dead; this.prev.hp = f.hpFrac; }
    if (dt > 0) {
      let dy = yaw - this.prev.yaw;
      if (dy > Math.PI) dy -= Math.PI * 2; if (dy < -Math.PI) dy += Math.PI * 2;
      this.yawRate = approach(this.yawRate, dy / dt, 12, dt);
      this.accel = approach(this.accel, (f.speed - this.prev.speed) / dt, 10, dt);
    }
    if (f.dead && !this.prev.dead) this.trigger('death');
    if (!f.dead && this.prev.dead) this.trigger('spawn');
    if (!f.dead && f.hpFrac < this.prev.hp - 0.005 && this.t - this.lastHitTrig > 0.25) this.trigger('hit', (this.prev.hp - f.hpFrac) * 6);
    if (f.grounded && !this.prev.grounded && this.t - this.lastLandTrig > 0.2) this.trigger('land', Math.abs(this.prev.vy));
    if (!f.grounded && this.prev.grounded && f.vy > 2 && this.t - this.lastJumpTrig > 0.2) this.trigger('jump');
    if (f.firing && this.t - this.lastFireTrig > 0.4) {
      this.autoFireT -= dt;
      if (this.autoFireT <= 0) { this.recoil.impulse(-7); this.autoFireT = 0.12; }
    }
    this.airTime = f.grounded ? 0 : this.airTime + dt;

    // --- layer weights -------------------------------------------------------------------
    const dead = f.dead || this.deathT >= 0;
    const grounded = f.grounded || dead;
    const speed = f.speed;
    const sprinting = (f.sprinting || f.anim === Anim.Sprint) && speed > 3 && grounded && f.anim !== Anim.Slide;
    const shooting = f.aiming || f.firing;
    const zoom = sprinting && spec.quadruped && !shooting;
    const special = f.anim === Anim.Slide ? 'slide' : f.anim === Anim.Swim ? 'swim' : f.anim === Anim.Drive ? 'drive' : '';
    if (this.emoteT >= 0) { this.emoteT += dt; if (this.emoteT > 2.4 || speed > 1.2 || f.firing || dead || !grounded) this.emoteT = -1; }
    const W = this.w;
    W.move = approach(W.move, grounded && !special ? smooth01(speed / 1.4) : 0, 10, dt);
    W.run = approach(W.run, smooth01((speed - 2.5) / 4), 8, dt);
    W.zoom = approach(W.zoom, zoom ? 1 : 0, zoom ? 7 : 9, dt);
    W.sprint = approach(W.sprint, sprinting && !zoom ? 1 : 0, 8, dt);
    W.air = approach(W.air, !grounded && !special ? 1 : 0, 14, dt);
    W.slide = approach(W.slide, special === 'slide' ? 1 : 0, 10, dt);
    W.swim = approach(W.swim, special === 'swim' ? 1 : 0, 6, dt);
    W.drive = approach(W.drive, special === 'drive' ? 1 : 0, 8, dt);
    W.aim = approach(W.aim, shooting ? 1 : 0, shooting ? 18 : 5, dt);
    const slingT = Math.max(W.zoom, W.swim, W.drive * 0.9, dead ? 1 : 0);
    W.sling = approach(W.sling, slingT > 0.5 ? 1 : 0, 9, dt);
    W.cheer = approach(W.cheer, this.emoteT >= 0 ? 1 : 0, 8, dt);

    // Gait phase (cadence scales with speed; stubby corgi legs spin faster).
    const cadence = isCorgi ? 1.15 + speed * 0.5 : 1.0 + speed * 0.4;
    this.phase = (this.phase + Math.PI * 2 * cadence * dt) % (Math.PI * 200);
    this.gallop = (this.gallop + Math.PI * 2 * (2.6 + speed * 0.16) * dt) % (Math.PI * 200);

    pose.clear();
    // ---------------- base: idle + gait ----------------
    this.idle(pose, 1 - W.move);
    if (W.move > 0.001) this.cycle(pose, W.move, W.run);
    // ---------------- overrides ----------------
    if (W.sprint > 0.001) this.catSprint(pose, W.sprint);
    if (W.zoom > 0.001) this.overlay(W.zoom, (p) => this.zoomies(p));
    if (W.air > 0.001) this.overlay(W.air, (p) => this.air(p, f.vy));
    if (W.slide > 0.001) this.overlay(W.slide, (p) => this.slide(p));
    if (W.swim > 0.001) this.overlay(W.swim, (p) => this.swim(p));
    if (W.drive > 0.001) this.overlay(W.drive, (p) => this.drive(p));
    if (W.cheer > 0.001) this.emote(pose, W.cheer);

    // ---------------- upper-body aim (pitch + twist), head always tracks the view ----------
    const lock = (1 - W.zoom) * (1 - W.swim) * (1 - W.drive * 0.5);
    const yawOff = Math.max(-1.3, Math.min(1.3, f.aimYawOffset));
    const pitch = Math.max(-1.2, Math.min(1.2, f.aimPitch));
    // Torso carries 35% of the view when relaxed, all of its share when aiming; neck + head
    // make up the rest so the face tracks the view (fully while aiming, 65% while relaxed).
    const torso = lock * (0.35 + 0.65 * W.aim);
    pose.r(b.spine, pitch * 0.18 * torso, yawOff * 0.22 * torso, 0);
    pose.r(b.chest, pitch * 0.25 * torso, yawOff * 0.3 * torso, 0);
    // Bladed rifle stance while aiming: chest turns right (left shoulder forward so the support paw
    // reaches the foregrip), neck + head counter-turn so the face stays on target.
    const blade = W.aim * lock * (1 - W.cheer);
    pose.r(b.spine, 0, -0.16 * blade, 0);
    pose.r(b.chest, 0, -0.2 * blade, 0);
    pose.r(b.neck, 0, 0.16 * blade, 0);
    pose.r(b.head, 0, 0.2 * blade, 0);
    const headW = (1 - W.zoom * 0.6) * (1 - W.death);
    const track = 0.65 + 0.35 * W.aim;
    const restP = Math.max(0, track - 0.43 * torso) / 0.57, restY = Math.max(0, track - 0.52 * torso) / 0.55;
    pose.r(b.neck, pitch * 0.2 * headW * restP, yawOff * 0.25 * headW * restY, 0);
    pose.r(b.head, pitch * 0.37 * headW * restP, yawOff * 0.3 * headW * restY, 0);

    // ---------------- one-shots ----------------
    const rc = this.recoil.step(0, dt);
    pose.r(b.chest, -rc * 0.22, 0, 0);
    pose.r(b.head, -rc * 0.12, 0, 0);
    const hv = this.hit.step(0, dt);
    if (Math.abs(hv) > 1e-4) {
      pose.r(b.spine, hv * 0.5, 0, hv * 0.3 * this.hitSide);
      pose.r(b.chest, hv * 0.3, hv * 0.2 * this.hitSide, 0);
      pose.r(b.head, hv * 0.6, 0, -hv * 0.4 * this.hitSide);
    }
    if (this.flipT >= 0) {
      this.flipT += dt / 0.45;
      const k = Math.sin(Math.min(1, this.flipT) * Math.PI);
      for (const s of SIDES) { pose.r(b[`thigh.${s}`], 1.1 * k, 0, 0); pose.r(b[`shin.${s}`], -1.5 * k, 0, 0); }
      pose.r(b.spine, -0.35 * k, 0, 0);
      if (this.flipT >= 1) this.flipT = -1;
    }
    // Death flop: lerp toward the "dead bug" pose.
    if (this.deathT >= 0) {
      this.deathT += dt;
      W.death = smooth01(this.deathT / 0.35);
    } else W.death = approach(W.death, 0, 10, dt);
    if (W.death > 0.001) this.overlay(W.death, (p) => this.deathPose(p));

    // ---------------- face ----------------
    const hitAmt = Math.min(1, Math.abs(hv) / 0.4 + (this.t - this.lastHitTrig < 0.18 ? 0.8 : 0));
    const fp = this.face.update({ dead, firing: f.firing, aiming: f.aiming, hpFrac: f.hpFrac, zoomies: W.zoom > 0.5, emote: this.emoteT >= 0, hit: hitAmt, falling: !grounded && f.vy < -9 && this.airTime > 0.5, speed }, dt);
    const ts = this.toss.step(0, dt);
    if (!dead) pose.r(b.head, ts * 0.22, 0, ts * 0.12);
    this.applyFace(pose, fp, dead);

    // ---------------- secondary motion ----------------
    this.secondary(pose, f, fp, dt, dead);

    // ---------------- root: squash & stretch, flip, death roll, spawn pop -----------------
    const sqTarget = !grounded ? Math.max(-0.06, Math.min(0.1, Math.abs(f.vy) * 0.008)) : 0;
    const sq = this.squash.step(sqTarget, dt);
    let s = this.bodyScale;
    if (this.spawnT >= 0) {
      this.spawnT += dt;
      s *= Math.max(0.02, elasticOut(Math.min(1, this.spawnT / 0.5)));
      if (this.spawnT > 0.5) this.spawnT = -1;
    }
    _rootScale.set(s * (1 - sq * 0.45), s * (1 + sq), s * (1 - sq * 0.45));
    _rootPos.set(0, 0, 0);
    _rootQuat.identity();
    if (this.flipT >= 0) {
      const a = -Math.PI * 2 * smooth01(this.flipT);
      _rootQuat.setFromAxisAngle(_v.set(1, 0, 0), a);
      _v2.set(0, 0.55 * s, 0);
      _rootPos.copy(_v2).sub(_v3.copy(_v2).applyQuaternion(_rootQuat));
    }
    if (W.death > 0.001) {
      const dT = this.deathT >= 0 ? this.deathT : 1;
      const fall = Math.min(1, dT / 0.42);
      const bounce = dT > 0.42 ? Math.exp(-(dT - 0.42) * 7) * Math.sin((dT - 0.42) * 20) * 0.12 : 0;
      const ang = (Math.PI / 2) * (fall * fall) * W.death - bounce * W.death;
      _q.setFromAxisAngle(_v.set(1, 0, 0), ang);
      _rootQuat.premultiply(_q);
      _rootPos.y += 0.19 * s * W.death * fall;
    }

    // ---------------- FK, weapon, IK ----------------
    rig.evaluate();
    this.placeWeapon(pitch, yawOff, rc);
    const hold = (1 - W.sling) * (1 - W.death);
    const holdL = hold * (1 - W.cheer);
    this.armIK('R', hold);
    this.armIK('L', holdL);
    rig.apply(_rootPos, _rootQuat, _rootScale);

    this.prev.grounded = f.grounded; this.prev.dead = f.dead; this.prev.hp = f.hpFrac; this.prev.speed = f.speed; this.prev.yaw = yaw; this.prev.vy = f.vy;
  }

  /** Compute an override pose into tmp and blend it over `pose`. */
  private overlay(w: number, fn: (p: PoseBuffer) => void): void {
    const tmp = this.tmp;
    tmp.clear();
    fn(tmp);
    this.rig.pose.lerpTo(tmp, w);
  }

  // ======================= locomotion poses =======================

  private idle(p: PoseBuffer, w: number): void {
    if (w <= 0.001) return;
    const { b, t } = this;
    const pr = this.persona;
    const br = Math.sin(t * Math.PI * 2 * pr.breath);
    p.r(b.chest, 0.025 * br * w, pr.twist * w, 0);
    p.r(b.head, -0.02 * br * w, 0.08 * Math.sin(t * 0.41 + pr.look) * w, (pr.tilt + 0.03 * Math.sin(t * 0.33)) * w);
    const sw = Math.sin(t * 0.62) + pr.hip * 12;
    p.r(b.hips, 0, 0.03 * sw * w, 0.03 * sw * w);
    p.o(b.hips, 0.008 * sw * w, -0.004 * w, 0);
    p.r(b.spine, 0, -0.02 * sw * w - pr.twist * 0.5 * w, -0.02 * sw * w);
    for (const s of SIDES) {
      p.r(b[`thigh.${s}`], 0.06 * w, 0, (-0.03 * sw + pr.splay * SX[s]) * w); // + z swings a hanging leg toward +X
      p.r(b[`shin.${s}`], -0.12 * w, 0, 0);
      p.r(b[`foot.${s}`], 0.06 * w, 0, (0.03 * sw - pr.splay * SX[s]) * w);
    }
    // Breathing scale on the chest (subtle).
    const bs = 1 + 0.018 * br * w;
    p.s(b.chest, bs, 1 + 0.008 * br * w, bs);
  }

  private cycle(p: PoseBuffer, w: number, run: number): void {
    const { b } = this;
    const corgi = this.spec.species === 'corgi';
    const ph = this.phase;
    const swing = (corgi ? 0.55 : 0.45) + 0.45 * run;
    const knee = 0.35 + (corgi ? 1.0 : 0.9) * run;
    for (const s of SIDES) {
      const a = ph + (s === 'R' ? Math.PI : 0);
      const sw = Math.sin(a), cs = Math.cos(a);
      const th = swing * sw;
      const sh = -knee * Math.max(0, cs) - 0.1 - 0.15 * run * Math.max(0, -sw);
      p.r(b[`thigh.${s}`], (th + 0.05 * run) * w, 0, 0);
      p.r(b[`shin.${s}`], sh * w, 0, 0);
      p.r(b[`foot.${s}`], (-(th + sh) * 0.75 + 0.25 * Math.max(0, -cs) * run) * w, 0, 0);
    }
    const bounce = (Math.abs(Math.cos(ph)) - 0.6) * (0.018 + 0.028 * run);
    p.o(b.hips, 0, (bounce - 0.01 * run) * w, 0);
    const waddle = (corgi ? 0.09 : 0.04) * (1 - 0.4 * run);
    p.r(b.hips, 0, 0.13 * Math.sin(ph) * w, waddle * Math.sin(ph) * w);
    p.r(b.spine, -(0.05 + 0.14 * run) * w, -0.08 * Math.sin(ph) * w, -waddle * 0.6 * Math.sin(ph) * w);
    p.r(b.chest, -0.05 * run * w, -0.04 * Math.sin(ph) * w, 0);
    p.r(b.neck, 0.08 * run * w, 0, 0);
    p.r(b.head, (0.08 * run + 0.03 * Math.cos(ph * 2)) * w, 0, -waddle * 0.4 * Math.sin(ph) * w);
  }

  private catSprint(p: PoseBuffer, w: number): void {
    // Upright-leaning sprint: longer strides, deep lean, head up.
    const { b } = this;
    const ph = this.phase;
    for (const s of SIDES) {
      const a = ph + (s === 'R' ? Math.PI : 0);
      p.r(b[`thigh.${s}`], 0.35 * Math.sin(a) * w + 0.15 * w, 0, 0);
      p.r(b[`shin.${s}`], -0.45 * Math.max(0, Math.cos(a)) * w, 0, 0);
    }
    p.r(b.spine, -0.2 * w, 0, 0);
    p.r(b.chest, -0.1 * w, 0, 0);
    p.r(b.neck, 0.12 * w, 0, 0);
    p.r(b.head, 0.15 * w, 0, 0);
  }

  /** Corgi zoomies: torso horizontal, rotary gallop on all fours, head up, weapon slung. */
  private zoomies(p: PoseBuffer): void {
    const { b } = this;
    const g = this.gallop;
    const P = 1.3; // torso pitch forward
    const flex = Math.sin(g);
    p.r(b.hips, -P + 0.12 * flex, 0, 0);
    p.o(b.hips, 0, -0.07 + 0.03 * Math.abs(Math.cos(g)), -0.02);
    p.r(b.spine, -0.1 * flex, 0, 0);
    p.r(b.chest, 0.08 * flex, 0, 0);
    p.r(b.neck, 0.72, 0, 0);
    p.r(b.head, 0.5 - 0.06 * flex, 0, 0);
    // Hind legs (paired with a small lead offset) — compensate the torso pitch so they reach down.
    for (const s of SIDES) {
      const a = g + (s === 'R' ? 0.45 : 0);
      p.r(b[`thigh.${s}`], P - 0.12 * flex + 0.75 * Math.sin(a), 0, 0);
      p.r(b[`shin.${s}`], -0.5 - 0.6 * Math.max(0, Math.cos(a)), 0, 0);
      p.r(b[`foot.${s}`], 0.35, 0, 0);
      // Front legs: arms straight down to the ground, gallop out of phase.
      const fa = g + Math.PI + (s === 'R' ? 0.45 : 0);
      p.r(b[`clav.${s}`], 0.2, 0, 0);
      p.r(b[`upperArm.${s}`], P + 0.08 * flex + 0.8 * Math.sin(fa), 0, -SX[s] * 0.62);
      p.r(b[`foreArm.${s}`], 0.35 * Math.max(0, Math.cos(fa)) + 0.1, 0, 0);
      p.r(b[`hand.${s}`], -0.6, 0, 0);
    }
  }

  private air(p: PoseBuffer, vy: number): void {
    const { b } = this;
    const up = clamp01(vy / 6);
    const down = clamp01(-vy / 8);
    const kick = Math.sin(this.t * 14) * 0.15 * down;
    for (const s of SIDES) {
      const k = SX[s];
      p.r(b[`thigh.${s}`], 0.95 * up + 0.2 * down + kick * k, 0, 0.1 * down * -k);
      p.r(b[`shin.${s}`], -1.4 * up - 0.25 * down, 0, 0);
      p.r(b[`foot.${s}`], 0.35 * up + 0.3 * down, 0, 0);
    }
    p.r(b.spine, -0.12 * up + 0.08 * down, 0, 0);
    p.r(b.head, 0.12 * down - 0.05 * up, 0, 0);
    p.o(b.hips, 0, 0.02 * up, 0);
  }

  private slide(p: PoseBuffer): void {
    // Belly slide ("sploot"): torso flat, legs out behind, head up.
    const { b } = this;
    p.r(b.hips, -1.45, 0, 0);
    p.o(b.hips, 0, -0.16, 0);
    p.r(b.neck, 0.8, 0, 0);
    p.r(b.head, 0.55, 0, 0);
    for (const s of SIDES) {
      p.r(b[`thigh.${s}`], 1.45 - 1.35, 0, 0.12 * SX[s]);
      p.r(b[`shin.${s}`], -0.1, 0, 0);
      p.r(b[`foot.${s}`], -0.6, 0, 0);
    }
  }

  private swim(p: PoseBuffer): void {
    // Doggy paddle: chest forward, head up, all four paws churning.
    const { b } = this;
    const g = this.t * 11;
    p.r(b.hips, -0.75, 0, 0);
    p.o(b.hips, 0, -0.08 + 0.02 * Math.sin(g * 2), 0);
    p.r(b.neck, 0.45, 0, 0);
    p.r(b.head, 0.35, 0, 0);
    for (const s of SIDES) {
      const a = g + (s === 'R' ? Math.PI : 0);
      p.r(b[`thigh.${s}`], 0.75 + 0.6 * Math.sin(a), 0, 0);
      p.r(b[`shin.${s}`], -0.6 - 0.5 * Math.max(0, Math.cos(a)), 0, 0);
      p.r(b[`upperArm.${s}`], 1.6 + 0.7 * Math.sin(a + 1.2), 0, -SX[s] * 0.55);
      p.r(b[`foreArm.${s}`], 0.4 + 0.5 * Math.max(0, Math.cos(a + 1.2)), 0, 0);
    }
  }

  private drive(p: PoseBuffer): void {
    // Seated with paws forward (steering handled by the vehicle lane).
    const { b } = this;
    p.o(b.hips, 0, -0.1, 0.03);
    for (const s of SIDES) {
      p.r(b[`thigh.${s}`], 1.45, 0, 0.1 * SX[s]);
      p.r(b[`shin.${s}`], -1.3, 0, 0);
      p.r(b[`upperArm.${s}`], 1.1, 0, -SX[s] * 0.5);
      p.r(b[`foreArm.${s}`], 0.4, 0, 0);
    }
    p.r(b.spine, 0.08, 0, 0);
  }

  private emote(p: PoseBuffer, w: number): void {
    // Victory hop + left-paw wave (right paw raises the weapon) + butt wiggle.
    const { b } = this;
    const t = Math.max(0, this.emoteT);
    const hop = Math.max(0, Math.sin(t * Math.PI * 2 * 1.1)) * 0.05;
    p.o(b.hips, 0, hop * w, 0);
    p.r(b.hips, 0, 0.25 * Math.sin(t * 16) * w, 0.08 * Math.sin(t * 16) * w);
    // Left arm up and out (~33° above horizontal), forearm waving above the shoulder, clear of the head.
    p.r(b['clav.L'], 0, 0, -0.2 * w);
    p.r(b['upperArm.L'], 0.3 * w, 0, -1.55 * w);
    p.r(b['foreArm.L'], 0, 0, (-0.55 + 0.5 * Math.sin(t * 13)) * w);
    p.r(b.head, 0.15 * w, 0, 0.12 * Math.sin(t * 4) * w);
  }

  private deathPose(p: PoseBuffer): void {
    // "Dead bug": on the back (root roll), paws up, twitching legs.
    const { b } = this;
    const tw = this.legTwitch;
    p.r(b.spine, 0.1, 0, 0);
    p.r(b.neck, -0.25, 0, 0.3);
    p.r(b.head, -0.2, 0.4, 0.3);
    for (const s of SIDES) {
      const k = SX[s];
      p.r(b[`thigh.${s}`], 1.35 + (s === 'L' ? tw : -tw * 0.6) * 0.3, 0, 0.3 * k);
      p.r(b[`shin.${s}`], -0.7, 0, 0);
      p.r(b[`foot.${s}`], 0.4, 0, 0);
      p.r(b[`upperArm.${s}`], 1.5 + (s === 'R' ? tw : 0) * 0.3, 0, -0.3 * k);
      p.r(b[`foreArm.${s}`], 0.5, 0, 0);
    }
  }

  // ======================= face =======================

  private applyFace(p: PoseBuffer, fp: FaceParams, dead: boolean): void {
    const { b } = this;
    const cat = this.spec.species === 'cat';
    for (const s of SIDES) {
      const k = SX[s];
      const asymLid = fp.lidAsym * (s === 'L' ? 1 : -0.3);
      const up = Math.min(1, Math.max(0, fp.lidUp + asymLid));
      p.r(b[`lidUp.${s}`], LID_UP_OPEN + (LID_UP_CLOSED - LID_UP_OPEN) * up, 0, fp.slant * 0.5 * k);
      p.r(b[`lidLo.${s}`], LID_LO_OPEN + (LID_LO_CLOSED - LID_LO_OPEN) * fp.lidLo, 0, -fp.slant * 0.2 * k);
      const asym = fp.browAsym * (s === 'L' ? 1 : -1);
      // Lowered brows also come forward: below the brow line the cranium (and the lids) bulge out,
      // so a brow that only slid down would sink out of sight. Knitting pulls them toward the nose.
      const browY = fp.browY * 0.03 + asym * 0.016;
      const down = Math.max(0, -browY) / 0.03;
      p.o(b[`brow.${s}`], -k * fp.browIn * 0.011, browY, -down * 0.024 - fp.browIn * 0.004);
      p.r(b[`brow.${s}`], 0, 0, (-fp.browTilt * 0.5 - asym * 0.12) * k);
      p.r(b[`eye.${s}`], fp.lookY * 0.3 + fp.chin * 0.9, fp.lookX * 0.35 * -1 + fp.cross * 0.32 * k, 0);
      // Mouth corners bend the lip line: grin up, frown down, smirk one-sided, snarl back and out.
      const side = s === 'L' ? 1 : -0.45;
      p.o(b[`mouth.${s}`], k * (fp.snarl * 0.005 + Math.max(0, fp.smile) * 0.004), fp.smile * 0.015 + fp.smirk * side * 0.013 + fp.snarl * 0.004 - fp.jaw * 0.014, fp.snarl * 0.01);
      const ps = dead ? 0.0001 : fp.pupil;
      p.s(b[`pupil.${s}`], ps * (cat ? 0.35 + 0.9 * fp.slit : 1), ps, 1);
      if (dead) p.s(b[`eye.${s}`], 0.0001);
    }
    p.s(b.xEyes, dead ? 1 : 0.0001);
    p.r(b.jaw, -fp.jaw * 0.6, 0, 0);
    // Tongue slides out past the chin and droops (happy pant, zoomies, derp, death).
    const tg = fp.tongue;
    p.o(b.tongue, 0, -0.03 * tg, -0.075 * tg);
    p.r(b.tongue, -0.55 * tg, 0, 0);
    p.s(b.tongue, 1 + 0.15 * tg, 1 + 0.3 * tg, 1 + 0.75 * tg);
    p.r(b.head, -fp.chin, 0, fp.tilt);
  }

  // ======================= secondary motion =======================

  private secondary(p: PoseBuffer, f: AvatarFrame, fp: FaceParams, dt: number, dead: boolean): void {
    const { b, W } = { b: this.b, W: this.w };
    const speedN = Math.min(1.6, f.speed / 6.4);
    const vy = f.grounded ? 0 : f.vy;
    // Ear twitch (idle life).
    this.twitchT -= dt;
    if (this.twitchT <= 0) {
      this.twitchSide = this.rng() < 0.5 ? 'L' : 'R';
      this.earR[this.twitchSide].impulse(5 * -SX[this.twitchSide]);
      this.earTip[this.twitchSide].impulse(-4);
      this.twitchT = 1.5 + this.rng() * 4;
    }
    this.glideW = approach(this.glideW, (f.flags & EFlag.Gliding) ? 1 : 0, 7, dt);
    const gw = smooth01(this.glideW);
    for (const s of SIDES) {
      const k = SX[s];
      const fall = f.grounded ? 0 : Math.max(-0.4, Math.min(0.5, -vy * 0.04));
      const back = (fp.earsBack * 1.0 + speedN * 0.25 + W.zoom * 0.55 - this.accel * 0.012 + fall) * (1 - gw) + gw * 0.15;
      // gliding: "airplane" ears spread flat to the sides, with a slow flutter
      const droop = (fp.earsDroop * 0.9 + (dead ? 0.6 : 0) + this.yawRate * 0.03 * k) * (1 - gw) + gw * (1.35 + Math.sin(this.t * 17 + k) * 0.08);
      const ep = this.earP[s].step(back, dt);
      const er = this.earR[s].step(droop, dt);
      const tip = this.earTip[s].step(ep * 0.35, dt);
      p.r(b[`ear1.${s}`], ep * 0.8, 0, -er * 0.7 * k);
      p.r(b[`ear2.${s}`], tip * 0.9, 0, 0);
    }
    // Tail: wag + spring lag down the chain.
    const happy = this.face.mood === 'happy' || W.cheer > 0.5 || W.zoom > 0.5;
    this.wagEnv = approach(this.wagEnv, happy ? 1 : this.face.mood === 'terrified' ? 0 : 0.3, 3, dt);
    const corgi = this.spec.species === 'corgi';
    const wagF = corgi ? 13 : 3.2;
    const wag = Math.sin(this.t * wagF) * this.wagEnv * (corgi ? 0.5 : 0.35);
    const tuck = this.face.mood === 'terrified' ? 0.5 : 0;
    const stream = Math.min(1, speedN) * (corgi ? 0.2 : -0.45) + W.zoom * 0.2;
    let prevY = 0, prevX = 0;
    for (let i = 0; i < 4; i++) {
      const bi = b[`tail${i + 1}`];
      const lag = -this.yawRate * 0.05 * (i + 1);
      const ty = this.tailY[i].step((i === 0 ? wag : prevY * 0.7) + lag + (corgi ? 0 : Math.sin(this.t * 1.3 - i * 0.8) * 0.12), dt);
      const tx = this.tailX[i].step((i === 0 ? stream - tuck : prevX * 0.4 + stream * 0.3) - (f.grounded ? 0 : vy * 0.01), dt);
      p.r(bi, tx, ty, 0);
      prevY = ty; prevX = tx;
    }
    // Butt fluff jiggle + wiggle on happy.
    const bj = this.butt.step(0, dt);
    p.o(b.butt, 0, bj * 0.02, 0);
    p.s(b.butt, 1 - bj * 0.1, 1 + bj * 0.12, 1 - bj * 0.1);
    if (corgi && happy) p.r(b.butt, 0, Math.sin(this.t * 13) * 0.12 * this.wagEnv, 0);
    // Tongue flap in zoomies.
    if (W.zoom > 0.01) p.r(b.tongue, 0.25 * Math.sin(this.gallop * 2) * W.zoom, 0.2 * Math.sin(this.gallop) * W.zoom, 0);
    // Dead leg twitches (seeded).
    if (dead) this.legTwitch = Math.max(0, Math.sin(this.t * 9)) * (Math.sin(this.t * 1.7 + this.spec.seed) > 0.6 ? 1 : 0);
  }

  // ======================= weapon + arms =======================

  private placeWeapon(pitch: number, yawOff: number, recoil: number): void {
    const { rig, b, w: W } = this;
    const chest = rig.model[b.chest];
    // Pivot between the shoulders (rig space).
    rig.modelPos(b.chest, _v);
    _v.y += 0.07;
    // Aim: barrel along the exact view direction in rig space.
    _e.set(pitch, yawOff, 0, 'YXZ');
    _qAim.setFromEuler(_e);
    _pAim.set(0.12, -0.07, -0.3).applyQuaternion(_qAim).add(_v);
    // Low ready: muzzle down and across the body toward the left, follows the view loosely.
    _e.set(-0.55 + pitch * 0.3, yawOff * 0.5 + 0.5, -0.25, 'YXZ');
    _qLow.setFromEuler(_e);
    _e.set(0, yawOff * 0.5, 0, 'YXZ');
    _q.setFromEuler(_e);
    _pLow.set(0.09, -0.15, -0.27).applyQuaternion(_q).add(_v);
    const a = W.aim * (1 - W.cheer);
    _pAim.lerpVectors(_pLow, _pAim, a);
    _q2.copy(_qLow).slerp(_qAim, a); // (slerpQuaternions would alias its output with an input here)
    _qAim.copy(_q2);
    // Sling on the back (follows the chest): barrel up-left, lying on the pack.
    if (W.sling > 0.001) {
      // lookAt aims -Z (the barrel) at the target: muzzle up over the right shoulder, top facing out.
      _m.lookAt(_v2.set(0, 0, 0), _v3.set(0.5, 0.85, 0.06), _v.set(0, 0, 1));
      _qSling.setFromRotationMatrix(_m);
      _m2.compose(_pSling.set(0.02, 0.03, this.spec.backZ), _qSling, _one);
      _m.multiplyMatrices(chest, _m2);
      _m.decompose(_pSling, _qSling, _v2);
      _pAim.lerp(_pSling, W.sling);
      _qAim.slerp(_qSling, W.sling);
    }
    if (W.cheer > 0.001) {
      rig.modelPos(b.chest, _pCheer);
      _pCheer.add(_v2.set(0.2, 0.3, -0.05));
      _e.set(1.25, 0, -0.35, 'YXZ');
      _qCheer.setFromEuler(_e);
      _pAim.lerp(_pCheer, W.cheer);
      _qAim.slerp(_qCheer, W.cheer);
    }
    // Recoil kick in weapon space (back + muzzle climb).
    const kick = Math.max(0, -recoil);
    _v2.set(0, 0.03 * kick, 0.18 * kick).applyQuaternion(_qAim);
    _pAim.add(_v2);
    _q2.setFromAxisAngle(_v3.set(1, 0, 0), 0.45 * kick);
    _qAim.multiply(_q2);
    _m.compose(_pAim, _qAim, _one);
    rig.setModelMatrix(b.weapon, _m);
  }

  private armIK(s: Side, weight: number): void {
    if (weight <= 0.001) return;
    const { rig, b, spec } = this;
    const k = SX[s];
    const wm = rig.model[b.weapon];
    if (s === 'R') _grip.set(0, -0.01, 0.012); else _grip.set(spec.leftGrip[0], spec.leftGrip[1], spec.leftGrip[2]);
    _grip.applyMatrix4(wm);
    // Back the wrist off the grip so the mitten wraps it.
    rig.modelPos(b[`upperArm.${s}`], _sh);
    _v.subVectors(_grip, _sh).normalize();
    _target.copy(_grip).addScaledVector(_v, -spec.handReach);
    rig.modelQuat(b.chest, _q3);
    _pole.set(0.75 * k, -0.7, 0.35).applyQuaternion(_q3).normalize();
    rig.solveTwoBone(b[`upperArm.${s}`], b[`foreArm.${s}`], b[`hand.${s}`], _target, _pole, weight);
  }
}
