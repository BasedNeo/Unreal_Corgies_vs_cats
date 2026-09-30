// Navigation grid (1 m cells) + weighted A* with path smoothing, built from the sim's actual static
// colliders: a character-sized capsule is overlap-tested at every cell (ground from
// WorldData.height + step clearance), so props, walls, steep terrain and anything else the world
// lane builds are respected without knowing their shapes. Built once per world (cached by a
// content signature) after the first physics step, when Rapier's query structures exist.
//
// D1 determinism: the grid is shared by every sim of the world (a server hosts many rooms in one process), so it is
// built from the STATIC world only (isStaticWorldCollider: what buildStaticWorld made from WorldData). Whatever else a
// sim has on the World/Vehicle layers is that sim's own: kiosks (per mode), karts, planes, barriers, destructibles.
// Probing those made the grid depend on which room built it first (a TDM room's Kart-O-Matic cells stayed closed for
// every later room). World fixtures that bots walk around (kiosks: never move, never removed) are per-sim blockers
// (setNavFixture), on the ground grid and on the decks (deckGridFor).
//
// X1 dynamic blockers: the shared (cached) grid ignores destructible colliders — it is the world with every
// destructible broken. A sim that registers blockers (setNavBlocker: the destruct system does, for every standing
// destructible) gets its OWN grid from navGridFor(): a copy of the shared walk/region arrays with the blockers' cells
// closed, updated IN PLACE when a blocker is added or removed (bots hold on to the grid object they got at tick 1).
// Ground, costs and the A* scratch stay shared (searches are synchronous; the search stamp is a global counter).
//
// N1 decks: buildDeckGrid() floods an ELEVATED walkable surface (a roof, a platform) from a seed point into its own
// small NavGrid over prop tops (ground = the surface height per cell). findPath & co. work on it unchanged; the
// link layer (nav-links.ts) joins decks and the ground grid through validated hop sequences.
//
// W10 N3 thin obstacles: beams, posts and poles (a box whose two smaller half extents are <= THIN_HALF, an upright
// cylinder of radius <= THIN_HALF) are rasterized into the ground grid on top of the probe. The probe tests a capsule
// at the cell CENTRE from 0.45 m up, so a 0.2 m beam crossing a cell away from its centre, or low under the probe's
// floor, left the cell open: the West Yard's hedgehogs (E4, three pitched 0.2 m beams) were closed for 1-3 of the 5-9
// cells their beams cross, bots pathed into their reach and pinned there 1-4 s (F1 §7, G4b §7). A thin prop now closes
// every cell whose body column (THIN_FLOOR over the ground to the probe's top) it actually intersects: exact box-vs-box
// SAT, no inflation (a cell the beam only passes beside stays open: F2's one-cell walkway under the Lot's brace).
// Analytic over the few cells of each thin prop's AABB, once per grid build: no Rapier query, no per-tick cost.
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { PropBox, PropCylinder, WorldData } from '../../shared/world/world-data';
import { WORLD_RAY_FILTER } from '../combat/geometry';
import { Layer } from '../rapier';
import { isStaticWorldCollider, isTerrainCollider } from '../world/build';
import { surfaceAt } from '../../shared/world/queries';

export const NAV_CELL = 1;
/** Capsule tested per cell: bottom at ground + CLEARANCE (the KCC autostep height). */
const CLEARANCE = 0.45;
const PROBE_RADIUS = 0.42;
const PROBE_HALF = 0.12;
/** Max terrain gradient a bot walks on (tan 48°; the KCC climbs up to 52°). */
const MAX_SLOPE = 1.11;
/** Max ground height change between neighbouring cells a bot will walk. */
const MAX_STEP = 0.6;
/** W10 N3: a box whose two smaller half extents, or a cylinder whose radius, are at most this is a thin obstacle. */
export const THIN_HALF = 0.2;
/** W10 N3: a thin obstacle closes the cells it crosses from this height over the ground up (a pitched beam's low end
 *  wedges a pet or lets it climb on: the KCC's autostep needs a 0.2 m wide top, exactly a beam's); the top is the
 *  probe's. */
export const THIN_FLOOR = 0.08;
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
  /** W10 N3: cells the probe left open that a thin obstacle closed (0 on decks). */
  thin: number;
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

/** The shared grid of a sim's world (destructibles ignored: as if every one were broken). Also the cache key of
 *  everything derived from a world's static nav (N1: decks and links). */
export function sharedNavGrid(sim: Sim): NavGrid {
  return sharedGridFor(sim);
}

