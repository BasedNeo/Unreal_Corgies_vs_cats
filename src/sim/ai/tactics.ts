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
// as sentries (stealth steps) walk their loop (goal 'post', `walk`) until the alarm turns them into hunters.
// A2 destroy steps: a destructible their weapon can hurt (hitscan on a prop that takes shots; an explosive lob on one
// that takes blasts) becomes the bot's prop target (`prop`): with nobody to fight, the brain stops in a standoff band
// (propMin..propMax: explosives keep 6.5 m off their own splash) and shoots it (brain.ts propShot). Props that only
// take a Dig Charge (the breach wall) are still walked up to and mined.
// Vehicles (B2a, vehicleThink — the brain hands a tick over to it right after perception):
//   board   a room bot (not a wave cat) on foot in patrol/alert/regroup whose trip (objective goal, patrol goal, noise)
//           is ≥ 45 m away takes the best own-team option: an empty Mower Kart (≥ 40 % armor) or a ready Kart-O-Matic
//           (walk up, E vends, E boards), when walking to it + driving beats walking by ≥ 0.5 s (drive.ts can reach the
//           trip from it). Never a kart or kiosk a human teammate is heading for (within 5 m of one, walking at it
//           from 25 m, or looking at it from 14 m), never one another bot has claimed. An adventure `vehicle` reach
//           step (the Garage Job's getaway) is driven for real by a bot-only squad (≥ 15 m, no time test); with a human
//           in the squad the kart is the human's.
//   drive   drive.ts steers to the trip (an objective that moves on is followed); a visible enemy in reach is rammed
//           when the ram pays off (same level, a clear line, a run-up to ≥ 8.5 m/s closing, damage ≥ 35 % of its max
//           or its hp; 3 runs per target, 5 s each); an enemy within 14 m that can't be rammed → hop out and fight.
//           A vehicle step drives calm (no rams, no hopping out to fight) and stays seated in the zone.
//   hop out near the trip's end (braking below 5 m/s first), at < 30 % armor (at any speed), a rider under fire below
//           55 % health, when the driver gives up
//           (stuck three times) or has no route, after 45 s; no new boarding for 8 s after.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Btn, type InputCmd } from '../../shared/input';
import { EFlag, EntityKind, Team, type EntityId } from '../../shared/types';
import { angleDelta } from '../../shared/math';
import { TICK_HZ } from '../../shared/constants';
import { TERMINALS, VEHICLES } from '../../shared/content/vehicles';
import { surfaceAt, yawToward } from '../../shared/world/queries';
import { kartForwardSpeed } from '../vehicles/kart';
import {
  controlsToInput, createDriver, createFlight, driveKart, driveLineClear, driveStats, flyPlane, kartNavFor, nearestDrivable,
  resetDriver, type DriveGoal, type DriverState, type FlightGoal, type FlightState, type KartControls,
} from './drive';
import { abilityDef } from '../../shared/content/abilities';
import { pickupLayoutFor } from '../../shared/content/pickups';
import { worldLineClear } from '../combat/geometry';
import { characterHeight, eyeHeight, isStealthed } from '../combat/state';
import { concealLevel } from '../world/env';
import { abilityEntities } from '../combat/ability-core';
import { objectiveState, interactRuntime, interactConfig } from '../interact';
import { coreRushConfig, coreRushPads, type CorePadInfo } from '../match/core-rush';
import { KIOSK_PROMPT } from '../../shared/content/chapters';
import { WEAPONS, type WeaponId } from '../../shared/content/weapons';
import { BREACH, DESTRUCT_KINDS, destructDistance } from '../../shared/world/destructibles';
import type { Destructible } from '../../shared/world/world-types';
import {
  SENTRY_DWELL, adventureChapter, adventureItems, adventureRuntime, adventureState, adventureStep, adventureTargets, isAdventureMode, squadHasHuman,
} from '../adventure/state';
import type { Archetype } from './archetypes';
import { type NavGrid, cellX, cellZ, findPath, isWalkable, lineWalkable, nearestWalkable, randomCell } from './nav';
import { canReach } from './nav-links';
import { laneGoal } from './lanes';
import { BALL_HELP, baPushCount, ballTrip, baseAssaultGoal, isCarrier, type BaBot } from './base-assault-ai';

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
  /** Objective/core goal (kind '' = none; 'post' = an adventure sentry's waypoint; 'lane' = a lane waypoint, lanes.ts),
   *  re-evaluated every ~0.5 s. */
  goal: '' | 'core' | 'step' | 'post' | 'lane' | 'ball'; // G4b: 'ball' = a base-assault role goal (base-assault-ai.ts)
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
  /**
   * A2 adventure destroy step: the destructible to shoot (-1 = none), its aim point, the standoff band (m) the bot
   * shoots it from, and (set by the brain) whether it is in sight and in the band, and lined up.
   */
  prop: EntityId;
  px: number; py: number; pz: number;
  propMin: number; propMax: number;
  propSeen: boolean;
  propLined: boolean;
  /** Walk to the goal instead of running (sentries pacing their posts). */
  walk: boolean;
  /** B2a: the goal is an adventure `reach` step that wants a vehicle (drive there for real, stay seated). */
  vehicle: boolean;
  /** B2b: the goal is the Rooftop Hangar (vend the RC plane and fly it); an airborne step's launch spot (glide off). */
  plane: boolean;
  glide: boolean;
  /** B2a: boarding and driving vehicles (vehicleThink). */
  ride: RideState;
  /** G4b: the bot's base-assault role and ball run (base-assault-ai.ts); unset outside that mode. */
  ba?: BaBot;
}

/** B2a: a bot's trip by vehicle (see vehicleThink). Plain data. */
export interface RideState {
  /**
   * idle (on foot, deciding every 0.5 s) · board (walking to a kart / plane / kiosk, pressing E) · drive (seated in a
   * kart or the plane) · leap (B2b: off a roof into an Ear Glide).
   */
  phase: 'idle' | 'board' | 'drive' | 'leap';
  /** The kart being boarded or driven, and the Kart-O-Matic to vend one from first (-1 = none). */
  kart: EntityId;
  term: EntityId;
  /** Where the trip goes, the radius that counts as there, stay seated there (a vehicle step), ignore fights. */
  destX: number; destZ: number; destR: number;
  stay: boolean;
  calm: boolean;
  /** Tick the phase began; last tick vehicleThink ran (a gap = the bot was dead); next boarding evaluation. */
  since: number;
  seen: number;
  evalAt: number;
  /** Boarding: closest approach so far and when (no progress for 2.5 s → give up). */
  bestD: number;
  bestTick: number;
  /** Boarding on foot: a nav route to the kart / kiosk. */
  walk: number[];
  walkIdx: number;
  walkGX: number; walkGZ: number;
  walkAt: number;
  /** Ram run: the target, until when, runs on this target, no new run before ramCool. */
  ram: EntityId;
  ramUntil: number;
  ramFor: EntityId;
  ramTries: number;
  ramCool: number;
  ramHitTick: number;
  /** Tick the current run (or its follow-up after a hit) began. */
  ramSince: number;
  /** Joust: after a run, head for (extendX, extendZ) until extendUntil (making room for the next one). */
  extendUntil: number;
  extendX: number; extendZ: number;
  drv: DriverState;
  /** B2b: the flight (strafing runs), the strike target (-1 none) and when it was picked, the leap's stage. */
  flight: FlightState;
  /** The last route check up to the hangar (canReach) and when to redo it. */
  reachOk: boolean;
  reachAt: number;
  strike: EntityId;
  strikeAt: number;
  leap: number;
  /** Telemetry: trips started (seated), hop-outs, ram hits; the driver's last status and why the bot wants out. */
  boards: number;
  hops: number;
  ramHits: number;
  status: string;
  out: string;
}

export function createRide(): RideState {
  return {
    phase: 'idle', kart: -1, term: -1, destX: 0, destZ: 0, destR: 0, stay: false, calm: false, since: 0, seen: -9999, evalAt: 0,
    bestD: Infinity, bestTick: 0, walk: [], walkIdx: 0, walkGX: 0, walkGZ: 0, walkAt: 0,
    ram: -1, ramUntil: 0, ramFor: -1, ramTries: 0, ramCool: 0, ramHitTick: -1, ramSince: 0, extendUntil: 0, extendX: 0, extendZ: 0, drv: createDriver(),
    flight: createFlight(), reachOk: false, reachAt: 0, strike: -1, strikeAt: 0, leap: 0, boards: 0, hops: 0, ramHits: 0, status: '', out: '',
  };
}

