// Navigation grid (1 m cells) + weighted A* with path smoothing, built from the sim's actual static
// colliders: a character-sized capsule is overlap-tested at every cell (ground from
// WorldData.height + step clearance), so props, walls, steep terrain and anything else the world
// lane builds are respected without knowing their shapes. Built once per world (cached by a
// content signature) after the first physics step, when Rapier's query structures exist.
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { WorldData } from '../../shared/world/world-data';
import { WORLD_RAY_FILTER } from '../combat/geometry';
import { Layer } from '../rapier';
import { isTerrainCollider } from '../world/build';

export const NAV_CELL = 1;
/** Capsule tested per cell: bottom at ground + CLEARANCE (the KCC autostep height). */
const CLEARANCE = 0.45;
const PROBE_RADIUS = 0.42;
const PROBE_HALF = 0.12;
/** Max terrain gradient a bot walks on (tan 48°; the KCC climbs up to 52°). */
const MAX_SLOPE = 1.11;
/** Max ground height change between neighbouring cells a bot will walk. */
const MAX_STEP = 0.6;
const MAX_EXPANSIONS = 9000;
const HEURISTIC_WEIGHT = 1.25;
/** Every expansion pushes at most 8 entries. */
const HEAP_CAP = MAX_EXPANSIONS * 8 + 64;

export interface NavGrid {
  cell: number;
  ox: number; oz: number;
  w: number; h: number;
  walk: Uint8Array;
  ground: Float32Array;
  /** Path cost multiplier per cell (1 lawn, 3 water, 6 jump pad: bots avoid them unless needed). */
  cost: Uint8Array;
  /** Connected-component id per cell (-1 = blocked). */
  region: Int32Array;
  regionSize: number[];
  /** Largest region (the main yard). */
  mainRegion: number;
  buildMs: number;
  walkable: number;
  /** Rapier shape queries used by the build (the rest were resolved analytically). */
  queries: number;
  // A* scratch (grids are shared between sims of the same world; searches are synchronous)
  g: Float32Array;
  parent: Int32Array;
  open: Uint32Array;
  closed: Uint32Array;
  heap: Int32Array;
  heapF: Float32Array;
  search: number;
}

const cache = new Map<string, NavGrid>();

function signature(d: WorldData): string {
  let h = 2166136261 >>> 0;
  const mix = (v: number) => { h = Math.imul(h ^ (Math.round(v * 100) | 0), 16777619) >>> 0; };
  for (const p of d.props) { mix(p.x); mix(p.y); mix(p.z); mix(p.hx); mix(p.hy); mix(p.hz); mix(p.rotY); }
  const e = d.halfExtent;
  for (let i = 0; i <= 12; i++) for (let j = 0; j <= 12; j++) mix(d.height(-e + (2 * e * i) / 12, -e + (2 * e * j) / 12));
  return `${d.name}|${d.seed}|${e}|${d.props.length}|${h}`;
}

export function navGridFor(sim: Sim): NavGrid {
  const key = signature(sim.worldData);
  let g = cache.get(key);
  if (!g) { g = buildNavGrid(sim); cache.set(key, g); }
  return g;
}

