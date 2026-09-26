// W9 X4 (arms-2): one throwable per faction, carried one at a time, restocked at your own Ordnance Kiosk.
//   corgi  Squeaker Grenade   a battered rubber squeak toy with a pin and team tape: bounces lively, squeaks per bounce.
//   cat    Hairball Bomb      a wet, taped hairball: a low, dead bounce, sticks and rolls short, a gross splat.
// Same power budget: both share ORDNANCE_BLAST (explode() reads only its blast fields); they differ in bounce feel only.
//
// This module is also the ONE throw arc used by everybody, so the preview is honest:
//   throwLaunch()   hand position + launch velocity from a character's own feet, yaw and pitch (the authority computes
//                   the throw from its own state; the client preview and the bot AI call the same function)
//   stepBody()      one 60 Hz tick of flight: semi-implicit Euler (the projectile integrator), a contact query, bounce
//                   (restitution + grip), settle, roll, rest. The sim passes Rapier (+ enemy capsules) as the query;
//                   the preview and the AI pass arcQuery() on an ArcWorld (terrain grid triangles + prop boxes/cylinders)
//   predictArc()    the whole flight to the blast: first landing, blast point, dots for the preview
//   solveThrow()    the view pitch that lands on a target point (bots), low arc first
//
// Snapshot convention (EntityState, EntityKind.Projectile, no protocol change): team/species = the thrower's (species
// picks the model, team the tape), seed = thrower id, weapon = ORDNANCE_RULES.wireBase + ORDNANCE_IDS index,
// ammo = fuse ticks left, flags & Grounded = at rest, vx/vy/vz = velocity, cls = -1.
// Characters: EFlag.Ordnance while carrying one. Restock: a `pickup` event with item = the ordnance id.
//
// Units: meters, seconds, radians. Allocation-free after warm-up (module scratch; ArcWorld built once per WorldData).
import { Species, type SpeciesId } from '../types';
import { TICK_DT } from '../constants';
import { COMBAT_RULES, type ProjectileDef } from './weapons';
import { moveStatsFor } from './classes';
import { quatYXZ } from '../world/queries';
import type { TerrainGrid, WorldData } from '../world/world-types';

/** Stable order: EntityState.weapon of a thrown one is wireBase + index. Append only. */
export const ORDNANCE_IDS = ['squeaker_grenade', 'hairball_bomb'] as const;
export type OrdnanceId = (typeof ORDNANCE_IDS)[number];

export interface OrdnanceDef {
  id: OrdnanceId;
  name: string;
  /** Faction that carries it. */
  species: SpeciesId;
  /** Flight (speed, gravity, radius, lifetime = fuse, restitution, bounces = max bouncy contacts) + the shared blast. */
  projectile: ProjectileDef;
  /** Radians added to the view pitch: looking at the horizon lobs it (15°). */
  lob: number;
  /** Launch pitch limits (radians, after the lob). */
  minPitch: number;
  maxPitch: number;
  /** Share of the tangential speed an impact keeps (1 = ice, 0 = sticks). */
  grip: number;
  /** Below this normal speed (m/s) a ground contact stops bouncing and rolls. */
  settle: number;
  /** Rolling deceleration on the ground (m/s²). */
  rollDecel: number;
  /** On flat-ish ground below this speed (m/s) it comes to rest. */
  restSpeed: number;
}

/**
 * The blast both factions share (soft-counter band, docs/handoff/X4.md §2): 70 at the centre never one-shots a
 * full-health pet (the 90 hp classes keep 20), ~48 at 2 m and 14 at the 4 m edge punish a cluster; 7 m/s knockback
 * shoves a camper out of cover without launching it; its own thrower takes 35 % (like the mortar).
 */
export const ORDNANCE_BLAST = {
  explodeRadius: 4.0,
  explodeDamage: 70,
  explodeInner: 0.7,
  explodeEdgeFrac: 0.2,
  selfDamageMult: 0.35,
  knockback: 7,
} as const;

/** Flight numbers both share: 19 m/s at −16 m/s² reaches ~24 m (a 45° lob), a 2.2 s fuse from the release. */
const FLIGHT = { speed: 19, gravity: -16, radius: 0.13, lifetime: 2.2, bounceBonus: 0, fuse: true } as const;

export const ORDNANCE: Record<OrdnanceId, OrdnanceDef> = {
  squeaker_grenade: {
    id: 'squeaker_grenade', name: 'Squeaker Grenade', species: Species.Corgi,
    projectile: { ...FLIGHT, ...ORDNANCE_BLAST, bounces: 6, restitution: 0.36 },
    lob: 0.26, minPitch: -0.7, maxPitch: 1.2,
    grip: 0.5, settle: 1.1, rollDecel: 4.5, restSpeed: 0.3,
  },
  hairball_bomb: {
    id: 'hairball_bomb', name: 'Hairball Bomb', species: Species.Cat,
    projectile: { ...FLIGHT, ...ORDNANCE_BLAST, bounces: 2, restitution: 0.12 },
    lob: 0.26, minPitch: -0.7, maxPitch: 1.2,
    grip: 0.3, settle: 1.8, rollDecel: 9, restSpeed: 0.5,
  },
};

