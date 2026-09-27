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
//
// W9 F2 (mode-1, Q4 P2-3): only HOLDING targets. A grenade flies up to 1.7 s and blows 2.2 s after the release: a
// sprinting pet is 20 m away by then (Q4: Base Assault 1 blast in 35 reached an enemy; the targets had moved a median
// 19 m). A pet holds when it has stayed within HOLD_R m of one spot for HOLD_TICKS (noteBodies, fed every tick by the AI
// system): a pet in a firefight strafing in its band, a guard at its stand, a carrier waiting in its ring, a sniper on a
// perch. Clusters need every counted member holding; a single pet holding for SINGLE_TICKS with at least SINGLE_HP of
// its health is a target on its own ("flush a camper": X4's own role statement, and what makes TDM throws happen at all:
// TDM bots rarely bunch; a hurt one dies to the guns before the fuse). Aim and coverage use the mean of where a holding
// pet has been (it strafes round it). The brain stands the thrower still through the wind-up (brain.ts X4 block); the
// release re-plans from where it stands (a target that moved off meanwhile: it keeps winding, up to WIND_MAX, for a
// fresh plan, else re-solves the old arc), so the blast lands on the plan. In team-deathmatch, beyond a lob (22-36 m),
// a healthy grenadier fighting a holding target closes to 12-19 m for up to 4 s (throwApproachBand: the brain's engage
// band); after its release it never walks into its own blast (keepClearOfOwnBlast).
import type { SimEntity } from '../entity';
import { Btn } from '../../shared/input';
import { EFlag, type SpeciesId } from '../../shared/types';
import {
  ORDNANCE_BLAST, arcLineClear, clampLaunch, makeArcResult, makeLaunch, makeSolve, ordnanceFor, predictArc, solveThrow, throwLaunch,
  type ArcWorld, type ThrowSolve,
} from '../../shared/content/ordnance';

/** Decision tuning (data; the design reasons live in docs/handoff/X4.md §4 and docs/handoff/F2.md). */
export const ORDNANCE_AI = {
  clusterMin: 2,
  /** F2: a pet holds after staying within holdR m of one spot for holdTicks; a single holding pet is a target after
   *  singleTicks (measured, TDM 4v4, 3 seeds a map: 1.5 s gave 1 throw a match, 1.0 s 3 at the same hit rate). */
  holdR: 2.5,
  holdTicks: 60,
  singleTicks: 60,
  /** F2: a lone target also has at least this health fraction: a grenade is an opener (X4), and a hurt pet dies to the
   *  guns before a 2.2 s fuse (measured: most single-throw misses). */
  singleHp: 0.6,
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
  /** F2: the point the arc was solved for (the centre, moved short by the roll), re-solved at the release. */
  ax: number; ay: number; az: number;
}
export const makePlan = (): ThrowPlan => ({ ...makeSolve(), cx: 0, cy: 0, cz: 0, bx: 0, by: 0, bz: 0, hits: 0, ax: 0, ay: 0, az: 0 });

const solve = makeSolve();
const recheck = makePlan();
const chk = makeArcResult();
const chkLaunch = makeLaunch();

/** Characters a bot can throw at / must spare: anything with a position (SimEntity satisfies it). */
type Body = Pick<SimEntity, 'id' | 'pos' | 'dead' | 'team'> & { char?: SimEntity['char'] };

// ---------------------------------------------------------------- F2: who is holding still
/** Where a pet started holding, since when, and the mean of where it has been since (a strafing pet swings round it). */
interface Anchor { x: number; z: number; since: number; mx: number; mz: number; n: number }
const anchors = new WeakMap<object, Anchor>();

/** F2: note where every living character is (the AI system calls this once per tick). A pet that leaves the HOLD_R m
 *  disc round its anchor gets a new anchor there. */
export function noteBodies(tick: number, bodies: readonly Body[]): void {
  const R = ORDNANCE_AI.holdR;
  for (const b of bodies) {
    const a = anchors.get(b);
    if (!a || b.dead) { anchors.set(b, { x: b.pos.x, z: b.pos.z, since: tick, mx: b.pos.x, mz: b.pos.z, n: 1 }); continue; }
    if (Math.hypot(b.pos.x - a.x, b.pos.z - a.z) > R) { a.x = b.pos.x; a.z = b.pos.z; a.since = tick; a.mx = b.pos.x; a.mz = b.pos.z; a.n = 1; continue; }
    a.n = Math.min(a.n + 1, 120); // (a 2 s window)
    a.mx += (b.pos.x - a.mx) / a.n; a.mz += (b.pos.z - a.mz) / a.n;
  }
}

/** F2: where to aim at a holding pet: the mean of its spot while holding (its position when never noted). */
function aimOf(b: Body): { x: number; z: number } {
  const a = anchors.get(b);
  return a ? { x: a.mx, z: a.mz } : b.pos;
}

