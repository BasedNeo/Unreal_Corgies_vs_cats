// RC plane systems (R1): spawning, seats, bail-outs, the plane step (order 191), the plane gun, damage from
// shots and blasts, crashes and destruction. Authoritative and deterministic; the flight model itself is the
// pure stepPlane() in ./plane.ts. Wired into the V1 vehicle systems (./systems.ts): Interact mounts the
// nearest empty kart OR plane; the Rooftop Hangar vends planes; vehicle-damage (560) resolves shots/blasts.
//
// Pilots: the rider sits on top (EFlag.Mounted, Anim.Drive), moved with the plane every tick. Their combat
// buttons are masked like a kart driver's; Fire (read raw from the seat) fires the plane's squeaky gun.
// E on the ground steps out beside the plane; E in the air bails out (keeps some of the plane's speed —
// a Skyraider can Ear Glide down). An empty plane glides on and lands or crashes; its crash is credited to
// its last pilot (within 10 s) unless someone shot it.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, type EntityId, type TeamId } from '../../shared/types';
import { Btn } from '../../shared/input';
import type { GameEvent } from '../../shared/protocol';
import { hash2 } from '../../shared/rng';
import { COMBAT_RULES, weaponByIndex, weaponIndex } from '../../shared/content/weapons';
import { TERMINALS, VEHICLES, packPlaneAux, vehicleIndex, type PlaneDef, type PlaneId } from '../../shared/content/vehicles';
import { applyDamage, explode, combatLive, capsuleOf, rayCapsule, knockback } from '../combat';
import { falloff } from '../combat/weapon-system';
import { TargetSet, rewindTick, currentStateTick } from '../combat/lagcomp';
import { reportNoiseAt } from '../combat/state';
import { groups, Layer } from '../rapier';
import { PLANE_GROUPS, PLANE_MOVE_FILTER, planeDef, planeShape, vehicleRuntime, vehicleTeam, type PendingBlast } from './state';
import {
  newPlaneState, newPlaneStepResult, planeHoldInput, planeInputFrom, planeHullPoints, planeCenterAt, recordPlaneHistory, stepPlane,
  type PlaneContext, type PlaneInput,
} from './plane';
import { blankEntity, tagCollider, capsuleClear, staticBlocked, unseat, seatCharacterAt, stunCharacter, ticks, blastDef, blastDamageOf } from './common';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
/** A rider further than this from the seat was moved by someone else (respawn, restart): unseat. */
const TELEPORT_TOLERANCE = 1.5;
/** Clearance for a plane body being vended: world, vehicles and characters standing on the pad. */
const PLANE_CLEAR_FILTER = groups(Layer.Vehicle, Layer.World | Layer.Vehicle | Layer.Character);
/** Rays for the plane gun: static world + vehicles (characters are tested analytically, lag-compensated). */
const GUN_RAY_FILTER = groups(Layer.Projectile, Layer.World | Layer.Vehicle);
/** Crash credit: the last attacker / last pilot within the last 10 s. */
const CREDIT_TICKS = ticks(10);
/** Flags Firing this long after a shot (muzzle flash on the plane view). */
const FIRING_TICKS = ticks(0.15);

// ---------------------------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------------------------

/**
 * A point in plane space (x right, y up from the ground point, z toward the back) in world space for the
 * plane's current pose (yaw · pitch · roll, rotated about the pivot at pivotY — the view does the same).
 */
export function planeLocalToWorld(plane: SimEntity, lx: number, ly: number, lz: number, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const d = planeDef(plane);
  const roll = plane.plane!.roll;
  let x = lx, y = ly - d.pivotY, z = lz;
  const cr = Math.cos(roll), sr = Math.sin(roll);
  const x1 = x * cr - y * sr, y1 = x * sr + y * cr;
  x = x1; y = y1;
  const cp = Math.cos(plane.pitch), sp = Math.sin(plane.pitch);
  const y2 = y * cp - z * sp, z2 = y * sp + z * cp;
  y = y2; z = z2;
  const cy = Math.cos(plane.yaw), sy = Math.sin(plane.yaw);
  out.x = plane.pos.x + x * cy + z * sy;
  out.y = plane.pos.y + d.pivotY + y;
  out.z = plane.pos.z - x * sy + z * cy;
  return out;
}

/** World position of a plane's seat (rider feet) for its current pose. */
export function planeSeatPosition(plane: SimEntity, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  const s = planeDef(plane).seat;
  return planeLocalToWorld(plane, s.x, s.y, s.z, out);
}

