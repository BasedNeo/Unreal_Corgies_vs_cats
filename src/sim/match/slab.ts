// slab (Wave 13 TW-SIM): the Godot game's mode on The Lot. Rules and the snapshot contract: SLAB in
// src/shared/content/modes.ts (the Godot sources engines/godot/game/match.gd, slab.gd, tuning.gd are the reference).
// This module owns the slab's Zone entity (who is on it: holder, contested), the one kit everybody carries (Assault,
// Squeaker Rifle, no class ability) and the spawn shield; the match flow (scoring, clock, overtime, end, rematch) is
// updateSlab in ./index.ts.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EFlag, EntityKind, Team, type EntityId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { SLAB, SLAB_ZONE_SEED, onSlab, type SlabConfig } from '../../shared/content/modes';
import { CLASSES, moveStatsFor } from '../../shared/content/classes';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { ensureCombat, equipWeapon, ticksOf } from '../combat/state';

/** The slab's state (plain data on the Zone entity: `e.slab`). */
export interface SlabZoneState {
  /** Team alone on the slab this tick, or -1 (empty or contested). */
  holder: TeamId | -1;
  contested: boolean;
  /** Alive pets of each team on the slab this tick. */
  counts: [number, number];
}

declare module '../entity' {
  interface SimEntity {
    slab?: SlabZoneState;
  }
}

/** Slab view for bots, tests and tools (a read-only copy). */
export interface SlabInfo { id: EntityId; x: number; y: number; z: number; holder: TeamId | -1; contested: boolean; counts: [number, number] }

/** SLAB with the test/soak overrides in sim.state.matchConfig.slab. */
export function slabConfig(sim: Sim): SlabConfig {
  const o = (sim.state.matchConfig as { slab?: Partial<SlabConfig> } | undefined)?.slab;
  return { ...SLAB, ...o };
}

function zoneOf(sim: Sim): SimEntity | undefined {
  const id = sim.state.slabZone as EntityId | undefined;
  const e = id !== undefined ? sim.entities.get(id) : undefined;
  return e?.slab ? e : undefined;
}

/** The slab of a running slab match (null in other modes, or before the first tick). */
export function slabZone(sim: Sim): SlabInfo | null {
  const e = zoneOf(sim);
  if (!e?.slab) return null;
  const s = e.slab;
  return { id: e.id, x: e.pos.x, y: e.pos.y, z: e.pos.z, holder: s.holder, contested: s.contested, counts: [s.counts[0], s.counts[1]] };
}

function writeZone(e: SimEntity): void {
  const s = e.slab!;
  e.team = s.holder === -1 ? Team.Neutral : s.holder;
  e.flags = s.contested ? EFlag.Busy : 0;
}

/** Create the slab's Zone entity (idempotent: an existing one is moved to the config's centre and reset to neutral). */
export function setupSlab(sim: Sim, cfg: SlabConfig = slabConfig(sim)): EntityId {
  const have = zoneOf(sim);
  if (have) {
    have.pos.x = cfg.center.x; have.pos.y = cfg.center.y; have.pos.z = cfg.center.z;
    resetSlab(sim);
    return have.id;
  }
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: EntityKind.Zone, team: Team.Neutral, species: 0, cls: null, seed: SLAB_ZONE_SEED, name: 'slab',
    pos: { x: cfg.center.x, y: cfg.center.y, z: cfg.center.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null, health: null,
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
    slab: { holder: -1, contested: false, counts: [0, 0] },
  };
  sim.entities.set(id, e);
  sim.state.slabZone = id;
  return id;
}

/** The slab back to neutral (match restart). */
export function resetSlab(sim: Sim): void {
  const e = zoneOf(sim);
  if (!e?.slab) return;
  Object.assign(e.slab, { holder: -1, contested: false, counts: [0, 0] });
  writeZone(e);
}

/** Who is on the slab now (Godot slab.gd evaluate): alive pets of each team whose feet are on it. Writes the Zone. */
export function evaluateSlab(sim: Sim, cfg: SlabConfig = slabConfig(sim)): SlabZoneState {
  const e = zoneOf(sim);
  const counts: [number, number] = [0, 0];
  for (const c of sim.entities.values()) {
    if (!c.char || c.dead || (c.team !== Team.Corgis && c.team !== Team.Cats)) continue;
    if (onSlab(c.pos.x, c.pos.y, c.pos.z, cfg)) counts[c.team]++;
  }
  const holder: TeamId | -1 = counts[0] > 0 && counts[1] === 0 ? Team.Corgis : counts[1] > 0 && counts[0] === 0 ? Team.Cats : -1;
  const st: SlabZoneState = { holder, contested: counts[0] > 0 && counts[1] > 0, counts };
  if (e?.slab) { Object.assign(e.slab, st); writeZone(e); }
  return st;
}

