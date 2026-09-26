// base-assault (W9 G4a, mode-1): steal the enemy's squeaky tennis ball from its base and run it home. Authoritative:
// every pickup, drop, return and capture happens here, in the match system (order 800: after movement, world effects,
// combat, the kill plane and respawns, so this tick's deaths and teleports are already known). Rules and the snapshot
// convention: src/shared/content/modes.ts (BASE_ASSAULT). The carrier's slow and no-glide rules live in movement.ts
// (keyed on EFlag.Carrier, so client prediction replays them); vehicles/systems.ts refuses carriers a seat.
//
// A ball is always in exactly one place: HOME on its stand, CARRIED by one living enemy of its team (EFlag.Carrier),
// or DROPPED on the ground. Every transition goes through `setHome`, `setCarried` or `setDropped`, which keep the
// Carrier flag in step (checkBallInvariants() asserts it; the tests run it every tick).
//   carried → dropped   the carrier is knocked out (at the death spot, snapped to the surface under it; floats on
//                       water), leaves the room, or is removed by a team/class respawn (at its last spot); a seated
//                       carrier also drops it (defensive: carriers can't mount)
//   carried → home      the carrier is teleported (out of bounds, below killY, a respawn while alive), or is no longer
//                       an enemy of the ball; a capture; a spot that is off the map
//   dropped → home      `returnTime` s on the ground, or a defender touches it
//   home/dropped → carried   an attacker touches it (the nearest toucher wins a same-tick contest; exact ties go to the
//                       defender on a dropped ball, then to the lower entity id)
// Bases: WorldData.bases (C9) → the West Yard's E4 flags (battleOf, the stand beside the flag) → spawn centroids.
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import { Anim, EFlag, EntityKind, Team, type EntityId, type TeamId } from '../../shared/types';
import { emptyInput } from '../../shared/input';
import { TICK_HZ } from '../../shared/constants';
import {
  BASE_ASSAULT, BA_BALL, BA_BALL_SEED, BA_GOAL_SEED, BA_PICKUP_ITEM, BA_REASON, BA_STAND_SEED, BallState,
  type BallStateId, type BaseAssaultConfig,
} from '../../shared/content/modes';
import { battleOf } from '../../shared/world/fortifications';
import { nearestPropDist, surfaceAt, waterAt } from '../../shared/world/queries';
import { kartKeepOut, findOrdnanceSite } from '../interact/sites';
import { creditRoster } from '../interact/state';
import { cellIndex, navGridFor, type NavGrid } from '../ai/nav';
import { capsuleOf } from '../combat/state';
import { pointCapsuleDistance } from '../combat/geometry';

type Side = 0 | 1;
export interface BaseSpot {
  team: Side;
  /** Capture ring centre on the ground (the base's flag). */
  flag: { x: number; y: number; z: number };
  /** Stand foot on the ground and the way it faces. */
  stand: { x: number; y: number; z: number; yaw: number };
  source: 'bases' | 'battle' | 'spawns';
}

/** Authoritative state of one ball (plain data in sim.state.baseAssault). */
export interface BallRt {
  team: Side;
  /** Entity ids: the ball, its stand, its base's capture ring. */
  ball: EntityId;
  stand: EntityId;
  goal: EntityId;
  state: BallStateId;
  /** Carrier entity id (-1 = none). */
  carrier: EntityId;
  /** Tick a dropped ball goes home. */
  returnTick: number;
  /** The carrier's feet at the end of the last tick (drops for carriers that vanish; teleport detection). */
  lastX: number; lastY: number; lastZ: number;
}

export interface BaseAssaultState {
  spots: [BaseSpot, BaseSpot];
  balls: [BallRt, BallRt];
  /** Tick both balls went away from home (-1 = one is home). */
  bothAwayTick: number;
  /** The stalemate relief is open: a team may capture with its own ball away. */
  relief: boolean;
}