/** Fuselage center (the collider center). */
export function planeCenterOf(plane: SimEntity, out = { x: 0, y: 0, z: 0 }): { x: number; y: number; z: number } {
  out.x = plane.pos.x; out.y = plane.pos.y + planeDef(plane).gearHeight; out.z = plane.pos.z;
  return out;
}

/** Ray (unit dir) vs sphere: entry distance ≥ 0, or -1 (0 when the origin is inside). */
function raySphere(ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, cx: number, cy: number, cz: number, r: number): number {
  const ax = ox - cx, ay = oy - cy, az = oz - cz;
  const c = ax * ax + ay * ay + az * az - r * r;
  if (c <= 0) return 0;
  const b = ax * dx + ay * dy + az * dz;
  const h = b * b - c;
  if (h < 0 || b > 0) return -1;
  return -b - Math.sqrt(h);
}

// ---------------------------------------------------------------------------------------------
// Spawning & seats
// ---------------------------------------------------------------------------------------------

function planeBodyClear(sim: Sim, def: PlaneDef, x: number, y: number, z: number): boolean {
  const shape = planeShape(sim, def);
  return sim.world.intersectionWithShape({ x, y: y + def.gearHeight + 0.04, z }, IDENTITY, shape, undefined, PLANE_CLEAR_FILTER) === null;
}

/**
 * Spawn a plane with its landing gear on the ground point (x, y, z), nose along `yaw`. Tries the spot, then a
 * little further along the heading (someone may be standing on the pad). Null when nothing is clear.
 */
export function spawnPlane(sim: Sim, id: PlaneId, team: TeamId, x: number, y: number, z: number, yaw: number, terminal: EntityId = -1): SimEntity | null {
  const d = VEHICLES[id];
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  let px = x, pz = z, ok = false;
  for (const k of [0, 1.6, 3.2]) {
    px = x + fx * k; pz = z + fz * k;
    if (planeBodyClear(sim, d, px, y, pz)) { ok = true; break; }
  }
  if (!ok) return null;
  const e = blankEntity(sim, EntityKind.Vehicle, team, d.name);
  // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the VEHICLE_IDS index (1).
  e.cls = CLASS_IDS[vehicleIndex(id)] ?? null;
  e.pos.x = px; e.pos.y = y; e.pos.z = pz; e.yaw = yaw; e.pitch = 0.05;
  e.health = { hp: d.maxHp, max: d.maxHp, lastDamageTick: -9999, lastAttacker: -1 };
  e.plane = newPlaneState(id, terminal);
  e.flags = EFlag.Grounded;
  e.ammo = packPlaneAux(0, 0);
  e.collider = sim.world.createCollider(
    sim.R.ColliderDesc.convexHull(planeHullPoints(d.radius))!
      .setTranslation(px, y + d.gearHeight + 0.02, pz).setCollisionGroups(PLANE_GROUPS),
  );
  tagCollider(sim, e);
  sim.entities.set(e.id, e);
  const c = planeCenterOf(e);
  recordPlaneHistory(e.plane, currentStateTick(sim), c.x, c.y, c.z);
  return e;
}

const seatTmp = { x: 0, y: 0, z: 0 };
function seatPilot(sim: Sim, plane: SimEntity, rider: SimEntity): void {
  const p = planeSeatPosition(plane, seatTmp);
  seatCharacterAt(sim, rider, p.x, p.y, p.z, plane.vel, plane.plane!.grounded);
}

export function mountPlane(sim: Sim, plane: SimEntity, rider: SimEntity): boolean {
  const p = plane.plane;
  if (!p || p.rider >= 0 || !rider.char || rider.dead || rider.seat || !plane.health || plane.health.hp <= 0) return false;
  p.rider = rider.id;
  p.idle = 0;
  rider.seat = { vehicle: plane.id, raw: rider.input.buttons, prevRaw: rider.input.buttons };
  plane.flags |= EFlag.Busy;
  seatPilot(sim, plane, rider);
  sim.emit({ e: 'ability', id: plane.id, ability: 'mount', x: rider.pos.x, y: rider.pos.y, z: rider.pos.z });
  return true;
}

