// N1 nav links: bots climb. A small link layer over the 1 m ground grid (nav.ts):
//
//   decks   elevated walkable surfaces, each flooded into its own small NavGrid (nav.ts buildDeckGrid) from a seed:
//           a climb route's end or a sniper perch. On the West Yard: the garage roof (7.2 m, inside the parapet) and
//           the crow's nest platform (9.6 m). The lean-to roof, the crates and the scaffold planks are standing points
//           inside the routes, not decks.
//   links   hop sequences between grids: a list of legs, each a standing point to land on. Derived from
//             - the Rooftops climb routes (ROOF_ROUTES, D3): ground -> crates/scaffold -> roof, and back down;
//             - stepping stones up to a perch above its deck (roof -> AC unit -> crow's nest), found geometrically;
//             - drops: off a deck's edge (over the parapet) onto open ground or a lower deck, spread along the edge.
//           Jump pads add none: no West Yard pad launches onto a deck (the Corgi porch deck by the mini trampoline is
//           reached by its stairs and is not a nav deck yet; a route list entry would make it one).
//   profile validation
//           every link is run once per movement profile (MoveStats: species x class kit x archetype speed) with the
//           REAL stepCharacter + stepWorldEffects in a scratch Rapier world (the static world around the links, the
//           terrain cropped to it: a few ms to build), leg by leg, with the same controller the brain uses (legStep).
//           For each leg the first input variant (walk / jump at once / jump near / jump + double jump, speed) that
//           lands is kept; a link with a leg no variant lands is dropped for that profile. No world.step() per tick
//           (static world, the controller skips its own collider); ai-nav-links.test.ts replays every validated link
//           in a real Sim. ~2.6 k scratch ticks, 45-100 ms per profile, once per world and profile, on first need.
//   planning
//           nodes = (grid, region). Same node: the plain grid A* (unchanged, as fast as before). Else a label-correcting
//           search over the (few) links finds the cheapest chain; the bot walks to the first link's entry and runs it.
//   runtime (brain.ts)
//           a link runs leg by leg (legStep: steer to the next standing point, jump / double jump at the validated
//           distance, air-steer onto it, settle). A missed hop (fell below the leg, or no progress in 2 s) retries
//           once; a second miss marks the link costly for that bot for 30 s (it falls back to the other route, or
//           gives the elevated goal up). Getting shot on a link (contested) aborts it and marks it costly for 20 s.
//
// Deterministic: decks, links and validations are pure functions of the world and the profile (a lazily built cache
// never changes results, only wall time). No Math.random. D1: "the world" is the static world only (nav.ts builds the
// ground and deck grids from buildStaticWorld's colliders, the validation scratch world from WorldData); a sim's own
// fixtures (the Rooftop Hangar kiosk on the roof) close deck cells in that sim's VIEW of the set (navLinksFor: the
// decks from deckGridFor, links / profiles / scratch world shared).
import type { KinematicCharacterController, World } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { SimEntity } from '../entity';
import type { MoveStats } from '../../shared/content/classes';
import type { PropBox, PropCylinder, TerrainGrid, WorldData } from '../../shared/world/world-data';
import { ROOF_ROUTES } from '../../shared/world/garage';
import { surfaceAt } from '../../shared/world/queries';
import { Btn, emptyInput } from '../../shared/input';
import { Anim } from '../../shared/types';
import { GRAVITY, TICK_DT } from '../../shared/constants';
import { CHARACTER_GROUPS } from '../rapier';
import { buildStaticWorld } from '../world/build';
import { baseMoveStats, stepWorldEffects } from '../world/systems';
import { stepCharacter } from '../systems/movement';
import { type NavGrid, buildDeckGrid, cellIndex, cellX, cellZ, deckGridFor, navFixtureVersion, navGridFor, nearestWalkable, sharedNavGrid } from './nav';

export interface P3 { x: number; y: number; z: number }

export type LinkKind = 'climb' | 'descend' | 'stone' | 'drop';

export interface NavLink {
  id: number;
  name: string;
  kind: LinkKind;
  /** Entry standing point (on grid `fromGrid`) and exit (on `toGrid`): grid 0 = the ground grid, k = decks[k - 1]. */
  from: P3; to: P3;
  fromGrid: number; toGrid: number;
  /** Cells of the endpoints in their grids (regions are looked up live: the ground grid's change with X1 blockers). */
  fromCell: number; toCell: number;
  /** Standing points after `from`; the last one is `to`. */
  legs: P3[];
  /** Length along the legs (m) + a climb surcharge: the planner's cost. */
  cost: number;
}

/** How a leg is run: 0 walk (no jump), 1 jump, 2 jump + double jump at the apex; jump when this close (m, horizontal;
 *  Infinity = at once); stick magnitude (fraction of the run speed). */
export interface LegParams { jump: 0 | 1 | 2; jumpAt: number; speed: number }

export interface ProfileLinks {
  key: string;
  /** Validated input variant per leg, or null when a leg of the link never lands for this profile. */
  params: (LegParams[] | null)[];
  /** Validation cost (ms) and scratch ticks simulated. */
  ms: number; ticks: number;
}

export interface NavLinkSet {
  decks: NavGrid[];
  links: NavLink[];
  profiles: Map<string, ProfileLinks>;
  buildMs: number;
  scratch: Scratch | null;
}

// ------------------------------------------------------------------------------------------------ tuning

/** Leg done: grounded within this (m, horizontal) of the standing point and within ARRIVE_DY of its height (a capsule
 *  hanging on an edge sits lower than that). */
const ARRIVE_R = 0.6;
const ARRIVE_DY = 0.2;
/** A leg without 0.25 m of progress for this many ticks is a miss (2 s). */
const NO_PROGRESS_TICKS = 120;
/** Link cost surcharge per metre climbed / dropped (a climb is slower than a walk). */
const CLIMB_COST = 2.5;
const DROP_COST = 0.6;
/** Planner: a link marked costly after two misses (s, extra m) / after the bot got shot on it. */
export const MISS_PENALTY = { seconds: 30, cost: 150 };
export const CONTEST_PENALTY = { seconds: 20, cost: 100 };
/** Validation gives a variant up after this many ticks without progress (bots allow NO_PROGRESS_TICKS). */
const VALIDATE_STALL = 45;
/** Drop links per deck (spread along its edge). */
const DROPS_PER_DECK = 6;

