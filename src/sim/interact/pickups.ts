// Pickups: Upgrade Cores (timed buffs at contested spots, rolled and refilled on a timer) and Golden
// Kibble collectibles (20 hideouts per map, shared 60 s respawn). Collection is authoritative and purely
// positional: the pickup is taken by the closest eligible character whose capsule touches it this tick
// (clients cannot ask for a pickup; there is no message for it).
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, CLASS_IDS, EFlag, EntityKind, Team } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import {
  CORE_IDS, CORE_RULES, KIBBLE_RULES, PICKUPS, pickupIndex, type CoreId, type PickupId, type PickupLayout, type PickupSpot,
} from '../../shared/content/pickups';
import { grantBuff } from './buffs';
import { creditRoster, interactConfig, type InteractRuntime } from './state';

/**
 * True if a character's capsule comes within `radius` of the point (px, py, pz): distance from the point to
 * the capsule's core segment ≤ capsule radius + pickup radius. Shared by the authority and the proofs.
 */
export function touchesPickup(e: SimEntity, px: number, py: number, pz: number, radius: number): boolean {
  const m = e.char?.move;
  if (!m) return false;
  const reach = m.capsuleRadius + radius;
  const dx = px - e.pos.x, dz = pz - e.pos.z;
  if (dx * dx + dz * dz > reach * reach) return false;
  const y0 = e.pos.y + m.capsuleRadius, y1 = y0 + 2 * m.capsuleHalfHeight;
  const dy = py < y0 ? py - y0 : py > y1 ? py - y1 : 0;
  return dx * dx + dy * dy + dz * dz <= reach * reach;
}

/** Characters that may take pickups: living, not a PvE wave cat, not a boss. */
export function canCollect(e: SimEntity): boolean {
  return !!e.char && !e.dead && !e.removed && !e.combat?.pve && e.kind !== EntityKind.Boss;
}

function setItem(e: SimEntity, id: PickupId): void {
  e.pickup!.id = id;
  e.pickup!.kind = PICKUPS[id].kind;
  e.pickup!.radius = PICKUPS[id].radius;
  // Sim.toState() writes CLASS_IDS.indexOf(cls) into EntityState.cls: this makes it the PICKUP_IDS index.
  e.cls = CLASS_IDS[pickupIndex(id)] ?? null;
}

