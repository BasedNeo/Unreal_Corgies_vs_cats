// Upgrade Core buffs: timed, soft, match-scoped (MASTER_PLAN §0 — no permanent combat power).
// Effects go through the stats the other lanes already read, without touching their code:
//   moveSpeed        scales the entity's own `char.move` copy (walk/run/sprint); restored by assignment
//   maxHp            raises health.max and heals by the same amount (a shield); removed on expiry
//   fireRate         drains the combat lane's shot cooldown (wpn.cooldown) faster, before weapons (400)
//   abilityCooldown  drains the ability cooldown (abil.cooldown) faster, before abilities (450)
// Buffs end on expiry, on death, at match end and on match restart. One buff per core type: picking the
// same core again refreshes its timer.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { CORE_FLAGS, PICKUPS, type CoreId } from '../../shared/content/pickups';
import { BUFF_FLAGS } from '../../shared/types';
import { ticksOf, type ActiveBuff } from './state';

function apply(e: SimEntity, b: ActiveBuff): void {
  const fx = PICKUPS[b.id].buff;
  if (fx.maxHp && fx.maxHp !== 1 && e.health) {
    const bonus = Math.max(1, Math.round(e.health.max * (fx.maxHp - 1)));
    b.hpBonus = bonus;
    e.health.max += bonus;
    if (!e.dead) e.health.hp = Math.min(e.health.max, e.health.hp + bonus);
  }
  if (fx.moveSpeed && fx.moveSpeed !== 1 && e.char) {
    const m = e.char.move;
    b.move = { walkSpeed: m.walkSpeed, runSpeed: m.runSpeed, sprintSpeed: m.sprintSpeed };
    m.walkSpeed *= fx.moveSpeed; m.runSpeed *= fx.moveSpeed; m.sprintSpeed *= fx.moveSpeed;
  }
}

function restore(e: SimEntity, b: ActiveBuff): void {
  if (b.hpBonus && e.health) {
    e.health.max -= b.hpBonus;
    e.health.hp = Math.min(e.health.hp, e.health.max);
  }
  if (b.move && e.char) Object.assign(e.char.move, b.move);
  b.hpBonus = 0;
  b.move = null;
}

/** Mirror the running buffs into the snapshot flags (clients can't see `e.buffs`). */
function syncFlags(e: SimEntity): void {
  let f = e.flags & ~BUFF_FLAGS;
  for (const b of e.buffs ?? []) f |= CORE_FLAGS[b.id];
  e.flags = f;
}

/** Give a character a core's buff (or refresh its timer). */
export function grantBuff(sim: Sim, e: SimEntity, id: CoreId): ActiveBuff {
  const until = sim.tick + ticksOf(PICKUPS[id].duration);
  const list = (e.buffs ??= []);
  const cur = list.find((b) => b.id === id);
  if (cur) { cur.until = Math.max(cur.until, until); return cur; }
  const b: ActiveBuff = { id, until, hpBonus: 0, move: null };
  apply(e, b);
  list.push(b);
  syncFlags(e);
  return b;
}

/** Remove every buff, restoring the stats they changed (newest first, so restores unwind cleanly). */
export function clearBuffs(e: SimEntity): void {
  const list = e.buffs;
  if (!list || list.length === 0) return;
  for (let i = list.length - 1; i >= 0; i--) restore(e, list[i]);
  list.length = 0;
  syncFlags(e);
}

/** Temporarily undo buffs (kit swaps rebuild the base stats underneath them). */
export function suspendBuffs(e: SimEntity): void {
  const list = e.buffs;
  if (!list) return;
  for (let i = list.length - 1; i >= 0; i--) restore(e, list[i]);
}

/** Re-apply buffs after `suspendBuffs` against the (new) base stats. */
export function resumeBuffs(e: SimEntity): void {
  for (const b of e.buffs ?? []) apply(e, b);
}

/** Current multiplier of one effect for a character (1 when none). */
export function buffMultiplier(e: SimEntity, key: 'fireRate' | 'maxHp' | 'moveSpeed' | 'abilityCooldown'): number {
  let m = 1;
  for (const b of e.buffs ?? []) m *= PICKUPS[b.id].buff[key] ?? 1;
  return m;
}

/** Seconds left on a character's buff (0 = none). */
export function buffTimeLeft(sim: Sim, e: SimEntity, id: CoreId): number {
  const b = e.buffs?.find((x) => x.id === id);
  return b ? Math.max(0, (b.until - sim.tick) / ticksOf(1)) : 0;
}

/** Per tick (order 150, before combat): expiry, death cleanup, cooldown drains. */
export function stepBuffs(sim: Sim, dt: number): void {
  for (const e of sim.entities.values()) {
    const list = e.buffs;
    if (!list || list.length === 0) continue;
    if (e.dead) { clearBuffs(e); continue; }
    for (let i = list.length - 1; i >= 0; i--) {
      if (sim.tick < list[i].until) continue;
      restore(e, list[i]);
      list.splice(i, 1);
      syncFlags(e);
    }
    for (const b of list) {
      const fx = PICKUPS[b.id].buff;
      // Weapons (400) subtract dt from the shot cooldown; draining (rate - 1) × dt here first makes the
      // cooldown last 1/rate as long. Only positive cooldowns are touched, so the combat lane's
      // sub-tick carry (and its reset to 0 when not firing) behaves exactly as without the buff.
      if (fx.fireRate && fx.fireRate !== 1 && e.wpn && e.wpn.cooldown > 0) e.wpn.cooldown -= (fx.fireRate - 1) * dt;
      if (fx.abilityCooldown && fx.abilityCooldown !== 1 && e.abil && e.abil.cooldown > 0) {
        e.abil.cooldown = Math.max(0, e.abil.cooldown - (1 / fx.abilityCooldown - 1) * dt);
      }
    }
  }
}