/** Nearest empty, parked (slow) plane within mount range of a character. */
export function nearestPlane(sim: Sim, c: SimEntity): SimEntity | null {
  let best: SimEntity | null = null, bd = Infinity;
  for (const e of sim.entities.values()) {
    if (!e.plane || e.removed || e.plane.rider >= 0 || !e.health || e.health.hp <= 0) continue;
    const d = VEHICLES[e.plane.id];
    if (Math.hypot(e.vel.x, e.vel.y, e.vel.z) > d.mountMaxSpeed || Math.abs(c.pos.y - e.pos.y) > 1.6) continue;
    const dist = Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z);
    if (dist <= d.mountRange && dist < bd) { bd = dist; best = e; }
  }
  return best;
}

const exitTmp = { x: 0, y: 0, z: 0 };
const EXIT_ANGLES = [Math.PI / 2, -Math.PI / 2, Math.PI, (3 * Math.PI) / 4, (-3 * Math.PI) / 4, Math.PI / 4, -Math.PI / 4, 0];

/**
 * Where a pilot leaves the plane. On the ground: beside the plane (left wing first), on solid ground, clear of
 * geometry, no wall between seat and spot. In the air (bail-out / ejection): above or behind the seat, clear.
 */
export function planeExitSpot(sim: Sim, plane: SimEntity, rider: SimEntity, air: boolean): { x: number; y: number; z: number } | null {
  const d = planeDef(plane);
  const seat = planeSeatPosition(plane, { x: 0, y: 0, z: 0 });
  const cx = plane.pos.x, cy = plane.pos.y + d.gearHeight, cz = plane.pos.z;
  const b = sim.worldData.bounds;
  const inBounds = (x: number, z: number) => !b || (x > b.minX + 1 && x < b.maxX - 1 && z > b.minZ + 1 && z < b.maxZ - 1);
  if (!air) {
    const m = rider.char!.move;
    const base = d.wingspan / 2 + m.capsuleRadius + 0.2;
    for (const ring of [0, 0.8, 1.6]) {
      for (const a of EXIT_ANGLES) {
        const h = plane.yaw + a;
        const x = plane.pos.x - Math.sin(h) * (base + ring), z = plane.pos.z - Math.cos(h) * (base + ring);
        if (!inBounds(x, z)) continue;
        for (const lift of [0.04, 0.25]) {
          const y = plane.pos.y + lift;
          if (!capsuleClear(sim, rider, x, y, z)) continue;
          if (staticBlocked(sim, cx, cy + 0.6, cz, x, y + 0.9, z)) break;
          exitTmp.x = x; exitTmp.y = y; exitTmp.z = z;
          return exitTmp;
        }
      }
    }
  }
  // Air (or no ground spot): straight up off the seat, a bit higher, then behind / beside the plane.
  const bx = Math.sin(plane.yaw), bz = Math.cos(plane.yaw); // backward
  const rx = Math.cos(plane.yaw), rz = -Math.sin(plane.yaw);
  const cands: [number, number, number][] = [
    [seat.x, seat.y + 0.5, seat.z], [seat.x, seat.y + 0.9, seat.z], [seat.x + bx * 1.3, seat.y + 0.3, seat.z + bz * 1.3],
    [seat.x + rx * 1.4, seat.y, seat.z + rz * 1.4], [seat.x - rx * 1.4, seat.y, seat.z - rz * 1.4], [seat.x, seat.y + 1.6, seat.z],
  ];
  for (const [x, y, z] of cands) {
    if (!inBounds(x, z)) continue;
    if (y < sim.worldData.height(x, z) - 0.01) continue;
    if (!capsuleClear(sim, rider, x, y, z)) continue;
    if (staticBlocked(sim, cx, cy, cz, x, y + 0.5, z)) continue;
    exitTmp.x = x; exitTmp.y = y; exitTmp.z = z;
    return exitTmp;
  }
  return null;
}

/** Voluntary exit (Interact while seated). Parked or rolling slowly: step out beside it; else bail out. */
export function dismountPlane(sim: Sim, plane: SimEntity, rider: SimEntity): boolean {
  const p = plane.plane!, d = planeDef(plane);
  const air = !p.grounded || p.speed > 5;
  const spot = planeExitSpot(sim, plane, rider, air);
  if (!spot) return false;
  const vx = plane.vel.x, vy = plane.vel.y, vz = plane.vel.z;
  unseat(plane, rider, sim.tick);
  sim.placeCharacter(rider, spot.x, spot.y, spot.z);
  if (air) {
    rider.vel.x = vx * d.bailCarry; rider.vel.z = vz * d.bailCarry;
    rider.vel.y = Math.max(0, vy * d.bailCarry) + d.bailUp;
    if (rider.char) rider.char.grounded = false;
    rider.anim = Anim.Jump;
  } else { rider.vel.x = vx * 0.5; rider.vel.z = vz * 0.5; }
  sim.emit({ e: 'ability', id: plane.id, ability: air ? 'bail' : 'dismount', x: spot.x, y: spot.y, z: spot.z });
  return true;
}

