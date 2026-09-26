// Mower Kart handling: an arcade vehicle on a Rapier kinematic character controller.
//
// stepKart() is a pure per-vehicle step (kart + static world in, kart out) so client-side prediction
// can replay a local driver's inputs with the exact code the authority runs — the same contract as
// stepCharacter() in src/sim/systems/movement.ts. Character contacts (shove/ram), damage and riders
// are handled by the vehicle systems around it (./systems.ts), never in here.
//
// Model (all numbers in src/shared/content/vehicles.ts):
//  - Longitudinal: throttle/brake/reverse from InputCmd.mz, boost (Sprint, limited meter), coast drag,
//    over-speed pull-back, slope gravity along the heading.
//  - Steering: InputCmd.mx; yaw rate scales with speed (no turning at a standstill), mild understeer
//    flat out, reverses with the direction of travel like a real car; yaw rate eases in (weight).
//  - Grip vs drift: sideways velocity decays at `grip` (part of it carried into forward speed, arcade
//    cornering); Jump = handbrake drops grip to `driftGrip` and tightens the line; a committed drift
//    releases into a short mini-turbo.
//  - Air: gravity × gravityScale, limited air steering, jump pads (pad.vy × jumpPadMult), landing impact.
//  - Collisions: Rapier KCC slides along geometry; wall contacts reflect the normal velocity
//    (restitution) and scrub tangential speed; the hardest impact is reported for damage/FX.
//  - Presentation: body pitch from the surface under the front/back of the kart (nose follows the
//    velocity in the air). Roll is derived client-side from the height function.
import type { KinematicCharacterController, World } from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import type { WorldData } from '../../shared/world/world-data';
import { Btn, type InputCmd } from '../../shared/input';
import { GRAVITY, TICK_DT } from '../../shared/constants';
import { jumpPadAt, surfaceAt, waterAt } from '../../shared/world/queries';
import { VEHICLES, type VehicleDef } from '../../shared/content/vehicles';
import { KART_MOVE_FILTER, type KartState } from './state';

export interface KartInput {
  /** -1 (brake / reverse) … +1 (full throttle). */
  throttle: number;
  /** -1 (left) … +1 (right). */
  steer: number;
  /** Handbrake / drift (Jump). */
  handbrake: boolean;
  /** Boost (Sprint). */
  boost: boolean;
}

export const NO_KART_INPUT: Readonly<KartInput> = Object.freeze({ throttle: 0, steer: 0, handbrake: false, boost: false });

const clamp1 = (v: number) => (v > 1 ? 1 : v < -1 ? -1 : v);
const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
/** Move v toward t by at most step. */
const approach = (v: number, t: number, step: number) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));

/** Driving controls from a character's input: mz throttle/brake, mx steer, Jump handbrake, Sprint boost. */
export function kartInputFrom(cmd: InputCmd, out: KartInput = { throttle: 0, steer: 0, handbrake: false, boost: false }): KartInput {
  out.throttle = clamp1(Number.isFinite(cmd.mz) ? cmd.mz : 0);
  out.steer = clamp1(Number.isFinite(cmd.mx) ? cmd.mx : 0);
  out.handbrake = (cmd.buttons & Btn.Jump) !== 0;
  out.boost = (cmd.buttons & Btn.Sprint) !== 0;
  return out;
}

export interface KartContext {
  world: World;
  /** A controller made by createKartController() (not the characters' controller). */
  kcc: KinematicCharacterController;
  data: WorldData;
  emit?: (ev: GameEvent) => void;
}

export interface KartStepResult {
  /** Normal speed (m/s) of the hardest wall/prop/kart impact this step; 0 = none. */
  wallImpact: number;
  /** Rapier handle of the collider hit hardest (-1 = none) — lets the system spot kart-vs-kart. */
  wallHandle: number;
  /** Unit normal of that impact (pointing from the obstacle toward the kart). */
  wallNx: number;
  wallNz: number;
  /** Downward speed at touchdown if the kart landed this step (0 = no landing). */
  landImpact: number;
  /** Jump pad id if the kart was launched this step. */
  pad: string | null;
  boostStarted: boolean;
  turboStarted: boolean;
}