const hpOf = (b: Body) => { const h = (b as { health?: { hp: number; max: number } }).health; return h ? h.hp / h.max : 1; };

/** F2: ticks `b` has been holding its spot (Infinity when never noted: a bare test body that never moves). */
export function heldTicks(b: Body, tick: number): number {
  const a = anchors.get(b);
  return a ? tick - a.since : Infinity;
}

/**
 * Should `bot` throw now, and how? Pure: the same inputs give the same plan. `enemies` = the enemies the bot perceives
 * (the caller decides sight), `allies` = its teammates. Both are filtered by team here (the bot's own team never
 * counts as a target, the other team never as an ally), so passing every character as `allies` is safe.
 */
export function planThrow(bot: SimEntity, enemies: readonly Body[], allies: readonly Body[], aw: ArcWorld, out: ThrowPlan, tick = 0): boolean {
  if (bot.dead || !bot.char || !(bot.flags & EFlag.Ordnance) || bot.flags & (EFlag.Mounted | EFlag.Stunned)) return false;
  const A = ORDNANCE_AI;
  const R = ORDNANCE_BLAST.explodeRadius;
  // the best target: a cluster of holding pets (most members, then nearest the middle of the range band), else a single
  // pet holding long enough (F2); ties: enemy order
  let bestN = 0, bestScore = Infinity, cx = 0, cy = 0, cz = 0;
  for (let i = 0; i < enemies.length; i++) {
    const s = enemies[i];
    if (s.dead || s.team === bot.team) continue;
    const sHeld = heldTicks(s, tick);
    if (sHeld < A.holdTicks) continue; // F2: on the move, it won't be there in 2-4 s
    let n = 0, sx = 0, sy = 0, sz = 0;
    for (let j = 0; j < enemies.length; j++) {
      const o = enemies[j];
      if (o.dead || o.team === bot.team || Math.hypot(o.pos.x - s.pos.x, o.pos.z - s.pos.z) > A.clusterR || Math.abs(o.pos.y - s.pos.y) > 2) continue;
      if (heldTicks(o, tick) < A.holdTicks) continue;
      const m = aimOf(o);
      n++; sx += m.x; sy += o.pos.y; sz += m.z;
    }
    if (n < A.clusterMin && (n < 1 || sHeld < A.singleTicks || hpOf(s) < A.singleHp)) continue;
    sx /= n; sy /= n; sz /= n;
    const d = Math.hypot(sx - bot.pos.x, sz - bot.pos.z);
    if (d < A.range[0] || d > A.range[1]) continue;
    const score = Math.abs(d - (A.range[0] + A.range[1]) / 2);
    if (n > bestN || (n === bestN && score < bestScore)) { bestN = n; bestScore = score; cx = sx; cy = sy; cz = sz; }
  }
  if (bestN < 1) return false;
  const need = Math.min(bestN, A.clusterMin); // the blast must reach the cluster (2), or the lone camper (1)
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
    const m = aimOf(o); // F2: where a holding pet is on average (it strafes round it through the fuse)
    const ox = m.x, oy = o.pos.y + 0.6, oz = m.z;
    if (Math.hypot(ox - bx, oy - by, oz - bz) > R * 0.85) continue;
    if (arcLineClear(aw, bx, by, bz, ox, oy, oz)) hits++;
  }
  if (hits < need) return false;
  // never near an ally, never near itself
  if (Math.hypot(bot.pos.x - bx, bot.pos.z - bz) < A.allyClear) return false;
  for (let i = 0; i < allies.length; i++) {
    const o = allies[i];
    if (o.id === bot.id || o.dead || o.team !== bot.team) continue;
    if (Math.hypot(o.pos.x - bx, o.pos.y - by, o.pos.z - bz) < A.allyClear) return false;
  }
  out.yaw = solve.yaw; out.pitch = solve.pitch; out.x = solve.x; out.y = solve.y; out.z = solve.z; out.t = solve.t; out.miss = solve.miss;
  out.cx = cx; out.cy = cy; out.cz = cz; out.bx = bx; out.by = by; out.bz = bz; out.hits = hits;
  out.ax = tx; out.ay = cy; out.az = tz;
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
  /** F2: the last release (tick; -1 = none) and where its blast was solved to land. */
  released: number;
  rx: number; rz: number;
  /** F2: closing in on a camper beyond throwing range: until this tick, on this target; no new approach before `nextApproach`. */
  approachUntil: number;
  approachOn: number;
  nextApproach: number;
}

export function createOrdnanceBot(id: number): OrdnanceBot {
  return { phase: 'idle', next: id % ORDNANCE_AI.checkTicks, since: 0, plan: makePlan(), throws: 0, released: -1, rx: 0, rz: 0,
    approachUntil: 0, approachOn: -1, nextApproach: 0 };
}