// ------------------------------------------------------------------------------------------------ set build

const sets = new WeakMap<NavGrid, NavLinkSet | null>();
/** D1: a sim's view of its world's set (its own decks; everything else is the shared set's), and the shared set of a
 *  view (profiles and the validation scratch world live there). */
const views = new WeakMap<Sim, { set: NavLinkSet; version: number; view: NavLinkSet }>();
const sharedOf = new WeakMap<NavLinkSet, NavLinkSet>();

/** The link set of a sim's world if it was built already (no build), as this sim sees it. */
export function navLinksIfBuilt(sim: Sim): NavLinkSet | null {
  const set = sets.get(sharedNavGrid(sim)) ?? null;
  return set && viewFor(sim, set);
}

/**
 * The link set of a sim's world, built on first use (decks + links, not yet validated), cached per world, as this sim
 * sees it (viewFor). Null for worlds without climbable routes. Needs Rapier's query structures (after the first
 * physics step).
 */
export function navLinksFor(sim: Sim): NavLinkSet | null {
  const base = sharedNavGrid(sim);
  let set = sets.get(base);
  if (set === undefined) {
    set = buildLinkSet(sim, base);
    sets.set(base, set);
  }
  return set && viewFor(sim, set);
}

/** The shared set itself when none of the sim's fixtures touches a deck, else a copy with this sim's decks (cached
 *  per sim until its fixtures change). Links, the profiles map and the scratch world are the shared set's. */
function viewFor(sim: Sim, set: NavLinkSet): NavLinkSet {
  const version = navFixtureVersion(sim);
  const v = views.get(sim);
  if (v && v.set === set && v.version === version) return v.view;
  const decks = set.decks.map((d) => deckGridFor(sim, d));
  let view = set;
  if (decks.some((d, k) => d !== set.decks[k])) {
    view = { ...set, decks };
    sharedOf.set(view, set);
  }
  views.set(sim, { set, version, view });
  return view;
}

function buildLinkSet(sim: Sim, g0: NavGrid): NavLinkSet | null {
  const t0 = performance.now();
  const data = sim.worldData;
  const set: NavLinkSet = { decks: [], links: [], profiles: new Map(), buildMs: 0, scratch: null };
  /** Deck index + 1 holding (x, y, z), building a new deck from it if none does; 0 when not on a deck. */
  const deckOf = (x: number, y: number, z: number): number => {
    for (let k = 0; k < set.decks.length; k++) if (onDeck(set.decks[k], x, y, z)) return k + 1;
    const d = buildDeckGrid(sim, x, y, z);
    if (!d || !onDeck(d, x, y, z)) return 0;
    set.decks.push(d);
    return set.decks.length;
  };
  const groundCell = (x: number, y: number, z: number): number => {
    const c = nearestWalkable(g0, x, z, 1);
    return c >= 0 && Math.abs(g0.ground[c] - y) < 0.6 ? c : -1;
  };
  const cellOf = (grid: number, p: P3): number => (grid === 0 ? groundCell(p.x, p.y, p.z) : deckCell(set.decks[grid - 1], p.x, p.y, p.z));
  const add = (name: string, kind: LinkKind, pts: P3[], fromGrid: number, toGrid: number): void => {
    const from = pts[0], to = pts[pts.length - 1];
    const fromCell = cellOf(fromGrid, from), toCell = cellOf(toGrid, to);
    if (fromCell < 0 || toCell < 0) return;
    let cost = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dy = b.y - a.y;
      cost += Math.hypot(b.x - a.x, b.z - a.z) + (dy > 0 ? dy * CLIMB_COST : -dy * DROP_COST);
    }
    set.links.push({ id: set.links.length, name, kind, from, to, fromGrid, toGrid, fromCell, toCell, legs: pts.slice(1), cost });
  };

  // 1. the Rooftops climb routes (ground -> roof) and the same standing points back down
  const onThisWorld = (pts: readonly (readonly [number, number, number])[]) =>
    pts.every(([x, y, z]) => Math.abs(surfaceAt(data, x, z, y + 0.5).y - y) < 0.15);
  if (data.districts?.some((d) => d.id === 'rooftops')) {
    for (const [name, raw] of Object.entries(ROOF_ROUTES)) {
      if (!onThisWorld(raw)) continue;
      const pts = raw.map(([x, y, z]) => ({ x, y, z }));
      const top = pts[pts.length - 1];
      const deck = deckOf(top.x, top.y, top.z);
      if (!deck || groundCell(pts[0].x, pts[0].y, pts[0].z) < 0) continue;
      add(`${name} climb`, 'climb', pts, 0, deck);
      add(`${name} descent`, 'descend', pts.slice().reverse(), deck, 0);
    }
  }
  if (!set.decks.length) { set.buildMs = performance.now() - t0; return null; }

  // 2. perches: on a deck the routes reach, or a stepping stone up from one (roof -> AC unit -> crow's nest)
  for (const p of data.perches ?? []) {
    const deck = deckOf(p.x, p.y, p.z);
    if (!deck || set.links.some((l) => l.toGrid === deck)) continue;
    stoneLinks(sim, set, deck, p, add);
  }

  // 3. drops off every deck's edge onto the ground or a lower deck (the way down when no route is near)
  for (let k = 0; k < set.decks.length; k++) dropLinks(sim, set, g0, k + 1, add);

  set.buildMs = performance.now() - t0;
  return set;
}

/** Is (x, y, z) standing on deck d (a walkable cell within 0.8 m of its surface)? */
function onDeck(d: NavGrid, x: number, y: number, z: number): boolean {
  return deckCell(d, x, y, z) >= 0;
}

