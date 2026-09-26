// B2a (ai-vehicles lane): a deterministic kart driver for bots. Given a seated bot's kart and a goal, it plans a route
// on a kart-sized view of the nav grid and produces the controls a human drives with (src/sim/vehicles/kart.ts:
// InputCmd.mz throttle/brake/reverse, mx steer, Jump handbrake, Sprint boost), so everything still goes through the
// one authority path. When to drive (boarding, rams, hopping out) is decided in tactics.ts (vehicleThink).
//
// Kart grid (per nav grid, rebuilt when its walkable count changes: X1 destructibles open and close cells in place):
//   a cell is drivable when it and its 8 neighbours are walkable for a pet (a kart is 0.72 m in radius, a pet 0.42),
//   it is dry, off jump pads, and has no ledge a kart can't take (a top-surface step > 0.26 m within 0.35 m: the kart
//   autosteps 0.3 m, a pet 0.45 m). Cells with an obstacle within 2 m cost 2× so routes keep to the open lawn.
//   Connected regions are labelled, so an unreachable goal is known without a search.
// Route: A* (8-neighbour, octile, weight 1.3, at most 12k expansions) + string-pulling over drivable cells.
// Driving:
//   - pure pursuit: a lookahead point 3–10 m down the route (longer with speed);
//   - steering: the yaw rate that closes the heading error in 0.3 s, divided by the kart's steering authority at this
//     speed (a kart can't turn standing still), mirrored when rolling backwards;
//   - speed: the slowest of the corner speeds within stopping distance (sharper turn → slower; planned at 12 m/s², the
//     kart brakes at 28), the stop at the goal, and a crawl for a turn-around; brake when 1 m/s over, else hold the
//     throttle at target/top;
//   - boost (Sprint) on straights: nothing sharper than 11° for 25 m ahead, meter above 50 % (the rest is kept for a
//     ram; a ram run boosts whenever lined up), goal > 30 m away;
//   - turn-around: a route behind the kart is taken at a crawl on full lock, or backing up on the opposite lock when
//     the nose is against something;
//   - stuck guard: under throttle with < 0.3 m of progress per 0.5 s window for 1.5 s → reverse out for 1 s with the
//     wheel swinging the nose toward the route (or drive out forward when backing up was what stalled), then
//     re-plan; the third one within 12 s gives up (the caller hops out and walks).
// Pure function of sim state (no Math.random, no wall clock): identical runs for the same seed.
//
// B2b: the RC plane is flown by flyPlane() at the end of this file (R1's planeAutopilot + strafing dives).
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { PropBox, PropCylinder, WorldData } from '../../shared/world/world-data';
import type { InputCmd } from '../../shared/input';
import { Btn } from '../../shared/input';
import { VEHICLES, type VehicleDef } from '../../shared/content/vehicles';
import { angleDelta } from '../../shared/math';
import { boxTopAt, surfaceAt, yawToward } from '../../shared/world/queries';
import { TICK_HZ } from '../../shared/constants';
import { kartForwardSpeed } from '../vehicles/kart';
import { planeAutopilot, type AutopilotGoal } from '../vehicles/pilot';
import { planeFlightBox } from '../vehicles/plane';
import { worldLineClear } from '../combat/geometry';
import { cellIndex, cellX, cellZ, type NavGrid } from './nav';

// ------------------------------------------------------------------------------------------------ tuning
/**
 * A prop's top-surface step (m) within LEDGE_PROBE m of a cell center that a kart can't take (its autostep is 0.3 m).
 * The probe reaches past the cell's half width, so an edge between two cells is seen from both.
 */
const LEDGE_STEP = 0.26;
const LEDGE_PROBE = 0.55;
/** Surfaces this far above the terrain count as something to drive on (higher ones are overhead or blocked). */
const TOP_REACH = 1.2;
const MAX_EXPANSIONS = 12000;
const HEURISTIC_WEIGHT = 1.3;
const HEAP_CAP = MAX_EXPANSIONS * 8 + 64;
/** Lookahead (m): LOOK_MIN + LOOK_K × speed, capped. */
const LOOK_MIN = 3, LOOK_K = 0.45, LOOK_MAX = 10;
/** Seconds to close a heading error (the steering law's time constant); a ram run's, on the direction of travel. */
const TURN_TAU = 0.3;
const RAM_TAU = 0.2;
/** Deceleration (m/s²) assumed when planning braking (the kart brakes at 28 m/s²; margin for grip and lag). */
const BRAKE_PLAN = 12;
/** Corner speed (m/s) by the heading change (rad) the route asks for: piecewise linear. */
const CORNER: readonly [number, number][] = [[0.2, 99], [0.5, 11], [1.0, 7.5], [1.6, 5.5], [3.2, 4.5]];
/** Boost meter a trip keeps in reserve (rams spend the rest). */
const BOOST_KEEP = 0.5;
/** Heading error (rad) beyond which the kart turns around at a crawl. */
const TURN_AROUND = 1.4;
const CRAWL = 5;
/** Stuck guard: progress window (s), minimum progress (m) per window, stall time before reversing (s). */
const STALL_WINDOW = 0.5, STALL_PROGRESS = 0.3, STALL_LIMIT = 1.5;
const REVERSE_TIME = 1.0;
/** Unstuck maneuvers within UNSTUCK_SPAN s before giving up. */
const UNSTUCK_GIVEUP = 3, UNSTUCK_SPAN = 12;
/** Off the route by this much (m) → re-plan. */
const OFF_ROUTE = 4;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

// ------------------------------------------------------------------------------------------------ kart grid

export interface KartNav {
  /** 1 = a kart can drive here. */
  ok: Uint8Array;
  /** Step cost multiplier: 1 in the open, 2 within 2 m of an obstacle. */
  cost: Uint8Array;
  /** Connected drivable region per cell (-1 = not drivable). */
  region: Int32Array;
  /** Nav grid walkable count this was built from (rebuilt when it changes). */
  walkable: number;
  cells: number;
  buildMs: number;
  // A* scratch (own stamps: never shared with nav.ts)
  g: Float32Array; parent: Int32Array; open: Uint32Array; closed: Uint32Array; heap: Int32Array; heapF: Float32Array; search: number;
}