/** Forced exit (crash / shot down / pilot killed): best clear spot, launched up and back; alive pilots are stunned. */
function ejectPilot(sim: Sim, plane: SimEntity, rider: SimEntity, launch: boolean): void {
  const d = planeDef(plane);
  const spot = planeExitSpot(sim, plane, rider, true);
  const x = spot?.x ?? rider.pos.x, y = spot?.y ?? rider.pos.y, z = spot?.z ?? rider.pos.z;
  unseat(plane, rider, sim.tick);
  sim.placeCharacter(rider, x, y, z);
  const bx = Math.sin(plane.yaw), bz = Math.cos(plane.yaw);
  const vx = plane.vel.x * 0.25 + bx * (launch ? 3 : 1.5), vz = plane.vel.z * 0.25 + bz * (launch ? 3 : 1.5);
  const vy = launch ? d.ejectLaunch : 2;
  if (rider.dead) {
    rider.vel.x = vx; rider.vel.y = vy; rider.vel.z = vz;
    if (rider.char) rider.char.grounded = false;
    if (rider.combat) rider.combat.corpseSettled = false;
  } else {
    rider.vel.x = 0; rider.vel.y = 0; rider.vel.z = 0;
    knockback(rider, vx, vy, vz);
    if (launch) stunCharacter(sim, rider, d.ejectStun);
  }
}

/** Pilot still valid for this plane? Unseats (and throws out corpses) otherwise. Returns the live pilot. */
export function validPlaneRider(sim: Sim, plane: SimEntity): SimEntity | undefined {
  const p = plane.plane!;
  if (p.rider < 0) return undefined;
  const r = sim.entities.get(p.rider);
  if (!r || r.removed || !r.char || r.seat?.vehicle !== plane.id) { unseat(plane, undefined, sim.tick); if (r && r.seat?.vehicle === plane.id) unseat(undefined, r); return undefined; }
  if (r.dead) { ejectPilot(sim, plane, r, false); return undefined; }
  const s = planeSeatPosition(plane, seatTmp);
  if (Math.hypot(r.pos.x - s.x, r.pos.y - s.y, r.pos.z - s.z) > TELEPORT_TOLERANCE) { unseat(plane, r, sim.tick); return undefined; }
  return r;
}

// ---------------------------------------------------------------------------------------------
// Damage & destruction
// ---------------------------------------------------------------------------------------------

export interface PlaneDamageSource { id: EntityId; team: TeamId | -1 }

/** Damage a plane's hull. Emits `hit` (dst = plane). Destroys it at 0 hp. Returns the damage dealt. */
export function damagePlane(sim: Sim, plane: SimEntity, amount: number, src: PlaneDamageSource, x: number, y: number, z: number): number {
  const h = plane.health, p = plane.plane;
  if (!h || !p || plane.removed || h.hp <= 0 || amount <= 0 || !combatLive(sim)) return 0;
  const dmg = Math.min(h.hp, Math.max(1, Math.round(amount)));
  h.hp -= dmg;
  h.lastDamageTick = sim.tick;
  if (src.id !== plane.id && src.id !== p.rider) h.lastAttacker = src.id;
  sim.emit({ e: 'hit', src: src.id, dst: plane.id, dmg, x, y, z, crit: false });
  if (h.hp <= 0) destroyPlane(sim, plane);
  return dmg;
}

/**
 * Destroy a plane: throw the pilot out (launched up and back, stunned), start the terminal's cooldown, remove
 * the body, then blow up through the combat lane's explode() — credited to whoever shot it down (last attacker
 * within 10 s), else the pilot (or the last pilot within 10 s of a bail-out), else the plane itself.
 */
