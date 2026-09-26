// Ability system (order 450). Runs the abilities whose data is marked `live`:
//   bark_blast   — cone shockwave in front of the user: small damage + knockback (LOS-checked).
//   shadow_cloak — EFlag.Stealthed for `duration`; firing breaks it; AI only sees the user within revealRange.
// Abilities with `live: false` are ignored on activation (no event, no cooldown).
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { pressed } from '../entity';
import { Btn } from '../../shared/input';
import { EFlag } from '../../shared/types';
import { viewDir } from '../../shared/math';
import { abilityDef, type AbilityDef } from '../../shared/content/abilities';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { pointCapsuleDistance, worldLineClear } from './geometry';
import { applyDamage, knockback } from './damage';
import { capsuleOf, combatLive, ensureCombat, eyeHeight, reportNoise, ticksOf } from './state';

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

export const abilitySystem: SimSystem = {
  name: 'abilities',
  order: 450,
  update(sim, dt) {
    const live = combatLive(sim);
    for (const e of sim.entities.values()) {
      if (!e.char) continue;
      ensureCombat(e);
      const a = e.abil!;
      a.cooldown = Math.max(0, a.cooldown - dt);
      if (e.dead || !live || a.cooldown > 0 || !pressed(e, Btn.Ability)) continue;
      const def = abilityDef(a.id);
      if (!def || !def.live) continue;
      if (def.kind === 'cone_blast') barkBlast(sim, e, def);
      else if (def.kind === 'cloak') cloak(sim, e, def);
      else continue;
      a.cooldown = def.cooldown;
    }
  },
};
