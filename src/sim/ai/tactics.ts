// Bot tactics (C2b): when a bot presses its class ability, and what it does between fights (Upgrade Cores, the
// objective chain). Called by the brain (brain.ts) every tick; everything still goes out as an InputCmd.
//
// Class abilities (a press needs the ability off cooldown, the button released last tick, and no press in the last
// 0.5 s — a refused placement is retried after that; PvE archetypes roll `abilityUse` and hold back until wave 3, so
// wave cats stay beatable and the opening stays gentle):
//   bark_blast     an enemy it can perceive in reach in front; in PvP modes room bots (not wave cats, not player
//                  stand-ins) with it ready rush a reloading target (or, on a roll, any target within 22 m) to use it
//   shadow_cloak   investigating a noise 10–35 m away (sneak up), or hurt below half health (break off)
//   spotter_drone  searching: patrolling/investigating with nobody in sight, or a target just lost, no drone up
//   dig_charge     a pursuer while retreating, an enemy closing in, on the way to a noise, a hold zone, a narrow passage
//   squeak_barrier shot at from 6–40 m in the open (the attacker sees it): face the shooter, wall up, take cover
//   ear_glide      (movement, predicted) skyraiders double-jump at the apex of a jump, then spread their ears;
//                  on long trips they hop to glide
// Objectives (walked to in patrol; zones are fought from — see holdZone in brain.ts; all of it waits while a human
// teammate within 90 m is under fire — bots help them first): the objective chain's team sends
// one runner (its lowest-id bot) to interact steps, also under long-range fire, and every member to hold steps;
// room bots with ≥ 50 % health walk to an Upgrade Core within 30 m that stands on walkable ground.
// core-rush: every other bot of a team (by id) attacks the best pad it does not own (near, contested or being taken
// by the enemy scores higher); the rest defend owned pads under attack, else sit on the nearest owned pad.
// adventure (A1, src/sim/adventure): squad bots follow the chapter step — reach/hold/survive: take spots in the zone
// (survive: around the rally point) · interact: with a human in the squad they guard the point (humans trigger it),
// else the runner uses it (also at the Ordnance Kiosk) · collect: one item each (by rank) · defeat/destroy: walk to
// the nearest target (breachers mine a destructible) · a stealth step with a human and no alarm yet: they hang back
// at the rally point so the human leads · briefing / result: they gather at the rally point. Chapter cats spawned
// as sentries (stealth steps) pace their loop (goal 'post') until the alarm turns them into hunters.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Btn } from '../../shared/input';
import { EFlag, EntityKind, Team, type EntityId } from '../../shared/types';
import { angleDelta } from '../../shared/math';
import { abilityDef } from '../../shared/content/abilities';
import { pickupLayoutFor } from '../../shared/content/pickups';
import { worldLineClear } from '../combat/geometry';
import { characterHeight, eyeHeight, isStealthed } from '../combat/state';
import { concealLevel } from '../world/env';
import { abilityEntities } from '../combat/ability-core';
import { objectiveState, interactRuntime, interactConfig } from '../interact';
import { coreRushConfig, coreRushPads, type CorePadInfo } from '../match/core-rush';
import { KIOSK_PROMPT } from '../../shared/content/chapters';
import {
  SENTRY_DWELL, adventureChapter, adventureItems, adventureState, adventureStep, adventureTargets, isAdventureMode, squadHasHuman,
} from '../adventure/state';
import type { Archetype } from './archetypes';
import { type NavGrid, cellX, cellZ, isWalkable, nearestWalkable, randomCell } from './nav';

