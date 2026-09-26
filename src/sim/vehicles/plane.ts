// RC plane flight model: an arcade toy plane on Rapier shape casts (R1).
//
// stepPlane() is a pure per-plane step (plane + static world in, plane out) like stepKart(): the vehicle
// systems (./systems.ts) wrap it with riders, the gun, damage and destruction. It never reads the Sim.
//
// Controls (a character's InputCmd, see planeInputFrom):
//  - W/S (mz): throttle. W = full power, nothing = engine idle (the plane glides down), S = air brake
//    (on the ground: brake). The engine spools toward the stick (the propeller spins up).
//  - Mouse (InputCmd yaw/pitch = the camera aim): the plane chases the aim ("mouse-aim"): heading error →
//    yaw rate, capped by the turn rate; it banks into turns (coordinated: tan(bank) = v·ω/g).
//  - A/D (mx): rudder — extra yaw rate and extra bank on top of the aim (keyboard/gamepad players).
//  - Sprint: boost (boostTime s at boostSpeed, then a cooldown).
//
// Model (all numbers in src/shared/content/vehicles.ts, PlaneDef):
//  - Airspeed follows the throttle's target (glideSpeed … topSpeed) first-order; climbing costs speed
//    (climbCost·g·sin pitch), diving builds it; tight turns bleed a little (turnDrag).
//  - Lift: full from flySpeed up; below stallSpeed the plane stalls (sink → stallSink, nose drops to
//    stallPitch until it has flying speed again). With the engine idle a fully flying plane still sinks
//    glideSink m/s: it glides (≈ 6:1) instead of holding altitude.
//  - Stall protection (arcade): the highest nose-up pitch shrinks as airspeed falls toward the stall, so a
//    pilot holding the mouse up without power mushes into a glide instead of falling out of the sky.
//  - Flight envelope: a soft + hard ceiling, and a flight box (the yard inside its fences) the plane turns
//    back from by itself; the hard edges clamp without damage (the invisible boundary walls above the
//    fences are never reached).
//  - Collisions: a sphere-like convex hull swept with world.castShape along the whole tick's motion
//    (continuous: no tunnelling at any speed), up to 4 slide iterations, plus a terrain backstop from
//    WorldData.height(). Impacts faster than crashSpeed destroy the plane; softer ones bounce and cost hp;
//    a gentle touchdown on a flat enough surface is a landing.
//  - Ground: step-up / horizontal sweep / snap-down (rolls over lips ≤ stepHeight), rolling friction,
//    brakes, taxi steering toward the aim, lift-off at liftoffSpeed with a short climb-out assist.
import type { Collider, Shape, World } from '@dimforge/rapier3d-compat';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import type { WorldData } from '../../shared/world/world-data';
import type { EntityId } from '../../shared/types';
import { Btn, type InputCmd } from '../../shared/input';
import { GRAVITY } from '../../shared/constants';
import { waterAt } from '../../shared/world/queries';
import { VEHICLES, planePilotMods, type PlaneDef, type PlaneId, type PlanePilotMods } from '../../shared/content/vehicles';
import type { ClassId } from '../../shared/types';

const G = -GRAVITY;
const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
/** Contact skin (m): casts stop this far from surfaces so the next cast never starts inside them. */
const SKIN = 0.02;
const HIST = 32;