/** Walkable cell of deck d under (x, y, z) (or its nearest walkable neighbour), or -1. */
function deckCell(d: NavGrid, x: number, y: number, z: number): number {
  if (x < d.ox - 1 || z < d.oz - 1 || x > d.ox + d.w * d.cell + 1 || z > d.oz + d.h * d.cell + 1) return -1;
  let c = cellIndex(d, x, z);
  if (c < 0 || !d.walk[c]) c = nearestWalkable(d, x, z, 1);
  return c >= 0 && Math.abs(d.ground[c] - y) < 0.8 ? c : -1;
}

type AddLink = (name: string, kind: LinkKind, pts: P3[], fromGrid: number, toGrid: number) => void;

/**
 * A perch on a deck no route reaches (the crow's nest over the roof): find a stepping stone — a standable surface
 * within 5 m of it, at most one hop (1.35 m) below the perch and above a lower deck's cell within 3.5 m — and link
 * lower deck -> stone -> perch and back. Candidates are ranked by path length; validation keeps the ones that land.
 */
function stoneLinks(sim: Sim, set: NavLinkSet, deck: number, p: P3, add: AddLink): void {
  const data = sim.worldData;
  const top = set.decks[deck - 1];
  const cands: { s: P3; from: P3; lower: number; score: number }[] = [];
  for (let dx = -5; dx <= 5; dx += 0.5) for (let dz = -5; dz <= 5; dz += 0.5) {
    const x = p.x + dx, z = p.z + dz;
    const s = surfaceAt(data, x, z, p.y - 0.4);
    if (s.kind === 'terrain' || p.y - s.y > 1.35 || onDeck(top, x, s.y, z)) continue;
    if (!standable(data, x, s.y, z)) continue;
    // the lower deck cell to hop from: 1.5-3.5 m away, at most 1.35 m below the stone
    for (let k = 0; k < set.decks.length; k++) {
      if (k + 1 === deck) continue;
      const d = set.decks[k];
      let best = -1, bd = Infinity;
      for (let i = 0; i < d.walk.length; i++) {
        if (!d.walk[i]) continue;
        const cx = cellX(d, i), cz = cellZ(d, i), h = Math.hypot(cx - x, cz - z), dy = s.y - d.ground[i];
        if (h < 1.5 || h > 3.5 || dy < 0.5 || dy > 1.35) continue;
        if (h < bd) { bd = h; best = i; }
      }
      if (best < 0) continue;
      const from = { x: cellX(d, best), y: d.ground[best], z: cellZ(d, best) };
      cands.push({ s: { x, y: s.y, z }, from, lower: k + 1, score: bd + Math.hypot(p.x - x, p.z - z) });
    }
  }
  cands.sort((a, b) => a.score - b.score);
  // a few spread-out candidates (validation drops the ones that don't land for a profile)
  const kept: typeof cands = [];
  for (const c of cands) {
    if (kept.some((k) => Math.hypot(k.s.x - c.s.x, k.s.z - c.s.z) < 1.2)) continue;
    kept.push(c);
    if (kept.length >= 3) break;
  }
  for (const [i, c] of kept.entries()) {
    add(`stone ${i} up`, 'stone', [c.from, c.s, { x: p.x, y: p.y, z: p.z }], c.lower, deck);
    add(`stone ${i} down`, 'stone', [{ x: p.x, y: p.y, z: p.z }, c.s, c.from], deck, c.lower);
  }
}

/** A character can stand at feet (x, y, z): floor under its whole footprint (not on an edge) and nothing solid in its
 *  body (checked on a ring a bit wider than the widest capsule). */
function standable(data: WorldData, x: number, y: number, z: number): boolean {
  if (surfaceAt(data, x, z, y + 1.5).y > y + 0.05) return false;
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2, px = x + Math.cos(a) * 0.5, pz = z + Math.sin(a) * 0.5;
    const top = surfaceAt(data, px, pz, y + 1.5).y;
    if (top > y + 0.05 || top < y - 0.05) return false;
  }
  return true;
}

/**
 * Drops off deck k's edge: edge cells (walkable, with an unwalkable 4-neighbour) spread out along the edge; from each,
 * the landing is the first point outward (1.2-5 m) whose surface is a walkable cell of the ground grid or of a lower
 * deck. A leg jumps when something (a parapet) stands between the edge and the landing; validation decides.
 */