export interface TacticsState {
  /** No ability press before this tick (after a press, refused or not). */
  lock: number;
  /** Assault: pushing in to bark-blast range until this tick; the target the push roll was made for. */
  pushUntil: number;
  pushRolled: EntityId;
  pushRollAt: number;
  /** Mode-entry tick an alert/patrol roll was made for (one roll per mode entry). */
  rolledFor: number;
  /** Warden: the shooter to wall off, until this tick. */
  wallFrom: EntityId;
  wallUntil: number;
  /** Stay in cover at least until this tick (behind a fresh barrier / after cloaking away). */
  holdUntil: number;
  /** Next tick a chokepoint check may run (breacher). */
  chokeAt: number;
  /** Skyraider: next deliberate hop; the tick the current hop started. */
  hopAt: number;
  /** Objective/core goal (kind '' = none; 'post' = an adventure sentry's waypoint), re-evaluated every ~0.5 s. */
  goal: '' | 'core' | 'step' | 'post';
  gx: number; gz: number; gy: number; gr: number;
  /** Objective step: the zone/point center (gx/gz is the bot's own spot in a hold zone). */
  cx: number; cz: number;
  interact: boolean;
  hold: boolean;
  /** Adventure: the interact step is at an Ordnance Kiosk (E is fine next to that terminal). */
  kiosk: boolean;
  /** Adventure: the goal is a destructible to break (breachers mine it). */
  destroy: boolean;
  goalId: EntityId;
  goalAt: number;
  goalSince: number;
  /** Enemy drone the bot is shooting at when nobody else is in sight (-1 = none), and whether it's lined up. */
  drone: EntityId;
  droneLined: boolean;
  /** Cores this bot gave up on (unreachable), with the tick to retry. */
  skip: number[];
}

export function createTactics(): TacticsState {
  return {
    lock: 0, pushUntil: 0, pushRolled: -1, pushRollAt: 0, rolledFor: -1, wallFrom: -1, wallUntil: 0, holdUntil: 0, chokeAt: 0, hopAt: 0,
    goal: '', gx: 0, gz: 0, gy: 0, gr: 0, cx: 0, cz: 0, interact: false, hold: false, kiosk: false, destroy: false, goalId: -1, goalAt: 0, goalSince: 0, drone: -1, droneLined: false, skip: [],
  };
}

/** Everything the brain knows this tick that the tactics need. */
export interface TacticsInput {
  target: SimEntity | null;
  visible: boolean;
  /** Horizontal distance to the target (Infinity when none). */
  dist: number;
  mode: 'patrol' | 'alert' | 'engage' | 'cover' | 'regroup';
  modeTick: number;
  lastSeenTick: number;
  alertX: number; alertZ: number;
  aimYaw: number;
}

const PUSH_BAND: [number, number] = [1.5, 4.2];

/** Engagement band override while an assault bot pushes in for a bark blast. */
export function pushBand(sim: Sim, t: TacticsState): [number, number] | null {
  return sim.tick < t.pushUntil ? PUSH_BAND : null;
}

function ready(sim: Sim, e: SimEntity, t: TacticsState): boolean {
  return !!e.abil && e.abil.cooldown <= 0 && sim.tick >= t.lock && (e.prevButtons & Btn.Ability) === 0 && !(e.flags & EFlag.Mounted);
}

function roll(sim: Sim, a: Archetype, p: number): boolean {
  return sim.rng() < p * a.abilityUse;
}

/** PvE wave cats learn their tricks as the waves climb: no abilities in the first two waves (the opening stays gentle). */
const PVE_ABILITY_WAVE = 3;
function pveHoldsBack(sim: Sim, e: SimEntity): boolean {
  if (!e.combat?.pve) return false;
  if (isAdventureMode(sim)) return (adventureChapter(sim)?.index ?? 1) <= 1; // the tutorial chapter's cats fight plain
  const wave = (sim.state.match as { wave?: number } | undefined)?.wave ?? PVE_ABILITY_WAVE;
  return wave < PVE_ABILITY_WAVE;
}

function ownEntities(sim: Sim, e: SimEntity, kind: 'drone' | 'charge' | 'barrier'): number {
  let n = 0;
  for (const x of abilityEntities(sim)) if (x.abx!.owner === e.id && x.abx!.kind === kind) n++;
  return n;
}

/** A narrow passage: few open directions, but open on two opposite sides. */
function inChokepoint(g: NavGrid, e: SimEntity): boolean {
  let open = 0, through = false;
  const ok: boolean[] = [];
  for (let i = 0; i < 8; i++) {
    const a = (i * Math.PI) / 4;
    ok.push(isWalkable(g, e.pos.x + Math.cos(a) * 2.5, e.pos.z + Math.sin(a) * 2.5));
    if (ok[i]) open++;
  }
  for (let i = 0; i < 4; i++) if (ok[i] && ok[i + 4]) through = true;
  return open <= 4 && through;
}