export interface PlaneState {
  id: PlaneId;
  /** Terminal that vended this plane (-1 = none). */
  terminal: EntityId;
  /** Seated pilot (-1 = empty). */
  rider: EntityId;
  /** Last pilot and the tick they left (crash credit for bail-outs). */
  lastRider: EntityId;
  lastRiderTick: number;
  /** Engine throttle 0..1 (spooled toward the stick). */
  throttle: number;
  /** Airspeed along the nose (m/s); on the ground the forward rolling speed. */
  speed: number;
  /** Downward speed from missing lift (m/s). */
  sink: number;
  /** Bank angle (rad, + = left wing down). */
  roll: number;
  /** Yaw rate (rad/s, + = turning left). */
  yawRate: number;
  grounded: boolean;
  stalled: boolean;
  airTime: number;
  /** Seconds of take-off climb-out assist left. */
  climbOut: number;
  /** Seconds of boost left / seconds until the next boost. */
  boostTime: number;
  boostCd: number;
  gunHeat: number;
  /** Seconds until the gun may fire again (accumulates the fire interval). */
  gunCd: number;
  overheated: boolean;
  /** Tick of the last shot (-1 never). */
  firedTick: number;
  /** Seconds without a pilot (abandon despawn). */
  idle: number;
  /** Fuselage-center history for lag-compensated hits: tick labels and xyz (ring of HIST). */
  histTick: Int32Array;
  histXYZ: Float32Array;
}

export function newPlaneState(id: PlaneId, terminal: EntityId = -1): PlaneState {
  return {
    id, terminal, rider: -1, lastRider: -1, lastRiderTick: -1, throttle: 0, speed: 0, sink: 0, roll: 0, yawRate: 0,
    grounded: true, stalled: false, airTime: 0, climbOut: 0, boostTime: 0, boostCd: 0,
    gunHeat: 0, gunCd: 0, overheated: false, firedTick: -1, idle: 0,
    histTick: new Int32Array(HIST).fill(-1), histXYZ: new Float32Array(HIST * 3),
  };
}