interface Aabb { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

/** World AABBs of the static props the world lane turns into colliders (boxes rotated YXZ). */
function propAabbs(d: WorldData): Aabb[] {
  const out: Aabb[] = [];
  for (const p of d.props) {
    // R = Ry(yaw) · Rx(pitch) · Rz(roll); AABB half extent along world axis i = Σ_j |R_ij| h_j
    const cy = Math.cos(p.rotY), sy = Math.sin(p.rotY), cp = Math.cos(p.pitch ?? 0), sp = Math.sin(p.pitch ?? 0), cr = Math.cos(p.roll ?? 0), sr = Math.sin(p.roll ?? 0);
    const r00 = cy * cr + sy * sp * sr, r01 = -cy * sr + sy * sp * cr, r02 = sy * cp;
    const r10 = cp * sr, r11 = cp * cr, r12 = -sp;
    const r20 = -sy * cr + cy * sp * sr, r21 = sy * sr + cy * sp * cr, r22 = cy * cp;
    const ex = Math.abs(r00) * p.hx + Math.abs(r01) * p.hy + Math.abs(r02) * p.hz;
    const ey = Math.abs(r10) * p.hx + Math.abs(r11) * p.hy + Math.abs(r12) * p.hz;
    const ez = Math.abs(r20) * p.hx + Math.abs(r21) * p.hy + Math.abs(r22) * p.hz;
    out.push({ x0: p.x - ex, x1: p.x + ex, z0: p.z - ez, z1: p.z + ez, y0: p.y - ey, y1: p.y + ey });
  }
  for (const c of d.cylinders ?? []) out.push({ x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r, y0: c.y - c.hh, y1: c.y + c.hh });
  return out;
}

/** Static (World-layer) collider count and the terrain collider (trimesh or heightfield), if any. */
function staticColliders(sim: Sim): { count: number; terrain: Collider | undefined } {
  let count = 0, terrain: Collider | undefined;
  sim.world.forEachCollider((c) => {
    if (((c.collisionGroups() >>> 16) & Layer.World) === 0) return;
    count++;
    if (isTerrainCollider(c)) terrain = c;
  });
  return { count, terrain };
}

function inWater(d: WorldData, x: number, z: number): boolean {
  for (const w of d.water ?? []) {
    if (w.shape === 'circle' ? Math.hypot(x - w.x, z - w.z) <= (w.r ?? 0) : Math.abs(x - w.x) <= (w.hx ?? 0) && Math.abs(z - w.z) <= (w.hz ?? 0)) return true;
  }
  return false;
}

function onPad(d: WorldData, x: number, z: number): boolean {
  for (const p of d.jumpPads ?? []) if (Math.hypot(x - p.x, z - p.z) <= p.r + 0.6) return true;
  return false;
}

export function buildNavGrid(sim: Sim): NavGrid {
  const t0 = performance.now();
  const data = sim.worldData;
  const cell = NAV_CELL;
  const half = data.halfExtent;
  const w = Math.ceil((2 * half) / cell), h = w;
  const ox = -half, oz = -half;
  const n = w * h;
  const walk = new Uint8Array(n), ground = new Float32Array(n), cost = new Uint8Array(n).fill(1);
  const shape = new sim.R.Capsule(PROBE_HALF, PROBE_RADIUS);
  const rot = { x: 0, y: 0, z: 0, w: 1 };
  const pos = { x: 0, y: 0, z: 0 };
  const edge = half - 0.8;
  const b = data.bounds;
  // Analytic prefilter: only cells whose probe overlaps a prop AABB need a Rapier query; elsewhere
  // the probe can only touch the terrain, tested from height(). If the world holds static colliders
  // this code doesn't know about, every cell is queried (always correct, just slower).
  // Terrain is covered by the slope test, so probes skip the heightfield (capsule-vs-heightfield
  // queries cost ~8 µs each; prop-only queries ~2 µs).
  const statics = staticColliders(sim);
  const exact = statics.count !== 1 + data.props.length + (data.cylinders?.length ?? 0);
  const boxes = propAabbs(data);
  const BUCKET = 4;
  const bw = Math.ceil((2 * half) / BUCKET) + 1;
  const buckets = new Map<number, number[]>();
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    for (let bz = Math.floor((a.z0 - oz) / BUCKET); bz <= Math.floor((a.z1 - oz) / BUCKET); bz++) {
      for (let bx = Math.floor((a.x0 - ox) / BUCKET); bx <= Math.floor((a.x1 - ox) / BUCKET); bx++) {
        const k = bz * bw + bx;
        let l = buckets.get(k);
        if (!l) { l = []; buckets.set(k, l); }
        l.push(i);
      }
    }
  }
  const R = PROBE_RADIUS, span = 2 * (PROBE_RADIUS + PROBE_HALF);
  for (let iz = 0; iz < h; iz++) for (let ix = 0; ix < w; ix++) ground[iz * w + ix] = data.height(ox + (ix + 0.5) * cell, oz + (iz + 0.5) * cell);
  let walkable = 0, queries = 0;
  for (let iz = 1; iz < h - 1; iz++) {
    for (let ix = 1; ix < w - 1; ix++) {
      const i = iz * w + ix;
      const x = ox + (ix + 0.5) * cell, z = oz + (iz + 0.5) * cell;
      const gy = ground[i];
      if (Math.abs(x) > edge || Math.abs(z) > edge || gy < data.killY + 2) continue;
      if (b && (x < b.minX + 0.8 || x > b.maxX - 0.8 || z < b.minZ + 0.8 || z > b.maxZ - 0.8)) continue;
      // terrain steeper than the character controller can climb
      const sx = (ground[i + 1] - ground[i - 1]) / (2 * cell), sz = (ground[i + w] - ground[i - w]) / (2 * cell);
      if (sx * sx + sz * sz > MAX_SLOPE * MAX_SLOPE) continue;
      const y0 = gy + CLEARANCE, y1 = y0 + span;
      let near = exact;
      if (!near) {
        const l = buckets.get(Math.floor((z - oz) / BUCKET) * bw + Math.floor((x - ox) / BUCKET));
        if (l) for (const k of l) {
          const a = boxes[k];
          if (x + R >= a.x0 && x - R <= a.x1 && z + R >= a.z0 && z - R <= a.z1 && y1 >= a.y0 && y0 <= a.y1) { near = true; break; }
        }
      }
      if (near) {
        queries++;
        pos.x = x; pos.y = y0 + R + PROBE_HALF; pos.z = z;
        if (sim.world.intersectionWithShape(pos, rot, shape, undefined, WORLD_RAY_FILTER, exact ? undefined : statics.terrain)) continue;
      }
      walk[i] = 1;
      walkable++;
      if (inWater(data, x, z)) cost[i] = 3;
      if (onPad(data, x, z)) cost[i] = 6;
    }
  }
  const grid: NavGrid = {
    cell, ox, oz, w, h, walk, ground, cost, region: new Int32Array(n).fill(-1), regionSize: [], mainRegion: -1,
    buildMs: 0, walkable, queries,
    g: new Float32Array(n), parent: new Int32Array(n), open: new Uint32Array(n), closed: new Uint32Array(n),
    heap: new Int32Array(HEAP_CAP), heapF: new Float32Array(HEAP_CAP), search: 0,
  };
  labelRegions(grid);
  grid.buildMs = performance.now() - t0;
  return grid;
}