/** Carry, cooldown and restock rules (the authority applies them; the HUD shows the restock timer). */
export const ORDNANCE_RULES = {
  /** Seconds between two throws of one character. */
  throwCooldown: 0.8,
  /** Seconds after a throw before your own kiosk restocks you (no grenade fountain). */
  restockCooldown: 20,
  /** Seconds after a taunt (Btn.Emote) during which a throw is refused: the paws are busy. */
  emoteLock: 1.0,
  /** Throwing hand relative to the eye: up, to the right (camera shoulder side), forward. */
  hand: { up: 0.14, side: 0.24, fwd: 0.3 },
  /** Room modes that hand them out (adventure keeps its tuned chapters without them). */
  modes: ['yard-skirmish', 'team-deathmatch', 'core-rush', 'boss-rush', 'base-assault'] as readonly string[],
  /** EntityState.weapon of a thrown one = wireBase + ORDNANCE_IDS index (never a WEAPON_IDS index). */
  wireBase: 100,
  /** Seconds before the blast when the client shows the blast ring under it (the target's last warning). */
  telegraph: 0.8,
} as const;

export const FUSE_TICKS = Math.round(FLIGHT.lifetime / TICK_DT);

/** The throwable a species carries. */
export function ordnanceFor(species: SpeciesId): OrdnanceDef {
  return species === Species.Cat ? ORDNANCE.hairball_bomb : ORDNANCE.squeaker_grenade;
}

export function ordnanceIndex(id: OrdnanceId): number {
  return (ORDNANCE_IDS as readonly string[]).indexOf(id);
}

/** EntityState.weapon of a thrown one. */
export function ordnanceWire(id: OrdnanceId): number {
  return ORDNANCE_RULES.wireBase + ordnanceIndex(id);
}

/** The ordnance a projectile's EntityState.weapon names, or null (a weapon projectile, a boss shell). */
export function ordnanceByWire(weapon: number): OrdnanceDef | null {
  const id = ORDNANCE_IDS[weapon - ORDNANCE_RULES.wireBase];
  return id ? ORDNANCE[id] : null;
}

/** Eye height above the feet per species (the capsule depends on the species only), like combat's eyeHeight(). */
const eyeCache: number[] = [];
export function eyeHeightOf(species: SpeciesId): number {
  let h = eyeCache[species];
  if (h === undefined) {
    const m = moveStatsFor(species, 'assault');
    h = 2 * (m.capsuleHalfHeight + m.capsuleRadius) * COMBAT_RULES.eyeFraction;
    eyeCache[species] = h;
  }
  return h;
}

// ------------------------------------------------------------------------------------------------ launch

export interface ThrowLaunch { x: number; y: number; z: number; vx: number; vy: number; vz: number }
export const makeLaunch = (): ThrowLaunch => ({ x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0 });

/** Launch pitch (radians) for a view pitch: the lob, clamped. */
export function launchPitch(def: OrdnanceDef, viewPitch: number): number {
  const p = viewPitch + def.lob;
  return p < def.minPitch ? def.minPitch : p > def.maxPitch ? def.maxPitch : p;
}

/**
 * The throw from a character's feet (x, y, z), view yaw (0 faces −Z) and pitch: the hand position and the launch
 * velocity. The authority, the client arc preview and the bot AI all call this.
 */
export function throwLaunch(x: number, y: number, z: number, yaw: number, pitch: number, species: SpeciesId, out: ThrowLaunch): ThrowLaunch {
  const def = ordnanceFor(species);
  const H = ORDNANCE_RULES.hand;
  const lp = launchPitch(def, pitch);
  const sy = Math.sin(yaw), cy = Math.cos(yaw), cp = Math.cos(lp), sp = Math.sin(lp);
  const fx = -sy, fz = -cy, rx = cy, rz = -sy;
  out.x = x + rx * H.side + fx * H.fwd;
  out.y = y + eyeHeightOf(species) + H.up;
  out.z = z + rz * H.side + fz * H.fwd;
  const s = def.projectile.speed;
  out.vx = fx * cp * s; out.vy = sp * s; out.vz = fz * cp * s;
  return out;
}

// ------------------------------------------------------------------------------------------------ flight

