// slab (Wave 13 TW-SIM): the Godot game's mode on The Lot. Rules and the snapshot contract: SLAB in
// src/shared/content/modes.ts (the Godot sources engines/godot/game/match.gd, slab.gd, tuning.gd are the reference).
// This module owns the slab's Zone entity (who is on it: holder, contested), the one kit everybody carries (Assault,
// Squeaker Rifle, no class ability), the start and respawn slots (W14: equal sprint time to the slab for both teams) and
// the spawn shield; the match flow (scoring, clock, overtime, end, rematch) is updateSlab in ./index.ts.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EFlag, EntityKind, Species, Team, type EntityId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { SLAB, SLAB_ZONE_SEED, onSlab, type SlabConfig } from '../../shared/content/modes';
import { CLASSES, moveStatsFor } from '../../shared/content/classes';
import { COMBAT_RULES } from '../../shared/content/weapons';
import { ensureCombat, equipWeapon, ticksOf } from '../combat/state';
import type { SpawnPoint } from '../../shared/world/world-types';

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

/** SLAB with the test/soak overrides in sim.state.matchConfig.slab (a layout without `state`: SLAB as is). */
export function slabConfig(sim: { readonly state?: Record<string, unknown> }): SlabConfig {
  const o = (sim.state?.matchConfig as { slab?: Partial<SlabConfig> } | undefined)?.slab;
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

// ------------------------------------------------------------------ start slots and respawn points (W14, W15)
// Godot match.gd start_slots() / _sprint_time(): both teams start at equal straight-line SPRINT TIME to the slab, not at
// equal distance (the Corgis sprint 9.6 m/s, the Cats 8.8: classes.ts, copied by tuning.gd). The Corgis' slots run from
// their farthest spawn (slot 0) to the nearest; the Cats' slot k is the unused cat spawn whose sprint time is closest to
// the Corgis' slot k (on The Lot this rule alone would match slots 0-5 within 0.22 s; the Cats' first two are data
// there since W15, below). A pet takes its slot at the match start (and a restart), facing the slab.
// Respawns (Godot match.gd _pick_respawn_slots() / best_spawn(), lane G-MOVE): every respawn point of every team lies
// within RESPAWN_BAND (0.3 s) of sprint time below the Corgis' slot 0 (t0). The Corgis' points are slot 0 and points
// RESPAWN_STEP (1.3 m) apart from it on its straight line to the slab while they stay in the band (14.95, 14.81,
// 14.68 s); the Cats' are their spawns inside the band, else the one nearest its middle (on The Lot: data, W15). A respawn
// takes the team's point no living teammate stands on (within 1.2 m) that is farthest from the nearest living enemy.
// W15 (Godot CAT_SLOTS, lane G-BOT, docs/qa/w15/bot-route.md): on The Lot the Cats' first start slots and all their
// respawn points are data instead, matched on measured lone-bot trips (+ CAT_OFFSET 0.6 s), every one on the row
// z = 117: start (56, 117) then (62, 117); respawn (56, 117), (62, 117), (68, 117). Each entry names its spawn's index in
// the Cats' spawn list (the_lot.json spawns["1"], the sim's order) and its x, z; when a spawn is missing or off by more
// than 0.01 m (another map) the W14 rule above picks them. The Corgis' slots and points are unchanged.

/**
 * What the slot rules read: the map's spawns and ground height, and optionally the sim's state (matchConfig overrides).
 * A Sim is one; so is a client-side layout, without a cast.
 */
export interface SlabLayout {
  readonly worldData: { readonly spawns: readonly SpawnPoint[]; height(x: number, z: number): number };
  readonly state?: Record<string, unknown>;
}

/** One Cat data slot (Godot CAT_SLOTS): its index in the Cats' spawns, the spawn's x, z (the guard) and its measured trip (s). */
export interface SlabCatSlot { readonly i: number; readonly x: number; readonly z: number; readonly trip: number }

/** Godot match.gd CAT_SLOTS (W15), verbatim. */
export const SLAB_CAT_SLOTS: { readonly start: readonly SlabCatSlot[]; readonly respawn: readonly SlabCatSlot[] } = {
  start: [{ i: 2, x: 56, z: 117, trip: 15.64 }, { i: 6, x: 62, z: 117, trip: 15.56 }],
  respawn: [{ i: 2, x: 56, z: 117, trip: 15.64 }, { i: 6, x: 62, z: 117, trip: 15.56 }, { i: 10, x: 68, z: 117, trip: 15.61 }],
};
/** Godot CAT_OFFSET (s: the Cats' measured trip over the Corgis', per slot) and CORGI_TRIPS (s), the data's reference. */
export const SLAB_CAT_OFFSET = 0.6;
export const SLAB_CORGI_TRIPS: { readonly start: readonly number[]; readonly respawn: readonly number[] } = {
  start: [15.07, 14.82],
  respawn: [15.07, 15.01, 14.88],
};

/** The Cats' data slots of `kind` (Godot _cat_slots), or [] when the spawns are not The Lot's (then the W14 rule picks). */
export function slabCatSlots(sim: SlabLayout, kind: 'start' | 'respawn'): SpawnPoint[] {
  const cats = sim.worldData.spawns.filter((s) => s.team === Team.Cats);
  const out: SpawnPoint[] = [];
  for (const e of SLAB_CAT_SLOTS[kind]) {
    const sp = cats[e.i];
    if (!sp || Math.abs(sp.x - e.x) > 0.01 || Math.abs(sp.z - e.z) > 0.01) return [];
    out.push(sp);
  }
  return out;
}

/** A start / respawn slot: the spawn point, the facing toward the slab centre, and its straight-line sprint time (s). */
export interface SlabSlot { x: number; y: number; z: number; yaw: number; time: number }

/** Straight-line sprint time (s) from (x, z) to the slab centre for a pet of `team` (team = species in this mode). */
export function slabSprintTime(x: number, z: number, team: TeamId, cfg: SlabConfig = SLAB): number {
  const sprint = moveStatsFor(team === Team.Cats ? Species.Cat : Species.Corgi, cfg.cls).sprintSpeed;
  return Math.hypot(x - cfg.center.x, z - cfg.center.z) / sprint;
}

function slotAt(x: number, y: number, z: number, team: TeamId, cfg: SlabConfig): SlabSlot {
  return { x, y, z, yaw: Math.atan2(-(cfg.center.x - x), -(cfg.center.z - z)), time: slabSprintTime(x, z, team, cfg) };
}

/**
 * A team's slots in order (Godot start_slots): the Corgis' farthest first; each Cat slot matched to the Corgi slot's
 * time, with The Lot's data slots (slabCatSlots 'start') first.
 */
export function slabSlots(sim: SlabLayout, team: TeamId, cfg: SlabConfig = slabConfig(sim)): SlabSlot[] {
  const own = (t: TeamId) => sim.worldData.spawns.filter((s) => s.team === t);
  const time = (s: { x: number; z: number }, t: TeamId) => slabSprintTime(s.x, s.z, t, cfg);
  const ref = own(Team.Corgis).sort((a, b) => time(b, Team.Corgis) - time(a, Team.Corgis));
  if (team === Team.Corgis) return ref.map((s) => slotAt(s.x, s.y, s.z, team, cfg));
  const left = own(team);
  const out: typeof left = [];
  for (const r of ref) {
    if (!left.length) break;
    const want = time(r, Team.Corgis);
    let best = 0;
    for (let i = 1; i < left.length; i++) if (Math.abs(time(left[i], team) - want) < Math.abs(time(left[best], team) - want)) best = i;
    out.push(left[best]);
    left.splice(best, 1);
  }
  out.push(...left);
  const fixed = team === Team.Cats ? slabCatSlots(sim, 'start') : [];
  const order = fixed.length ? [...fixed, ...out.filter((p) => !fixed.includes(p))] : out;
  return order.map((s) => slotAt(s.x, s.y, s.z, team, cfg));
}

/** Godot RESPAWN_BAND (s) and RESPAWN_STEP (m). */
export const SLAB_RESPAWN_BAND = 0.3;
const RESPAWN_STEP = 1.3;

/** A team's respawn points (Godot _pick_respawn_slots), in Godot's order; on The Lot the Cats' are its data slots. */
export function slabRespawnPoints(sim: SlabLayout, team: TeamId, cfg: SlabConfig = slabConfig(sim)): SlabSlot[] {
  const s0 = slabSlots(sim, Team.Corgis, cfg)[0];
  if (!s0) return [];
  const t0 = s0.time;
  if (team === Team.Corgis) {
    const len = Math.hypot(cfg.center.x - s0.x, cfg.center.z - s0.z) || 1;
    const dx = (cfg.center.x - s0.x) / len, dz = (cfg.center.z - s0.z) / len;
    const lift = s0.y - sim.worldData.height(s0.x, s0.z); // the data's spawns stand a little over the ground
    const out = [s0];
    for (let k = 1; k < 8; k++) {
      const x = s0.x + dx * RESPAWN_STEP * k, z = s0.z + dz * RESPAWN_STEP * k;
      if (slabSprintTime(x, z, team, cfg) < t0 - SLAB_RESPAWN_BAND) break;
      out.push(slotAt(x, sim.worldData.height(x, z) + lift, z, team, cfg));
    }
    return out;
  }
  const fixed = team === Team.Cats ? slabCatSlots(sim, 'respawn') : [];
  if (fixed.length) return fixed.map((s) => slotAt(s.x, s.y, s.z, team, cfg));
  const own = sim.worldData.spawns.filter((s) => s.team === team);
  if (!own.length) return [];
  const mid = t0 - SLAB_RESPAWN_BAND * 0.5;
  const inside: SlabSlot[] = [];
  let nearest = own[0];
  for (const s of own) {
    const st = slabSprintTime(s.x, s.z, team, cfg);
    if (st <= t0 + 1e-4 && st >= t0 - SLAB_RESPAWN_BAND - 1e-4) inside.push(slotAt(s.x, s.y, s.z, team, cfg));
    if (Math.abs(st - mid) < Math.abs(slabSprintTime(nearest.x, nearest.z, team, cfg) - mid)) nearest = s;
  }
  return inside.length ? inside : [slotAt(nearest.x, nearest.y, nearest.z, team, cfg)];
}

/**
 * Where `e` respawns (Godot best_spawn): of its team's respawn points, one no living teammate stands on (within 1.2 m),
 * and of those the one farthest from the nearest living enemy; first in order on a tie. `skip`: characters that count as
 * still down (respawned this tick but not placed yet).
 */
export function slabRespawnPoint(sim: Sim, e: SimEntity, cfg: SlabConfig = slabConfig(sim), skip?: ReadonlySet<SimEntity>): SlabSlot | null {
  if (e.team !== Team.Corgis && e.team !== Team.Cats) return null;
  const pts = slabRespawnPoints(sim, e.team, cfg);
  let best: SlabSlot | null = null, bestScore = -Infinity;
  for (const p of pts) {
    let d = 1e6, taken = false;
    for (const o of sim.entities.values()) {
      if (o === e || !o.char || o.dead || skip?.has(o) || (o.team !== Team.Corgis && o.team !== Team.Cats)) continue;
      const dist = Math.hypot(p.x - o.pos.x, p.y - o.pos.y, p.z - o.pos.z);
      if (o.team === e.team) taken ||= dist < 1.2;
      else d = Math.min(d, dist);
    }
    const score = d - (taken ? 1e7 : 0);
    if (score > bestScore) { bestScore = score; best = p; }
  }
  return best;
}

/** Match start: each team's pets take slots 0, 1, … in Godot's pet order (humans first: slot 0 is the player's; then by id). */
export function assignSlabSlots(sim: Sim): void {
  for (const team of [Team.Corgis, Team.Cats] as const) {
    const pets: SimEntity[] = [];
    for (const e of sim.entities.values()) if (e.char && e.team === team) pets.push(e);
    pets.sort((a, b) => Number(b.kind === EntityKind.Player) - Number(a.kind === EntityKind.Player) || a.id - b.id);
    pets.forEach((e, k) => { e.data.slabSlot = k; });
  }
}

/** A pet's start slot (one without takes the lowest slot no teammate holds); null without team spawns. */
export function slabSlotOf(sim: Sim, e: SimEntity, cfg: SlabConfig = slabConfig(sim)): SlabSlot | null {
  if (e.team !== Team.Corgis && e.team !== Team.Cats) return null;
  const list = slabSlots(sim, e.team, cfg);
  if (!list.length) return null;
  let k = typeof e.data.slabSlot === 'number' ? e.data.slabSlot : -1;
  if (k < 0) {
    const used = new Set<unknown>();
    for (const o of sim.entities.values()) if (o !== e && o.char && o.team === e.team) used.add(o.data.slabSlot);
    k = 0;
    while (used.has(k)) k++;
    e.data.slabSlot = k;
  }
  const s = list[k % list.length];
  return slotAt(s.x + 1.2 * Math.floor(k / list.length), s.y, s.z, e.team, cfg);
}

/**
 * Every (re)spawn of the tick, after them all (order 800): a character spawned with protection this tick (respawnNow
 * grants COMBAT_RULES.spawnInvulnerable) stands facing the slab on its start slot (`start`: the match start or a
 * restart) or on its respawn point (the respawn system), shielded for the `cfg.spawnShield` s after its spawn tick. As
 * in Godot, firing does not end that shield in this mode (weapon-system.ts fireEndsShield).
 */
export function slabRespawns(sim: Sim, cfg: SlabConfig, start = false): void {
  const fresh = sim.tick + ticksOf(COMBAT_RULES.spawnInvulnerable);
  const want = sim.tick + 1 + ticksOf(cfg.spawnShield);
  const todo = new Set<SimEntity>();
  for (const e of sim.entities.values()) {
    const m = e.combat;
    if (e.char && !e.dead && m && m.invulnUntil === fresh && e.data.slabShield !== m.invulnUntil) todo.add(e);
  }
  for (const e of [...todo]) {
    todo.delete(e); // placed in turn: the ones still waiting count as down (Godot respawns them one by one)
    const m = e.combat!;
    const s = start ? slabSlotOf(sim, e, cfg) : slabRespawnPoint(sim, e, cfg, todo);
    if (s) {
      sim.placeCharacter(e, s.x, s.y, s.z);
      e.yaw = s.yaw; e.pitch = 0;
      e.input = { ...e.input, yaw: s.yaw, pitch: 0 };
    }
    m.invulnUntil = want;
    e.data.slabShield = want; // (a later tick whose `fresh` happens to equal `want` must not extend it again)
    if (want > sim.tick) e.flags |= EFlag.Invulnerable; else e.flags &= ~EFlag.Invulnerable;
  }
}