export interface PlaneInput {
  /** -1 (air brake / brake) … +1 (full throttle); 0 = engine idle (glide). */
  throttle: number;
  /** Rudder -1 (left) … +1 (right). */
  steer: number;
  /** Where the pilot is looking (absolute yaw, 0 = -Z; pitch + = up). The plane chases it. */
  aimYaw: number;
  aimPitch: number;
  boost: boolean;
  pilot: PlanePilotMods;
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const clamp1 = (v: number) => clamp(Number.isFinite(v) ? v : 0, -1, 1);
const approach = (v: number, t: number, step: number) => (v < t ? Math.min(t, v + step) : Math.max(t, v - step));
/** Rate-limited approach with a proportional tail (no overshoot, no buzz at the target). */
const steer = (v: number, t: number, rate: number, dt: number, k = 6) => v + clamp((t - v) * k, -rate, rate) * dt;
const TAU = Math.PI * 2;
const wrapAngle = (a: number) => ((a + Math.PI) % TAU + TAU) % TAU - Math.PI;
const angleDelta = (a: number, b: number) => wrapAngle(b - a);

/** Flight controls from a character's input (see the header). `cls` = the pilot's class (Skyraider bonus). */
export function planeInputFrom(cmd: InputCmd, cls: ClassId | null, def: PlaneDef = VEHICLES.rc_plane, out?: PlaneInput): PlaneInput {
  const o = out ?? { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0, boost: false, pilot: planePilotMods(def, null) };
  o.throttle = clamp1(cmd.mz);
  o.steer = clamp1(cmd.mx);
  o.aimYaw = Number.isFinite(cmd.yaw) ? cmd.yaw : 0;
  o.aimPitch = Number.isFinite(cmd.pitch) ? cmd.pitch : 0;
  o.boost = (cmd.buttons & Btn.Sprint) !== 0;
  o.pilot = planePilotMods(def, cls);
  return o;
}

/** No pilot: engine idle, hold the current heading, wings level: the plane glides down (and lands if it can). */
export function planeHoldInput(e: SimEntity, def: PlaneDef = VEHICLES.rc_plane, out?: PlaneInput): PlaneInput {
  const o = out ?? { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0, boost: false, pilot: planePilotMods(def, null) };
  o.throttle = 0; o.steer = 0; o.aimYaw = e.yaw; o.aimPitch = 0; o.boost = false; o.pilot = planePilotMods(def, null);
  return o;
}

export interface PlaneContext {
  world: World;
  data: WorldData;
  /** The cast shape (a sphere-like convex hull of radius def.radius, see planeCastShape). */
  shape: Shape;
  /** Collision groups of what the plane flies into (world + vehicles). */
  filter: number;
  emit?: (ev: GameEvent) => void;
}

export interface PlaneStepResult {
  /** Speed (m/s) into the surface of the hardest impact this step; 0 = none. */
  impact: number;
  /** Rapier handle of that collider (-1 = none/terrain backstop) and its normal (from the obstacle toward the plane). */
  handle: number;
  nx: number; ny: number; nz: number;
  /** The plane hit something faster than crashSpeed (or ditched in water): destroy it. */
  crash: boolean;
  ditched: boolean;
  /** Touched down this step (and at what speed into the surface). */
  landed: boolean;
  landImpact: number;
  /** Hull damage from bumps and scrapes this step (below crash speed). */
  bumpDamage: number;
  liftoff: boolean;
  boostStarted: boolean;
  stallStarted: boolean;
}

export function newPlaneStepResult(): PlaneStepResult {
  return { impact: 0, handle: -1, nx: 0, ny: 0, nz: 0, crash: false, ditched: false, landed: false, landImpact: 0, bumpDamage: 0, liftoff: false, boostStarted: false, stallStarted: false };
}

function resetResult(r: PlaneStepResult): void {
  r.impact = 0; r.handle = -1; r.nx = 0; r.ny = 0; r.nz = 0; r.crash = false; r.ditched = false; r.landed = false;
  r.landImpact = 0; r.bumpDamage = 0; r.liftoff = false; r.boostStarted = false; r.stallStarted = false;
}

const hulls = new Map<string, Float32Array>();
/**
 * Points of the plane's collision body: an icosphere (42 points) of radius r. A convex hull rather than
 * Rapier's ball: shape casts stay exact against very large boxes, where GJK on curved shapes let bodies
 * sink (V1, LEARNINGS.jsonl). Nearly rotation-invariant, so it is always cast unrotated.
 */
export function planeHullPoints(r: number): Float32Array {
  const key = r.toFixed(4);
  let pts = hulls.get(key);
  if (pts) return pts;
  const t = (1 + Math.sqrt(5)) / 2;
  const base: [number, number, number][] = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ];
  const faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  const verts = base.map(([x, y, z]) => { const l = Math.hypot(x, y, z); return [x / l, y / l, z / l] as [number, number, number]; });
  const mid = new Map<string, number>();
  const midpoint = (a: number, b: number) => {
    const k = a < b ? `${a}:${b}` : `${b}:${a}`;
    let i = mid.get(k);
    if (i === undefined) {
      const [ax, ay, az] = verts[a], [bx, by, bz] = verts[b];
      const x = ax + bx, y = ay + by, z = az + bz, l = Math.hypot(x, y, z);
      i = verts.length; verts.push([x / l, y / l, z / l]); mid.set(k, i);
    }
    return i;
  };
  for (const [a, b, c] of faces) { midpoint(a, b); midpoint(b, c); midpoint(c, a); }
  // Scale so the flat faces (not only the vertices) sit near r: the inscribed radius of a subdivided icosahedron is ~0.98.
  const s = r / 0.985;
  pts = new Float32Array(verts.flatMap(([x, y, z]) => [x * s, y * s, z * s]));
  hulls.set(key, pts);
  return pts;
}

/** The flight box: the yard inside its fences (bounds ∩ ±halfExtent), shrunk by the plane's margin. */
export function planeFlightBox(data: WorldData, def: PlaneDef): { minX: number; maxX: number; minZ: number; maxZ: number } {
  const b = data.bounds;
  const h = data.halfExtent;
  const m = def.boundsMargin;
  return {
    minX: Math.max(b ? b.minX : -h, -h) + m, maxX: Math.min(b ? b.maxX : h, h) - m,
    minZ: Math.max(b ? b.minZ : -h, -h) + m, maxZ: Math.min(b ? b.maxZ : h, h) - m,
  };
}