export function destroyPlane(sim: Sim, plane: SimEntity): void {
  const p = plane.plane;
  if (!p || plane.removed) return;
  const d = planeDef(plane);
  const x = plane.pos.x, y = plane.pos.y + d.gearHeight, z = plane.pos.z;
  const rider = p.rider >= 0 ? sim.entities.get(p.rider) : undefined;
  const h = plane.health!;
  const attacker = h.lastAttacker >= 0 && sim.tick - h.lastDamageTick <= CREDIT_TICKS ? sim.entities.get(h.lastAttacker) : undefined;
  const lastPilot = !rider && p.lastRider >= 0 && sim.tick - p.lastRiderTick <= CREDIT_TICKS ? sim.entities.get(p.lastRider) : undefined;
  let owner: EntityId = plane.id, ownerTeam: TeamId = vehicleTeam(sim, plane);
  if (attacker && attacker.id !== plane.id) { owner = attacker.id; ownerTeam = attacker.team; }
  else if (rider) { owner = rider.id; ownerTeam = rider.team; }
  else if (lastPilot) { owner = lastPilot.id; ownerTeam = lastPilot.team; }
  if (rider) ejectPilot(sim, plane, rider, true);
  const term = p.terminal >= 0 ? sim.entities.get(p.terminal) : undefined;
  if (term?.terminal && term.terminal.kart === plane.id) {
    const td = TERMINALS[term.terminal.id];
    term.terminal.kart = -1; term.terminal.cooldown = td.cooldown; term.terminal.cooldownTotal = td.cooldown;
  }
  h.hp = 0;
  const rt = vehicleRuntime(sim);
  if (plane.collider) rt.byHandle.delete(plane.collider.handle);
  sim.removeEntity(plane.id);
  rt.ownBlast = d.explosion;
  explode(sim, x, y, z, blastDef(d.explosion), owner, ownerTeam, -1);
  rt.ownBlast = null;
}

/** Despawn an abandoned plane quietly (no blast); its terminal re-arms after a short delay. */
function despawnPlane(sim: Sim, plane: SimEntity): void {
  const p = plane.plane!;
  const term = p.terminal >= 0 ? sim.entities.get(p.terminal) : undefined;
  if (term?.terminal && term.terminal.kart === plane.id) {
    const td = TERMINALS[term.terminal.id];
    term.terminal.kart = -1; term.terminal.cooldown = td.rearm; term.terminal.cooldownTotal = td.rearm;
  }
  if (plane.collider) vehicleRuntime(sim).byHandle.delete(plane.collider.handle);
  sim.removeEntity(plane.id);
}

/** `fire` events emitted by plane guns (they resolve their own hits at order 191). */
const planeShots = new WeakSet<object>();
/** Was this `fire` event shot by a plane's gun? */
export function isPlaneShot(ev: Extract<GameEvent, { e: 'fire' }>): boolean {
  return planeShots.has(ev);
}

/** Damage of a plane-gun bullet at a distance (for kart armor hit by plane guns; systems.ts). */
export function planeGunDamage(def: PlaneDef, dist: number): number {
  const g = def.gun;
  const t = Math.min(1, Math.max(0, (dist - g.falloffStart) / Math.max(1e-3, g.falloffEnd - g.falloffStart)));
  return g.damage * (1 + (g.falloffMin - 1) * t);
}

const shotCenter = { x: 0, y: 0, z: 0 };
/** Hitscan `fire` endpoints (weapons 400, tapped) against plane hit spheres, lag-compensated to the shooter's view. */
export function resolvePlaneShots(sim: Sim, shots: readonly Extract<GameEvent, { e: 'fire' }>[]): void {
  for (const ev of shots) {
    if (ev.hit !== -1 || isPlaneShot(ev)) continue;
    const def = weaponByIndex(ev.wpn);
    if (!def || def.kind !== 'hitscan') continue;
    const shooter = sim.entities.get(ev.id);
    const shooterTeam = shooter?.team ?? -1;
    const dl = Math.hypot(ev.dx, ev.dy, ev.dz);
    if (dl < 1e-6) continue;
    const dx = ev.dx / dl, dy = ev.dy / dl, dz = ev.dz / dl;
    const len = Math.hypot(ev.hx - ev.x, ev.hy - ev.y, ev.hz - ev.z);
    const tick = shooter ? rewindTick(sim, shooter.input.rt) : currentStateTick(sim);
    let best: SimEntity | null = null, bestT = Infinity;
    for (const plane of sim.entities.values()) {
      if (!plane.plane || plane.removed) continue;
      if (shooter && shooter.seat?.vehicle === plane.id) continue; // never your own plane
      if (!COMBAT_RULES.friendlyFire && shooterTeam === vehicleTeam(sim, plane)) continue;
      const d = planeDef(plane);
      const c = planeCenterAt(plane.plane, tick, shotCenter) ?? planeCenterOf(plane, shotCenter);
      const t = raySphere(ev.x, ev.y, ev.z, dx, dy, dz, c.x, c.y, c.z, d.hitRadius);
      if (t < 0 || t > len + 2 * d.hitRadius || t > def.range) continue;
      if (t < bestT) { bestT = t; best = plane; }
    }
    if (!best) continue;
    const pellets = def.pellets > 1 ? def.pellets * 0.6 : 1;
    const dmg = def.damage * pellets * falloff(def, bestT) * planeDef(best).bulletDamageMult;
    damagePlane(sim, best, dmg, { id: ev.id, team: shooterTeam as TeamId | -1 }, ev.x + dx * bestT, ev.y + dy * bestT, ev.z + dz * bestT);
  }
}