/** Read-only ball view for bots, tools and tests. */
export interface BallInfo {
  team: Side;
  id: EntityId;
  state: BallStateId;
  carrier: EntityId;
  x: number; y: number; z: number;
  /** Seconds until a dropped ball goes home (0 otherwise). */
  returnIn: number;
  stand: { x: number; y: number; z: number };
  flag: { x: number; y: number; z: number };
}

export interface BaseAssaultTick {
  /** Teams that captured this tick (in ball order). */
  captures: TeamId[];
}

/** A carrier that moves farther than this in one tick was teleported (sprint ≈ 0.17 m, a blast ≈ 0.5 m per tick). */
const TELEPORT_STEP = 4;
const HOME_Y = BA_BALL.standTop + BA_BALL.radius;
const ROSTER = { capture: 10, steal: 2, return: 3 } as const;

export function baseAssaultConfig(sim: Sim): BaseAssaultConfig {
  const o = (sim.state.matchConfig as { baseAssault?: Partial<BaseAssaultConfig> } | undefined)?.baseAssault;
  return { ...BASE_ASSAULT, ...o };
}

export function baseAssaultState(sim: Sim): BaseAssaultState | undefined {
  return sim.state.baseAssault as BaseAssaultState | undefined;
}

const ticks = (s: number) => Math.round(s * TICK_HZ);
const other = (t: Side): Side => (t === 0 ? 1 : 0);

// ------------------------------------------------------------------------------------------------ bases

function spawnCentroid(sim: Sim, team: Side): { x: number; z: number } | null {
  let x = 0, z = 0, n = 0;
  for (const s of sim.worldData.spawns) if (s.team === team) { x += s.x; z += s.z; n++; }
  return n ? { x: x / n, z: z / n } : null;
}

function grid(sim: Sim): NavGrid | null {
  try { return navGridFor(sim); } catch { return null; } // a sim without Rapier query structures yet
}

/** Share of walkable main-region cells within r of (x, z) (1 when there is no grid). */
function openness(g: NavGrid | null, x: number, z: number, r: number): number {
  if (!g) return 1;
  let ok = 0, all = 0;
  for (let dz = -r; dz <= r + 1e-6; dz += g.cell) for (let dx = -r; dx <= r + 1e-6; dx += g.cell) {
    if (dx * dx + dz * dz > r * r + 1e-6) continue;
    all++;
    const i = cellIndex(g, x + dx, z + dz);
    if (i >= 0 && g.walk[i] && g.cost[i] === 1 && g.region[i] === g.mainRegion) ok++;
  }
  return all ? ok / all : 0;
}

interface Avoid { x: number; z: number; r: number }

/** Things a stand must keep clear of: spawns, both teams' kiosks and kart pads (whether or not the mode runs them),
 *  terminals placed in this sim, jump pads. */
function standAvoid(sim: Sim): Avoid[] {
  const d = sim.worldData, out: Avoid[] = [];
  for (const s of d.spawns) out.push({ x: s.x, z: s.z, r: 2.6 });
  for (const team of [Team.Corgis, Team.Cats] as TeamId[]) {
    const keep = kartKeepOut(d, team);
    for (const k of keep) out.push({ x: k.x, z: k.z, r: Math.max(3, k.r - 2) });
    const ord = findOrdnanceSite(d, team, keep);
    if (ord) out.push({ x: ord.x, z: ord.z, r: 3.6 });
  }
  for (const e of sim.entities.values()) if (e.kind === EntityKind.Terminal || e.kind === EntityKind.Vehicle) out.push({ x: e.pos.x, z: e.pos.z, r: 3.6 });
  for (const p of d.jumpPads ?? []) out.push({ x: p.x, z: p.z, r: p.r + 2 });
  return out;
}