/** World position of the fuselage center for a plane entity (its collider center). */
export function planeCenter(e: SimEntity, def: PlaneDef = VEHICLES.rc_plane): { x: number; y: number; z: number } {
  return { x: e.pos.x, y: e.pos.y + def.gearHeight, z: e.pos.z };
}

/** Record the fuselage center under a snapshot tick label (lag compensation for shots at planes). */
export function recordPlaneHistory(p: PlaneState, tick: number, x: number, y: number, z: number): void {
  const i = ((tick % HIST) + HIST) % HIST;
  p.histTick[i] = tick;
  p.histXYZ[i * 3] = x; p.histXYZ[i * 3 + 1] = y; p.histXYZ[i * 3 + 2] = z;
}

/** Fuselage center at a past snapshot tick, or null when it is not in the history. */
export function planeCenterAt(p: PlaneState, tick: number, out: { x: number; y: number; z: number }): { x: number; y: number; z: number } | null {
  const i = ((tick % HIST) + HIST) % HIST;
  if (p.histTick[i] !== tick) return null;
  out.x = p.histXYZ[i * 3]; out.y = p.histXYZ[i * 3 + 1]; out.z = p.histXYZ[i * 3 + 2];
  return out;
}

// ---------------------------------------------------------------------------------------------
// Step
// ---------------------------------------------------------------------------------------------

const cpos = { x: 0, y: 0, z: 0 };
const cvel = { x: 0, y: 0, z: 0 };

function cast(ctx: PlaneContext, self: Collider | null, x: number, y: number, z: number, vx: number, vy: number, vz: number, maxToi: number) {
  cpos.x = x; cpos.y = y; cpos.z = z; cvel.x = vx; cvel.y = vy; cvel.z = vz;
  return ctx.world.castShape(cpos, IDENTITY, cvel, ctx.shape, SKIN, maxToi, false, undefined, ctx.filter, self ?? undefined);
}

/**
 * Advance one plane by dt. Mutates e.pos / e.vel / e.yaw / e.pitch / e.plane and moves e.collider. The caller
 * destroys the plane on `res.crash` and applies `res.bumpDamage`. Emits `land` (touchdowns) through ctx.emit.
 */
export function stepPlane(ctx: PlaneContext, e: SimEntity, input: PlaneInput, dt: number, res: PlaneStepResult = newPlaneStepResult()): PlaneStepResult {
  resetResult(res);
  const p = e.plane;
  if (!p || !e.collider || dt <= 0) return res;
  const d = VEHICLES[p.id];
  const mods = input.pilot;
  const throttleCmd = clamp1(input.throttle);

  // --- engine spool + boost ---
  p.throttle = approach(p.throttle, Math.max(0, throttleCmd), d.throttleRate * dt);
  if (p.boostTime > 0) p.boostTime = Math.max(0, p.boostTime - dt);
  if (p.boostCd > 0) p.boostCd = Math.max(0, p.boostCd - dt);
  if (input.boost && p.boostCd <= 0 && p.boostTime <= 0) {
    p.boostTime = d.boostTime;
    p.boostCd = d.boostTime + d.boostCooldown * mods.boostCooldown;
    res.boostStarted = true;
  }

  if (p.grounded) groundStep(ctx, e, p, d, input, throttleCmd, dt, res);
  else airStep(ctx, e, p, d, input, throttleCmd, dt, res);
  return res;
}