/**
 * Whether to press the class ability this tick (every class ability except the glide, see raiderAir), plus hints:
 * `retarget` (warden: face the shooter first) and `cover` (warden behind its new wall / infiltrator breaking off).
 */
export function abilityIntent(sim: Sim, e: SimEntity, t: TacticsState, a: Archetype, g: NavGrid, chars: SimEntity[], k: TacticsInput): { press: boolean; retarget: SimEntity | null; cover: boolean } {
  const out = { press: false, retarget: null as SimEntity | null, cover: false };
  const def = e.abil ? abilityDef(e.abil.id) : null;
  if (!def || !def.live || !ready(sim, e, t) || pveHoldsBack(sim, e)) return out;
  const modeAge = sim.tick - k.modeTick;
  const hp = e.health!;
  const hurtRecently = sim.tick - hp.lastDamageTick < 30;
  switch (def.kind) {
    case 'cone_blast': {
      // anything within reach in front of the bot that it can perceive (never at a cloaked or grass-hidden enemy it
      // hasn't spotted: the bark would reveal it)
      const reach = def.range; // center distance; the blast reaches the capsule surface
      for (const c of chars) {
        if (c.team === e.team || c.dead) continue;
        if (!(k.visible && c === k.target) && (isStealthed(sim, c) || concealLevel(c) > 0)) continue;
        const dx = c.pos.x - e.pos.x, dz = c.pos.z - e.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > reach || Math.abs(c.pos.y - e.pos.y) > 2.5) continue;
        if (Math.abs(angleDelta(k.aimYaw, Math.atan2(-dx, -dz))) > def.halfAngle + 0.1) continue;
        out.press = true;
        break;
      }
      // room bots close in to use it: always on a target that is reloading, else on a roll (per target, every 8 s)
      if (!out.press && k.mode === 'engage' && k.visible && k.target && k.dist > reach && k.dist < 22 && e.kind === EntityKind.Bot && !e.combat?.pve
        && sim.tick >= t.pushUntil && roomModeOf(sim) !== 'yard-skirmish' && roomModeOf(sim) !== 'adventure') { // (co-op squads hold their range)
        const reloading = (k.target.wpn?.reload ?? 0) > 0.3;
        if (reloading || t.pushRolled !== k.target.id || sim.tick >= t.pushRollAt) {
          t.pushRolled = k.target.id;
          t.pushRollAt = sim.tick + 480;
          if (roll(sim, a, reloading ? 1 : 0.6)) t.pushUntil = sim.tick + 240;
        }
      }
      break;
    }
    case 'cloak': {
      if (k.mode === 'alert' && t.rolledFor !== k.modeTick) {
        t.rolledFor = k.modeTick;
        const d = Math.hypot(k.alertX - e.pos.x, k.alertZ - e.pos.z);
        if (d > 10 && d < 35 && roll(sim, a, 0.7)) out.press = true;
      } else if (k.mode === 'engage' && hurtRecently && hp.hp < hp.max * 0.5 && roll(sim, a, 0.06)) {
        out.press = true; out.cover = true;
      }
      break;
    }
    case 'drone': {
      if (ownEntities(sim, e, 'drone') > 0) break;
      const searching = (k.mode === 'patrol' && modeAge > 150) || (k.mode === 'alert' && modeAge > 45) || (k.mode === 'regroup' && modeAge > 90);
      const lost = k.mode === 'engage' && k.target !== null && !k.visible && sim.tick - k.lastSeenTick > 45;
      if ((searching || lost) && t.rolledFor !== k.modeTick) {
        t.rolledFor = k.modeTick;
        if (roll(sim, a, 1)) out.press = true;
      }
      break;
    }
    case 'charge': {
      // adventure destroy step: plant one next to the destructible (its fuse or a passing cat sets it off)
      if (t.goal === 'step' && t.destroy && Math.hypot(t.cx - e.pos.x, t.cz - e.pos.z) < 3.5 && ownEntities(sim, e, 'charge') === 0) { out.press = true; break; }
      if (k.mode === 'cover' && k.target && k.dist < 18) { out.press = roll(sim, a, 0.05); break; }
      if (k.mode === 'engage' && k.visible && k.target && k.dist < 16) {
        // an enemy closing in, or trading shots up close: mine the ground it has to cross
        const dx = e.pos.x - k.target.pos.x, dz = e.pos.z - k.target.pos.z;
        const closing = (k.target.vel.x * dx + k.target.vel.z * dz) / Math.max(1e-3, Math.hypot(dx, dz));
        if ((closing > 1.2 || (hurtRecently && k.dist < 12)) && roll(sim, a, 0.04)) out.press = true;
        break;
      }
      if (t.goal === 'step' && t.hold && Math.hypot(t.gx - e.pos.x, t.gz - e.pos.z) < t.gr && ownEntities(sim, e, 'charge') === 0) { out.press = true; break; }
      // chasing a noise / a lost target: leave one on the way (they may come back through here)
      if (k.mode === 'alert' && t.rolledFor !== k.modeTick && modeAge > 30) {
        t.rolledFor = k.modeTick;
        const d = Math.hypot(k.alertX - e.pos.x, k.alertZ - e.pos.z);
        if (d > 6 && d < 30 && roll(sim, a, 0.5)) out.press = true;
        break;
      }
      if (k.mode === 'patrol' && sim.tick >= t.chokeAt) {
        t.chokeAt = sim.tick + 60;
        if (inChokepoint(g, e) && roll(sim, a, 0.5)) out.press = true;
      }
      break;
    }
    case 'barrier': {
      // shot at in the open from range: face the shooter (retarget), then wall up
      if (sim.tick - hp.lastDamageTick < 24 && hp.hp < hp.max * 0.9 && sim.tick >= t.wallUntil) {
        const src = sim.entities.get(hp.lastAttacker);
        if (src && src.char && !src.dead && src.team !== e.team) {
          const d = Math.hypot(src.pos.x - e.pos.x, src.pos.z - e.pos.z);
          const exposed = worldLineClear(sim, src.pos.x, src.pos.y + eyeHeight(src), src.pos.z, e.pos.x, e.pos.y + characterHeight(e) * 0.6, e.pos.z);
          if (d > 6 && d < 40 && exposed && roll(sim, a, 1)) { t.wallFrom = src.id; t.wallUntil = sim.tick + 50; }
        }
      }
      if (sim.tick < t.wallUntil) {
        const src = sim.entities.get(t.wallFrom);
        if (!src || src.dead) { t.wallUntil = 0; break; }
        if (k.target !== src) out.retarget = src;
        const yaw = Math.atan2(-(src.pos.x - e.pos.x), -(src.pos.z - e.pos.z));
        if (Math.abs(angleDelta(k.aimYaw, yaw)) < 0.3) { out.press = true; out.cover = a.retreatHp > 0; t.wallUntil = 0; }
      }
      break;
    }
    default:
      break;
  }
  if (out.press) t.lock = sim.tick + 30;
  return out;
}