function sharedGridFor(sim: Sim): NavGrid {
  const thin = thinPassFor(sim);
  const key = signature(sim.worldData) + (thin ? '' : '|no-thin');
  let g = cache.get(key);
  if (!g) { g = buildNavGrid(sim, thin); cache.set(key, g); }
  return g;
}

/**
 * W11 F3 (P1-1): does this sim's grid take N3's thin pass? Every map and mode does, except Base Assault on the West Yard.
 * There the thin pass tilted the mode to the corgis' side (first to 3 on seeds 1-40: 23 : 7 with it, 18 : 15 without,
 * 11 : 16 before Wave 10), and there its pins were already short without it (the flag F1 moved keeps the ball runs off
 * the kart-gate hedgehog; worst hedgehog pin 1 s in N3's and F3's matches). docs/handoff/F3.md has the arms. A room
 * sets its mode before its bots first path (Room writes sim.state.room), so the grid is keyed by the flag too.
 */
export function thinPassFor(sim: Sim): boolean {
  return !((sim.state.room as { mode?: string } | undefined)?.mode === 'base-assault' && sim.worldData.name === 'West Yard');
}

/** The nav grid bots of this sim path on: the shared grid, or the sim's own copy when it has dynamic blockers. */
export function navGridFor(sim: Sim): NavGrid {
  const base = sharedGridFor(sim);
  const o = overlays.get(sim);
  if (!o) return base;
  if (!o.grid || o.base !== base) {
    o.base = base;
    o.grid = {
      ...base, walk: new Uint8Array(base.walk), region: new Int32Array(base.region), regionSize: [...base.regionSize],
    };
    o.count = new Uint8Array(base.walk.length);
    const t0 = performance.now();
    for (const boxes of o.blockers.values()) for (const i of blockedCells(base, boxes)) o.count[i]++;
    for (const boxes of o.fixtures.values()) for (const i of blockedCells(base, boxes)) o.count[i]++;
    relabelAll(o);
    o.applyMs = performance.now() - t0;
  }
  return o.grid;
}

// ------------------------------------------------------------------------------------------ X1 dynamic blockers

interface NavOverlay {
  blockers: Map<string, readonly PropBox[]>;
  /** D1 world fixtures of this sim (kiosks): closed on the ground grid like blockers, and on the decks. */
  fixtures: Map<string, readonly PropBox[]>;
  fixtureVersion: number;
  /** This sim's copy of each shared deck its fixtures touch (deckGridFor), and the fixture version it was made at. */
  decks: WeakMap<NavGrid, { version: number; grid: NavGrid }>;
  base: NavGrid | null;
  grid: NavGrid | null;
  /** Blockers covering each cell. */
  count: Uint8Array | null;
  /** Cells closed now (stats/tests) and the cost of the last update (ms). */
  closed: number;
  applyMs: number;
  /** batchNavBlockers() depth, and whether a relabel is pending at its end. */
  batch: number;
  dirty: boolean;
}
const overlays = new WeakMap<Sim, NavOverlay>();
const cellCache = new WeakMap<NavGrid, WeakMap<readonly PropBox[], Int32Array>>();

/**
 * Close (boxes) or re-open (null) the nav cells under a dynamic obstacle of this sim, keyed by `key` (X1: one per
 * destructible). The sim's grid is updated in place right away if it exists, else on first use. Re-opening merges
 * the freed cells into the regions they touch (cheap, runs on a break); closing relabels every region (a split is
 * possible; runs on a reset). Other sims of the same world are unaffected.
 */
export function setNavBlocker(sim: Sim, key: string, boxes: readonly PropBox[] | null): void {
  const o = overlayOf(sim);
  cover(o, o.blockers, key, boxes);
}

/**
 * D1: a world fixture of this sim that bots walk around (a kiosk): its cells close on this sim's ground grid (as a
 * blocker would) and on its view of the decks (deckGridFor). The shared grids never see it: which fixtures exist
 * depends on the sim's mode. The owner registers it when it places the fixture (vehicles/interact terminals).
 */
export function setNavFixture(sim: Sim, key: string, boxes: readonly PropBox[] | null): void {
  const o = overlayOf(sim);
  if (cover(o, o.fixtures, key, boxes)) o.fixtureVersion++;
}

/** Bumped whenever this sim's fixtures change (nav-links.ts rebuilds its per-sim deck view). */
export function navFixtureVersion(sim: Sim): number {
  return overlays.get(sim)?.fixtureVersion ?? 0;
}

/**
 * This sim's view of a shared deck grid (N1): the deck with the cells under this sim's fixtures closed (the Rooftop
 * Hangar kiosk on the garage roof), or the shared deck itself when no fixture touches it. Built on first use per sim
 * and fixture set; walk/region are copies, ground/costs/A* scratch stay shared (as for the ground grid).
 */