/** Per-world (keyed by the grid's shared ground array): 1 = flat, dry, off pads, no kart-stopping ledge. */
const flats = new WeakMap<Float32Array, Uint8Array>();
const navs = new WeakMap<NavGrid, KartNav>();

function flatFor(g: NavGrid, data: WorldData): Uint8Array {
  let f = flats.get(g.ground);
  if (f) return f;
  const n = g.w * g.h;
  f = new Uint8Array(n);
  // props by cell (their bounding circle + the probe), so only cells near a prop are sampled
  const lists = new Map<number, (PropBox | PropCylinder)[]>();
  const M = LEDGE_PROBE + 0.75; // sample reach from a cell center
  const put = (x: number, z: number, ex: number, ez: number, y0: number, y1: number, p: PropBox | PropCylinder) => {
    // a prop entirely above anything a kart could drive onto, or sunk under the lawn, is never a ledge
    const gy = data.height(x, z);
    if (y0 > gy + TOP_REACH + 1 || y1 < gy - 0.5) return;
    const ix0 = Math.max(0, Math.floor((x - ex - M - g.ox) / g.cell)), ix1 = Math.min(g.w - 1, Math.floor((x + ex + M - g.ox) / g.cell));
    const iz0 = Math.max(0, Math.floor((z - ez - M - g.oz) / g.cell)), iz1 = Math.min(g.h - 1, Math.floor((z + ez + M - g.oz) / g.cell));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * g.w + ix;
      const l = lists.get(i);
      if (l) l.push(p); else lists.set(i, [p]);
    }
  };
  for (const b of data.props) {
    if (b.type === 'boundary') continue;
    // world AABB of the box rotated YXZ: half extent along axis i = Σ_j |R_ij| h_j (as nav.ts does)
    const cy = Math.cos(b.rotY), sy = Math.sin(b.rotY), cp = Math.cos(b.pitch ?? 0), sp = Math.sin(b.pitch ?? 0);
    const cr = Math.cos(b.roll ?? 0), sr = Math.sin(b.roll ?? 0);
    const ex = Math.abs(cy * cr + sy * sp * sr) * b.hx + Math.abs(-cy * sr + sy * sp * cr) * b.hy + Math.abs(sy * cp) * b.hz;
    const ey = Math.abs(cp * sr) * b.hx + Math.abs(cp * cr) * b.hy + Math.abs(sp) * b.hz;
    const ez = Math.abs(-sy * cr + cy * sp * sr) * b.hx + Math.abs(sy * sr + cy * sp * cr) * b.hy + Math.abs(cy * cp) * b.hz;
    put(b.x, b.z, ex, ez, b.y - ey, b.y + ey, b);
  }
  for (const c of data.cylinders ?? []) put(c.x, c.z, c.r, c.r, c.y - c.hh, c.y + c.hh, c);
  let onProp = false; // set by topAt: the top it returned is a prop's (not the lawn's)
  const topAt = (l: (PropBox | PropCylinder)[], x: number, z: number, reach: number): number => {
    let t = data.height(x, z);
    onProp = false;
    for (const p of l) {
      const y = 'hx' in p ? boxTop(p, x, z) : Math.hypot(x - p.x, z - p.z) <= p.r ? p.y + p.hh : -Infinity;
      if (y > t + 0.02 && y <= reach) { t = y; onProp = true; }
    }
    return t;
  };
  const P = LEDGE_PROBE;
  for (let iz = 1; iz < g.h - 1; iz++) {
    for (let ix = 1; ix < g.w - 1; ix++) {
      const i = iz * g.w + ix;
      if (g.cost[i] !== 1 || !g.walk[i]) continue; // water / jump pad / blocked
      const l = lists.get(i);
      if (!l) { f[i] = 1; continue; }
      // a prop near this cell: a ledge (a top-surface step) within the probe distance of the center?
      const x = cellX(g, i), z = cellZ(g, i), reach = g.ground[i] + TOP_REACH;
      const c = topAt(l, x, z, reach), cProp = onProp;
      let flat = 1;
      for (let k = 0; k < 4 && flat; k++) {
        const t = topAt(l, x + (k === 0 ? P : k === 1 ? -P : 0), z + (k === 2 ? P : k === 3 ? -P : 0), reach);
        if ((onProp || cProp) && Math.abs(t - c) > LEDGE_STEP) flat = 0; // lawn to lawn is a slope, never a ledge
      }
      f[i] = flat;
    }
  }
  flats.set(g.ground, f);
  return f;
}

/** Top of a box on the vertical line through (x, z) (-Infinity = misses it); yaw-only boxes without allocations. */
function boxTop(b: PropBox, x: number, z: number): number {
  if (b.pitch || b.roll) return boxTopAt(b, x, z);
  const c = Math.cos(b.rotY), sn = Math.sin(b.rotY);
  const dx = x - b.x, dz = z - b.z;
  const lx = dx * c - dz * sn, lz = dx * sn + dz * c;
  return Math.abs(lx) <= b.hx && Math.abs(lz) <= b.hz ? b.y + b.hy : -Infinity;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];
const MAX_STEP = 0.6;

/** Drivable neighbour k of cell i, or -1 (bounds, not drivable, too steep, diagonal corner cut). */
function kartNeighbour(g: NavGrid, ok: Uint8Array, i: number, k: number): number {
  const ix = i % g.w, iz = (i / g.w) | 0;
  const nx = ix + DX[k], nz = iz + DZ[k];
  if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) return -1;
  const j = nz * g.w + nx;
  if (!ok[j] || Math.abs(g.ground[j] - g.ground[i]) > MAX_STEP) return -1;
  if (k >= 4 && (!ok[iz * g.w + nx] || !ok[nz * g.w + ix])) return -1;
  return j;
}