/** A flying (or resting) throwable. `ground` = ticks since the last ground-like contact (99 = none). */
export interface OrdBody {
  x: number; y: number; z: number;
  vx: number; vy: number; vz: number;
  bounces: number;
  ground: number;
  rest: boolean;
  restTicks: number;
  /** First contact with anything (the preview's landing point) and its tick. */
  landed: boolean;
  lx: number; ly: number; lz: number;
  lnx: number; lny: number; lnz: number;
  ticks: number;
  landTick: number;
}

export function makeBody(): OrdBody {
  return { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, bounces: 0, ground: 99, rest: false, restTicks: 0, landed: false, lx: 0, ly: 0, lz: 0, lnx: 0, lny: 1, lnz: 0, ticks: 0, landTick: -1 };
}

export function launchBody(b: OrdBody, L: ThrowLaunch): OrdBody {
  b.x = L.x; b.y = L.y; b.z = L.z; b.vx = L.vx; b.vy = L.vy; b.vz = L.vz;
  b.bounces = 0; b.ground = 99; b.rest = false; b.restTicks = 0; b.landed = false; b.ticks = 0; b.landTick = -1;
  b.lx = b.ly = b.lz = 0; b.lnx = 0; b.lny = 1; b.lnz = 0;
  return b;
}

/** A contact along a segment: distance `t` from the origin and the surface normal (unit, facing the origin side). */
export interface SegHit { t: number; nx: number; ny: number; nz: number }
export const makeSegHit = (): SegHit => ({ t: 0, nx: 0, ny: 1, nz: 0 });

/** First contact along the unit ray (dx, dy, dz) within `len`, written to `out`. */
export type SegQuery = (ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: SegHit) => boolean;

/** Contact outcome of stepBody (presentation cues and tests). */
export const Contact = { None: 0, Bounce: 1, Land: 2, Roll: 3 } as const;

/** Lift (m) off a surface after a contact, so the next ray starts in the open. */
const SKIN = 0.02;
/** Resting bodies re-check their support every this many ticks (a crate under it may break). */
const REST_CHECK = 8;

/** One tick of flight. Returns a Contact code (the first contact ever is Land). Allocation-free. */
export function stepBody(b: OrdBody, def: OrdnanceDef, dt: number, query: SegQuery, hit: SegHit): number {
  b.ticks++;
  if (b.rest) {
    b.restTicks++;
    if (b.restTicks % REST_CHECK !== 0 || query(b.x, b.y, b.z, 0, -1, 0, SKIN + 0.1, hit)) return Contact.None;
    b.rest = false; // the support went away: fall
  }
  const p = def.projectile;
  b.vy += p.gravity * dt;
  if (b.ground < 99) b.ground++;
  if (b.ground <= 3) {
    // rolling on the ground: friction takes speed off the horizontal motion
    const sp = Math.sqrt(b.vx * b.vx + b.vz * b.vz);
    if (sp > 0) { const k = Math.max(0, sp - def.rollDecel * dt) / sp; b.vx *= k; b.vz *= k; }
  }
  const mx = b.vx * dt, my = b.vy * dt, mz = b.vz * dt;
  const len = Math.sqrt(mx * mx + my * my + mz * mz);
  if (len < 1e-9) return Contact.None;
  const dx = mx / len, dy = my / len, dz = mz / len;
  if (!query(b.x, b.y, b.z, dx, dy, dz, len, hit)) {
    b.x += mx; b.y += my; b.z += mz;
    return Contact.None;
  }
  const hx = b.x + dx * hit.t, hy = b.y + dy * hit.t, hz = b.z + dz * hit.t;
  const nx = hit.nx, ny = hit.ny, nz = hit.nz;
  let code: number = Contact.Roll;
  const vn = b.vx * nx + b.vy * ny + b.vz * nz;
  if (vn < -def.settle || (vn < 0 && ny <= 0.7)) {
    // an impact: the tangential part keeps `grip`, the normal part bounces back with the restitution
    const tx = b.vx - vn * nx, ty = b.vy - vn * ny, tz = b.vz - vn * nz;
    const out = -vn * p.restitution;
    b.vx = tx * def.grip + nx * out; b.vy = ty * def.grip + ny * out; b.vz = tz * def.grip + nz * out;
    b.bounces++;
    code = Contact.Bounce;
  } else if (vn < 0) {
    // a gentle contact: slide/roll along the surface (the normal part is gone)
    b.vx -= vn * nx; b.vy -= vn * ny; b.vz -= vn * nz;
  }
  if (ny > 0.7) {
    b.ground = 0;
    // done bouncing (slow, or out of bounces): stay on the surface and roll
    const vo = b.vx * nx + b.vy * ny + b.vz * nz;
    if (vo > 0 && (vo < def.settle || b.bounces >= p.bounces)) { b.vx -= vo * nx; b.vy -= vo * ny; b.vz -= vo * nz; }
    if (ny > 0.85 && b.vx * b.vx + b.vy * b.vy + b.vz * b.vz < def.restSpeed * def.restSpeed) {
      b.vx = b.vy = b.vz = 0; b.rest = true; b.restTicks = 0;
    }
  }
  b.x = hx + nx * SKIN; b.y = hy + ny * SKIN; b.z = hz + nz * SKIN;
  if (!b.landed) {
    b.landed = true; b.landTick = b.ticks;
    b.lx = hx; b.ly = hy; b.lz = hz; b.lnx = nx; b.lny = ny; b.lnz = nz;
    return Contact.Land;
  }
  return code;
}