/** Explosions this tick against planes (distance to the hit sphere, cover blocks, friendly fire off). */
export function resolvePlaneBlasts(sim: Sim, list: readonly PendingBlast[]): void {
  for (const { ev, def } of list) {
    const b = blastDamageOf(sim, ev, def);
    const owner = sim.entities.get(ev.by);
    const ownerTeam: TeamId | -1 = owner ? owner.team : -1;
    for (const plane of sim.entities.values()) {
      if (!plane.plane || plane.removed || plane.id === ev.by) continue;
      const d = planeDef(plane);
      const c = planeCenterOf(plane, shotCenter);
      const cd = Math.hypot(c.x - ev.x, c.y - ev.y, c.z - ev.z);
      const dist = Math.max(0, cd - d.hitRadius);
      if (dist > ev.r) continue;
      const self = owner !== undefined && owner.id === plane.plane.rider;
      if (!self && !COMBAT_RULES.friendlyFire && ownerTeam === vehicleTeam(sim, plane)) continue;
      if (cd > d.radius + 0.05 && staticBlocked(sim, ev.x, ev.y, ev.z, c.x + (ev.x - c.x) * (d.radius / cd), c.y + (ev.y - c.y) * (d.radius / cd), c.z + (ev.z - c.z) * (d.radius / cd))) continue;
      const frac = dist <= b.inner ? 1 : 1 + (b.edge - 1) * ((dist - b.inner) / Math.max(1e-3, ev.r - b.inner));
      damagePlane(sim, plane, b.damage * frac * d.blastDamageMult * (self ? b.self : 1), { id: ev.by, team: ownerTeam }, c.x, c.y, c.z);
    }
  }
}

// ---------------------------------------------------------------------------------------------
// The plane gun: a squeaky machine gun, fixed forward with a small gimbal toward the pilot's aim
// ---------------------------------------------------------------------------------------------

const PLANE_GUN_WPN = weaponIndex(VEHICLES.rc_plane.gun.fxWeapon);
const gunTargets = new TargetSet();
const muzzleTmp = { x: 0, y: 0, z: 0 };