export function createTactics(): TacticsState {
  return {
    lock: 0, pushUntil: 0, pushRolled: -1, pushRollAt: 0, rolledFor: -1, wallFrom: -1, wallUntil: 0, holdUntil: 0, chokeAt: 0, hopAt: 0,
    goal: '', gx: 0, gz: 0, gy: 0, gr: 0, cx: 0, cz: 0, interact: false, hold: false, kiosk: false, destroy: false, goalId: -1, goalAt: 0, goalSince: 0, drone: -1, droneLined: false, skip: [],
    prop: -1, px: 0, py: 0, pz: 0, propMin: 0, propMax: 0, propSeen: false, propLined: false, walk: false, vehicle: false, plane: false, glide: false, ride: createRide(),
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

/**
 * Adventure destroy step: is the bot close enough to its destructible for a Dig Charge at its feet to do the job, and
 * is none of its own charges already there? A2: measured to the prop's nearest face (X1's breach reach, with margin),
 * not to its anchor, and a charge the bot left elsewhere no longer blocks this one (the oldest fizzles).
 */
function chargeFits(sim: Sim, e: SimEntity, t: TacticsState): boolean {
  const p = sim.entities.get(t.goalId);
  const def = (p as { dsx?: { def?: Destructible } } | undefined)?.dsx?.def;
  if (!def) return Math.hypot(t.cx - e.pos.x, t.cz - e.pos.z) < 3.5 && ownEntities(sim, e, 'charge') === 0;
  if (destructDistance(def, e.pos.x, e.pos.y + 0.3, e.pos.z) > BREACH.reach - 0.5) return false;
  for (const x of abilityEntities(sim)) {
    if (x.abx!.owner === e.id && x.abx!.kind === 'charge' && destructDistance(def, x.pos.x, x.pos.y + 0.3, x.pos.z) < BREACH.reach) return false;
  }
  return true;
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
      if (t.goal === 'step' && t.destroy && chargeFits(sim, e, t)) { out.press = true; break; }
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
    if (Math.hypot(c.pos.x - e.pos.x, c.pos.z - e.pos.z) < (e.ai?.tac.goal === 'ball' ? BALL_HELP : 90)) return c; // G4b: roles first
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
 * Re-evaluated every 0.5 s. W9 L3: with nothing else to do, a room bot walks its lane (lanes.ts; maps with lanes only).
 */
export function updateObjectiveGoal(sim: Sim, e: SimEntity, t: TacticsState, g: NavGrid, chars: SimEntity[]): void {
  if (sim.tick < t.goalAt) return;
  objectiveGoal(sim, e, t, g, chars);
  if (!t.goal) laneGoal(sim, e, t);
}

function objectiveGoal(sim: Sim, e: SimEntity, t: TacticsState, g: NavGrid, chars: SimEntity[]): void {
  t.goalAt = sim.tick + 30;
  const prev = t.goal, prevId = t.goalId;
  t.goal = '';
  t.kiosk = false; t.destroy = false; t.walk = false; t.prop = -1; t.vehicle = false; t.plane = false; t.glide = false;
  if (isAdventureMode(sim)) { adventureGoal(sim, e, t, g, chars, prev, prevId); return; }
  if (e.combat?.pve || e.kind !== EntityKind.Bot) return;
  if (roomModeOf(sim) === 'base-assault') {
    baseAssaultGoal(sim, e, t, g, chars, prev, prevId); // G4b: roles + ball runs
    // W10 N3: the team's pilot flies from the attackers (the surplus: never a carrier, guard, escort, returner or chaser),
    // once its team has made its first storm: the opening push goes in with everyone (a pilot at kick-off cost 14 % of
    // the captures; after the first storm 3 %, within noise, with a flight in 19 of 20 matches: docs/handoff/N3.md §3)
    if (t.ba?.role === 'attack' && baPushCount(sim)[e.team as 0 | 1] > 0 && buddyInTrouble(sim, e, chars) === null) planeGoal(sim, e, t, chars, prev, prevId);
    return;
  }
  const hpFrac = e.health ? e.health.hp / e.health.max : 1;
  const buddy = buddyInTrouble(sim, e, chars) !== null;
  if (!buddy && planeGoal(sim, e, t, chars, prev, prevId)) return; // B2b: the team's pilot heads for the Rooftop Hangar
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
/**
 * Stand in a zone. `hold` only for zones the squad defends (hold / survive steps): Breachers mine a hold zone, which
 * next to the Garage breach wall would blow it before the human's own step (Q2 P1-1: bots help, never steal the win).
 */
function zoneGoal(sim: Sim, t: TacticsState, g: NavGrid, x: number, z: number, r: number, id: number, prev: string, prevId: EntityId, hold = false): void {
  t.goal = 'step'; t.interact = false; t.hold = hold;
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
  t.goal = 'post'; t.interact = false; t.hold = false; t.walk = true;
  t.gx = s.route[s.i * 2]; t.gz = s.route[s.i * 2 + 1]; t.cx = t.gx; t.cz = t.gz; t.gr = 0.6; t.gy = e.pos.y;
  t.goalId = -9;
}

/**
 * A2: walk up to a destructible on the bot's own side of it: the walkable cell by its face nearest the bot (a breach
 * wall is reachable from the alley and from inside; its anchor's nearest cell could be on the far side).
 */
function approachProp(t: TacticsState, g: NavGrid, e: SimEntity, p: SimEntity): void {
  const def = (p as { dsx?: { def?: Destructible } }).dsx?.def;
  if (!def) return;
  const d = destructDistance(def, e.pos.x, e.pos.y + 0.5, e.pos.z, near);
  if (d < 1e-3) return;
  const k = Math.min(1, 1.1 / d);
  const c = nearestWalkable(g, near.x + (e.pos.x - near.x) * k, near.z + (e.pos.z - near.z) * k, 2);
  if (c >= 0) { t.gx = cellX(g, c); t.gz = cellZ(g, c); }
}
const near = { x: 0, y: 0, z: 0 };

/**
 * A2: can this bot's weapon hurt the destructible `p`, and from how far? Hitscan (not charged) on a prop that takes
 * shots; an explosive lob on a prop that takes full blasts. Sets the prop target (aim point = its center).
 */
function propTarget(e: SimEntity, t: TacticsState, p: SimEntity): void {
  const def = (p as { dsx?: { def?: Destructible } }).dsx?.def;
  const w = e.wpn ? WEAPONS[e.wpn.id as WeaponId] : null;
  if (!def || !w) return;
  const rule = DESTRUCT_KINDS[def.kind];
  const lob = w.kind === 'projectile' && (w.projectile?.explodeRadius ?? 0) > 0;
  if (lob ? rule.blastMult < 1 : w.kind !== 'hitscan' || w.chargeTime > 0 || rule.shotMult <= 0) return;
  t.prop = p.id;
  t.px = def.cx; t.py = def.cy; t.pz = def.cz;
  t.propMin = lob ? 6.5 : 0;
  t.propMax = lob ? 24 : Math.min(18, w.range * 0.8);
}

/** Adventure goals (see the header). Negative goal ids name zones, positive ones the entity walked to. */
/** Seconds a destroy step belongs to the human before the pups help (the set piece is theirs; Q3 P1-1). */
export const DESTROY_HOLD_OFF = 25;

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
      zoneGoal(sim, t, g, tr.params.x, tr.params.z, tr.params.radius, zid - 2, prev, prevId, tr.type === 'hold');
      // N1: a zone up on a deck (minY: the garage roof): stand on it, the brain climbs there through the nav links
      {
        const minY = (tr.params as { minY?: number }).minY;
        if (minY !== undefined && minY - sim.worldData.height(tr.params.x, tr.params.z) > 1.5 && Number.isFinite(canReach(sim, e, tr.params.x, minY, tr.params.z))) {
          t.gx = tr.params.x; t.gz = tr.params.z; t.gy = minY;
        }
      }
      t.vehicle = tr.type === 'reach' && !!tr.params.vehicle; // B2a: drive there for real (vehicleThink)
      if (tr.type === 'reach' && tr.params.airborne && !human) glideGoal(sim, e, t, chars, def); // B2b: glide there for real
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
      // Q3 P1-1: with a human in the squad a destroy step is their set piece (ch3's breach): pups cover the approach
      // for DESTROY_HOLD_OFF s and only then help, so a player who is stuck still fails forward
      if (tr.type === 'destroy' && human && (adventureRuntime(sim)?.stepTicks ?? 0) < DESTROY_HOLD_OFF * TICK_HZ) {
        zoneGoal(sim, t, g, best.pos.x, best.pos.z, 8, zid - 6, prev, prevId);
        return;
      }
      pointGoal(sim, t, g, best.pos.x, best.pos.z, best.id, prev, prevId);
      if (tr.type === 'destroy') { t.destroy = true; t.gr = 2.5; propTarget(e, t, best); approachProp(t, g, e, best); }
      return;
    }
    case 'survive':
      zoneGoal(sim, t, g, st.anchorX, st.anchorZ, 7, zid - 5, prev, prevId, true);
      return;
  }
  zoneGoal(sim, t, g, st.anchorX, st.anchorZ, 5, zid - 1, prev, prevId);
}

// ---------------------------------------------------------------- vehicles (B2a)

/** Trips at least this far (m) are worth a kart. */
export const DRIVE_MIN = 45;
/** Seconds between boarding evaluations of an idle bot; seconds before boarding again after a hop-out. */
const EVAL_EVERY = 0.5;
const HOP_COOLDOWN = 8;
/** Walk at most this far (m) to a kart or kiosk (a vehicle step: farther). */
const BOARD_REACH = 35;
const BOARD_REACH_STEP = 70;
/** Seconds of boarding before giving up; seconds without getting closer. */
const BOARD_TIMEOUT = 15;
const BOARD_STALL = 2.5;
/**
 * Time model (s, m, m/s; measured on the West Yard): mount / vend overheads, route detours, a kart cruising at 15 m/s
 * after a spin-up that costs 0.7 s over cruising all the way, and its stop; a bot walking sprints until the last 18 m
 * (TAIL_WALK s more than sprinting it all).
 */
const MOUNT_COST = 0.3, VEND_COST = 1.2;
const WALK_DETOUR = 1.1, DRIVE_DETOUR = 1.15;
const KART_SPINUP = 0.7, KART_CRUISE = 15, KART_STOP = 0.5, TAIL_WALK = 0.9;
/** Drive only when it saves this much time (s). */
const SAVE_MIN = 0.5;
/** A human teammate this close to a kart/kiosk has dibs; so has one walking at it from HUMAN_HEADING m, or looking at it from HUMAN_LOOK m. */
const HUMAN_NEAR = 5, HUMAN_HEADING = 25, HUMAN_LOOK = 14;
/** A rider under fire below this health fraction gets out (riders sit exposed above the hood). */
const RIDER_BAIL = 0.55;
/** Board only karts with at least this armor fraction. */
const KART_MIN_HP = 0.4;
/** Hop out below this armor fraction (at any speed); brake below HOP_SPEED (m/s) before a planned hop-out. */
const BAIL_HP = 0.3;
const HOP_SPEED = 5;
/** Seconds a trip may last before the bot gets out and walks. */
const MAX_RIDE = 45;
/** Enemy this close (m) that can't be rammed: get out and fight. */
const FIGHT_RANGE = 14;
/** Ram runs: range (m), seconds per run, runs per target, pause between runs (s). */
const RAM_MIN = 3, RAM_MAX = 45, RAM_RUN = 5, RAM_TRIES = 3, RAM_PAUSE = 1.2;
/** A fighting bot hops into an empty kart this close (m) to ram its target; seconds before it may after a hop-out. */
const BOARD_TO_RAM = 10, FIGHT_COOLDOWN = 3;
/** Seconds a run stays on a pet it just hit (it lands ahead of the kart: the follow-up). */
const RAM_FOLLOW = 3;
/** Seconds a joust carries on straight after a run before swinging round. */
const EXTEND = 1.6;

/** The slice of the brain's state (brain.ts AiState) the vehicle tactics read and write. */
export interface VehicleBrain {
  mode: 'patrol' | 'alert' | 'engage' | 'cover' | 'regroup';
  target: EntityId;
  visible: boolean;
  hasGoal: boolean;
  goalX: number; goalZ: number;
  alertX: number; alertZ: number;
  yaw: number; pitch: number;
  lastX: number; lastZ: number;
  odo: number;
  stuck: number;
  path: number[];
  tac: TacticsState;
  /** N1: the perch the bot climbs to / holds (it doesn't drive then), and the link runner (-1 = not on a climb). */
  perch?: { pauseUntil: number } | null;
  nav?: { link: number; elev: boolean };
}

/** The slice of the brain's per-tick context (brain.ts AiContext) the vehicle tactics use. */
export interface VehicleCtx {
  grid: NavGrid | null;
  chars: SimEntity[];
  pathBudget: number;
}

interface Trip { x: number; z: number; r: number; stay: boolean; calm: boolean }
const trip: Trip = { x: 0, z: 0, r: 0, stay: false, calm: false };
const ctrl: KartControls = { throttle: 0, steer: 0, boost: false, handbrake: false };
const goalTmp: DriveGoal = { x: 0, z: 0, r: 0, stop: true, ram: false };

/** The objective the brain would walk to in patrol, as a trip (null = none; also for a goal up on a deck: N1 climbs). */
function objectiveTrip(sim: Sim, t: TacticsState): Trip | null {
  if ((t.goal === 'step' || t.goal === 'core') && t.gy - sim.worldData.height(t.gx, t.gz) > 1.5) return null;
  if (t.goal === 'step') {
    trip.x = t.gx; trip.z = t.gz;
    trip.r = t.vehicle ? Math.max(1.5, t.gr * 0.4) : t.hold ? Math.max(2.5, t.gr * 0.6) : 5;
    trip.stay = t.vehicle; trip.calm = t.vehicle;
    return trip;
  }
  if (t.goal === 'core') { trip.x = t.gx; trip.z = t.gz; trip.r = 6; trip.stay = false; trip.calm = false; return trip; }
  if (t.goal === 'ball') return ballTrip(t, trip) ? trip : null; // G4b: to the enemy ball, a far post (never carriers, escorts)
  return null;
}

/** Where the bot is going on foot right now (objective, patrol goal, a noise), as a trip; null = nowhere far. */
function tripOf(sim: Sim, ai: VehicleBrain): Trip | null {
  if (ai.mode === 'patrol') {
    if (ai.tac.goal) return objectiveTrip(sim, ai.tac);
    if (ai.perch && sim.tick >= ai.perch.pauseUntil) return null; // N1: climbing to / holding a perch
    if (ai.hasGoal) { trip.x = ai.goalX; trip.z = ai.goalZ; trip.r = 8; trip.stay = false; trip.calm = false; return trip; }
    return null;
  }
  if (ai.mode === 'alert') { trip.x = ai.alertX; trip.z = ai.alertZ; trip.r = 12; trip.stay = false; trip.calm = false; return trip; }
  if (ai.mode === 'regroup' && ai.hasGoal) { trip.x = ai.goalX; trip.z = ai.goalZ; trip.r = 6; trip.stay = false; trip.calm = false; return trip; }
  return null;
}

function setTrip(r: RideState, tr: Trip): void {
  r.destX = tr.x; r.destZ = tr.z; r.destR = tr.r; r.stay = tr.stay; r.calm = tr.calm;
}

/** Another bot of the team has this kart or kiosk in its trip. */
function claimed(chars: SimEntity[], e: SimEntity, id: EntityId): boolean {
  for (const c of chars) {
    if (c === e || c.team !== e.team) continue;
    const r = c.ai?.tac.ride;
    if (r && r.phase !== 'idle' && (r.kart === id || r.term === id)) return true;
  }
  return false;
}

/**
 * A human teammate is heading for this kart or kiosk: within HUMAN_NEAR m, or walking at it from HUMAN_HEADING m, or
 * looking at it from HUMAN_LOOK m. Bots never take it then.
 */
export function humanWants(chars: SimEntity[], team: number, x: number, z: number): boolean {
  for (const c of chars) {
    if (c.team !== team || c.kind !== EntityKind.Player || c.dead || c.seat) continue;
    const dx = x - c.pos.x, dz = z - c.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < HUMAN_NEAR) return true;
    if (d < HUMAN_HEADING) {
      const sp = Math.hypot(c.vel.x, c.vel.z);
      if (sp > 1.5 && (c.vel.x * dx + c.vel.z * dz) / (sp * d) > 0.8) return true;
    }
    if (d < HUMAN_LOOK && Math.abs(angleDelta(c.yaw, yawToward(c.pos.x, c.pos.z, x, z))) < 0.35) return true;
  }
  return false;
}