/** Ground height of a clear, level disc for a stand at (x, z), or null. */
function standGround(sim: Sim, g: NavGrid | null, x: number, z: number, near: number, avoid: readonly Avoid[]): number | null {
  const d = sim.worldData;
  const b = d.bounds;
  if (b && (x < b.minX + 4 || x > b.maxX - 4 || z < b.minZ + 4 || z > b.maxZ - 4)) return null;
  for (const a of avoid) if (Math.hypot(a.x - x, a.z - z) < a.r) return null;
  if (waterAt(d, x, z)) return null;
  const s = surfaceAt(d, x, z, near + 2);
  if (s.kind !== 'terrain' || Math.abs(s.y - near) > 1.2) return null;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const h = surfaceAt(d, x + Math.cos(a) * 0.8, z + Math.sin(a) * 0.8, s.y + 2);
    if (h.kind !== 'terrain' || Math.abs(h.y - s.y) > 0.25) return null;
  }
  if (nearestPropDist(d, x, z, s.y - 0.3, s.y + 2.2) < 1.9) return null; // room to walk round it; reads on its own
  if (g) {
    const c = cellIndex(g, x, z);
    if (c < 0 || !g.walk[c] || g.region[c] !== g.mainRegion) return null;
    if (openness(g, x, z, 1.5) < 0.85) return null;
  }
  return s.y;
}

const yawToward = (x: number, z: number, tx: number, tz: number) => Math.atan2(-(tx - x), -(tz - z));

/**
 * A readable stand spot beside a flag: on open, level lawn 3–6 m from the pole, as close as possible to the side that
 * faces the enemy base (attackers see it on the way in), clear of spawns, kiosks and kart pads.
 */
function standBeside(sim: Sim, g: NavGrid | null, flag: { x: number; y: number; z: number }, toward: { x: number; z: number }, avoid: readonly Avoid[]): BaseSpot['stand'] | null {
  const a0 = Math.atan2(toward.z - flag.z, toward.x - flag.x);
  let best: BaseSpot['stand'] | null = null, bestScore = Infinity;
  for (const r of [3.6, 4.2, 4.8, 5.4, 6.2]) {
    for (let i = 0; i < 32; i++) {
      const da = ((i + 1) >> 1) * (i % 2 ? 1 : -1) * ((2 * Math.PI) / 32); // 0, +, -, ++, -- … around the enemy side
      const a = a0 + da;
      const x = flag.x + Math.cos(a) * r, z = flag.z + Math.sin(a) * r;
      const y = standGround(sim, g, x, z, flag.y, avoid);
      if (y === null) continue;
      const score = Math.abs(da) * 2.2 + (r - 3.6) * 0.8;
      if (score < bestScore) { bestScore = score; best = { x, y, z, yaw: yawToward(x, z, toward.x, toward.z) }; }
    }
  }
  return best;
}

/** Open, level ground nearest (x, z) (the spawn-centroid fallback), within 14 m. */
function openNear(sim: Sim, g: NavGrid | null, x: number, z: number, near: number, avoid: readonly Avoid[]): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null, bestD = Infinity;
  for (let dz = -14; dz <= 14; dz += 1) for (let dx = -14; dx <= 14; dx += 1) {
    const d = Math.hypot(dx, dz);
    if (d > 14 || d >= bestD) continue;
    const y = standGround(sim, g, x + dx, z + dz, near, avoid);
    if (y === null) continue;
    bestD = d; best = { x: x + dx, y, z: z + dz };
  }
  return best;
}