export function deckGridFor(sim: Sim, deck: NavGrid): NavGrid {
  const o = overlays.get(sim);
  if (!o || o.fixtures.size === 0) return deck;
  const hit = o.decks.get(deck);
  if (hit && hit.version === o.fixtureVersion) return hit.grid;
  const closed = new Set<number>();
  for (const boxes of o.fixtures.values()) for (const i of blockedCells(deck, boxes)) if (deck.walk[i]) closed.add(i);
  let grid = deck;
  if (closed.size) {
    grid = { ...deck, walk: new Uint8Array(deck.walk), region: new Int32Array(deck.region.length).fill(-1), regionSize: [], mainRegion: -1 };
    for (const i of closed) grid.walk[i] = 0;
    grid.walkable = deck.walkable - closed.size;
    labelRegions(grid);
  }
  o.decks.set(deck, { version: o.fixtureVersion, grid });
  return grid;
}

function overlayOf(sim: Sim): NavOverlay {
  let o = overlays.get(sim);
  if (!o) {
    o = { blockers: new Map(), fixtures: new Map(), fixtureVersion: 0, decks: new WeakMap(), base: null, grid: null, count: null, closed: 0, applyMs: 0, batch: 0, dirty: false };
    overlays.set(sim, o);
  }
  return o;
}

/** Add, replace or remove (null) the boxes under `key` in one of a sim's cover maps (blockers or fixtures), and
 *  update the sim's grid in place if it exists. False when nothing changed. */
function cover(o: NavOverlay, map: Map<string, readonly PropBox[]>, key: string, boxes: readonly PropBox[] | null): boolean {
  const prev = map.get(key);
  if (boxes) {
    if (prev === boxes) return false;
    map.set(key, boxes);
  } else {
    if (!prev) return false;
    map.delete(key);
  }
  const g = o.grid, base = o.base, count = o.count;
  if (!g || !base || !count) return true;
  const t0 = performance.now();
  if (prev) for (const i of blockedCells(base, prev)) count[i]--;
  if (boxes) for (const i of blockedCells(base, boxes)) count[i]++;
  if (o.batch > 0) { o.dirty = true; return true; }
  if (prev && !boxes) {
    const opened: number[] = [];
    for (const i of blockedCells(base, prev)) if (count[i] === 0 && base.walk[i] && !g.walk[i]) { g.walk[i] = 1; opened.push(i); }
    o.closed -= opened.length;
    g.walkable += opened.length;
    mergeOpened(g, opened);
  } else relabelAll(o);
  o.applyMs = performance.now() - t0;
  return true;
}

/** Apply several blocker changes of a sim with one region relabel at the end (X1: resetting every destructible). */
export function batchNavBlockers(sim: Sim, fn: () => void): void {
  const o = overlays.get(sim);
  if (!o) { fn(); return; }
  o.batch++;
  try { fn(); } finally {
    if (--o.batch === 0 && o.dirty) {
      o.dirty = false;
      if (o.grid) { const t0 = performance.now(); relabelAll(o); o.applyMs = performance.now() - t0; }
    }
  }
}

/** Blocker bookkeeping of a sim (tests/debug): cells closed now, last update cost (ms), blocker count. */
export function navBlockerStats(sim: Sim): { closed: number; applyMs: number; blockers: number } {
  const o = overlays.get(sim);
  return { closed: o?.closed ?? 0, applyMs: o?.applyMs ?? 0, blockers: o?.blockers.size ?? 0 };
}