/** Seconds a kart takes over d m (spin-up, cruise, stop). */
function driveTime(d: number): number {
  return KART_SPINUP + d / KART_CRUISE + KART_STOP;
}

function kartUsable(e: SimEntity, v: SimEntity): boolean {
  const k = v.kart;
  if (!k || v.removed || k.rider >= 0 || !v.health || v.health.hp < v.health.max * KART_MIN_HP || v.team !== e.team) return false;
  if (Math.hypot(v.vel.x, v.vel.z) > VEHICLES[k.id].mountMaxSpeed || Math.abs(v.pos.y - e.pos.y) > 1.5) return false;
  return true;
}

/** A ready vehicle terminal of this kind the bot may use (own team, or a neutral one: the Rooftop Hangar). */
function kioskUsable(e: SimEntity, v: SimEntity, id: 'kart_terminal' | 'plane_hangar' = 'kart_terminal'): boolean {
  const t = v.terminal;
  if (!t || t.id !== id || (v.team !== e.team && !TERMINALS[t.id].neutral)) return false;
  return t.kart < 0 && t.cooldown <= 0 && Math.abs(v.pos.y - e.pos.y) < 1.8;
}

/** A kart or plane the bot may board now. */
function vehicleUsable(e: SimEntity, v: SimEntity): boolean {
  return v.kart ? kartUsable(e, v) : v.plane ? planeUsable(e, v) : false;
}