/** The flag (capture ring) and ball stand of each base, deterministic per world. */
export function baseAssaultSpots(sim: Sim): [BaseSpot, BaseSpot] {
  const d = sim.worldData;
  const g = grid(sim);
  const out: BaseSpot[] = [];
  const cent = [spawnCentroid(sim, 0) ?? { x: 0, z: -20 }, spawnCentroid(sim, 1) ?? { x: 0, z: 20 }];
  const battle = battleOf(d);
  const flags: ({ x: number; y: number; z: number } | null)[] = [null, null];
  if (battle) {
    for (const t of [0, 1] as Side[]) {
      let pick: { x: number; z: number; w: number } | null = null;
      for (const bn of battle.banners) if (bn.team === t && bn.icon !== false && (!pick || bn.w > pick.w)) pick = bn;
      if (pick) flags[t] = { x: pick.x, y: d.height(pick.x, pick.z), z: pick.z };
    }
  }
  const avoid = standAvoid(sim);
  for (const t of [0, 1] as Side[]) {
    const def = d.bases?.find((b) => b.team === t);
    if (def) {
      const [fx, fy, fz] = def.flag, [sx, sy, sz] = def.ballStand;
      const sy2 = surfaceAt(d, sx, sz, sy + 1.5).y; // the given point, settled on whatever is under it (a crate top too)
      out.push({ team: t, flag: { x: fx, y: fy, z: fz }, stand: { x: sx, y: sy2, z: sz, yaw: yawToward(sx, sz, fx, fz) }, source: 'bases' });
      continue;
    }
    const enemy = flags[other(t)] ?? cent[other(t)];
    const f = flags[t];
    const stand = f ? standBeside(sim, g, f, enemy, avoid) : null;
    if (f && stand) { out.push({ team: t, flag: f, stand, source: 'battle' }); continue; }
    // fallback: the capture ring on open ground nearest the spawn centroid, the stand 4 m from it toward the enemy
    const c = cent[t];
    const cy = d.height(c.x, c.z);
    const noSpawnAvoid = avoid.filter((a) => a.r !== 2.6); // the ring may sit among the spawns; the stand may not
    const ring = openNear(sim, g, c.x, c.z, cy, noSpawnAvoid) ?? { x: c.x, y: cy, z: c.z };
    const st = standBeside(sim, g, ring, cent[other(t)], avoid)
      ?? { x: ring.x, y: ring.y, z: ring.z, yaw: yawToward(ring.x, ring.z, cent[other(t)].x, cent[other(t)].z) };
    out.push({ team: t, flag: ring, stand: st, source: 'spawns' });
  }
  return [out[0], out[1]];
}

// ------------------------------------------------------------------------------------------------ entities

function propEntity(sim: Sim, team: Side, seed: number, name: string, x: number, y: number, z: number, yaw: number): SimEntity {
  const id = sim.allocId();
  const e: SimEntity = {
    id, kind: EntityKind.Prop, team, species: 0, cls: null, seed, name,
    pos: { x, y, z }, vel: { x: 0, y: 0, z: 0 }, yaw, pitch: 0, collider: null,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0, char: null,
    health: { hp: 0, max: 0, lastDamageTick: -9999, lastAttacker: -1 },
    anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: 0, ammo: 0,
    ownerPid: null, removed: false, data: {},
  };
  sim.entities.set(id, e);
  return e;
}

/**
 * Create the balls, stands and capture rings for a new base-assault match (idempotent: an existing set is reset, never
 * duplicated). Call after the first physics step (the stand search reads the nav grid).
 */
export function setupBaseAssault(sim: Sim): BaseAssaultState {
  const have = baseAssaultState(sim);
  if (have && have.balls.every((b) => sim.entities.has(b.ball) && sim.entities.has(b.stand) && sim.entities.has(b.goal))) {
    resetBaseAssault(sim);
    return have;
  }
  const spots = baseAssaultSpots(sim);
  const balls = spots.map((s) => {
    const stand = propEntity(sim, s.team, BA_STAND_SEED, `ball stand ${s.team}`, s.stand.x, s.stand.y, s.stand.z, s.stand.yaw);
    const goal = propEntity(sim, s.team, BA_GOAL_SEED, `capture ring ${s.team}`, s.flag.x, s.flag.y, s.flag.z, 0);
    const ball = propEntity(sim, s.team, BA_BALL_SEED, `squeaky ball ${s.team}`, s.stand.x, s.stand.y + HOME_Y, s.stand.z, 0);
    const rt: BallRt = { team: s.team, ball: ball.id, stand: stand.id, goal: goal.id, state: BallState.Home, carrier: -1, returnTick: 0, lastX: 0, lastY: 0, lastZ: 0 };
    return rt;
  }) as [BallRt, BallRt];
  const st: BaseAssaultState = { spots, balls, bothAwayTick: -1, relief: false };
  sim.state.baseAssault = st;
  writeAll(sim, st, baseAssaultConfig(sim));
  return st;
}