// ------------------------------------------------------------------------------------------------ arc world

/**
 * The static world as the throw arc sees it, without a physics engine: the terrain collider's exact triangles
 * (buildStaticWorld's trimesh (a,c,b)(b,d,c), else WorldData.height over a flat slab) and every prop box and cylinder
 * collider, bucketed on an 8 m grid. Dynamic things (vehicles, kiosks, destructibles, barriers, characters) are not
 * in it: the authority's flight still bounces off them.
 */
export interface ArcWorld {
  data: WorldData;
  grid: TerrainGrid | null;
  lim: number;
  killY: number;
  /** Boxes: cx cy cz hx hy hz, then the local→world rotation r00 r01 r02 r10 r11 r12 r20 r21 r22 (15 per box). */
  box: Float64Array;
  /** Cylinders: x y z r hh (5 per cylinder). */
  cyl: Float64Array;
  cell: number;
  gx0: number;
  gn: number;
  /** Items of cell c: items[start[c] .. start[c + 1]); >= 0 = box index, < 0 = cylinder -1 - index. */
  start: Int32Array;
  items: Int32Array;
}

const arcWorlds = new WeakMap<WorldData, ArcWorld>();
const CELL = 8;
/** Props are bucketed with this margin (m): more than one tick of flight, so the segment's start cell holds them. */
const MARGIN = 1.0;

/** The ArcWorld of a WorldData (built once, cached; WorldData is immutable). */
export function arcWorldOf(data: WorldData): ArcWorld {
  let aw = arcWorlds.get(data);
  if (aw) return aw;
  const props = data.props, cyls = data.cylinders ?? [];
  const box = new Float64Array(props.length * 15);
  const cyl = new Float64Array(cyls.length * 5);
  const lim = data.halfExtent + 12;
  const gn = Math.ceil((2 * lim) / CELL), gx0 = -lim;
  const counts = new Int32Array(gn * gn + 1);
  const ranges: number[] = [];
  const cellRange = (minX: number, maxX: number, minZ: number, maxZ: number) => {
    const i0 = Math.max(0, Math.floor((minX - gx0) / CELL)), i1 = Math.min(gn - 1, Math.floor((maxX - gx0) / CELL));
    const j0 = Math.max(0, Math.floor((minZ - gx0) / CELL)), j1 = Math.min(gn - 1, Math.floor((maxZ - gx0) / CELL));
    ranges.push(i0, i1, j0, j1);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) counts[j * gn + i]++;
  };
  props.forEach((p, k) => {
    const q = quatYXZ(p.pitch ?? 0, p.rotY, p.roll ?? 0);
    const { x, y, z, w } = q;
    const o = k * 15;
    box[o] = p.x; box[o + 1] = p.y; box[o + 2] = p.z; box[o + 3] = p.hx; box[o + 4] = p.hy; box[o + 5] = p.hz;
    // rotation matrix from the quaternion (columns = the box's local axes in world space)
    box[o + 6] = 1 - 2 * (y * y + z * z); box[o + 7] = 2 * (x * y - z * w); box[o + 8] = 2 * (x * z + y * w);
    box[o + 9] = 2 * (x * y + z * w); box[o + 10] = 1 - 2 * (x * x + z * z); box[o + 11] = 2 * (y * z - x * w);
    box[o + 12] = 2 * (x * z - y * w); box[o + 13] = 2 * (y * z + x * w); box[o + 14] = 1 - 2 * (x * x + y * y);
    const ex = Math.abs(box[o + 6]) * p.hx + Math.abs(box[o + 7]) * p.hy + Math.abs(box[o + 8]) * p.hz;
    const ez = Math.abs(box[o + 12]) * p.hx + Math.abs(box[o + 13]) * p.hy + Math.abs(box[o + 14]) * p.hz;
    cellRange(p.x - ex - MARGIN, p.x + ex + MARGIN, p.z - ez - MARGIN, p.z + ez + MARGIN);
  });
  cyls.forEach((c, k) => {
    cyl[k * 5] = c.x; cyl[k * 5 + 1] = c.y; cyl[k * 5 + 2] = c.z; cyl[k * 5 + 3] = c.r; cyl[k * 5 + 4] = c.hh;
    cellRange(c.x - c.r - MARGIN, c.x + c.r + MARGIN, c.z - c.r - MARGIN, c.z + c.r + MARGIN);
  });
  const start = new Int32Array(gn * gn + 1);
  for (let c = 0; c < gn * gn; c++) start[c + 1] = start[c] + counts[c];
  const fill = start.slice(0, gn * gn);
  const items = new Int32Array(start[gn * gn]);
  const n = props.length + cyls.length;
  for (let k = 0; k < n; k++) {
    const i0 = ranges[k * 4], i1 = ranges[k * 4 + 1], j0 = ranges[k * 4 + 2], j1 = ranges[k * 4 + 3];
    const item = k < props.length ? k : -1 - (k - props.length);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) items[fill[j * gn + i]++] = item;
  }
  aw = { data, grid: data.terrain ?? null, lim, killY: data.killY, box, cyl, cell: CELL, gx0, gn, start, items };
  arcWorlds.set(data, aw);
  return aw;
}

