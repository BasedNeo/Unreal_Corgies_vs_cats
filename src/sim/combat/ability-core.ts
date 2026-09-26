// Ability entities — Spotter Drone, Dig Charge, Squeak Barrier — as authoritative EntityKind.Prop entities.
// Shared pieces: the component, a per-Sim registry, spawn/remove, damage intake and shape tests.
//
// Snapshot convention (EntityState, EntityKind.Prop, cls = ABILITY_IDS index — 2 drone · 3 charge · 4 barrier;
// the objective beacon is the other Prop and uses cls 0):
//   team/species = the owner's · seed = owner entity id · yaw = facing · hp/maxHp = health (charge: 0/0)
//   ammo = whole seconds left · flags & Busy = drone launching / charge ARMED
//   drone:   x,y,z = center · vx,vy,vz = velocity · weapon = enemies it spots right now
//   charge:  x,y,z = planted point on the ground
//   barrier: x,y,z = ground point under the wall's center; the wall spans y - BARRIER.sink .. y + BARRIER.height,
//            AbilityDef.range wide across the facing, BARRIER.thickness deep
// Events: `ability { id: owner, ability: <id> }` on deploy (starts the owner's HUD ring), then
// `ability { id: entity, ability: '<id>:down' }` when destroyed/defused or `'<id>:end'` when it expires;
// `hit { src, dst: entity }` when shot; a charge detonation is a combat `explode` (plus the usual hits).
import type { Collider, ColliderDesc } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, CLASS_IDS, type EntityId, type EntityKindId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { ABILITY_IDS, type AbilityDef, type AbilityId } from '../../shared/content/abilities';
import { groups, Layer } from '../rapier';
import type { RayPass } from './geometry';
import { combatLive, ticksOf } from './state';
import { ABILITY_ENTITY_KIND, BARRIER, CHARGE, DRONE } from './ability-tuning';

export type AbilityEntityKind = 'drone' | 'charge' | 'barrier';

export interface AbilityEntityState {
  kind: AbilityEntityKind;
  ability: AbilityId;
  owner: EntityId;
  team: TeamId;
  /** Tick it was deployed (not in Rapier's query structures until the next physics step). */
  born: number;
  /** Tick at which it expires (charge: detonates). */
  until: number;
  /** Drone: launch origin and station. */
  fromX: number; fromY: number; fromZ: number;
  sx: number; sy: number; sz: number;
  /** Drone: enemies it spotted at the last scan. */
  spotted: number;
  /** Charge: tick from which it can trigger. */
  armAt: number;
  /** Barrier: collider half extents (width, height, depth) and the collider center height. */
  hw: number; hh: number; ht: number; cy: number;
}

declare module '../entity' {
  interface SimEntity {
    abx?: AbilityEntityState;
    /** Tick until which this character carries EFlag.Spotted (an enemy Spotter Drone sees it). */
    spotUntil?: number;
  }
}

/** Drone: a small sphere that stops bullets and projectiles (and nothing else: characters fly through). */
export const DRONE_GROUPS = groups(Layer.Vehicle, Layer.Projectile);
/** Barrier: blocks character movement (the KCC's CHARACTER_MOVE_FILTER sees Vehicle), karts and every shot. */
export const BARRIER_GROUPS = groups(Layer.Vehicle, Layer.Character | Layer.Projectile | Layer.Vehicle);

const registries = new WeakMap<Sim, SimEntity[]>();

/** Live ability entities of a sim (pruned of removed ones). Do not hold on to the array across ticks. */
export function abilityEntities(sim: Sim): SimEntity[] {
  let list = registries.get(sim);
  if (!list) { list = []; registries.set(sim, list); }
  let n = 0;
  for (const e of list) if (!e.removed) list[n++] = e;
  list.length = n;
  return list;
}

interface PassCache { tick: number; handles: [number[], number[]]; fns: [RayPass, RayPass] }
const passCaches = new WeakMap<Sim, PassCache>();

/**
 * A team's shots pass through its own Squeak Barriers and Spotter Drones; they still block the other team's shots
 * (and everyone's movement). Returns the ray predicate for `team`, or undefined when that team has no live ability
 * colliders — the usual case, which costs nothing. The handle list is rebuilt once per tick.
 */
