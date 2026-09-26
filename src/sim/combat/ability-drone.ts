// Spotter Drone ("Bird Watcher", Overwatch): flies from above the owner's head to a station ahead of and above
// them and hovers there for AbilityDef.duration. Every DRONE.spotEvery ticks it marks each enemy character within
// AbilityDef.range with a clear line of sight from the drone: `spotUntil` → EFlag.Spotted ("revealed to the other
// team"), kept for DRONE.spotLinger after the last sighting. Cloaked enemies are only spotted within
// DRONE.cloakReveal; tall-grass concealment counts half (the drone looks down into the grass, like a lookout).
// It is a small sphere in DRONE_GROUPS: bullets and projectiles stop on it and hurt it; characters pass through.
// It goes down when shot to 0 hp, when its owner dies or leaves, and on expiry.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EFlag } from '../../shared/types';
import { TICK_DT } from '../../shared/constants';
import type { AbilityDef } from '../../shared/content/abilities';
import { concealLevel, concealRevealRange } from '../world/env';
import { worldLineClear, worldRay } from './geometry';
import { characterHeight, isStealthed, reportNoise, ticksOf } from './state';
import { attachCollider, DRONE_GROUPS, spawnAbilityEntity } from './ability-core';
import { DRONE } from './ability-tuning';

const LINGER_TICKS = ticksOf(DRONE.spotLinger);

/** Launch a drone for `owner` (activation). Always succeeds: the station is pulled in front of walls and ceilings. */
export function deployDrone(sim: Sim, owner: SimEntity, def: AbilityDef): SimEntity {
  const yaw = owner.yaw;
  const fx = -Math.sin(yaw), fz = -Math.cos(yaw);
  // launch from above the head (clear of the owner's own eye line) ...
  const ox = owner.pos.x + fx * 0.4, oy = owner.pos.y + 1.95, oz = owner.pos.z + fz * 0.4;
  // ... to a station ahead and up, stopped short of anything in between
  let tx = owner.pos.x + fx * DRONE.ahead, ty = owner.pos.y + DRONE.up, tz = owner.pos.z + fz * DRONE.ahead;
  const dx = tx - ox, dy = ty - oy, dz = tz - oz;
  const len = Math.hypot(dx, dy, dz);
  const reach = worldRay(sim, ox, oy, oz, dx / len, dy / len, dz / len, len + DRONE.radius + 0.3);
  if (reach < len + DRONE.radius + 0.3) {
    const k = Math.max(0, reach - DRONE.radius - 0.3) / len;
    tx = ox + dx * k; ty = oy + dy * k; tz = oz + dz * k;
  }
  const ground = sim.worldData.height(tx, tz);
  if (ty < ground + DRONE.minAboveGround) ty = ground + DRONE.minAboveGround;
  const e = spawnAbilityEntity(sim, owner, def, 'drone', ox, oy, oz, yaw, DRONE.hp);
  const a = e.abx!;
  a.fromX = ox; a.fromY = oy; a.fromZ = oz;
  a.sx = tx; a.sy = ty; a.sz = tz;
  e.flags = EFlag.Busy;
  e.ammo = Math.ceil(def.duration);
  attachCollider(sim, e, sim.R.ColliderDesc.ball(DRONE.radius).setTranslation(ox, oy, oz).setCollisionGroups(DRONE_GROUPS));
  sim.emit({ e: 'ability', id: owner.id, ability: def.id, x: owner.pos.x, y: owner.pos.y, z: owner.pos.z });
  reportNoise(sim, owner, def.noise);
  return e;
}

/** Fly/hover one tick: position (ease-out launch, then bob), spin, velocity, collider. */
export function flyDrone(sim: Sim, e: SimEntity, dt: number): void {
  const a = e.abx!;
  const age = (sim.tick + 1 - a.born) * TICK_DT;
  const k = Math.min(1, age / DRONE.launch);
  const ease = 1 - (1 - k) * (1 - k) * (1 - k);
  const bob = DRONE.bob * Math.sin(age * DRONE.bobHz * Math.PI * 2) * k;
  const x = a.fromX + (a.sx - a.fromX) * ease, y = a.fromY + (a.sy - a.fromY) * ease + bob, z = a.fromZ + (a.sz - a.fromZ) * ease;
  e.vel.x = (x - e.pos.x) / dt; e.vel.y = (y - e.pos.y) / dt; e.vel.z = (z - e.pos.z) / dt;
  e.pos.x = x; e.pos.y = y; e.pos.z = z;
  e.yaw += DRONE.spin * dt;
  if (e.yaw > Math.PI) e.yaw -= Math.PI * 2;
  e.flags = k < 1 ? EFlag.Busy : 0;
  e.collider?.setTranslation({ x, y, z });
}

/** Mark the enemies this drone sees (runs every DRONE.spotEvery ticks per drone, staggered by id). */
export function droneSpot(sim: Sim, e: SimEntity, def: AbilityDef): void {
  const a = e.abx!;
  if ((sim.tick + e.id) % DRONE.spotEvery !== 0) return;
  const range = def.range;
  const until = sim.tick + LINGER_TICKS;
  let n = 0;
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t.removed || t.team === a.team) continue;
    const h = characterHeight(t);
    const cx = t.pos.x, cy = t.pos.y + h * 0.55, cz = t.pos.z;
    const dx = cx - e.pos.x, dy = cy - e.pos.y, dz = cz - e.pos.z;
    const dist = Math.hypot(dx, dy, dz);
    if (dist > range) continue;
    if (isStealthed(sim, t) && dist > DRONE.cloakReveal) continue;
    const hidden = concealLevel(t) * 0.5;
    if (hidden > 0 && dist > concealRevealRange(hidden, range, (t.spotUntil ?? 0) > sim.tick)) continue;
    // trace from just outside the drone's own sphere
    const k = dist > 1e-3 ? (DRONE.radius + 0.06) / dist : 0;
    const ox = e.pos.x + dx * k, oy = e.pos.y + dy * k, oz = e.pos.z + dz * k;
    if (!worldLineClear(sim, ox, oy, oz, cx, cy, cz) && !worldLineClear(sim, ox, oy, oz, cx, t.pos.y + h * 0.92, cz)) continue;
    t.spotUntil = until;
    n++;
  }
  a.spotted = n;
  e.weapon = n;
}