function buildKartNav(g: NavGrid, data: WorldData, prev: KartNav | undefined): KartNav {
  const t0 = performance.now();
  const n = g.w * g.h;
  const flat = flatFor(g, data);
  const walk = g.walk;
  const ok = prev?.ok.length === n ? prev.ok.fill(0) : new Uint8Array(n);
  let cells = 0;
  for (let iz = 1; iz < g.h - 1; iz++) {
    for (let ix = 1; ix < g.w - 1; ix++) {
      const i = iz * g.w + ix;
      if (!walk[i] || !flat[i] || !flat[i - 1] || !flat[i + 1] || !flat[i - g.w] || !flat[i + g.w]) continue;
      if (!walk[i - 1] || !walk[i + 1] || !walk[i - g.w] || !walk[i + g.w]) continue;
      if (!walk[i - g.w - 1] || !walk[i - g.w + 1] || !walk[i + g.w - 1] || !walk[i + g.w + 1]) continue;
      ok[i] = 1;
      cells++;
    }
  }
  // soft clearance: cells with a non-drivable cell within 2 cells (a 5×5 box, separable) cost double
  const cost = prev?.cost.length === n ? prev.cost : new Uint8Array(n);
  const row = new Uint8Array(n); // 1 = a non-drivable cell within 2 cells along the row
  for (let iz = 0; iz < g.h; iz++) {
    for (let ix = 0; ix < g.w; ix++) {
      let b = 0;
      for (let dx = -2; dx <= 2 && !b; dx++) { const x = ix + dx; if (x < 0 || x >= g.w || !ok[iz * g.w + x]) b = 1; }
      row[iz * g.w + ix] = b;
    }
  }
  for (let iz = 0; iz < g.h; iz++) {
    for (let ix = 0; ix < g.w; ix++) {
      const i = iz * g.w + ix;
      if (!ok[i]) { cost[i] = 0; continue; }
      let c = 1;
      for (let dz = -2; dz <= 2; dz++) { const z = iz + dz; if (z < 0 || z >= g.h || row[z * g.w + ix]) { c = 2; break; } }
      cost[i] = c;
    }
  }
  const region = prev?.region.length === n ? prev.region.fill(-1) : new Int32Array(n).fill(-1);
  const queue = new Int32Array(n);
  let id = 0;
  for (let s = 0; s < n; s++) {
    if (!ok[s] || region[s] >= 0) continue;
    let head = 0, tail = 0;
    queue[tail++] = s; region[s] = id;
    while (head < tail) {
      const i = queue[head++];
      for (let k = 0; k < 8; k++) {
        const j = kartNeighbour(g, ok, i, k);
        if (j < 0 || region[j] >= 0) continue;
        region[j] = id; queue[tail++] = j;
      }
    }
    id++;
  }
  const nav: KartNav = prev && prev.g.length === n ? prev : {
    ok, cost, region, walkable: 0, cells: 0, buildMs: 0,
    g: new Float32Array(n), parent: new Int32Array(n), open: new Uint32Array(n), closed: new Uint32Array(n),
    heap: new Int32Array(HEAP_CAP), heapF: new Float32Array(HEAP_CAP), search: 0,
  };
  nav.ok = ok; nav.cost = cost; nav.region = region;
  nav.walkable = g.walkable;
  nav.cells = cells;
  nav.buildMs = performance.now() - t0;
  return nav;
}

/** The kart grid of a nav grid (built on first use; rebuilt when the grid's walkable cells changed). */
export function kartNavFor(g: NavGrid, data: WorldData): KartNav {
  let nav = navs.get(g);
  if (!nav || nav.walkable !== g.walkable) {
    nav = buildKartNav(g, data, nav);
    navs.set(g, nav);
  }
  return nav;
}

/** Closest drivable cell to (x, z) within maxR cells (optionally in a given region), or -1. */
export function nearestDrivable(g: NavGrid, nav: KartNav, x: number, z: number, maxR: number, region = -1): number {
  const c = cellIndex(g, clamp(x, g.ox, g.ox + g.w * g.cell - 0.01), clamp(z, g.oz, g.oz + g.h * g.cell - 0.01));
  if (c < 0) return -1;
  if (nav.ok[c] && (region < 0 || nav.region[c] === region)) return c;
  const cx = c % g.w, cz = (c / g.w) | 0;
  let best = -1, bestD = Infinity;
  for (let r = 1; r <= maxR && best < 0; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue;
        const j = nz * g.w + nx;
        if (!nav.ok[j] || (region >= 0 && nav.region[j] !== region)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
    }
  }
  return best;
}

/** Can a kart drive the straight segment (every sampled cell drivable, no steep step)? */
export function driveLineClear(g: NavGrid, nav: KartNav, ax: number, az: number, bx: number, bz: number): boolean {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.35));
  let prev = cellIndex(g, ax, az);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const i = cellIndex(g, ax + dx * t, az + dz * t);
    if (i < 0 || !nav.ok[i]) return false;
    if (prev >= 0 && i !== prev && Math.abs(g.ground[i] - g.ground[prev]) > MAX_STEP) return false;
    prev = i;
  }
  return true;
}

function heapPush(nav: KartNav, size: number, node: number, f: number): number {
  let i = size;
  nav.heap[i] = node; nav.heapF[i] = f;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (nav.heapF[p] <= nav.heapF[i]) break;
    const tn = nav.heap[p], tf = nav.heapF[p];
    nav.heap[p] = nav.heap[i]; nav.heapF[p] = nav.heapF[i];
    nav.heap[i] = tn; nav.heapF[i] = tf;
    i = p;
  }
  return size + 1;
}

function heapPop(nav: KartNav, size: number): number {
  const last = size - 1;
  nav.heap[0] = nav.heap[last]; nav.heapF[0] = nav.heapF[last];
  let i = 0;
  for (;;) {
    const l = i * 2 + 1, r = l + 1;
    let m = i;
    if (l < last && nav.heapF[l] < nav.heapF[m]) m = l;
    if (r < last && nav.heapF[r] < nav.heapF[m]) m = r;
    if (m === i) break;
    const tn = nav.heap[m], tf = nav.heapF[m];
    nav.heap[m] = nav.heap[i]; nav.heapF[m] = nav.heapF[i];
    nav.heap[i] = tn; nav.heapF[i] = tf;
    i = m;
  }
  return last;
}

function octile(g: NavGrid, a: number, b: number): number {
  const dx = Math.abs((a % g.w) - (b % g.w)), dz = Math.abs(((a / g.w) | 0) - ((b / g.w) | 0));
  return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
}

/** Kart route searches run so far (tests, perf). */
export const driveStats = { searches: 0, expansions: 0, hookCalls: 0 };

const chain: number[] = [];

/**
 * A kart route from (sx, sz) to (gx, gz): smoothed waypoints [x0, z0, x1, z1, ...] in `out` (the last one is the goal,
 * or the drivable cell closest to it in the start's region). False when there is no drivable cell near the start or
 * none near the goal in the same region (then `out` is empty).
 */