function dropLinks(sim: Sim, set: NavLinkSet, g0: NavGrid, k: number, add: AddLink): void {
  const data = sim.worldData;
  const d = set.decks[k - 1];
  const edges: { i: number; nx: number; nz: number }[] = [];
  for (let i = 0; i < d.walk.length; i++) {
    if (!d.walk[i]) continue;
    let nx = 0, nz = 0;
    for (const [ox, oz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const j = i + oz * d.w + ox;
      if (!d.walk[j]) { nx += ox; nz += oz; }
    }
    const l = Math.hypot(nx, nz);
    if (l > 0) edges.push({ i, nx: nx / l, nz: nz / l });
  }
  const found: { from: P3; to: P3; grid: number }[] = [];
  for (const e of edges) {
    const fx = cellX(d, e.i), fz = cellZ(d, e.i), fy = d.ground[e.i];
    for (let t = 1.2; t <= 5; t += 0.4) {
      const x = fx + e.nx * t, z = fz + e.nz * t;
      const s = surfaceAt(data, x, z, fy - 0.8);
      let grid = -1, cellY = 0;
      for (let j = 0; j < set.decks.length && grid < 0; j++) {
        if (j + 1 === k) continue;
        const dj = set.decks[j], c = cellIndex(dj, x, z);
        // a lower deck: the cell and its 4 neighbours walkable (open floor, not the foot of a wall or a unit)
        if (c < 0 || !dj.walk[c] || Math.abs(dj.ground[c] - s.y) > 0.3 || dj.ground[c] > fy - 0.8) continue;
        if (!dj.walk[c + 1] || !dj.walk[c - 1] || !dj.walk[c + dj.w] || !dj.walk[c - dj.w]) continue;
        grid = j + 1; cellY = dj.ground[c];
      }
      if (grid < 0 && s.kind === 'terrain') {
        // open ground: this cell and its 8 neighbours walkable in the main region (not right against the wall)
        const c = cellIndex(g0, x, z);
        let open = c >= 0 && g0.walk[c] === 1 && g0.region[c] === g0.mainRegion;
        for (let q = 0; q < 8 && open; q++) {
          const j = c + [1, -1, g0.w, -g0.w, g0.w + 1, g0.w - 1, -g0.w + 1, -g0.w - 1][q];
          if (!g0.walk[j]) open = false;
        }
        if (open) { grid = 0; cellY = g0.ground[c]; }
      }
      if (grid < 0) continue;
      found.push({ from: { x: fx, y: fy, z: fz }, to: { x, y: cellY, z }, grid });
      break;
    }
  }
  // spread them along the edge: farthest-point sampling from the first one (every side gets a way down)
  const picked: typeof found = [];
  while (found.length && picked.length < DROPS_PER_DECK) {
    let bi = 0, bd = -1;
    for (let i = 0; i < found.length; i++) {
      let dmin = Infinity;
      for (const q of picked) dmin = Math.min(dmin, Math.hypot(q.from.x - found[i].from.x, q.from.z - found[i].from.z));
      if (!picked.length) dmin = 0;
      if (dmin > bd) { bd = dmin; bi = i; }
    }
    if (picked.length && bd < 4) break;
    picked.push(found.splice(bi, 1)[0]);
  }
  for (const [i, f] of picked.entries()) add(`drop ${k}.${i}`, 'drop', [f.from, f.to], k, f.grid);
}

// ------------------------------------------------------------------------------------------------ leg controller

/** Per-leg runtime state (the brain keeps one per bot; the validator one per run). */
export interface LegRun {
  t: number;
  jumped: boolean;
  held: boolean;
  best: number;
  bestT: number;
  settle: number;
  landedT: number;
}

export function newLegRun(): LegRun {
  return { t: 0, jumped: false, held: false, best: Infinity, bestT: 0, settle: 0, landedT: -1 };
}

export function resetLegRun(r: LegRun): void {
  r.t = 0; r.jumped = false; r.held = false; r.best = Infinity; r.bestT = 0; r.settle = 0; r.landedT = -1;
}

/** Controller output: world-space stick (|x, z| <= 1, fraction of the run speed) and buttons (Jump only). */
export interface LegOut { x: number; z: number; buttons: number }

/**
 * One tick of a leg from `from` to the standing point `to` with input variant `p`. Writes the stick + buttons into
 * `out`; returns 0 (going), 1 (landed and settled on `to`) or -1 (missed: fell below the leg, or no progress for 2 s).
 * The same code drives validation (scratch world) and bots (brain.ts), so a validated leg is what a bot runs.
 */
export function legStep(e: SimEntity, from: P3, to: P3, p: LegParams, r: LegRun, out: LegOut, stall = NO_PROGRESS_TICKS): 0 | 1 | -1 {
  const c = e.char!, m = c.move;
  const dx = to.x - e.pos.x, dz = to.z - e.pos.z;
  const d = Math.hypot(dx, dz), dy = to.y - e.pos.y;
  const hs = Math.hypot(e.vel.x, e.vel.z);
  r.t++;
  out.x = 0; out.z = 0; out.buttons = 0;
  if (c.grounded && Math.abs(dy) < ARRIVE_DY && d < ARRIVE_R) {
    // on the standing point: brake to a stop (the next leg starts from rest, like its validation)
    r.settle++;
    r.held = false;
    return hs < 1.0 || r.settle > 15 ? 1 : 0;
  }
  r.settle = 0;
  if (c.grounded && e.pos.y < Math.min(from.y, to.y) - 0.6) return -1;           // fell off the route
  const prog = d + Math.max(0, dy) * 1.5;
  if (prog < r.best - 0.25) { r.best = prog; r.bestT = r.t; } else if (r.t - r.bestT > stall) return -1;
  // steering: on the ground, head for the point braking so the character stops on it (arrive); in the air, full
  // speed while still below the point (get over the edge), else the speed that reaches it as the fall lands
  const cap = p.speed;
  let k: number;
  if (c.grounded) k = Math.min(cap, (Math.sqrt(2 * m.groundDecel * Math.max(0, d - 0.12)) * 0.8) / m.runSpeed);
  else if (e.pos.y < to.y - 0.1) k = cap;
  else {
    const g = -GRAVITY * m.fallGravityScale, h = e.pos.y - to.y, vy = e.vel.y;
    const t = (vy + Math.sqrt(Math.max(0, vy * vy + 2 * g * h))) / g;
    k = Math.min(cap, d / Math.max(0.08, t) / m.runSpeed);
  }
  if (d < 0.12) k = 0;
  let ux = d > 1e-3 ? dx / d : 0, uz = d > 1e-3 ? dz / d : 0;
  if (c.grounded && dy < -0.4) {
    // the point is well below: keep walking off the ledge (the point may sit at the foot of the wall under it)
    if (d < 0.3) {
      const fx = to.x - from.x, fz = to.z - from.z, fl = Math.hypot(fx, fz);
      if (fl > 1e-3) { ux = fx / fl; uz = fz / fl; }
    }
    k = Math.max(k, Math.min(cap, 0.55));
  }
  out.x = ux * k; out.z = uz * k;
  // jumping: hold Jump while rising (a full-height jump; brushing a wall can read as grounded mid-jump, and letting
  // go there would halve the jump), let go near the apex so a second press registers
  if (r.held) {
    if (e.vel.y > 0.8) { out.buttons = Btn.Jump; return 0; }
    r.held = false;
  }
  if (c.grounded) {
    if (r.jumped && r.landedT < 0) r.landedT = r.t;
    // landed short (below the point after a jump): jump again after a breath
    if (r.jumped && dy > 0.3 && r.t - r.landedT > 8) { r.jumped = false; }
    if (!r.jumped && p.jump > 0 && d <= p.jumpAt) {
      r.jumped = true; r.held = true; r.landedT = -1;
      out.buttons = Btn.Jump;
      return 0;
    }
    r.held = false;
    return 0;
  }
  r.landedT = -1;
  const canDouble = c.jumpsUsed === 1 && m.doubleJumpVelocity > 0 && !(e.prevButtons & Btn.Jump);
  if (canDouble) {
    // deliberate double jump at the apex, or a rescue when falling short of the point
    const rescue = e.vel.y < -0.5 && e.pos.y < to.y - 0.05 && d > 0.4 && r.jumped;
    if ((p.jump === 2 && e.vel.y < 1.0) || rescue) { r.held = true; out.buttons = Btn.Jump; }
  }
  return 0;
}

/** Leg variants tried in order when validating (the first that lands is kept). */
function variantsFor(from: P3, to: P3): LegParams[] {
  const up = to.y - from.y > 0.35;
  if (up) {
    return [
      { jump: 2, jumpAt: Infinity, speed: 1 }, { jump: 1, jumpAt: 2.2, speed: 1 }, { jump: 2, jumpAt: 1.6, speed: 1 },
      { jump: 2, jumpAt: Infinity, speed: 0.7 }, { jump: 1, jumpAt: Infinity, speed: 1 }, { jump: 2, jumpAt: 2.6, speed: 0.85 },
      { jump: 2, jumpAt: 1.1, speed: 0.6 },
    ];
  }
  return [{ jump: 0, jumpAt: 0, speed: 1 }, { jump: 1, jumpAt: Infinity, speed: 1 }, { jump: 0, jumpAt: 0, speed: 0.55 }, { jump: 1, jumpAt: 1.2, speed: 0.7 }];
}

// ------------------------------------------------------------------------------------------------ validation

interface Scratch {
  world: World;
  kcc: KinematicCharacterController;
  data: WorldData;
  box: { x0: number; x1: number; z0: number; z1: number };
}

/** Profile key: the movement numbers a hop depends on (slippery-grass variants map to their base stats). */
export function profileKey(m: MoveStats): string {
  const b = baseMoveStats(m);
  return [b.jumpVelocity, b.doubleJumpVelocity, b.runSpeed, b.airAccel, b.groundAccel, b.groundDecel, b.fallGravityScale,
    b.capsuleRadius, b.capsuleHalfHeight, b.coyoteTime, b.jumpBuffer].join('|');
}

/** The validated links of a movement profile (validates on first use; cached per world and profile). */
export function profileLinks(sim: Sim, set: NavLinkSet, move: MoveStats): ProfileLinks {
  const key = profileKey(move);
  const shared = sharedOf.get(set) ?? set;
  let p = shared.profiles.get(key);
  if (!p) {
    p = validateProfile(sim, shared, baseMoveStats(move), key);
    shared.profiles.set(key, p);
  }
  return p;
}

/** Crop a square terrain grid to the samples covering a box (identical vertices there). */
function cropTerrain(g: TerrainGrid, x0: number, x1: number, z0: number, z1: number): TerrainGrid {
  const i0 = Math.max(0, Math.floor((x0 - g.x0) / g.cell)), j0 = Math.max(0, Math.floor((z0 - g.z0) / g.cell));
  const span = Math.max(Math.ceil((x1 - x0) / g.cell), Math.ceil((z1 - z0) / g.cell)) + 2;
  const n = Math.min(span, g.n - i0, g.n - j0);
  const heights = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) heights[j * n + i] = g.heights[(j0 + j) * g.n + (i0 + i)];
  return { x0: g.x0 + i0 * g.cell, z0: g.z0 + j0 * g.cell, cell: g.cell, n, heights };
}