/**
 * Skyraider air routine: a jump becomes double jump + glide (press Jump near the apex of the first jump, Ability at
 * the apex of the second). Long patrol trips start a hop when the glide is ready. Returns the buttons to add.
 */
export function raiderAir(sim: Sim, e: SimEntity, t: TacticsState, travelling: boolean): { buttons: number; hop: boolean } {
  const c = e.char!;
  const out = { buttons: 0, hop: false };
  if (!e.abil || abilityDef(e.abil.id)?.kind !== 'glide' || e.flags & EFlag.Mounted) return out;
  const cd = (c as { glideCooldown?: number }).glideCooldown ?? 0;
  const gliding = ((c as { glideTime?: number }).glideTime ?? 0) > 0;
  if (c.grounded) {
    if (travelling && cd <= 0 && sim.tick >= t.hopAt) { out.hop = true; t.hopAt = sim.tick + 360; }
    return out;
  }
  if (gliding || cd > 0) return out;
  if (c.jumpsUsed === 1 && e.vel.y < 1.5 && e.vel.y > -3 && !(e.prevButtons & Btn.Jump)) out.buttons |= Btn.Jump;
  else if (c.jumpsUsed >= 2 && e.vel.y <= 0.3 && !(e.prevButtons & Btn.Ability)) out.buttons |= Btn.Ability;
  return out;
}

// ---------------------------------------------------------------- objectives

function coreSkipped(t: TacticsState, id: number, tick: number): boolean {
  for (let i = 0; i < t.skip.length; i += 2) if (t.skip[i] === id && t.skip[i + 1] > tick) return true;
  return false;
}