export function friendlyShotPass(sim: Sim, team: TeamId | -1): RayPass | undefined {
  if (team !== 0 && team !== 1) return undefined;
  let pc = passCaches.get(sim);
  if (!pc) {
    const handles: [number[], number[]] = [[], []];
    pc = { tick: -1, handles, fns: [(c) => !handles[0].includes(c.handle), (c) => !handles[1].includes(c.handle)] };
    passCaches.set(sim, pc);
  }
  if (pc.tick !== sim.tick) {
    pc.tick = sim.tick;
    pc.handles[0].length = 0;
    pc.handles[1].length = 0;
    for (const e of abilityEntities(sim)) if (e.collider && (e.team === 0 || e.team === 1)) pc.handles[e.team].push(e.collider.handle);
  }
  return pc.handles[team].length ? pc.fns[team] : undefined;
}

export function abilityIndexOf(id: string): number {
  return (ABILITY_IDS as readonly string[]).indexOf(id);
}

export function spawnAbilityEntity(
  sim: Sim, owner: SimEntity, def: AbilityDef, kind: AbilityEntityKind, x: number, y: number, z: number, yaw: number, hp: number,
): SimEntity {
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: ABILITY_ENTITY_KIND as EntityKindId, team: owner.team, species: owner.species,
    // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the ABILITY_IDS index.
    cls: CLASS_IDS[abilityIndexOf(def.id)] ?? null,
    seed: owner.id, name: def.id,
    pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
    health: hp > 0 ? { hp, max: hp, lastDamageTick: -9999, lastAttacker: -1 } : null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
    abx: {
      kind, ability: def.id as AbilityId, owner: owner.id, team: owner.team, born: sim.tick,
      until: sim.tick + ticksOf(def.duration), fromX: x, fromY: y, fromZ: z, sx: x, sy: y, sz: z, spotted: 0,
      armAt: 0, hw: 0, hh: 0, ht: 0, cy: y,
    },
  };
  sim.entities.set(id, e);
  abilityEntities(sim).push(e);
  return e;
}

export function attachCollider(sim: Sim, e: SimEntity, desc: ColliderDesc): Collider {
  const c = sim.world.createCollider(desc);
  (c as unknown as { __entityId: number }).__entityId = e.id;
  e.collider = c;
  return c;
}

/** Remove an ability entity; `reason` emits `<id>:down` / `<id>:end` (null = silent, e.g. match restart). */
export function removeAbilityEntity(sim: Sim, e: SimEntity, reason: 'down' | 'end' | null): void {
  if (e.removed) return;
  if (reason) sim.emit({ e: 'ability', id: e.id, ability: `${e.name}:${reason}`, x: e.pos.x, y: e.pos.y, z: e.pos.z });
  sim.removeEntity(e.id);
}

/** Remove every ability entity silently (warmup / match over / restart). */
export function clearAbilityEntities(sim: Sim): void {
  for (const e of [...abilityEntities(sim)]) removeAbilityEntity(sim, e, null);
}

/**
 * Damage a drone or barrier (friendly fire rules as for characters; nothing while combat is not live).
 * Emits `hit` so shooters get hit markers. Destruction happens in the ability-entity system.
 */
export function damageAbilityEntity(sim: Sim, e: SimEntity, amount: number, src: EntityId, srcTeam: TeamId | -1, x: number, y: number, z: number): number {
  const h = e.health;
  if (!h || e.removed || h.hp <= 0 || amount <= 0 || !combatLive(sim)) return 0;
  if (!COMBAT_RULES.friendlyFire && srcTeam === e.team) return 0;
  const dmg = Math.min(h.hp, Math.max(1, Math.round(amount)));
  h.hp -= dmg;
  h.lastDamageTick = sim.tick;
  h.lastAttacker = src;
  sim.emit({ e: 'hit', src, dst: e.id, dmg, x, y, z, crit: false });
  return dmg;
}

// ------------------------------------------------------------------ shapes

/** Barrier local frame: right = (cos yaw, 0, -sin yaw) spans the width, forward = (-sin yaw, 0, -cos yaw) the depth. */
function barrierLocal(e: SimEntity, px: number, py: number, pz: number, out: { x: number; y: number; z: number }): void {
  const a = e.abx!;
  const dx = px - e.pos.x, dz = pz - e.pos.z;
  const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  out.x = dx * c - dz * s;
  out.z = -dx * s - dz * c;
  out.y = py - a.cy;
}
const lp = { x: 0, y: 0, z: 0 };

