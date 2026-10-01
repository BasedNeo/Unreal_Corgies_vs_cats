// OWNER: vehicles lane (V1 kart, R1 RC plane). Client views for vehicles and vehicle terminals, driven purely by
// interpolated EntityStates (presentation only — the sim decides everything):
//   createVehicleViews(scene, { world }) -> { sync(states, dt), dispose() }
//   vehicleCameraFor(state)             -> chase-camera suggestion for a kart or a plane
//   mountedVehicle(rider, states)       -> the vehicle a Mounted rider sits in (body yaw, camera target)
//   mountedBodyTilt(rider, states)      -> a plane pilot's pitch + bank (tilt the avatar with the plane)
//
// Kart juice: wheels spin from forward speed, fronts steer from the yaw rate, a spring suspension bobs on
// bumps and squashes on landings, the body leans into turns and squats under throttle/brake, roll
// follows the lawn, exhaust puffs (one shared InstancedMesh), a glowing
// boost flame, tire smoke while drifting and dark smoke when badly damaged.
// Plane juice (R1): banks from the snapshot's roll (eased, so 30 Hz snapshots never step), the propeller
// spins with the throttle (comic whirl strokes when fast), balloon wheels roll on the ground, a glowing
// tennis-ball-can booster flame + puffs, engine puffs, wing-tip contrails in hard turns, a stall wobble,
// damage smoke; the Rooftop Hangar has a spinning propeller sign and painted runway markings.
import * as THREE from 'three/webgpu';
import { releaseObject3D } from '../engine/release';
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind, type TeamId } from '../../shared/types';
import { angleDelta, clamp, damp, lerpAngle } from '../../shared/math';
import { hash2 } from '../../shared/rng';
import type { WorldData } from '../../shared/world/world-data';
import { surfaceAt } from '../../shared/world/queries';
import { VEHICLES, TERMINALS, kartByIndex, planeByIndex, terminalByIndex, unpackPlaneAux, type PlaneDef } from '../../shared/content/vehicles';
import { terminalKindAt } from '../../shared/content/terminals';
import { toon, glow } from '../style/style-webgpu.js';
import { PALETTE } from '../style/style-tokens.js';
import { toonNoInk } from '../world/materials';
import { kartAssets, KART_WHEELS, KART_EXHAUST, KART_HOOD, KART_CHUTE } from './kart-model';
import { terminalAssets, SCREEN } from './terminal-model';
import { planeAssets, PLANE_PROP, PLANE_BOOSTER, PLANE_EXHAUST, PLANE_WINGTIPS, PLANE_WHEELS } from './plane-model';
import { hangarAssets, runwayGeometry, HANGAR_SIGN } from './hangar-model';
import { measureObject } from './parts';

export { kartAssets, releaseKartAssets, KART_PALETTES } from './kart-model';
export { terminalAssets, releaseTerminalAssets } from './terminal-model';
export { planeAssets, releasePlaneAssets, PLANE_PALETTES } from './plane-model';
export { hangarAssets, releaseHangarAssets } from './hangar-model';
export { measureObject } from './parts';

export interface VehicleViewsOptions {
  /** World data for terrain-following roll and ground-hugging terminal pads (recommended). */
  world?: WorldData;
  /** Render camera: puffs/smoke are only emitted within 70 m of it (saves particles far away). */
  camera?: THREE.Camera;
}

export interface VehicleViews {
  readonly group: THREE.Group;
  sync(states: Map<number, EntityState>, dt: number): void;
  dispose(): void;
  /** Counts for labs/tests (visible objects only). */
  stats(): { karts: number; planes: number; terminals: number; puffs: number; triangles: number; drawCalls: number };
}

// ---------------------------------------------------------------------------------------------
// Shared materials (from the style factory; never disposed by users)
// ---------------------------------------------------------------------------------------------
const bodyMat = () => toon({ color: 0xffffff, vertexColors: true });

const SCREEN_READY = () => glow(PALETTE.tennisBall, 2.4);
const SCREEN_BUSY = () => glow(PALETTE.glowOrange, 1.6);
const SCREEN_COOL = () => glow(PALETTE.laserRed, 2.2);

