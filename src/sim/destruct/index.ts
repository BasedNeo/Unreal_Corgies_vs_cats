// X1 destructibles — breakable world props as authoritative entities (EntityKind.Destructible, team Neutral).
//
//   init        one entity per WorldData.destructibles entry (in order; EntityState.seed = that index), its box
//               colliders (World layer: they stop characters, karts, shots, projectiles, blasts and sight lines like
//               any wall) and a nav blocker per destructible (the sim's own nav grid closes its cells)
//   order 505   after weapons (400), abilities (450) and projectiles (500), before the ability entities (510):
//                 1. match restart (a new MatchState, or ended -> anything else) -> every destructible stands again
//                 2. Dig Charges planted against a breach wall get the breaching fuse (BREACH)
//                 3. this tick's hitscan `fire` events damage the stacks they stopped on (walls shrug shots off)
//               Blasts are applied inside the combat lane's explode() (addBlastListener), after the characters.
//   break       hp 0 + EFlag.Busy in snapshots, colliders removed, nav cells re-opened (bots path through the hole),
//               `ability { id, ability: 'destruct:<kind>', x, y, z }` + a noise; a BreakRecord for objectives
//   reset       resetDestructibles(sim[, tags]): colliders + nav cells back, full hp; characters inside step out
//
// Deterministic: no rng at all. The client predictor mirrors the colliders from snapshots: mirrorDestructibles().
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import type { MatchState } from '../../shared/protocol';
import { Anim, EntityKind, Team, type EntityId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { DESTRUCT_KINDS } from '../../shared/world/destructibles';
import { addBlastListener, addProjectileHitListener } from '../combat/projectiles';
import { destructibleOfCollider } from './tag';
import { batchNavBlockers, setNavBlocker } from '../ai/nav';
import { createBoxCollider, createDestructRuntime, destructRuntime, navKey, type BreakRecord } from './state';
import { breachCharges, breakEntity, damageEntity, onBlast, restoreEntity, scanShots } from './damage';

export { mirrorDestructibles } from './mirror';
export { BREAK_EVENT_PREFIX } from './damage';
export type { BreakRecord, DestructState } from './state';

addBlastListener(onBlast);
// A frisbee hitting a stack (shotMult: the wall's 0 means it bounces off the boards).
addProjectileHitListener((sim, handle, _x, _y, _z, damage, owner) => {
  const c = sim.world.getCollider(handle);
  const e = c ? sim.entities.get(destructibleOfCollider(c)) : undefined;
  if (e?.dsx && !e.dsx.broken && e.dsx.rule.shotMult > 0) damageEntity(sim, e, damage * e.dsx.rule.shotMult, owner);
});

function spawnAll(sim: Sim): void {
  const rt = createDestructRuntime(sim);
  const defs = sim.worldData.destructibles ?? [];
  defs.forEach((def, index) => {
    const id = sim.allocId();
    const e: SimEntity = {
      id, kind: EntityKind.Destructible, team: Team.Neutral, species: 0, cls: null, seed: index, name: def.id,
      pos: { x: def.x, y: def.y, z: def.z }, vel: { x: 0, y: 0, z: 0 }, yaw: def.yaw, pitch: 0, collider: null,
      input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
      health: { hp: def.hp, max: def.hp, lastDamageTick: -9999, lastAttacker: -1 },
      anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
      ownerPid: null, removed: false, data: {},
      dsx: { index, def, rule: DESTRUCT_KINDS[def.kind], colliders: [], broken: false, breaks: 0, brokeTick: -1, brokeBy: -1 },
    };
    for (const b of def.boxes) e.dsx!.colliders.push(createBoxCollider(sim, b, id));
    setNavBlocker(sim, navKey(def), def.boxes);
    sim.entities.set(id, e);
    rt.list.push(e);
  });
}

export const destructSystem: SimSystem = {
  name: 'destruct',
  order: 505,
  init(sim) {
    if (!destructRuntime(sim)) spawnAll(sim);
  },
  update(sim) {
    const rt = destructRuntime(sim);
    if (!rt || !rt.list.length) return;
    const ms = sim.state.match as MatchState | undefined;
    const phase = ms?.phase ?? 'live';
    const restarted = (rt.matchRef !== undefined && ms !== rt.matchRef) || (rt.lastPhase === 'ended' && phase !== 'ended');
    rt.matchRef = ms;
    rt.lastPhase = phase;
    if (restarted) resetDestructibles(sim);
    breachCharges(sim, rt);
    scanShots(sim, rt);
  },
};

export function destructSystems(): SimSystem[] {
  return [destructSystem];
}

// ------------------------------------------------------------------------------------------------ public API

/** Destructible entities of a sim (WorldData order). Empty when the destruct system does not run. */
export function destructibles(sim: Sim): readonly SimEntity[] {
  return destructRuntime(sim)?.list ?? [];
}

/** Destructibles with a tag ('garage_breach_wall', 'tuna_stack', 'crate_stack'). */
export function destructiblesByTag(sim: Sim, tag: string): SimEntity[] {
  return destructibles(sim).filter((e) => e.dsx!.def.tag === tag);
}

/**
 * How many destructibles with `tag` are broken right now (the adventure `destroy` trigger: done when this reaches
 * its count). `which: 'standing'` counts the ones still up, 'all' the total.
 */
export function destructibleCount(sim: Sim, tag: string, which: 'broken' | 'standing' | 'all' = 'broken'): number {
  let n = 0;
  for (const e of destructibles(sim)) {
    if (e.dsx!.def.tag !== tag) continue;
    if (which === 'all' || (which === 'broken') === e.dsx!.broken) n++;
  }
  return n;
}

/** Break records since the last call (who broke what, when). */
export function drainBreaks(sim: Sim): BreakRecord[] {
  const rt = destructRuntime(sim);
  if (!rt || !rt.breaks.length) return [];
  return rt.breaks.splice(0);
}

/** Damage a destructible directly (already scaled; e.g. a scripted hazard). Returns true if that broke it. */
export function damageDestructible(sim: Sim, e: SimEntity, dmg: number, by: EntityId = -1): boolean {
  return !!e.dsx && damageEntity(sim, e, dmg, by);
}

/**
 * Break every standing destructible with `tag` (or the one whose def id is `tag`). `silent` = no event, no noise
 * (restoring a checkpoint after the step that broke it). Returns how many broke.
 */
export function breakDestructibles(sim: Sim, tag: string, opts: { silent?: boolean; by?: EntityId } = {}): number {
  let n = 0;
  for (const e of destructibles(sim)) {
    const d = e.dsx!.def;
    if ((d.tag === tag || d.id === tag) && breakEntity(sim, e, opts.by ?? -1, opts.silent ?? false)) n++;
  }
  return n;
}

/**
 * Stand destructibles back up: all of them, or those whose tag (or def id) is in `tags`. Called automatically on a
 * match restart; the adventure calls it on a checkpoint restart. Silent (snapshots carry the state). Returns the count.
 */
export function resetDestructibles(sim: Sim, tags?: readonly string[]): number {
  let n = 0;
  batchNavBlockers(sim, () => {
    for (const e of destructibles(sim)) {
      const d = e.dsx!.def;
      if (tags && !tags.includes(d.tag) && !tags.includes(d.id)) continue;
      if (restoreEntity(sim, e)) n++;
    }
  });
  return n;
}

/** Def ids of the destructibles broken right now (store it with an adventure checkpoint). */
export function destructSnapshot(sim: Sim): string[] {
  return destructibles(sim).filter((e) => e.dsx!.broken).map((e) => e.dsx!.def.id);
}

/**
 * Put every destructible back to a destructSnapshot(): the listed ones broken (silently: no event, no noise, no
 * debris for anyone), all the others standing. A checkpoint restart that keeps what the squad had blown by then.
 */
export function restoreDestructSnapshot(sim: Sim, brokenIds: readonly string[]): void {
  batchNavBlockers(sim, () => {
    for (const e of destructibles(sim)) {
      const want = brokenIds.includes(e.dsx!.def.id);
      if (want) breakEntity(sim, e, -1, true);
      else restoreEntity(sim, e);
    }
  });
}