/** Cells of `g` whose character probe would touch the boxes (the build's probe: a capsule 0.45 m over the ground). */
export function blockedCells(g: NavGrid, boxes: readonly PropBox[]): Int32Array {
  let byBoxes = cellCache.get(g);
  if (!byBoxes) { byBoxes = new WeakMap(); cellCache.set(g, byBoxes); }
  const hit = byBoxes.get(boxes);
  if (hit) return hit;
  const out = new Set<number>();
  const R = PROBE_RADIUS, span = 2 * (PROBE_RADIUS + PROBE_HALF);
  for (const b of boxes) {
    const yawOnly = !b.pitch && !b.roll;
    const a = propAabbs({ props: [b] } as unknown as WorldData)[0];
    const ix0 = Math.max(0, Math.floor((a.x0 - R - g.ox) / g.cell)), ix1 = Math.min(g.w - 1, Math.floor((a.x1 + R - g.ox) / g.cell));
    const iz0 = Math.max(0, Math.floor((a.z0 - R - g.oz) / g.cell)), iz1 = Math.min(g.h - 1, Math.floor((a.z1 + R - g.oz) / g.cell));
    const c = Math.cos(b.rotY), s = Math.sin(b.rotY);
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * g.w + ix;
      const x = g.ox + (ix + 0.5) * g.cell, z = g.oz + (iz + 0.5) * g.cell;
      const y0 = g.ground[i] + CLEARANCE, y1 = y0 + span;
      let touch: boolean;
      if (yawOnly) {
        // vertical probe segment vs a yawed box: distance to the footprint rectangle (+) the vertical gap
        const dx = x - b.x, dz = z - b.z;
        const lx = dx * c - dz * s, lz = dx * s + dz * c;
        const ex = Math.max(0, Math.abs(lx) - b.hx), ez = Math.max(0, Math.abs(lz) - b.hz);
        const sy0 = y0 + R, sy1 = y1 - R;                      // the capsule's segment
        const ey = Math.max(0, b.y - b.hy - sy1, sy0 - (b.y + b.hy));
        touch = ex * ex + ez * ez + ey * ey <= R * R;
      } else {
        touch = x + R >= a.x0 && x - R <= a.x1 && z + R >= a.z0 && z - R <= a.z1 && y1 >= a.y0 && y0 <= a.y1;
      }
      if (touch) out.add(i);
    }
  }
  const cells = Int32Array.from([...out].sort((p, q) => p - q));
  byBoxes.set(boxes, cells);
  return cells;
}

/** Walk = shared walk minus every covered cell; full region labelling. */
function relabelAll(o: NavOverlay): void {
  const g = o.grid!, base = o.base!, count = o.count!;
  let closed = 0;
  for (let i = 0; i < g.walk.length; i++) {
    const w = base.walk[i] && count[i] === 0 ? 1 : 0;
    if (base.walk[i] && !w) closed++;
    g.walk[i] = w;
  }
  g.walkable = base.walkable - closed;
  g.region.fill(-1);
  g.regionSize.length = 0;
  labelRegions(g);
  o.closed = closed;
}

/**
 * Freed cells join the regions they touch: flood each connected group of freed cells, then fold every region it
 * touches into the largest one (a relabel of the smaller regions' cells only). New connections always run through a
 * freed cell or its neighbourhood (diagonals included), so this equals a full relabel.
 */
function mergeOpened(g: NavGrid, opened: number[]): void {
  const n = g.walk.length;
  for (const s of opened) {
    if (g.region[s] >= 0) continue;
    const comp: number[] = [s];
    const touched = new Set<number>();
    g.region[s] = -2;
    for (let h = 0; h < comp.length; h++) {
      const i = comp[h];
      for (let k = 0; k < 8; k++) {
        const j = neighbour(g, i, k);
        if (j < 0) continue;
        const r = g.region[j];
        if (r === -1) { g.region[j] = -2; comp.push(j); } else if (r >= 0) touched.add(r);
      }
    }
    let target = -1;
    for (const r of touched) if (target < 0 || g.regionSize[r] > g.regionSize[target]) target = r;
    if (target < 0) { target = g.regionSize.length; g.regionSize.push(0); }
    for (const i of comp) g.region[i] = target;
    g.regionSize[target] += comp.length;
    for (const r of touched) {
      if (r === target) continue;
      for (let i = 0; i < n; i++) if (g.region[i] === r) g.region[i] = target;
      g.regionSize[target] += g.regionSize[r];
      g.regionSize[r] = 0;
    }
  }
  let best = g.mainRegion;
  for (let r = 0; r < g.regionSize.length; r++) if (best < 0 || g.regionSize[r] > g.regionSize[best]) best = r;
  g.mainRegion = best;
}

interface Aabb { x0: number; x1: number; z0: number; z1: number; y0: number; y1: number }

/** R = Ry(yaw) · Rx(pitch) · Rz(roll) of a prop box, row-major into m (column j = the box's local axis j in world). */
function rotYXZ(p: PropBox, m: Float64Array): void {
  const cy = Math.cos(p.rotY), sy = Math.sin(p.rotY), cp = Math.cos(p.pitch ?? 0), sp = Math.sin(p.pitch ?? 0), cr = Math.cos(p.roll ?? 0), sr = Math.sin(p.roll ?? 0);
  m[0] = cy * cr + sy * sp * sr; m[1] = -cy * sr + sy * sp * cr; m[2] = sy * cp;
  m[3] = cp * sr; m[4] = cp * cr; m[5] = -sp;
  m[6] = -sy * cr + cy * sp * sr; m[7] = sy * sr + cy * sp * cr; m[8] = cy * cp;
}