const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DZ = [0, 0, 1, -1, 1, -1, 1, -1];
const COST = [1, 1, 1, 1, Math.SQRT2, Math.SQRT2, Math.SQRT2, Math.SQRT2];

/** Neighbour k of cell i, or -1 if not traversable (bounds, blocked, too steep, diagonal corner cut). */
function neighbour(g: NavGrid, i: number, k: number): number {
  const ix = i % g.w, iz = (i / g.w) | 0;
  const nx = ix + DX[k], nz = iz + DZ[k];
  if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) return -1;
  const j = nz * g.w + nx;
  if (!g.walk[j] || Math.abs(g.ground[j] - g.ground[i]) > MAX_STEP) return -1;
  if (k >= 4 && (!g.walk[iz * g.w + nx] || !g.walk[nz * g.w + ix])) return -1;
  return j;
}

function labelRegions(g: NavGrid): void {
  const queue = new Int32Array(g.w * g.h);
  let id = 0, best = -1, bestSize = 0;
  for (let s = 0; s < g.walk.length; s++) {
    if (!g.walk[s] || g.region[s] >= 0) continue;
    let head = 0, tail = 0;
    queue[tail++] = s; g.region[s] = id;
    while (head < tail) {
      const i = queue[head++];
      for (let k = 0; k < 8; k++) {
        const j = neighbour(g, i, k);
        if (j >= 0 && g.region[j] < 0) { g.region[j] = id; queue[tail++] = j; }
      }
    }
    g.regionSize.push(tail);
    if (tail > bestSize) { bestSize = tail; best = id; }
    id++;
  }
  g.mainRegion = best;
}

