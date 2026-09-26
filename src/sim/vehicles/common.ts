// Helpers shared by the kart (V1) and plane (R1) systems: blank vehicle entities, collider tagging,
// capsule clearance, static line checks, seating and unseating riders, and the short stun of a rider
// thrown out of a crashing plane. No Three.js, no DOM, no Math.random().
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EFlag, EntityKind, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { hash2 } from '../../shared/rng';
import { TICK_HZ } from '../../shared/constants';
import type { GameEvent } from '../../shared/protocol';
import { WEAPONS, type ProjectileDef } from '../../shared/content/weapons';
import type { KartExplosionDef } from '../../shared/content/vehicles';
import { CAPSULE_CLEAR_FILTER, STATIC_RAY_FILTER, capsuleShape, vehicleRuntime } from './state';
import { ordnanceBlastOf } from '../combat/ordnance';

const IDENTITY = { x: 0, y: 0, z: 0, w: 1 };
export const ticks = (s: number) => Math.round(s * TICK_HZ);

export function blankEntity(sim: Sim, kind: typeof EntityKind.Vehicle | typeof EntityKind.Terminal, team: TeamId, name: string): SimEntity {
  const id = sim.allocId();
  return {
    id, kind, team, species: 0, cls: null, seed: Math.floor(hash2(id, sim.tick, sim.seed) * 1e9), name,
    pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
  };
}

export function tagCollider(sim: Sim, e: SimEntity): void {
  if (!e.collider) return;
  (e.collider as unknown as { __entityId: number }).__entityId = e.id;
  vehicleRuntime(sim).byHandle.set(e.collider.handle, e.id);
}

/** Is a character capsule with its feet at (x, y, z) free of world, terminal and vehicle geometry? */
export function capsuleClear(sim: Sim, rider: SimEntity, x: number, y: number, z: number): boolean {
  const m = rider.char!.move;
  const center = { x, y: y + m.capsuleHalfHeight + m.capsuleRadius, z };
  return sim.world.intersectionWithShape(center, IDENTITY, capsuleShape(sim, rider), undefined, CAPSULE_CLEAR_FILTER, rider.collider ?? undefined) === null;
}

/** Static geometry (no vehicles) between two points? */
export function staticBlocked(sim: Sim, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return false;
  const ray = new sim.R.Ray({ x: ax, y: ay, z: az }, { x: dx / len, y: dy / len, z: dz / len });
  const hit = sim.world.castRay(ray, len, true, undefined, STATIC_RAY_FILTER);
  return !!hit && hit.timeOfImpact < len - 0.02;
}

/** The seat record of a vehicle entity (kart or plane), or undefined. */
export function seatSlot(v: SimEntity | undefined): { rider: number; idle: number } | undefined {
  return v?.kart ?? v?.plane;
}

/**
 * Clear the seat on both sides (no placement). A plane remembers its last pilot (crash credit after a
 * bail-out).
 */
export function unseat(v: SimEntity | undefined, rider: SimEntity | undefined, tick = 0): void {
  const slot = seatSlot(v);
  if (v && slot && (!rider || slot.rider === rider.id)) {
    if (v.plane && slot.rider >= 0) { v.plane.lastRider = slot.rider; v.plane.lastRiderTick = tick; }
    slot.rider = -1; v.flags &= ~EFlag.Busy; slot.idle = 0;
  }
  if (rider) {
    rider.seat = undefined;
    rider.flags &= ~(EFlag.Mounted | EFlag.Grounded);
    if (!rider.dead && rider.anim === Anim.Drive) rider.anim = Anim.Fall;
    if (rider.char) rider.char.grounded = false;
  }
}

