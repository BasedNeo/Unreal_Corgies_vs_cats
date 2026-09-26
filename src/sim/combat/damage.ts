// Health, damage, death and respawn — the only code that changes hp or the dead state.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EFlag, EntityKind, type EntityId, type TeamId } from '../../shared/types';
import { COMBAT_RULES, WEAPONS } from '../../shared/content/weapons';
import { combatBus, combatLive, ensureCombat, isInvulnerable, ticksOf } from './state';

const DEATH_CLEAR = EFlag.Firing | EFlag.Reloading | EFlag.Aiming | EFlag.Sprinting | EFlag.Stealthed | EFlag.Invulnerable | EFlag.Alerted;

export interface DamageSource {
  /** Entity credited with the damage (may already be removed). */
  id: EntityId;
  team: TeamId;
  /** Weapon index for kill feeds (-1 = ability / environment). */
  weapon: number;
}

/**
 * Apply damage to a character. Returns the damage actually dealt (0 when blocked by friendly fire,
 * spawn protection, a non-live match phase, or a dead target). Emits `hit`, and `death` on a kill.
 */
export function applyDamage(sim: Sim, dst: SimEntity, amount: number, src: DamageSource, x: number, y: number, z: number, crit: boolean): number {
  const h = dst.health;
  if (!h || dst.dead || amount <= 0 || !combatLive(sim)) return 0;
  const self = src.id === dst.id;
  if (!self && !COMBAT_RULES.friendlyFire && src.team === dst.team) return 0;
  if (isInvulnerable(sim, dst)) return 0;
  if (!self && dst.kind === EntityKind.Player) {
    const attacker = sim.entities.get(src.id);
    if (attacker && (attacker.kind === EntityKind.Bot || attacker.kind === EntityKind.Boss)) {
      const mode = (sim.state.room as { mode?: string } | undefined)?.mode ?? '';
      amount *= COMBAT_RULES.botToPlayerDamage[mode] ?? 1;
    }
  }
  const dmg = Math.min(h.hp, Math.max(1, Math.round(amount)));
  h.hp -= dmg;
  h.lastDamageTick = sim.tick;
  if (!self) h.lastAttacker = src.id;
  sim.emit({ e: 'hit', src: src.id, dst: dst.id, dmg, x, y, z, crit });
  if (h.hp <= 0) kill(sim, dst, src);
  return dmg;
}

/** Kill a character now (hp -> 0). Credits the source, or the last attacker within 5 s on a self-kill. */
export function kill(sim: Sim, e: SimEntity, src: DamageSource): void {
  if (e.dead) return;
  ensureCombat(e);
  const h = e.health;
  if (h) h.hp = 0;
  e.dead = true;
  e.anim = Anim.Dead;
  e.flags = (e.flags & ~DEATH_CLEAR) | EFlag.Dead;
  let killer = src.id;
  let killerTeam: TeamId | -1 = src.team;
  if (src.id === e.id && h && h.lastAttacker >= 0 && sim.tick - h.lastDamageTick <= ticksOf(5)) {
    const la = sim.entities.get(h.lastAttacker);
    if (la) { killer = la.id; killerTeam = la.team; }
  }
  if (killer === e.id) killerTeam = -1;
  const meta = e.combat!;
  meta.diedTick = sim.tick;
  meta.corpseSettled = false;
  meta.stealthUntil = 0;
  meta.invulnUntil = 0;
  if (e.wpn) { e.wpn.charge = 0; e.wpn.charging = false; e.wpn.reload = 0; }
  if (meta.pve) { meta.removeTick = sim.tick + ticksOf(COMBAT_RULES.pveCorpseTime); e.respawnTick = 0; }
  else e.respawnTick = sim.tick + ticksOf(COMBAT_RULES.respawnDelay);
  sim.emit({ e: 'death', id: e.id, by: killer });
  combatBus(sim).kills.push({ victim: e.id, killer, victimTeam: e.team, killerTeam, tick: sim.tick, weapon: src.weapon });
}

/**
 * Bring a character back at a spawn point (or the given position) with full health, a full
 * magazine and brief spawn protection. Used by the respawn system and by match restarts/waves.
 */
export function respawnNow(sim: Sim, e: SimEntity, at?: { x: number; y: number; z: number; yaw: number }, protect = true): void {
  ensureCombat(e);
  const s = at ?? sim.pickSpawn(e.team);
  sim.placeCharacter(e, s.x, s.y, s.z);
  e.yaw = s.yaw; e.pitch = 0;
  e.input = { ...e.input, yaw: s.yaw, pitch: 0, mx: 0, mz: 0, buttons: 0 };
  e.prevButtons = 0;
  if (e.health) { e.health.hp = e.health.max; e.health.lastDamageTick = -9999; e.health.lastAttacker = -1; }
  e.dead = false;
  e.respawnTick = 0;
  e.anim = Anim.Idle;
  e.flags &= ~(DEATH_CLEAR | EFlag.Dead);
  const c = e.char;
  if (c) { c.grounded = false; c.airTime = 0; c.jumpBuffer = 0; c.crouchBuffer = 0; c.jumpsUsed = 0; c.jumpHeld = false; c.sprinting = false; }
  const meta = e.combat!;
  meta.stealthUntil = 0;
  meta.corpseSettled = false;
  meta.invulnUntil = protect ? sim.tick + ticksOf(COMBAT_RULES.spawnInvulnerable) : 0;
  if (protect) e.flags |= EFlag.Invulnerable;
  const w = e.wpn!;
  w.reload = 0; w.charge = 0; w.charging = false; w.bloom = 0; w.buffer = 0; w.cooldown = 0;
  w.ammo = WEAPONS[w.id].magSize;
  e.ammo = w.ammo;
  sim.emit({ e: 'spawn', id: e.id }); // clients snap camera/interpolation on this (respawn or match restart)
}

/** Add a knockback velocity (m/s) to a living character. Movement bleeds it off naturally. */
export function knockback(e: SimEntity, vx: number, vy: number, vz: number): void {
  if (e.dead || !e.char) return;
  e.vel.x += vx; e.vel.z += vz;
  if (vy > 0) { e.vel.y = Math.max(e.vel.y, 0) + vy; e.char.grounded = false; }
}
