// X1 destructibles: damage intake (blasts via the combat lane's explode() listener, hitscan via this tick's `fire`
// events), breaking (colliders out, nav cells open, `ability` event, AI noise) and restoring (colliders back, nav cells
// closed, anyone standing inside pushed out).
import type { Collider, Ray } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { GameEvent } from '../../shared/protocol';
import { EFlag, Team, type EntityId, type TeamId } from '../../shared/types';
import { weaponByIndex, type ProjectileDef } from '../../shared/content/weapons';
import { ABILITIES } from '../../shared/content/abilities';
import { BREACH, destructDistance, type P3 } from '../../shared/world/destructibles';
import { WORLD_RAY_FILTER } from '../combat/geometry';
import { capsuleOf, combatLive, reportNoiseAt, ticksOf } from '../combat/state';
import { falloff } from '../combat/weapon-system';
import { abilityEntities } from '../combat/ability-core';
import { chargeBlast } from '../combat/ability-charge';
import { CHARGE } from '../combat/ability-tuning';
import { setNavBlocker } from '../ai/nav';
import { destructibleOfCollider } from './tag';
import { createBoxCollider, destructRuntime, navKey, type DestructRuntime } from './state';

type FireEv = Extract<GameEvent, { e: 'fire' }>;

/** A broken destructible's event: `ability { id: entity, ability: 'destruct:<kind>', x, y, z: its center }`. */
export const BREAK_EVENT_PREFIX = 'destruct:';
/** Shots whose ray stopped within this distance (m) of a destructible's box struck it. */
const SHOT_SLOP = 0.12;
/** Break records kept for drainBreaks() between drains. */
const MAX_RECORDS = 64;

// ------------------------------------------------------------------------------------------------ break / restore

/**
 * Break a standing destructible: hp 0 + EFlag.Busy, colliders removed, its nav cells re-opened, a break record, and
 * (unless silent) the `destruct:<kind>` ability event + a noise bots hear. Returns false if it was already broken.
 */
export function breakEntity(sim: Sim, e: SimEntity, by: EntityId = -1, silent = false): boolean {
  const st = e.dsx!, rt = destructRuntime(sim);
  if (st.broken) return false;
  st.broken = true;
  st.breaks++;
  st.brokeTick = sim.tick;
  st.brokeBy = by;
  e.health!.hp = 0;
  e.flags |= EFlag.Busy;
  e.ammo = st.breaks;
  for (const c of st.colliders) sim.world.removeCollider(c, false);
  st.colliders.length = 0;
  setNavBlocker(sim, navKey(st.def), null);
  const src = sim.entities.get(by);
  const byTeam: TeamId | -1 = src ? src.team : -1;
  if (rt) {
    if (rt.breaks.length >= MAX_RECORDS) rt.breaks.shift();
    rt.breaks.push({ id: e.id, defId: st.def.id, tag: st.def.tag, kind: st.def.kind, by, byTeam, tick: sim.tick, scripted: silent });
  }
  if (!silent) {
    const d = st.def;
    sim.emit({ e: 'ability', id: e.id, ability: `${BREAK_EVENT_PREFIX}${d.kind}`, x: d.cx, y: d.cy, z: d.cz });
    reportNoiseAt(sim, d.cx, d.cy, d.cz, st.rule.noise, byTeam === -1 ? Team.Neutral : byTeam, by);
  }
  return true;
}

/** Stand a broken destructible back up (full hp, colliders, nav cells closed); characters inside are pushed out. */
export function restoreEntity(sim: Sim, e: SimEntity): boolean {
  const st = e.dsx!;
  if (!st.broken) return false;
  st.broken = false;
  e.health!.hp = e.health!.max;
  e.health!.lastAttacker = -1;
  e.flags &= ~EFlag.Busy;
  for (const b of st.def.boxes) st.colliders.push(createBoxCollider(sim, b, e.id));
  setNavBlocker(sim, navKey(st.def), st.def.boxes);
  pushOut(sim, e);
  return true;
}

/** Characters whose capsule overlaps a restored destructible's box step out through its nearest side face. */
function pushOut(sim: Sim, d: SimEntity): void {
  for (const c of sim.entities.values()) {
    if (!c.char || c.dead || c.removed) continue;
    const cap = capsuleOf(c);
    for (const b of d.dsx!.def.boxes) {
      if (c.pos.y >= b.y + b.hy - 0.05 || c.pos.y + cap.height <= b.y - b.hy) continue;   // on top / below
      const cy = Math.cos(b.rotY), sy = Math.sin(b.rotY), dx = c.pos.x - b.x, dz = c.pos.z - b.z;
      const lx = dx * cy - dz * sy, lz = dx * sy + dz * cy;
      const r = cap.r + 0.05;
      if (Math.abs(lx) >= b.hx + r || Math.abs(lz) >= b.hz + r) continue;
      // exit along the local axis with the smallest move
      const ex = b.hx + r - Math.abs(lx), ez = b.hz + r - Math.abs(lz);
      let nx = lx, nz = lz;
      if (ex <= ez) nx = (lx < 0 ? -1 : 1) * (b.hx + r); else nz = (lz < 0 ? -1 : 1) * (b.hz + r);
      const wx = b.x + nx * cy + nz * sy, wz = b.z - nx * sy + nz * cy;
      sim.placeCharacter(c, wx, c.pos.y, wz);
      if (c.char) { c.char.restX = NaN; c.char.restY = NaN; c.char.restZ = NaN; }
    }
  }
}