// ------------------------------------------------------------------ the one kit

/** Does this character carry the slab kit (the class, its hp, the one weapon, no class ability)? */
export function hasSlabKit(e: SimEntity, cfg: SlabConfig = SLAB): boolean {
  return e.cls === cfg.cls && e.wpn?.id === cfg.weapon && e.abil?.id === '' && e.health?.max === CLASSES[cfg.cls].maxHp;
}

/**
 * Re-kit a character for the slab: the Assault class (its move stats and max hp, keeping the hp fraction), the Squeaker
 * Rifle as its only weapon (a fresh magazine when it had another) and no class ability. Returns true when it changed.
 */
export function applySlabKit(e: SimEntity, cfg: SlabConfig = SLAB): boolean {
  if (!e.char || !e.health) return false;
  ensureCombat(e);
  if (hasSlabKit(e, cfg)) return false;
  const h = e.health;
  const frac = h.max > 0 ? h.hp / h.max : 1;
  const def = CLASSES[cfg.cls];
  if (e.cls !== cfg.cls) {
    const old = e.char.move;
    const move = moveStatsFor(e.species, cfg.cls);
    move.capsuleRadius = old.capsuleRadius; // the capsule belongs to the species: keep the live collider's
    move.capsuleHalfHeight = old.capsuleHalfHeight;
    e.char.move = move;
    e.cls = cfg.cls;
  }
  h.max = def.maxHp;
  h.hp = e.dead ? 0 : Math.max(1, Math.min(h.max, Math.round(frac * h.max)));
  if (e.wpn?.id !== cfg.weapon) { equipWeapon(e, cfg.weapon); e.flags &= ~EFlag.Reloading; }
  e.abil = { id: '', cooldown: 0 };
  return true;
}

function isSlabMode(sim: Sim): boolean {
  return (sim.state.room as { mode?: string } | undefined)?.mode === 'slab';
}

/**
 * Order 90 (before the AI at 100 and every combat system): in a slab room every character carries the slab kit, also one
 * the Room spawned or re-kitted between ticks (a joiner's class, a class change), before anything can use another kit.
 */
export const slabKitSystem: SimSystem = {
  name: 'slab-kit',
  order: 90,
  update(sim) {
    if (!isSlabMode(sim)) return;
    const cfg = slabConfig(sim);
    for (const e of sim.entities.values()) if (e.char) applySlabKit(e, cfg);
  },
};

// ------------------------------------------------------------------ respawn and spawn shield

/** A downed pet comes back `cfg.respawn` s after it went down (the default respawn path, at its team spawn). */
export function slabRespawnDelay(sim: Sim, kills: ReadonlyArray<{ victim: EntityId; tick: number }>, cfg: SlabConfig): void {
  for (const k of kills) {
    const v = sim.entities.get(k.victim);
    if (v?.char && v.dead && !v.combat?.pve && v.respawnTick > 0) v.respawnTick = k.tick + ticksOf(cfg.respawn);
  }
}

/**
 * The spawn shield: a character (re)spawned with protection this tick (respawnNow grants COMBAT_RULES.spawnInvulnerable)
 * is shielded for the `cfg.spawnShield` s after its spawn tick instead. Runs after every respawn of the tick (order 800).
 * As in Godot, firing does not end it in this mode (weapon-system.ts fireEndsShield).
 */
export function slabSpawnShields(sim: Sim, cfg: SlabConfig): void {
  const fresh = sim.tick + ticksOf(COMBAT_RULES.spawnInvulnerable);
  const want = sim.tick + 1 + ticksOf(cfg.spawnShield);
  for (const e of sim.entities.values()) {
    const m = e.combat;
    if (!e.char || e.dead || !m || m.invulnUntil !== fresh || e.data.slabShield === m.invulnUntil) continue;
    m.invulnUntil = want;
    e.data.slabShield = want; // (a later tick whose `fresh` happens to equal `want` must not extend it again)
    if (want > sim.tick) e.flags |= EFlag.Invulnerable; else e.flags &= ~EFlag.Invulnerable;
  }
}