/** Give up on the current core goal for a while (unreachable / stuck). */
export function skipGoal(sim: Sim, t: TacticsState): void {
  if (t.goal === 'core') {
    t.skip.push(t.goalId, sim.tick + 1200);
    if (t.skip.length > 16) t.skip.splice(0, 2);
  }
  t.goal = '';
  t.goalAt = sim.tick + 120;
}

/** Any living enemy of `e` within r (m, horizontal) of (x, z)? */
function enemyNear(e: SimEntity, chars: SimEntity[], x: number, z: number, r: number): boolean {
  for (const c of chars) if (c.team !== e.team && !c.dead && Math.hypot(c.pos.x - x, c.pos.z - z) < r) return true;
  return false;
}

/** A human teammate within 90 m hurt in the last 3 s: the bot sticks with them instead of wandering off. */
export function buddyInTrouble(sim: Sim, e: SimEntity, chars: SimEntity[]): SimEntity | null {
  for (const c of chars) {
    if (c.team !== e.team || c === e || c.kind !== EntityKind.Player || c.dead || !c.health) continue;
    if (sim.tick - c.health.lastDamageTick > 180) continue;
    if (Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < 90) return c;
  }
  return null;
}

/** The team's objective runner: its lowest-id living bot. */
function isRunner(sim: Sim, e: SimEntity, chars: SimEntity[]): boolean {
  for (const c of chars) if (c.team === e.team && c.kind === EntityKind.Bot && !c.dead && c.id < e.id && !c.combat?.pve) return false;
  return true;
}

/** Room mode (the Room writes it; tests set it). */
function roomModeOf(sim: Sim): string {
  return (sim.state.room as { mode?: string } | undefined)?.mode ?? '';
}

/** core-rush: which pad this bot plays (attack or defend), or null. */
function pickPad(sim: Sim, e: SimEntity, chars: SimEntity[], pads: CorePadInfo[], current: EntityId): CorePadInfo | null {
  const enemy = e.team === 0 ? 1 : 0;
  // role: every other bot of the team (by id) attacks
  let rank = 0;
  for (const c of chars) if (c.team === e.team && c.kind === EntityKind.Bot && !c.combat?.pve && c.id < e.id) rank++;
  const attacker = rank % 2 === 0;
  const dist = (p: CorePadInfo) => Math.hypot(p.x - e.pos.x, p.z - e.pos.z);
  const keep = (p: CorePadInfo) => (p.id === current ? 12 : 0); // don't flip-flop between similar pads
  let best: CorePadInfo | null = null, bs = Infinity;
  const consider = (p: CorePadInfo, score: number) => { if (score < bs) { bs = score; best = p; } };
  const underAttack = (p: CorePadInfo) => p.owner === e.team && (p.contested || (p.holder === enemy && p.progress < 1));
  if (!attacker) for (const p of pads) if (underAttack(p)) consider(p, dist(p) - keep(p));
  if (!best) {
    for (const p of pads) {
      if (p.owner === e.team && !p.contested) continue;
      const pressure = (p.contested ? 15 : 0) + (p.holder === enemy && p.progress > 0 ? 10 : 0) + (p.holder === e.team ? 8 : 0);
      consider(p, dist(p) - pressure - keep(p));
    }
  }
  if (!best && !attacker) for (const p of pads) if (p.owner === e.team) consider(p, dist(p) - keep(p));
  if (!best && attacker) for (const p of pads) consider(p, dist(p) - keep(p)); // all ours: hold the nearest
  return best;
}

/**
 * Pick (or keep) the objective/core goal for a patrolling bot; writes t.goal/gx/gz/... ('' = none, patrol as usual).
 * Re-evaluated every 0.5 s.
 */