/** World AABB of one prop box (rotated YXZ): half extent along world axis i = Σ_j |R_ij| h_j. */
function boxAabb(p: PropBox, m: Float64Array): Aabb {
  rotYXZ(p, m);
  const ex = Math.abs(m[0]) * p.hx + Math.abs(m[1]) * p.hy + Math.abs(m[2]) * p.hz;
  const ey = Math.abs(m[3]) * p.hx + Math.abs(m[4]) * p.hy + Math.abs(m[5]) * p.hz;
  const ez = Math.abs(m[6]) * p.hx + Math.abs(m[7]) * p.hy + Math.abs(m[8]) * p.hz;
  return { x0: p.x - ex, x1: p.x + ex, z0: p.z - ez, z1: p.z + ez, y0: p.y - ey, y1: p.y + ey };
}

/** World AABBs of the static props the world lane turns into colliders (boxes rotated YXZ). */
function propAabbs(d: WorldData): Aabb[] {
  const out: Aabb[] = [];
  const m = new Float64Array(9);
  for (const p of d.props) out.push(boxAabb(p, m));
  for (const c of d.cylinders ?? []) out.push({ x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r, y0: c.y - c.hh, y1: c.y + c.hh });
  return out;
}

// ------------------------------------------------------------------------------------------ W10 N3 thin obstacles

/** A beam, post or pole: the two smaller half extents are at most THIN_HALF (the largest is its length). */
export function isThinBox(p: PropBox): boolean {
  const mid = p.hx + p.hy + p.hz - Math.max(p.hx, p.hy, p.hz) - Math.min(p.hx, p.hy, p.hz);
  return mid <= THIN_HALF;
}

export function isThinCylinder(c: PropCylinder): boolean {
  return c.r <= THIN_HALF;
}

/**
 * Does the oriented box p (rotation m: rotYXZ) intersect the axis-aligned box centred (cx, cy, cz) with half extents
 * (ax, ay, az)? The separating-axis test (Ericson, Real-Time Collision Detection §4.4.1): the 3 + 3 face axes and the 9
 * edge cross products; the epsilon keeps near-parallel edge pairs from inventing a separating axis.
 */
function boxHitsAabb(p: PropBox, m: Float64Array, cx: number, cy: number, cz: number, ax: number, ay: number, az: number): boolean {
  const E = 1e-6;
  const tx = p.x - cx, ty = p.y - cy, tz = p.z - cz, bx = p.hx, by = p.hy, bz = p.hz;
  const r00 = m[0], r01 = m[1], r02 = m[2], r10 = m[3], r11 = m[4], r12 = m[5], r20 = m[6], r21 = m[7], r22 = m[8];
  const a00 = Math.abs(r00) + E, a01 = Math.abs(r01) + E, a02 = Math.abs(r02) + E;
  const a10 = Math.abs(r10) + E, a11 = Math.abs(r11) + E, a12 = Math.abs(r12) + E;
  const a20 = Math.abs(r20) + E, a21 = Math.abs(r21) + E, a22 = Math.abs(r22) + E;
  // the world axes (the cell's faces)
  if (Math.abs(tx) > ax + bx * a00 + by * a01 + bz * a02) return false;
  if (Math.abs(ty) > ay + bx * a10 + by * a11 + bz * a12) return false;
  if (Math.abs(tz) > az + bx * a20 + by * a21 + bz * a22) return false;
  // the box's axes
  if (Math.abs(tx * r00 + ty * r10 + tz * r20) > ax * a00 + ay * a10 + az * a20 + bx) return false;
  if (Math.abs(tx * r01 + ty * r11 + tz * r21) > ax * a01 + ay * a11 + az * a21 + by) return false;
  if (Math.abs(tx * r02 + ty * r12 + tz * r22) > ax * a02 + ay * a12 + az * a22 + bz) return false;
  // world axis i x box axis j
  if (Math.abs(tz * r10 - ty * r20) > ay * a20 + az * a10 + by * a02 + bz * a01) return false;
  if (Math.abs(tz * r11 - ty * r21) > ay * a21 + az * a11 + bx * a02 + bz * a00) return false;
  if (Math.abs(tz * r12 - ty * r22) > ay * a22 + az * a12 + bx * a01 + by * a00) return false;
  if (Math.abs(tx * r20 - tz * r00) > ax * a20 + az * a00 + by * a12 + bz * a11) return false;
  if (Math.abs(tx * r21 - tz * r01) > ax * a21 + az * a01 + bx * a12 + bz * a10) return false;
  if (Math.abs(tx * r22 - tz * r02) > ax * a22 + az * a02 + bx * a11 + by * a10) return false;
  if (Math.abs(ty * r00 - tx * r10) > ax * a10 + ay * a00 + by * a22 + bz * a21) return false;
  if (Math.abs(ty * r01 - tx * r11) > ax * a11 + ay * a01 + bx * a22 + bz * a20) return false;
  if (Math.abs(ty * r02 - tx * r12) > ax * a12 + ay * a02 + bx * a21 + by * a20) return false;
  return true;
}

