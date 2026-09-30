// Lane goals (W9 L3, The Lot M5): bots use the whole map. Without them every roam goal was a shortest path through the
// open middle (W8: The Mud 599 bot-seconds, the Pipeworks 31, Container Canyon 26 in a 14v14 TDM). A lane is a list of
// ground waypoints from one base to the other (a map's data: lot/layout.ts LOT_LANES, keyed here by WorldData.name);
// each room bot picks one per life by the lanes' weights, deterministically (a hash of the world seed, the bot's id and
// the life), walks it waypoint by waypoint (lingering at a lane's hot spot), and at the far end sweeps back home along
// another pick (a bot released to hunt drifted into the open middle). Cats walk the lanes backwards.
//
// Pure decision module: laneGoal() writes the tactics goal (goal 'lane', gx/gz/gy, hold while lingering); the brain
// walks it like any patrol-mode tactics goal (steerTo, sprint when far). tactics.ts calls it once, when a bot has no
// objective, core or pad to go for (helping a human under fire is perception's alert mode: it still comes first). Who
// gets no lane: PvE wave cats, player stand-ins, marksmen
// (they take the perches: brain.ts autoPerch runs only without a tactics goal), bots holding a perch, and modes outside
// LANE_MODES (objective modes own their bots' goals). Worlds without lanes (the West Yard) are untouched.
// Per-bot state lives in a WeakMap (no snapshot, no protocol); no Math.random.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind } from '../../shared/types';
import { TICK_HZ } from '../../shared/constants';
import { hash2, hashSeed } from '../../shared/world/noise';
import { LOT_LANES, LOT_NAME } from '../../shared/world/lot/layout';

export interface LaneDef {
  id: string;
  /** Relative share of bots (per life). */
  weight: number;
  /** [x, z] or [x, z, lingerSeconds], from the team-0 (corgi) end to the team-1 end. */
  pts: readonly (readonly number[])[];
}

/**
 * Lanes per map (WorldData.name), weights and all from the map's data. W10 N3: The Lot's weights are W9 F2's tuned set
 * (Q4 P2-5: on Q4's seeds 5-8 L3's canyon lanes, 0.23 + 0.16, gave Container Canyon 0.22 of the Mud's bot-seconds
 * against a 0.25 gate; the Mud lane gave weight to the canyon lanes, and the Mud keeps its traffic: it is the middle
 * every fight and respawn crosses). F2 kept them here over LOT_LANES' paths; they now live in LOT_LANES itself.
 * A WorldData field would carry the lanes in the map itself (hand-back snippet).
 */
export const LANES_BY_MAP: Readonly<Record<string, readonly LaneDef[]>> = {
  [LOT_NAME]: LOT_LANES,
};
/** Room modes whose idle bots walk lanes. */
export const LANE_MODES: ReadonlySet<string> = new Set(['team-deathmatch']);

/** A waypoint counts as reached within this (m); a hot spot within LINGER_R, then the bot stands there. */
const ARRIVE_R = 6;
const LINGER_R = 2.5;
/** No metre of progress toward the waypoint for this long: skip it (the third skip in a row ends the lane). */
const STALL_TICKS = 12 * TICK_HZ;
const MAX_SKIPS = 3;

/** One bot's lane for its current life. */
export interface LaneRun {
  /** e.respawnTick when the lane was picked (a new value = a new life = a new pick). */
  life: number;
  lane: number;
  /** Next waypoint, in the bot's walking order. */
  idx: number;
  /** Walking order: +1 (corgi end first: team 0's way out, team 1's way back) or -1. */
  dir: 1 | -1;
  /** Lanes walked this life (each end starts the next pick, walked the other way). */
  leg: number;
  /** Lingering at the waypoint until this tick (0 = not lingering). */
  lingerUntil: number;
  best: number;
  bestTick: number;
  skips: number;
  done: boolean;
}

const runs = new WeakMap<SimEntity, LaneRun>();

/** The lanes of a world (null: none). */
export function lanesFor(sim: Sim): readonly LaneDef[] | null {
  return LANES_BY_MAP[sim.worldData.name] ?? null;
}

/** Deterministic weighted pick for a bot and a life. */
export function pickLane(lanes: readonly LaneDef[], seed: number, botId: number, life: number): number {
  const total = lanes.reduce((a, l) => a + l.weight, 0);
  let u = hash2(botId, life, hashSeed(`lanes:${seed}`) | 0) * total;
  for (let i = 0; i < lanes.length; i++) { u -= lanes[i].weight; if (u < 0) return i; }
  return lanes.length - 1;
}