export function updateObjectiveGoal(sim: Sim, e: SimEntity, t: TacticsState, g: NavGrid, chars: SimEntity[]): void {
  if (sim.tick < t.goalAt) return;
  t.goalAt = sim.tick + 30;
  const prev = t.goal, prevId = t.goalId;
  t.goal = '';
  t.kiosk = false; t.destroy = false;
  if (isAdventureMode(sim)) { adventureGoal(sim, e, t, g, chars, prev, prevId); return; }
  if (e.combat?.pve || e.kind !== EntityKind.Bot) return;
  const hpFrac = e.health ? e.health.hp / e.health.max : 1;
  const buddy = buddyInTrouble(sim, e, chars) !== null;
  // core-rush pads
  if (roomModeOf(sim) === 'core-rush') {
    const pads = coreRushPads(sim);
    const p = pads.length ? pickPad(sim, e, chars, pads, prev === 'step' ? t.goalId : -1) : null;
    if (!p) return;
    const r = coreRushConfig(sim).padRadius;
    t.goal = 'step'; t.interact = false; t.hold = true;
    t.gr = r; t.gy = p.y; t.cx = p.x; t.cz = p.z;
    const same = prev === 'step' && prevId === p.id && Math.hypot(t.gx - p.x, t.gz - p.z) < r * 0.8;
    if (!same) {
      const c = randomCell(g, sim.rng, -1, p.x, p.z, r * 0.6);
      t.gx = c >= 0 ? cellX(g, c) : p.x; t.gz = c >= 0 ? cellZ(g, c) : p.z;
      t.goalSince = sim.tick;
    }
    t.goalId = p.id;
    return;
  }
  // the objective chain (its own team only; in a wave match the squad sticks together through the first wave)
  const st = objectiveState(sim);
  const chain = interactRuntime(sim).chain;
  const wave = (sim.state.match as { wave?: number } | undefined)?.wave ?? 0;
  const waveOk = roomModeOf(sim) !== 'yard-skirmish' || wave >= 2;
  if (st && chain && waveOk && st.team === e.team && st.step >= 0 && st.step < chain.steps.length) {
    const step = chain.steps[st.step];
    const tr = step.trigger;
    const hold = tr.type === 'hold';
    const runner = isRunner(sim, e, chars);
    // an interact step deep in enemy ground waits for a lull (no enemy near the point), unless the runner is close
    const near = Math.hypot(st.x - e.pos.x, st.z - e.pos.z) < 25;
    const safe = near || !enemyNear(e, chars, st.x, st.z, 30);
    if ((hold || runner) && !buddy && (hold || (hpFrac >= 0.5 && safe))) {
      t.goal = 'step';
      t.interact = tr.type === 'interact';
      t.hold = hold;
      t.gr = tr.params.radius;
      t.gy = st.y;
      t.cx = st.x; t.cz = st.z;
      t.goalId = st.step;
      if (hold) {
        // a spot inside the zone (kept while it stays inside)
        const inside = prev === 'step' && prevId === st.step && Math.hypot(t.gx - st.x, t.gz - st.z) < t.gr * 0.95;
        if (!inside) {
          // a walkable spot inside the zone (the middle may be a prop: the trampoline)
          let c = randomCell(g, sim.rng, -1, st.x, st.z, t.gr * 0.6);
          if (c < 0) c = randomCell(g, sim.rng, -1, st.x, st.z, t.gr * 0.92);
          if (c < 0) c = nearestWalkable(g, st.x, st.z, Math.ceil(t.gr));
          t.gx = c >= 0 ? cellX(g, c) : st.x; t.gz = c >= 0 ? cellZ(g, c) : st.z;
        }
      } else if (prev !== 'step' || prevId !== st.step) {
        // the point itself may be inside a prop (the Cat Tree): walk to the closest walkable cell, then straight in
        t.gx = st.x; t.gz = st.z;
        const c = nearestWalkable(g, st.x, st.z, Math.ceil(t.gr) + 2);
        if (c >= 0) { t.gx = cellX(g, c); t.gz = cellZ(g, c); }
      }
      if (prev !== 'step' || prevId !== st.step) t.goalSince = sim.tick;
      return;
    }
  }
  // Upgrade Cores: available, within 30 m, on walkable ground, the bot is healthy and no human teammate needs help
  if (hpFrac < 0.5 || buddy) return;
  const layout = interactConfig(sim).layout ?? pickupLayoutFor(sim.worldData.name);
  let best: SimEntity | null = null, bd = 30;
  for (const p of interactRuntime(sim).pickupEnts) {
    const pk = p.pickup;
    if (!pk || pk.kind !== 'core' || !pk.available || p.removed || coreSkipped(t, p.id, sim.tick)) continue;
    if (p.pos.y - sim.worldData.height(p.pos.x, p.pos.z) > 1.3) continue; // perches need platforming
    const d = Math.hypot(p.pos.x - e.pos.x, p.pos.z - e.pos.z);
    if (d < bd) { bd = d; best = p; }
  }
  if (!best) return;
  t.goal = 'core';
  t.goalId = best.id;
  t.interact = false; t.hold = false;
  t.gr = 0.5;
  t.gy = best.pos.y;
  const spot = layout?.cores[best.pickup!.spot];
  const route = spot?.route?.[0];
  // walk to the spot's open-lawn approach point first, then straight in
  const far = route && Math.hypot(route[0] - e.pos.x, route[2] - e.pos.z) > 1.5 && Math.hypot(best.pos.x - e.pos.x, best.pos.z - e.pos.z) > 3;
  if (far && route) { t.gx = route[0]; t.gz = route[2]; }
  else {
    const c = nearestWalkable(g, best.pos.x, best.pos.z, 1);
    t.gx = best.pos.x; t.gz = best.pos.z;
    if (c < 0 && !route) { skipGoal(sim, t); return; }
  }
  if (prev !== 'core' || prevId !== best.id) t.goalSince = sim.tick;
}

