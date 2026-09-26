// Dig Charge ("Litter Mine", Breacher): buried on the ground under the crosshair (within CHARGE.plantReach) or at
// the owner's feet. It arms after CHARGE.armTime, then detonates when an enemy character comes within
// CHARGE.trigger with a clear line to it, or when AbilityDef.duration (its fuse) runs out. The blast is the combat
// lane's own explode(): radius AbilityDef.range, AbilityDef.damage with falloff, knockback, and a world
// line-of-sight test from the blast center to every target, so it never hurts anyone through walls or barriers.
// Enemy shots passing within CHARGE.shotRadius of it, or enemy blasts nearby, defuse it (no blast).
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EFlag } from '../../shared/types';
import { TICK_HZ } from '../../shared/constants';
import { viewDir } from '../../shared/math';
import type { AbilityDef } from '../../shared/content/abilities';
import type { ProjectileDef } from '../../shared/content/weapons';
import { pointCapsuleDistance, worldLineClear, worldRayNormal, type WorldHit } from './geometry';
import { explode } from './projectiles';
import { capsuleOf, eyeHeight, reportNoise, ticksOf } from './state';
import { abilityEntities, removeAbilityEntity, spawnAbilityEntity } from './ability-core';
import { surfaceBelow } from './ability-barrier';
import { CHARGE } from './ability-tuning';

const wh: WorldHit = { t: 0, nx: 0, ny: 0, nz: 0 };
const blasts = new Map<string, ProjectileDef>();

/** The charge's blast as an explosion definition for combat explode() (knock-up = 0.55 × knockback there). */
export function chargeBlast(def: AbilityDef): ProjectileDef {
  let b = blasts.get(def.id);
  if (!b) {
    b = {
      speed: 0, gravity: 0, radius: 0, lifetime: def.duration, bounces: 0, restitution: 0, bounceBonus: 0,
      explodeRadius: def.range, explodeDamage: def.damage, explodeInner: CHARGE.inner, explodeEdgeFrac: CHARGE.edgeFrac,
      selfDamageMult: CHARGE.selfMult, knockback: def.knockback, fuse: true,
    };
    blasts.set(def.id, b);
  }
  return b;
}

/** Plant a charge for `owner` (activation). Returns the entity, or null when there is no ground in reach. */
export function plantCharge(sim: Sim, owner: SimEntity, def: AbilityDef): SimEntity | null {
  if (owner.flags & EFlag.Mounted) return null;
  const ex = owner.pos.x, ey = owner.pos.y + eyeHeight(owner), ez = owner.pos.z;
  const v = viewDir(owner.yaw, owner.pitch);
  let px = 0, py = 0, pz = 0, found = false;
  const hit = worldRayNormal(sim, ex, ey, ez, v.x, v.y, v.z, CHARGE.plantReach, wh);
  if (hit && hit.ny > 0.7) { px = ex + v.x * hit.t; py = ey + v.y * hit.t; pz = ez + v.z * hit.t; found = true; }
  if (!found) {
    const y = surfaceBelow(sim, owner.pos.x, owner.pos.z, owner.pos.y + 0.5, 3);
    if (Number.isFinite(y)) { px = owner.pos.x; py = y; pz = owner.pos.z; found = true; }
  }
  if (!found) return null;
  // at most CHARGE.maxPerOwner live charges: the oldest fizzles
  const mine = abilityEntities(sim).filter((c) => c.abx!.kind === 'charge' && c.abx!.owner === owner.id);
  mine.sort((p, q) => p.abx!.born - q.abx!.born || p.id - q.id);
  for (let i = 0; i <= mine.length - CHARGE.maxPerOwner; i++) removeAbilityEntity(sim, mine[i], 'end');
  const e = spawnAbilityEntity(sim, owner, def, 'charge', px, py, pz, owner.yaw, 0);
  e.abx!.armAt = sim.tick + ticksOf(CHARGE.armTime);
  e.ammo = Math.ceil(def.duration);
  sim.emit({ e: 'ability', id: owner.id, ability: def.id, x: px, y: py, z: pz });
  reportNoise(sim, owner, def.noise);
  return e;
}

/** Per tick: arming, snapshot timer; true when the charge must detonate now (enemy in reach or fuse out). */
export function chargeDue(sim: Sim, e: SimEntity): boolean {
  const a = e.abx!;
  const armed = sim.tick >= a.armAt;
  e.flags = armed ? EFlag.Busy : 0;
  e.ammo = Math.max(0, Math.ceil((a.until - sim.tick) / TICK_HZ));
  if (sim.tick >= a.until) return true;
  if (!armed) return false;
  const bx = e.pos.x, by = e.pos.y + CHARGE.blastLift, bz = e.pos.z;
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t.removed || t.team === a.team) continue;
    const cap = capsuleOf(t);
    if (pointCapsuleDistance(bx, by, bz, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, cap.r) > CHARGE.trigger) continue;
    if (worldLineClear(sim, bx, by, bz, t.pos.x, t.pos.y + cap.height * 0.5, t.pos.z)) return true;
  }
  return false;
}

/** Blow the charge: combat explode() (LOS-checked damage + knockback + `explode` event), then remove it. */
export function detonateCharge(sim: Sim, e: SimEntity, def: AbilityDef): void {
  const a = e.abx!;
  explode(sim, e.pos.x, e.pos.y + CHARGE.blastLift, e.pos.z, chargeBlast(def), a.owner, a.team, -1);
  removeAbilityEntity(sim, e, null);
}