function airStep(ctx: PlaneContext, e: SimEntity, p: PlaneState, d: PlaneDef, input: PlaneInput, throttleCmd: number, dt: number, res: PlaneStepResult): void {
  const mods = input.pilot;
  const top = d.topSpeed * mods.speed, boostSpeed = d.boostSpeed * mods.speed;
  const turnRate = d.turnRate * mods.handling;
  p.airTime += dt;

  // --- airspeed ---
  let target: number, rate: number;
  if (p.boostTime > 0) { target = boostSpeed; rate = d.boostRate; }
  else if (throttleCmd < -0.1) { target = d.brakeSpeed; rate = d.brakeRate; }
  else { target = d.glideSpeed + (top - d.glideSpeed) * p.throttle; rate = p.speed < target ? d.accelRate : d.decelRate; }
  p.speed += (target - p.speed) * (1 - Math.exp(-rate * dt));
  p.speed -= G * d.climbCost * Math.sin(e.pitch) * dt;
  p.speed -= d.turnDrag * Math.abs(p.yawRate) * p.speed * dt;
  p.speed = clamp(p.speed, d.minAirSpeed, d.maxSpeed);

  // --- lift & stall ---
  const lift = clamp((p.speed - d.stallSpeed) / (d.flySpeed - d.stallSpeed), 0, 1);
  if (!p.stalled && p.speed < d.stallSpeed) { p.stalled = true; res.stallStarted = true; }
  else if (p.stalled && p.speed > d.flySpeed) p.stalled = false;
  const powered = p.boostTime > 0 ? 1 : clamp(p.throttle / 0.6, 0, 1);
  const sinkTarget = d.stallSink * (1 - lift) + d.glideSink * lift * (1 - powered);
  p.sink = approach(p.sink, sinkTarget, d.sinkRate * dt);

  // --- aim, envelope ---
  const c = e.collider!.translation();
  let aimYaw = input.aimYaw;
  let aimPitch = clamp(Number.isFinite(input.aimPitch) ? input.aimPitch : 0, d.minPitch, d.maxPitch);
  // Flight box: within boundsTurn of an edge and heading out, the aim swings toward the middle of the yard.
  const box = planeFlightBox(ctx.data, d);
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  let push = 0;
  if (fx < 0) push = Math.max(push, (box.minX + d.boundsTurn - c.x) / d.boundsTurn * -fx);
  if (fx > 0) push = Math.max(push, (c.x - (box.maxX - d.boundsTurn)) / d.boundsTurn * fx);
  if (fz < 0) push = Math.max(push, (box.minZ + d.boundsTurn - c.z) / d.boundsTurn * -fz);
  if (fz > 0) push = Math.max(push, (c.z - (box.maxZ - d.boundsTurn)) / d.boundsTurn * fz);
  if (push > 0) {
    const home = Math.atan2(c.x - (box.minX + box.maxX) / 2, c.z - (box.minZ + box.maxZ) / 2); // yaw that faces the middle
    aimYaw = e.yaw + angleDelta(e.yaw, aimYaw) * (1 - clamp(push, 0, 1)) + angleDelta(e.yaw, home) * clamp(push, 0, 1);
  }
  // Stall protection: nose-up authority shrinks toward the stall; the ceiling pushes the nose down.
  const auth = clamp((p.speed - d.stallSpeed) / (d.glideSpeed - d.stallSpeed), 0, 1);
  let cap = d.stallPitch + (d.maxPitch - d.stallPitch) * auth;
  const soft = d.ceiling - d.ceilingSoft;
  if (c.y > soft) cap = Math.min(cap, d.maxPitch + (-0.15 - d.maxPitch) * clamp((c.y - soft) / d.ceilingSoft, 0, 1));
  if (p.climbOut > 0) { aimPitch = Math.max(aimPitch, d.takeoffPitch); p.climbOut = Math.max(0, p.climbOut - dt); }
  let pitchTarget = Math.min(aimPitch, cap);
  if (p.stalled) pitchTarget = Math.min(pitchTarget, d.stallPitch);
  e.pitch = steer(e.pitch, pitchTarget, d.pitchRate * mods.handling, dt);

  // --- heading & bank ---
  const err = angleDelta(e.yaw, aimYaw); // + = the aim is to the left
  const want = clamp(clamp(err * d.aimGain, -turnRate, turnRate) - input.steer * d.rudderYaw * mods.handling, -turnRate * 1.25, turnRate * 1.25);
  p.yawRate = approach(p.yawRate, want, d.yawAccel * mods.handling * dt);
  e.yaw = wrapAngle(e.yaw + p.yawRate * dt);
  const rollTarget = clamp(Math.atan2(p.speed * p.yawRate, G) - input.steer * d.rudderRoll, -d.maxBank, d.maxBank);
  p.roll = steer(p.roll, rollTarget, d.rollRate * mods.handling, dt);

  // --- velocity along the nose, minus the sink ---
  const cp = Math.cos(e.pitch);
  e.vel.x = -Math.sin(e.yaw) * cp * p.speed;
  e.vel.z = -Math.cos(e.yaw) * cp * p.speed;
  e.vel.y = Math.sin(e.pitch) * p.speed - p.sink;

  moveAir(ctx, e, p, d, c.x, c.y, c.z, dt, res);
}