/** Idle bot: is a kart worth it for the current trip? Starts boarding the best option. */
function considerBoarding(sim: Sim, e: SimEntity, ai: VehicleBrain, g: NavGrid, chars: SimEntity[]): void {
  const r = ai.tac.ride;
  r.evalAt = sim.tick + Math.round(EVAL_EVERY * TICK_HZ);
  if (!e.char || !e.char.grounded) return;
  if (ai.nav && (ai.nav.link >= 0 || ai.nav.elev)) return; // N1: mid-climb, or up on a deck
  const step = ai.tac.goal === 'step' && ai.tac.vehicle && ai.mode === 'patrol';
  // adventure: pups drive only for a step that asks for it, and never with a human in the squad (the kart is theirs)
  if (isAdventureMode(sim) && (!step || squadHasHuman(sim))) return;
  if (ai.mode === 'engage') { boardToRam(sim, e, ai, g, chars); return; }
  const tr = tripOf(sim, ai);
  if (!tr) return;
  const D = Math.hypot(tr.x - e.pos.x, tr.z - e.pos.z);
  if (D < (step ? 15 : DRIVE_MIN)) return;
  const nav = kartNavFor(g, sim.worldData);
  const run = e.char.move.sprintSpeed * 0.95;
  const walkT = (D * WALK_DETOUR) / run + TAIL_WALK;
  let best: SimEntity | null = null, bestT = Infinity;
  for (const v of sim.entities.values()) {
    let px: number, pz: number, cost: number;
    if (v.kart) { if (!kartUsable(e, v)) continue; px = v.pos.x; pz = v.pos.z; cost = MOUNT_COST; }
    else if (v.terminal) { if (!kioskUsable(e, v)) continue; px = v.terminal.padX; pz = v.terminal.padZ; cost = VEND_COST; }
    else continue;
    const dWalk = Math.hypot(v.pos.x - e.pos.x, v.pos.z - e.pos.z);
    if (dWalk > (step ? BOARD_REACH_STEP : BOARD_REACH)) continue;
    if (claimed(chars, e, v.id) || humanWants(chars, e.team, v.pos.x, v.pos.z)) continue;
    // where a kart from here can take the bot: the drivable cell nearest the trip's end, in the kart's region
    const kc = nearestDrivable(g, nav, px, pz, 3);
    if (kc < 0) continue;
    const dc = nearestDrivable(g, nav, tr.x, tr.z, 10, nav.region[kc]);
    if (dc < 0) continue;
    const ex = cellX(g, dc), ez = cellZ(g, dc);
    const tail = Math.hypot(tr.x - ex, tr.z - ez);
    if (step && tail > tr.r + 4) continue;
    const t = (dWalk * WALK_DETOUR) / run + cost + driveTime(Math.hypot(ex - px, ez - pz) * DRIVE_DETOUR) + tail / run;
    if (t < bestT) { bestT = t; best = v; }
  }
  if (!best || (!step && bestT > walkT - SAVE_MIN)) return;
  r.phase = 'board';
  r.kart = best.kart ? best.id : -1;
  r.term = best.terminal ? best.id : -1;
  r.since = sim.tick;
  r.bestD = Infinity; r.bestTick = sim.tick;
  r.walk.length = 0;
  setTrip(r, tr);
}

/**
 * In a fight, a few steps from an empty own-team kart (≤ BOARD_TO_RAM m), with the target in sight where a ram from that
 * kart pays off: hop in to ram it (the trip ends where the bot stands).
 */
function boardToRam(sim: Sim, e: SimEntity, ai: VehicleBrain, g: NavGrid, chars: SimEntity[]): void {
  const r = ai.tac.ride;
  if (e.health && e.health.hp < e.health.max * RIDER_BAIL) return; // Q3 P2-4: hurt, it would bail at once (driveTick's 'hurt')
  const t = ai.target >= 0 && ai.visible ? sim.entities.get(ai.target) : undefined;
  if (!t || t.dead || !t.char || t.team === e.team || (ai.tac.goal === 'step' && ai.tac.vehicle)) return;
  for (const v of sim.entities.values()) {
    if (!v.kart || !kartUsable(e, v) || Math.hypot(v.pos.x - e.pos.x, v.pos.z - e.pos.z) > BOARD_TO_RAM) continue;
    if (claimed(chars, e, v.id) || humanWants(chars, e.team, v.pos.x, v.pos.z)) continue;
    const dmg = ramDamage(sim, v, t, g);
    const def = VEHICLES[v.kart!.id];
    if (dmg <= 0 || def.ramDamageBase + (dmg - def.ramDamageBase) * RAM_GLANCE < t.health!.hp * 0.7) continue; // worth leaving the fight for
    r.phase = 'board'; r.kart = v.id; r.term = -1; r.since = sim.tick;
    r.bestD = Infinity; r.bestTick = sim.tick; r.walk.length = 0;
    trip.x = e.pos.x; trip.z = e.pos.z; trip.r = 6; trip.stay = false; trip.calm = false;
    setTrip(r, trip);
    return;
  }
}

/** The match is in its result hold (TDM / core-rush / skirmish 'ended'); the adventure runs its own phases. */
function matchEnded(sim: Sim): boolean {
  return (sim.state.match as { phase?: string } | undefined)?.phase === 'ended';
}

/** Leave the ride state (hopped out, thrown out, died, gave up boarding); no new boarding for `cooldown` s. */
function endRide(sim: Sim, e: SimEntity, ai: VehicleBrain, cooldown: number): void {
  const r = ai.tac.ride;
  if (r.phase === 'drive') r.hops++;
  r.phase = 'idle'; r.kart = -1; r.term = -1; r.ram = -1;
  r.walk.length = 0;
  r.evalAt = sim.tick + Math.round(cooldown * TICK_HZ);
  // the brain's odometer and route are stale after a ride
  ai.lastX = e.pos.x; ai.lastZ = e.pos.z; ai.odo = 0; ai.stuck = 0;
  ai.path.length = 0;
}

/** Walk toward (gx, gz) (nav route unless the line is open, straight in over the last 3.5 m); writes inp. */
function walkToward(sim: Sim, e: SimEntity, ai: VehicleBrain, ctx: VehicleCtx, gx: number, gz: number, inp: InputCmd, dt: number): number {
  const g = ctx.grid!;
  const r = ai.tac.ride;
  const d = Math.hypot(gx - e.pos.x, gz - e.pos.z);
  let tx = gx, tz = gz;
  const up = e.pos.y - sim.worldData.height(e.pos.x, e.pos.z) > 1.5; // on a roof: the ground grid doesn't cover it
  if (d > 3.5 && !up && !lineWalkable(g, e.pos.x, e.pos.z, gx, gz, true)) {
    const stale = !r.walk.length || Math.hypot(gx - r.walkGX, gz - r.walkGZ) > 1.5 || sim.tick >= r.walkAt;
    if (stale && ctx.pathBudget > 0) {
      ctx.pathBudget--;
      findPath(g, e.pos.x, e.pos.z, gx, gz, r.walk);
      r.walkIdx = 0; r.walkGX = gx; r.walkGZ = gz; r.walkAt = sim.tick + 120;
    }
    const n = r.walk.length >> 1;
    if (n) {
      while (r.walkIdx < n - 1 && Math.hypot(r.walk[r.walkIdx * 2] - e.pos.x, r.walk[r.walkIdx * 2 + 1] - e.pos.z) < 0.8) r.walkIdx++;
      const k = r.walkIdx + 1;
      if (k < n && lineWalkable(g, e.pos.x, e.pos.z, r.walk[k * 2], r.walk[k * 2 + 1], true)) r.walkIdx = k;
      tx = r.walk[r.walkIdx * 2]; tz = r.walk[r.walkIdx * 2 + 1];
    }
  }
  let mx = tx - e.pos.x, mz = tz - e.pos.z;
  const l = Math.hypot(mx, mz);
  if (l > 1e-3) { mx /= l; mz /= l; } else { mx = 0; mz = 0; }
  if (mx || mz) {
    const want = Math.atan2(-mx, -mz);
    const step = 10 * dt;
    ai.yaw += clampAbs(angleDelta(ai.yaw, want), step);
  }
  const sy = Math.sin(ai.yaw), cy = Math.cos(ai.yaw);
  inp.mz = mx * -sy + mz * -cy;
  inp.mx = mx * cy + mz * -sy;
  inp.yaw = ai.yaw; inp.pitch = ai.pitch = 0;
  inp.buttons = d > 6 && inp.mz > 0.5 ? Btn.Sprint : 0;
  return d;
}

const clampAbs = (v: number, m: number) => (v > m ? m : v < -m ? -m : v);