/**
 * Terrain height at (x, z) on the terrain COLLIDER: the grid's triangles (a,c,b)(b,d,c) exactly as buildStaticWorld()
 * triangulates them; WorldData.height() off the grid or without one. Writes the surface normal to `n` when given.
 */
export function arcGround(aw: ArcWorld, x: number, z: number, n?: SegHit): number {
  const g = aw.grid;
  if (g) {
    const fx = (x - g.x0) / g.cell, fz = (z - g.z0) / g.cell;
    const i = Math.floor(fx), j = Math.floor(fz);
    if (i >= 0 && j >= 0 && i < g.n - 1 && j < g.n - 1) {
      const u = fx - i, v = fz - j, H = g.heights, k = j * g.n + i;
      const ha = H[k], hb = H[k + 1], hc = H[k + g.n], hd = H[k + g.n + 1];
      let h: number, gu: number, gv: number;
      if (u + v <= 1) { h = ha + (hb - ha) * u + (hc - ha) * v; gu = hb - ha; gv = hc - ha; }
      else { h = hd + (hc - hd) * (1 - u) + (hb - hd) * (1 - v); gu = hd - hc; gv = hd - hb; }
      if (n) {
        const sx = -gu / g.cell, sz = -gv / g.cell, l = Math.sqrt(sx * sx + 1 + sz * sz);
        n.nx = sx / l; n.ny = 1 / l; n.nz = sz / l;
      }
      return h;
    }
  }
  const H = aw.data.height;
  const h = H(x, z);
  if (n) {
    const gx = (H(x + 0.1, z) - H(x - 0.1, z)) / 0.2, gz = (H(x, z + 0.1) - H(x, z - 0.1)) / 0.2;
    const l = Math.sqrt(gx * gx + 1 + gz * gz);
    n.nx = -gx / l; n.ny = 1 / l; n.nz = -gz / l;
  }
  return h;
}

/** Terrain crossing along a segment (bisection on the collider surface). The sim uses it as its terrain backstop. */
export function arcTerrain(aw: ArcWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: SegHit): boolean {
  if (oy + dy * len >= arcGround(aw, ox + dx * len, oz + dz * len)) return false;
  if (oy < arcGround(aw, ox, oz) - 0.05) return false; // started under the surface (a tunnel, an overhang)
  let lo = 0, hi = len;
  for (let i = 0; i < 14; i++) {
    const m = (lo + hi) * 0.5;
    if (oy + dy * m >= arcGround(aw, ox + dx * m, oz + dz * m)) lo = m; else hi = m;
  }
  out.t = hi;
  arcGround(aw, ox + dx * hi, oz + dz * hi, out);
  return true;
}