export function findDrivePath(g: NavGrid, nav: KartNav, sx: number, sz: number, gx: number, gz: number, out: number[], goalR = 10): boolean {
  out.length = 0;
  const s = nearestDrivable(g, nav, sx, sz, 4);
  if (s < 0) return false;
  const goal = nearestDrivable(g, nav, gx, gz, goalR, nav.region[s]);
  if (goal < 0) return false;
  driveStats.searches++;
  const exact = nav.ok[cellIndex(g, gx, gz)] === 1 && nav.region[cellIndex(g, gx, gz)] === nav.region[s];
  if (s === goal) { out.push(exact ? gx : cellX(g, goal), exact ? gz : cellZ(g, goal)); return true; }
  const id = ++nav.search;
  let size = heapPush(nav, 0, s, 0);
  nav.g[s] = 0; nav.parent[s] = -1; nav.open[s] = id;
  let reached = -1, closest = s, closestH = octile(g, s, goal), exp = 0;
  while (size > 0) {
    const cur = nav.heap[0];
    size = heapPop(nav, size);
    if (nav.closed[cur] === id) continue;
    nav.closed[cur] = id;
    if (cur === goal) { reached = cur; break; }
    if (++exp > MAX_EXPANSIONS) break;
    const hc = octile(g, cur, goal);
    if (hc < closestH) { closestH = hc; closest = cur; }
    for (let k = 0; k < 8; k++) {
      const j = kartNeighbour(g, nav.ok, cur, k);
      if (j < 0 || nav.closed[j] === id) continue;
      const ng = nav.g[cur] + COST[k] * nav.cost[j];
      if (nav.open[j] === id && ng >= nav.g[j]) continue;
      nav.g[j] = ng; nav.parent[j] = cur; nav.open[j] = id;
      size = heapPush(nav, size, j, ng + HEURISTIC_WEIGHT * octile(g, j, goal));
    }
  }
  driveStats.expansions += exp;
  const end = reached >= 0 ? reached : closest;
  chain.length = 0;
  for (let c = end; c >= 0; c = nav.parent[c]) { chain.push(c); if (c === s) break; }
  chain.reverse();
  // string-pull: keep only the corners a straight drive can't skip
  let ax = sx, az = sz;
  for (let i = 1; i < chain.length; i++) {
    const nx = cellX(g, chain[i]), nz = cellZ(g, chain[i]);
    if (!driveLineClear(g, nav, ax, az, nx, nz)) {
      const px = cellX(g, chain[i - 1]), pz = cellZ(g, chain[i - 1]);
      out.push(px, pz);
      ax = px; az = pz;
    }
  }
  if (reached >= 0 && exact && driveLineClear(g, nav, ax, az, gx, gz)) out.push(gx, gz);
  else out.push(cellX(g, end), cellZ(g, end));
  return true;
}

// ------------------------------------------------------------------------------------------------ driver

export interface KartControls {
  /** -1 (brake / reverse) … +1 (full throttle): InputCmd.mz. */
  throttle: number;
  /** -1 (left) … +1 (right): InputCmd.mx. */
  steer: number;
  /** Sprint. */
  boost: boolean;
  /** Jump. */
  handbrake: boolean;
}

export interface DriveGoal {
  x: number; z: number;
  /** Arrival radius (m): 'arrived' inside it. */
  r: number;
  /** Brake to a halt inside the radius (a hop-out or a parking spot); else roll through at speed. */
  stop: boolean;
  /** Direct pursuit (a ram): straight at the point when the line is drivable, flat out, no braking at the end. */
  ram?: boolean;
}

export type DriveStatus = 'driving' | 'arrived' | 'giveup' | 'noroute';

export interface DriverState {
  /** The route and the goal it was planned for. */
  path: number[];
  pathIdx: number;
  pathGX: number; pathGZ: number;
  /** A route exists for the current goal (false until planned, or when there is none). */
  planned: boolean;
  noRoute: boolean;
  /** Tick of the last plan (re-plans are spaced). */
  planTick: number;
  /** Stuck guard: progress window start (tick, position), seconds stalled, the maneuver in progress. */
  winTick: number; winX: number; winZ: number;
  stall: number;
  /** While sim.tick < maneuverUntil: throttle maneuverThrottle, steer maneuverSteer (a reverse-out). */
  maneuverUntil: number;
  maneuverThrottle: number;
  maneuverSteer: number;
  /** Ticks of recent unstuck maneuvers. */
  unstuck: number[];
  /** Last commanded throttle (the stall check only counts ticks under power). */
  lastThrottle: number;
  /** The current plan is a ram's straight run (not a route). */
  ramPlan: boolean;
  /** Telemetry: seconds driven, reverse-outs, re-plans. */
  driven: number;
  reverses: number;
  plans: number;
}

export function createDriver(): DriverState {
  return {
    path: [], pathIdx: 0, pathGX: 0, pathGZ: 0, planned: false, noRoute: false, planTick: -9999,
    winTick: 0, winX: 0, winZ: 0, stall: 0, maneuverUntil: 0, maneuverThrottle: 0, maneuverSteer: 0, unstuck: [],
    lastThrottle: 0, ramPlan: false, driven: 0, reverses: 0, plans: 0,
  };
}

/** Forget the route and the stuck bookkeeping (a new kart or a new trip). Telemetry is kept. */
export function resetDriver(d: DriverState, sim: Sim, kart: SimEntity | null): void {
  d.path.length = 0; d.pathIdx = 0; d.planned = false; d.noRoute = false; d.planTick = -9999;
  d.stall = 0; d.maneuverUntil = 0; d.unstuck.length = 0; d.lastThrottle = 0; d.ramPlan = false;
  d.winTick = sim.tick; d.winX = kart?.pos.x ?? 0; d.winZ = kart?.pos.z ?? 0;
}

/** Corner speed for a heading change of `turn` rad (piecewise linear over CORNER). */
function cornerSpeed(turn: number, top: number): number {
  if (turn <= CORNER[0][0]) return top;
  for (let i = 1; i < CORNER.length; i++) {
    const [a1, v1] = CORNER[i];
    if (turn <= a1) {
      const [a0, v0] = CORNER[i - 1];
      const lo = Math.min(v0, top);
      return lo + (Math.min(v1, top) - lo) * ((turn - a0) / (a1 - a0));
    }
  }
  return Math.min(CORNER[CORNER.length - 1][1], top);
}