/** Resolve one contact during the air sweep. Returns true when the sweep should stop (crash or touchdown). */
function airContact(e: SimEntity, p: PlaneState, d: PlaneDef, nx: number, ny: number, nz: number, handle: number, res: PlaneStepResult): boolean {
  const v = e.vel;
  const vn = -(v.x * nx + v.y * ny + v.z * nz);
  if (vn <= 0) return false;
  if (vn > res.impact) { res.impact = vn; res.handle = handle; res.nx = nx; res.ny = ny; res.nz = nz; }
  if (vn > d.crashSpeed) { res.crash = true; return true; }
  const groundish = ny >= Math.cos(d.maxGroundSlope);
  if (groundish && vn <= d.landMaxSink && Math.abs(p.roll) <= d.landMaxRoll && e.pitch >= d.landMinPitch) {
    // Touchdown: keep the along-surface velocity, wheels on the ground.
    v.x += vn * nx; v.y += vn * ny; v.z += vn * nz;
    p.grounded = true; p.stalled = false; p.sink = 0; p.airTime = 0; p.climbOut = 0;
    p.speed = Math.max(0, -Math.sin(e.yaw) * v.x - Math.cos(e.yaw) * v.z);
    res.landed = true; res.landImpact = vn;
    return true;
  }
  // Bump / scrape: bounce the normal part, take hull damage above bumpSpeed, fly on along the new direction.
  if (vn > d.bumpSpeed) res.bumpDamage += (vn - d.bumpSpeed) * d.bumpDamagePerMs;
  const k = (1 + d.restitution) * vn;
  v.x += k * nx; v.y += k * ny; v.z += k * nz;
  const h = Math.hypot(v.x, v.z);
  if (h > 1) e.yaw = Math.atan2(-v.x, -v.z);
  e.pitch = clamp(Math.atan2(v.y, Math.max(h, 1e-3)), d.minPitch, d.maxPitch);
  p.speed = clamp(Math.hypot(h, v.y), d.minAirSpeed, d.maxSpeed);
  p.sink = 0;
  p.yawRate *= 0.5;
  return false;
}

function moveAir(ctx: PlaneContext, e: SimEntity, p: PlaneState, d: PlaneDef, x: number, y: number, z: number, dt: number, res: PlaneStepResult): void {
  let remaining = dt;
  for (let it = 0; it < 4 && remaining > 1e-6; it++) {
    const v = e.vel;
    const hit = cast(ctx, e.collider, x, y, z, v.x, v.y, v.z, remaining);
    if (!hit) { x += v.x * remaining; y += v.y * remaining; z += v.z * remaining; remaining = 0; break; }
    const toi = Math.max(0, Math.min(remaining, hit.time_of_impact));
    x += v.x * toi; y += v.y * toi; z += v.z * toi;
    remaining -= toi;
    let nx = hit.normal1.x, ny = hit.normal1.y, nz = hit.normal1.z;
    const nl = Math.hypot(nx, ny, nz);
    if (nl < 1e-6) break;
    nx /= nl; ny /= nl; nz /= nl;
    const vn = -(e.vel.x * nx + e.vel.y * ny + e.vel.z * nz);
    if (vn <= 0.01) { x += nx * 0.01; y += ny * 0.01; z += nz * 0.01; continue; } // grazing: step off the skin
    if (airContact(e, p, d, nx, ny, nz, hit.collider?.handle ?? -1, res)) break;
  }
  finishMove(ctx, e, p, d, x, y, z, res);
}