/** Stand still this tick and press E (edge: a released tick between presses). */
function pressE(e: SimEntity, inp: InputCmd): void {
  inp.mx = 0; inp.mz = 0;
  inp.buttons = e.prevButtons & Btn.Interact ? 0 : Btn.Interact;
}

/** Boarding: walk to the kiosk (E vends) and then the kart (E boards). False = gave up (the brain runs this tick). */
function boardTick(sim: Sim, e: SimEntity, ai: VehicleBrain, ctx: VehicleCtx, inp: InputCmd, dt: number): boolean {
  const r = ai.tac.ride;
  const now = sim.tick;
  // a fight nearby comes first; so does a stalled or overlong walk
  const foe = ai.target >= 0 ? sim.entities.get(ai.target) : undefined;
  const kartNear = r.kart >= 0 && r.term < 0 && (() => { const k = sim.entities.get(r.kart); return !!k && Math.hypot(k.pos.x - e.pos.x, k.pos.z - e.pos.z) < BOARD_TO_RAM + 1; })();
  const fight = !kartNear && (ai.mode === 'engage' || ai.mode === 'cover') && foe && !foe.dead && Math.hypot(foe.pos.x - e.pos.x, foe.pos.z - e.pos.z) < 30;
  if (fight || now - r.since > BOARD_TIMEOUT * TICK_HZ || now - r.bestTick > BOARD_STALL * TICK_HZ) {
    endRide(sim, e, ai, fight ? 3 : 10);
    return false;
  }
  if (r.term >= 0) {
    const term = sim.entities.get(r.term);
    const t = term?.terminal;
    if (!term || !t) { endRide(sim, e, ai, 3); return false; }
    if (t.kart >= 0) {
      // vended (by this bot's E, or someone else's): board it when it is free
      const k = sim.entities.get(t.kart);
      if (!k || !vehicleUsable(e, k) || claimed(ctx.chars, e, k.id)) { endRide(sim, e, ai, 5); return false; }
      r.kart = k.id; r.term = -1;
      r.bestD = Infinity; r.bestTick = now;
    } else {
      if (!kioskUsable(e, term, t.id) || humanWants(ctx.chars, e.team, term.pos.x, term.pos.z)) { endRide(sim, e, ai, 5); return false; }
      const d = walkToward(sim, e, ai, ctx, term.pos.x, term.pos.z, inp, dt);
      if (d < r.bestD - 0.3) { r.bestD = d; r.bestTick = now; }
      if (d <= TERMINALS[t.id].useRange - 0.6) { pressE(e, inp); r.bestTick = now; }
      return true;
    }
  }
  const kart = r.kart >= 0 ? sim.entities.get(r.kart) : undefined;
  if (!kart || !vehicleUsable(e, kart) || humanWants(ctx.chars, e.team, kart.pos.x, kart.pos.z)) { endRide(sim, e, ai, 5); return false; }
  const d = walkToward(sim, e, ai, ctx, kart.pos.x, kart.pos.z, inp, dt);
  if (d < r.bestD - 0.3) { r.bestD = d; r.bestTick = now; }
  if (d <= VEHICLES[kart.kart ? kart.kart.id : kart.plane!.id].mountRange - 0.6) { pressE(e, inp); r.bestTick = now; }
  return true;
}

/**
 * Does ramming `t` pay off from this kart? Same level, 3–45 m, a clear drivable line, a run-up to a closing speed
 * ≥ ramMinSpeed + 2.5 (after the target's own speed away), and the hit worth ≥ 35 % of its max hp (or all it has).
 */
export function ramPays(sim: Sim, kart: SimEntity, t: SimEntity, g: NavGrid): boolean {
  return ramDamage(sim, kart, t, g) > 0;
}

/** The damage a ram on `t` from this kart is expected to deal when it pays off (see ramPays), else 0. */
export function ramDamage(sim: Sim, kart: SimEntity, t: SimEntity, g: NavGrid): number {
  const k = kart.kart;
  if (!k || !t.char || !t.health || t.dead || t.seat || t.kind === EntityKind.Boss) return 0;
  if (!kart.health || kart.health.hp < kart.health.max * 0.4) return 0;
  const dy = t.pos.y - kart.pos.y;
  if (dy > 0.6 || dy < -0.9) return 0;
  const dx = t.pos.x - kart.pos.x, dz = t.pos.z - kart.pos.z;
  const d = Math.hypot(dx, dz);
  if (d < RAM_MIN || d > RAM_MAX) return 0;
  const def = VEHICLES[k.id];
  const v = Math.max(0, kartForwardSpeed(kart));
  const err = Math.abs(angleDelta(kart.yaw, yawToward(kart.pos.x, kart.pos.z, t.pos.x, t.pos.z)));
  const runUp = Math.max(0, d - (err > 1 ? 6 : err > 0.5 ? 3 : 0) - 1);
  const vHit = Math.min(k.boost > 0.2 ? def.boostSpeed : def.topSpeed, Math.sqrt(v * v + 2 * 10 * runUp));
  const away = Math.max(0, (t.vel.x * dx + t.vel.z * dz) / d);
  const closing = vHit - away;
  if (closing < def.ramMinSpeed + 2.5) return 0;
  if (!driveLineClear(g, kartNavFor(g, sim.worldData), kart.pos.x, kart.pos.z, t.pos.x, t.pos.z)) return 0;
  const dmg = def.ramDamageBase + (closing - def.ramMinSpeed) * def.ramDamagePerMs;
  return dmg >= Math.min(t.health.hp, t.health.max * 0.35) ? dmg : 0;
}

/**
 * The best enemy to ram from this kart right now (null = none pays): enemies on foot the rider can see (the brain's
 * target, or anyone in a clear line from the seat), in front or far enough to swing round, where ramPays(); slow,
 * hurt, close and centred targets first. A target already run at RAM_TRIES times is skipped.
 */
function ramPick(sim: Sim, e: SimEntity, kart: SimEntity, chars: SimEntity[], g: NavGrid, r: RideState): SimEntity | null {
  const ai = e.ai;
  const ey = kart.pos.y + 1.3;
  let best: SimEntity | null = null, bs = Infinity;
  for (const c of chars) {
    if (c.team === e.team || c.dead || c.seat || !c.health) continue;
    // a pet one more hit would finish gets a couple of extra runs
    if (c.id === r.ramFor && r.ramTries >= RAM_TRIES + (c.health.hp < 45 ? 2 : 0)) continue;
    const dx = c.pos.x - kart.pos.x, dz = c.pos.z - kart.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < RAM_MIN || d > RAM_MAX) continue;
    const err = Math.abs(angleDelta(kart.yaw, yawToward(kart.pos.x, kart.pos.z, c.pos.x, c.pos.z)));
    if (err > 1.3 && d < 10) continue; // too close behind to swing round onto
    // the pet it just rammed is remembered (it flew off behind the kart): come round on it without a sight line
    const seen = (ai && ai.target === c.id && ai.visible) || (c.id === r.ramFor && sim.tick - r.ramHitTick < RAM_MEMORY * TICK_HZ);
    if (!seen && (isStealthed(sim, c) || concealLevel(c) > 0.5 || !worldLineClear(sim, kart.pos.x, ey, kart.pos.z, c.pos.x, c.pos.y + 1, c.pos.z))) continue;
    const dmg = ramDamage(sim, kart, c, g);
    if (dmg <= 0) continue;
    // a ram that finishes it first, then the closest, most centred, slowest, most hurt
    const away = Math.max(0, (c.vel.x * dx + c.vel.z * dz) / d); // a pet running off soaks up the hit's speed
    // most hits on a dodging pet land off-centre (measured: ~45–60 % of the head-on damage): a pet even that would
    // finish comes first
    const def = VEHICLES[kart.kart!.id];
    const glancing = def.ramDamageBase + Math.max(0, dmg - def.ramDamageBase) * RAM_GLANCE;
    // a pet facing the kart backs off from it as it comes (bots keep their range): one busy elsewhere takes the full hit
    const watching = Math.abs(angleDelta(c.yaw, yawToward(c.pos.x, c.pos.z, kart.pos.x, kart.pos.z))) < 0.6 ? 10 : 0;
    const score = d * (0.55 + 0.45 * (c.health.hp / c.health.max)) + err * 8 + Math.hypot(c.vel.x, c.vel.z) * 0.8 + away * 2 + watching
      - (glancing >= c.health.hp ? 40 : dmg >= c.health.hp ? 15 : 0);
    if (score < bs) { bs = score; best = c; }
  }
  return best;
}
const RAM_SCAN = 12;
/** Seconds a kart remembers the pet it last hit (for the next run). */
const RAM_MEMORY = 4;
/** Share of a head-on ram's extra damage an off-centre hit keeps (target choice only). */
const RAM_GLANCE = 0.4;