/** Kart steering authority at forward speed |v| (mirrors stepKart's steering). */
function steerAuthority(d: VehicleDef, v: number): number {
  const spd = Math.abs(v);
  let auth = clamp(spd / d.steerFullSpeed, 0, 1);
  auth *= 1 - d.understeer * clamp((spd - d.topSpeed * 0.6) / (d.boostSpeed - d.topSpeed * 0.6), 0, 1);
  return auth;
}

/**
 * Steer (InputCmd.mx) that turns the heading by `err` rad (+ = left, yaw increasing) in about `tau` s at forward
 * speed v: the wanted yaw rate over the kart's authority (reverses when rolling backwards).
 */
function steerFor(d: VehicleDef, err: number, v: number, tau = TURN_TAU): number {
  const w = clamp(err / tau, -d.maxYawRate, d.maxYawRate);
  let turn = w / (d.maxYawRate * Math.max(0.15, steerAuthority(d, v)));
  if (v < -0.3) turn = -turn;
  return clamp(-turn, -1, 1);
}

/** Is the cell `dist` m ahead of the kart (along its heading) drivable? */
function openAhead(g: NavGrid, nav: KartNav, kart: SimEntity, dist: number): boolean {
  const x = kart.pos.x - Math.sin(kart.yaw) * dist, z = kart.pos.z - Math.cos(kart.yaw) * dist;
  const i = cellIndex(g, x, z);
  return i >= 0 && nav.ok[i] === 1;
}

const look = { x: 0, z: 0 };

/** The point `ahead` m down the route from the kart's projection on its current leg (writes `look`). */
function lookahead(d: DriverState, px: number, pz: number, ahead: number): void {
  const p = d.path;
  const n = p.length >> 1;
  let ax = px, az = pz, left = ahead;
  for (let k = d.pathIdx; k < n; k++) {
    const bx = p[k * 2], bz = p[k * 2 + 1];
    const seg = Math.hypot(bx - ax, bz - az);
    if (seg >= left) {
      const t = seg > 1e-6 ? left / seg : 0;
      look.x = ax + (bx - ax) * t; look.z = az + (bz - az) * t;
      return;
    }
    left -= seg; ax = bx; az = bz;
  }
  look.x = ax; look.z = az;
}

/** Distance from (px, pz) to the leg ending at waypoint k (from waypoint k-1, or from the route start). */
function legDistance(d: DriverState, k: number, px: number, pz: number, sx: number, sz: number): number {
  const p = d.path;
  const ax = k > 0 ? p[(k - 1) * 2] : sx, az = k > 0 ? p[(k - 1) * 2 + 1] : sz;
  const bx = p[k * 2], bz = p[k * 2 + 1];
  const vx = bx - ax, vz = bz - az;
  const l2 = vx * vx + vz * vz;
  const t = l2 > 1e-9 ? clamp(((px - ax) * vx + (pz - az) * vz) / l2, 0, 1) : 0;
  return Math.hypot(px - (ax + vx * t), pz - (az + vz * t));
}

function plan(sim: Sim, d: DriverState, g: NavGrid, nav: KartNav, kart: SimEntity, goal: DriveGoal, budget: { pathBudget: number }): void {
  if (goal.ram) {
    // a ram is a straight run: no route search (it re-plans every 0.1 s as the target moves); a blocked line ends it
    const clear = driveLineClear(g, nav, kart.pos.x, kart.pos.z, goal.x, goal.z);
    d.path.length = 0;
    if (clear) d.path.push(goal.x, goal.z);
    d.pathIdx = 0; d.pathGX = goal.x; d.pathGZ = goal.z; d.planned = clear; d.noRoute = !clear; d.planTick = sim.tick;
    return;
  }
  if (budget.pathBudget <= 0) return; // next tick
  budget.pathBudget--;
  d.plans++;
  d.planTick = sim.tick;
  d.pathGX = goal.x; d.pathGZ = goal.z; d.pathIdx = 0;
  d.planned = findDrivePath(g, nav, kart.pos.x, kart.pos.z, goal.x, goal.z, d.path, goal.ram ? 3 : 10);
  d.noRoute = !d.planned;
}

/**
 * One tick of driving `kart` toward `goal`: writes the controls into `out` and returns the status ('arrived' inside
 * goal.r — braking when goal.stop —, 'giveup' after repeated stuck maneuvers, 'noroute' when no drivable route exists).
 * `budget.pathBudget` is decremented when a route search runs (none runs at 0; the kart then coasts toward the old one).
 */