function fireGunShot(sim: Sim, plane: SimEntity, rider: SimEntity, n: number): void {
  const d = planeDef(plane), g = d.gun;
  const m = planeLocalToWorld(plane, g.muzzle.x, g.muzzle.y, g.muzzle.z, muzzleTmp);
  // The nose, gimballed up to `gimbal` toward the pilot's aim point (the camera ray through the aim pivot).
  const cpn = Math.cos(plane.pitch);
  const nx = -Math.sin(plane.yaw) * cpn, ny = Math.sin(plane.pitch), nz = -Math.cos(plane.yaw) * cpn;
  const ay = rider.input.yaw, ap = rider.input.pitch, cpa = Math.cos(ap);
  const conv = g.convergence;
  const tx = plane.pos.x - Math.sin(ay) * cpa * conv, ty = plane.pos.y + g.aimPivotY + Math.sin(ap) * conv, tz = plane.pos.z - Math.cos(ay) * cpa * conv;
  let dx = tx - m.x, dy = ty - m.y, dz = tz - m.z;
  let dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;
  const cosA = dx * nx + dy * ny + dz * nz;
  const cosG = Math.cos(g.gimbal);
  if (cosA < cosG) {
    // Clamp to the gimbal cone: rotate the nose toward the aim by exactly `gimbal`.
    let px = dx - cosA * nx, py = dy - cosA * ny, pz = dz - cosA * nz;
    const pl = Math.hypot(px, py, pz);
    if (pl > 1e-6) { px /= pl; py /= pl; pz /= pl; } else { px = 0; py = 1; pz = 0; }
    const sg = Math.sin(g.gimbal);
    dx = nx * cosG + px * sg; dy = ny * cosG + py * sg; dz = nz * cosG + pz * sg;
  }
  // Deterministic spread (no Math.random in the sim).
  const a = hash2(sim.tick, plane.id, n * 2) * Math.PI * 2, r = Math.sqrt(hash2(sim.tick, plane.id, n * 2 + 1)) * g.spread;
  let ux = -dz, uz = dx, uy = 0; // a perpendicular in the horizontal plane
  let ul = Math.hypot(ux, uz);
  if (ul < 1e-6) { ux = 1; uz = 0; ul = 1; }
  ux /= ul; uz /= ul;
  const vx = dy * uz - dz * uy, vy = dz * ux - dx * uz, vz = dx * uy - dy * ux; // second perpendicular
  dx += (ux * Math.cos(a) + vx * Math.sin(a)) * r; dy += (uy * Math.cos(a) + vy * Math.sin(a)) * r; dz += (uz * Math.cos(a) + vz * Math.sin(a)) * r;
  dl = Math.hypot(dx, dy, dz) || 1;
  dx /= dl; dy /= dl; dz /= dl;

  // World (and vehicles), never the plane's own body.
  const ray = new sim.R.Ray({ x: m.x, y: m.y, z: m.z }, { x: dx, y: dy, z: dz });
  const wh = sim.world.castRay(ray, g.range, true, undefined, GUN_RAY_FILTER, plane.collider ?? undefined);
  let best = wh ? wh.timeOfImpact : g.range;
  // Characters, lag-compensated to what the pilot saw (the rider's own team is skipped with friendly fire off).
  gunTargets.fill(sim, rider, rewindTick(sim, rider.input.rt), COMBAT_RULES.friendlyFire);
  let hitIdx = -1;
  for (let i = 0; i < gunTargets.n; i++) {
    const t = gunTargets.ents[i];
    if (t.seat?.vehicle === plane.id) continue;
    const cap = capsuleOf(t);
    const tc = rayCapsule(m.x, m.y, m.z, dx, dy, dz, gunTargets.x[i], gunTargets.y[i] + cap.r, gunTargets.z[i], cap.len, cap.r, best);
    if (tc >= 0 && tc < best) { best = tc; hitIdx = i; }
  }
  // Other planes (dogfights), at the tick the pilot was rendering them.
  const tick = rewindTick(sim, rider.input.rt);
  let hitPlane: SimEntity | null = null;
  const team = rider.team;
  for (const o of sim.entities.values()) {
    if (!o.plane || o === plane || o.removed) continue;
    if (!COMBAT_RULES.friendlyFire && vehicleTeam(sim, o) === team) continue;
    const c = planeCenterAt(o.plane, tick, shotCenter) ?? planeCenterOf(o, shotCenter);
    const t = raySphere(m.x, m.y, m.z, dx, dy, dz, c.x, c.y, c.z, planeDef(o).hitRadius);
    if (t >= 0 && t < best) { best = t; hitPlane = o; hitIdx = -1; }
  }
  const hx = m.x + dx * best, hy = m.y + dy * best, hz = m.z + dz * best;
  const dmg = planeGunDamage(d, best);
  const src = { id: rider.id, team: rider.team, weapon: PLANE_GUN_WPN };
  let hit: EntityId | -1 = -1;
  if (hitPlane) damagePlane(sim, hitPlane, dmg * planeDef(hitPlane).bulletDamageMult, { id: rider.id, team: rider.team }, hx, hy, hz);
  else if (hitIdx >= 0) { const t = gunTargets.ents[hitIdx]; hit = t.id; applyDamage(sim, t, dmg, src, hx, hy, hz, false); }
  // `id` = the plane (its gun, not the pilot's avatar): clients draw the tracer from the muzzle (x, y, z).
  const ev: Extract<GameEvent, { e: 'fire' }> = { e: 'fire', id: plane.id, wpn: PLANE_GUN_WPN, x: m.x, y: m.y, z: m.z, dx, dy, dz, hx, hy, hz, hit };
  planeShots.add(ev);
  sim.emit(ev);
}

