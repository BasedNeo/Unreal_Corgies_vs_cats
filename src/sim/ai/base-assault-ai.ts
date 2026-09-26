// Base Assault bot play (W9 G4b, mode-1): who attacks, defends, escorts and chases, and where each one goes. Pure and
// deterministic (no rng outside the sim's own stream; ties go to the lower entity id) and cheap: the team plan runs at
// most once per team per 0.5 s (or at once when a ball changes hands), a bot's goal every 0.5 s with the rest of its
// objective goal (tactics.ts updateObjectiveGoal → baseAssaultGoal, goal kind 'ball'). Rules: match/base-assault.ts.
//
// Roles (per team, from its living bots and both balls; sticky: a bot keeps its role while the plan still has a slot of
// that kind, so roles don't flicker as bots run past each other):
//   carry    our bot with the enemy ball: straight home to a spot inside our capture ring, and wait there (it captures the
//            moment our own ball is home, or when the stalemate relief opens). It runs through fights (rush: the brain
//            keeps it on its route and it only turns to shoot what is in front of it) and never boards a vehicle.
//   escort   shadows our carrier (a bot or a human) from beside it and fights from there.
//   attack   to the enemy ball and touch it. On its stand: gather at a rally point RALLY_D m short of it, then storm it
//            together; on the ground (where our carrier fell): straight at it. A healthy attacker pushes through fights on
//            the way (rush), a hurt one fights its way; far trips may take a kart (tactics.ts objectiveTrip).
//   defend   guards our stand from a spot beside it, fighting from there (the brain's hold zone keeps it home).
//   return   our ball lies on the ground: the nearest two touch it home (rush over the last RUSH m).
//   chase    our ball is taken: hunt the carrier (every bot focuses a carrier it can see, brain.ts perceive). A chaser
//            closer to the thieves' ring than the carrier is cuts it off there; the others pursue it.
// Counts (N = the team's bots left after carry and return):
//   both balls home, or theirs dropped     defend 1 (2 from 6 bots; none for a team behind in the last 90 s), attack
//                                          the rest (they gather at a rally point short of the enemy stand, then storm it)
//   we carry, ours home                    escort half (at most 3), defend the rest (a capture needs our ball home)
//   ours taken                             chase, except 1 escort if we carry, else 1 attacker (from 3 bots)
// Why (game-design-psychology): every state has a readable answer (runners, a guard, a bodyguard, a hunt), a stolen ball
// always gets an answer (comebacks), and nobody idles in a dead state: a carrier waiting for its own ball is guarded while
// the rest hunt the other carrier, and the G4a stalemate relief ends the standoff.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { EntityKind, EFlag, type EntityId } from '../../shared/types';
import { BA_BALL, BallState } from '../../shared/content/modes';
import { TICK_HZ } from '../../shared/constants';
import { baseAssaultConfig, baseAssaultState, type BallRt, type BaseAssaultState } from '../match/base-assault';
import { type NavGrid, cellIndex, cellX, cellZ, findPath, nearestWalkable, randomCell } from './nav';
import type { TacticsState } from './tactics';

export type BaRole = 'carry' | 'escort' | 'attack' | 'defend' | 'return' | 'chase';

/** A bot's Base Assault state (TacticsState.ba). */
export interface BaBot {
  role: BaRole;
  /** Keep running for the goal through a fight (brain.ts engage), turning only to shoot what is ahead. */
  rush: boolean;
  /** Tick the role began. */
  since: number;
  /** The ball / carrier / stand the role is about (-1 = none). */
  about: EntityId;
}

interface TeamPlan {
  /** Next tick the plan is due; the ball signature it was made for. */
  due: number;
  sig: number;
  roles: Map<EntityId, BaRole>;
  /** The attackers storm the enemy stand (else they gather at the rally point); since when; first arrival at the rally. */
  push: boolean;
  pushAt: number;
  rallyAt: number;
}

type Spot = { x: number; z: number };

interface PlanState {
  teams: [TeamPlan, TeamPlan];
  /** Per team: a walkable spot inside its capture ring (where its carriers wait), found once. */
  ring: [Spot | null, Spot | null];
  /** Per team: where its attackers gather before storming the enemy stand, found once. */
  rally: [Spot | null, Spot | null];
  /** Telemetry: team plans made, pushes started. */
  plans: number;
  pushes: [number, number];
}