export function newKartStepResult(): KartStepResult {
  return { wallImpact: 0, wallHandle: -1, wallNx: 0, wallNz: 0, landImpact: 0, pad: null, boostStarted: false, turboStarted: false };
}

/** Fresh kart state (full boost meter, parked). */
export function newKartState(id: KartState['id'], terminal = -1): KartState {
  return {
    id, terminal, rider: -1, yawRate: 0, grounded: false, airTime: 0, groundPitch: 0,
    boost: 1, boostDelay: 0, boosting: false, turbo: 0, drifting: false, driftDir: 0, driftCharge: 0,
    idle: 0, hornCd: 0, ramUntil: {},
  };
}

/** Forward speed along the heading (m/s, + = forward). */
export function kartForwardSpeed(e: SimEntity): number {
  return -Math.sin(e.yaw) * e.vel.x - Math.cos(e.yaw) * e.vel.z;
}

/** Collider center height above the kart's ground point. */
export function kartCenterOffset(def: VehicleDef): number {
  return def.halfHeight;
}

const wrapAngle = (a: number) => {
  const t = Math.PI * 2;
  a = ((a + Math.PI) % t + t) % t - Math.PI;
  return a;
};

/**
 * Advance one kart by dt with the given controls. Mutates e.pos / e.vel / e.yaw / e.pitch / e.kart and
 * moves e.collider. Emits `land` (hard landings) and `jump` (jump pads) through ctx.emit when given.
 */