export function driveKart(sim: Sim, kart: SimEntity, d: DriverState, goal: DriveGoal, g: NavGrid, budget: { pathBudget: number }, out: KartControls): DriveStatus {
  out.throttle = 0; out.steer = 0; out.boost = false; out.handbrake = false;
  const k = kart.kart;
  if (!k) return 'giveup';
  const def = VEHICLES[k.id];
  const nav = kartNavFor(g, sim.worldData);
  const dt = 1 / TICK_HZ;
  const v = kartForwardSpeed(kart);
  const px = kart.pos.x, pz = kart.pos.z;
  const distGoal = Math.hypot(goal.x - px, goal.z - pz);
  d.driven += dt;

  // --- arrived: brake to a halt (or roll on)
  if (distGoal <= goal.r && !goal.ram) {
    if (goal.stop) out.throttle = v > 1.2 ? -1 : v < -1.2 ? 1 : 0;
    d.stall = 0; d.winTick = sim.tick; d.winX = px; d.winZ = pz;
    d.lastThrottle = out.throttle;
    return 'arrived';
  }

  // --- route (re-plan when the goal moved, the kart left the route, or none yet)
  const moved = Math.hypot(goal.x - d.pathGX, goal.z - d.pathGZ) > (goal.ram ? 1.5 : 3);
  const spaced = sim.tick - d.planTick >= (goal.ram ? 6 : 30);
  const switched = !!goal.ram !== d.ramPlan; // a ram run began or ended: plan for the new goal now
  if (switched) { d.ramPlan = !!goal.ram; d.noRoute = false; d.planned = false; }
  if ((!d.planned && !d.noRoute) || (moved && spaced)) plan(sim, d, g, nav, kart, goal, budget);
  else if (d.planned && spaced && d.path.length && d.pathIdx < d.path.length >> 1
    && legDistance(d, d.pathIdx, px, pz, d.pathGX, d.pathGZ) > OFF_ROUTE) plan(sim, d, g, nav, kart, goal, budget);
  if (d.noRoute) {
    if (sim.tick - d.planTick > 90) { d.noRoute = false; d.planned = false; } // try again later
    out.throttle = v > 1.2 ? -1 : 0;
    return 'noroute';
  }
  if (!d.planned || !d.path.length) {
    // waiting for a search this tick: roll gently toward the goal
    out.throttle = clamp(CRAWL / def.topSpeed, 0, 1);
    out.steer = steerFor(def, angleDelta(kart.yaw, yawToward(px, pz, goal.x, goal.z)), v);
    d.lastThrottle = out.throttle;
    return 'driving';
  }

  // --- advance along the route: a waypoint within reach, or one whose next leg is already clear, is done
  const n = d.path.length >> 1;
  while (d.pathIdx < n - 1) {
    const wx = d.path[d.pathIdx * 2], wz = d.path[d.pathIdx * 2 + 1];
    const reach = 1.5 + Math.abs(v) * 0.15;
    if (Math.hypot(wx - px, wz - pz) < reach) { d.pathIdx++; continue; }
    const nx = d.path[(d.pathIdx + 1) * 2], nz = d.path[(d.pathIdx + 1) * 2 + 1];
    if (Math.hypot(wx - px, wz - pz) < 6 && driveLineClear(g, nav, px, pz, nx, nz)) { d.pathIdx++; continue; }
    break;
  }

  // --- pure pursuit
  const L = clamp(LOOK_MIN + LOOK_K * Math.abs(v), LOOK_MIN, LOOK_MAX);
  lookahead(d, px, pz, L);
  const tx = look.x, tz = look.z;
  const want = yawToward(px, pz, tx, tz);
  let err = angleDelta(kart.yaw, want);
  // a ram steers the direction of travel (it lags the nose by the grip slip) onto the intercept, and tighter
  const sp = Math.hypot(kart.vel.x, kart.vel.z);
  const ramSteer = !!goal.ram && sp > 3 && v > 0 && Math.abs(err) < 1.2;
  if (ramSteer) err = angleDelta(Math.atan2(-kart.vel.x, -kart.vel.z), want);

  // --- speed plan: corners within stopping distance, the stop at the goal
  const fast = k.boosting || k.turbo > 0;
  const top = fast ? def.boostSpeed : def.topSpeed;
  let vT = top;
  let straight = Infinity; // distance (m) the route runs within 0.2 rad of the heading
  {
    const horizon = (v * v) / (2 * BRAKE_PLAN) + 8;
    let ax = px, az = pz, s = 0;
    for (let i = d.pathIdx; i < n && s < Math.max(horizon, 25); i++) {
      const bx = d.path[i * 2], bz = d.path[i * 2 + 1];
      const seg = Math.hypot(bx - ax, bz - az);
      if (seg > 0.5) {
        const turn = Math.abs(angleDelta(kart.yaw, yawToward(ax, az, bx, bz)));
        if (turn > 0.2 && straight === Infinity) straight = s;
        if (s < horizon) {
          const vc = cornerSpeed(turn, top);
          vT = Math.min(vT, Math.sqrt(vc * vc + 2 * BRAKE_PLAN * Math.max(0, s - 1.5)));
        }
      }
      s += seg; ax = bx; az = bz;
    }
    vT = Math.min(vT, cornerSpeed(goal.ram ? Math.max(0, Math.abs(err) - 0.4) : Math.abs(err), top)); // a ram keeps its speed through small corrections
    if (goal.stop && !goal.ram) {
      // along-route distance to the goal (approximated by the straight distance, never shorter)
      const rest = Math.max(0, distGoal - goal.r * 0.6);
      vT = Math.min(vT, Math.sqrt(16 + 2 * BRAKE_PLAN * rest));
    }
  }

  let throttle: number, steer: number;
  const now = sim.tick;
  if (now < d.maneuverUntil) {
    // unstuck maneuver in progress
    throttle = d.maneuverThrottle;
    steer = d.maneuverSteer;
  } else if (Math.abs(err) > TURN_AROUND) {
    // the route is behind: crawl round on full lock, or back up on the opposite lock when the nose is against something
    if (!openAhead(g, nav, kart, 2.2) && v < 2) {
      throttle = -0.8;
      steer = err > 0 ? 1 : -1;
    } else {
      throttle = v > CRAWL + 1 ? -1 : clamp(CRAWL / def.topSpeed, 0, 1);
      steer = err > 0 ? -1 : 1;
      if (v < -0.3) steer = -steer;
    }
  } else {
    steer = steerFor(def, err, v, ramSteer ? RAM_TAU : TURN_TAU);
    if (v > vT + 1 && v > 2) throttle = -clamp(0.35 + (v - vT) / 6, 0.5, 1);
    else throttle = goal.ram ? 1 : clamp(vT / def.topSpeed, 0.15, 1);
    // boost on a straight: nothing sharper than ~11° for 25 m, some meter left, not about to stop
    // (a trip keeps half the meter for a ram; a ram run spends it all)
    if (throttle > 0.9 && Math.abs(err) < 0.2 && v > 6 && (goal.ram ? k.boost > 0.02 : k.boost > BOOST_KEEP && straight > 25 && (!goal.stop || distGoal > 30))) out.boost = true;
  }

  // --- stuck guard (progress toward the lookahead point, per window, while under power)
  if (now >= d.maneuverUntil) {
    if (now - d.winTick >= STALL_WINDOW * TICK_HZ) {
      const hx = tx - d.winX, hz = tz - d.winZ, hl = Math.hypot(hx, hz) || 1;
      const prog = ((px - d.winX) * hx + (pz - d.winZ) * hz) / hl;
      const moveAbs = Math.hypot(px - d.winX, pz - d.winZ);
      const powered = Math.abs(d.lastThrottle) > 0.25;
      // backing up to turn around moves away on purpose: count movement then, progress otherwise
      const ok = Math.abs(err) > TURN_AROUND ? moveAbs >= STALL_PROGRESS : prog >= STALL_PROGRESS;
      if (powered && !ok) d.stall += (now - d.winTick) / TICK_HZ; else d.stall = 0;
      d.winTick = now; d.winX = px; d.winZ = pz;
    }
    if (d.stall >= STALL_LIMIT) {
      d.stall = 0;
      d.reverses++;
      for (let i = d.unstuck.length - 1; i >= 0; i--) if (now - d.unstuck[i] > UNSTUCK_SPAN * TICK_HZ) d.unstuck.splice(i, 1);
      d.unstuck.push(now);
      if (d.unstuck.length >= UNSTUCK_GIVEUP) { d.lastThrottle = 0; return 'giveup'; }
      // back out (or drive out, when backing up is what stalled), the wheel swinging the nose toward the route
      d.maneuverThrottle = d.lastThrottle < 0 ? 1 : -1;
      d.maneuverSteer = d.maneuverThrottle < 0 ? (err > 0 ? 1 : -1) : (err > 0 ? -1 : 1);
      d.maneuverUntil = now + Math.round(REVERSE_TIME * TICK_HZ);
      d.planned = false; // re-plan from wherever it ends up
      throttle = d.maneuverThrottle; steer = d.maneuverSteer;
      out.boost = false;
    }
  } else {
    d.winTick = now; d.winX = px; d.winZ = pz;
  }

  out.throttle = throttle;
  out.steer = steer;
  d.lastThrottle = throttle;
  return 'driving';
}