/** Re-plan every this many ticks (0.5 s). */
const PLAN_EVERY = 30;
/** Cost bonus (m) for keeping the current role: the hysteresis. */
const STICKY = 25;
/** Rush a ball (steal, return, pick up) within this range (m); stop rushing beyond RUSH_OFF. */
const RUSH = 14, RUSH_OFF = 18;
/** Guard zone around the stand (m). */
const GUARD_R = 9;
/** Escort zone around the carrier (m); side offset of an escort's spot (m). */
const ESCORT_R = 8, ESCORT_SIDE = 3;
/** A rushing bot only turns to shoot targets within this angle of where it runs (55°: it still sprints while it shoots). */
const RUSH_COS = Math.cos(55 * (Math.PI / 180));
/**
 * The rally: attackers gather RALLY_D m short of the enemy stand (back along the route home), in a RALLY_R m zone they
 * fight from, and storm the stand together once RALLY_N of them are there (2; 3 from 5 attackers) or the first one has
 * waited RALLY_WAIT s. A storm lasts at least PUSH_MIN s, then while an attacker is within PUSH_KEEP m of the stand
 * (inside the rally distance: once the storm is spent, the next attackers gather again instead of trickling in).
 * Why: a lone thief steals next to the enemy spawns and is down within 20 m; a squad steals with its escort already there.
 */
const RALLY_D = 35, RALLY_R = 9, RALLY_WAIT = 8, PUSH_MIN = 8, PUSH_KEEP = 22;
/** A team behind on captures with less than this many seconds left sends its guards too (s). */
const ALL_IN = 90;

const states = new WeakMap<Sim, PlanState>();

function planState(sim: Sim): PlanState {
  let s = states.get(sim);
  if (!s) {
    const plan = (): TeamPlan => ({ due: -1, sig: -1, roles: new Map(), push: false, pushAt: 0, rallyAt: -1 });
    s = { teams: [plan(), plan()], ring: [null, null], rally: [null, null], plans: 0, pushes: [0, 0] };
    states.set(sim, s);
  }
  return s;
}

const other = (t: 0 | 1): 0 | 1 => (t === 0 ? 1 : 0);

/** Where a ball is now (its entity; the stand top while home). */
function ballPos(sim: Sim, st: BaseAssaultState, b: BallRt): { x: number; y: number; z: number } {
  const e = sim.entities.get(b.ball);
  if (e) return e.pos;
  const s = st.spots[b.team].stand;
  return { x: s.x, y: s.y + BA_BALL.standTop + BA_BALL.radius, z: s.z };
}

function sigOf(st: BaseAssaultState): number {
  const [a, b] = st.balls;
  return ((a.state * 3 + b.state) * 2 + (st.relief ? 1 : 0)) * 1e12 + (a.carrier + 1) * 1e6 + (b.carrier + 1);
}

/** Room bots of the team (living, in id order: the chars list is built in entity order). */
function botsOf(chars: SimEntity[], team: 0 | 1): SimEntity[] {
  const out: SimEntity[] = [];
  for (const c of chars) if (c.team === team && c.kind === EntityKind.Bot && !c.combat?.pve && !c.dead) out.push(c);
  return out;
}

const d2 = (a: { x: number; z: number }, x: number, z: number) => Math.hypot(a.x - x, a.z - z);

/** Take up to n bots from the pool for a role: cheapest cost first (the current role is STICKY m cheaper). */
function fill(pool: SimEntity[], role: BaRole, n: number, cost: (b: SimEntity) => number, prev: Map<EntityId, BaRole>, out: Map<EntityId, BaRole>): void {
  for (let k = 0; k < n && pool.length; k++) {
    let bi = 0, bc = Infinity;
    for (let i = 0; i < pool.length; i++) {
      const c = cost(pool[i]) - (prev.get(pool[i].id) === role ? STICKY : 0);
      if (c < bc) { bc = c; bi = i; }
    }
    out.set(pool[bi].id, role);
    pool.splice(bi, 1);
  }
}

/**
 * The team's roles (see the header). Pure given the sim: the same roster, balls and previous roles give the same plan.
 */