/** A Rapier world with the static world around the links (plus standing destructibles: conservative). Built from
 *  WorldData only (never from a sim's live world), once per world: a sim's view shares its set's. */
function scratchFor(sim: Sim, view: NavLinkSet): Scratch {
  const set = sharedOf.get(view) ?? view;
  if (set.scratch) return set.scratch;
  const data = sim.worldData;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (const l of set.links) for (const p of [l.from, ...l.legs]) { x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); z0 = Math.min(z0, p.z); z1 = Math.max(z1, p.z); }
  const M = 8;
  x0 -= M; x1 += M; z0 -= M; z1 += M;
  const near = (x: number, z: number, r: number) => x + r >= x0 && x - r <= x1 && z + r >= z0 && z - r <= z1;
  const props: PropBox[] = data.props.filter((b) => near(b.x, b.z, Math.hypot(b.hx, b.hy, b.hz)));
  for (const d of data.destructibles ?? []) for (const b of d.boxes) if (near(b.x, b.z, Math.hypot(b.hx, b.hy, b.hz))) props.push(b);
  const cylinders: PropCylinder[] = (data.cylinders ?? []).filter((c) => near(c.x, c.z, c.r));
  const crop: WorldData = { ...data, props, cylinders, terrain: data.terrain ? cropTerrain(data.terrain, x0, x1, z0, z1) : undefined };
  const R = sim.R;
  const world = new R.World({ x: 0, y: GRAVITY, z: 0 });
  world.timestep = TICK_DT;
  const src = sim.kcc;
  const kcc = world.createCharacterController(src.offset());
  kcc.setUp(src.up());
  const step = src.autostepMaxHeight();
  if (src.autostepEnabled() && step !== null) kcc.enableAutostep(step, src.autostepMinWidth() ?? 0, src.autostepIncludesDynamicBodies() ?? true);
  const snap = src.snapToGroundDistance();
  if (src.snapToGroundEnabled() && snap !== null) kcc.enableSnapToGround(snap);
  kcc.setMaxSlopeClimbAngle(src.maxSlopeClimbAngle());
  kcc.setMinSlopeSlideAngle(src.minSlopeSlideAngle());
  kcc.setApplyImpulsesToDynamicBodies(src.applyImpulsesToDynamicBodies());
  kcc.setNormalNudgeFactor(src.normalNudgeFactor());
  kcc.setSlideEnabled(src.slideEnabled());
  buildStaticWorld(R, world, crop);
  world.step();
  set.scratch = { world, kcc, data, box: { x0, x1, z0, z1 } };
  return set.scratch;
}