/** Match restart (or match end): every ball back on its stand, no carriers, no relief. Silent (no events). */
export function resetBaseAssault(sim: Sim): void {
  const st = baseAssaultState(sim);
  if (!st) return;
  for (const b of st.balls) setHome(sim, b);
  st.bothAwayTick = -1;
  st.relief = false;
  for (const e of sim.entities.values()) if (e.flags & EFlag.Carrier) e.flags &= ~EFlag.Carrier; // belt and braces
  writeAll(sim, st, baseAssaultConfig(sim));
}

// ------------------------------------------------------------------------------------------------ transitions

function clearCarrier(sim: Sim, b: BallRt): void {
  const c = b.carrier >= 0 ? sim.entities.get(b.carrier) : undefined;
  if (c) c.flags &= ~EFlag.Carrier;
  b.carrier = -1;
}

function setHome(sim: Sim, b: BallRt): void {
  clearCarrier(sim, b);
  b.state = BallState.Home;
  b.returnTick = 0;
}

function setCarried(sim: Sim, b: BallRt, c: SimEntity): void {
  clearCarrier(sim, b);
  b.state = BallState.Carried;
  b.carrier = c.id;
  b.returnTick = 0;
  b.lastX = c.pos.x; b.lastY = c.pos.y; b.lastZ = c.pos.z;
  c.flags |= EFlag.Carrier;
}

/** Drop at (x, y, z) settled on the surface under it (water: floating on top). Off the map → home instead. */
function setDropped(sim: Sim, b: BallRt, x: number, y: number, z: number, cfg: BaseAssaultConfig): boolean {
  clearCarrier(sim, b);
  const spot = dropSpot(sim, x, y, z);
  if (!spot) { setHome(sim, b); return false; }
  b.state = BallState.Dropped;
  b.returnTick = sim.tick + ticks(cfg.returnTime);
  const e = sim.entities.get(b.ball)!;
  e.pos.x = spot.x; e.pos.y = spot.y; e.pos.z = spot.z;
  return true;
}

/** Where a ball dropped at a point comes to rest: the highest surface at or just below it (never a roof above), or the
 *  water surface over it. Null when the point is off the map (outside the bounds, below killY). */
export function dropSpot(sim: Sim, x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  const d = sim.worldData;
  const b = d.bounds;
  if (!Number.isFinite(x + y + z)) return null;
  if (b && (x < b.minX || x > b.maxX || z < b.minZ || z > b.maxZ)) return null;
  if (Math.abs(x) > d.halfExtent || Math.abs(z) > d.halfExtent) return null;
  if (y < d.killY + 2) return null;
  let ground = surfaceAt(d, x, z, y + 0.5).y;
  const w = waterAt(d, x, z);
  if (w && w.surfaceY > ground) ground = w.surfaceY - BA_BALL.radius + BA_BALL.float; // floats, mostly above the water
  if (ground < d.killY + 2) return null;
  return { x, y: ground + BA_BALL.radius, z };
}

// ------------------------------------------------------------------------------------------------ tick

function eligible(c: SimEntity): boolean {
  return !!c.char && !c.dead && !c.removed && (c.team === Team.Corgis || c.team === Team.Cats) && !(c.flags & EFlag.Mounted) && !c.combat?.pve;
}

/** Same-tick contest at the same distance: the defender (a return) beats an attacker, then the lower entity id wins
 *  (Map order is id order already; this keeps it explicit). */
