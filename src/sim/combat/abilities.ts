// Ability system (order 450). Runs the abilities whose data is marked `live`:
//   bark_blast     — cone shockwave in front of the user: small damage + knockback (LOS-checked).
//   shadow_cloak   — EFlag.Stealthed for `duration`; firing breaks it; AI only sees the user within revealRange.
//   spotter_drone  — a hovering scout entity that marks enemies it sees with EFlag.Spotted (ability-drone.ts).
//   dig_charge     — a buried proximity charge; arms, then blasts enemies in reach, never through walls (ability-charge.ts).
//   squeak_barrier — a wall both teams collide with; stops shots; has hp (ability-barrier.ts).
// ear_glide is `live: false` here on purpose: it lives in the shared movement (predicted), src/sim/systems/movement.ts.
// Abilities with `live: false` are ignored on activation (no event, no cooldown). A placement that is refused (no
// clear spot for a barrier, no ground for a charge, seated in a kart) spends no cooldown either.
// The ability entities themselves are updated by the ability-entity system (510, ability-entities.ts), which this
// system registers on first use; projectile direct hits on drones and barriers are taken here, before projectiles
// (500) move and bounce off them. All entities are cleared while combat is not live (warmup, match over, restart).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { pressed } from '../entity';
import { Btn } from '../../shared/input';
import { EFlag, EntityKind } from '../../shared/types';
import { viewDir } from '../../shared/math';
import { abilityDef, type AbilityDef } from '../../shared/content/abilities';
import { COMBAT_RULES, WEAPONS } from '../../shared/content/weapons';
import { pointCapsuleDistance, worldLineClear } from './geometry';
import { applyDamage, knockback } from './damage';
import { capsuleOf, combatLive, ensureCombat, eyeHeight, reportNoise, ticksOf } from './state';
import { abilityEntities, abilitySweep, clearAbilityEntities, damageAbilityEntity } from './ability-core';
import { ensureAbilityEntitySystem } from './ability-entities';
import { deployDrone } from './ability-drone';
import { plantCharge } from './ability-charge';
import { raiseBarrier } from './ability-barrier';

function barkBlast(sim: Sim, e: SimEntity, def: AbilityDef): void {
  const ex = e.pos.x, ey = e.pos.y + eyeHeight(e), ez = e.pos.z;
  const f = viewDir(e.yaw, Math.max(-0.35, Math.min(0.35, e.pitch)));
  const cosHalf = Math.cos(def.halfAngle);
  sim.emit({ e: 'ability', id: e.id, ability: def.id, x: ex, y: ey, z: ez });
  reportNoise(sim, e, def.noise);
  for (const t of sim.entities.values()) {
    if (!t.char || t.dead || t === e) continue;
    if (!COMBAT_RULES.friendlyFire && t.team === e.team) continue;
    const cap = capsuleOf(t);
    const d = pointCapsuleDistance(ex, ey, ez, t.pos.x, t.pos.y + cap.r, t.pos.z, cap.len, cap.r);
    if (d > def.range) continue;
    const cy = t.pos.y + cap.height * 0.5;
    const vx = t.pos.x - ex, vy = cy - ey, vz = t.pos.z - ez;
    const vl = Math.sqrt(vx * vx + vy * vy + vz * vz) || 1;
    const inCone = (vx * f.x + vy * f.y + vz * f.z) / vl >= cosHalf;
    // point-blank targets are caught as long as they are in front of the user
    const inFront = d < 1.2 && (vx * f.x + vz * f.z) > 0;
    if (!inCone && !inFront) continue;
    if (!worldLineClear(sim, ex, ey, ez, t.pos.x, cy, t.pos.z)) continue;
    const falloff = 1 - 0.4 * (d / def.range);
    applyDamage(sim, t, def.damage, { id: e.id, team: e.team, weapon: -1 }, t.pos.x, cy, t.pos.z, false);
    let kx = t.pos.x - e.pos.x, kz = t.pos.z - e.pos.z;
    const kl = Math.hypot(kx, kz);
    if (kl > 1e-3) { kx /= kl; kz /= kl; } else { kx = f.x; kz = f.z; }
    knockback(t, kx * def.knockback * falloff, def.knockUp * falloff, kz * def.knockback * falloff);
  }
}

function cloak(sim: Sim, e: SimEntity, def: AbilityDef): void {
  e.combat!.stealthUntil = sim.tick + ticksOf(def.duration);
  e.flags |= EFlag.Stealthed;
  sim.emit({ e: 'ability', id: e.id, ability: def.id, x: e.pos.x, y: e.pos.y, z: e.pos.z });
}

/** Run one activation; false when it was refused (no cooldown is spent). */
function activate(sim: Sim, e: SimEntity, def: AbilityDef): boolean {
  switch (def.kind) {
    case 'cone_blast': barkBlast(sim, e, def); return true;
    case 'cloak': cloak(sim, e, def); return true;
    case 'drone': deployDrone(sim, e, def); return true;
    case 'charge': return plantCharge(sim, e, def) !== null;
    case 'barrier': return raiseBarrier(sim, e, def) !== null;
    default: return false;
  }
}

/**
 * Projectiles about to hit a drone or barrier this tick (the same step the projectile system takes next) deal their
 * direct damage to it; the projectile system then bounces/explodes them off its collider, and a blast is taken by
 * the ability-entity system from the `explode` event.
 */
function projectileHits(sim: Sim, dt: number): void {
  const list = abilityEntities(sim);
  let targets = 0;
  for (const a of list) if (a.health && a.abx!.born < sim.tick) targets++;
  if (!targets) return;
  for (const p of sim.entities.values()) {
    if (p.kind !== EntityKind.Projectile || !p.proj || p.removed) continue;
    const pd = WEAPONS[p.proj.weapon]?.projectile;
    if (!pd) continue;
    const mx = p.vel.x * dt, my = (p.vel.y + pd.gravity * dt) * dt, mz = p.vel.z * dt;
    const len = Math.hypot(mx, my, mz);
    if (len < 1e-6) continue;
    let best = Infinity, hit: SimEntity | null = null;
    for (const a of list) {
      if (!a.health || a.removed || a.abx!.born >= sim.tick || a.abx!.team === p.proj.ownerTeam) continue;
      const t = abilitySweep(a, p.pos.x, p.pos.y, p.pos.z, mx / len, my / len, mz / len, len, pd.radius);
      if (t >= 0 && t < best) { best = t; hit = a; }
    }
    if (hit) {
      const k = best / len;
      damageAbilityEntity(sim, hit, WEAPONS[p.proj.weapon].damage * p.proj.dmgMult, p.proj.owner, p.proj.ownerTeam, p.pos.x + mx * k, p.pos.y + my * k, p.pos.z + mz * k);
    }
  }
}

export const abilitySystem: SimSystem = {
  name: 'abilities',
  order: 450,
  update(sim, dt) {
    ensureAbilityEntitySystem(sim);
    const live = combatLive(sim);
    if (!live && abilityEntities(sim).length) clearAbilityEntities(sim);
    for (const e of sim.entities.values()) {
      if (!e.char) continue;
      ensureCombat(e);
      const a = e.abil!;
      a.cooldown = Math.max(0, a.cooldown - dt);
      if (e.dead || !live || a.cooldown > 0 || !pressed(e, Btn.Ability)) continue;
      const def = abilityDef(a.id);
      if (!def || !def.live) continue;
      if (activate(sim, e, def)) a.cooldown = def.cooldown;
    }
    if (live) projectileHits(sim, dt);
  },
};