export function planTeam(sim: Sim, st: BaseAssaultState, team: 0 | 1, chars: SimEntity[], prev: Map<EntityId, BaRole>): Map<EntityId, BaRole> {
  const own = st.balls[team], foe = st.balls[other(team)];
  const out = new Map<EntityId, BaRole>();
  const pool = botsOf(chars, team);
  const stand = st.spots[team].stand;
  // 1. our carrier (a bot)
  const weCarry = foe.state === BallState.Carried;
  const ci = weCarry ? pool.findIndex((b) => b.id === foe.carrier) : -1;
  if (ci >= 0) { out.set(pool[ci].id, 'carry'); pool.splice(ci, 1); }
  // 2. our ball on the ground: the nearest two send it home
  if (own.state === BallState.Dropped) {
    const p = ballPos(sim, st, own);
    fill(pool, 'return', Math.min(2, pool.length), (b) => d2(b.pos, p.x, p.z), prev, out);
  }
  const N = pool.length;
  if (own.state === BallState.Carried) {
    // our ball is taken: hunt the carrier; keep a bodyguard on ours; keep one thief going for leverage
    const thief = sim.entities.get(own.carrier);
    const carrier = weCarry ? sim.entities.get(foe.carrier) : undefined;
    if (carrier) fill(pool, 'escort', Math.min(1, N), (b) => d2(b.pos, carrier.pos.x, carrier.pos.z), prev, out);
    const attackers = !weCarry && N >= 3 ? 1 : 0;
    const tx = thief?.pos.x ?? stand.x, tz = thief?.pos.z ?? stand.z;
    fill(pool, 'chase', pool.length - attackers, (b) => d2(b.pos, tx, tz), prev, out);
  } else if (weCarry) {
    // we carry and ours is home (or on the ground: returners are out already): bodyguards, and the rest keep ours home
    const carrier = sim.entities.get(foe.carrier);
    const n = Math.min(3, Math.ceil(N / 2));
    if (carrier) fill(pool, 'escort', n, (b) => d2(b.pos, carrier.pos.x, carrier.pos.z), prev, out);
    fill(pool, 'defend', pool.length, (b) => d2(b.pos, stand.x, stand.z), prev, out);
  } else {
    // both home (or theirs on the ground): a guard (two from six bots), everyone else goes for their ball; a team behind
    // in the last ALL_IN s leaves its stand open and goes all in (the comeback)
    const m = sim.state.match as { score?: number[]; timeLeft?: number; phase?: string } | undefined;
    const allIn = m?.phase === 'live' && !!m.score && m.score[team] < m.score[other(team)] && (m.timeLeft ?? Infinity) < ALL_IN;
    const n = allIn ? 0 : N >= 6 ? 2 : N >= 3 ? 1 : 0;
    fill(pool, 'defend', n, (b) => d2(b.pos, stand.x, stand.z), prev, out);
  }
  const fp = ballPos(sim, st, foe);
  fill(pool, 'attack', pool.length, (b) => d2(b.pos, fp.x, fp.z), prev, out);
  return out;
}

/** The team plan, made when due (every 0.5 s), when a ball changed hands, or when a bot isn't in it yet (respawned). */
function planFor(sim: Sim, st: BaseAssaultState, g: NavGrid, team: 0 | 1, e: SimEntity, chars: SimEntity[]): TeamPlan {
  const ps = planState(sim);
  const p = ps.teams[team];
  const sig = sigOf(st);
  if (sim.tick >= p.due || p.sig !== sig || !p.roles.has(e.id)) {
    p.roles = planTeam(sim, st, team, chars, p.roles);
    p.due = sim.tick + PLAN_EVERY;
    p.sig = sig;
    ps.plans++;
    updatePush(sim, st, g, team, p);
  }
  return p;
}

/** Rally or storm (see RALLY_D): only while the enemy ball is on its stand. */
function updatePush(sim: Sim, st: BaseAssaultState, g: NavGrid, team: 0 | 1, p: TeamPlan): void {
  if (st.balls[other(team)].state !== BallState.Home) { p.push = false; p.rallyAt = -1; return; }
  const r = rallySpot(sim, st, g, team), s = st.spots[other(team)].stand;
  let n = 0, at = 0, close = 0;
  for (const [id, role] of p.roles) {
    const b = role === 'attack' ? sim.entities.get(id) : undefined;
    if (!b || b.dead) continue;
    n++;
    if (d2(b.pos, r.x, r.z) < RALLY_R + 2) at++;
    if (d2(b.pos, s.x, s.z) < PUSH_KEEP) close++;
  }
  if (p.push) {
    if (sim.tick - p.pushAt < PUSH_MIN * TICK_HZ || close > 0) return;
    p.push = false;
  }
  if (at === 0) { p.rallyAt = -1; return; }
  if (p.rallyAt < 0) p.rallyAt = sim.tick;
  if (at >= Math.min(n, n >= 5 ? 3 : 2) || sim.tick - p.rallyAt >= RALLY_WAIT * TICK_HZ) {
    p.push = true; p.pushAt = sim.tick; p.rallyAt = -1;
    planState(sim).pushes[team]++;
  }
}