/** Apply damage (already scaled by the kind's multiplier); breaks it at 0 hp. Ignored while combat is not live. */
export function damageEntity(sim: Sim, e: SimEntity, dmg: number, by: EntityId): boolean {
  const st = e.dsx!, h = e.health!;
  if (st.broken || dmg <= 0 || !combatLive(sim)) return false;
  h.hp = Math.max(0, h.hp - dmg);
  h.lastDamageTick = sim.tick;
  h.lastAttacker = by;
  if (h.hp <= 1e-6) return breakEntity(sim, e, by);
  return false;
}

// ------------------------------------------------------------------------------------------------ blasts

const cp: P3 = { x: 0, y: 0, z: 0 };
let excludeId = -1;
const notSelf = (c: Collider): boolean => destructibleOfCollider(c) !== excludeId;
const rays = new WeakMap<Sim, Ray>();

/** Nothing but the destructible itself between the blast and its closest point? */
function blastReaches(sim: Sim, e: SimEntity, x: number, y: number, z: number, px: number, py: number, pz: number): boolean {
  const dx = px - x, dy = py - y, dz = pz - z, len = Math.hypot(dx, dy, dz);
  if (len < 0.05) return true;
  let ray = rays.get(sim);
  if (!ray) { ray = new sim.R.Ray({ x: 0, y: 0, z: 0 }, { x: 0, y: 0, z: 1 }); rays.set(sim, ray); }
  ray.origin.x = x; ray.origin.y = y; ray.origin.z = z;
  ray.dir.x = dx / len; ray.dir.y = dy / len; ray.dir.z = dz / len;
  excludeId = e.id;
  const hit = sim.world.castRay(ray, len - 0.02, true, undefined, WORLD_RAY_FILTER, undefined, undefined, notSelf);
  excludeId = -1;
  return !hit;
}

/** explode() listener: radius falloff like explode() itself, x the kind's blast or Dig Charge multiplier. */
export function onBlast(sim: Sim, x: number, y: number, z: number, pdef: ProjectileDef, owner: EntityId, _team: TeamId, _weapon: number): void {
  const rt = destructRuntime(sim);
  const R = pdef.explodeRadius;
  if (!rt || R <= 0 || !combatLive(sim)) return;
  const charge = pdef === chargeBlast(ABILITIES.dig_charge);
  for (const e of rt.list) {
    const st = e.dsx!;
    if (st.broken) continue;
    const d = destructDistance(st.def, x, y, z, cp);
    if (d > R) continue;
    if (!blastReaches(sim, e, x, y, z, cp.x, cp.y, cp.z)) continue;
    const inner = pdef.explodeInner;
    const frac = d <= inner ? 1 : 1 + (pdef.explodeEdgeFrac - 1) * ((d - inner) / Math.max(1e-3, R - inner));
    damageEntity(sim, e, pdef.explodeDamage * frac * (charge ? st.rule.chargeMult : st.rule.blastMult), owner);
  }
}

// ------------------------------------------------------------------------------------------------ shots

/** A hitscan ray that stopped on a destructible (no character hit first) damages it (kinds with shotMult > 0). */
function onFire(sim: Sim, rt: DestructRuntime, ev: FireEv): void {
  if (ev.hit !== -1) return;
  const def = weaponByIndex(ev.wpn);
  if (!def || def.kind !== 'hitscan') return;
  for (const e of rt.list) {
    const st = e.dsx!;
    if (st.broken || st.rule.shotMult <= 0) continue;
    // cheap reject: the ray end must be near the destructible's center
    const dc = Math.hypot(ev.hx - st.def.cx, ev.hy - st.def.cy, ev.hz - st.def.cz);
    if (dc > 4) continue;
    if (destructDistance(st.def, ev.hx, ev.hy, ev.hz) > SHOT_SLOP) continue;
    const len = Math.hypot(ev.hx - ev.x, ev.hy - ev.y, ev.hz - ev.z);
    // pellet 0 is the traced ray (the event carries one); spread weapons put most pellets on a big prop
    const pellets = def.pellets > 1 ? def.pellets * 0.85 : 1;
    damageEntity(sim, e, def.damage * falloff(def, len) * pellets * st.rule.shotMult, ev.id);
    return;
  }
}

/** This tick's hitscan events so far, read in place (never drained). */
export function scanShots(sim: Sim, rt: DestructRuntime): void {
  const evs = sim.peekEvents();
  const n = evs.length;
  for (let i = 0; i < n; i++) {
    const ev = evs[i];
    if (ev.e !== 'fire' || rt.seen.has(ev)) continue;
    rt.seen.add(ev);
    onFire(sim, rt, ev);
  }
}

// ------------------------------------------------------------------------------------------------ breaching

/**
 * A Dig Charge planted against a standing breach wall (within BREACH.reach of it) gets a breaching fuse: it blows
 * BREACH.fuse s after it arms instead of waiting for an enemy or its 30 s fuse. The charge stays the combat lane's
 * entity; only its deadline (abx.until) is shortened, so its own system detonates it through explode().
 */
export function breachCharges(sim: Sim, rt: DestructRuntime): void {
  const list = abilityEntities(sim);
  if (!list.length) return;
  for (const c of list) {
    const a = c.abx!;
    if (a.kind !== 'charge' || rt.charges.has(c)) continue;
    rt.charges.add(c);
    for (const e of rt.list) {
      const st = e.dsx!;
      if (st.broken || !st.rule.breach) continue;
      if (destructDistance(st.def, c.pos.x, c.pos.y + CHARGE.blastLift, c.pos.z) > BREACH.reach) continue;
      a.until = Math.min(a.until, a.armAt + ticksOf(BREACH.fuse));
      break;
    }
  }
}