/** A bare character entity for the scratch world (what stepCharacter / stepWorldEffects read). */
function scratchChar(sim: Sim, s: Scratch, move: MoveStats, p: P3): SimEntity {
  const R = sim.R;
  const cd = R.ColliderDesc.capsule(move.capsuleHalfHeight, move.capsuleRadius)
    .setTranslation(p.x, p.y + 0.05 + move.capsuleHalfHeight + move.capsuleRadius, p.z)
    .setCollisionGroups(CHARACTER_GROUPS);
  const collider = s.world.createCollider(cd);
  collider.setActiveCollisionTypes(R.ActiveCollisionTypes.DEFAULT | R.ActiveCollisionTypes.KINEMATIC_FIXED);
  return {
    id: -1, kind: 0, team: 0, species: 0, cls: 'assault', seed: 0, name: 'nav-probe',
    pos: { x: p.x, y: p.y + 0.05, z: p.z }, vel: { x: 0, y: 0, z: 0 }, yaw: 0, pitch: 0, collider,
    input: emptyInput(0), prevButtons: 0, lastInputSeq: 0,
    char: { move, grounded: false, airTime: 0, jumpBuffer: 0, jumpsUsed: 0, jumpHeld: false, landImpact: 0, sprinting: false, slideTime: 0, slideCooldown: 0, pounding: false, crouchBuffer: 0, glideTime: 0, glideCooldown: 0, restX: NaN, restY: NaN, restZ: NaN },
    health: null, anim: Anim.Idle, flags: 0, dead: false, respawnTick: 0, weapon: -1, ammo: 0,
    ownerPid: null, removed: false, data: {},
  } as unknown as SimEntity;
}

interface CharSnap { pos: P3; vel: P3; char: NonNullable<SimEntity['char']>; prevButtons: number; buttons: number; flags: number }
function snap(e: SimEntity): CharSnap {
  return { pos: { ...e.pos }, vel: { ...e.vel }, char: { ...e.char! }, prevButtons: e.prevButtons, buttons: e.input.buttons, flags: e.flags };
}
function restore(e: SimEntity, s: CharSnap): void {
  e.pos.x = s.pos.x; e.pos.y = s.pos.y; e.pos.z = s.pos.z;
  e.vel.x = s.vel.x; e.vel.y = s.vel.y; e.vel.z = s.vel.z;
  Object.assign(e.char!, s.char);
  e.prevButtons = s.prevButtons; e.input.buttons = s.buttons; e.flags = s.flags;
  const m = e.char!.move;
  e.collider!.setTranslation({ x: e.pos.x, y: e.pos.y + m.capsuleHalfHeight + m.capsuleRadius, z: e.pos.z });
}

const legOut: LegOut = { x: 0, z: 0, buttons: 0 };

/**
 * Drive one character tick in the scratch world from a world-space stick + buttons (the brain's input path). No
 * world.step(): the world is static and the controller never sees its own collider, so the broad-phase refresh a
 * step does is moot here (it is ~2/3 of the cost); tests/unit/ai-nav-links.test.ts replays every validated link in a
 * real Sim to prove the equivalence.
 */
function scratchTick(s: Scratch, e: SimEntity, o: LegOut): void {
  const l = Math.hypot(o.x, o.z);
  const inp = e.input;
  inp.yaw = l > 1e-4 ? Math.atan2(-o.x, -o.z) : inp.yaw;
  inp.mx = 0; inp.mz = Math.min(1, l);
  inp.buttons = o.buttons;
  stepCharacter({ world: s.world, kcc: s.kcc }, e, TICK_DT);
  stepWorldEffects(s.data, e, TICK_DT);
  e.prevButtons = inp.buttons;
}

/** Run one leg to completion in the scratch world (at most 4 s). */
function runLeg(s: Scratch, e: SimEntity, from: P3, to: P3, p: LegParams, counter: { ticks: number }, onTick?: (e: SimEntity, o: LegOut) => void): boolean {
  const r = newLegRun();
  for (let t = 0; t < 240; t++) {
    const res = legStep(e, from, to, p, r, legOut, VALIDATE_STALL);
    if (res !== 0) return res === 1;
    scratchTick(s, e, legOut);
    onTick?.(e, legOut);
    counter.ticks++;
    const b = s.box;
    if (e.pos.x < b.x0 || e.pos.x > b.x1 || e.pos.z < b.z0 || e.pos.z > b.z1) return false;
  }
  return false;
}

/** Debug/tests: validate one link for a profile and report every leg (variant, where it ended, ticks). */
export function traceLink(sim: Sim, set: NavLinkSet, move: MoveStats, id: number, onTick?: (e: SimEntity, o: LegOut, leg: number, v: LegParams) => void): { leg: number; ok: boolean; variant: LegParams | null; end: P3; ticks: number }[] {
  const s = scratchFor(sim, set);
  const l = set.links[id], m = baseMoveStats(move);
  const e = scratchChar(sim, s, m, l.from);
  legOut.x = 0; legOut.z = 0; legOut.buttons = 0;
  for (let i = 0; i < 6; i++) scratchTick(s, e, legOut);
  const out: { leg: number; ok: boolean; variant: LegParams | null; end: P3; ticks: number }[] = [];
  let prev = l.from;
  for (const [k, to] of l.legs.entries()) {
    const start = snap(e);
    let ok: LegParams | null = null;
    const counter = { ticks: 0 };
    for (const v of variantsFor(prev, to)) {
      restore(e, start);
      counter.ticks = 0;
      if (runLeg(s, e, prev, to, v, counter, onTick && ((ee, o) => onTick(ee, o, k, v)))) { ok = v; break; }
    }
    out.push({ leg: k, ok: !!ok, variant: ok, end: { ...e.pos }, ticks: counter.ticks });
    if (!ok) break;
    prev = to;
  }
  s.world.removeCollider(e.collider!, false);
  return out;
}