/** Segment vs one oriented box (slab test in the box frame). Returns the entry distance or -1; normal in `out`. */
function boxHit(b: Float64Array, o: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: SegHit): number {
  const px = ox - b[o], py = oy - b[o + 1], pz = oz - b[o + 2];
  // local = R^T * world (the columns of R are the local axes)
  const lox = b[o + 6] * px + b[o + 9] * py + b[o + 12] * pz;
  const loy = b[o + 7] * px + b[o + 10] * py + b[o + 13] * pz;
  const loz = b[o + 8] * px + b[o + 11] * py + b[o + 14] * pz;
  const ldx = b[o + 6] * dx + b[o + 9] * dy + b[o + 12] * dz;
  const ldy = b[o + 7] * dx + b[o + 10] * dy + b[o + 13] * dz;
  const ldz = b[o + 8] * dx + b[o + 11] * dy + b[o + 14] * dz;
  let tn = -Infinity, tf = Infinity, axis = -1, sign = 0;
  for (let a = 0; a < 3; a++) {
    const lo = a === 0 ? lox : a === 1 ? loy : loz, ld = a === 0 ? ldx : a === 1 ? ldy : ldz, h = b[o + 3 + a];
    if (Math.abs(ld) < 1e-12) { if (lo < -h || lo > h) return -1; continue; }
    let t1 = (-h - lo) / ld, t2 = (h - lo) / ld, s = -1;
    if (t1 > t2) { const tt = t1; t1 = t2; t2 = tt; s = 1; }
    if (t1 > tn) { tn = t1; axis = a; sign = s; }
    if (t2 < tf) tf = t2;
    if (tn > tf) return -1;
  }
  if (tf < 0 || tn > len) return -1;
  if (tn < 0 || axis < 0) {
    // started inside: push back out against the motion
    out.nx = -dx; out.ny = -dy; out.nz = -dz;
    return 0;
  }
  // world normal = R * (sign on the entry axis)
  out.nx = b[o + 6 + axis] * sign; out.ny = b[o + 9 + axis] * sign; out.nz = b[o + 12 + axis] * sign;
  return tn;
}

/** Segment vs one upright cylinder (side + caps). Returns the entry distance or -1; normal in `out`. */
function cylHit(c: Float64Array, o: number, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: SegHit): number {
  const cx = c[o], cy = c[o + 1], cz = c[o + 2], r = c[o + 3], hh = c[o + 4];
  const px = ox - cx, pz = oz - cz, y0 = cy - hh, y1 = cy + hh;
  const inside2 = px * px + pz * pz <= r * r;
  if (inside2 && oy >= y0 && oy <= y1) { out.nx = -dx; out.ny = -dy; out.nz = -dz; return 0; }
  let best = -1;
  const a = dx * dx + dz * dz;
  if (a > 1e-12 && !inside2) {
    const bq = px * dx + pz * dz, cq = px * px + pz * pz - r * r, disc = bq * bq - a * cq;
    if (disc >= 0) {
      const t = (-bq - Math.sqrt(disc)) / a;
      const y = oy + dy * t;
      if (t >= 0 && t <= len && y >= y0 && y <= y1) {
        best = t;
        const hx = px + dx * t, hz = pz + dz * t, l = Math.sqrt(hx * hx + hz * hz) || 1;
        out.nx = hx / l; out.ny = 0; out.nz = hz / l;
      }
    }
  }
  if (Math.abs(dy) > 1e-12) {
    const cap = oy > y1 ? y1 : oy < y0 ? y0 : NaN;
    if (cap === cap) {
      const t = (cap - oy) / dy;
      if (t >= 0 && t <= len && (best < 0 || t < best)) {
        const hx = px + dx * t, hz = pz + dz * t;
        if (hx * hx + hz * hz <= r * r) { best = t; out.nx = 0; out.ny = cap === y1 ? 1 : -1; out.nz = 0; }
      }
    }
  }
  return best;
}

const tmpHit: SegHit = makeSegHit();

/** The arc world's contact query: terrain collider + prop boxes + cylinders; nearest contact wins. */
export function arcQuery(aw: ArcWorld, ox: number, oy: number, oz: number, dx: number, dy: number, dz: number, len: number, out: SegHit): boolean {
  let best = Infinity;
  if (arcTerrain(aw, ox, oy, oz, dx, dy, dz, len, tmpHit)) { best = tmpHit.t; out.t = tmpHit.t; out.nx = tmpHit.nx; out.ny = tmpHit.ny; out.nz = tmpHit.nz; }
  const i = Math.floor((ox - aw.gx0) / aw.cell), j = Math.floor((oz - aw.gx0) / aw.cell);
  if (i >= 0 && j >= 0 && i < aw.gn && j < aw.gn) {
    const c = j * aw.gn + i, lim = Math.min(len, best);
    for (let k = aw.start[c], e = aw.start[c + 1]; k < e; k++) {
      const it = aw.items[k];
      const t = it >= 0 ? boxHit(aw.box, it * 15, ox, oy, oz, dx, dy, dz, lim, tmpHit) : cylHit(aw.cyl, (-1 - it) * 5, ox, oy, oz, dx, dy, dz, lim, tmpHit);
      if (t >= 0 && t < best) { best = t; out.t = t; out.nx = tmpHit.nx; out.ny = tmpHit.ny; out.nz = tmpHit.nz; }
    }
  }
  return best <= len;
}