/** Closing speed (m/s) of the kart on a pet right now (the kart's velocity toward it minus the pet's away). */
function closingOn(kart: SimEntity, t: SimEntity): number {
  const dx = t.pos.x - kart.pos.x, dz = t.pos.z - kart.pos.z;
  const d = Math.hypot(dx, dz) || 1e-3;
  return ((kart.vel.x - t.vel.x) * dx + (kart.vel.z - t.vel.z) * dz) / d;
}

/** After a ram run: head on along the kart's heading (a drivable point up to 22 m ahead) for EXTEND s. */
function extendFrom(g: NavGrid, sim: Sim, kart: SimEntity, r: RideState, now: number): void {
  const nav = kartNavFor(g, sim.worldData);
  const fx = -Math.sin(kart.yaw), fz = -Math.cos(kart.yaw);
  for (const d of [22, 15, 9]) {
    const x = kart.pos.x + fx * d, z = kart.pos.z + fz * d;
    if (!driveLineClear(g, nav, kart.pos.x, kart.pos.z, x, z)) continue;
    r.extendX = x; r.extendZ = z; r.extendUntil = now + Math.round(EXTEND * TICK_HZ);
    return;
  }
}

/** Seated bot: drive the trip, ram, or get out. Writes the rider's input. */
function driveTick(sim: Sim, e: SimEntity, ai: VehicleBrain, ctx: VehicleCtx, kart: SimEntity, inp: InputCmd): void {
  const g = ctx.grid!;
  const r = ai.tac.ride;
  const now = sim.tick;
  const k = kart.kart!;
  if (r.phase !== 'drive' || r.kart !== kart.id) {
    // just seated (this bot's E, or placed by a test / chapter): keep the trip it boarded for, else take the current one
    const boarding = r.phase === 'board';
    r.phase = 'drive'; r.kart = kart.id; r.term = -1; r.since = now;
    r.ram = -1; r.ramFor = -1; r.ramTries = 0; r.ramCool = 0;
    resetDriver(r.drv, sim, kart);
    r.boards++;
    if (!boarding) {
      const tr = tripOf(sim, ai);
      if (tr) setTrip(r, tr); else { r.destX = kart.pos.x; r.destZ = kart.pos.z; r.destR = 4; r.stay = false; r.calm = false; }
    }
  }
  // objectives keep moving on while the bot drives (an adventure step, a core-rush pad)
  updateObjectiveGoal(sim, e, ai.tac, g, ctx.chars);
  const obj = objectiveTrip(sim, ai.tac);
  if (obj && (Math.hypot(obj.x - r.destX, obj.z - r.destZ) > 2 || obj.stay !== r.stay)) setTrip(r, obj);

  // why the bot wants out ('' = it doesn't)
  let out = '';
  const hp = kart.health!;
  const riderHp = e.health!;
  if (hp.hp < hp.max * BAIL_HP) out = 'wrecked';
  else if (now - r.since > MAX_RIDE * TICK_HZ) out = 'timeout';
  else if (!r.calm && riderHp.hp < riderHp.max * RIDER_BAIL && now - riderHp.lastDamageTick < TICK_HZ) out = 'hurt'; // the rider is the one being shot

  // a ram run, or out to fight
  const goal = goalTmp;
  goal.x = r.destX; goal.z = r.destZ; goal.r = r.destR; goal.stop = true; goal.ram = false;
  if (!r.calm) {
    const t = ai.target >= 0 ? sim.entities.get(ai.target) : undefined;
    const foe = t && t.char && !t.dead && t.team !== e.team && ai.visible ? t : null;
    if (r.ram >= 0) {
      const rt = sim.entities.get(r.ram);
      // a new hit: the kart's per-target ram cooldown was (re)armed this tick
      const hit = !!rt && (k.ramUntil[rt.id] ?? -1) === now - 1 + Math.round(VEHICLES[k.id].ramCooldown * TICK_HZ);
      if (hit) r.ramHits++;
      // a miss: the target slipped by (close and behind) — drive on, gain room, come round again after the pause
      const missed = rt && Math.hypot(rt.pos.x - kart.pos.x, rt.pos.z - kart.pos.z) < 7
        && Math.abs(angleDelta(kart.yaw, yawToward(kart.pos.x, kart.pos.z, rt.pos.x, rt.pos.z))) > 1.0;
      // a pet on its feet that outruns the closing speed (the hit would be a nudge): give it up after a second of trying
      if (rt && rt.char?.grounded && now - r.ramSince > TICK_HZ && closingOn(kart, rt) < VEHICLES[k.id].ramMinSpeed + 1) r.ramUntil = now;
      if (hit && rt && !rt.dead) {
        // a hit throws the pet ahead of the kart: stay on it for the follow-up while it comes down (not a new try)
        if (r.ramHitTick !== now) { r.ramUntil = now + Math.round(RAM_FOLLOW * TICK_HZ); r.ramSince = now; }
        r.ramHitTick = now;
      } else if (!rt || rt.dead || hit || missed || now >= r.ramUntil) {
        r.ram = -1; r.ramCool = now + Math.round(RAM_PAUSE * TICK_HZ);
        // joust: carry on straight for a moment to make room, then swing round for another run
        if (rt && !rt.dead) extendFrom(g, sim, kart, r, now);
      }
    }
    if (r.ram < 0 && now >= r.ramCool && (foe || (now + e.id) % RAM_SCAN === 0)) {
      const best = ramPick(sim, e, kart, ctx.chars, g, r);
      if (best) {
        if (r.ramFor !== best.id) { r.ramFor = best.id; r.ramTries = 0; }
        r.ram = best.id; r.ramUntil = now + Math.round(RAM_RUN * TICK_HZ); r.ramSince = now; r.ramTries++;
      } else if (foe && !out && now >= r.extendUntil && Math.hypot(foe.pos.x - kart.pos.x, foe.pos.z - kart.pos.z) < FIGHT_RANGE) {
        // close and no ram lined up: a sound kart with a healthy rider makes room and comes round (joust); a hurt rider
        // or a weak kart gets out, guns out
        if (riderHp.hp < riderHp.max * 0.6 || hp.hp < hp.max * 0.45 || r.ramTries >= RAM_TRIES) out = 'fight';
        else extendFrom(g, sim, kart, r, now);
      }
    }
    const rt = r.ram >= 0 ? sim.entities.get(r.ram) : undefined;
    if (rt) {
      // intercept: where the pet will be when the kart gets there (time to contact from the closing speed)
      const dx = rt.pos.x - kart.pos.x, dz = rt.pos.z - kart.pos.z;
      const d = Math.hypot(dx, dz) || 1e-3;
      const away = (rt.vel.x * dx + rt.vel.z * dz) / d;
      const tc = Math.min(1.5, d / Math.max(4, Math.max(12, kartForwardSpeed(kart)) - away));
      goal.x = rt.pos.x + rt.vel.x * tc; goal.z = rt.pos.z + rt.vel.z * tc;
      goal.r = 0; goal.stop = false; goal.ram = true;
    } else if (now < r.extendUntil) {
      goal.x = r.extendX; goal.z = r.extendZ; goal.r = 3; goal.stop = false;
    }
  }

  const st = driveKart(sim, kart, r.drv, goal, g, ctx, ctrl);
  r.status = st;
  if (!out && goal.ram && st !== 'driving') { r.ram = -1; r.ramCool = now + Math.round(RAM_PAUSE * TICK_HZ); } // no way to it
  else if (!out && now < r.extendUntil && !goal.ram && st !== 'driving') r.extendUntil = 0; // made room (or can't)
  else if (!out && (st === 'giveup' || st === 'noroute')) out = st;
  else if (!out && st === 'arrived' && !r.stay) out = 'arrived';
  r.out = out;
  controlsToInput(ctrl, inp);
  if (out) {
    const v = kartForwardSpeed(kart);
    if (out !== 'wrecked' && Math.abs(v) > HOP_SPEED) { inp.mz = v > 0 ? -1 : 1; inp.mx = 0; inp.buttons = 0; }
    else { inp.mz = 0; inp.mx = 0; inp.buttons = e.prevButtons & Btn.Interact ? 0 : Btn.Interact; }
  }
  // eyes on the road (perception looks where the kart goes)
  ai.yaw = kart.yaw; ai.pitch = 0;
  inp.yaw = ai.yaw; inp.pitch = 0;
}

/**
 * B2a brain hook: called by brain.ts think() right after perception. A seated bot drives (drive.ts) and a bot on its
 * way to a kart boards it; both write the whole InputCmd and return true (the on-foot FSM skips the tick). Idle bots
 * are checked every 0.5 s for a trip worth a kart; false = the brain runs as usual. `sim.state.aiConfig = { vehicles:
 * false }` keeps bots out of vehicles (tests, labs, benches).
 */