/** Terrain backstop, water, ceiling and flight box; then write the pose. */
function finishMove(ctx: PlaneContext, e: SimEntity, p: PlaneState, d: PlaneDef, x: number, y: number, z: number, res: PlaneStepResult): void {
  if (!p.grounded && !res.crash) {
    // Terrain backstop (the trimesh sweep is exact; this catches any numerical slip below the lawn).
    const floor = ctx.data.height(x, z) + d.radius * 0.97;
    if (y < floor) {
      y = floor;
      airContact(e, p, d, 0, 1, 0, -1, res);
      if (res.landed) e.vel.y = 0;
    }
  }
  const w = waterAt(ctx.data, x, z);
  if (w && y - d.radius * 0.5 < w.surfaceY && !res.crash) { res.crash = true; res.ditched = true; }
  if (y > d.ceiling) { y = d.ceiling; if (e.vel.y > 0) e.vel.y = 0; if (e.pitch > 0) e.pitch = 0; }
  const box = planeFlightBox(ctx.data, d);
  let clamped = false;
  if (x < box.minX) { x = box.minX; if (e.vel.x < 0) e.vel.x = 0; clamped = true; }
  if (x > box.maxX) { x = box.maxX; if (e.vel.x > 0) e.vel.x = 0; clamped = true; }
  if (z < box.minZ) { z = box.minZ; if (e.vel.z < 0) e.vel.z = 0; clamped = true; }
  if (z > box.maxZ) { z = box.maxZ; if (e.vel.z > 0) e.vel.z = 0; clamped = true; }
  if (clamped && Math.hypot(e.vel.x, e.vel.z) > 1) e.yaw = Math.atan2(-e.vel.x, -e.vel.z);
  e.collider!.setTranslation({ x, y, z });
  e.pos.x = x; e.pos.y = y - d.gearHeight; e.pos.z = z;
  if (res.landed) ctx.emit?.({ e: 'land', id: e.id, impact: res.landImpact });
}