function updateGun(sim: Sim, plane: SimEntity, rider: SimEntity | undefined, dt: number): void {
  const p = plane.plane!, g = planeDef(plane).gun;
  const trigger = !!rider?.seat && (rider.seat.raw & Btn.Fire) !== 0 && !p.overheated && combatLive(sim);
  if (trigger && rider) {
    p.gunCd -= dt;
    let n = 0;
    while (p.gunCd <= 0 && !p.overheated && n < 4) {
      fireGunShot(sim, plane, rider, n++);
      p.firedTick = sim.tick;
      p.gunCd += 1 / g.fireRate;
      p.gunHeat += g.heatPerShot;
      if (p.gunHeat >= 1) { p.gunHeat = 1; p.overheated = true; }
    }
    if (n) reportNoiseAt(sim, plane.pos.x, plane.pos.y, plane.pos.z, 40, rider.team, rider.id);
  } else {
    p.gunCd = Math.max(0, p.gunCd - dt);
    p.gunHeat = Math.max(0, p.gunHeat - g.coolRate * dt);
    if (p.overheated && p.gunHeat <= g.overheatResume) p.overheated = false;
  }
}

// ---------------------------------------------------------------------------------------------
// The plane step system (order 191, after the karts, before character movement at 200)
// ---------------------------------------------------------------------------------------------

const stepRes = newPlaneStepResult();
const pin: PlaneInput = { throttle: 0, steer: 0, aimYaw: 0, aimPitch: 0, boost: false, pilot: { speed: 1, handling: 1, boostCooldown: 1 } };

export const planeStepSystem: SimSystem = {
  name: 'plane-step',
  order: 191,
  update(sim, dt) {
    let c: PlaneContext | null = null;
    for (const plane of sim.entities.values()) {
      const p = plane.plane;
      if (!p || plane.removed) continue;
      const d = planeDef(plane);
      c ??= { world: sim.world, data: sim.worldData, shape: planeShape(sim, d), filter: PLANE_MOVE_FILTER, emit: (ev) => sim.emit(ev) };
      const rider = validPlaneRider(sim, plane);
      const input = rider ? planeInputFrom(rider.input, rider.cls, d, pin) : planeHoldInput(plane, d, pin);
      if (rider?.seat) rider.seat.prevRaw = rider.seat.raw;

      const res = stepPlane(c, plane, input, dt, stepRes);
      if (res.boostStarted) sim.emit({ e: 'ability', id: plane.id, ability: 'boost', x: plane.pos.x, y: plane.pos.y + 0.5, z: plane.pos.z });
      if (res.liftoff) sim.emit({ e: 'jump', id: plane.id, double: false });

      if (res.crash) {
        // Keep the impact's credit: whoever shot it recently, else the pilot (destroyPlane decides).
        plane.health!.hp = 0;
        destroyPlane(sim, plane);
        continue;
      }
      if (res.bumpDamage > 0) damagePlane(sim, plane, res.bumpDamage, { id: plane.id, team: plane.team }, plane.pos.x, plane.pos.y + d.gearHeight, plane.pos.z);
      if (plane.removed) continue;

      if (rider && !rider.dead && rider.seat) seatPilot(sim, plane, rider);
      updateGun(sim, plane, rider && !rider.dead ? rider : undefined, dt);
      if (plane.removed) continue;

      recordPlaneHistory(p, currentStateTick(sim), plane.pos.x, plane.pos.y + d.gearHeight, plane.pos.z);
      plane.flags = (p.rider >= 0 ? EFlag.Busy : 0) | (p.grounded ? EFlag.Grounded : 0)
        | (p.boostTime > 0 ? EFlag.Sprinting : 0) | (p.stalled ? EFlag.Crouching : 0)
        | (p.boostCd > 0 && p.boostTime <= 0 ? EFlag.Reloading : 0) | (p.overheated ? EFlag.Aiming : 0)
        | (p.firedTick >= 0 && sim.tick - p.firedTick <= FIRING_TICKS ? EFlag.Firing : 0);
      plane.weapon = p.rider;
      plane.ammo = packPlaneAux(p.throttle, p.roll);
      plane.anim = p.rider >= 0 ? Anim.Drive : Anim.Idle;
      if (p.rider < 0) {
        p.idle += dt;
        if (p.idle > d.abandonTime && p.grounded) despawnPlane(sim, plane);
      }
    }
  },
};