/** Put a rider on a seat position (feet) and make them ride along: Mounted, Drive, the vehicle's velocity. */
export function seatCharacterAt(sim: Sim, rider: SimEntity, x: number, y: number, z: number, vel: { x: number; y: number; z: number }, grounded: boolean): void {
  sim.placeCharacter(rider, x, y, z);
  rider.vel.x = vel.x; rider.vel.y = vel.y; rider.vel.z = vel.z;
  rider.yaw = rider.input.yaw;
  rider.pitch = rider.input.pitch;
  rider.anim = Anim.Drive;
  rider.flags = (rider.flags & ~(EFlag.Grounded | EFlag.Sprinting | EFlag.Aiming | EFlag.Crouching | EFlag.Firing))
    | EFlag.Mounted | (grounded ? EFlag.Grounded : 0);
  const c = rider.char;
  if (c) { c.grounded = false; c.airTime = 0; c.jumpBuffer = 0; c.crouchBuffer = 0; c.glideTime = 0; c.jumpsUsed = 0; c.sprinting = false; c.slideTime = 0; c.pounding = false; }
}

// ---- stun: a rider thrown out of a crashing plane can't move or act for a moment ----
const STUN_KEY = 'vehicles.stunUntil';
/** Snapshot bit for "stunned": the client's predictor stops moving the local pet while it is set. */
const STUN_FLAG: number = EFlag.Stunned;

export function stunCharacter(sim: Sim, e: SimEntity, seconds: number): void {
  e.data[STUN_KEY] = sim.tick + ticks(seconds);
  e.flags |= STUN_FLAG;
}

/** Tick until which a character is stunned (0 = not stunned). */
export function stunnedUntil(e: SimEntity): number {
  const v = e.data[STUN_KEY];
  return typeof v === 'number' ? v : 0;
}

export function isStunned(sim: Sim, e: SimEntity): boolean {
  return stunnedUntil(e) > sim.tick;
}

/** Stunned characters keep their view but lose movement and buttons (runs before movement and weapons). */
export function applyStuns(sim: Sim): void {
  for (const e of sim.entities.values()) {
    if (!e.char) continue;
    const until = stunnedUntil(e);
    if (!until) continue;
    if (until <= sim.tick || e.dead) { delete e.data[STUN_KEY]; e.flags &= ~STUN_FLAG; continue; }
    e.flags |= STUN_FLAG;
    if (e.input.mx || e.input.mz || e.input.buttons) e.input = { ...e.input, mx: 0, mz: 0, buttons: 0 };
  }
}

// ---- vehicle explosions (through the combat lane's explode()) ----

/** A vehicle explosion as the ProjectileDef the combat lane's explode() takes. */
export function blastDef(x: KartExplosionDef): ProjectileDef {
  return {
    speed: 0, gravity: 0, radius: 0, lifetime: 0, bounces: 0, restitution: 0, bounceBonus: 0,
    explodeRadius: x.radius, explodeDamage: x.damage, explodeInner: x.inner, explodeEdgeFrac: x.edgeFrac,
    selfDamageMult: 0.5, knockback: x.knockback, fuse: false,
  };
}

/** Damage numbers of an `explode` event (a vehicle's own blast, the owner's weapon, or a generic default). */
export function blastDamageOf(sim: Sim, ev: Extract<GameEvent, { e: 'explode' }>, own: KartExplosionDef | null): { damage: number; inner: number; edge: number; self: number } {
  if (own) return { damage: own.damage, inner: own.inner, edge: own.edgeFrac, self: 0.5 };
  const od = ordnanceBlastOf(sim, ev); // W9 X4: a throwable's own numbers, not the thrower's gun
  if (od) return { damage: od.explodeDamage, inner: od.explodeInner, edge: od.explodeEdgeFrac, self: od.selfDamageMult };
  const owner = sim.entities.get(ev.by);
  const p = owner?.wpn ? WEAPONS[owner.wpn.id].projectile : undefined;
  if (p && p.explodeRadius > 0) return { damage: p.explodeDamage, inner: p.explodeInner, edge: p.explodeEdgeFrac, self: p.selfDamageMult };
  return { damage: 60, inner: 0.7, edge: 0.2, self: 0.35 };
}
