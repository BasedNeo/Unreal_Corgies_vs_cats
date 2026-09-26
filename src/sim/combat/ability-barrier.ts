// Squeak Barrier ("Scratch Wall", Warden): a wall segment in front of the owner, facing the aim yaw, for
// AbilityDef.duration. It is a fixed Rapier cuboid in BARRIER_GROUPS, so the character controller of BOTH teams
// (CHARACTER_MOVE_FILTER sees Vehicle), karts, hitscan and projectiles (WORLD_RAY_FILTER) all collide with it; bark
// blasts, explosions and bot sight lines (worldLineClear) are blocked too. It has hit points and can be shot down.
// Placement never overlaps a character or a solid prop: the preferred spot is nudged nearer/farther/sideways, and
// the activation is refused (no cooldown spent) when nothing nearby is clear.
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { EntityState } from '../../shared/protocol';
import { EFlag } from '../../shared/types';
import { ABILITIES, ABILITY_IDS, type AbilityDef } from '../../shared/content/abilities';
import { groups, Layer } from '../rapier';
import { isTerrainCollider } from '../world/build';
import { worldLineClear, worldRay } from './geometry';
import { characterHeight, reportNoise } from './state';
import { attachCollider, barrierExtents, BARRIER_GROUPS, spawnAbilityEntity } from './ability-core';
import { ABILITY_ENTITY_KIND, BARRIER } from './ability-tuning';

/** Solid things a barrier may not be placed into: props, kiosks, karts, other barriers (not terrain, not characters). */
const SOLID_QUERY = groups(Layer.Vehicle, Layer.World | Layer.Vehicle);
/** Candidate offsets from the preferred spot: [extra distance along the aim, sideways]. */
const TRIES: readonly (readonly [number, number])[] = [
  [0, 0], [-0.4, 0], [0.6, 0], [0, 0.9], [0, -0.9], [-0.8, 0], [1.2, 0], [-0.4, 1.1], [-0.4, -1.1], [0.6, 1.1], [0.6, -1.1],
];

/**
 * Highest walkable surface under (x, z) at or below `fromY`, within `maxDrop` (m): a downward world ray, with the
 * terrain height as a backstop. -Infinity when there is none.
 */
export function surfaceBelow(sim: Sim, x: number, z: number, fromY: number, maxDrop: number): number {
  const t = worldRay(sim, x, fromY, z, 0, -1, 0, maxDrop);
  const hit = t < maxDrop ? fromY - t : -Infinity;
  const terrain = sim.worldData.height(x, z);
  const ground = terrain <= fromY && terrain >= fromY - maxDrop ? terrain : -Infinity;
  return Math.max(hit, ground);
}

export interface BarrierSpot { x: number; y: number; z: number; yaw: number }

/** Does a living character's capsule overlap the wall box (ground point y, facing yaw)? */
function overlapsCharacter(sim: Sim, x: number, y: number, z: number, yaw: number, hw: number, ht: number): boolean {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t.removed) continue;
    const dx = t.pos.x - x, dz = t.pos.z - z;
    const lx = dx * c - dz * s, lz = -dx * s - dz * c;
    const qx = Math.max(0, Math.abs(lx) - hw), qz = Math.max(0, Math.abs(lz) - ht);
    if (Math.hypot(qx, qz) >= t.char.move.capsuleRadius + 0.08) continue;
    if (t.pos.y + characterHeight(t) < y - BARRIER.sink || t.pos.y > y + BARRIER.height) continue;
    return true;
  }
  return false;
}

/** Does the wall (above its ground contact) intersect a prop, kiosk, kart or another barrier? */
function overlapsSolid(sim: Sim, x: number, y: number, z: number, yaw: number, hw: number, ht: number): boolean {
  const lift = 0.35;
  const hh = (BARRIER.height - lift) / 2;
  const shape = new sim.R.Cuboid(Math.max(0.1, hw - 0.05), hh, ht);
  const hit = sim.world.intersectionWithShape(
    { x, y: y + lift + hh, z }, { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) }, shape,
    undefined, SOLID_QUERY, undefined, undefined, (col) => !isTerrainCollider(col),
  );
  return hit !== null;
}

/**
 * Where a barrier raised by `owner` would stand: the first clear candidate around BARRIER.dist in front along the
 * owner's yaw, on ground within BARRIER.maxSlope across its width and with the owner's line to it unobstructed.
 */