function groundStep(ctx: PlaneContext, e: SimEntity, p: PlaneState, d: PlaneDef, input: PlaneInput, throttleCmd: number, dt: number, res: PlaneStepResult): void {
  const mods = input.pilot;
  const top = d.topSpeed * mods.speed;
  p.airTime = 0; p.sink = 0; p.stalled = false;
  // --- rolling speed ---
  let v = p.speed;
  const boost = p.boostTime > 0 ? d.groundAccel : 0;
  if (p.throttle > 0.02 || boost > 0) v = Math.min(p.boostTime > 0 ? d.boostSpeed * mods.speed : top, v + (d.groundAccel * p.throttle + boost) * dt);
  else v = approach(v, 0, d.rollFriction * dt);
  if (throttleCmd < -0.1) v = approach(v, 0, d.groundBrake * dt);
  v = Math.max(0, v);
  // --- taxi steering: toward the aim once rolling (a parked plane doesn't spin when the pilot looks around) ---
  let want = 0;
  if (v > 0.6 || p.throttle > 0.2) {
    const err = angleDelta(e.yaw, input.aimYaw);
    want = clamp(err * 3, -d.taxiTurnRate, d.taxiTurnRate) * clamp(v / 3, 0.35, 1);
  }
  want -= input.steer * d.taxiTurnRate * clamp(v / 3, 0.35, 1);
  p.yawRate = approach(p.yawRate, clamp(want, -d.taxiTurnRate, d.taxiTurnRate), d.yawAccel * 2 * dt);
  e.yaw = wrapAngle(e.yaw + p.yawRate * dt);
  p.roll = steer(p.roll, 0, d.rollRate, dt);
  p.speed = v;

  // --- lift-off: at liftoffSpeed under power unless the pilot aims down; always at autoLiftoff. A plane that
  // just landed with the engine idle stays down (no bouncing back into the air after a touchdown).
  const aimPitch = Number.isFinite(input.aimPitch) ? input.aimPitch : 0;
  if ((v >= d.liftoffSpeed && aimPitch > -0.25 && (p.throttle > 0.5 || p.boostTime > 0)) || v >= d.autoLiftoff) {
    p.grounded = false;
    p.climbOut = d.takeoffAssist;
    e.pitch = Math.max(e.pitch, 0.08);
    res.liftoff = true;
    airStep(ctx, e, p, d, input, throttleCmd, dt, res);
    return;
  }

  // --- roll along the ground: step up, sweep, snap down ---
  const fx = -Math.sin(e.yaw), fz = -Math.cos(e.yaw);
  e.vel.x = fx * v; e.vel.y = 0; e.vel.z = fz * v;
  const c = e.collider!.translation();
  let x = c.x, y = c.y, z = c.z;
  const up = cast(ctx, e.collider, x, y, z, 0, 1, 0, d.stepHeight);
  const lift = up ? Math.max(0, up.time_of_impact) : d.stepHeight;
  y += lift;
  let remaining = dt;
  for (let it = 0; it < 3 && remaining > 1e-6 && (e.vel.x || e.vel.z); it++) {
    const hit = cast(ctx, e.collider, x, y, z, e.vel.x, 0, e.vel.z, remaining);
    if (!hit) { x += e.vel.x * remaining; z += e.vel.z * remaining; break; }
    const toi = Math.max(0, Math.min(remaining, hit.time_of_impact));
    x += e.vel.x * toi; z += e.vel.z * toi;
    remaining -= toi;
    let nx = hit.normal1.x, nz = hit.normal1.z;
    const nl = Math.hypot(nx, nz);
    if (nl < 1e-6) break;
    nx /= nl; nz /= nl;
    const vn = -(e.vel.x * nx + e.vel.z * nz);
    if (vn <= 0) continue;
    if (vn > res.impact) { res.impact = vn; res.handle = hit.collider?.handle ?? -1; res.nx = nx; res.ny = 0; res.nz = nz; }
    if (vn > d.crashSpeed) { res.crash = true; break; }
    if (vn > d.bumpSpeed) res.bumpDamage += (vn - d.bumpSpeed) * d.bumpDamagePerMs;
    e.vel.x += vn * nx; e.vel.z += vn * nz; // slide along the obstacle
    p.speed = Math.max(0, fx * e.vel.x + fz * e.vel.z);
  }
  // Snap back down onto the ground (or roll off an edge into the air).
  const down = cast(ctx, e.collider, x, y, z, 0, -1, 0, lift + d.groundSnap);
  let onGround = false;
  if (down) {
    y -= Math.max(0, down.time_of_impact);
    const n = down.normal1, nl = Math.hypot(n.x, n.y, n.z) || 1, ny = n.y / nl;
    if (ny >= Math.cos(d.maxGroundSlope)) {
      onGround = true;
      // Nose follows the slope along the heading (plus a small taildragger nose-up).
      const slope = -((n.x / nl) * fx + (n.z / nl) * fz) / Math.max(0.2, ny);
      e.pitch = steer(e.pitch, Math.atan(slope) + 0.05, 3, dt);
    }
  } else y -= lift;
  const floor = ctx.data.height(x, z) + d.radius * 0.97;
  if (y < floor) { y = floor; onGround = true; }
  if (!onGround) {
    // Rolled off a roof edge (or onto something too steep): the air model takes over; a slow plane stalls,
    // noses down and recovers.
    p.grounded = false;
    p.climbOut = 0;
  }
  finishMove(ctx, e, p, d, x, y, z, res);
}