export function vehicleThink(sim: Sim, e: SimEntity, ai: VehicleBrain, ctx: VehicleCtx, inp: InputCmd, dt: number): boolean {
  driveStats.hookCalls++;
  const r = ai.tac.ride;
  const gap = sim.tick - r.seen > 3;
  r.seen = sim.tick;
  if (!ctx.grid || e.kind !== EntityKind.Bot || e.combat?.pve) return false;
  if ((sim.state.aiConfig as { vehicles?: boolean } | undefined)?.vehicles === false && !e.seat) return false; // tests/labs: bots stay on foot
  const v = e.seat ? sim.entities.get(e.seat.vehicle) : undefined;
  if (v) {
    if (v.kart) driveTick(sim, e, ai, ctx, v, inp);
    else if (v.plane) planeTick(sim, e, ai, ctx, v, inp);
    else return false;
    return true;
  }
  if (r.phase === 'drive') endRide(sim, e, ai, r.out === 'fight' ? FIGHT_COOLDOWN : HOP_COOLDOWN);
  else if (gap && (r.phase === 'board' || r.phase === 'leap')) endRide(sim, e, ai, 1);
  const t = ai.tac;
  if (r.phase === 'idle' && t.glide && e.char?.grounded && Math.abs(e.pos.y - t.gy) < 0.8 && Math.hypot(t.gx - e.pos.x, t.gz - e.pos.z) < 1.5) {
    r.phase = 'leap'; r.leap = 0; r.since = sim.tick; // B2b: at the launch spot: off the edge into a glide
  }
  if (r.phase === 'leap') return leapTick(sim, e, ai, inp);
  if (isCarrier(e)) { if (r.phase === 'board') endRide(sim, e, ai, 1); return false; } // G4b: carriers can't mount
  // Q3 P2-2: no ride or sortie in the result hold (the restart would clear it, or it lands in the next match)
  if (matchEnded(sim)) { if (r.phase === 'board') endRide(sim, e, ai, 1); return false; }
  if (r.phase === 'idle' && sim.tick >= r.evalAt && !hangarBoard(sim, e, ai, ctx.chars)) considerBoarding(sim, e, ai, ctx.grid, ctx.chars);
  if (r.phase === 'board') return boardTick(sim, e, ai, ctx, inp, dt);
  return false;
}

// ---------------------------------------------------------------- the RC plane and the Ear Glide (B2b)
//   pilot   in team-deathmatch, core-rush, yard-skirmish and base-assault each team sends one pilot to the neutral
//           Rooftop Hangar: its lowest-id Overwatch or Skyraider room bot (≥ 60 % health, no teammate flying, no human
//           heading for the hangar, a route up N1's climb links; in base-assault only while its role is attack and after
//           its team's first storm, W10 N3, and never a ball carrier: it can't mount). The goal sits on the roof (t.gy),
//           so the brain climbs there; E vends, E boards (a plane parked empty up there is boarded as is).
//   sortie  strafing runs (drive.ts flyPlane) on the best enemy on foot in the open: close to the plane, hurt, near
//           the pilot's teammates (the contested ground), re-picked every 1.5 s; nobody to hit → a circuit over the
//           middle of the yard. Bails out (E in the air) below 35 % hull, or under fire below 45 % health.
//   adventure  a `vehicle` step up by the hangar (ch6's pad) is met by vending and sitting in the plane on the pad; a
//           `vehicle` flyover step is flown to (over its zone, 5 m above its floor); after the flying steps the pilot
//           lands by the squad and gets out. An `airborne` step (ch6's glide) sends the squad's first Skyraider pup up
//           to the chapter's roof start, off the edge (jump, double jump) into an Ear Glide steered at the zone.

/** Room bots that fly: the marksman (it perches on the Rooftops by the hangar) and the flier (it flies best). */
const PILOT_CLASSES: readonly string[] = ['overwatch', 'skyraider'];
const PLANE_MODES = new Set(['team-deathmatch', 'core-rush', 'yard-skirmish', 'base-assault']);
/** Bail out below these fractions (hull; pilot health while being shot). */
const PLANE_BAIL_HP = 0.35, PILOT_BAIL_HP = 0.45;
/** A pilot stands this far (m) from the hangar kiosk, toward the pad; the hangar is boarded from within HANGAR_NEAR m. */
const HANGAR_SPOT = 1.6, HANGAR_NEAR = 6;
/** Strike targets are re-picked every STRIKE_EVERY s; the patrol circuit height (m). */
const STRIKE_EVERY = 1.5, PATROL_AGL = 16;
const flightGoal: FlightGoal = { x: 0, y: 0, z: 0, mode: 'flyover', target: null };

/** The Rooftop Hangar of this sim (null when the world has none). */
function hangarOf(sim: Sim): SimEntity | null {
  for (const v of sim.entities.values()) if (v.terminal?.id === 'plane_hangar') return v;
  return null;
}

/** The hangar's plane parked empty on its roof, fit to fly (null when there is none). */
function parkedPlane(sim: Sim, h: SimEntity): SimEntity | null {
  const t = h.terminal!;
  const pl = t.kart >= 0 ? sim.entities.get(t.kart) : undefined;
  if (!pl?.plane || pl.removed || pl.plane.rider >= 0 || !pl.plane.grounded || Math.abs(pl.pos.y - h.pos.y) > 1) return null;
  return pl.health && pl.health.hp >= pl.health.max * 0.5 ? pl : null;
}

function isPilotClass(e: SimEntity): boolean {
  return PILOT_CLASSES.includes(e.cls ?? '') && !!e.health && e.health.hp >= e.health.max * 0.6;
}

/** PvP: is `e` its team's pilot right now? Sets the hangar goal (on the roof: the brain climbs) and returns true. */
function planeGoal(sim: Sim, e: SimEntity, t: TacticsState, chars: SimEntity[], prev: string, prevId: EntityId): boolean {
  if (isCarrier(e) || !isPilotClass(e) || !PLANE_MODES.has(roomModeOf(sim)) || matchEnded(sim)) return false; // N3: carriers never fly
  if ((sim.state.aiConfig as { vehicles?: boolean } | undefined)?.vehicles === false) return false;
  const h = hangarOf(sim);
  if (!h?.terminal) return false;
  const ht = h.terminal;
  if (ht.kart >= 0 ? !parkedPlane(sim, h) : ht.cooldown > 0) return false;
  for (const c of chars) {
    if (c.team !== e.team || c === e) continue;
    const v = c.seat ? sim.entities.get(c.seat.vehicle) : undefined;
    if (v?.plane) return false;                                                        // a teammate is up already
    if (c.kind === EntityKind.Bot && !c.combat?.pve && c.id < e.id && isPilotClass(c)) return false; // not our pilot
  }
  if (humanWants(chars, e.team, h.pos.x, h.pos.z)) return false;
  const dx = ht.padX - h.pos.x, dz = ht.padZ - h.pos.z, dl = Math.hypot(dx, dz) || 1;
  const sx = h.pos.x + (dx / dl) * HANGAR_SPOT, sz = h.pos.z + (dz / dl) * HANGAR_SPOT;
  // a route up (N1's cross-grid planner; re-checked every 3 s, it isn't cheap)
  const r = t.ride;
  if (sim.tick >= r.reachAt) { r.reachAt = sim.tick + 3 * TICK_HZ; r.reachOk = Number.isFinite(canReach(sim, e, sx, h.pos.y, sz)); }
  if (!r.reachOk) return false;
  t.goal = 'step'; t.interact = false; t.hold = false; t.plane = true;
  t.gx = sx; t.gz = sz; t.gy = h.pos.y; t.gr = 1.5; t.cx = h.pos.x; t.cz = h.pos.z;
  if (prev !== 'step' || prevId !== h.id) t.goalSince = sim.tick;
  t.goalId = h.id;
  return true;
}

/**
 * Adventure `airborne` reach step, bot-only squad: its first living Skyraider pup goes up to the chapter's roof start
 * (ChapterDef.start with y) to leap off into an Ear Glide (vehicleThink 'leap'); the zone stays the leap's aim (cx, cz).
 */
function glideGoal(sim: Sim, e: SimEntity, t: TacticsState, chars: SimEntity[], def: { start: { x: number; z: number; y?: number } }): void {
  const glider = (c: SimEntity) => c.kind === EntityKind.Bot && c.team === e.team && !c.dead && !c.combat?.pve && !!c.abil && abilityDef(c.abil.id)?.kind === 'glide';
  if (!glider(e) || def.start.y === undefined) return;
  for (const c of chars) if (c !== e && glider(c) && c.id < e.id) return;
  if (!Number.isFinite(canReach(sim, e, def.start.x, def.start.y, def.start.z))) return;
  t.gx = def.start.x; t.gz = def.start.z; t.gy = def.start.y; t.glide = true;
}