/** Press Interact at an interact step (edge; never next to a kart or a terminal, where E means something else). */
export function objectiveInteract(sim: Sim, e: SimEntity, t: TacticsState): number {
  if (t.goal !== 'step' || !t.interact || e.prevButtons & Btn.Interact) return 0;
  if (Math.hypot(t.cx - e.pos.x, t.cz - e.pos.z) > t.gr - 0.25 || Math.abs(e.pos.y - t.gy) > 3) return 0;
  for (const x of sim.entities.values()) {
    if (x.kind !== EntityKind.Vehicle && (x.kind !== EntityKind.Terminal || t.kiosk)) continue;
    if (Math.hypot(x.pos.x - e.pos.x, x.pos.z - e.pos.z) < 3.2) return 0;
  }
  return Btn.Interact;
}

// ---------------------------------------------------------------- adventure (A1)

/** Take a spot inside a zone (kept while it stays inside); the bot fights from inside it (brain holdZone). */
function zoneGoal(sim: Sim, t: TacticsState, g: NavGrid, x: number, z: number, r: number, id: number, prev: string, prevId: EntityId): void {
  t.goal = 'step'; t.interact = false; t.hold = true;
  t.gr = r; t.gy = sim.worldData.height(x, z); t.cx = x; t.cz = z;
  const same = prev === 'step' && prevId === id && Math.hypot(t.gx - x, t.gz - z) < r * 0.95;
  if (!same) {
    let c = randomCell(g, sim.rng, g.mainRegion, x, z, r * 0.6);
    if (c < 0) c = randomCell(g, sim.rng, -1, x, z, r * 0.92);
    if (c < 0) c = nearestWalkable(g, x, z, Math.ceil(r) + 2);
    t.gx = c >= 0 ? cellX(g, c) : x; t.gz = c >= 0 ? cellZ(g, c) : z;
    t.goalSince = sim.tick;
  }
  t.goalId = id;
}

/** Walk to a point (an item, a target): the point itself when walkable, else the closest walkable cell. */
function pointGoal(sim: Sim, t: TacticsState, g: NavGrid, x: number, z: number, id: number, prev: string, prevId: EntityId): void {
  t.goal = 'step'; t.interact = false; t.hold = false;
  t.gr = 0.5; t.gy = sim.worldData.height(x, z); t.cx = x; t.cz = z;
  t.gx = x; t.gz = z;
  if (!isWalkable(g, x, z)) {
    const c = nearestWalkable(g, x, z, 4);
    if (c >= 0) { t.gx = cellX(g, c); t.gz = cellZ(g, c); }
  }
  if (prev !== 'step' || prevId !== id) t.goalSince = sim.tick;
  t.goalId = id;
}