/**
 * W10 N3: the cells of a ground grid (its lattice and per-cell ground) that a thin obstacle of the world crosses at body
 * height: the obstacle's solid intersects the cell's column from THIN_FLOOR over the cell's ground to the probe's top.
 * Sorted cell indices (interior cells only: the border never walks).
 */
export function thinObstacleCells(data: WorldData, g: Pick<NavGrid, 'ox' | 'oz' | 'cell' | 'w' | 'h' | 'ground'>): Int32Array {
  const lo = THIN_FLOOR, hi = CLEARANCE + 2 * (PROBE_RADIUS + PROBE_HALF);
  const half = g.cell / 2, midY = (lo + hi) / 2, bandHalf = (hi - lo) / 2;
  const hit = new Uint8Array(g.w * g.h);
  const cells: number[] = [];
  const m = new Float64Array(9);
  /** Cell range of an AABB (interior cells), visiting each cell whose column the AABB reaches vertically. */
  const scan = (a: Aabb, test: (x: number, z: number, gy: number) => boolean): void => {
    const ix0 = Math.max(1, Math.floor((a.x0 - g.ox) / g.cell)), ix1 = Math.min(g.w - 2, Math.floor((a.x1 - g.ox) / g.cell));
    const iz0 = Math.max(1, Math.floor((a.z0 - g.oz) / g.cell)), iz1 = Math.min(g.h - 2, Math.floor((a.z1 - g.oz) / g.cell));
    for (let iz = iz0; iz <= iz1; iz++) for (let ix = ix0; ix <= ix1; ix++) {
      const i = iz * g.w + ix;
      if (hit[i]) continue;
      const gy = g.ground[i];
      if (a.y1 < gy + lo || a.y0 > gy + hi) continue;
      if (test(g.ox + (ix + 0.5) * g.cell, g.oz + (iz + 0.5) * g.cell, gy)) { hit[i] = 1; cells.push(i); }
    }
  };
  for (const p of data.props) {
    if (!isThinBox(p)) continue;
    scan(boxAabb(p, m), (x, z, gy) => boxHitsAabb(p, m, x, gy + midY, z, half, bandHalf, half));
  }
  for (const c of data.cylinders ?? []) {
    if (!isThinCylinder(c)) continue;
    scan({ x0: c.x - c.r, x1: c.x + c.r, z0: c.z - c.r, z1: c.z + c.r, y0: c.y - c.hh, y1: c.y + c.hh }, (x, z) => {
      const dx = Math.max(0, Math.abs(c.x - x) - half), dz = Math.max(0, Math.abs(c.z - z) - half);
      return dx * dx + dz * dz < c.r * c.r;
    });
  }
  return Int32Array.from(cells).sort();
}

/** Static-world collider count and the terrain collider (trimesh or heightfield), if any. Only buildStaticWorld's
 *  colliders are static (D1): destructibles (X1: setNavBlocker) and kiosks (setNavFixture) close their cells per sim. */
function staticColliders(sim: Sim): { count: number; terrain: Collider | undefined } {
  let count = 0, terrain: Collider | undefined;
  sim.world.forEachCollider((c) => {
    if (((c.collisionGroups() >>> 16) & Layer.World) === 0 || !isStaticWorldCollider(c)) return;
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

/** Probe filter of the shared grids (ground and decks): the static world only, never a sim's own colliders (D1). */
const staticWorldOnly = (c: Collider): boolean => isStaticWorldCollider(c);

export function buildNavGrid(sim: Sim, thinPass = true): NavGrid {
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
  // this code doesn't know about, every cell is queried (always correct, just slower). D1: kiosks used to count
  // as such in every room (so every cell was queried, ~200 ms); the probe only sees the static world now.
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
        if (sim.world.intersectionWithShape(pos, rot, shape, undefined, WORLD_RAY_FILTER, exact ? undefined : statics.terrain, undefined, staticWorldOnly)) continue;
      }
      walk[i] = 1;
      walkable++;
      if (inWater(data, x, z)) cost[i] = 3;
      if (onPad(data, x, z)) cost[i] = 6;
    }
  }
  // W10 N3: thin obstacles close every cell they cross at body height (the probe above saw them at cell centres only;
  // W11 F3: not for Base Assault on the West Yard, thinPassFor)
  let thin = 0;
  if (thinPass) for (const i of thinObstacleCells(data, { ox, oz, cell, w, h, ground })) if (walk[i]) { walk[i] = 0; walkable--; thin++; }
  const grid: NavGrid = {
    cell, ox, oz, w, h, walk, ground, cost, region: new Int32Array(n).fill(-1), regionSize: [], mainRegion: -1,
    buildMs: 0, walkable, queries, thin,
    g: new Float32Array(n), parent: new Int32Array(n), open: new Uint32Array(n), closed: new Uint32Array(n),
    heap: new Int32Array(heapCap(n)), heapF: new Float32Array(heapCap(n)), search: 0,
  };
  labelRegions(grid);
  grid.buildMs = performance.now() - t0;
  return grid;
}