/** Write kart controls into an InputCmd (a seated character's controls; the aim is left to the caller). */
export function controlsToInput(c: KartControls, out: InputCmd): InputCmd {
  out.mz = clamp(c.throttle, -1, 1);
  out.mx = clamp(c.steer, -1, 1);
  out.buttons = (c.boost ? Btn.Sprint : 0) | (c.handbrake ? Btn.Jump : 0);
  return out;
}

// ------------------------------------------------------------------------------------------------ flight (B2b)
// The RC plane is flown through R1's planeAutopilot (take-off along the runway heading, cruise with clearance over
// whatever lies ahead, flyover or glide-slope landing): the same InputCmd a human pilot sends (mz throttle, the aim
// yaw/pitch the plane chases). A strafing run adds a dive: inside 14–60 m of the target and under 43° down, the aim goes
// on the target (the plane chases it; the gun's 8° gimbal does the rest) and Fire is held while the nose is within the
// gimbal of it and in range (no dive without 32 m of low ground past the target to pull out over); it pulls out at 5.5 m over the ground, 8 m from the target, when the target slips behind or
// out of sight, and extends 50 m before coming round again; a plane that arrives over its target too close to dive heads
// out 45 m first for a run-in.

/** Height (m) a strafing plane cruises at over its target; the dive window; the pull-out floor and extension. */
const STRIKE_AGL = 14, DIVE_MAX = 60, DIVE_MIN = 14, DIVE_ANGLE = 0.75, PULL_AGL = 5.5, PULL_TIME = 2.2, EXTEND_M = 50, RUN_IN = 45;

export interface FlightGoal {
  x: number; y: number; z: number;
  /** flyover: arrive over (x, z) at height y · land: touch down at (x, y, z) · strafe: dive on `target` and shoot. */
  mode: 'flyover' | 'land' | 'strafe';
  target?: SimEntity | null;
  /** land: the heading to arrive on. */
  landYaw?: number;
  /** flyover: arrival radius (m, horizontal). */
  r?: number;
}

export type FlightStatus = 'flying' | 'arrived' | 'landed';

export interface FlightState {
  phase: 'cruise' | 'dive' | 'pullout';
  /** Pull-out: until this tick, toward (px, pz). */
  until: number;
  px: number; pz: number;
  /** Ticks the gun was held on target; dives flown; why the last dive ended. */
  firing: number;
  dives: number;
  why: string;
}

/**
 * Room to pull out: nothing taller than the target's feet + 4 m within DIVE_RUNOUT m past it along the dive (a pet on
 * the deck in front of the house wall is not dived on from the yard: the pull-out would meet the wall).
 */
function runOutClear(sim: Sim, t: SimEntity, ux: number, uz: number): boolean {
  for (let s = 4; s <= DIVE_RUNOUT; s += 4) {
    if (surfaceAt(sim.worldData, t.pos.x + ux * s, t.pos.z + uz * s).y > t.pos.y + 4) return false;
  }
  return true;
}
const DIVE_RUNOUT = 32;

/** Highest surface (props included) within 1.3 m of (x, z) at or below y (a plane's hull is ~1 m round). */
function highestNear(sim: Sim, x: number, z: number, y: number): number {
  let h = -Infinity;
  for (const [ox, oz] of [[0, 0], [1.3, 0], [-1.3, 0], [0, 1.3], [0, -1.3]]) h = Math.max(h, surfaceAt(sim.worldData, x + ox, z + oz, y + 0.5).y);
  return h;
}

/** Room (m) a dive line keeps over props below it (entry check; the in-dive look-ahead pulls out at 1 m less). */
const DIVE_CLEAR = 4;

/** A dive line with room under it: every 3 m the path stays DIVE_CLEAR over any prop below (not just in sight). */
function pathClear(sim: Sim, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const len = Math.hypot(bx - ax, bz - az);
  const n = Math.max(1, Math.floor((len - 6) / 3));
  for (let i = 1; i <= n; i++) {
    const s = (i * 3) / len;
    const x = ax + (bx - ax) * s, y = ay + (by - ay) * s, z = az + (bz - az) * s;
    const top = highestNear(sim, x, z, y);
    if (top > sim.worldData.height(x, z) + 1 && y - top < DIVE_CLEAR) return false;
  }
  return true;
}

export function createFlight(): FlightState {
  return { phase: 'cruise', until: 0, px: 0, pz: 0, firing: 0, dives: 0, why: '' };
}

const fc = { x: 0, y: 0, z: 0 };
const apGoal: AutopilotGoal = { x: 0, z: 0, y: 0, mode: 'flyover', clearance: 5 };

/**
 * One tick of flying `plane` toward `goal`: writes mz, yaw, pitch and buttons (Fire in a dive) into `out`. Returns
 * 'arrived' over a flyover goal, 'landed' once a landing has rolled to a stop, else 'flying'.
 */
