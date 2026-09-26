// W9 X4 (arms-2): when a bot throws its ordnance. A PURE decision module (no tactics.ts / brain.ts imports, no
// sim.rng): the lead wires ordnanceBotThink() into the brain at INT9 (docs/handoff/X4.md §5).
//
// planThrow() — throw when all of these hold (a soft counter: grenades flush clusters and campers, guns still win duels):
//   · the bot carries one (EFlag.Ordnance), is alive, on foot and not stunned;
//   · ≥ CLUSTER_MIN enemies it perceives stand within CLUSTER_R m of each other, CLUSTER_RANGE m away (the cluster's
//     centre, horizontally) — a lone enemy is a gun's job;
//   · the arc lands in the open near the cluster: solveThrow() (the SAME arc the client preview draws, over the same
//     static world) aimed short by the predicted bounce/roll so the BLAST point ends within landTol m of the centre;
//     the first landing is on open ground (normal up), and ≥ clusterMin of the cluster are inside the blast radius
//     with a clear line from the blast point (no wall between the blast and them);
//   · no ally (and not the bot itself) within ALLY_CLEAR m of the landing point.
// ordnanceBotThink() sequences it: re-plan every CHECK_TICKS (staggered by id); on a plan, WIND_TICKS holding
// Btn.Throw while turning to the solved yaw/pitch (the wind-up is the target's tell), then release on the plan's exact
// angles (the authority throws on the release); a cooldown after, and it gives up if the plan goes stale.
import type { SimEntity } from '../entity';
import { Btn } from '../../shared/input';
import { EFlag, type SpeciesId } from '../../shared/types';
import {
  ORDNANCE_BLAST, arcLineClear, clampLaunch, makeArcResult, makeLaunch, makeSolve, ordnanceFor, predictArc, solveThrow, throwLaunch,
  type ArcWorld, type ThrowSolve,
} from '../../shared/content/ordnance';

/** Decision tuning (data; the design reasons live in docs/handoff/X4.md §4). */
export const ORDNANCE_AI = {
  clusterMin: 2,
  clusterR: 4,
  range: [8, 22] as [number, number],
  landTol: 1.5,
  allyClear: ORDNANCE_BLAST.explodeRadius + 1,
  /** Re-plan period while idle (ticks) and after a throw or an aborted plan. */
  checkTicks: 30,
  cooldownTicks: 90,
  /** Hold the button this long while turning to the throw (ticks); give up after windMax. */
  windTicks: 12,
  windMax: 45,
  /** Release when the bot's aim is this close to the plan (radians). */
  alignTol: 0.05,
} as const;

export interface ThrowPlan extends ThrowSolve {
  /** Cluster centre, where the blast is predicted (after the bounces) and how many of the cluster it should reach. */
  cx: number; cy: number; cz: number;
  bx: number; by: number; bz: number;
  hits: number;
}
export const makePlan = (): ThrowPlan => ({ ...makeSolve(), cx: 0, cy: 0, cz: 0, bx: 0, by: 0, bz: 0, hits: 0 });

const solve = makeSolve();
const chk = makeArcResult();
const chkLaunch = makeLaunch();

/** Characters a bot can throw at / must spare: anything with a position (SimEntity satisfies it). */
type Body = Pick<SimEntity, 'id' | 'pos' | 'dead' | 'team'> & { char?: SimEntity['char'] };

/**
 * Should `bot` throw now, and how? Pure: the same inputs give the same plan. `enemies` = the enemies the bot perceives
 * (the caller decides sight), `allies` = its teammates. Both are filtered by team here (the bot's own team never
 * counts as a target, the other team never as an ally), so passing every character as `allies` is safe.
 */