/** Spawn one pickup spot entity (no collider: touches are analytic). */
export function spawnPickupSpot(sim: Sim, spot: PickupSpot, index: number, id: PickupId, available: boolean): SimEntity {
  const eid = sim.allocId();
  const e: SimEntity = {
    id: eid, kind: EntityKind.Pickup, team: Team.Neutral, species: 0, cls: null, seed: index, name: spot.id,
    pos: { x: spot.x, y: spot.y, z: spot.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
    health: { hp: 0, max: 0, lastDamageTick: -9999, lastAttacker: -1 },
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
    pickup: { id, kind: PICKUPS[id].kind, spot: index, spotId: spot.id, available, timer: available ? 0 : Infinity, timerTotal: 0, radius: PICKUPS[id].radius },
  };
  setItem(e, id);
  writeSnapshot(e);
  sim.entities.set(eid, e);
  return e;
}

/** Roll the next core type for a spot (never the same type twice in a row at one spot). */
export function rollCore(rt: InteractRuntime, prev: PickupId | null): CoreId {
  const pool = CORE_IDS.filter((c) => c !== prev);
  return pool[Math.floor(rt.rng() * pool.length) % pool.length];
}

/** First types for the core spots: a shuffled deal of every core (variety), wrapping when spots > types. */
function dealCores(rt: InteractRuntime, n: number): CoreId[] {
  const deck: CoreId[] = [...CORE_IDS];
  for (let i = deck.length - 1; i > 0; i--) { const j = Math.floor(rt.rng() * (i + 1)); [deck[i], deck[j]] = [deck[j], deck[i]]; }
  return Array.from({ length: n }, (_, i) => deck[i % deck.length]);
}

export function placePickups(sim: Sim, rt: InteractRuntime, layout: PickupLayout): SimEntity[] {
  const out: SimEntity[] = [];
  const deal = dealCores(rt, layout.cores.length);
  if (rt.parts.cores) layout.cores.forEach((s, i) => out.push(spawnPickupSpot(sim, s, i, deal[i], false)));
  if (rt.parts.kibble) layout.kibble.forEach((s, i) => out.push(spawnPickupSpot(sim, s, i, 'golden_kibble', true)));
  return out;
}

function coreTimes(sim: Sim): { first: number; stagger: number; respawn: number } {
  const c = interactConfig(sim);
  return { first: c.coreFirstSpawn ?? CORE_RULES.firstSpawn, stagger: c.coreStagger ?? CORE_RULES.stagger, respawn: c.coreRespawn ?? CORE_RULES.respawn };
}

/** Match went live: schedule every core spot (staggered first appearance). */
export function scheduleCores(sim: Sim, rt: InteractRuntime): void {
  const t = coreTimes(sim);
  for (const id of rt.pickups) {
    const e = sim.entities.get(id);
    const p = e?.pickup;
    if (!e || !p || p.kind !== 'core') continue;
    p.available = false;
    p.timer = p.timerTotal = t.first + p.spot * t.stagger;
    writeSnapshot(e);
  }
  rt.coresScheduled = true;
}

/** Match over (ended) or restarting: cores go dark (unscheduled), kibble returns everywhere. */
export function resetPickups(sim: Sim, rt: InteractRuntime): void {
  const cores = rt.pickups.filter((id) => sim.entities.get(id)?.pickup?.kind === 'core');
  const deal = dealCores(rt, cores.length);
  for (const id of rt.pickups) {
    const e = sim.entities.get(id);
    const p = e?.pickup;
    if (!e || !p) continue;
    if (p.kind === 'core') { p.available = false; p.timer = Infinity; p.timerTotal = 0; setItem(e, deal[cores.indexOf(id)]); }
    else { p.available = true; p.timer = 0; p.timerTotal = 0; }
    writeSnapshot(e);
  }
  rt.coresScheduled = false;
}

/** Take a pickup: buff / score, event, and start its refill timer. */
export function collectPickup(sim: Sim, rt: InteractRuntime, e: SimEntity, by: SimEntity): void {
  const p = e.pickup!;
  const def = PICKUPS[p.id];
  if (def.kind === 'core') grantBuff(sim, by, p.id as CoreId);
  sim.emit({ e: 'pickup', id: by.id, item: p.id });
  creditRoster(sim, by.id, def.score, p.id);
  p.available = false;
  if (def.kind === 'core') {
    p.timer = p.timerTotal = coreTimes(sim).respawn;
    setItem(e, rollCore(rt, p.id)); // the next core is known now: clients show it as a ghost + countdown
  } else {
    p.timer = p.timerTotal = interactConfig(sim).kibbleRespawn ?? KIBBLE_RULES.respawn;
  }
  writeSnapshot(e);
}

const chars: SimEntity[] = [];

/** Per tick: refill timers and touches. `coresLive` = the match is in a phase where cores run. */
export function stepPickups(sim: Sim, rt: InteractRuntime, dt: number, coresLive: boolean): void {
  chars.length = 0;
  for (const c of sim.entities.values()) if (canCollect(c)) chars.push(c);
  for (const e of rt.pickupEnts) {
    const p = e.pickup;
    if (!p || e.removed) continue;
    if (!p.available) {
      if (p.kind === 'core' && !coresLive) continue;
      p.timer -= dt;
      if (p.timer <= 0) { p.available = true; p.timer = 0; }
      writeSnapshot(e);
      if (!p.available) continue;
    }
    // Closest touching character wins (ties: iteration order, deterministic).
    let best: SimEntity | null = null, bd = Infinity;
    for (const c of chars) {
      if (!touchesPickup(c, e.pos.x, e.pos.y, e.pos.z, p.radius)) continue;
      const d = (c.pos.x - e.pos.x) ** 2 + (c.pos.z - e.pos.z) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    if (best) collectPickup(sim, rt, e, best);
  }
  chars.length = 0;
}

/** Snapshot fields (see src/shared/content/pickups.ts). */
export function writeSnapshot(e: SimEntity): void {
  const p = e.pickup!;
  const h = e.health!;
  if (p.available) {
    e.flags &= ~EFlag.Busy;
    e.ammo = 0;
    h.hp = h.max = 0;
  } else {
    e.flags |= EFlag.Busy;
    const waiting = Number.isFinite(p.timer);
    e.ammo = waiting ? Math.max(0, Math.ceil(p.timer - 1e-6)) : 0;
    h.max = waiting ? p.timerTotal : 0;
    h.hp = waiting ? Math.max(0, p.timerTotal - p.timer) : 0;
  }
}