function validateProfile(sim: Sim, set: NavLinkSet, move: MoveStats, key: string): ProfileLinks {
  const t0 = performance.now();
  const s = scratchFor(sim, set);
  const counter = { ticks: 0 };
  const params: (LegParams[] | null)[] = [];
  for (const l of set.links) {
    const e = scratchChar(sim, s, move, l.from);
    // settle on the entry point
    legOut.x = 0; legOut.z = 0; legOut.buttons = 0;
    for (let i = 0; i < 6; i++) scratchTick(s, e, legOut);
    const chosen: LegParams[] = [];
    let prev = l.from;
    for (const to of l.legs) {
      const start = snap(e);
      let ok: LegParams | null = null;
      for (const v of variantsFor(prev, to)) {
        restore(e, start);
        if (runLeg(s, e, prev, to, v, counter)) { ok = v; break; }
      }
      if (!ok) break;
      chosen.push(ok);
      prev = to;
    }
    params.push(chosen.length === l.legs.length ? chosen : null);
    s.world.removeCollider(e.collider!, false);
  }
  return { key, params, ms: performance.now() - t0, ticks: counter.ticks };
}

// ------------------------------------------------------------------------------------------------ planning

/** Where a point stands: grid 0 = ground, k = decks[k - 1], -1 = off every grid (on a crate, mid-air). */
export interface NavSpot { grid: number; cell: number }

/**
 * Locate feet (x, y, z): a deck cell within 0.8 m of its surface, else a ground cell within 1.5 m (the ground grid of
 * this sim: X1 blockers applied), else off-grid. `below`: an off-grid point falls back to the highest grid under it
 * (a bot on a crate, a goal on a prop top).
 */
export function locate(set: NavLinkSet, g0: NavGrid, x: number, y: number, z: number, out: NavSpot, below = false): NavSpot {
  for (let k = 0; k < set.decks.length; k++) {
    const c = deckCell(set.decks[k], x, y, z);
    if (c >= 0) { out.grid = k + 1; out.cell = c; return out; }
  }
  const c = nearestWalkable(g0, x, z, 3);
  if (c >= 0 && Math.abs(y - g0.ground[c]) < 1.5) { out.grid = 0; out.cell = c; return out; }
  out.grid = -1; out.cell = -1;
  if (!below) return out;
  let best = -Infinity;
  for (let k = 0; k < set.decks.length; k++) {
    const d = set.decks[k];
    const i = cellIndex(d, x, z);
    const j = i >= 0 && d.walk[i] ? i : nearestWalkable(d, x, z, 2);
    if (j >= 0 && d.ground[j] <= y + 0.3 && d.ground[j] > best) { best = d.ground[j]; out.grid = k + 1; out.cell = j; }
  }
  if (out.grid < 0 && c >= 0) { out.grid = 0; out.cell = c; }
  return out;
}

export function gridOf(set: NavLinkSet, g0: NavGrid, grid: number): NavGrid {
  return grid === 0 ? g0 : set.decks[grid - 1];
}

/** Extra planner cost of link `id` for a bot: its penalty triples (link, until tick, cost). */
function penaltyOf(pen: readonly number[], id: number, tick: number): number {
  let c = 0;
  for (let i = 0; i < pen.length; i += 3) if (pen[i] === id && pen[i + 1] > tick) c += pen[i + 2];
  return c;
}

/** First link of the cheapest chain (-1 = same node: walk the grid), its total cost (m) and the part of it that is
 *  this bot's penalties (> 0: the best chain crosses a link it missed twice or got shot on). */
export interface NavPlan { link: number; cost: number; penalty: number }

const spotA: NavSpot = { grid: -1, cell: -1 }, spotB: NavSpot = { grid: -1, cell: -1 };
let bestCost = new Float64Array(0), bestPen = new Float64Array(0), firstLink = new Int32Array(0);

/**
 * Cheapest way from feet (sx, sy, sz) to (gx, gy, gz): link -1 when both stand in the same node (walk the grid), else
 * the first link of the cheapest chain; cost Infinity when no validated chain exists. Costs are metres (straight
 * lines between link endpoints + link costs + the bot's penalties).
 */