/** A* heap entries a grid of n cells can need (every expansion pushes at most 8). */
function heapCap(n: number): number {
  return Math.min(HEAP_CAP, n * 8 + 64);
}

// ------------------------------------------------------------------------------------------------- N1 decks

/** Max surface height change between neighbouring deck cells: a parapet (0.6 m) is a wall, a 24° roof slope is not. */
export const DECK_STEP = 0.5;
/** A deck cell stands at least this high over the terrain (lower surfaces belong to the ground grid). */
const DECK_MIN_RISE = 0.9;
/** Deck floods stop at this many cells from the seed (per axis). */
const DECK_MAX_HALF = 48;

/**
 * N1: flood the elevated walkable surface under (x, y, z) into its own NavGrid (cells on the ground grid's lattice,
 * bounding box only; ground = surface height). A cell is walkable when its highest surface within DECK_STEP of a
 * walkable neighbour's stands > DECK_MIN_RISE over the terrain, the slope is walkable and the character probe
 * (the ground grid's capsule) is clear of the static world. Null when (x, y, z) is not on such a surface.
 */
export function buildDeckGrid(sim: Sim, x: number, y: number, z: number): NavGrid | null {
  const t0 = performance.now();
  const data = sim.worldData;
  const cell = NAV_CELL, half = data.halfExtent;
  const gx0 = -half, gz0 = -half, gw = Math.ceil((2 * half) / cell);
  const sx = Math.floor((x - gx0) / cell), sz = Math.floor((z - gz0) / cell);
  if (sx < 1 || sz < 1 || sx >= gw - 1 || sz >= gw - 1) return null;
  const shape = new sim.R.Capsule(PROBE_HALF, PROBE_RADIUS);
  const rot = { x: 0, y: 0, z: 0, w: 1 }, pos = { x: 0, y: 0, z: 0 };
  let queries = 0;
  const cx = (ix: number) => gx0 + (ix + 0.5) * cell, cz = (iz: number) => gz0 + (iz + 0.5) * cell;
  /** Surface height of the cell reachable from a neighbour at height `from`, or NaN. */
  const standAt = (ix: number, iz: number, from: number): number => {
    const px = cx(ix), pz = cz(iz);
    const s = surfaceAt(data, px, pz, from + DECK_STEP);
    if (s.kind === 'terrain' || Math.abs(s.y - from) > DECK_STEP || s.y - data.height(px, pz) < DECK_MIN_RISE) return NaN;
    // something solid sitting on that surface (a parapet's cap on its body) makes the real top higher: not a floor
    if (surfaceAt(data, px, pz, s.y + 1.2).y > s.y + 0.02) return NaN;
    // floor under the whole footprint, not the top of a thin wall (a parapet reached over a stack of shingles): no
    // corner may drop away (rises are the probe's business)
    for (let q = 0; q < 4; q++) {
      const fx = px + (q & 1 ? 0.25 : -0.25), fz = pz + (q & 2 ? 0.25 : -0.25);
      if (surfaceAt(data, fx, fz, s.y + 0.2).y < s.y - 0.15) return NaN;
    }
    queries++;
    pos.x = px; pos.y = s.y + CLEARANCE + PROBE_RADIUS + PROBE_HALF; pos.z = pz;
    if (sim.world.intersectionWithShape(pos, rot, shape, undefined, WORLD_RAY_FILTER, undefined, undefined, staticWorldOnly)) return NaN;
    return s.y;
  };
  const seedY = surfaceAt(data, cx(sx), cz(sz), y + 0.35).y;
  const heights = new Map<number, number>();
  const key = (ix: number, iz: number) => iz * gw + ix;
  const h0 = Math.abs(seedY - y) < DECK_STEP ? standAt(sx, sz, seedY) : NaN;
  if (!Number.isFinite(h0)) return null;
  heights.set(key(sx, sz), h0);
  const queue = [key(sx, sz)];
  for (let q = 0; q < queue.length; q++) {
    const k = queue[q], ix = k % gw, iz = (k - ix) / gw, hy = heights.get(k)!;
    for (let d = 0; d < 4; d++) {
      const nx = ix + DX[d], nz = iz + DZ[d];
      if (Math.abs(nx - sx) > DECK_MAX_HALF || Math.abs(nz - sz) > DECK_MAX_HALF || nx < 1 || nz < 1 || nx >= gw - 1 || nz >= gw - 1) continue;
      const nk = key(nx, nz);
      if (heights.has(nk)) continue;
      const ny = standAt(nx, nz, hy);
      heights.set(nk, ny);          // NaN = tested, not walkable
      if (Number.isFinite(ny)) queue.push(nk);
    }
  }
  let ix0 = Infinity, ix1 = -Infinity, iz0 = Infinity, iz1 = -Infinity;
  for (const k of queue) { const ix = k % gw, iz = (k - ix) / gw; ix0 = Math.min(ix0, ix); ix1 = Math.max(ix1, ix); iz0 = Math.min(iz0, iz); iz1 = Math.max(iz1, iz); }
  // one blocked cell of margin, so the neighbour rules never index outside
  ix0--; iz0--; ix1++; iz1++;
  const w = ix1 - ix0 + 1, h = iz1 - iz0 + 1, n = w * h;
  const walk = new Uint8Array(n), ground = new Float32Array(n).fill(h0), cost = new Uint8Array(n).fill(1);
  for (const k of queue) {
    const ix = k % gw, iz = (k - ix) / gw, i = (iz - iz0) * w + (ix - ix0);
    walk[i] = 1; ground[i] = heights.get(k)!;
  }
  // slope check (the ground grid's rule) on the flooded surface
  let walkable = 0;
  for (let i = 0; i < n; i++) {
    if (!walk[i]) continue;
    const ix = i % w, iz = (i - ix) / w;
    const gxp = ix + 1 < w && walk[i + 1] ? ground[i + 1] : ground[i], gxm = ix > 0 && walk[i - 1] ? ground[i - 1] : ground[i];
    const gzp = iz + 1 < h && walk[i + w] ? ground[i + w] : ground[i], gzm = iz > 0 && walk[i - w] ? ground[i - w] : ground[i];
    const ax = (gxp - gxm) / (2 * cell), az = (gzp - gzm) / (2 * cell);
    if (ax * ax + az * az > MAX_SLOPE * MAX_SLOPE) { walk[i] = 0; continue; }
    walkable++;
  }
  const grid: NavGrid = {
    cell, ox: gx0 + ix0 * cell, oz: gz0 + iz0 * cell, w, h, walk, ground, cost, region: new Int32Array(n).fill(-1), regionSize: [], mainRegion: -1,
    buildMs: 0, walkable, queries, thin: 0,
    g: new Float32Array(n), parent: new Int32Array(n), open: new Uint32Array(n), closed: new Uint32Array(n),
    heap: new Int32Array(heapCap(n)), heapF: new Float32Array(heapCap(n)), search: 0,
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

let labelQueue = new Int32Array(0);
/** Connected components under neighbour()'s rules (inlined: X1 relabels a sim's grid on resets). */
function labelRegions(g: NavGrid): void {
  const w = g.w, h = g.h, walk = g.walk, ground = g.ground, region = g.region;
  if (labelQueue.length < w * h) labelQueue = new Int32Array(w * h);
  const queue = labelQueue;
  let id = 0, best = -1, bestSize = 0;
  for (let s = 0; s < walk.length; s++) {
    if (!walk[s] || region[s] >= 0) continue;
    let head = 0, tail = 0;
    queue[tail++] = s; region[s] = id;
    while (head < tail) {
      const i = queue[head++];
      const ix = i % w, iz = (i - ix) / w, gi = ground[i];
      for (let k = 0; k < 8; k++) {
        const nx = ix + DX[k], nz = iz + DZ[k];
        if (nx < 0 || nz < 0 || nx >= w || nz >= h) continue;
        const j = nz * w + nx;
        if (!walk[j] || region[j] >= 0) continue;
        const dg = ground[j] - gi;
        if (dg > MAX_STEP || dg < -MAX_STEP) continue;
        if (k >= 4 && (!walk[iz * w + nx] || !walk[nz * w + ix])) continue;
        region[j] = id; queue[tail++] = j;
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
  const c = cellIndex(g, Math.max(g.ox, Math.min(g.ox + g.w * g.cell - 0.01, x)), Math.max(g.oz, Math.min(g.oz + g.h * g.cell - 0.01, z)));
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

/** Search stamp shared by every grid (per-sim X1 copies share the A* scratch arrays with their shared grid). */
let searchSeq = 0;

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
  const id = ++searchSeq;
  g.search = id;
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