/** Distance (m) from a point to the entity's solid shape (0 inside). Drone: sphere · barrier: box · charge: small sphere. */
export function abilityShapeDistance(e: SimEntity, px: number, py: number, pz: number): number {
  const a = e.abx!;
  if (a.kind === 'barrier') {
    barrierLocal(e, px, py, pz, lp);
    const qx = Math.max(0, Math.abs(lp.x) - a.hw), qy = Math.max(0, Math.abs(lp.y) - a.hh), qz = Math.max(0, Math.abs(lp.z) - a.ht);
    return Math.sqrt(qx * qx + qy * qy + qz * qz);
  }
  const r = a.kind === 'drone' ? DRONE.radius : CHARGE.shotRadius;
  const cy = a.kind === 'charge' ? e.pos.y + 0.15 : e.pos.y;
  return Math.max(0, Math.hypot(px - e.pos.x, py - cy, pz - e.pos.z) - r);
}

/** Closest point of the entity's shape to (px, py, pz) (for blast line-of-sight tests). */
export function abilityClosestPoint(e: SimEntity, px: number, py: number, pz: number, out: { x: number; y: number; z: number }): void {
  const a = e.abx!;
  if (a.kind === 'barrier') {
    barrierLocal(e, px, py, pz, lp);
    const x = Math.max(-a.hw, Math.min(a.hw, lp.x)), y = Math.max(-a.hh, Math.min(a.hh, lp.y)), z = Math.max(-a.ht, Math.min(a.ht, lp.z));
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    out.x = e.pos.x + x * c - z * s;
    out.z = e.pos.z - x * s - z * c;
    out.y = a.cy + y;
    return;
  }
  const r = a.kind === 'drone' ? DRONE.radius : 0.1;
  const cy = a.kind === 'charge' ? e.pos.y + 0.15 : e.pos.y;
  const dx = px - e.pos.x, dy = py - cy, dz = pz - e.pos.z;
  const l = Math.hypot(dx, dy, dz);
  const k = l > r ? r / l : 0;
  out.x = e.pos.x + dx * k; out.y = cy + dy * k; out.z = e.pos.z + dz * k;
}

/**
 * Entry distance of a swept sphere (radius `pr`) moving along a unit ray from (ox, oy, oz) into the entity's shape,
 * within maxT; -1 on a miss (0 when it starts inside). Used for projectiles against drones and barriers.
 */
export function abilitySweep(e: SimEntity, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, maxT: number, pr: number): number {
  const a = e.abx!;
  if (a.kind === 'barrier') {
    barrierLocal(e, ox, oy, oz, lp);
    const c = Math.cos(e.yaw), s = Math.sin(e.yaw);
    const ldx = dx * c - dz * s, ldz = -dx * s - dz * c, ldy = dy;
    let t0 = 0, t1 = maxT;
    const o = [lp.x, lp.y, lp.z], d = [ldx, ldy, ldz], h = [a.hw + pr, a.hh + pr, a.ht + pr];
    for (let i = 0; i < 3; i++) {
      if (Math.abs(d[i]) < 1e-9) { if (Math.abs(o[i]) > h[i]) return -1; continue; }
      let ta = (-h[i] - o[i]) / d[i], tb = (h[i] - o[i]) / d[i];
      if (ta > tb) { const t = ta; ta = tb; tb = t; }
      if (ta > t0) t0 = ta;
      if (tb < t1) t1 = tb;
      if (t0 > t1) return -1;
    }
    return t0;
  }
  if (a.kind !== 'drone') return -1;
  const r = DRONE.radius + pr;
  const ax = ox - e.pos.x, ay = oy - e.pos.y, az = oz - e.pos.z;
  const c = ax * ax + ay * ay + az * az - r * r;
  if (c <= 0) return 0;
  const b = ax * dx + ay * dy + az * dz;
  const disc = b * b - c;
  if (disc < 0) return -1;
  const t = -b - Math.sqrt(disc);
  return t >= 0 && t <= maxT ? t : -1;
}

/** Barrier geometry for a wall of the given width centered at ground point y (collider spans y - sink .. y + height). */
export function barrierExtents(width: number): { hw: number; hh: number; ht: number; lift: number } {
  const hh = (BARRIER.height + BARRIER.sink) / 2;
  return { hw: width / 2, hh, ht: BARRIER.thickness / 2, lift: hh - BARRIER.sink };
}