/** F2: the band a grenadier closes to (m), how far out it goes for a camper (m), for how long and how often (ticks). */
const APPROACH_BAND: [number, number] = [12, 19];
const APPROACH_FROM = 36, APPROACH_TICKS = 240, APPROACH_EVERY = 480;

/**
 * F2 (Q4 P2-3, TDM only: brain.ts throwBand): a bot carrying its throwable, healthy, fighting a target that holds its spot, healthy, 22-36 m off
 * (beyond a lob: most TDM firefights are): close to 12-19 m for up to 4 s (the brain's engage band), so the grenade
 * flushes the camper. Null = no approach (keep the kit's own band). Like the Assault's bark push (tactics.ts pushBand).
 */
export function throwApproachBand(ob: OrdnanceBot, bot: SimEntity, target: Body | null, tick: number): [number, number] | null {
  if (ob.phase === 'wind' || !(bot.flags & EFlag.Ordnance) || bot.flags & (EFlag.Mounted | EFlag.Carrier)) return null;
  if (!target || target.dead) return null;
  if (tick < ob.approachUntil && ob.approachOn === target.id) return APPROACH_BAND;
  if (tick < ob.nextApproach || hpOf(bot) < 0.5) return null;
  const d = Math.hypot(target.pos.x - bot.pos.x, target.pos.z - bot.pos.z);
  if (d <= ORDNANCE_AI.range[1] || d > APPROACH_FROM) return null;
  if (heldTicks(target, tick) < ORDNANCE_AI.holdTicks || hpOf(target) < ORDNANCE_AI.singleHp) return null;
  ob.approachOn = target.id; ob.approachUntil = tick + APPROACH_TICKS; ob.nextApproach = tick + APPROACH_EVERY;
  return APPROACH_BAND;
}

/** F2: seconds from the release to the blast (the fuse); the margin (m) a bot keeps outside its own blast radius. */
const FUSE_TICKS = Math.round(2.2 * 60), OWN_CLEAR = ORDNANCE_BLAST.explodeRadius + 1.5;

/**
 * F2: while its own grenade is live, a bot drops any move component that would carry it into the blast (a storming
 * attacker threw at the guard, then sprinted into its own blast: Q4's self-hits). `mv` = the move direction (world x/z).
 */
export function keepClearOfOwnBlast(ob: OrdnanceBot, bot: SimEntity, tick: number, mv: { x: number; z: number }): void {
  if (ob.released < 0 || tick - ob.released > FUSE_TICKS) return;
  const ox = bot.pos.x - ob.rx, oz = bot.pos.z - ob.rz, d = Math.hypot(ox, oz);
  if (d > OWN_CLEAR + 2 || d < 1e-3) return;
  const inward = -(mv.x * ox + mv.z * oz) / d;
  if (inward <= 0) return;
  if (d < OWN_CLEAR) { mv.x = ox / d; mv.z = oz / d; return; } // inside the margin: step out
  mv.x += (ox / d) * inward; mv.z += (oz / d) * inward;        // at the edge: slide round it
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
      // F2: the target may have moved off since the plan (a pet being closed in on repositions). Re-plan from where the
      // bot stands now: a valid plan is thrown on its fresh angles; none → keep winding (checked every 6 ticks) up to
      // windMax, then the old plan's arc re-solved from here (the release can't be cancelled).
      const fresh = (held - A.windTicks) % 6 === 0 && planThrow(bot, enemies, allies, aw, recheck, tick);
      if (!fresh && held < A.windMax) { out.buttons = Btn.Throw; return out; }
      out.buttons = 0; // release: the authority throws with this tick's yaw/pitch (the brain snaps to these angles)
      if (fresh) {
        out.yaw = recheck.yaw; out.pitch = recheck.pitch;
        ob.rx = recheck.bx; ob.rz = recheck.bz;
      } else {
        if (solveThrow(aw, bot.pos.x, bot.pos.y, bot.pos.z, bot.species as SpeciesId, ob.plan.ax, ob.plan.ay, ob.plan.az, solve, 1.0)) {
          out.yaw = solve.yaw; out.pitch = solve.pitch;
        }
        ob.rx = ob.plan.bx; ob.rz = ob.plan.bz;
      }
      ob.phase = 'idle'; ob.next = tick + A.cooldownTicks; ob.throws++;
      ob.released = tick;
    } else out.buttons = Btn.Throw;
    return out;
  }
  if (!able || tick < ob.next) return out;
  ob.next = tick + A.checkTicks;
  if (!planThrow(bot, enemies, allies, aw, ob.plan, tick)) return out;
  ob.phase = 'wind'; ob.since = tick;
  out.active = true; out.yaw = ob.plan.yaw; out.pitch = ob.plan.pitch; out.buttons = Btn.Throw;
  return out;
}
