// Combat components (module augmentation on SimEntity) and the small plain-data channels combat
// shares with AI and match rules through sim.state. No Three.js, no DOM, no Math.random().
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind, type EntityId, type TeamId } from '../../shared/types';
import { CLASSES } from '../../shared/content/classes';
import { TICK_HZ } from '../../shared/constants';
import { WEAPONS, COMBAT_RULES, weaponIndex, type WeaponId } from '../../shared/content/weapons';

export interface WeaponState {
  id: WeaponId;
  /** Index into WEAPON_IDS (mirrored to e.weapon for snapshots). */
  index: number;
  ammo: number;
  /** Seconds until the next shot is allowed (may dip slightly below 0 to keep exact fire rates). */
  cooldown: number;
  /** Seconds left in the current reload (0 = not reloading). */
  reload: number;
  /** Accumulated recoil bloom (radians). */
  bloom: number;
  /** Charge 0..1 for charge weapons. */
  charge: number;
  charging: boolean;
  /** Buffered semi-auto trigger press (seconds left). */
  buffer: number;
  lastShotTick: number;
  shots: number;
}

export interface AbilityState {
  id: string;
  /** Seconds until the ability can be used again. */
  cooldown: number;
}

export interface CombatMeta {
  /** Tick until which the entity ignores damage (spawn protection). */
  invulnUntil: number;
  /** Tick until which the entity is cloaked (EFlag.Stealthed). */
  stealthUntil: number;
  /** PvE wave enemy: never respawns, removed pveCorpseTime after death. */
  pve: boolean;
  /** Tick at which a dead PvE entity is removed. */
  removeTick: number;
  /** Tick of the last death (for corpse physics / telemetry). */
  diedTick: number;
  corpseSettled: boolean;
}

export interface ProjectileState {
  owner: EntityId;
  ownerTeam: TeamId;
  weapon: WeaponId;
  age: number;
  bounces: number;
  dmgMult: number;
}

/** Per-entity ring buffer of feet positions for lag-compensated hitscan. */
export interface LagHistory {
  ticks: Int32Array;
  xyz: Float32Array;
  alive: Uint8Array;
}

declare module '../entity' {
  interface SimEntity {
    wpn?: WeaponState;
    abil?: AbilityState;
    combat?: CombatMeta;
    proj?: ProjectileState;
    lag?: LagHistory;
  }
}

export interface KillRecord { victim: EntityId; killer: EntityId; victimTeam: TeamId; killerTeam: TeamId | -1; tick: number; weapon: number }
export interface NoiseRecord { x: number; y: number; z: number; radius: number; team: TeamId; src: EntityId; tick: number }

/** Plain-data channel written by combat, read by AI (noise) and match rules (kills). */
export interface CombatBus { kills: KillRecord[]; noise: NoiseRecord[] }

/** Written by the match system each tick; read by combat. Defaults apply when no mode runs. */
export interface MatchRules {
  /** Weapons/abilities/damage enabled (false during warmup and the ended phase). */
  combatLive: boolean;
  /** Per team (Corgis, Cats, Neutral): dead bots respawn automatically. Human players always respawn. */
  respawn: [boolean, boolean, boolean];
}

export function combatBus(sim: Sim): CombatBus {
  let b = sim.state.combat as CombatBus | undefined;
  if (!b) { b = { kills: [], noise: [] }; sim.state.combat = b; }
  return b;
}

export function matchRules(sim: Sim): MatchRules | undefined {
  return sim.state.rules as MatchRules | undefined;
}

export function combatLive(sim: Sim): boolean {
  return matchRules(sim)?.combatLive ?? true;
}

export function respawnEnabled(sim: Sim, e: SimEntity): boolean {
  return e.kind !== EntityKind.Bot || (matchRules(sim)?.respawn[e.team] ?? true);
}

export const ticksOf = (seconds: number) => Math.round(seconds * TICK_HZ);

export function reportNoise(sim: Sim, e: SimEntity, radius: number): void {
  if (radius <= 0) return;
  const n = combatBus(sim).noise;
  if (n.length > 64) n.shift();
  n.push({ x: e.pos.x, y: e.pos.y, z: e.pos.z, radius, team: e.team, src: e.id, tick: sim.tick });
}

export function reportNoiseAt(sim: Sim, x: number, y: number, z: number, radius: number, team: TeamId, src: EntityId): void {
  const n = combatBus(sim).noise;
  if (n.length > 64) n.shift();
  n.push({ x, y, z, radius, team, src, tick: sim.tick });
}

export function equipWeapon(e: SimEntity, id: WeaponId): void {
  const def = WEAPONS[id];
  e.wpn = { id, index: weaponIndex(id), ammo: def.magSize, cooldown: 0, reload: 0, bloom: 0, charge: 0, charging: false, buffer: 0, lastShotTick: -9999, shots: 0 };
  e.weapon = e.wpn.index;
  e.ammo = e.wpn.ammo;
}

/** Lazily attach combat components to a character (spawned by the Room, a test or a wave). */
export function ensureCombat(e: SimEntity): void {
  if (!e.char) return;
  if (!e.wpn) {
    const primary = e.cls ? CLASSES[e.cls].primary : 'squeaker_rifle';
    equipWeapon(e, (primary in WEAPONS ? primary : 'squeaker_rifle') as WeaponId);
  }
  if (!e.abil) e.abil = { id: e.cls ? CLASSES[e.cls].ability : '', cooldown: 0 };
  if (!e.combat) e.combat = { invulnUntil: 0, stealthUntil: 0, pve: false, removeTick: 0, diedTick: -9999, corpseSettled: false };
}

/** Capsule geometry of a character: radius, cylinder length (bottom→top sphere centers), total height. */
export function capsuleOf(e: SimEntity): { r: number; len: number; height: number } {
  const m = e.char!.move;
  return { r: m.capsuleRadius, len: 2 * m.capsuleHalfHeight, height: 2 * (m.capsuleHalfHeight + m.capsuleRadius) };
}

export function characterHeight(e: SimEntity): number {
  const m = e.char!.move;
  return 2 * (m.capsuleHalfHeight + m.capsuleRadius);
}

/** Eye height above the feet (corgi ≈ 1.05 m, cat ≈ 1.10 m). */
export function eyeHeight(e: SimEntity): number {
  return characterHeight(e) * COMBAT_RULES.eyeFraction;
}

export function isInvulnerable(sim: Sim, e: SimEntity): boolean {
  return !!e.combat && sim.tick < e.combat.invulnUntil;
}

export function isStealthed(sim: Sim, e: SimEntity): boolean {
  return !!e.combat && sim.tick < e.combat.stealthUntil;
}