// ---------------------------------------------------------------------------------------------
// Puffs: one pooled InstancedMesh for every kart's exhaust, tire smoke and damage smoke
// ---------------------------------------------------------------------------------------------
const PUFF_MAX = 128;
class Puffs {
  readonly mesh: THREE.InstancedMesh;
  private px = new Float32Array(PUFF_MAX); private py = new Float32Array(PUFF_MAX); private pz = new Float32Array(PUFF_MAX);
  private vx = new Float32Array(PUFF_MAX); private vy = new Float32Array(PUFF_MAX); private vz = new Float32Array(PUFF_MAX);
  private age = new Float32Array(PUFF_MAX); private life = new Float32Array(PUFF_MAX);
  private s0 = new Float32Array(PUFF_MAX); private s1 = new Float32Array(PUFF_MAX);
  private cr = new Float32Array(PUFF_MAX); private cg = new Float32Array(PUFF_MAX); private cb = new Float32Array(PUFF_MAX);
  private n = 0;
  private m = new THREE.Matrix4();
  private c = new THREE.Color();
  constructor() {
    const g = new THREE.IcosahedronGeometry(0.5, 1);
    this.mesh = new THREE.InstancedMesh(g, toon({ color: 0xffffff }), PUFF_MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, this.c.set(0xffffff));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.name = 'vehicle_puffs';
    this.mesh.userData.noCameraCollide = true;
  }
  get alive(): number { return this.n; }
  spawn(x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, s0: number, s1: number, color: number): void {
    let i = this.n;
    if (i >= PUFF_MAX) { // recycle the oldest
      let oldest = 0;
      for (let k = 1; k < this.n; k++) if (this.age[k] / this.life[k] > this.age[oldest] / this.life[oldest]) oldest = k;
      i = oldest;
    } else this.n++;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z; this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.age[i] = 0; this.life[i] = life; this.s0[i] = s0; this.s1[i] = s1;
    this.c.set(color); this.cr[i] = this.c.r; this.cg[i] = this.c.g; this.cb[i] = this.c.b;
  }
  update(dt: number): void {
    const drag = Math.exp(-2.2 * dt);
    for (let i = 0; i < this.n; i++) {
      this.age[i] += dt;
      if (this.age[i] >= this.life[i]) {
        const j = --this.n; // swap-remove
        this.px[i] = this.px[j]; this.py[i] = this.py[j]; this.pz[i] = this.pz[j];
        this.vx[i] = this.vx[j]; this.vy[i] = this.vy[j]; this.vz[i] = this.vz[j];
        this.age[i] = this.age[j]; this.life[i] = this.life[j]; this.s0[i] = this.s0[j]; this.s1[i] = this.s1[j];
        this.cr[i] = this.cr[j]; this.cg[i] = this.cg[j]; this.cb[i] = this.cb[j];
        i--;
        continue;
      }
      this.vx[i] *= drag; this.vz[i] *= drag; this.vy[i] = this.vy[i] * drag + 0.9 * dt;
      this.px[i] += this.vx[i] * dt; this.py[i] += this.vy[i] * dt; this.pz[i] += this.vz[i] * dt;
    }
    for (let i = 0; i < this.n; i++) {
      const t = this.age[i] / this.life[i];
      const pop = Math.min(1, t * 6); // quick pop in, slow shrink out
      const s = (this.s0[i] + (this.s1[i] - this.s0[i]) * t) * pop * (1 - t * t * t);
      this.m.makeScale(s, s, s).setPosition(this.px[i], this.py[i], this.pz[i]);
      this.mesh.setMatrixAt(i, this.m);
      this.mesh.setColorAt(i, this.c.setRGB(this.cr[i], this.cg[i], this.cb[i]));
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
  dispose(): void { this.mesh.geometry.dispose(); this.mesh.dispose(); }
}

// ---------------------------------------------------------------------------------------------
// Kart view
// ---------------------------------------------------------------------------------------------
const tmpV = new THREE.Vector3(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpM = new THREE.Matrix4();
const tmpE = new THREE.Euler(0, 0, 0, 'YXZ');

/** Mowing only makes clippings on grass: terrain (not a deck/ramp) that is not a dirt/sand/mulch path. */
function onLawn(world: WorldData | undefined, s: EntityState): boolean {
  if (!world) return true;
  if (surfaceAt(world, s.x, s.z, s.y + 0.3).kind !== 'terrain') return false;
  const f = world.surface?.(s.x, s.z);
  return !f || f.dirt + f.sand + f.mulch < 0.5;
}

class KartView {
  readonly root = new THREE.Group();
  private body = new THREE.Group();
  private wheels: THREE.InstancedMesh;
  private flame: THREE.Mesh;
  private spin = [0, 0];
  private steer = 0;
  private roll = 0;
  private lean = 0;
  private squat = 0;
  private bob = 0;
  private bobV = 0;
  private yawRate = 0;
  private lastYaw: number;
  private lastFwd = 0;
  private lastVy = 0;
  private grounded = true;
  private puffT = 0;
  private smokeT = 0;
  private clipT = 0;
  private t = 0;
  readonly team: TeamId;
  readonly seed: number;

  constructor(s: EntityState) {
    this.team = s.team as TeamId;
    this.seed = s.seed;
    const a = kartAssets(this.team);
    this.root.name = `kart_${s.id}`;
    this.root.rotation.order = 'YXZ';
    this.body.rotation.order = 'YXZ';
    const mesh = new THREE.Mesh(a.body, bodyMat());
    mesh.castShadow = true; mesh.receiveShadow = true;
    mesh.name = 'kart_body';
    this.body.add(mesh);
    this.flame = new THREE.Mesh(a.flame, glow(PALETTE.glowOrange, 3.2));
    this.flame.position.copy(KART_EXHAUST);
    this.flame.visible = false;
    this.flame.name = 'kart_flame';
    this.body.add(this.flame);
    this.wheels = new THREE.InstancedMesh(a.wheel, bodyMat(), 4);
    this.wheels.castShadow = true;
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.name = 'kart_wheels';
    this.wheels.userData.noCameraCollide = true;
    this.wheels.frustumCulled = false; // 4 wheels hugging the body; the body mesh carries the culling
    this.root.add(this.body, this.wheels);
    this.lastYaw = s.yaw;
    this.root.position.set(s.x, s.y, s.z);
    this.writeWheels();
  }

  private writeWheels(): void {
    for (let i = 0; i < 4; i++) {
      const w = KART_WHEELS[i];
      tmpE.set(this.spin[w.front ? 1 : 0], w.front ? this.steer : 0, 0, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(w.x, w.y, w.z), tmpQ, tmpS.set(w.w, w.r, w.r));
      this.wheels.setMatrixAt(i, tmpM);
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  update(s: EntityState, dt: number, world: WorldData | undefined, puffs: Puffs, near: boolean): void {
    this.t += dt;
    const fwd = -Math.sin(s.yaw) * s.vx - Math.cos(s.yaw) * s.vz;
    const speed = Math.hypot(s.vx, s.vz);
    const grounded = (s.flags & EFlag.Grounded) !== 0;
    const boosting = (s.flags & EFlag.Sprinting) !== 0;
    const drifting = (s.flags & EFlag.Crouching) !== 0;
    if (dt > 0) {
      this.yawRate = damp(this.yawRate, angleDelta(this.lastYaw, s.yaw) / dt, 12, dt);
      const accel = (fwd - this.lastFwd) / dt;
      this.squat = damp(this.squat, clamp(accel * 0.008, -0.08, 0.08), 10, dt); // nose lifts on throttle, dives on brakes
      // Suspension: spring-damper on the body; bumps from vertical velocity changes, landings squash.
      const dvy = s.vy - this.lastVy;
      if (grounded && !this.grounded) this.bobV -= Math.min(2.2, Math.abs(this.lastVy) * 0.12 + 0.4);
      else if (grounded) this.bobV += clamp(dvy, -3, 3) * 0.05;
      this.bobV += (-160 * this.bob - 14 * this.bobV) * dt;
      this.bob = clamp(this.bob + this.bobV * dt, -0.12, 0.1);
      // Idle engine rumble.
      const rumble = Math.sin(this.t * (38 + speed * 2) + this.seed) * (0.004 + Math.min(speed, 15) * 0.0004);
      this.body.position.y = this.bob + rumble;
    }
    this.lastYaw = s.yaw; this.lastFwd = fwd; this.lastVy = s.vy; this.grounded = grounded;

    // Terrain roll (the sim sends pitch only).
    let rollTarget = 0;
    if (grounded && world) {
      const rx = Math.cos(s.yaw) * 0.5, rz = -Math.sin(s.yaw) * 0.5;
      const top = s.y + 0.6;
      const hl = surfaceAt(world, s.x - rx, s.z - rz, top).y, hr = surfaceAt(world, s.x + rx, s.z + rz, top).y;
      rollTarget = clamp(Math.atan2(hr - hl, 1.0), -0.5, 0.5);
    }
    this.roll = damp(this.roll, rollTarget, 10, dt);
    this.lean = damp(this.lean, clamp(-this.yawRate * speed * 0.011 * (drifting ? 1.4 : 1), -0.16, 0.16), 8, dt); // rolls out of the turn

    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(s.pitch, s.yaw, this.roll, 'YXZ');
    this.body.rotation.set(this.squat, 0, this.lean, 'YXZ');

    // Wheels: spin from forward speed (rears and fronts have different radii), fronts steer.
    this.spin[0] -= (fwd / KART_WHEELS[0].r) * dt;
    this.spin[1] -= (fwd / KART_WHEELS[2].r) * dt;
    const steerTarget = clamp((this.yawRate / Math.max(3, Math.abs(fwd))) * 2.2, -0.5, 0.5) * (fwd >= -0.5 ? 1 : -1);
    this.steer = damp(this.steer, steerTarget, 14, dt);
    this.writeWheels();

    // Boost flame (flickers), exhaust puffs, drift smoke, damage smoke.
    this.flame.visible = boosting;
    if (boosting) {
      const f = 0.8 + 0.35 * Math.sin(this.t * 47) + 0.2 * Math.sin(this.t * 83 + 1);
      this.flame.scale.set(1 + 0.2 * Math.sin(this.t * 31), f * 1.6, 1 + 0.2 * Math.sin(this.t * 29));
    }
    if (!near) return;
    this.root.updateMatrixWorld(true);
    this.puffT -= dt;
    if (this.puffT <= 0) {
      const busy = (s.flags & EFlag.Busy) !== 0;
      this.puffT = boosting ? 0.045 : busy ? 0.22 - Math.min(0.12, speed * 0.008) : 0.6;
      tmpV.copy(KART_EXHAUST).applyMatrix4(this.body.matrixWorld);
      const r = hash2(Math.floor(this.t * 60), this.seed, 7), r2 = hash2(Math.floor(this.t * 60), this.seed, 8);
      puffs.spawn(tmpV.x, tmpV.y + 0.05, tmpV.z, s.vx * 0.3 + (r - 0.5) * 0.4, 0.8 + r * 0.6, s.vz * 0.3 + (r2 - 0.5) * 0.4,
        boosting ? 0.35 : 0.8, boosting ? 0.12 : 0.08, (boosting ? 0.3 : 0.22) * (0.8 + r2 * 0.5), boosting ? PALETTE.glowOrange : r < 0.5 ? PALETTE.hullLight : PALETTE.concrete);
    }
    // Mowing: the side chute spits grass clippings while the kart rolls over the lawn.
    this.clipT -= dt;
    if (grounded && speed > 3 && this.clipT <= 0 && onLawn(world, s)) {
      this.clipT = 0.11 - Math.min(0.06, speed * 0.004);
      tmpV.copy(KART_CHUTE).applyMatrix4(this.body.matrixWorld);
      const rx = Math.cos(s.yaw), rz = -Math.sin(s.yaw);
      const r = hash2(Math.floor(this.t * 70), this.seed, 5), r2 = hash2(Math.floor(this.t * 70), this.seed, 6);
      const out = 2.2 + r * 1.5;
      puffs.spawn(tmpV.x, tmpV.y, tmpV.z, s.vx * 0.5 + rx * out, 0.9 + r2 * 0.8, s.vz * 0.5 + rz * out, 0.45, 0.05, 0.13 + r * 0.06, r2 < 0.5 ? PALETTE.grass : PALETTE.grassDry);
    }
    this.smokeT -= dt;
    const hpFrac = s.maxHp > 0 ? s.hp / s.maxHp : 1;
    if (this.smokeT <= 0 && ((drifting && grounded && speed > 4) || hpFrac < 0.35)) {
      this.smokeT = drifting ? 0.035 : 0.12;
      if (drifting && grounded) {
        for (let i = 0; i < 2; i++) {
          const w = KART_WHEELS[i];
          tmpV.set(w.x, 0.08, w.z + 0.1).applyMatrix4(this.root.matrixWorld);
          const r = hash2(Math.floor(this.t * 90), this.seed + i, 3), r2 = hash2(Math.floor(this.t * 90), this.seed + i, 4);
          puffs.spawn(tmpV.x + (r2 - 0.5) * 0.2, tmpV.y, tmpV.z, -s.vx * 0.12 + (r - 0.5), 0.4 + r * 0.5, -s.vz * 0.12 + (r2 - 0.5),
            0.5 + r2 * 0.3, 0.14, 0.34 + r * 0.3, r2 < 0.6 ? PALETTE.hullLight : PALETTE.concrete);
        }
      }
      if (hpFrac < 0.35) {
        tmpV.copy(KART_HOOD).applyMatrix4(this.body.matrixWorld);
        const r = hash2(Math.floor(this.t * 40), this.seed, 11);
        const fx = -Math.sin(s.yaw), fz = -Math.cos(s.yaw);
        puffs.spawn(tmpV.x + (r - 0.5) * 0.2, tmpV.y, tmpV.z, s.vx * 0.2 + fx * 0.4, 1.2 + r * 0.5, s.vz * 0.2 + fz * 0.4, 1.0, 0.1, 0.36, hpFrac < 0.15 ? PALETTE.ink : PALETTE.catGrey);
      }
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    releaseObject3D(this.root);
    this.wheels.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Plane view (R1)
// ---------------------------------------------------------------------------------------------
const PLANE_DEF = VEHICLES.rc_plane;
const whirlMat = () => toon({ color: PALETTE.ink }); // the prop blur strokes: dark paint (W13: no outline pass)

class PlaneView {
  readonly root = new THREE.Group();
  private prop: THREE.Mesh;
  private whirl: THREE.Mesh;
  private wheels: THREE.InstancedMesh;
  private flame: THREE.Mesh;
  private roll = 0;
  private throttle = 0;
  private propAngle = 0;
  private wheelSpin = 0;
  private wobble = 0;
  private t = 0;
  private puffT = 0;
  private boostT = 0;
  private trailT = 0;
  private smokeT = 0;
  readonly team: TeamId;
  readonly seed: number;
  private readonly def: PlaneDef;

  constructor(s: EntityState, def: PlaneDef) {
    this.def = def;
    this.team = s.team as TeamId;
    this.seed = s.seed;
    const a = planeAssets(this.team);
    this.root.name = `plane_${s.id}`;
    this.root.rotation.order = 'YXZ';
    const body = new THREE.Mesh(a.body, bodyMat());
    body.castShadow = true; body.receiveShadow = true;
    body.name = 'plane_body';
    body.position.y = -def.pivotY;
    this.prop = new THREE.Mesh(a.prop, bodyMat());
    this.prop.position.set(PLANE_PROP.x, PLANE_PROP.y - def.pivotY, PLANE_PROP.z);
    this.prop.castShadow = true;
    this.prop.name = 'plane_prop';
    this.whirl = new THREE.Mesh(a.whirl, whirlMat());
    this.whirl.position.copy(this.prop.position);
    this.whirl.position.z -= 0.03;
    this.whirl.visible = false;
    this.whirl.name = 'plane_whirl';
    this.whirl.userData.noCameraCollide = true;
    this.flame = new THREE.Mesh(a.flame, glow(PALETTE.glowOrange, 3.2));
    this.flame.position.set(PLANE_BOOSTER.x, PLANE_BOOSTER.y - def.pivotY, PLANE_BOOSTER.z);
    this.flame.visible = false;
    this.flame.name = 'plane_flame';
    this.wheels = new THREE.InstancedMesh(a.wheel, bodyMat(), PLANE_WHEELS.length);
    this.wheels.castShadow = true;
    this.wheels.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.wheels.frustumCulled = false; // hugging the body; the body carries the culling
    this.wheels.name = 'plane_wheels';
    this.wheels.userData.noCameraCollide = true;
    this.wheels.position.y = -def.pivotY;
    this.root.add(body, this.prop, this.whirl, this.flame, this.wheels);
    this.place(s);
    this.writeWheels();
  }

  private place(s: EntityState): void {
    this.root.position.set(s.x, s.y + this.def.pivotY, s.z);
    this.root.rotation.set(s.pitch, s.yaw, this.roll, 'YXZ');
  }

  private writeWheels(): void {
    for (let i = 0; i < PLANE_WHEELS.length; i++) {
      const w = PLANE_WHEELS[i];
      tmpE.set(this.wheelSpin * (0.13 / w.r), 0, 0, 'YXZ');
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(w.x, w.y, w.z), tmpQ, tmpS.set(w.w, w.r, w.r));
      this.wheels.setMatrixAt(i, tmpM);
    }
    this.wheels.instanceMatrix.needsUpdate = true;
  }

  update(s: EntityState, dt: number, puffs: Puffs, near: boolean): void {
    this.t += dt;
    const aux = unpackPlaneAux(s.ammo);
    const speed = Math.hypot(s.vx, s.vy, s.vz);
    const grounded = (s.flags & EFlag.Grounded) !== 0;
    const boosting = (s.flags & EFlag.Sprinting) !== 0;
    const stalled = (s.flags & EFlag.Crouching) !== 0;
    // Bank eases toward the snapshot's roll: remote planes bank smoothly between 30 Hz snapshots.
    this.roll = damp(this.roll, aux.roll, 14, dt);
    this.throttle = damp(this.throttle, aux.throttle, 8, dt);
    this.wobble = damp(this.wobble, stalled ? 1 : 0, 6, dt);
    this.place(s);
    if (this.wobble > 0.01) {
      this.root.rotation.z += Math.sin(this.t * 17 + this.seed) * 0.12 * this.wobble;
      this.root.rotation.x += Math.sin(this.t * 13) * 0.05 * this.wobble;
    }
    // Propeller: idle tick-over + throttle, windmilling with airspeed; comic whirl strokes when it is a blur.
    const rate = (s.flags & EFlag.Busy ? 6 : 0) + this.throttle * 70 + (grounded ? 0 : speed * 0.8);
    this.propAngle = (this.propAngle + rate * dt) % (Math.PI * 2);
    this.prop.rotation.z = this.propAngle;
    this.whirl.visible = rate > 32;
    this.whirl.rotation.z = -this.t * 3.1;
    // Wheels roll on the ground.
    if (grounded) { this.wheelSpin -= (speed / 0.13) * dt; this.writeWheels(); }
    this.flame.visible = boosting;
    if (boosting) {
      const f = 0.8 + 0.35 * Math.sin(this.t * 47) + 0.2 * Math.sin(this.t * 83 + 1);
      this.flame.scale.set(1 + 0.2 * Math.sin(this.t * 31), 1 + 0.2 * Math.sin(this.t * 29), f * 1.7);
    }
    if (!near) return;
    this.root.updateMatrixWorld(true);
    const body = this.root.children[0];
    const fwdX = -Math.sin(s.yaw), fwdZ = -Math.cos(s.yaw);
    const r = hash2(Math.floor(this.t * 60), this.seed, 7), r2 = hash2(Math.floor(this.t * 60), this.seed, 8);
    // Engine puffs (little two-stroke coughs), faster at high throttle.
    this.puffT -= dt;
    if (this.puffT <= 0 && (s.flags & EFlag.Busy)) {
      this.puffT = 0.5 - this.throttle * 0.35;
      tmpV.copy(PLANE_EXHAUST).applyMatrix4(body.matrixWorld);
      puffs.spawn(tmpV.x, tmpV.y, tmpV.z, s.vx * 0.4 + (r - 0.5) * 0.3, 0.5 + r * 0.4, s.vz * 0.4 + (r2 - 0.5) * 0.3, 0.6, 0.05, 0.16, r < 0.5 ? PALETTE.hullLight : PALETTE.concrete);
    }
    // Booster: orange puffs streaming back.
    this.boostT -= dt;
    if (boosting && this.boostT <= 0) {
      this.boostT = 0.03;
      tmpV.copy(PLANE_BOOSTER).applyMatrix4(body.matrixWorld);
      puffs.spawn(tmpV.x, tmpV.y, tmpV.z, s.vx * 0.2 - fwdX * 2, 0.3, s.vz * 0.2 - fwdZ * 2, 0.4, 0.1, 0.26 * (0.8 + r * 0.4), r < 0.6 ? PALETTE.glowOrange : PALETTE.tennisBall);
    }
    // Wing-tip contrails while pulling hard or boosting (short white wisps).
    this.trailT -= dt;
    if (!grounded && this.trailT <= 0 && (boosting || Math.abs(this.roll) > 0.55) && speed > 13) {
      this.trailT = 0.04;
      for (const tip of PLANE_WINGTIPS) {
        tmpV.copy(tip).applyMatrix4(body.matrixWorld);
        puffs.spawn(tmpV.x, tmpV.y, tmpV.z, s.vx * 0.1, 0.05, s.vz * 0.1, 0.35, 0.05, 0.1, PALETTE.catWhite);
      }
    }
    // Damage smoke.
    this.smokeT -= dt;
    const hpFrac = s.maxHp > 0 ? s.hp / s.maxHp : 1;
    if (hpFrac < 0.35 && this.smokeT <= 0) {
      this.smokeT = 0.1;
      tmpV.copy(PLANE_EXHAUST).applyMatrix4(body.matrixWorld);
      puffs.spawn(tmpV.x, tmpV.y, tmpV.z, s.vx * 0.3, 1.0 + r * 0.4, s.vz * 0.3, 1.0, 0.1, 0.34, hpFrac < 0.15 ? PALETTE.ink : PALETTE.catGrey);
    }
  }

  dispose(): void {
    this.root.removeFromParent();
    releaseObject3D(this.root);
    this.wheels.dispose();
  }
}

// ---------------------------------------------------------------------------------------------
// Rooftop Hangar view (R1): a neutral kiosk + a spinning propeller sign + painted runway markings
// ---------------------------------------------------------------------------------------------
class HangarView {
  readonly root = new THREE.Group();
  readonly runway: THREE.Mesh;
  private screen: THREE.Mesh;
  private sign: THREE.Mesh;
  private fill = 1;
  private spin = 0;
  private t = 0;
  constructor(s: EntityState) {
    const a = hangarAssets();
    this.root.name = `hangar_${s.id}`;
    const mesh = new THREE.Mesh(a.body, bodyMat());
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.screen = new THREE.Mesh(a.screen, SCREEN_READY());
    this.screen.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
    this.screen.userData.noCameraCollide = true;
    this.sign = new THREE.Mesh(a.sign, bodyMat());
    this.sign.position.copy(HANGAR_SIGN);
    this.sign.castShadow = true;
    this.root.add(mesh, this.screen, this.sign);
    // Runway markings: placed from the content site (pad pose), not from the kiosk.
    const site = TERMINALS.plane_hangar.site!;
    this.runway = new THREE.Mesh(runwayGeometry(site.runway), toonNoInk({ vertexColors: true }));
    this.runway.position.set(site.padX, site.padY, site.padZ);
    this.runway.rotation.y = site.padYaw;
    this.runway.receiveShadow = true;
    this.runway.userData.noCameraCollide = true;
    this.runway.name = 'hangar_runway';
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
  }

  update(s: EntityState, dt: number): void {
    this.t += dt;
    const busy = (s.flags & EFlag.Busy) !== 0;
    const cooling = busy && s.weapon < 0;
    const progress = s.maxHp > 0 ? clamp(s.hp / s.maxHp, 0, 1) : 1;
    this.fill = damp(this.fill, cooling ? Math.max(0.04, progress) : 1, 8, dt);
    this.screen.scale.y = this.fill;
    const mat = !busy ? SCREEN_READY() : cooling ? SCREEN_COOL() : SCREEN_BUSY();
    if (this.screen.material !== mat) this.screen.material = mat;
    this.screen.scale.x = !busy ? 1 + 0.025 * Math.sin(this.t * 4) : 1;
    // The sign propeller spins briskly when a plane is ready, idles while one is out, stops while cooling.
    this.spin = damp(this.spin, !busy ? 9 : cooling ? 0 : 2, 2, dt);
    this.sign.rotation.z -= this.spin * dt;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
  }

  dispose(): void { this.root.removeFromParent(); releaseObject3D(this.root); this.runway.removeFromParent(); this.runway.geometry.dispose(); }
}

// ---------------------------------------------------------------------------------------------
// Terminal view
// ---------------------------------------------------------------------------------------------
class TerminalView {
  readonly root = new THREE.Group();
  private screen: THREE.Mesh;
  private pad: THREE.Mesh;
  private fill = 1;
  private t = 0;
  constructor(s: EntityState, world: WorldData | undefined) {
    const a = terminalAssets(s.team as TeamId);
    this.root.name = `terminal_${s.id}`;
    const mesh = new THREE.Mesh(a.body, bodyMat());
    mesh.castShadow = true; mesh.receiveShadow = true;
    this.screen = new THREE.Mesh(a.screen, SCREEN_READY());
    this.screen.position.set(SCREEN.x, SCREEN.y, SCREEN.z);
    this.screen.userData.noCameraCollide = true;
    this.pad = new THREE.Mesh(a.pad, bodyMat());
    this.pad.receiveShadow = true;
    this.pad.userData.noCameraCollide = true;
    this.root.add(mesh, this.screen, this.pad);
    this.place(s, world);
  }

  private place(s: EntityState, world: WorldData | undefined): void {
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.set(0, s.yaw, 0);
    const def = terminalByIndex(s.cls) ?? TERMINALS.kart_terminal;
    // The pad sits on the kiosk's right at padOffset (same rule as the sim's site finder).
    const px = s.x + Math.cos(s.yaw) * def.padOffset, pz = s.z - Math.sin(s.yaw) * def.padOffset;
    const gy = world ? surfaceAt(world, px, pz, s.y + 1).y : s.y;
    this.pad.position.set(def.padOffset, gy - s.y, 0);
  }

  update(s: EntityState, dt: number): void {
    this.t += dt;
    const busy = (s.flags & EFlag.Busy) !== 0;
    const cooling = busy && s.weapon < 0;
    const progress = s.maxHp > 0 ? clamp(s.hp / s.maxHp, 0, 1) : 1;
    const target = cooling ? Math.max(0.04, progress) : 1;
    this.fill = damp(this.fill, target, 8, dt);
    this.screen.scale.y = this.fill;
    const mat = !busy ? SCREEN_READY() : cooling ? SCREEN_COOL() : SCREEN_BUSY();
    if (this.screen.material !== mat) this.screen.material = mat;
    // Ready screens "breathe" a little so they read as live.
    this.screen.scale.x = !busy ? 1 + 0.025 * Math.sin(this.t * 4) : 1;
    this.root.position.set(s.x, s.y, s.z);
    this.root.rotation.y = s.yaw;
  }

  dispose(): void { this.root.removeFromParent(); releaseObject3D(this.root); }
}

// ---------------------------------------------------------------------------------------------

export function createVehicleViews(scene: THREE.Scene, opts: VehicleViewsOptions = {}): VehicleViews {
  const group = new THREE.Group();
  group.name = 'vehicles';
  scene.add(group);
  const karts = new Map<number, KartView>();
  const planes = new Map<number, PlaneView>();
  const terms = new Map<number, TerminalView>();
  const hangars = new Map<number, HangarView>();
  const puffs = new Puffs();
  group.add(puffs.mesh);
  const camPos = new THREE.Vector3();

  return {
    group,
    sync(states, dt) {
      for (const [id, v] of karts) if (!states.has(id)) { v.dispose(); karts.delete(id); }
      for (const [id, v] of planes) if (!states.has(id)) { v.dispose(); planes.delete(id); }
      for (const [id, v] of terms) if (!states.has(id)) { v.dispose(); terms.delete(id); }
      for (const [id, v] of hangars) if (!states.has(id)) { v.dispose(); hangars.delete(id); }
      const cam = opts.camera ?? null;
      if (cam) cam.getWorldPosition(camPos);
      for (const [id, s] of states) {
        if (s.kind === EntityKind.Vehicle) {
          const near = !cam || Math.hypot(s.x - camPos.x, s.z - camPos.z) < 70;
          const pd = planeByIndex(s.cls);
          if (pd) {
            let v = planes.get(id);
            if (v && v.team !== s.team) { v.dispose(); planes.delete(id); v = undefined; }
            if (!v) { v = new PlaneView(s, pd); planes.set(id, v); group.add(v.root); }
            v.update(s, dt, puffs, near);
            continue;
          }
          let v = karts.get(id);
          if (v && v.team !== s.team) { v.dispose(); karts.delete(id); v = undefined; }
          if (!v) { v = new KartView(s); karts.set(id, v); group.add(v.root); }
          v.update(s, dt, opts.world, puffs, near);
        } else if (s.kind === EntityKind.Terminal && terminalKindAt(s.cls) === 'vehicle') { // S1 kiosks draw themselves
          if (terminalByIndex(s.cls)?.vehicle === 'rc_plane') {
            let v = hangars.get(id);
            if (!v) { v = new HangarView(s); hangars.set(id, v); group.add(v.root, v.runway); }
            v.update(s, dt);
            continue;
          }
          let v = terms.get(id);
          if (!v) { v = new TerminalView(s, opts.world); terms.set(id, v); group.add(v.root); }
          v.update(s, dt);
        }
      }
      puffs.update(dt);
    },
    dispose() {
      for (const v of karts.values()) v.dispose();
      for (const v of planes.values()) v.dispose();
      for (const v of terms.values()) v.dispose();
      for (const v of hangars.values()) v.dispose();
      karts.clear(); planes.clear(); terms.clear(); hangars.clear();
      puffs.dispose();
      group.removeFromParent();
    },
    stats() {
      const m = measureObject(group);
      return { karts: karts.size, planes: planes.size, terminals: terms.size + hangars.size, puffs: puffs.alive, triangles: m.triangles, drawCalls: m.drawCalls };
    },
  };
}

// ---------------------------------------------------------------------------------------------
// Camera + rider helpers
// ---------------------------------------------------------------------------------------------

export interface VehicleCameraParams {
  /** Distance (m) from the pivot back to the camera. */
  distance: number;
  /** Pivot height (m) above the vehicle's ground point (use instead of AIM_RAY.pivotHeight while driving). */
  height: number;
  /** Vertical FOV (degrees). */
  fov: number;
  /** Over-the-shoulder offset (m): 0 = centered behind the vehicle. */
  shoulder: number;
  /** Resting pitch (rad, negative = looking down) the camera eases to when the mouse is idle (see pitchFollow). */
  pitch: number;
  /** Chase yaw: the camera sits behind the vehicle's heading. */
  yaw: number;
  /** How fast (1/s) the camera yaw should swing back behind the vehicle when the mouse is idle. 0 = don't. */
  followRate: number;
  /**
   * How fast (1/s) the camera pitch should ease to `pitch` when the mouse is idle. 0 = don't (karts). Planes: the
   * camera aim IS the flight command (mouse-aim), so `pitch` is the plane's own pitch — a hands-off plane holds its
   * attitude while the view settles behind it.
   */
  pitchFollow: number;
}

/** Suggested chase-camera parameters for a vehicle state: karts (speed-scaled distance and FOV) and planes. */
export function vehicleCameraFor(s: EntityState): VehicleCameraParams {
  const plane = planeByIndex(s.cls);
  if (plane) return planeCameraFor(s, plane);
  const def = kartByIndex(s.cls) ?? VEHICLES.mower_kart;
  const speed = Math.hypot(s.vx, s.vz);
  const t = clamp(speed / def.boostSpeed, 0, 1);
  const fwd = -Math.sin(s.yaw) * s.vx - Math.cos(s.yaw) * s.vz;
  const boosting = (s.flags & EFlag.Sprinting) !== 0;
  return {
    distance: 4.4 + 1.8 * t,
    height: 1.5,
    fov: 64 + 9 * t + (boosting ? 5 : 0),
    shoulder: 0,
    pitch: -0.2,
    yaw: s.yaw,
    followRate: fwd < -1 ? 0 : 1.5 + 3.5 * t,
    pitchFollow: 0,
  };
}

/**
 * Plane chase camera: a longer boom and a higher pivot than the kart's (the plane sits in the lower third, the
 * crosshair — where the gun converges — stays clear above it), FOV kick with speed and boost. The pivot height
 * is the gun's aimPivotY so the screen-center ray is the ray the sim's gimbal converges on.
 */
function planeCameraFor(s: EntityState, def: PlaneDef): VehicleCameraParams {
  const speed = Math.hypot(s.vx, s.vy, s.vz);
  const t = clamp(speed / def.boostSpeed, 0, 1);
  const grounded = (s.flags & EFlag.Grounded) !== 0;
  const boosting = (s.flags & EFlag.Sprinting) !== 0;
  return {
    distance: 5.8 + 2.6 * t,
    height: def.gun.aimPivotY,
    fov: 66 + 10 * t + (boosting ? 6 : 0),
    shoulder: 0,
    pitch: grounded ? -0.12 : clamp(s.pitch, -0.6, 0.45),
    yaw: s.yaw,
    followRate: grounded ? (speed < 1 ? 0 : 2.5) : 0.9,
    pitchFollow: grounded ? 2 : 0.8,
  };
}

/** The kart a rider sits in (rider has EFlag.Mounted; the kart carries the rider id in `weapon`). */
export function mountedVehicle(rider: EntityState, states: Map<number, EntityState>): EntityState | null {
  if (!(rider.flags & EFlag.Mounted)) return null;
  for (const s of states.values()) if (s.kind === EntityKind.Vehicle && s.weapon === rider.id) return s;
  return null;
}

/** Body yaw for a Mounted rider's avatar: its vehicle's heading (null when not mounted / vehicle unknown). */
export function mountedBodyYaw(rider: EntityState, states: Map<number, EntityState>): number | null {
  return mountedVehicle(rider, states)?.yaw ?? null;
}

/**
 * Pitch and bank for a plane pilot's avatar (it sits on top of the plane and tilts with it; the avatar's feet are
 * on the seat, which the sim already moves with the plane's pitch and roll). Null for kart drivers and on foot.
 */
export function mountedBodyTilt(rider: EntityState, states: Map<number, EntityState>): { pitch: number; roll: number } | null {
  const v = mountedVehicle(rider, states);
  if (!v || !planeByIndex(v.cls)) return null;
  return { pitch: v.pitch, roll: unpackPlaneAux(v.ammo).roll };
}

/** Lerp helper for callers that blend a camera yaw toward vehicleCameraFor().yaw. */
export function followYaw(current: number, target: number, rate: number, dt: number): number {
  return rate > 0 ? lerpAngle(current, target, 1 - Math.exp(-rate * dt)) : current;
}