export function flyPlane(sim: Sim, plane: SimEntity, fs: FlightState, goal: FlightGoal, out: InputCmd): FlightStatus {
  const p = plane.plane!;
  const def = VEHICLES[p.id];
  out.mx = 0; out.buttons = 0;
  const c = fc;
  c.x = plane.pos.x; c.y = plane.pos.y + def.gearHeight; c.z = plane.pos.z; // fuselage center (plane-systems planeCenterOf)
  const t = goal.mode === 'strafe' ? goal.target ?? null : null;
  const now = sim.tick;
  if (!t) {
    fs.phase = 'cruise';
    apGoal.x = goal.x; apGoal.z = goal.z; apGoal.y = goal.y; apGoal.mode = goal.mode === 'land' ? 'land' : 'flyover';
    apGoal.clearance = 5; apGoal.landYaw = goal.landYaw;
    planeAutopilot(sim, plane, apGoal, out);
    const d = Math.hypot(goal.x - plane.pos.x, goal.z - plane.pos.z);
    if (goal.mode === 'land') return p.grounded && p.speed < 1.5 && d < 60 ? 'landed' : 'flying';
    return !p.grounded && d < (goal.r ?? 10) && Math.abs(plane.pos.y - goal.y) < 8 ? 'arrived' : 'flying';
  }
  // --- strafing run
  const tx = t.pos.x, ty = t.pos.y + 0.8, tz = t.pos.z;
  const dx = tx - c.x, dz = tz - c.z, d = Math.hypot(dx, dz);
  const alt = c.y - ty;
  const nose = { x: -Math.sin(plane.yaw) * Math.cos(plane.pitch), y: Math.sin(plane.pitch), z: -Math.cos(plane.yaw) * Math.cos(plane.pitch) };
  const d3 = Math.hypot(dx, ty - c.y, dz) || 1e-3;
  const offNose = Math.acos(clamp((nose.x * dx + nose.y * (ty - c.y) + nose.z * dz) / d3, -1, 1));
  if (fs.phase === 'pullout' && now >= fs.until) fs.phase = 'cruise';
  if (fs.phase === 'cruise' && !p.grounded && d < DIVE_MIN + 4) {
    // over the target, too close for a dive (the autopilot would circle it): head out for a run-in from 45 m
    fs.phase = 'pullout'; fs.until = now + Math.round(PULL_TIME * TICK_HZ); fs.why = 'run-in';
    const box = planeFlightBox(sim.worldData, def);
    fs.px = clamp(tx - Math.sin(plane.yaw) * RUN_IN, box.minX + 20, box.maxX - 20);
    fs.pz = clamp(tz - Math.cos(plane.yaw) * RUN_IN, box.minZ + 20, box.maxZ - 20);
  }
  // (sight lines start just outside the hull: world rays hit vehicles, the plane's own body included)
  const k0 = (def.radius + 0.3) / d3;
  const sightClear = () => worldLineClear(sim, c.x + (tx - c.x) * k0, c.y + (ty - c.y) * k0, c.z + (tz - c.z) * k0, tx, ty, tz);
  if (fs.phase === 'cruise' && !p.grounded && d < DIVE_MAX && d > DIVE_MIN && alt > PULL_AGL + 2 && Math.atan2(alt, d) < DIVE_ANGLE && offNose < 1.0
    && sightClear() && runOutClear(sim, t, dx / d, dz / d) && pathClear(sim, c.x, c.y, c.z, tx, ty, tz)) {
    fs.phase = 'dive'; fs.dives++;
  }
  if (fs.phase === 'dive') {
    const agl = c.y - surfaceAt(sim.worldData, c.x, c.z, c.y).y;
    const blocked = (now + plane.id) % 10 === 0 && !sightClear();
    // where the plane will be over the next 0.75 s: pull out before a tree or a roof comes up under it (the lawn is the
    // AGL floor's job, so the dive's own descent doesn't count)
    let prop = false;
    for (const k of [0.25, 0.5, 0.75]) {
      const px = c.x + plane.vel.x * k, py = c.y + plane.vel.y * k, pz = c.z + plane.vel.z * k;
      const top = highestNear(sim, px, pz, py);
      if (top > sim.worldData.height(px, pz) + 1 && py - top < DIVE_CLEAR - 1) prop = true;
    }
    const why = agl < PULL_AGL ? 'low' : prop ? 'prop ahead' : d < 8 ? 'close' : offNose > 1.2 ? 'behind' : blocked ? 'blocked' : '';
    if (why) {
      fs.why = why;
      // pull out: extend past the target along the heading, then come round
      fs.phase = 'pullout'; fs.until = now + Math.round(PULL_TIME * TICK_HZ);
      const box = planeFlightBox(sim.worldData, def);
      fs.px = clamp(c.x - Math.sin(plane.yaw) * EXTEND_M, box.minX + 20, box.maxX - 20);
      fs.pz = clamp(c.z - Math.cos(plane.yaw) * EXTEND_M, box.minZ + 20, box.maxZ - 20);
    }
  }
  if (fs.phase === 'dive') {
    // aim the flight (and so the gun's gimbal) at where the target will be as the rounds arrive
    const lead = Math.min(0.4, d3 / 60);
    const ax = tx + t.vel.x * lead, az = tz + t.vel.z * lead;
    out.yaw = yawToward(plane.pos.x, plane.pos.z, ax, az);
    out.pitch = Math.atan2(ty - (plane.pos.y + def.gun.aimPivotY), Math.hypot(ax - plane.pos.x, az - plane.pos.z));
    out.mz = 0.75;
    if (offNose < def.gun.gimbal + 0.05 && d3 < def.gun.falloffEnd + 5 && !p.overheated) { out.buttons |= Btn.Fire; fs.firing++; }
    return 'flying';
  }
  apGoal.mode = 'flyover'; apGoal.clearance = 5; apGoal.landYaw = undefined;
  if (fs.phase === 'pullout') { apGoal.x = fs.px; apGoal.z = fs.pz; apGoal.y = ty + STRIKE_AGL + 4; }
  else { apGoal.x = tx; apGoal.z = tz; apGoal.y = ty + STRIKE_AGL; }
  planeAutopilot(sim, plane, apGoal, out);
  return 'flying';
}