function winsTie(c: SimEntity, best: SimEntity, ballTeam: Side): boolean {
  const cDef = c.team === ballTeam, bDef = best.team === ballTeam;
  return cDef !== bDef ? cDef : c.id < best.id;
}

/** Distance from a ball centre to a character's capsule surface (m). */
function touchDist(c: SimEntity, x: number, y: number, z: number): number {
  const cap = capsuleOf(c);
  return pointCapsuleDistance(x, y, z, c.pos.x, c.pos.y + cap.r, c.pos.z, cap.len, cap.r);
}

function emitScore(sim: Sim, team: Side, reason: string): void {
  sim.emit({ e: 'score', team, pts: 0, reason });
}

/**
 * Advance every ball one tick. `live`: the match is live (touches and captures only then; otherwise every ball is kept
 * home). Returns the captures for the match rules to score.
 */
export function stepBaseAssault(sim: Sim, live: boolean, cfg: BaseAssaultConfig = baseAssaultConfig(sim)): BaseAssaultTick {
  const res: BaseAssaultTick = { captures: [] };
  const st = baseAssaultState(sim);
  if (!st) return res;
  if (!live) {
    if (st.balls.some((b) => b.state !== BallState.Home) || st.relief) resetBaseAssault(sim);
    else writeAll(sim, st, cfg);
    return res;
  }
  // 1. carriers: still valid? (death, removal, teleport, seat, team)
  for (const b of st.balls) {
    if (b.state !== BallState.Carried) continue;
    const c = sim.entities.get(b.carrier);
    if (!c || c.removed || !c.char) {
      if (setDropped(sim, b, b.lastX, b.lastY + 0.2, b.lastZ, cfg)) emitScore(sim, b.team, BA_REASON.dropped);
      else emitScore(sim, b.team, BA_REASON.returned);
      continue;
    }
    const jumped = Math.hypot(c.pos.x - b.lastX, c.pos.y - b.lastY, c.pos.z - b.lastZ) > TELEPORT_STEP;
    if (c.team !== other(b.team) || jumped || c.pos.y < sim.worldData.killY + 2) {
      setHome(sim, b); // teleported (kill plane, out of bounds, a respawn) or no longer an enemy: straight home
      emitScore(sim, b.team, BA_REASON.returned);
      continue;
    }
    if (c.dead || (c.flags & EFlag.Mounted)) {
      if (setDropped(sim, b, c.pos.x, c.pos.y + 0.2, c.pos.z, cfg)) emitScore(sim, b.team, BA_REASON.dropped);
      else emitScore(sim, b.team, BA_REASON.returned);
      continue;
    }
    b.lastX = c.pos.x; b.lastY = c.pos.y; b.lastZ = c.pos.z;
  }
  // 2. dropped balls that waited long enough go home
  for (const b of st.balls) {
    if (b.state === BallState.Dropped && sim.tick >= b.returnTick) {
      setHome(sim, b);
      emitScore(sim, b.team, BA_REASON.returned);
    }
  }
  // 3. touches: an attacker takes a ball at home or on the ground; a defender sends a dropped ball home
  for (const b of st.balls) {
    if (b.state === BallState.Carried) continue;
    const e = sim.entities.get(b.ball)!;
    const bx = b.state === BallState.Home ? st.spots[b.team].stand.x : e.pos.x;
    const by = b.state === BallState.Home ? st.spots[b.team].stand.y + HOME_Y : e.pos.y;
    const bz = b.state === BallState.Home ? st.spots[b.team].stand.z : e.pos.z;
    let best: SimEntity | null = null, bestD = Infinity;
    for (const c of sim.entities.values()) {
      if (!eligible(c)) continue;
      const defender = c.team === b.team;
      if (defender && b.state === BallState.Home) continue;
      const dist = touchDist(c, bx, by, bz);
      if (dist > cfg.touchReach) continue;
      if (!best || dist < bestD - 1e-9 || (Math.abs(dist - bestD) <= 1e-9 && winsTie(c, best, b.team))) { best = c; bestD = dist; }
    }
    if (!best) continue;
    if (best.team === b.team) {
      setHome(sim, b);
      emitScore(sim, b.team, BA_REASON.returned);
      creditRoster(sim, best.id, ROSTER.return, 'return');
    } else {
      setCarried(sim, b, best);
      sim.emit({ e: 'pickup', id: best.id, item: BA_PICKUP_ITEM }); // first: a client learns whose steal it was
      emitScore(sim, other(b.team), BA_REASON.taken);
      creditRoster(sim, best.id, ROSTER.steal, 'steal');
    }
  }
  // 4. the stalemate relief: both balls away for `stalemateAfter` s
  const bothAway = st.balls[0].state !== BallState.Home && st.balls[1].state !== BallState.Home;
  if (!bothAway) { st.bothAwayTick = -1; st.relief = false; }
  else {
    if (st.bothAwayTick < 0) st.bothAwayTick = sim.tick;
    st.relief = sim.tick - st.bothAwayTick >= ticks(cfg.stalemateAfter);
  }
  // 5. captures: a carrier inside its own base's ring, with its own ball home (or the relief open)
  const r2 = cfg.captureRadius * cfg.captureRadius;
  for (const b of st.balls) {
    if (b.state !== BallState.Carried) continue;
    const c = sim.entities.get(b.carrier)!;
    const home = other(b.team);
    const ring = st.spots[home].flag;
    const dx = c.pos.x - ring.x, dz = c.pos.z - ring.z;
    if (dx * dx + dz * dz > r2 || Math.abs(c.pos.y - ring.y) > cfg.captureReach) continue;
    if (st.balls[home].state !== BallState.Home && !st.relief) continue;
    setHome(sim, b);
    res.captures.push(home);
    creditRoster(sim, c.id, ROSTER.capture, 'capture');
  }
  if (res.captures.length) {
    const away = st.balls[0].state !== BallState.Home && st.balls[1].state !== BallState.Home;
    if (!away) { st.bothAwayTick = -1; st.relief = false; }
  }
  writeAll(sim, st, cfg);
  return res;
}