/** True when the straight segment between two points is not blocked by the arc world. */
export function arcLineClear(aw: ArcWorld, ax: number, ay: number, az: number, bx: number, by: number, bz: number): boolean {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (d < 1e-4) return true;
  // walk it in cell-sized pieces so every piece's start cell holds its props
  const step = aw.cell * 0.5 - MARGIN;
  for (let s = 0; s < d; s += step) {
    const l = Math.min(step, d - s);
    if (arcQuery(aw, ax + (dx / d) * s, ay + (dy / d) * s, az + (dz / d) * s, dx / d, dy / d, dz / d, l, tmpHit2)) return false;
  }
  return true;
}
const tmpHit2: SegHit = makeSegHit();

/**
 * A hand pushed into a wall throws from where the arm is still in the open: the launch point moves back along the
 * eye → hand line to just before the first contact (the authority does the same against Rapier; for static props they
 * agree). Feet (x, y, z). Returns true when it clamped.
 */
export function clampLaunch(aw: ArcWorld, x: number, y: number, z: number, species: SpeciesId, L: ThrowLaunch): boolean {
  const ey = y + eyeHeightOf(species);
  const hx = L.x - x, hy = L.y - ey, hz = L.z - z, hl = Math.sqrt(hx * hx + hy * hy + hz * hz);
  if (hl < 1e-6 || !arcQuery(aw, x, ey, z, hx / hl, hy / hl, hz / hl, hl, tmpHit3)) return false;
  const k = Math.max(0, tmpHit3.t - HAND_BACKOFF) / hl;
  L.x = x + hx * k; L.y = ey + hy * k; L.z = z + hz * k;
  return true;
}
const tmpHit3: SegHit = makeSegHit();
/** How far (m) short of a blocking surface a clamped hand stays. */
export const HAND_BACKOFF = 0.06;

// ------------------------------------------------------------------------------------------------ prediction

export interface ArcResult {
  /** It touched something before the fuse ran out; (lx, ly, lz) is that first contact, at `landT` s. */
  landed: boolean;
  lx: number; ly: number; lz: number;
  lnx: number; lny: number; lnz: number;
  landT: number;
  /** Where it goes off (at the fuse) and whether it is resting there. */
  bx: number; by: number; bz: number;
  resting: boolean;
  /** Left the world (kill plane / out of bounds) before the fuse: no blast. */
  lost: boolean;
  /** Preview dots written to `pts` (xyz triples) and the index of the first dot after the landing. */
  n: number;
  landIdx: number;
}
export const makeArcResult = (): ArcResult => ({ landed: false, lx: 0, ly: 0, lz: 0, lnx: 0, lny: 1, lnz: 0, landT: 0, bx: 0, by: 0, bz: 0, resting: false, lost: false, n: 0, landIdx: -1 });

const pBody = makeBody();
const pHit = makeSegHit();
let pWorld: ArcWorld | null = null;
const worldQuery: SegQuery = (ox, oy, oz, dx, dy, dz, len, out) => arcQuery(pWorld!, ox, oy, oz, dx, dy, dz, len, out);

/**
 * The whole flight from a launch, tick by tick exactly as the authority steps it (the same stepBody at TICK_DT),
 * against the arc world: first landing, blast point. Preview dots every `every` ticks go into `pts` (up to its
 * length / 3). `untilLanding` stops at the first contact (bot aim solving).
 */
export function predictArc(aw: ArcWorld, L: ThrowLaunch, def: OrdnanceDef, out: ArcResult, pts: Float32Array | null = null, every = 2, untilLanding = false): ArcResult {
  const b = launchBody(pBody, L);
  pWorld = aw;
  out.landed = false; out.resting = false; out.lost = false; out.n = 0; out.landIdx = -1; out.landT = 0;
  const cap = pts ? Math.floor(pts.length / 3) : 0;
  const lim = aw.data.halfExtent + 30;
  if (pts && cap > 0) { pts[0] = b.x; pts[1] = b.y; pts[2] = b.z; out.n = 1; }
  // the authority: spawn tick (no motion), then one step per tick until the fuse tick, which blasts instead
  for (let k = 1; k < FUSE_TICKS; k++) {
    stepBody(b, def, TICK_DT, worldQuery, pHit);
    if (b.landed && !out.landed) {
      out.landed = true; out.landT = b.landTick * TICK_DT;
      out.lx = b.lx; out.ly = b.ly; out.lz = b.lz; out.lnx = b.lnx; out.lny = b.lny; out.lnz = b.lnz;
      if (pts && out.n < cap) { pts[out.n * 3] = b.lx; pts[out.n * 3 + 1] = b.ly; pts[out.n * 3 + 2] = b.lz; out.n++; }
      out.landIdx = out.n;
      if (untilLanding) break;
    }
    if (b.y < aw.killY || Math.abs(b.x) > lim || Math.abs(b.z) > lim) { out.lost = true; break; }
    if (pts && out.n < cap && k % every === 0 && !b.rest) { pts[out.n * 3] = b.x; pts[out.n * 3 + 1] = b.y; pts[out.n * 3 + 2] = b.z; out.n++; }
  }
  out.bx = b.x; out.by = b.y; out.bz = b.z; out.resting = b.rest;
  pWorld = null;
  return out;
}