export function cellIndex(g: NavGrid, x: number, z: number): number {
  const ix = Math.floor((x - g.ox) / g.cell), iz = Math.floor((z - g.oz) / g.cell);
  if (ix < 0 || iz < 0 || ix >= g.w || iz >= g.h) return -1;
  return iz * g.w + ix;
}

export function cellX(g: NavGrid, i: number): number { return g.ox + ((i % g.w) + 0.5) * g.cell; }
export function cellZ(g: NavGrid, i: number): number { return g.oz + (((i / g.w) | 0) + 0.5) * g.cell; }

export function isWalkable(g: NavGrid, x: number, z: number): boolean {
  const i = cellIndex(g, x, z);
  return i >= 0 && g.walk[i] === 1;
}

/** Closest walkable cell to (x, z) within maxR cells (optionally in a given region), or -1. */
export function nearestWalkable(g: NavGrid, x: number, z: number, maxR: number, region = -1): number {
  const c = cellIndex(g, Math.max(g.ox, Math.min(-g.ox - 0.01, x)), Math.max(g.oz, Math.min(-g.oz - 0.01, z)));
  if (c < 0) return -1;
  if (g.walk[c] && (region < 0 || g.region[c] === region)) return c;
  const cx = c % g.w, cz = (c / g.w) | 0;
  let best = -1, bestD = Infinity;
  for (let r = 1; r <= maxR && best < 0; r++) {
    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const nx = cx + dx, nz = cz + dz;
        if (nx < 0 || nz < 0 || nx >= g.w || nz >= g.h) continue;
        const j = nz * g.w + nx;
        if (!g.walk[j] || (region >= 0 && g.region[j] !== region)) continue;
        const d = dx * dx + dz * dz;
        if (d < bestD) { bestD = d; best = j; }
      }
    }
  }
  return best;
}

/**
 * True when a character can walk the straight segment (all sampled cells walkable, no steep steps).
 * `strict` also refuses segments through costly cells (water, jump pads) unless the segment starts
 * in one — used when smoothing paths so string-pulling doesn't cut through the pond.
 */
export function lineWalkable(g: NavGrid, ax: number, az: number, bx: number, bz: number, strict = false): boolean {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(len / 0.3));
  let prev = cellIndex(g, ax, az);
  const allowCost = !strict || (prev >= 0 && g.cost[prev] > 1);
  for (let s = 1; s <= steps; s++) {
    const t = s / steps;
    const i = cellIndex(g, ax + dx * t, az + dz * t);
    if (i < 0 || !g.walk[i]) return false;
    if (!allowCost && g.cost[i] > 1) return false;
    if (prev >= 0 && i !== prev && Math.abs(g.ground[i] - g.ground[prev]) > MAX_STEP) return false;
    prev = i;
  }
  return true;
}

function heapPush(g: NavGrid, size: number, node: number, f: number): number {
  let i = size;
  g.heap[i] = node; g.heapF[i] = f;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (g.heapF[p] <= g.heapF[i]) break;
    const tn = g.heap[p], tf = g.heapF[p];
    g.heap[p] = g.heap[i]; g.heapF[p] = g.heapF[i];
    g.heap[i] = tn; g.heapF[i] = tf;
    i = p;
  }
  return size + 1;
}

function heapPop(g: NavGrid, size: number): number {
  const last = size - 1;
  g.heap[0] = g.heap[last]; g.heapF[0] = g.heapF[last];
  let i = 0;
  for (;;) {
    const l = i * 2 + 1, r = l + 1;
    let m = i;
    if (l < last && g.heapF[l] < g.heapF[m]) m = l;
    if (r < last && g.heapF[r] < g.heapF[m]) m = r;
    if (m === i) break;
    const tn = g.heap[m], tf = g.heapF[m];
    g.heap[m] = g.heap[i]; g.heapF[m] = g.heapF[i];
    g.heap[i] = tn; g.heapF[i] = tf;
    i = m;
  }
  return last;
}