export function findBarrierSpot(sim: Sim, owner: SimEntity, width: number): BarrierSpot | null {
  const yaw = owner.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw), rx = Math.cos(yaw), rz = -Math.sin(yaw);
  const { hw, ht } = barrierExtents(width);
  const refY = owner.pos.y;
  for (const [dd, lat] of TRIES) {
    const d = BARRIER.dist + dd;
    const x = owner.pos.x + fx * d + rx * lat, z = owner.pos.z + fz * d + rz * lat;
    const y = surfaceBelow(sim, x, z, refY + 1.6, 3.5);
    if (!Number.isFinite(y) || Math.abs(y - refY) > 1.2) continue;
    let flat = true;
    for (const sg of [-1, 1]) {
      const ex = x + rx * sg * (hw - 0.2), ez = z + rz * sg * (hw - 0.2);
      const ye = surfaceBelow(sim, ex, ez, y + 1.2, 2.5);
      if (!Number.isFinite(ye) || Math.abs(ye - y) > BARRIER.maxSlope) { flat = false; break; }
    }
    if (!flat) continue;
    if (!worldLineClear(sim, owner.pos.x, refY + 0.8, owner.pos.z, x, y + 0.8, z)) continue;
    if (overlapsCharacter(sim, x, y, z, yaw, hw, ht)) continue;
    if (overlapsSolid(sim, x, y, z, yaw, hw, ht)) continue;
    return { x, y, z, yaw };
  }
  return null;
}

/** Raise a barrier for `owner` (activation). Returns the entity, or null when refused (no clear spot, seated). */
export function raiseBarrier(sim: Sim, owner: SimEntity, def: AbilityDef): SimEntity | null {
  if (owner.flags & EFlag.Mounted) return null;
  const spot = findBarrierSpot(sim, owner, def.range);
  if (!spot) return null;
  const e = spawnAbilityEntity(sim, owner, def, 'barrier', spot.x, spot.y, spot.z, spot.yaw, BARRIER.hp);
  const ext = barrierExtents(def.range);
  const a = e.abx!;
  a.hw = ext.hw; a.hh = ext.hh; a.ht = ext.ht; a.cy = spot.y + ext.lift;
  const R = sim.R;
  attachCollider(sim, e, R.ColliderDesc.cuboid(ext.hw, ext.hh, ext.ht)
    .setTranslation(spot.x, a.cy, spot.z)
    .setRotation({ x: 0, y: Math.sin(spot.yaw / 2), z: 0, w: Math.cos(spot.yaw / 2) })
    .setCollisionGroups(BARRIER_GROUPS));
  e.ammo = Math.ceil(def.duration);
  sim.emit({ e: 'ability', id: owner.id, ability: def.id, x: spot.x, y: spot.y, z: spot.z });
  reportNoise(sim, owner, def.noise);
  return e;
}

/**
 * Client prediction: mirror the barriers of a snapshot into a prediction Sim as the same fixed colliders the authority
 * has (keyed by entity id in `cache`), so the local player's predicted movement stops at walls instead of walking
 * through and being pulled back by reconciliation. Steps the prediction world when something changed (its broad
 * phase must see new colliders). Returns true when colliders were added or removed.
 */
export function mirrorBarriers(sim: Sim, states: Iterable<EntityState>, cache: Map<number, Collider>): boolean {
  const idx = ABILITY_IDS.indexOf('squeak_barrier');
  const ext = barrierExtents(ABILITIES.squeak_barrier.range);
  let changed = false;
  mirrorSeen.clear();
  for (const s of states) {
    if (s.kind !== ABILITY_ENTITY_KIND || s.cls !== idx) continue;
    mirrorSeen.add(s.id);
    if (cache.has(s.id)) continue;
    const c = sim.world.createCollider(sim.R.ColliderDesc.cuboid(ext.hw, ext.hh, ext.ht)
      .setTranslation(s.x, s.y + ext.lift, s.z)
      .setRotation({ x: 0, y: Math.sin(s.yaw / 2), z: 0, w: Math.cos(s.yaw / 2) })
      .setCollisionGroups(BARRIER_GROUPS));
    cache.set(s.id, c);
    changed = true;
  }
  for (const [id, c] of cache) {
    if (mirrorSeen.has(id)) continue;
    sim.world.removeCollider(c, false);
    cache.delete(id);
    changed = true;
  }
  if (changed) sim.world.step();
  return changed;
}
const mirrorSeen = new Set<number>();