/** Chapter cat on sentry duty: pace the loop, dwelling at each waypoint (the facing sweeps as it turns). */
function sentryPost(sim: Sim, e: SimEntity, t: TacticsState): void {
  const s = e.adv!.sentry!;
  const n = s.route.length >> 1;
  const wx = s.route[s.i * 2], wz = s.route[s.i * 2 + 1];
  if (Math.hypot(wx - e.pos.x, wz - e.pos.z) < 1.1) {
    if (s.until === 0) s.until = sim.tick + Math.round((SENTRY_DWELL[0] + sim.rng() * (SENTRY_DWELL[1] - SENTRY_DWELL[0])) * 60);
    else if (sim.tick >= s.until && n > 1) { s.i = (s.i + 1) % n; s.until = 0; }
  }
  t.goal = 'post'; t.interact = false; t.hold = false;
  t.gx = s.route[s.i * 2]; t.gz = s.route[s.i * 2 + 1]; t.cx = t.gx; t.cz = t.gz; t.gr = 0.6; t.gy = e.pos.y;
  t.goalId = -9;
}

/** Adventure goals (see the header). Negative goal ids name zones, positive ones the entity walked to. */
function adventureGoal(sim: Sim, e: SimEntity, t: TacticsState, g: NavGrid, chars: SimEntity[], prev: string, prevId: EntityId): void {
  const st = adventureState(sim), def = adventureChapter(sim);
  if (!st || !def) return;
  if (e.combat?.pve) { if (e.adv?.sentry) sentryPost(sim, e, t); return; }
  if (e.kind !== EntityKind.Bot || e.team !== Team.Corgis) return;
  if (buddyInTrouble(sim, e, chars)) return; // help the human first
  const human = squadHasHuman(sim);
  const step = st.phase === 'live' ? adventureStep(sim) : null;
  const zid = -(10 + Math.max(0, st.step) * 8);
  if (!step || (step.stealth && !st.alarm && human)) { zoneGoal(sim, t, g, st.anchorX, st.anchorZ, 4, zid - 1, prev, prevId); return; }
  const tr = step.trigger;
  switch (tr.type) {
    case 'reach':
    case 'hold':
      zoneGoal(sim, t, g, tr.params.x, tr.params.z, tr.params.radius, zid - 2, prev, prevId);
      return;
    case 'interact': {
      const p = tr.params;
      if (human || !isRunner(sim, e, chars)) { zoneGoal(sim, t, g, p.x, p.z, p.radius + 3, zid - 3, prev, prevId); return; }
      t.goal = 'step'; t.interact = true; t.hold = false; t.kiosk = p.prompt === KIOSK_PROMPT;
      t.gr = p.radius; t.gy = sim.worldData.height(p.x, p.z); t.cx = p.x; t.cz = p.z;
      if (prev !== 'step' || prevId !== zid - 4) {
        // the point may be inside a prop (the kiosk): the closest walkable cell, then straight in
        t.gx = p.x; t.gz = p.z;
        const c = nearestWalkable(g, p.x, p.z, Math.ceil(p.radius) + 2);
        if (c >= 0) { t.gx = cellX(g, c); t.gz = cellZ(g, c); }
        t.goalSince = sim.tick;
      }
      t.goalId = zid - 4;
      return;
    }
    case 'collect': {
      const items = adventureItems(sim);
      if (!items.length) break;
      let rank = 0;
      for (const c of chars) if (c.team === e.team && c.kind === EntityKind.Bot && !c.combat?.pve && c.id < e.id) rank++;
      // the bot's share: one item each by rank (items in spawn order), so the squad spreads out
      const sorted = items.slice().sort((a, b) => a.id - b.id);
      const it = sorted[rank % sorted.length];
      pointGoal(sim, t, g, it.pos.x, it.pos.z, it.id, prev, prevId);
      return;
    }
    case 'defeat':
    case 'destroy': {
      const targets = adventureTargets(sim);
      let best: SimEntity | null = null, bd = Infinity;
      for (const x of targets) { const d = Math.hypot(x.pos.x - e.pos.x, x.pos.z - e.pos.z); if (d < bd) { bd = d; best = x; } }
      if (!best) break;
      pointGoal(sim, t, g, best.pos.x, best.pos.z, best.id, prev, prevId);
      if (tr.type === 'destroy') { t.destroy = true; t.gr = 2.5; }
      return;
    }
    case 'survive':
      zoneGoal(sim, t, g, st.anchorX, st.anchorZ, 7, zid - 5, prev, prevId);
      return;
  }
  zoneGoal(sim, t, g, st.anchorX, st.anchorZ, 5, zid - 1, prev, prevId);
}