/** Where the team's attackers gather: RALLY_D m from the enemy stand back along the route to their own flag (cached). */
function rallySpot(sim: Sim, st: BaseAssaultState, g: NavGrid, team: 0 | 1): Spot {
  const ps = planState(sim);
  const have = ps.rally[team];
  if (have) return have;
  const s = st.spots[other(team)].stand, f = st.spots[team].flag;
  const path: number[] = [];
  findPath(g, s.x, s.z, f.x, f.z, path); // from the stand: even a partial route (a long map) starts right
  let px = s.x, pz = s.z, left = RALLY_D, x = s.x, z = s.z;
  for (let i = 0; i + 1 < path.length && left > 0; i += 2) {
    const l = Math.hypot(path[i] - px, path[i + 1] - pz);
    if (l >= left) { x = px + ((path[i] - px) * left) / l; z = pz + ((path[i + 1] - pz) * left) / l; left = 0; }
    else { left -= l; px = path[i]; pz = path[i + 1]; x = px; z = pz; }
  }
  if (!path.length) { const l = d2(f, s.x, s.z) || 1; x = s.x + ((f.x - s.x) / l) * RALLY_D; z = s.z + ((f.z - s.z) / l) * RALLY_D; }
  const c = nearestWalkable(g, x, z, 4);
  const spot = c >= 0 ? { x: cellX(g, c), z: cellZ(g, c) } : { x, z };
  ps.rally[team] = spot;
  return spot;
}

/** A walkable spot inside the team's capture ring (its carriers wait there), cached. */
function ringSpot(sim: Sim, st: BaseAssaultState, g: NavGrid, team: 0 | 1): { x: number; z: number } {
  const ps = planState(sim);
  const have = ps.ring[team];
  if (have) return have;
  const f = st.spots[team].flag;
  const r = baseAssaultConfig(sim).captureRadius - 0.9;
  let best = -1, bd = Infinity;
  for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
    for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++) {
      const i = cellIndex(g, f.x + dx, f.z + dz);
      if (i < 0 || !g.walk[i] || g.region[i] !== g.mainRegion) continue;
      const d = Math.hypot(cellX(g, i) - f.x, cellZ(g, i) - f.z);
      if (d > r || d >= bd) continue;
      bd = d; best = i;
    }
  }
  if (best < 0) best = nearestWalkable(g, f.x, f.z, 4);
  const spot = best >= 0 ? { x: cellX(g, best), z: cellZ(g, best) } : { x: f.x, z: f.z };
  ps.ring[team] = spot;
  return spot;
}

/** Aim a goal at (x, z): itself when walkable, else the nearest walkable cell (the brain walks straight in at the end). */
function pointAt(t: TacticsState, g: NavGrid, x: number, z: number): void {
  t.gx = x; t.gz = z;
  const i = cellIndex(g, x, z);
  if (i >= 0 && g.walk[i]) return;
  const c = nearestWalkable(g, x, z, 3);
  if (c >= 0) { t.gx = cellX(g, c); t.gz = cellZ(g, c); }
}

/** A spot in a zone, kept while it stays inside (a guard's post, an escort's place beside its carrier). */
function zoneSpot(sim: Sim, t: TacticsState, g: NavGrid, keep: boolean, x: number, z: number, r: number): void {
  if (keep && Math.hypot(t.gx - x, t.gz - z) < r * 0.8) return;
  let c = randomCell(g, sim.rng, g.mainRegion, x, z, r * 0.6, 1.5);
  if (c < 0) c = nearestWalkable(g, x, z, Math.ceil(r));
  t.gx = c >= 0 ? cellX(g, c) : x; t.gz = c >= 0 ? cellZ(g, c) : z;
}

/** Attackers at or above this health fraction push through fights on the way to the enemy ball. */
const PUSH_HP = 0.5;
const hpFrac = (e: SimEntity) => (e.health ? e.health.hp / e.health.max : 1);

/** Rush a point within RUSH m; stop rushing beyond RUSH_OFF (hysteresis). */
function rushNear(b: BaBot, e: SimEntity, x: number, z: number): boolean {
  const d = Math.hypot(x - e.pos.x, z - e.pos.z);
  return b.rush ? d < RUSH_OFF : d < RUSH;
}