/** On foot by the hangar with a plane goal (or an adventure vehicle step up there): start boarding (vend, board). */
function hangarBoard(sim: Sim, e: SimEntity, ai: VehicleBrain, chars: SimEntity[]): boolean {
  const t = ai.tac, r = t.ride;
  if (!t.plane && !(t.vehicle && t.goal === 'step' && isAdventureMode(sim) && !squadHasHuman(sim))) return false;
  const h = hangarOf(sim);
  if (!h?.terminal || Math.hypot(h.pos.x - e.pos.x, h.pos.z - e.pos.z) > HANGAR_NEAR || Math.abs(e.pos.y - h.pos.y) > 1.5) return false;
  const pl = parkedPlane(sim, h);
  if (pl ? claimed(chars, e, pl.id) : !kioskUsable(e, h, 'plane_hangar') || claimed(chars, e, h.id)) return false;
  r.phase = 'board';
  r.kart = pl ? pl.id : -1;
  r.term = pl ? -1 : h.id;
  r.since = sim.tick; r.bestD = Infinity; r.bestTick = sim.tick; r.walk.length = 0;
  trip.x = t.cx; trip.z = t.cz; trip.r = 4; trip.stay = t.vehicle; trip.calm = t.vehicle;
  setTrip(r, trip);
  return true;
}

function planeUsable(e: SimEntity, v: SimEntity): boolean {
  const p = v.plane;
  if (!p || v.removed || p.rider >= 0 || !v.health || v.health.hp < v.health.max * 0.5) return false;
  return Math.hypot(v.vel.x, v.vel.y, v.vel.z) <= VEHICLES[p.id].mountMaxSpeed && Math.abs(v.pos.y - e.pos.y) <= 1.5;
}

/**
 * The enemy to strafe: on foot, alive, in the open from above (a clear line from 15 m over it), not too high up;
 * close to the plane, hurt and near the pilot's teammates (the contested ground) first. Null = nobody worth a pass.
 */
function strikePick(sim: Sim, e: SimEntity, plane: SimEntity, chars: SimEntity[]): SimEntity | null {
  let best: SimEntity | null = null, bs = Infinity;
  for (const c of chars) {
    if (c.team === e.team || c.dead || !c.health || c.seat || c.kind === EntityKind.Boss || isStealthed(sim, c)) continue;
    const d = Math.hypot(c.pos.x - plane.pos.x, c.pos.z - plane.pos.z);
    if (d > 140 || c.pos.y - sim.worldData.height(c.pos.x, c.pos.z) > 3) continue;
    if (!worldLineClear(sim, c.pos.x, c.pos.y + 15, c.pos.z, c.pos.x, c.pos.y + 1, c.pos.z)) continue; // under a roof
    let friends = 0;
    for (const f of chars) if (f.team === e.team && f !== e && Math.hypot(f.pos.x - c.pos.x, f.pos.z - c.pos.z) < 25) friends++;
    const score = d * 0.4 + (c.health.hp / c.health.max) * 25 - Math.min(3, friends) * 8;
    if (score < bs) { bs = score; best = c; }
  }
  return best;
}

/** Seated in the plane: the sortie (or an adventure flight), bail-outs, landings. Writes the pilot's input. */
function planeTick(sim: Sim, e: SimEntity, ai: VehicleBrain, ctx: VehicleCtx, plane: SimEntity, inp: InputCmd): void {
  const g = ctx.grid!;
  const r = ai.tac.ride, t = ai.tac;
  const now = sim.tick;
  const p = plane.plane!;
  if (r.phase !== 'drive' || r.kart !== plane.id) {
    r.phase = 'drive'; r.kart = plane.id; r.term = -1; r.since = now;
    const f = r.flight; f.phase = 'cruise'; f.until = 0;
    r.strike = -1; r.strikeAt = 0;
    r.boards++;
  }
  updateObjectiveGoal(sim, e, t, g, ctx.chars);
  let out = '';
  const hp = plane.health!, rh = e.health!;
  if (hp.hp < hp.max * PLANE_BAIL_HP) out = 'wrecked';
  else if (rh.hp < rh.max * PILOT_BAIL_HP && now - rh.lastDamageTick < TICK_HZ) out = 'hurt';
  const goal = flightGoal;
  goal.target = null; goal.landYaw = undefined; goal.r = 10;
  let park = false;
  if (isAdventureMode(sim)) {
    const st = adventureState(sim);
    if (t.goal === 'step' && t.vehicle) {
      if (p.grounded && Math.hypot(plane.pos.x - t.cx, plane.pos.z - t.cz) <= t.gr) park = true; // a pad step: sit in it
      else {
        const floor = t.gy - sim.worldData.height(t.cx, t.cz) > 1.5 ? t.gy : sim.worldData.height(t.cx, t.cz);
        goal.mode = 'flyover'; goal.x = t.cx; goal.z = t.cz; goal.y = Math.max(floor + 5, sim.worldData.height(t.cx, t.cz) + 12); goal.r = t.gr * 0.5;
      }
    } else if (st) {
      // the flying is done: land by the squad and walk on
      goal.mode = 'land'; goal.x = st.anchorX; goal.z = st.anchorZ; goal.y = sim.worldData.height(st.anchorX, st.anchorZ);
    }
  } else {
    if (now >= r.strikeAt) {
      r.strikeAt = now + Math.round(STRIKE_EVERY * TICK_HZ);
      r.strike = strikePick(sim, e, plane, ctx.chars)?.id ?? -1;
    }
    const tgt = r.strike >= 0 ? sim.entities.get(r.strike) : undefined;
    if (tgt && !tgt.dead) { goal.mode = 'strafe'; goal.target = tgt; goal.x = tgt.pos.x; goal.y = tgt.pos.y; goal.z = tgt.pos.z; }
    else {
      // nobody to hit: a circuit over the middle of the yard (between the team spawns)
      const mid = midfield(sim);
      const a = (now / TICK_HZ) * 0.25 + e.id;
      goal.mode = 'flyover'; goal.x = mid.x + Math.cos(a) * 25; goal.z = mid.z + Math.sin(a) * 25;
      goal.y = sim.worldData.height(goal.x, goal.z) + PATROL_AGL;
    }
  }
  if (park) { inp.mz = -1; inp.mx = 0; inp.yaw = plane.yaw; inp.pitch = 0; inp.buttons = 0; }
  else {
    const fs = flyPlane(sim, plane, r.flight, goal, inp);
    r.status = fs;
    if (fs === 'landed' && !out) out = 'landed';
  }
  r.out = out;
  if (out) inp.buttons = e.prevButtons & Btn.Interact ? 0 : Btn.Interact; // in the air: a bail-out
  ai.yaw = inp.yaw; ai.pitch = inp.pitch;
}

const mids = new WeakMap<Sim, { x: number; z: number }>();
/** The middle of the yard between the two teams' spawn centroids. */
function midfield(sim: Sim): { x: number; z: number } {
  let m = mids.get(sim);
  if (!m) {
    let x = 0, z = 0, n = 0;
    for (const s of sim.worldData.spawns) if (s.team === Team.Corgis || s.team === Team.Cats) { x += s.x; z += s.z; n++; }
    m = n ? { x: x / n, z: z / n } : { x: 0, z: 0 };
    mids.set(sim, m);
  }
  return m;
}

/**
 * The glide leap (an adventure `airborne` step): from the launch spot on the roof, run at the zone, jump at the edge
 * (a parapet or a drop ahead), double-jump near the apex, spread the ears at the second apex and steer the glide at
 * the zone. Ends on landing (or after 8 s).
 */
function leapTick(sim: Sim, e: SimEntity, ai: VehicleBrain, inp: InputCmd): boolean {
  const r = ai.tac.ride, t = ai.tac, c = e.char!;
  const now = sim.tick;
  if (now - r.since > 8 * TICK_HZ || (r.leap > 0 && c.grounded && now - r.since > 30) || !t.glide) {
    endRide(sim, e, ai, 4);
    return false;
  }
  const want = yawToward(e.pos.x, e.pos.z, t.cx, t.cz);
  let b = Btn.Sprint;
  if (r.leap === 0) {
    // the edge: a parapet or a drop 0.9 m ahead
    const ax = e.pos.x - Math.sin(want) * 0.9, az = e.pos.z - Math.cos(want) * 0.9;
    const ahead = surfaceAt(sim.worldData, ax, az, e.pos.y + 1).y;
    if (Math.abs(ahead - e.pos.y) > 0.2) { b |= Btn.Jump; if (!c.grounded) r.leap = 1; }
  } else if (r.leap === 1) { if (e.vel.y > 1) b |= Btn.Jump; else r.leap = 2; }
  else if (r.leap === 2) { if (!(e.prevButtons & Btn.Jump)) b |= Btn.Jump; if (c.jumpsUsed >= 2) r.leap = 3; }
  else if (r.leap === 3) { if (e.vel.y > 0.3) b |= Btn.Jump; else { if (!(e.prevButtons & Btn.Ability)) b |= Btn.Ability; r.leap = 4; } }
  ai.yaw = want; ai.pitch = 0;
  inp.mx = 0; inp.mz = 1; inp.yaw = want; inp.pitch = 0; inp.buttons = b;
  return true;
}