export function planNav(set: NavLinkSet, prof: ProfileLinks, g0: NavGrid, sx: number, sy: number, sz: number,
  gx: number, gy: number, gz: number, pen: readonly number[], tick: number, out: NavPlan, goalBelow = true): NavPlan {
  const a = locate(set, g0, sx, sy, sz, spotA, true), b = locate(set, g0, gx, gy, gz, spotB, goalBelow);
  out.link = -1; out.cost = Infinity; out.penalty = 0;
  if (a.grid < 0 || b.grid < 0) return out;
  const ga = gridOf(set, g0, a.grid), gb = gridOf(set, g0, b.grid);
  const ra = ga.region[a.cell], rb = gb.region[b.cell];
  if (a.grid === b.grid && ra === rb) { out.cost = Math.hypot(gx - sx, gz - sz); return out; }
  const L = set.links, n = L.length;
  if (bestCost.length < n) { bestCost = new Float64Array(n); bestPen = new Float64Array(n); firstLink = new Int32Array(n); }
  const nodeFrom = (l: NavLink) => gridOf(set, g0, l.fromGrid).region[l.fromCell];
  const nodeTo = (l: NavLink) => gridOf(set, g0, l.toGrid).region[l.toCell];
  for (let i = 0; i < n; i++) {
    bestCost[i] = Infinity; bestPen[i] = 0; firstLink[i] = -1;
    const l = L[i];
    if (!prof.params[i] || l.fromGrid !== a.grid || nodeFrom(l) !== ra) continue;
    bestPen[i] = penaltyOf(pen, i, tick);
    bestCost[i] = Math.hypot(l.from.x - sx, l.from.z - sz) + l.cost + bestPen[i];
    firstLink[i] = i;
  }
  for (let pass = 0; pass < n; pass++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      if (!Number.isFinite(bestCost[i])) continue;
      const li = L[i], ti = nodeTo(li);
      for (let j = 0; j < n; j++) {
        const lj = L[j];
        if (!prof.params[j] || lj.fromGrid !== li.toGrid || nodeFrom(lj) !== ti) continue;
        const pj = penaltyOf(pen, j, tick);
        const c = bestCost[i] + Math.hypot(lj.from.x - li.to.x, lj.from.z - li.to.z) + lj.cost + pj;
        if (c < bestCost[j] - 1e-9) { bestCost[j] = c; bestPen[j] = bestPen[i] + pj; firstLink[j] = firstLink[i]; changed = true; }
      }
    }
    if (!changed) break;
  }
  for (let i = 0; i < n; i++) {
    const l = L[i];
    if (!Number.isFinite(bestCost[i]) || l.toGrid !== b.grid || nodeTo(l) !== rb) continue;
    const c = bestCost[i] + Math.hypot(gx - l.to.x, gz - l.to.z);
    if (c < out.cost) { out.cost = c; out.link = firstLink[i]; out.penalty = bestPen[i]; }
  }
  return out;
}

// ------------------------------------------------------------------------------------------------ bot state

/** Per-bot link runner + plan cache (brain.ts owns the glue). */
export interface NavBot {
  /** Link being run (-1 = none), its leg, the leg's controller state, the tick the runner last ran, the run's start. */
  link: number;
  leg: number;
  run: LegRun;
  linkTick: number;
  linkStart: number;
  /** Cached plan toward (planGX, planGY, planGZ), made at planTick. */
  plan: NavPlan;
  planTick: number;
  planGX: number; planGY: number; planGZ: number;
  /** Standing on a deck / off-grid high up (grounded > 1.5 m over the ground grid); kept while airborne. */
  elev: boolean;
  /** Penalties (link, until tick, extra cost) and misses (link, count) of this bot. */
  pen: number[];
  miss: number[];
  /** Buttons the link runner wants this tick (Jump), OR-ed in by the brain. */
  buttons: number;
  /** Tick the link layer last steered precisely (lining up on an entry, running a leg): no sprint, no nudges. */
  fine: number;
  /** Telemetry: links finished, hops missed, fallbacks (2nd miss), contested aborts. */
  done: number; misses: number; fallbacks: number; contested: number;
}

export function createNavBot(): NavBot {
  return {
    link: -1, leg: 0, run: newLegRun(), linkTick: -1, linkStart: 0,
    plan: { link: -1, cost: Infinity, penalty: 0 }, planTick: -9999, planGX: NaN, planGY: NaN, planGZ: NaN,
    elev: false, pen: [], miss: [], buttons: 0, fine: -1, done: 0, misses: 0, fallbacks: 0, contested: 0,
  };
}

/** Mark link `id` costly for this bot until `tick + seconds` (replaces an older mark of the same link). */
export function penalize(nb: NavBot, id: number, tick: number, p: { seconds: number; cost: number }): void {
  for (let i = nb.pen.length - 3; i >= 0; i -= 3) if (nb.pen[i] === id || nb.pen[i + 1] <= tick) nb.pen.splice(i, 3);
  nb.pen.push(id, tick + Math.round(p.seconds * 60), p.cost);
  nb.planTick = -9999;
}

/** Count a miss on link `id`; returns the count (reset after the fallback). */
export function countMiss(nb: NavBot, id: number): number {
  for (let i = 0; i < nb.miss.length; i += 2) if (nb.miss[i] === id) return ++nb.miss[i + 1];
  nb.miss.push(id, 1);
  return 1;
}

export function clearMiss(nb: NavBot, id: number): void {
  for (let i = 0; i < nb.miss.length; i += 2) if (nb.miss[i] === id) { nb.miss.splice(i, 2); return; }
}

// ------------------------------------------------------------------------------------------------ public queries

/**
 * Tactics API: the planner's cost (m) for bot `e` to stand at feet (x, y, z), Infinity when no validated route exists
 * (links built/validated on first use). Plain ground-to-ground queries in one region return the straight distance.
 */
export function canReach(sim: Sim, e: SimEntity, x: number, y: number, z: number): number {
  if (!e.char || sim.tick < 1) return Infinity;
  const g0 = navGridFor(sim);
  const set = navLinksFor(sim);
  if (!set) {
    const a = nearestWalkable(g0, e.pos.x, e.pos.z, 4), b = nearestWalkable(g0, x, z, 4);
    return a >= 0 && b >= 0 && g0.region[a] === g0.region[b] && Math.abs(y - g0.ground[b]) < 1.5 ? Math.hypot(x - e.pos.x, z - e.pos.z) : Infinity;
  }
  const prof = profileLinks(sim, set, e.char.move);
  const pen = (e.ai as { nav?: NavBot } | undefined)?.nav?.pen ?? [];
  // the point stands on the surface under it within a metre (a zone's minY floor under its roof), or nowhere
  const sy = Math.max(y, surfaceAt(sim.worldData, x, z, y + 1).y);
  return planNav(set, prof, g0, e.pos.x, e.pos.y, e.pos.z, x, sy, z, pen, sim.tick, { link: -1, cost: Infinity, penalty: 0 }, false).cost;
}

/** Debug/tests: which grid (0 ground, k deck, -1 none) feet (x, y, z) stand on in this sim. */
export function navLevelAt(sim: Sim, x: number, y: number, z: number): number {
  const set = navLinksFor(sim);
  if (!set) return 0;
  return locate(set, navGridFor(sim), x, y, z, { grid: -1, cell: -1 }).grid;
}