/**
 * tactics.ts updateObjectiveGoal hook for base-assault rooms (every 0.5 s per room bot): the bot's role from its team's
 * plan, and its goal ('ball'): t.gx/gz/gy the spot, t.hold + t.cx/cz/gr a zone to fight from (guards, escorts), t.ba.rush.
 */
export function baseAssaultGoal(sim: Sim, e: SimEntity, t: TacticsState, g: NavGrid, chars: SimEntity[], prev: string, prevId: EntityId): void {
  const t0 = performance.now();
  goalOf(sim, e, t, g, chars, prev, prevId);
  baPerf.ms += performance.now() - t0;
  baPerf.calls++;
}

/** Cost telemetry (the goal hook, team plans included), for benches and the soak: total ms and calls since start. */
export const baPerf = { ms: 0, calls: 0 };

function goalOf(sim: Sim, e: SimEntity, t: TacticsState, g: NavGrid, chars: SimEntity[], prev: string, prevId: EntityId): void {
  const st = baseAssaultState(sim);
  const team = e.team;
  if (!st || (team !== 0 && team !== 1)) { if (t.ba) t.ba.rush = false; return; }
  const plan = planFor(sim, st, g, team, e, chars);
  const role = plan.roles.get(e.id) ?? 'attack';
  const b = t.ba ?? (t.ba = { role, rush: false, since: sim.tick, about: -1 });
  const keep = prev === 'ball' && b.role === role && t.hold; // the same zone as last time: keep the spot in it
  if (b.role !== role) { b.role = role; b.since = sim.tick; b.rush = false; }
  const own = st.balls[team], foe = st.balls[other(team)];
  t.goal = 'ball'; t.interact = false; t.hold = false;
  t.gy = e.pos.y;
  switch (role) {
    case 'carry': {
      const s = ringSpot(sim, st, g, team), f = st.spots[team].flag;
      t.gx = s.x; t.gz = s.z; t.gy = f.y; t.cx = f.x; t.cz = f.z; t.gr = baseAssaultConfig(sim).captureRadius;
      // running home; in the ring (waiting for our ball, or the relief) it holds the ring and fights from inside it
      const d = Math.hypot(s.x - e.pos.x, s.z - e.pos.z);
      b.rush = b.rush ? d > 1.2 : d > 2.5;
      t.hold = !b.rush;
      b.about = own.goal;
      break;
    }
    case 'escort': {
      const c = sim.entities.get(foe.carrier);
      if (!c || foe.state !== BallState.Carried) { t.goal = ''; b.rush = false; return; }
      // beside the carrier, a little ahead of it on the way home (left or right by id)
      const s = ringSpot(sim, st, g, team);
      const hx = s.x - c.pos.x, hz = s.z - c.pos.z, hl = Math.hypot(hx, hz) || 1;
      const side = e.id % 2 ? 1 : -1;
      pointAt(t, g, c.pos.x + (hx / hl) * 1.5 - (hz / hl) * ESCORT_SIDE * side, c.pos.z + (hz / hl) * 1.5 + (hx / hl) * ESCORT_SIDE * side);
      t.hold = true; t.cx = c.pos.x; t.cz = c.pos.z; t.gr = ESCORT_R; t.gy = c.pos.y;
      b.rush = false; b.about = c.id;
      break;
    }
    case 'defend': {
      const s = st.spots[team].stand;
      zoneSpot(sim, t, g, keep, s.x, s.z, GUARD_R);
      t.hold = true; t.cx = s.x; t.cz = s.z; t.gr = GUARD_R; t.gy = s.y;
      b.rush = false; b.about = own.stand;
      break;
    }
    case 'return': {
      const p = ballPos(sim, st, own);
      pointAt(t, g, p.x, p.z);
      t.gy = p.y - BA_BALL.radius;
      b.rush = rushNear(b, e, p.x, p.z); b.about = own.ball;
      break;
    }
    case 'chase': {
      const c = sim.entities.get(own.carrier);
      if (!c || own.state !== BallState.Carried) { t.goal = ''; b.rush = false; return; }
      // cut it off at its ring when this bot is closer to that ring than the carrier is, else run it down
      const s = ringSpot(sim, st, g, other(team));
      const mine = Math.hypot(s.x - e.pos.x, s.z - e.pos.z), its = Math.hypot(s.x - c.pos.x, s.z - c.pos.z);
      if (mine < its && its > 6) pointAt(t, g, s.x, s.z);
      else pointAt(t, g, c.pos.x + c.vel.x * 0.6, c.pos.z + c.vel.z * 0.6);
      t.gy = c.pos.y;
      b.rush = false; b.about = c.id;
      break;
    }
    case 'attack': {
      const p = ballPos(sim, st, foe);
      if (foe.state === BallState.Carried) { t.goal = ''; b.rush = false; return; } // (a teammate has it: the plan catches up)
      b.about = foe.ball;
      if (foe.state === BallState.Home && !plan.push) {
        // gather at the rally point and fight from there until the squad storms the stand
        const r = rallySpot(sim, st, g, team);
        zoneSpot(sim, t, g, keep, r.x, r.z, RALLY_R);
        t.hold = true; t.cx = r.x; t.cz = r.z; t.gr = RALLY_R;
        b.rush = hpFrac(e) >= PUSH_HP && d2(e.pos, r.x, r.z) > RALLY_R + 6; // healthy: push through to it
        break;
      }
      if (foe.state === BallState.Home) { const s = st.spots[foe.team].stand; pointAt(t, g, s.x, s.z); t.gy = s.y; }
      else { pointAt(t, g, p.x, p.z); t.gy = p.y - BA_BALL.radius; }
      // storming the stand: all in; a ball on the ground: rushed when healthy or in reach
      b.rush = plan.push || rushNear(b, e, p.x, p.z) || hpFrac(e) >= PUSH_HP;
      break;
    }
  }
  t.goalId = b.about;
  if (prev !== 'ball' || prevId !== t.goalId) t.goalSince = sim.tick;
}