/** The pick for a bot's life and leg (leg 0: the way out). */
function pickFor(lanes: readonly LaneDef[], seed: number, botId: number, life: number, leg: number): number {
  return pickLane(lanes, seed, botId, leg ? life * 7919 + leg : life);
}

/** The lane state of a bot (tests, telemetry), or null before its first lane. */
export function laneRunOf(e: SimEntity): LaneRun | null {
  return runs.get(e) ?? null;
}

/** Does this bot walk lanes at all (mode, kind, role)? */
function eligible(sim: Sim, e: SimEntity): boolean {
  if (e.kind !== EntityKind.Bot || e.combat?.pve) return false;
  if (!LANE_MODES.has((sim.state.room as { mode?: string } | undefined)?.mode ?? '')) return false;
  const ai = e.ai as { arch?: string; perch?: unknown; external?: boolean } | undefined;
  return !!ai && !ai.external && !ai.perch && ai.arch !== 'marksman';
}

/** The tactics fields laneGoal writes (a slice of tactics.ts TacticsState). */
export interface LaneGoalOut {
  goal: string;
  gx: number; gz: number; gy: number; gr: number;
  cx: number; cz: number;
  interact: boolean;
  hold: boolean;
  goalId: number;
  goalSince: number;
}

/**
 * The bot's lane goal right now: writes goal 'lane' (+ the waypoint, `hold` while lingering) into `t` and returns true,
 * or returns false (no lanes here, not a lane bot, or its lane is walked: it hunts as before). Called every ~0.5 s.
 */
export function laneGoal(sim: Sim, e: SimEntity, t: LaneGoalOut): boolean {
  const lanes = lanesFor(sim);
  if (!lanes || !eligible(sim, e)) return false;
  let r = runs.get(e);
  if (!r || r.life !== e.respawnTick) {
    const lane = pickFor(lanes, sim.worldData.seed, e.id, e.respawnTick, 0);
    const dir = e.team === 1 ? -1 : 1;
    r = { life: e.respawnTick, lane, idx: 0, dir, leg: 0, lingerUntil: 0, best: Infinity, bestTick: sim.tick, skips: 0, done: false };
    runs.set(e, r);
  }
  if (r.done) return false;
  if (r.idx >= lanes[r.lane].pts.length) {
    // the far end: sweep back along the next pick
    r.leg++; r.lane = pickFor(lanes, sim.worldData.seed, e.id, r.life, r.leg); r.dir = r.dir > 0 ? -1 : 1;
    r.idx = 0; r.lingerUntil = 0; r.best = Infinity; r.bestTick = sim.tick;
  }
  const pts = lanes[r.lane].pts, n = pts.length;
  const at = (i: number) => pts[r!.dir > 0 ? i : n - 1 - i];
  const dist = (i: number) => Math.hypot(at(i)[0] - e.pos.x, at(i)[1] - e.pos.z);
  const next = () => { r!.idx++; r!.lingerUntil = 0; r!.best = Infinity; r!.bestTick = sim.tick; };
  for (let guard = 0; guard < n && r.idx < n; guard++) {
    const d = dist(r.idx), linger = at(r.idx)[2] ?? 0;
    if (r.lingerUntil > 0) {
      if (sim.tick >= r.lingerUntil) { next(); continue; }
      break;
    }
    if (linger > 0 && d < LINGER_R) { r.lingerUntil = sim.tick + Math.round(linger * TICK_HZ); break; }
    // reached, or already past it (a fight carried the bot closer to the next one)
    if ((linger <= 0 && d < ARRIVE_R) || (r.idx + 1 < n && dist(r.idx + 1) < d)) { r.skips = 0; next(); continue; }
    if (d < r.best - 1) { r.best = d; r.bestTick = sim.tick; }
    else if (sim.tick - r.bestTick > STALL_TICKS) {
      if (++r.skips >= MAX_SKIPS) { r.done = true; return false; }
      next();
      continue;
    }
    break;
  }
  if (r.idx >= n) return false;                    // this lane is walked: the next call starts the sweep back
  const p = at(r.idx);
  const same = t.goalId === r.lane && t.gx === p[0] && t.gz === p[1];
  t.goal = 'lane';
  t.gx = p[0]; t.gz = p[1]; t.gy = sim.worldData.height(p[0], p[1]); t.gr = ARRIVE_R;
  t.cx = p[0]; t.cz = p[1];
  t.interact = false;
  t.hold = r.lingerUntil > 0;
  t.goalId = r.lane;
  if (!same) t.goalSince = sim.tick;
  return true;
}