// ------------------------------------------------------------------------------------------------ snapshot

function writeAll(sim: Sim, st: BaseAssaultState, cfg: BaseAssaultConfig): void {
  for (const b of st.balls) {
    const e = sim.entities.get(b.ball);
    if (!e) continue;
    const spot = st.spots[b.team];
    e.weapon = b.state;
    e.ammo = b.state === BallState.Carried ? b.carrier : 0;
    e.flags = b.state === BallState.Home ? 0 : EFlag.Busy;
    e.health!.max = cfg.returnTime;
    e.health!.hp = b.state === BallState.Dropped ? Math.max(0, (b.returnTick - sim.tick) / TICK_HZ) : 0;
    if (b.state === BallState.Home) {
      e.pos.x = spot.stand.x; e.pos.y = spot.stand.y + HOME_Y; e.pos.z = spot.stand.z;
      e.vel.x = 0; e.vel.y = 0; e.vel.z = 0;
    } else if (b.state === BallState.Carried) {
      const c = sim.entities.get(b.carrier);
      if (c) {
        e.pos.x = c.pos.x; e.pos.y = c.pos.y + BA_BALL.carryHeight; e.pos.z = c.pos.z;
        e.vel.x = c.vel.x; e.vel.y = c.vel.y; e.vel.z = c.vel.z;
      }
    } else { e.vel.x = 0; e.vel.y = 0; e.vel.z = 0; }
    const goal = sim.entities.get(b.goal);
    if (goal) {
      const own = st.balls[b.team];
      goal.flags = own.state !== BallState.Home && !st.relief ? EFlag.Busy : 0;
      goal.weapon = st.relief ? 1 : 0;
      goal.health!.max = cfg.stalemateAfter;
      goal.health!.hp = st.bothAwayTick >= 0 && !st.relief ? Math.max(0, (st.bothAwayTick + ticks(cfg.stalemateAfter) - sim.tick) / TICK_HZ) : 0;
    }
  }
}