export function stepKart(ctx: KartContext, e: SimEntity, input: KartInput, dt: number, res: KartStepResult = newKartStepResult()): KartStepResult {
  res.wallImpact = 0; res.wallHandle = -1; res.wallNx = 0; res.wallNz = 0; res.landImpact = 0; res.pad = null;
  res.boostStarted = false; res.turboStarted = false;
  const k = e.kart;
  if (!k || !e.collider || dt <= 0) return res;
  const d = VEHICLES[k.id];
  const vel = e.vel;
  let yaw = e.yaw;
  let sy = Math.sin(yaw), cy = Math.cos(yaw);
  // Heading basis: forward = (-sy, -cy), right = (cy, -sy).
  let vf = -sy * vel.x - cy * vel.z;
  let vl = cy * vel.x - sy * vel.z;
  const throttle = clamp1(input.throttle), steer = clamp1(input.steer);

  // --- boost meter (drains only while actually boosting on the ground) ---
  const wantBoost = input.boost && throttle > 0.1 && k.boost > 0.001 && k.grounded;
  if (wantBoost) {
    if (!k.boosting) res.boostStarted = true;
    k.boosting = true;
    k.boost = Math.max(0, k.boost - dt / d.boostDuration);
    k.boostDelay = d.boostRechargeDelay;
  } else {
    k.boosting = false;
    if (k.boostDelay > 0) k.boostDelay = Math.max(0, k.boostDelay - dt);
    else k.boost = Math.min(1, k.boost + dt / d.boostRecharge);
  }
  if (k.turbo > 0) k.turbo = Math.max(0, k.turbo - dt);
  const fast = k.boosting || k.turbo > 0;
  const top = fast ? d.boostSpeed : d.topSpeed;

  if (k.grounded) {
    // --- drift state: handbrake at speed; the first steer direction commits the drift ---
    if (input.handbrake && vf > d.driftMinSpeed && !k.drifting) {
      k.drifting = true;
      k.driftDir = steer > 0.2 ? -1 : steer < -0.2 ? 1 : 0;
      k.driftCharge = 0;
    }
    if (k.drifting) {
      if (k.driftDir === 0 && Math.abs(steer) > 0.2) k.driftDir = steer > 0 ? -1 : 1;
      if (!input.handbrake || vf < d.driftMinSpeed * 0.6) {
        if (!input.handbrake && k.driftCharge >= d.turboCharge && vf > d.driftMinSpeed * 0.6) { k.turbo = d.turboTime; res.turboStarted = true; }
        k.drifting = false; k.driftDir = 0; k.driftCharge = 0;
      } else if (k.driftDir !== 0) {
        k.driftCharge += dt;
      }
    }

    // --- longitudinal ---
    if (throttle > 0.05) {
      if (vf < -0.3) vf = approach(vf, 0, d.brakeDecel * dt);
      else {
        const target = top * throttle;
        if (vf < target) vf = Math.min(target, vf + (fast ? d.boostAccel : d.accel) * (1 - 0.45 * clamp(vf / top, 0, 1)) * dt);
        else vf = approach(vf, target, (vf > top ? d.overspeedDecel : d.coastDecel) * dt);
      }
    } else if (throttle < -0.05) {
      if (vf > 0.3) vf = approach(vf, 0, d.brakeDecel * Math.max(0.5, -throttle) * dt);
      else {
        const target = d.reverseSpeed * throttle;
        vf = vf > target ? Math.max(target, vf - d.reverseAccel * dt) : approach(vf, target, d.coastDecel * dt);
      }
    } else {
      vf = approach(vf, 0, d.coastDecel * dt);
    }
    if (input.handbrake) vf = approach(vf, 0, d.handbrakeDecel * dt);
    vf += GRAVITY * Math.sin(k.groundPitch) * d.slopeGravity * dt; // uphill slows, downhill speeds up

    // --- steering: authority grows with speed, eases off flat out; reverses when backing up ---
    const spd = Math.abs(vf);
    let auth = clamp(spd / d.steerFullSpeed, 0, 1);
    auth *= 1 - d.understeer * clamp((spd - d.topSpeed * 0.6) / (d.boostSpeed - d.topSpeed * 0.6), 0, 1);
    let turn = -steer; // + = left (yaw increases)
    if (k.drifting && k.driftDir !== 0) turn = k.driftDir * (0.6 + 0.4 * clamp1(turn * k.driftDir)); // into the drift tightens, counter-steer widens
    const target = turn * d.maxYawRate * auth * (vf >= 0 ? 1 : -1) * (k.drifting ? d.driftYawMult : 1);
    k.yawRate = approach(k.yawRate, target, d.yawAccel * dt);
  } else {
    k.yawRate = approach(k.yawRate, -steer * d.maxYawRate * d.airYawControl, d.yawAccel * 0.5 * dt);
  }

  // --- heading update; velocity is re-expressed in the new frame, then grip acts sideways ---
  yaw = wrapAngle(yaw + k.yawRate * dt);
  if (k.grounded) {
    const wx = -sy * vf + cy * vl, wz = -cy * vf - sy * vl;
    sy = Math.sin(yaw); cy = Math.cos(yaw);
    vf = -sy * wx - cy * wz;
    vl = cy * wx - sy * wz;
    const g = k.drifting ? d.driftGrip : d.grip;
    const keep = Math.exp(-g * dt);
    const lost = Math.abs(vl) * (1 - keep);
    vl *= keep;
    if (Math.abs(vf) > 0.5) vf += Math.sign(vf) * lost * (k.drifting ? d.driftTransfer : d.gripTransfer);
    vel.x = -sy * vf + cy * vl;
    vel.z = -cy * vf - sy * vl;
    vel.y = -1; // gentle stick; the controller's ground snap does the rest
  } else {
    sy = Math.sin(yaw); cy = Math.cos(yaw);
    vel.y = Math.max(-40, vel.y + GRAVITY * d.gravityScale * dt);
    const drag = 1 - d.airDrag * dt;
    vel.x *= drag; vel.z *= drag;
  }

  // --- wading water ---
  const w = waterAt(ctx.data, e.pos.x, e.pos.z);
  if (w && e.pos.y < w.surfaceY - 0.1) {
    const kp = Math.pow(d.waterDrag, dt / TICK_DT);
    vel.x *= kp; vel.z *= kp;
    if (vel.y < -6) vel.y = -6;
  }

  // --- collide & slide ---
  const desired = { x: vel.x * dt, y: vel.y * dt, z: vel.z * dt };
  ctx.kcc.computeColliderMovement(e.collider, desired, undefined, KART_MOVE_FILTER);
  const mv = ctx.kcc.computedMovement();
  const wasGrounded = k.grounded;
  const vyBefore = vel.y;
  k.grounded = ctx.kcc.computedGrounded();
  let bounced = false;
  const nCol = ctx.kcc.numComputedCollisions();
  for (let i = 0; i < nCol; i++) {
    const c = ctx.kcc.computedCollision(i);
    if (!c) continue;
    let nx = c.normal1.x, nz = c.normal1.z;
    if (Math.abs(c.normal1.y) > 0.6) continue; // ground / ceiling
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-6) continue;
    nx /= nl; nz /= nl;
    const vn = vel.x * nx + vel.z * nz;
    if (vn >= -0.2) continue; // already moving away
    const impact = -vn;
    if (impact > res.wallImpact) { res.wallImpact = impact; res.wallHandle = c.collider?.handle ?? -1; res.wallNx = nx; res.wallNz = nz; }
    // Reflect the normal part (restitution), scrub the tangential part on hard hits.
    const tx = vel.x - vn * nx, tz = vel.z - vn * nz;
    const scrub = 1 - d.wallScrub * Math.min(1, impact / 10);
    const bn = -vn * d.wallRestitution;
    vel.x = tx * scrub + bn * nx;
    vel.z = tz * scrub + bn * nz;
    bounced = true;
  }
  const t = e.collider.translation();
  const px = t.x + mv.x, py = t.y + mv.y, pz = t.z + mv.z;
  e.collider.setTranslation({ x: px, y: py, z: pz });
  e.pos.x = px; e.pos.y = py - d.halfHeight; e.pos.z = pz;
  if (!bounced) {
    // Blocked without a usable contact (corners, seams): bleed velocity like stepCharacter does.
    if (Math.abs(mv.x) < Math.abs(desired.x) * 0.5) vel.x = mv.x / dt;
    if (Math.abs(mv.z) < Math.abs(desired.z) * 0.5) vel.z = mv.z / dt;
  }
  if (vel.y > 0 && mv.y < desired.y * 0.5) vel.y = 0; // roof bump

  if (k.grounded) {
    if (!wasGrounded && vyBefore < -3) {
      res.landImpact = -vyBefore;
      ctx.emit?.({ e: 'land', id: e.id, impact: res.landImpact });
    }
    vel.y = 0;
    k.airTime = 0;
  } else {
    k.airTime += dt;
    if (k.airTime > 0.25 && k.drifting) { k.drifting = false; k.driftDir = 0; k.driftCharge = 0; }
  }

  // --- jump pads: karts ride trampolines too ---
  if (k.grounded) {
    const pad = jumpPadAt(ctx.data, e.pos.x, e.pos.y, e.pos.z, 0.5);
    if (pad) {
      vel.y = pad.vy * d.jumpPadMult;
      k.grounded = false;
      k.airTime = 0;
      res.pad = pad.id;
      ctx.emit?.({ e: 'jump', id: e.id, double: false });
    }
  }

  // --- presentation pitch (and the slope gravity input for the next step) ---
  const L = d.radius * 0.8;
  const fx = -sy, fz = -cy;
  const maxY = e.pos.y + 0.8;
  const hF = surfaceAt(ctx.data, e.pos.x + fx * L, e.pos.z + fz * L, maxY).y;
  const hB = surfaceAt(ctx.data, e.pos.x - fx * L, e.pos.z - fz * L, maxY).y;
  let targetPitch: number;
  if (k.grounded) {
    k.groundPitch = clamp(Math.atan2(hF - hB, 2 * L), -0.7, 0.7);
    targetPitch = k.groundPitch;
  } else {
    targetPitch = clamp(Math.atan2(vel.y, Math.max(6, Math.hypot(vel.x, vel.z))) * 0.7, -0.45, 0.45);
  }
  e.pitch += (targetPitch - e.pitch) * (1 - Math.exp(-14 * dt));
  e.yaw = yaw;
  return res;
}