export function planThrow(bot: SimEntity, enemies: readonly Body[], allies: readonly Body[], aw: ArcWorld, out: ThrowPlan): boolean {
  if (bot.dead || !bot.char || !(bot.flags & EFlag.Ordnance) || bot.flags & (EFlag.Mounted | EFlag.Stunned)) return false;
  const A = ORDNANCE_AI;
  const R = ORDNANCE_BLAST.explodeRadius;
  // the best cluster: most members, then the one nearest the middle of the range band (ties: enemy order)
  let bestN = 0, bestScore = Infinity, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < enemies.length; i++) {
    const s = enemies[i];
    if (s.dead || s.team === bot.team) continue;
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < enemies.length; j++) {
      const o = enemies[j];
      if (o.dead || o.team === bot.team || Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z) > A.clusterR || Math.abs(o.pos.y - s.pos.y) > 2) continue;
      n++; sx += o.pos.x; sy += o.pos.y; sz += o.pos.z;
    }
    if (n < A.clusterMin) continue;
    sx /= n; sy /= n; sz /= n;
    const d = Math.hypot(sx - bot.pos.x, sz - bot.pos.z);
    if (d < A.range[0] || d > A.range[1]) continue;
    const score = Math.abs(d - (A.range[0] + A.range[1]) / 2);
    if (n > bestN || (n === bestN && score < bestScore)) { bestN = n; bestScore = score; cx = sx; cy = sy; cz = sz; }
  }
  if (bestN < A.clusterMin) return false;
  // the arc, over the same world the preview draws. The squeaker bounces on after its first landing (the hairball
  // barely rolls): aim short by the predicted roll so the BLAST lands on the cluster (2 corrections at most).
  const def = ordnanceFor(bot.species as SpeciesId);
  let tx = cx, tz = cz, ok = false;
  for (let it = 0; it < 3; it++) {
    if (!solveThrow(aw, bot.pos.x, bot.pos.y, bot.pos.z, bot.species as SpeciesId, tx, cy, tz, solve, 1.0)) return false;
    throwLaunch(bot.pos.x, bot.pos.y, bot.pos.z, solve.yaw, solve.pitch, bot.species as SpeciesId, chkLaunch);
    clampLaunch(aw, bot.pos.x, bot.pos.y, bot.pos.z, bot.species as SpeciesId, chkLaunch);
    predictArc(aw, chkLaunch, def, chk);
    if (!chk.landed || chk.lost || chk.lny < 0.7) return false; // not in the open (a wall, a roof edge, off the map)
    const ex = chk.bx - cx, ez = chk.bz - cz;
    if (Math.hypot(ex, ez) <= A.landTol) { ok = true; break; }
    tx -= ex; tz -= ez;
  }
  if (!ok) return false;
  const bx = chk.bx, by = chk.by + 0.15, bz = chk.bz;
  // it must reach the cluster: members inside the radius with a clear line from the blast
  let hits = 0;
  for (let i = 0; i < enemies.length; i++) {
    const o = enemies[i];
    if (o.dead || o.team === bot.team) continue;
    const ox = o.pos.x, oy = o.pos.y + 0.6, oz = o.pos.z;
    if (Math.hypot(ox - bx, oy - by, oz - bz) > R * 0.85) continue;
    if (arcLineClear(aw, bx, by, bz, ox, oy, oz)) hits++;
  }
  if (hits < A.clusterMin) return false;
  // never near an ally, never near itself
  if (Math.hypot(bot.pos.x - bx, bot.pos.z - bz) < A.allyClear) return false;
  for (let i = 0; i < allies.length; i++) {
    const o = allies[i];
    if (o.id === bot.id || o.dead || o.team !== bot.team) continue;
    if (Math.hypot(o.pos.x - bx, o.pos.y - by, o.pos.z - bz) < A.allyClear) return false;
  }
  out.yaw = solve.yaw; out.pitch = solve.pitch; out.x = solve.x; out.y = solve.y; out.z = solve.z; out.t = solve.t; out.miss = solve.miss;
  out.cx = cx; out.cy = cy; out.cz = cz; out.bx = bx; out.by = by; out.bz = bz; out.hits = hits;
  return true;
}

/** Per-bot sequencer state (plain data; keep one per bot, e.g. on its AiState). */
export interface OrdnanceBot {
  phase: 'idle' | 'wind';
  /** Tick of the next re-plan (idle) / when the wind-up began. */
  next: number;
  since: number;
  plan: ThrowPlan;
  /** Telemetry. */
  throws: number;
}

export function createOrdnanceBot(id: number): OrdnanceBot {
  return { phase: 'idle', next: id % ORDNANCE_AI.checkTicks, since: 0, plan: makePlan(), throws: 0 };
}

/** What the brain should do this tick: when `active`, aim at (yaw, pitch) and send `buttons` (Btn.Throw or 0). */
export interface OrdnanceIntent { active: boolean; yaw: number; pitch: number; buttons: number }
export const makeIntent = (): OrdnanceIntent => ({ active: false, yaw: 0, pitch: 0, buttons: 0 });

const angleDiff = (a: number, b: number) => { let d = (a - b) % (Math.PI * 2); if (d > Math.PI) d -= Math.PI * 2; if (d < -Math.PI) d += Math.PI * 2; return d; };

/**
 * One tick of the throw sequence. `aimYaw`/`aimPitch` = where the bot's view points now (its smoothed aim). Hold
 * Btn.Throw while turning, release on the plan's exact angles once aligned (or snapped at windMax), then cool down.
 */
export function ordnanceBotThink(ob: OrdnanceBot, bot: SimEntity, tick: number, aimYaw: number, aimPitch: number,
  enemies: readonly Body[], allies: readonly Body[], aw: ArcWorld, out: OrdnanceIntent): OrdnanceIntent {
  const A = ORDNANCE_AI;
  out.active = false; out.buttons = 0;
  const able = !bot.dead && !!bot.char && (bot.flags & EFlag.Ordnance) !== 0 && !(bot.flags & (EFlag.Mounted | EFlag.Stunned));
  if (ob.phase === 'wind') {
    if (!able) { ob.phase = 'idle'; ob.next = tick + A.cooldownTicks; return out; }
    out.active = true; out.yaw = ob.plan.yaw; out.pitch = ob.plan.pitch;
    const held = tick - ob.since;
    const aligned = Math.abs(angleDiff(aimYaw, ob.plan.yaw)) < A.alignTol && Math.abs(aimPitch - ob.plan.pitch) < A.alignTol;
    if (held >= A.windTicks && (aligned || held >= A.windMax)) {
      out.buttons = 0; // release: the authority throws with this tick's yaw/pitch
      ob.phase = 'idle'; ob.next = tick + A.cooldownTicks; ob.throws++;
    } else out.buttons = Btn.Throw;
    return out;
  }
  if (!able || tick < ob.next) return out;
  ob.next = tick + A.checkTicks;
  if (!planThrow(bot, enemies, allies, aw, ob.plan)) return out;
  ob.phase = 'wind'; ob.since = tick;
  out.active = true; out.yaw = ob.plan.yaw; out.pitch = ob.plan.pitch; out.buttons = Btn.Throw;
  return out;
}