/**
 * brain.ts aim hook: a rushing bot ignores a target more than 55° off where it runs (it keeps its eyes on the route
 * and keeps sprinting; its escorts deal with the chasers). (mx, mz) = the move direction this tick.
 */
export function ballRunIgnores(e: SimEntity, t: TacticsState, target: SimEntity, mx: number, mz: number): boolean {
  if (!t.ba?.rush || t.goal !== 'ball' || (!mx && !mz)) return false;
  const dx = target.pos.x - e.pos.x, dz = target.pos.z - e.pos.z;
  const l = Math.hypot(dx, dz) * Math.hypot(mx, mz);
  return l > 1e-6 && (dx * mx + dz * mz) / l < RUSH_COS;
}

/**
 * tactics.ts buddyInTrouble: a bot with a Base Assault role helps a human teammate under fire only this close (m; 90 in
 * other modes). A human is nearly always in some fight: at 90 m every guard, rally and return nearby left its role.
 */
export const BALL_HELP = 30;

/** brain.ts perception: extra priority (m) for a visible enemy carrying a ball (everybody focuses the carrier). */
export const CARRIER_FOCUS = 15;

/**
 * tactics.ts objectiveTrip: a Base Assault goal as a vehicle trip (false = none): runs to the enemy ball, a far guard post,
 * a chase or a return; never a carrier (carriers can't mount) or an escort (it stays with its slow carrier). The ride is
 * still only taken when it beats walking (tactics.ts considerBoarding).
 */
export function ballTrip(t: TacticsState, out: { x: number; z: number; r: number; stay: boolean; calm: boolean }): boolean {
  const b = t.ba;
  if (!b || t.goal !== 'ball' || b.role === 'carry' || b.role === 'escort') return false;
  out.x = t.gx; out.z = t.gz; out.r = b.role === 'defend' ? 8 : 6; out.stay = false; out.calm = false;
  return true;
}

/** tactics.ts vehicleThink: a carrier never boards (the vehicle system would refuse it at the Interact press). */
export function isCarrier(e: SimEntity): boolean {
  return (e.flags & EFlag.Carrier) !== 0;
}

/** The bot's current role (tests, tools, labs), or null outside a base-assault goal. */
export function baRoleOf(e: SimEntity): BaRole | null {
  const t = (e as { ai?: { tac: TacticsState } }).ai?.tac;
  return t?.goal === 'ball' && t.ba ? t.ba.role : null;
}

/** Telemetry: team plans made in this sim so far; storms started per team. */
export function baPlanCount(sim: Sim): number {
  return states.get(sim)?.plans ?? 0;
}
export function baPushCount(sim: Sim): [number, number] {
  const p = states.get(sim)?.pushes;
  return p ? [p[0], p[1]] : [0, 0];
}
