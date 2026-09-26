// Status upkeep (order 600) and respawn/regeneration (order 700).
//   600: corpse physics (dead bodies fall/slide on the kinematic controller, since movement skips
//        the dead), spawn-protection and cloak timers -> EFlag.Invulnerable / EFlag.Stealthed.
//   700: respawn players and room bots after COMBAT_RULES.respawnDelay at sim.pickSpawn(team) with full
//        hp + spawn protection; remove PvE wave enemies after their corpse time; slow health regen
//        after COMBAT_RULES.regenDelay seconds without damage.
import type { SimSystem, Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EFlag, type EntityId } from '../../shared/types';
import { GRAVITY } from '../../shared/constants';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { CHARACTER_MOVE_FILTER } from '../rapier';
import { respawnNow } from './damage';
import { combatBus, ensureCombat, respawnEnabled, ticksOf } from './state';

const KILL_TTL_TICKS = ticksOf(2);
const REGEN_DELAY_TICKS = ticksOf(COMBAT_RULES.regenDelay);

function stepCorpse(sim: Sim, e: SimEntity, dt: number): void {
  const meta = e.combat!;
  if (meta.corpseSettled || !e.collider || !e.char) return;
  const c = e.char;
  e.vel.y = Math.max(-40, e.vel.y + GRAVITY * c.move.fallGravityScale * dt);
  const hs = Math.hypot(e.vel.x, e.vel.z);
  if (hs > 0) {
    const drop = (c.grounded ? 14 : 1.5) * dt;
    const k = hs > drop ? (hs - drop) / hs : 0;
    e.vel.x *= k; e.vel.z *= k;
  }
  sim.kcc.computeColliderMovement(e.collider, { x: e.vel.x * dt, y: e.vel.y * dt, z: e.vel.z * dt }, undefined, CHARACTER_MOVE_FILTER);
  const mv = sim.kcc.computedMovement();
  c.grounded = sim.kcc.computedGrounded();
  const t = e.collider.translation();
  const nx = t.x + mv.x, ny = t.y + mv.y, nz = t.z + mv.z;
  e.collider.setTranslation({ x: nx, y: ny, z: nz });
  e.pos.x = nx; e.pos.y = ny - (c.move.capsuleHalfHeight + c.move.capsuleRadius); e.pos.z = nz;
  if (c.grounded) {
    if (e.vel.y < 0) e.vel.y = 0;
    if (Math.hypot(e.vel.x, e.vel.z) < 0.05) { e.vel.x = e.vel.z = 0; meta.corpseSettled = true; }
  }
}

export const statusSystem: SimSystem = {
  name: 'combat-status',
  order: 600,
  update(sim, dt) {
    const kills = combatBus(sim).kills;
    while (kills.length && sim.tick - kills[0].tick > KILL_TTL_TICKS) kills.shift();
    for (const e of sim.entities.values()) {
      if (!e.char) continue;
      ensureCombat(e);
      if (e.dead) { stepCorpse(sim, e, dt); continue; }
      const m = e.combat!;
      let f = e.flags & ~(EFlag.Invulnerable | EFlag.Stealthed | EFlag.Dead);
      if (sim.tick < m.invulnUntil) f |= EFlag.Invulnerable;
      if (sim.tick < m.stealthUntil) f |= EFlag.Stealthed;
      e.flags = f;
    }
  },
};

const toRemove: EntityId[] = [];

export const respawnSystem: SimSystem = {
  name: 'respawn-regen',
  order: 700,
  update(sim, dt) {
    toRemove.length = 0;
    for (const e of sim.entities.values()) {
      if (!e.char || !e.health) continue;
      ensureCombat(e);
      const m = e.combat!;
      if (e.dead) {
        if (m.pve) { if (m.removeTick > 0 && sim.tick >= m.removeTick) toRemove.push(e.id); }
        else if (e.respawnTick > 0 && sim.tick >= e.respawnTick && respawnEnabled(sim, e)) respawnNow(sim, e);
        continue;
      }
      const h = e.health;
      if (h.hp < h.max && sim.tick - h.lastDamageTick >= REGEN_DELAY_TICKS) {
        h.hp = Math.min(h.max, h.hp + h.max * COMBAT_RULES.regenPerSec * dt);
      }
    }
    for (const id of toRemove) sim.removeEntity(id);
    toRemove.length = 0;
  },
};
