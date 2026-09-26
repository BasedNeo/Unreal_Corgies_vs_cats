// Ability-entity system (order 510: after weapons 400, abilities 450 and projectiles 500 have run this tick, before
// combat status 600 and the boss damage regrade 560). Per tick:
//   1. lifetimes: drones end with their owner (death, leave, team change) or on expiry, barriers on expiry;
//      armed charges with an enemy in reach (or a spent fuse) detonate through combat explode()
//   2. damage intake from this tick's events (read in place, never drained): hitscan `fire` whose ray stopped on a drone/barrier, and `explode`
//      blasts (radius falloff, line of sight to the closest point of the shape); enemy shots/blasts defuse charges
//   3. destroyed entities are removed (`<id>:down`)
//   4. drones fly/hover and spot (EFlag.Spotted), snapshot timers
//   5. EFlag.Spotted is written onto every character from its spotUntil tick
// Projectile *direct* hits on drones and barriers are taken in the ability system (450), before projectiles move.
//
// Registration: the ability system adds this system to its Sim on first use (Sim.addSystem) unless the system list
// already has it, so it works in createDefaultSystems() and in test sims that list only the combat systems.
import type { Sim, SimSystem } from '../sim';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import { EFlag, type TeamId } from '../../shared/types';
import { TICK_HZ } from '../../shared/constants';
import { WEAPONS, weaponByIndex } from '../../shared/content/weapons';
import { ABILITIES, abilityDef } from '../../shared/content/abilities';
import { worldLineClear } from './geometry';
import { falloff } from './weapon-system';
import {
  abilityClosestPoint, abilityEntities, abilityShapeDistance, damageAbilityEntity, removeAbilityEntity,
} from './ability-core';
import { droneSpot, flyDrone } from './ability-drone';
import { chargeDue, detonateCharge } from './ability-charge';
import { CHARGE } from './ability-tuning';
import { ordnanceBlastOf } from './ordnance';

type FireEv = Extract<GameEvent, { e: 'fire' }>;
type ExplodeEv = Extract<GameEvent, { e: 'explode' }>;

/** Events already taken into account (tests may step many ticks without draining). */
const seen = new WeakSet<object>();
const registered = new WeakSet<Sim>();
const due: SimEntity[] = [];
const defused: SimEntity[] = [];
const cp = { x: 0, y: 0, z: 0 };

function defuse(e: SimEntity): void {
  if (!defused.includes(e)) defused.push(e);
}

/** A hitscan ray: damages the drone/barrier it stopped on, defuses enemy charges it passed over. */
function onFire(sim: Sim, list: SimEntity[], ev: FireEv): void {
  const def = weaponByIndex(ev.wpn);
  if (!def || def.kind !== 'hitscan') return;
  const team: TeamId | -1 = sim.entities.get(ev.id)?.team ?? -1;
  const dx = ev.hx - ev.x, dy = ev.hy - ev.y, dz = ev.hz - ev.z;
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-4) return;
  let struck = false;
  for (const e of list) {
    const a = e.abx!;
    if (e.removed || a.team === team || a.born >= sim.tick) continue; // born this tick: not in the ray's world yet
    if (a.kind === 'charge') {
      const cx = e.pos.x - ev.x, cy = e.pos.y + 0.15 - ev.y, cz = e.pos.z - ev.z;
      const t = Math.max(0, Math.min(len + 0.25, (cx * dx + cy * dy + cz * dz) / len));
      const px = cx - (dx / len) * t, py = cy - (dy / len) * t, pz = cz - (dz / len) * t;
      if (px * px + py * py + pz * pz <= CHARGE.shotRadius * CHARGE.shotRadius) defuse(e);
      continue;
    }
    if (struck || ev.hit >= 0) continue; // a character stopped the ray first
    if (abilityShapeDistance(e, ev.hx, ev.hy, ev.hz) > 0.15) continue;
    // pellet 0 is the traced ray; spread weapons put most pellets on a wall, fewer on a small drone
    const pellets = def.pellets > 1 ? (a.kind === 'barrier' ? def.pellets * 0.85 : Math.max(1, def.pellets * 0.35)) : 1;
    damageAbilityEntity(sim, e, def.damage * falloff(def, len) * pellets, ev.id, team, ev.hx, ev.hy, ev.hz);
    struck = true;
  }
}

/** Damage profile of a blast event: the source's explosive projectile, the dig charge, or a generic blast. */
function blastProfile(sim: Sim, ev: ExplodeEv): { dmg: number; inner: number; edge: number } {
  const od = ordnanceBlastOf(sim, ev); // W9 X4: a throwable's own numbers, not the thrower's gun
  if (od) return { dmg: od.explodeDamage, inner: od.explodeInner, edge: od.explodeEdgeFrac };
  const by = sim.entities.get(ev.by);
  const pd = by?.wpn ? WEAPONS[by.wpn.id].projectile : undefined;
  if (pd && pd.explodeRadius === ev.r) return { dmg: pd.explodeDamage, inner: pd.explodeInner, edge: pd.explodeEdgeFrac };
  const dc = ABILITIES.dig_charge;
  if (ev.r === dc.range) return { dmg: dc.damage, inner: CHARGE.inner, edge: CHARGE.edgeFrac };
  return { dmg: 60, inner: 0.7, edge: 0.3 };
}