// ------------------------------------------------------------------------------------------------ aim solving

export interface ThrowSolve {
  yaw: number;
  /** View pitch to send (the lob is added by throwLaunch). */
  pitch: number;
  /** Predicted first landing and flight time. */
  x: number; y: number; z: number; t: number;
  /** Horizontal miss (m) between the landing and the target. */
  miss: number;
}
export const makeSolve = (): ThrowSolve => ({ yaw: 0, pitch: 0, x: 0, y: 0, z: 0, t: 0, miss: Infinity });

const sLaunch = makeLaunch();
const sArc = makeArcResult();

/** Landing distance along the throw minus the wanted one (NaN when it never lands). Writes the landing to sArc. */
function rangeErr(aw: ArcWorld, x: number, y: number, z: number, yaw: number, pitch: number, species: SpeciesId, def: OrdnanceDef, hx: number, hz: number, want: number): number {
  throwLaunch(x, y, z, yaw, pitch, species, sLaunch);
  predictArc(aw, sLaunch, def, sArc, null, 2, true);
  if (!sArc.landed) return NaN;
  return (sArc.lx - hx) * -Math.sin(yaw) + (sArc.lz - hz) * -Math.cos(yaw) - want;
}

/**
 * The yaw and view pitch that land a throw from feet (x, y, z) on (tx, ty, tz): the low arc first, then the lob
 * (over whatever blocks the low one). An analytic parabola guess refined by a few secant steps of predictArc, so the
 * answer is what the authority will fly (bots aim with the preview's own arc). Pure and deterministic; about 4–12
 * flights per call. False when neither arc lands within `tolerance` m of the target (horizontally).
 */
export function solveThrow(aw: ArcWorld, x: number, y: number, z: number, species: SpeciesId, tx: number, ty: number, tz: number, out: ThrowSolve, tolerance = 1.2): boolean {
  const def = ordnanceFor(species);
  // aim from the hand: its sideways offset depends on the yaw, so settle the yaw twice
  let yaw = Math.atan2(-(tx - x), -(tz - z));
  for (let i = 0; i < 2; i++) {
    throwLaunch(x, y, z, yaw, 0, species, sLaunch);
    yaw = Math.atan2(-(tx - sLaunch.x), -(tz - sLaunch.z));
  }
  throwLaunch(x, y, z, yaw, 0, species, sLaunch);
  const hx = sLaunch.x, hy = sLaunch.y, hz = sLaunch.z;
  const D = Math.hypot(tx - hx, tz - hz), dh = ty - hy;
  const v = def.projectile.speed, g = -def.projectile.gravity;
  const disc = v * v * v * v - g * (g * D * D + 2 * dh * v * v);
  out.miss = Infinity;
  if (disc < 0 || D < 0.5) return false; // out of reach
  const pLo = def.minPitch - def.lob, pHi = def.maxPitch - def.lob;
  const clampP = (p: number) => (p < pLo ? pLo : p > pHi ? pHi : p);
  for (let arc = 0; arc < 2; arc++) {
    const theta = Math.atan((v * v + (arc === 0 ? -1 : 1) * Math.sqrt(disc)) / (g * D));
    let pa = clampP(theta - def.lob), ea = rangeErr(aw, x, y, z, yaw, pa, species, def, hx, hz, D);
    // low arc: more pitch = more range; the lob: more pitch = less range
    let pb = clampP(pa + (arc === 0 ? 0.02 : -0.02)), eb = rangeErr(aw, x, y, z, yaw, pb, species, def, hx, hz, D);
    for (let it = 0; it < 6 && eb === eb && ea === ea && Math.abs(eb) > 0.04 && eb !== ea; it++) {
      const pn = clampP(pb - (eb * (pb - pa)) / (eb - ea));
      pa = pb; ea = eb; pb = pn; eb = rangeErr(aw, x, y, z, yaw, pb, species, def, hx, hz, D);
    }
    if (eb !== eb) continue;
    const miss = Math.hypot(sArc.lx - tx, sArc.lz - tz);
    if (miss < out.miss) {
      out.yaw = yaw; out.pitch = pb; out.x = sArc.lx; out.y = sArc.ly; out.z = sArc.lz; out.t = sArc.landT; out.miss = miss;
    }
    if (miss <= tolerance && Math.abs(sArc.ly - ty) < 2.5) return true;
  }
  return false;
}