function octile(g: NavGrid, a: number, b: number): number {
  const dx = Math.abs((a % g.w) - (b % g.w)), dz = Math.abs(((a / g.w) | 0) - ((b / g.w) | 0));
  return (dx + dz) + (Math.SQRT2 - 2) * Math.min(dx, dz);
}

export interface PathStats { searches: number; expansions: number }
export const pathStats: PathStats = { searches: 0, expansions: 0 };

const cells: number[] = [];

/**
 * A* from (sx, sz) to (gx, gz). Writes smoothed waypoints [x0, z0, x1, z1, ...] into `out` (the
 * first waypoint is the first corner to head for; the last is the goal). Returns false when no
 * route exists (different regions / no walkable cell nearby). Unreached goals within the
 * expansion budget yield a partial path toward the closest explored cell.
 */
export function findPath(g: NavGrid, sx: number, sz: number, gx: number, gz: number, out: number[]): boolean {
  out.length = 0;
  const s = nearestWalkable(g, sx, sz, 4);
  if (s < 0) return false;
  const goal = nearestWalkable(g, gx, gz, 6, g.region[s]);
  if (goal < 0) return false;
  pathStats.searches++;
  if (s === goal) { out.push(cellX(g, goal), cellZ(g, goal)); return true; }
  const id = ++g.search;
  let size = heapPush(g, 0, s, 0);
  g.g[s] = 0; g.parent[s] = -1; g.open[s] = id;
  let reached = -1, closest = s, closestH = octile(g, s, goal), exp = 0;
  while (size > 0) {
    const cur = g.heap[0];
    size = heapPop(g, size);
    if (g.closed[cur] === id) continue;
    g.closed[cur] = id;
    if (cur === goal) { reached = cur; break; }
    if (++exp > MAX_EXPANSIONS) break;
    const hc = octile(g, cur, goal);
    if (hc < closestH) { closestH = hc; closest = cur; }
    for (let k = 0; k < 8; k++) {
      const j = neighbour(g, cur, k);
      if (j < 0 || g.closed[j] === id) continue;
      const ng = g.g[cur] + COST[k] * g.cost[j];
      if (g.open[j] === id && ng >= g.g[j]) continue;
      g.g[j] = ng; g.parent[j] = cur; g.open[j] = id;
      size = heapPush(g, size, j, ng + HEURISTIC_WEIGHT * octile(g, j, goal));
    }
  }
  pathStats.expansions += exp;
  const end = reached >= 0 ? reached : closest;
  cells.length = 0;
  for (let c = end; c >= 0; c = g.parent[c]) { cells.push(c); if (c === s) break; }
  cells.reverse();
  // string-pull: keep only corners the straight line can't skip
  let anchorX = sx, anchorZ = sz;
  for (let i = 1; i < cells.length; i++) {
    const nx = cellX(g, cells[i]), nz = cellZ(g, cells[i]);
    if (!lineWalkable(g, anchorX, anchorZ, nx, nz, true)) {
      const px = cellX(g, cells[i - 1]), pz = cellZ(g, cells[i - 1]);
      out.push(px, pz);
      anchorX = px; anchorZ = pz;
    }
  }
  const ex = cellX(g, end), ez = cellZ(g, end);
  if (reached >= 0 && isWalkable(g, gx, gz) && lineWalkable(g, anchorX, anchorZ, gx, gz, true)) out.push(gx, gz);
  else out.push(ex, ez);
  return true;
}

/** A random walkable cell in `region` within `radius` m of (cx, cz), or -1 after a few tries. */
export function randomCell(g: NavGrid, rng: () => number, region: number, cx: number, cz: number, radius: number, minRadius = 0): number {
  for (let t = 0; t < 24; t++) {
    const a = rng() * Math.PI * 2, r = minRadius + Math.sqrt(rng()) * (radius - minRadius);
    const i = cellIndex(g, cx + Math.cos(a) * r, cz + Math.sin(a) * r);
    if (i >= 0 && g.walk[i] && (region < 0 || g.region[i] === region)) return i;
  }
  return -1;
}