/** Both balls, read-only (index = team). Empty when no base-assault match runs. */
export function baseAssaultBalls(sim: Sim): BallInfo[] {
  const st = baseAssaultState(sim);
  if (!st) return [];
  return st.balls.map((b) => {
    const e = sim.entities.get(b.ball);
    const s = st.spots[b.team];
    return {
      team: b.team, id: b.ball, state: b.state, carrier: b.carrier,
      x: e?.pos.x ?? s.stand.x, y: e?.pos.y ?? s.stand.y + HOME_Y, z: e?.pos.z ?? s.stand.z,
      returnIn: b.state === BallState.Dropped ? Math.max(0, (b.returnTick - sim.tick) / TICK_HZ) : 0,
      stand: { x: s.stand.x, y: s.stand.y, z: s.stand.z }, flag: { ...s.flag },
    };
  });
}

/**
 * The no-duplication / no-loss invariants, as a list of violations ([] = all good): exactly one ball entity per team,
 * each in exactly one state; a carried ball's carrier is a living, seated-nowhere enemy with EFlag.Carrier; nobody else
 * wears the flag; no character carries two balls; a dropped ball has a pending return; a home ball sits on its stand.
 */
export function checkBallInvariants(sim: Sim): string[] {
  const st = baseAssaultState(sim);
  if (!st) return [];
  const bad: string[] = [];
  const ballEnts = [...sim.entities.values()].filter((e) => e.kind === EntityKind.Prop && e.seed === BA_BALL_SEED);
  if (ballEnts.length !== 2) bad.push(`${ballEnts.length} ball entities`);
  for (const t of [0, 1]) if (ballEnts.filter((e) => e.team === t).length !== 1) bad.push(`team ${t} has ${ballEnts.filter((e) => e.team === t).length} balls`);
  const carriers = new Set<EntityId>();
  for (const b of st.balls) {
    const e = sim.entities.get(b.ball);
    if (!e) { bad.push(`ball ${b.team} entity missing`); continue; }
    if (e.weapon !== b.state) bad.push(`ball ${b.team} snapshot state ${e.weapon} != ${b.state}`);
    if (b.state === BallState.Carried) {
      const c = sim.entities.get(b.carrier);
      if (!c) bad.push(`ball ${b.team} carried by missing ${b.carrier}`);
      else {
        if (c.dead) bad.push(`ball ${b.team} carried by a dead ${c.id}`);
        if (c.team !== other(b.team)) bad.push(`ball ${b.team} carried by its own team`);
        if (!(c.flags & EFlag.Carrier)) bad.push(`carrier ${c.id} lacks EFlag.Carrier`);
        if (c.flags & EFlag.Mounted) bad.push(`carrier ${c.id} is seated`);
      }
      if (carriers.has(b.carrier)) bad.push(`${b.carrier} carries two balls`);
      carriers.add(b.carrier);
    } else if (b.carrier !== -1) bad.push(`ball ${b.team} not carried but has carrier ${b.carrier}`);
    if (b.state === BallState.Dropped && !(b.returnTick > sim.tick - 1)) bad.push(`dropped ball ${b.team} with no return pending`);
    if (b.state === BallState.Home) {
      const s = st.spots[b.team].stand;
      if (Math.hypot(e.pos.x - s.x, e.pos.z - s.z) > 1e-6) bad.push(`home ball ${b.team} off its stand`);
    }
  }
  for (const e of sim.entities.values()) if ((e.flags & EFlag.Carrier) && !carriers.has(e.id)) bad.push(`${e.id} wears EFlag.Carrier without a ball`);
  return bad;
}