/** A blast: radius-falloff damage to drones/barriers it can see; defuses enemy charges well inside it. */
function onExplode(sim: Sim, list: SimEntity[], ev: ExplodeEv): void {
  const by = sim.entities.get(ev.by);
  if (!by) return;
  const team = by.team;
  let prof: { dmg: number; inner: number; edge: number } | null = null;
  for (const e of list) {
    const a = e.abx!;
    if (e.removed || a.team === team) continue;
    const d = abilityShapeDistance(e, ev.x, ev.y, ev.z);
    if (d > ev.r) continue;
    abilityClosestPoint(e, ev.x, ev.y, ev.z, cp);
    // stop the sight line a hair before the shape (the shape itself must not block its own blast)
    const lx = cp.x - ev.x, ly = cp.y - ev.y, lz = cp.z - ev.z;
    const ll = Math.hypot(lx, ly, lz);
    const k = ll > 0.1 ? (ll - 0.08) / ll : 0;
    if (!worldLineClear(sim, ev.x, ev.y, ev.z, ev.x + lx * k, ev.y + ly * k, ev.z + lz * k)) continue;
    if (a.kind === 'charge') { if (d <= ev.r * 0.6) defuse(e); continue; }
    prof ??= blastProfile(sim, ev);
    const frac = d <= prof.inner ? 1 : 1 + (prof.edge - 1) * ((d - prof.inner) / Math.max(1e-3, ev.r - prof.inner));
    damageAbilityEntity(sim, e, prof.dmg * frac, ev.by, team, cp.x, cp.y, cp.z);
  }
}

/**
 * This tick's events so far, read in place. Draining and re-emitting them (as the boss regrade does) would be seen
 * by anything that wraps sim.drainEvents (tools/soak.mjs, tools/qa-*.mjs count events that way) and double-count
 * them. Uses Sim.peekEvents() when the Sim has it (requested contract, docs/handoff/C2.md), else the Sim's queue.
 */
function tickEvents(sim: Sim): readonly GameEvent[] {
  return sim.peekEvents();
}

function scanEvents(sim: Sim, list: SimEntity[]): void {
  const evs = tickEvents(sim);
  const n = evs.length; // hits emitted while scanning are appended after n
  for (let i = 0; i < n; i++) {
    const ev = evs[i];
    if ((ev.e !== 'fire' && ev.e !== 'explode') || seen.has(ev)) continue;
    seen.add(ev);
    if (ev.e === 'fire') onFire(sim, list, ev);
    else onExplode(sim, list, ev);
  }
}

/** EFlag.Spotted on characters from their spotUntil tick (cleared on death). */
function writeSpotFlags(sim: Sim): void {
  for (const e of sim.entities.values()) {
    if (!e.char) continue;
    if (!e.dead && (e.spotUntil ?? 0) > sim.tick) e.flags |= EFlag.Spotted;
    else if (e.flags & EFlag.Spotted) e.flags &= ~EFlag.Spotted;
  }
}

export const abilityEntitySystem: SimSystem = {
  name: 'ability-entities',
  order: 510,
  init(sim) { registered.add(sim); },
  update(sim, dt) {
    const list = abilityEntities(sim);
    if (list.length) {
      // 1. lifetimes, owners, charge triggers
      due.length = 0;
      for (const e of list) {
        const a = e.abx!;
        if (a.kind === 'drone') {
          const owner = sim.entities.get(a.owner);
          if (!owner || owner.removed || owner.dead || owner.team !== a.team) removeAbilityEntity(sim, e, 'down');
          else if (sim.tick >= a.until) removeAbilityEntity(sim, e, 'end');
        } else if (a.kind === 'barrier') {
          if (sim.tick >= a.until) removeAbilityEntity(sim, e, 'end');
        } else if (chargeDue(sim, e)) due.push(e);
      }
      for (const e of due) detonateCharge(sim, e, abilityDef(e.abx!.ability)!);
      due.length = 0;
      // 2. damage from this tick's shots and blasts (including the charges that just went off)
      const live = abilityEntities(sim);
      defused.length = 0;
      if (live.length) scanEvents(sim, live);
      for (const e of defused) removeAbilityEntity(sim, e, 'down');
      defused.length = 0;
      // 3-4. destroyed → gone; drones fly and spot; timers
      for (const e of abilityEntities(sim)) {
        const a = e.abx!;
        if (e.health && e.health.hp <= 0) { removeAbilityEntity(sim, e, 'down'); continue; }
        if (a.kind === 'drone') {
          flyDrone(sim, e, dt);
          droneSpot(sim, e, abilityDef(a.ability)!);
        }
        if (a.kind !== 'charge') e.ammo = Math.max(0, Math.ceil((a.until - sim.tick) / TICK_HZ));
      }
    }
    // 5. spotted flags (also clears them after the last drone is gone)
    writeSpotFlags(sim);
  },
};

/** Add the ability-entity system to a sim that does not have it yet (called by the ability system). */
export function ensureAbilityEntitySystem(sim: Sim): void {
  if (registered.has(sim)) return;
  registered.add(sim);
  sim.addSystem(abilityEntitySystem);
}
