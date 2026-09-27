// E4 (Wave 7 HARDENED, docs/design/HARDENED.md): the West Yard becomes the Yard War front. Pure data, no three.
//
//   - Two FORWARD BASES (FOBs) built from pet-scale household junk, deadly serious: kibble-sack sandbag walls and a
//     machine-gun nest, a bird-table watchtower on a stair of tennis-ball crates, a flag pole with a torn team banner,
//     an armory of tennis-ball ammo crates under camo netting, a motor pool of gas cans behind the Kart-O-Matic, a
//     generator feeding the kiosks, sodium floodlights, hedgehogs and a picket X-barricade framing the gates.
//   - A CONTESTED MIDDLE: two zig-zag trench lines (terrain) with sandbag firing positions at the salients, shell craters
//     (terrain bowls with a rim: foxholes) and low sack cover along the lanes.
//   - Visual-only battle marks for the client (battle-dressing.ts, terrain-view.ts, fence-view.ts): scorch, mud, tyre
//     ruts from the kart pads, standing puddles, paw-print trails, spent casings and tennis balls, damaged fence boards.
//
// Fairness: the cat FOB is the corgi FOB turned 180 degrees about MIRROR (the midpoint of the two spawn centroids =
// the core-rush B pad target), so both teams get the same cover at the same distances. Where the yard differs (the
// cats' cardboard boxes, the Vac-Tank arena, the RC-plane approach to the shed, the kart pads' exit lines), a piece
// carries its own cat-side placement. Solid pieces are built with the Kit: every solid visual box/cylinder is emitted
// with the SAME collider (a wall of sacks = one collider box = the sacks' envelope). Small attachments (labels 1.5 cm
// proud, spouts, cables, seed specks, gable boards) are visual only. Nothing here draws from the yard's rng stream:
// jitter is hash2 of fixed ids, so the rest of the yard stays bit-identical.
//
// Keep-outs (tests/unit/world-fortifications.test.ts): spawns, both Kart-O-Matics + pads + the karts' exit corridors,
// the Ordnance Kiosks, the core-rush pads, every adventure chapter's step zones, spawn groups, barricade spots, parked
// vehicles and rally points, pickup routes, destructibles, jump pads, the ch3 kart escape lane, water, The Garden and
// The Garage; terrain stamps stay clear of every existing prop's footprint (props sit on height()).
import type { Bookmark } from './world-types';
import type { Frame, Kit } from './kit';
import type { SurfaceOp, TerrainOp } from './terrain';
import { hash2 } from './noise';

export type Side = 0 | 1;
type Height = (x: number, z: number) => number;

/** Point-mirror centre: the midpoint of the corgi (-34, -71.67) and cat (50.67, 70.67) spawn centroids. */
export const MIRROR = { x: 8.3333, z: -0.5 } as const;
export const mirrorXZ = (x: number, z: number): [number, number] => [2 * MIRROR.x - x, 2 * MIRROR.z - z];

// ------------------------------------------------------------------------------------------------ client-facing data
/** A sodium floodlight: lamp head position and the ground point it lights (style/floodlights.js FloodlightSpec). */
export interface FloodSpec { pos: [number, number, number]; target: [number, number, number]; poolRadius?: number }
/** A torn team banner hanging from a pole top (client cloth); it streams downwind. `icon` false = a plain pennant. */
export interface BannerSpec { x: number; y: number; z: number; w: number; h: number; team: Side; seed: number; icon?: boolean }
/** A camo net draped over pole tops (client cloth), corners in order around the rim (back-left, back-right,
 *  front-right, front-left); a burlap fringe hangs `fringe` m from the front and side edges. */
export interface NetSpec { corners: [number, number, number][]; sag: number; seed: number; fringe?: number }
/** Ground mark for the terrain battle mask: scorch, mud (trodden, churned), puddle (standing water in a low spot). */
export interface MarkSpec { kind: 'scorch' | 'mud' | 'puddle'; x: number; z: number; r: number; amount?: number }
/** Tyre ruts: a polyline the karts drive, two ruts `gauge` apart. */
export interface RutSpec { pts: number[]; gauge: number }
/** Scattered clutter (client instances): spent casings, spent tennis balls, splinters in a disc; paw prints along
 *  the line (x, z) -> (x1, z1). */
export interface ClutterSpec { kind: 'casings' | 'balls' | 'paws' | 'splinters'; x: number; z: number; r: number; count: number; seed: number; x1?: number; z1?: number }
/** Damaged fence boards (fence-view): boards within r of (x, z) get snapped, scorched, leaning or patched. */
export interface FenceDamageSpec { x: number; z: number; r: number; amount: number }

export interface BattleLayout {
  floods: FloodSpec[];
  banners: BannerSpec[];
  nets: NetSpec[];
  marks: MarkSpec[];
  ruts: RutSpec[];
  clutter: ClutterSpec[];
  fenceDamage: FenceDamageSpec[];
  /** Trench centre lines (the terrain ops' polylines): mud + puddles along the floor. */
  trenches: { pts: number[]; width: number; depth: number }[];
  /** Watchtowers: the crate-stair standing points (feet, world) from the lawn up to the deck (tests, future AI). */
  towers: { side: Side; route: [number, number, number][] }[];
}

const registry = new WeakMap<object, BattleLayout>();
/** Remember the battle layout of a world (and of its fence list, which fence-view receives on its own). */
export function registerBattle(keys: (object | undefined)[], layout: BattleLayout): void {
  for (const k of keys) if (k) registry.set(k, layout);
}
/** The battle layout of a world built with fortifications (null for flat test worlds and other maps). */
export function battleOf(key: object | null | undefined): BattleLayout | null {
  return (key && registry.get(key)) ?? null;
}

// ------------------------------------------------------------------------------------------------ dimensions
/** Kibble sack lying flat: length (along the wall), depth (through the wall), height. Two rows = 0.76 m: chest cover
 *  for a 1.2 m pet (chest ~0.6 m, head ~1.05 m, aim pivot 1.25 m: it shoots over the wall, its head shows). */
export const SACK = { L: 1.5, D: 0.8, H: 0.38 } as const;
export const WALL_H = SACK.H * 2;
/** Watchtower tray (feet height) and the crate-stair step (= one tennis-ball crate). */
export const TOWER_DECK = 4.8;
export const CRATE_STEP = 1.2;
/** Downwind direction of the world view's wind (world-view.ts windDir (0.8, 0.45)): banners and nets stream along it. */
export const WIND_DIR = { x: 0.8716, z: 0.4903 } as const;

// ------------------------------------------------------------------------------------------------ terrain
// Trench lines (zig-zag, point-mirrored) and shell craters: 'path' ops dig the trenches (floor 0.5 m deep, ~25 deg
// banks, walkable, drivable) and craters (0.55 m deep with a lumpy rim: foxholes).
export const TRENCH = { width: 3.2, depth: 0.5 } as const;
const CORGI_TRENCH = [-17, -28.6, -11, -31.4, -5, -28.4, 1, -31.2, 6.5, -28.8];
/** Craters: corgi side [x, z, r] and the cat side (the point mirror, nudged where a mirror lands on a prop or water). */
const CRATERS: { c: [number, number, number]; cat?: [number, number] }[] = [
  { c: [-12.5, -16.5, 2.6] },
  { c: [-40, -12.5, 2.4], cat: [47, 5] },            // the mirror would cut into the pond bank
  { c: [-15, -45.5, 2.2], cat: [28, 46] },           // the cats' kart exit line + the hedge at (40, 44)
  { c: [-6, -38, 1.9] },
];

function mirrorPts(pts: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < pts.length; i += 2) out.push(...mirrorXZ(pts[i], pts[i + 1]));
  return out;
}

/**
 * Firing positions at each trench's salients (the zig-zag vertices that poke toward the enemy, and both ends): a 3 m
 * two-sack wall on level ground just past the lip, facing the enemy. The leg middles stay open: karts (B2's grid: no
 * ledge > 0.26 m next to a slope) and rushing pets cross the trench line anywhere between them.
 */
export function trenchPositions(pts: number[], side: Side): { x: number; z: number; yaw: number }[] {
  const out: { x: number; z: number; yaw: number }[] = [];
  const n = pts.length / 2;
  for (let v = 0; v < n; v++) {
    const x = pts[v * 2], z = pts[v * 2 + 1];
    const prevZ = v > 0 ? pts[v * 2 - 1] : -Infinity * (side === 0 ? 1 : -1);
    const nextZ = v < n - 1 ? pts[v * 2 + 3] : -Infinity * (side === 0 ? 1 : -1);
    const salient = side === 0 ? z >= prevZ && z >= nextZ : z <= prevZ && z <= nextZ;
    if (!salient) continue;
    const dir = side === 0 ? 1 : -1;
    out.push({ x, z: z + dir * (TRENCH.width + 0.9), yaw: side === 0 ? 0 : Math.PI });
  }
  return out;
}

/** Trench polylines: corgi (enemy to the south), cat (the mirror). */
export function trenchLines(): { pts: number[]; side: Side }[] {
  return [{ pts: CORGI_TRENCH, side: 0 }, { pts: mirrorPts(CORGI_TRENCH), side: 1 }];
}
export function craterList(): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const k of CRATERS) {
    out.push(k.c);
    const [mx, mz] = k.cat ?? mirrorXZ(k.c[0], k.c[1]);
    out.push([mx, mz, k.c[2]]);
  }
  return out;
}

/** Terrain stamps + ground surfaces of the front (merge into the yard's TerrainSpec before baking). */
export function fortificationTerrain(): { ops: TerrainOp[]; surfaces: SurfaceOp[] } {
  const ops: TerrainOp[] = [], surfaces: SurfaceOp[] = [];
  for (const { pts } of trenchLines()) {
    ops.push({ op: 'path', pts, width: TRENCH.width, depth: TRENCH.depth });
    surfaces.push({ kind: 'dirt', shape: 'path', pts, width: 2.5, soft: 0.9, amount: 0.95 });
  }
  for (const [x, z, r] of craterList()) {
    // relative stamps (the 'bowl' op is absolute: it would be a pit on a rise and a bump in a dip): a 0.55 m hole
    // and a lumpy ejecta rim of six small raises
    ops.push({ op: 'hole', x, z, r: r * 1.1, depth: 0.55 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + hash2(Math.round(x), Math.round(z), 61) * 1.2;
      const rr = r * (1.05 + 0.12 * hash2(i, Math.round(x * 3), 62));
      ops.push({ op: 'raise', x: x + Math.cos(a) * rr, z: z + Math.sin(a) * rr, r: 0.45, falloff: 1.25, h: 0.14 + 0.08 * hash2(i, Math.round(z * 3), 63) });
    }
    surfaces.push({ kind: 'dirt', shape: 'circle', x, z, r: r * 1.2, soft: 0.9, amount: 0.9 });
  }
  // trodden, churned ground inside each FOB: the kiosk plaza, the main gate, the kart gate
  for (const s of [0, 1] as const) {
    const P = (x: number, z: number) => (s === 0 ? [x, z] : mirrorXZ(x, z));
    const [ax, az] = P(-35, -63), [bx, bz] = P(-51, -52.5), [cx, cz] = P(-21, -58), [dx, dz] = P(-28, -62);
    surfaces.push(
      // the compound's bare, trampled earth: a light scar in the lawn that reads from the air (mud marks darken it)
      { kind: 'dirt', shape: 'circle', x: dx, z: dz, r: 12, soft: 3.2, amount: 0.62 },
      { kind: 'dirt', shape: 'circle', x: ax, z: az, r: 7, soft: 1.8, amount: 0.75 },
      { kind: 'dirt', shape: 'circle', x: bx, z: bz, r: 5, soft: 1.8, amount: 0.5 },
      { kind: 'dirt', shape: 'circle', x: cx, z: cz, r: 4.5, soft: 1.8, amount: 0.5 },
    );
  }
  return { ops, surfaces };
}

// ------------------------------------------------------------------------------------------------ pieces
export interface Pal { sack: string[]; label: string[]; trim: string; trim2: string }
export const FOB_PALETTE: Record<Side, Pal> = {
  0: { sack: ['sandbag', 'khaki', 'canvas'], label: ['danger', 'accent', 'teamCorgisTrim'], trim: 'teamCorgis', trim2: 'teamCorgisTrim' },
  1: { sack: ['sandbag', 'khaki', 'canvas'], label: ['tunaLabel', 'tunaLabel2', 'crateStencil'], trim: 'teamCats', trim2: 'teamCatsTrim' },
};
const pick = <T>(list: readonly T[], h: number): T => list[Math.min(list.length - 1, Math.floor(h * list.length))];

/**
 * Kibble-sack wall along local x (centred on the frame), `len` long, `rows` high, front = local +z. One collider =
 * the wall's exact envelope; the sacks tile it in running bond (odd rows start with a half sack). Top-row sacks are
 * rounded (soft ink hull), lower rows cheap smooth-shaded blocks. `sink` buries the bottom row into sloping ground.
 */
export function sackWall(f: Frame, len: number, rows: number, pal: Pal, seed: number, sink = 0.14, lift = 0, H: number = SACK.H): void {
  const { D } = SACK;
  const top = rows * H + lift;
  f.colBox('fob_sacks', 0, (top - sink) / 2, 0, len, top + sink, D);
  const n = Math.max(1, Math.round(len / SACK.L));
  const w = len / n;
  for (let r = 0; r < rows; r++) {
    const topRow = r === rows - 1;
    const y0 = r === 0 ? -sink : r * H + lift, y1 = (r + 1) * H + lift;
    const cuts: [number, number][] = [];
    if (r % 2 === 0 || n === 1) for (let i = 0; i < n; i++) cuts.push([-len / 2 + i * w, -len / 2 + (i + 1) * w]);
    else {
      cuts.push([-len / 2, -len / 2 + w / 2]);
      for (let i = 0; i < n - 1; i++) cuts.push([-len / 2 + w / 2 + i * w, -len / 2 + w / 2 + (i + 1) * w]);
      cuts.push([len / 2 - w / 2, len / 2]);
    }
    cuts.forEach(([a0, b0], i) => {
      let a = a0, b = b0;
      const h = hash2(seed + r * 31, i, 404);
      // lower rows: 5 cm joints between sacks; the top row abuts (its bevels make the seams) so the standing surface
      // is covered everywhere; flush with the collider at both wall ends
      const j = topRow ? -0.001 : 0.025;                       // (top row: a 2 mm overlap, no crack at the joint)
      const ga = i === 0 ? 0 : j, gb = i === cuts.length - 1 ? 0 : j;
      a += ga; b -= gb;
      const sw = b - a, col = pick(pal.sack, h);
      const sd = topRow ? D : D - 0.04 - h * 0.08, lz = topRow ? 0 : (h - 0.5) * 0.06;
      // (seg 1 on a box: a single-chamfer bevel, 44 tris; the client's prim-mesh builds it)
      if (topRow) f.box((a + b) / 2, (y0 + y1) / 2, 0, sw, y1 - y0, D, col, { g: 'soft', bev: Math.min(0.13, sw * 0.2), seg: 1 });
      else f.box((a + b) / 2, (y0 + y1 - 0.03) / 2, lz, sw, y1 - y0 - 0.03, sd, col, { g: 'soft', bev: 0.02 });
      // printed kibble-brand label on some faces (front or back), 1.5 cm proud of the sack
      const hl = hash2(seed + r * 31, i, 405);
      if (hl < 0.4 && sw > 0.9) {
        const face = hl < 0.28 ? 1 : -1;
        f.box((a + b) / 2 + (hl - 0.3) * 0.6, (Math.max(y0, r * H + lift) + y1) / 2 + 0.01, lz + face * (sd / 2 + 0.005), sw * 0.42, H * 0.46, 0.02,
          pick(pal.label, hash2(i, r, seed)), { g: 'noink', bev: 0 });
      }
    });
  }
}

/** U-shaped sandbag nest: front wall `w` wide facing +z, side walls running back to a depth `d`. */
export function sackNest(f: Frame, w: number, d: number, pal: Pal, seed: number, lift = 0): void {
  const { D } = SACK;
  sackWall(f.sub(0, 0, d / 2 - D / 2), w, 2, pal, seed, 0.14 + lift, lift);
  const sideLen = d - D;
  for (const s of [-1, 1]) sackWall(f.sub(s * (w / 2 - D / 2), 0, d / 2 - D - sideLen / 2, Math.PI / 2), sideLen, 2, pal, seed + 7 + s, 0.14 + lift, lift);
}

/** Czech hedgehog from three rusty angle-iron beams (each beam its own oriented box collider), ~1.4 m tall. */
export function hedgehog(f: Frame, seed: number): void {
  const L = 2.4, T = 0.2, up = 1 / Math.sqrt(3), side = Math.sqrt(2 / 3);
  const cy = (L / 2) * up + 0.02;
  const a0 = hash2(seed, 3, 77) * Math.PI;
  for (let i = 0; i < 3; i++) {
    const a = a0 + (i * Math.PI * 2) / 3;
    const yaw = Math.atan2(side * Math.cos(a), side * Math.sin(a)), pitch = -Math.asin(up);
    f.solid('fob_hedgehog', 0, cy, 0, T, T, L, i === 1 ? 'rust' : 'gunmetal', { yaw, pitch, bev: 0.02 });
  }
}

/**
 * Picket X-barricade (cheval-de-frise): a log along local x at 0.62 m with weathered white pickets crossing it in X
 * pairs every metre. Every picket and the log are their own collider (a pet scrambles over, bots path around).
 */
export function xBarricade(f: Frame, len: number, seed: number): void {
  const logY = 0.62, P = 1.9, T = 0.14, tilt = (50 * Math.PI) / 180;
  f.solid('fob_barricade', 0, logY, 0, len, 0.3, 0.3, 'fenceDark', { bev: 0.06 });
  const n = Math.max(2, Math.round(len));
  for (let i = 0; i < n; i++) {
    const x = -len / 2 + 0.5 + ((len - 1) * i) / Math.max(1, n - 1);
    for (const s of [0, 1]) {
      const h = hash2(seed, i * 2 + s, 88);
      f.solid('fob_barricade', x + (s - 0.5) * 0.16, logY, 0, T, T, P, h < 0.25 ? 'fenceWood' : 'trim', { yaw: s ? Math.PI : 0, pitch: -(Math.PI / 2 - tilt), bev: 0.02 });
    }
  }
}

/** Tennis-ball ammo crate, 1.4 x 1.2 x 1.0 (one crate = one CRATE_STEP). Open crates show the balls to the rim. */
export function ammoCrate(f: Frame, open: boolean, seed: number): void {
  const W = 1.4, H = CRATE_STEP, D = 1.0, t = 0.1;
  const wood = hash2(seed, 1, 9) < 0.5 ? 'crateOlive' : 'olive';
  if (!open) {
    f.solid('fob_crate', 0, H / 2, 0, W, H, D, wood, { bev: 0.05, seg: 1 });
  } else {
    f.colBox('fob_crate', 0, H / 2, 0, W, H, D);
    for (const s of [-1, 1]) {
      f.box(0, H / 2, s * (D / 2 - t / 2), W, H, t, wood, { bev: 0.02 });
      f.box(s * (W / 2 - t / 2), H / 2, 0, t, H, D - 2 * t, wood, { bev: 0.02 });
    }
    f.box(0, H - 0.18, 0, W - 2 * t + 0.02, 0.36, D - 2 * t + 0.02, 'tennisFelt', { g: 'noink', bev: 0 });
    for (let i = 0; i < 3; i++) f.sphere(-0.36 + i * 0.36, H - 0.14, (hash2(seed, i, 11) - 0.5) * 0.4, 0.13, 0.13, 0.13, 'tennisFelt', { seg: 6, g: 'soft' });
  }
  // stencil band + a tennis-ball roundel on the long faces (1.5 cm proud)
  for (const s of [-1, 1]) {
    f.box(0, H * 0.66, s * (D / 2 + 0.005), W * 0.82, 0.14, 0.02, 'bannerRag', { g: 'noink', bev: 0 });
    f.box(0, H * 0.36, s * (D / 2 + 0.005), 0.34, 0.3, 0.02, 'tennisFelt', { g: 'noink', bev: 0 });
  }
}

/** A stack of crates `n` high (each crate its own collider, stacked flush); the top one may be open. */
export function crateStack(f: Frame, n: number, openTop: boolean, seed: number): void {
  for (let i = 0; i < n; i++) ammoCrate(f.sub(0, i * CRATE_STEP, 0), openTop && i === n - 1, seed + i);
}

/** Pet-scale gas can: the red plastic lawn-mower can, or an olive jerry can. */
export function gasCan(f: Frame, jerry: boolean): void {
  const W = 1.0, H = 1.15, D = 0.6;
  f.solid('fob_gascan', 0, H / 2, 0, W, H, D, jerry ? 'olive' : 'danger', { bev: 0.1, seg: 1 });
  if (jerry) for (const s of [-1, 1]) for (const r of [0.6, -0.6]) {
    f.box(0, H / 2, s * (D / 2 + 0.005), 0.08, H * 0.7, 0.02, 'oliveDark', { g: 'noink', bev: 0, roll: r });
  }
  f.cyl(W / 2 - 0.18, H + 0.05, 0, 0.07, 0.26, 0.09, jerry ? 'gunmetal' : 'accentHot', { seg: 6, roll: -0.5, g: 'noink' });   // spout
}

/** Generator on skids (feeds the kiosks). */
export function generator(f: Frame): void {
  f.solid('fob_generator', 0, 0.6, 0, 1.7, 1.2, 1.1, 'oliveDark', { bev: 0.08, seg: 1 });
  for (const s of [-1, 1]) f.box(0, 0.62, s * 0.56, 1.3, 0.7, 0.02, 'gunmetal', { g: 'noink', bev: 0 });
  f.cyl(0.6, 1.35, -0.3, 0.07, 0.3, 0.07, 'rust', { seg: 6, g: 'noink' });            // exhaust stub
}

/** Upright pole (floodlight, camo-net pole, flag): a thin solid cylinder. */
function pole(f: Frame, x: number, z: number, h: number, r: number, col: string): void {
  f.solidCyl('fob_pole', x, h / 2, z, r, h, r, col, { seg: 8 });
}

/**
 * Bird-table watchtower (front = +z): a seed tray on a thick post at TOWER_DECK with a 0.6 m rim (chest cover, the
 * head shows over it), a peaked feeder roof on four posts, reached by a stair of crates 1, 2 and 3 high at the
 * back-left (back-right when `flip`) and a gap in the rim above it. Returns the roof floodlight (world space), aimed
 * down the tower's field toward local (-9, 13).
 */
export function birdTable(f: Frame, pal: Pal, flip: boolean, seed: number, team: Side): { flood: FloodSpec; route: [number, number, number][]; pennant: BannerSpec } {
  const HALF = 1.7, TH = 0.3, RIM = 0.6, RT = 0.2, D = TOWER_DECK;
  const sx = flip ? -1 : 1;
  // post + four braces under the tray
  f.solidCyl('fob_tower', 0, (D - TH) / 2, 0, 0.38, D - TH, 0.44, 'fenceDark', { seg: 10 });
  for (let i = 0; i < 4; i++) {
    const a = Math.PI / 4 + (i * Math.PI) / 2;
    f.solid('fob_tower', Math.sin(a) * 0.72, D - TH - 0.8, Math.cos(a) * 0.72, 0.16, 0.16, 2.3, 'fenceDark', { yaw: a, pitch: -0.95, bev: 0.02 });
  }
  // tray: five planks (one collider = their envelope)
  f.colBox('fob_deck', 0, D - TH / 2, 0, HALF * 2, TH, HALF * 2);
  for (let i = 0; i < 5; i++) {
    const w = (HALF * 2) / 5;
    f.box(-HALF + w * (i + 0.5), D - TH / 2, 0, w - 0.03, TH, HALF * 2, i % 2 ? 'fenceWood' : 'fenceDark2', { bev: 0.03 });
  }
  // rim: front (team paint), sides, and the back split by the access gap (1.3 m, above the crate stair)
  const rimY = D + RIM / 2;
  f.solid('fob_rim', 0, rimY, HALF - RT / 2, HALF * 2, RIM, RT, pal.trim, { bev: 0.04 });
  for (const s of [-1, 1]) f.solid('fob_rim', s * (HALF - RT / 2), rimY, 0, RT, RIM, HALF * 2 - 2 * RT, 'fenceWood', { bev: 0.04 });
  const gap1 = -HALF + RT + 1.3;                               // local x where the back rim resumes (before flip)
  const backLen = HALF - gap1;
  f.solid('fob_rim', sx * (gap1 + backLen / 2), rimY, -HALF + RT / 2, backLen, RIM, RT, pal.trim, { bev: 0.04 });
  f.solid('fob_rim', sx * (-HALF + RT / 2), rimY, -HALF + RT / 2, RT, RIM, RT, 'fenceWood', { bev: 0.04 });
  // spilled seed on the tray (visual specks)
  for (let i = 0; i < 7; i++) {
    f.sphere((hash2(seed, i, 21) - 0.5) * 2.6, D + 0.03, (hash2(seed, i, 22) - 0.5) * 2.6, 0.12, 0.05, 0.1, i % 2 ? 'sisal' : 'khaki', { seg: 5, g: 'noink' });
  }
  // roof posts on the rim corners + a peaked feeder roof (ridge along x), team-painted ridge and gable boards
  const postTop = D + 2.55;
  for (const px of [-1, 1]) for (const pz of [-1, 1]) {
    f.solidCyl('fob_post', px * (HALF - 0.1), (D + RIM + postTop) / 2, pz * (HALF - 0.1), 0.1, postTop - D - RIM, 0.1, 'fenceDark', { seg: 6 });
  }
  const rise = 1.1, half = HALF + 0.45, pitch = Math.atan2(rise, half), slab = Math.hypot(half, rise) + 0.2;
  for (const s of [-1, 1]) f.solid('fob_roof', 0, postTop + rise / 2 + 0.1, (s * half) / 2, HALF * 2 + 0.9, 0.24, slab, 'roof', { pitch: s * pitch, bev: 0.06 });
  f.box(0, postTop + rise + 0.2, 0, HALF * 2 + 1.0, 0.24, 0.3, pal.trim2, { bev: 0.06 });
  for (const s of [-1, 1]) for (let i = 0; i < 3; i++) {
    const y = postTop + 0.22 + i * 0.3, w = 2 * half * (1 - (i + 0.8) / 3.4);
    f.box(s * (HALF + 0.3), y, 0, 0.1, 0.28, w, i % 2 ? pal.trim2 : pal.trim, { g: 'noink', bev: 0 });
  }
  // a mast on the ridge for the team pennant (visual)
  const mastTop = postTop + rise + 2.1;
  f.cyl(sx * 1.2, (postTop + rise + mastTop) / 2, 0, 0.05, mastTop - postTop - rise, 0.06, 'gunmetal', { seg: 5, g: 'noink' });
  const [px, py, pz] = f.w(sx * 1.2, mastTop - 0.05, 0);
  // a suet cage hanging under the roof (visual)
  f.cyl(sx * 0.9, postTop - 0.45, 0.9, 0.02, 0.8, 0.02, 'metal', { seg: 4, g: 'noink' });
  f.box(sx * 0.9, postTop - 1.0, 0.9, 0.34, 0.34, 0.2, 'wire', { g: 'noink', bev: 0 });
  // crate stair at the back: 1, 2, 3 crates high, stepping up toward the rim gap
  const stair: [number, number, number][] = [[-3.05, -5.35, 1], [-3.05, -3.35, 2], [-1.0, -2.8, 3]];
  stair.forEach(([lx, lz, n], i) => crateStack(f.sub(sx * lx, 0, lz), n, i === 0, seed + 50 + i * 3));
  // floodlight on the front roof corner, aimed down the tower's field
  const head = f.w(-(HALF + 0.25), postTop + 0.15, HALF + 0.3);
  const tgt = f.w(-9, 0, 13);
  // standing points: the lawn behind the stair, each crate top, the tray just inside the rim gap
  const route: [number, number, number][] = [
    f.w(sx * -3.05, 0, -7.3), f.w(sx * -3.05, CRATE_STEP, -5.35), f.w(sx * -3.05, CRATE_STEP * 2, -3.35),
    f.w(sx * -1.0, CRATE_STEP * 3, -2.8), f.w(sx * -0.85, D, -0.8),
  ];
  return { flood: { pos: head, target: tgt, poolRadius: 7.5 }, route, pennant: { x: px, y: py, z: pz, w: 1.8, h: 0.75, team, seed: seed + 7, icon: false } };
}

/** Flag pole on a pinwheel of kibble sacks; returns the banner spec (hung from the pole top). */
export function flagPole(f: Frame, pal: Pal, team: Side, seed: number): BannerSpec {
  const H = 12.5, B = 1.8, sink = 0.12;
  f.colBox('fob_flagbase', 0, (WALL_H - sink) / 2, 0, B, WALL_H + sink, B);
  for (let r = 0; r < 2; r++) for (let i = 0; i < 4; i++) {
    // pinwheel: each 1.2 x 0.6 sack covers a quarter of the 1.8 m square around the 0.6 m centre block
    const g = f.sub(0, 0, 0, (i * Math.PI) / 2);
    const y0 = r === 0 ? -sink : SACK.H, y1 = (r + 1) * SACK.H;
    g.box(-0.3, (y0 + y1) / 2, 0.6, 1.16, y1 - y0 - (r === 0 ? 0.02 : 0), 0.57, pick(pal.sack, hash2(seed, i + r * 4, 3)), { g: 'soft', bev: r === 1 ? 0.1 : 0.02, seg: 1 });
  }
  f.box(0, (WALL_H - sink) / 2, 0, 0.6, WALL_H + sink, 0.6, 'sandbag', { g: 'soft', bev: 0.02 });
  pole(f, 0, 0, H, 0.18, 'gunmetal');
  f.sphere(0, H + 0.25, 0, 0.32, 0.32, 0.32, pal.trim2, { seg: 8 });
  const [x, y, z] = f.w(0, H - 0.2, 0);
  return { x, y, z, w: 5.8, h: 3.6, team, seed };
}

/** Floodlight on a pole with a cable sack at its foot; returns the spec (head, aim point) in world space. */
export function floodPole(f: Frame, h: number, aimLocal: [number, number], pal: Pal, seed: number): FloodSpec {
  pole(f, 0, 0, h, 0.14, 'gunmetal');
  f.box(0, h - 0.1, 0, 1.3, 0.14, 0.14, 'gunmetal', { bev: 0 });                  // crossbar (visual)
  f.box(0, h - 0.6, -0.24, 0.5, 0.6, 0.3, 'oliveDark', { g: 'noink', bev: 0 });   // ballast box (visual)
  sackWall(f.sub(0, 0, -0.9), 1.6, 1, pal, seed);
  return { pos: f.w(0, h + 0.1, 0.25), target: f.w(aimLocal[0], 0, aimLocal[1]) };
}

/** Four thin net poles at the corners of a w x d rectangle, the back pair taller (the net slopes toward the enemy
 *  side like a lean-to); returns the net spec (pole tops, in rim order). */
export function netPoles(f: Frame, w: number, d: number, hBack: number, hFront: number, seed: number): NetSpec {
  const corners: [number, number, number][] = [];
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    const hh = (sz < 0 ? hBack : hFront) + (hash2(seed, sx + 2, sz + 2) - 0.5) * 0.3;
    pole(f, (sx * w) / 2, (sz * d) / 2, hh, 0.09, 'fenceDark');
    corners.push(f.w((sx * w) / 2, hh + 0.02, (sz * d) / 2));
  }
  return { corners, sag: 0.45, seed, fringe: 1.1 };
}

/**
 * A garden sign propped against a wall's front as bunker armor (front = local +z): the corgis' BEWARE OF DOG (red
 * band, a dog's head), the cats' NO DOGS (red ring and slash over the dog). A solid tilted plate; its top edge stays
 * under a pet's aim pivot (1.25 m), so it is a gun shield, not a roof. `z0` = the wall's front face.
 */
export function gardenSign(f: Frame, x: number, z0: number, team: Side): void {
  const W = 2.2, Hs = 1.2, T = 0.07, th = 0.22;
  const cy = (Hs / 2) * Math.cos(th), cz = z0 + 0.35 - (Hs / 2) * Math.sin(th);
  f.solid('fob_sign', x, cy, cz, W, Hs, T, 'catWhite', { pitch: -th, bev: 0.02 });
  // decal on the plate's front face: plate-local (px, py) -> frame-local, 1 cm proud
  const deco = (px: number, py: number, w: number, h: number, col: string, roll = 0) => {
    const pz = T / 2 + 0.01;
    f.box(x + px, cy + py * Math.cos(th) + pz * Math.sin(th), cz - py * Math.sin(th) + pz * Math.cos(th), w, h, 0.02, col, { pitch: -th, roll, g: 'noink', bev: 0 });
  };
  // the dog: head, snout, two ears
  deco(0.1, -0.12, 0.42, 0.34, 'catBlack'); deco(0.38, -0.2, 0.26, 0.16, 'catBlack');
  deco(-0.02, 0.1, 0.12, 0.22, 'catBlack', 0.35); deco(0.2, 0.1, 0.12, 0.22, 'catBlack', -0.35);
  if (team === 0) {
    deco(0, 0.46, W - 0.12, 0.2, 'danger'); deco(0, -0.5, W - 0.12, 0.08, 'danger');       // BEWARE band + base stripe
  } else {
    const pz = T / 2 + 0.012;
    f.torus(x, cy + pz * Math.sin(th), cz + pz * Math.cos(th), 0.46, 0.06, 'danger', { pitch: -th, seg: 20, g: 'noink' });
    deco(0, -0.05, 0.9, 0.1, 'danger', 0.75);                                                  // the slash
  }
  // two stakes behind it (visual)
  for (const s of [-0.8, 0.8]) f.box(x + s, 0.45, cz - 0.06, 0.08, 0.9, 0.06, 'fenceDark', { pitch: -th, bev: 0 });
}

// ------------------------------------------------------------------------------------------------ the layout
interface Place { x: number; z: number; yaw: number }
interface PieceDef {
  id: string;
  /** Corgi-side placement (world). yaw 0 = the piece's front (local +z) faces +z, the enemy side for corgis. */
  at: Place;
  /** Cat-side placement (world); default: the point mirror of `at` (yaw + PI); null = none on the cat side. */
  cat?: Place | null;
  /** Half extents of the footprint in the piece's frame (x, z): the piece sits on the lowest ground under it. */
  span: [number, number];
  /** `lift`: mean minus lowest ground under the footprint (walls stand their full height over the typical ground). */
  build(f: Frame, side: Side, pal: Pal, seed: number, out: BattleLayout, lift: number): void;
}

const wall = (len: number, rows = 2) => (f: Frame, _side: Side, pal: Pal, seed: number, _out: BattleLayout, lift: number) =>
  sackWall(f, len, rows, pal, seed, 0.14 + lift, lift);

/**
 * The two FOBs. Corgi side (the enemy is to the south, +z): spawns z -68..-79, the Ordnance Kiosk at (-38.3, -66.1),
 * the Kart-O-Matic at (-29.5, -63.9) with its pad (-26.8, -65.4) (karts exit SSE). A FRONT line south of the ch3
 * getaway lane (the straight drive from the garage door (81, -43) to the garden gate (-77, -63.5), kept 3.5 m clear:
 * the nest, the centre and east walls, hedgehogs, the X-barricade) and a COMPOUND north of it (kiosks, flag,
 * generator, armory, motor pool, watchtower). Gates: the west gate + main path (x -60..-38), the kart gate
 * (x -24..-12, between a hedgehog and the east wall), the east lane under the watchtower.
 */
const FOB: PieceDef[] = [
  // west MG nest beside Garden bed B (a 2 m alley between them), its floodlight inside
  {
    id: 'nest_w', at: { x: -61.8, z: -54, yaw: 0 }, span: [2.5, 1.6],
    build: (f, side, p, seed, _o, lift) => { sackNest(f, 5, 3.2, p, seed, lift); gardenSign(f, 0.9, 1.6, side); },
  },
  {
    id: 'flood_nest', at: { x: -62.6, z: -54.2, yaw: 0 }, span: [0.8, 1],
    build: (f, _s, pal, seed, out) => { out.floods.push(floodPole(f, 7.4, [6, 8], pal, seed)); },
  },
  // centre wall: the east shoulder of the main gate
  { id: 'wall_c', at: { x: -33, z: -51, yaw: 0 }, span: [4, 0.4], build: wall(8) },
  // east wall: the east shoulder of the kart gate (the cats' mirror would sit on their hedgehog: theirs guards the
  // west side of their kart gate instead, the hedge at (40, 44) the east)
  { id: 'wall_e', at: { x: -9, z: -50, yaw: -0.08 }, cat: { x: 16, z: 56.4, yaw: Math.PI - 0.12 }, span: [3, 0.4], build: wall(6) },
  // bird-table watchtower on the east flank (crate stair at the back, away from the enemy)
  {
    id: 'tower', at: { x: -2.5, z: -63.5, yaw: 0 }, cat: { x: 19.2, z: 62.5, yaw: Math.PI }, span: [1.9, 1.9],
    build: (f, side, pal, seed, out) => {
      const t = birdTable(f, pal, side === 1, seed, side);
      out.floods.push(t.flood);
      out.towers.push({ side, route: t.route });
      out.banners.push(t.pennant);
    },
  },
  // flag: the cats' by the cat tree (clear of the RC-plane approach to the shed), at the east end of their spawn row;
  // the corgis' mirrors it at the east end of theirs, behind the armory (0.6 m off the exact mirror: spawn clearance).
  // W9 F1 (Q4 P1-1): Base Assault stands its ball beside each team's flag. The corgis' flag used to sit mid-row at the
  // kiosk plaza, where a respawning corgi (on the spawn farthest from the thieves) came back 27-35 m from the stand and
  // in the fight within seconds; a cat's comes back 42-48 m behind a fleeing corgi thief. The corgis' side won 25 : 12
  // and 24 : 6 with the sides swapped; cover on the cat thief's exit did not move that (five single-piece tries).
  {
    id: 'flag', at: { x: -13.1, z: -69.2, yaw: 0 }, cat: { x: 30.2, z: 68.6, yaw: Math.PI }, span: [0.9, 0.9],
    build: (f, side, pal, seed, out) => { out.banners.push(flagPole(f, pal, side, seed)); },
  },
  // armory: tennis-ball crates under a camo net, between the motor pool and the watchtower (the cats': beside their
  // cardboard fort)
  {
    id: 'armory', at: { x: -15.5, z: -63, yaw: 0 }, cat: { x: 30.4, z: 63.8, yaw: Math.PI }, span: [2.5, 1.5],
    build: (f, _s, _p, seed, out) => {
      crateStack(f.sub(-1.6, 0, 0, 0.08), 2, true, seed);
      crateStack(f.sub(0.05, 0, 0.1, -0.05), 1, false, seed + 3);
      crateStack(f.sub(1.7, 0, -0.1, 0.12), 2, false, seed + 5);
      ammoCrate(f.sub(0.1, 0, -1.25, 1.45), true, seed + 9);
      out.nets.push(netPoles(f.sub(0, 0, -0.3), 8.4, 5.4, 3.6, 2.8, seed));
    },
  },
  // motor pool: gas cans behind the Kart-O-Matic pad
  {
    id: 'motor_pool', at: { x: -22.4, z: -68.6, yaw: 0.4 }, span: [1.2, 1],
    build: (f) => { gasCan(f, false); gasCan(f.sub(1.25, 0, 0.35, 0.3), true); gasCan(f.sub(-0.2, 0, -1.0, -0.2), true); },
  },
  // generator feeding both kiosks (the cats' sits east of their kiosk: the Vac-Tank spawns in their plaza)
  { id: 'generator', at: { x: -34.2, z: -62.9, yaw: 0.2 }, cat: { x: 59.5, z: 66.5, yaw: Math.PI - 0.4 }, span: [0.9, 0.6], build: (f) => generator(f) },
  // plaza floodlight between the main path and the Ordnance Kiosk, aimed at the main gate
  {
    id: 'flood_plaza', at: { x: -44.6, z: -63.4, yaw: 0 }, span: [0.8, 1],
    build: (f, _s, pal, seed, out) => { out.floods.push(floodPole(f, 8.2, [-3, 12], pal, seed)); },
  },
  // gate obstacles: hedgehogs on the west approach and framing the kart gate, a picket X-barricade before the main gate
  { id: 'hog_w', at: { x: -57.5, z: -44.5, yaw: 0 }, span: [1.2, 1.2], build: (f, _s, _p, seed) => hedgehog(f, seed) },
  { id: 'hog_kw', at: { x: -24.4, z: -49.4, yaw: 0 }, cat: { x: 25.2, z: 51.2, yaw: Math.PI }, span: [1.2, 1.2], build: (f, _s, _p, seed) => hedgehog(f, seed) },
  { id: 'xbar_c', at: { x: -47, z: -45, yaw: 0.25 }, span: [2.3, 0.8], build: (f, _s, _p, seed) => xBarricade(f, 4.5, seed) },
];

/** Contested middle: low sack cover at the lane crossings (corgi side; the cats' mirror or override). */
const MIDDLE: PieceDef[] = [
  { id: 'cover_c', at: { x: -37.5, z: -38, yaw: 0.3 }, cat: { x: 43.8, z: 36.5, yaw: Math.PI + 0.3 }, span: [2.3, 0.4], build: wall(4.5) },
  { id: 'cover_e', at: { x: 14, z: -32.5, yaw: -0.3 }, cat: { x: 1.5, z: 27.5, yaw: Math.PI - 0.3 }, span: [2.3, 0.4], build: wall(4.5) },
  { id: 'cover_w', at: { x: -44.5, z: -20.5, yaw: 0.2 }, cat: { x: 70, z: 8, yaw: Math.PI + 0.2 }, span: [2.3, 0.4], build: wall(4.5) },
  { id: 'hog_m', at: { x: -28, z: -15, yaw: 0 }, span: [1.2, 1.2], build: (f, _s, _p, seed) => hedgehog(f, seed) },
];

/** Scattered battle marks (visual), corgi side; mirrored for the cats. */
function marksFor(out: BattleLayout, s: Side): void {
  const P = (x: number, z: number): [number, number] => (s === 0 ? [x, z] : mirrorXZ(x, z));
  const m = (kind: MarkSpec['kind'], x: number, z: number, r: number, amount?: number) => { const [a, b] = P(x, z); out.marks.push({ kind, x: a, z: b, r, amount }); };
  // the compound: a broad scar of churned ground around the kiosks (the base reads as a base from the air)
  m('mud', -30, -63.5, 13, 0.52);
  // churned mud: the plaza, gates, the motor pool, behind the walls (where pets crouch), under the tower
  m('mud', -36, -63.5, 6.5, 0.85); m('mud', -51.5, -53, 5, 0.7); m('mud', -21.5, -60, 4.5, 0.75); m('mud', -24, -67.5, 3.2, 0.9);
  m('mud', -33, -49.5, 3.5, 0.6); m('mud', -9, -48.6, 3, 0.6); m('mud', -15.5, -62, 3.5, 0.7); m('mud', -63, -50, 3, 0.6); m('mud', -2.5, -66.5, 3.2, 0.6);
  // scorch: blast marks by the gates and walls, older ones out in no-man's land
  m('scorch', -44.5, -49.5, 2.6, 0.9); m('scorch', -16, -52, 2.2, 0.8); m('scorch', -27, -47.5, 1.6, 0.7); m('scorch', -57, -47.5, 1.8, 0.7);
  m('scorch', -6.5, -44, 2, 0.8); m('scorch', 12, -24, 2.3, 0.75); m('scorch', -25, -24, 1.7, 0.6);
  // standing puddles in low trodden spots
  m('puddle', -40.5, -63.8, 1.6, 0.8); m('puddle', -25.5, -61.5, 1.4, 0.7); m('puddle', -52.5, -56.5, 1.8, 0.75); m('puddle', -8.5, -54.5, 1.3, 0.6);
  const c = (kind: ClutterSpec['kind'], x: number, z: number, r: number, count: number, x1?: number, z1?: number) => {
    const [a, b] = P(x, z);
    const e = x1 !== undefined && z1 !== undefined ? P(x1, z1) : undefined;
    out.clutter.push({ kind, x: a, z: b, r, count, seed: out.clutter.length * 13 + s * 7 + 1, x1: e?.[0], z1: e?.[1] });
  };
  // spent casings behind the firing positions; spent tennis balls by the crates and out in front of the walls
  c('casings', -61.8, -55, 2.2, 34); c('casings', -33, -52.3, 3.2, 40); c('casings', -9, -51.3, 2.6, 30); c('casings', -2.5, -63.5, 1.4, 16);
  c('casings', -12.8, -29.8, 2.4, 22); c('casings', 2, -30.4, 2.4, 22); c('casings', -37.2, -39.3, 1.8, 14); c('casings', 14, -33.7, 1.8, 12);
  c('balls', -15.5, -61, 3, 9); c('balls', -36, -47, 4, 7); c('balls', -14, -53, 4, 6); c('balls', -8, -22, 7, 8); c('balls', -30, -38, 6, 5);
  // muddy paw-print trails: spawns -> kiosks -> gates, and out to the trench
  c('paws', -40, -70, 0.5, 22, -38.5, -63.5); c('paws', -36, -63, 0.5, 20, -46, -51); c('paws', -28, -69, 0.5, 18, -21, -52);
  c('paws', -50, -67.5, 0.5, 18, -56, -50); c('paws', -16, -71.5, 0.5, 18, -5, -66); c('paws', -18, -48, 0.5, 26, -9, -31);
  c('splinters', -47, -45, 2.4, 10); c('splinters', -2.5, -60.5, 2, 6);
}

/** Tyre ruts: from each Kart-O-Matic pad out through the kart gate and across the trench line (B2's drive planner's
 *  string-pulled routes toward the centre), and the ch3 getaway line to the garden gate. */
function rutsFor(out: BattleLayout): void {
  out.ruts.push(
    { pts: [-26.8, -65.4, -20.9, -56.1, -13.4, -44.3, -5.8, -32.3, 2, -20], gauge: 1.7 },
    { pts: [42.5, 65.8, 32.5, 48.5, 23, 35, 13.5, 21.5, 11, 20], gauge: 1.7 },
    { pts: [60, -47, 40, -54, 20, -52, 0, -50, -20, -51.5, -40, -52.5, -52, -56, -62, -62.5, -74, -63.5], gauge: 1.7 },
  );
}

/**
 * Power cables (visual): each generator feeds its team's two kiosks and the plaza floodlight. The kiosk sites are the
 * runtime placement's results (asserted unchanged by tests/unit/world-fortifications.test.ts).
 */
const CABLES: { side: Side; pts: number[] }[] = [
  { side: 0, pts: [-34.2, -62.9, -36.4, -64.4, -38.3, -65.3] },
  { side: 0, pts: [-34.2, -62.9, -31.8, -63.2, -30.2, -63.6] },
  { side: 0, pts: [-34.2, -62.9, -39.5, -62.2, -44.4, -63.2] },
  { side: 1, pts: [59.5, 66.5, 57, 65.8, 54.9, 64.9] },
  { side: 1, pts: [59.5, 66.5, 55, 67.6, 50, 66.4, 45.6, 64.2] },
];

function cables(kit: Kit, height: Height): void {
  for (const c of CABLES) {
    for (let i = 0; i + 3 < c.pts.length; i += 2) {
      const ax = c.pts[i], az = c.pts[i + 1], bx = c.pts[i + 2], bz = c.pts[i + 3];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 1.6));
      for (let k = 0; k < n; k++) {
        const t0 = k / n, t1 = (k + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        const wig = (hash2(i * 7 + k, c.side, 91) - 0.5) * 0.35;
        const mx = (x0 + x1) / 2 - (z1 - z0) * wig * 0.3, mz = (z0 + z1) / 2 + (x1 - x0) * wig * 0.3;
        const y0 = height(x0, z0), y1 = height(x1, z1), len = Math.hypot(x1 - x0, z1 - z0, y1 - y0) + 0.08;
        kit.frame(mx, (y0 + y1) / 2 + 0.06, mz).cyl(0, 0, 0, 0.065, len, 0.065, 'cable',
          { yaw: Math.atan2(x1 - x0, z1 - z0), pitch: Math.PI / 2 - Math.atan2(y1 - y0, Math.hypot(x1 - x0, z1 - z0)), seg: 5, g: 'noink' });
      }
    }
  }
}

export interface FortificationResult { layout: BattleLayout; bookmarks: Bookmark[] }

/**
 * Builds both FOBs and the contested middle into the kit (visual prims + matching colliders) and returns the client
 * layout (floodlights, banners, nets, marks, ruts, clutter, fence damage) and the E4 bookmarks.
 */
export function buildFortifications(kit: Kit, height: Height): FortificationResult {
  const layout: BattleLayout = { floods: [], banners: [], nets: [], marks: [], ruts: [], clutter: [], fenceDamage: [], trenches: [], towers: [] };
  let lift = 0;
  const placeFrame = (p: Place, [ex, ez]: [number, number]) => {
    // sit on the lowest ground under the footprint (no floating corners on the lawn undulation); `lift` = how far the
    // mean ground is above it (walls add it to their height, so their cover is measured from the typical ground)
    const c = Math.cos(p.yaw), s = Math.sin(p.yaw);
    let y = Infinity, sum = 0;
    for (const u of [-1, -0.5, 0, 0.5, 1]) for (const v of [-1, 0, 1]) {
      const lx = u * ex, lz = v * ez;
      const h = height(p.x + lx * c + lz * s, p.z - lx * s + lz * c);
      y = Math.min(y, h); sum += h;
    }
    lift = Math.round((sum / 15 - y) * 1000) / 1000;
    return kit.frame(p.x, y, p.z, p.yaw);
  };
  FOB.concat(MIDDLE).forEach((d, k) => {
    for (const side of [0, 1] as const) {
      let at: Place;
      if (side === 0) at = d.at;
      else if (d.cat === null) continue;
      else if (d.cat) at = d.cat;
      else { const [x, z] = mirrorXZ(d.at.x, d.at.z); at = { x, z, yaw: d.at.yaw + Math.PI }; }
      const f = placeFrame(at, d.span);
      d.build(f, side, FOB_PALETTE[side], 1000 + k * 17 + side * 5, layout, lift);
    }
  });
  // firing positions at the trench salients (two sacks, 3 m)
  for (const { pts, side } of trenchLines()) {
    trenchPositions(pts, side).forEach((p, i) => {
      const f = placeFrame(p, [1.5, 0.4]);
      sackWall(f, 3, 2, FOB_PALETTE[side], 3000 + i * 7 + side * 101, 0.14 + lift, lift);
    });
  }
  cables(kit, height);
  marksFor(layout, 0);
  marksFor(layout, 1);
  rutsFor(layout);
  for (const { pts } of trenchLines()) layout.trenches.push({ pts, width: TRENCH.width, depth: TRENCH.depth });
  for (const [x, z, r] of craterList()) {
    layout.marks.push({ kind: 'scorch', x, z, r: r * 1.4, amount: 0.8 }, { kind: 'puddle', x, z, r: r * 0.45, amount: 0.85 });
  }
  // fence damage: the fences behind each base and the corners the bases face
  layout.fenceDamage.push(
    { x: -86, z: -100, r: 9, amount: 0.8 }, { x: 10, z: -100, r: 8, amount: 0.6 },
    { x: 20, z: 100, r: 9, amount: 0.8 }, { x: 80, z: 100, r: 8, amount: 0.7 },
    { x: -100, z: -82, r: 10, amount: 0.7 }, { x: 100, z: 82, r: 10, amount: 0.7 },
  );
  const bookmarks: Bookmark[] = [
    { name: 'corgi_fob', pos: [-14, 6.5, -36], look: [-36, 1.5, -66], fov: 58 },
    { name: 'cat_fob', pos: [24, 6.5, 36], look: [46, 1.5, 64], fov: 58 },
    { name: 'corgi_spawn', pos: [-40, 2.6, -78], look: [-24, 1.6, -46], fov: 62 },
    { name: 'cat_spawn', pos: [48, 2.6, 78], look: [34, 1.6, 46], fov: 62 },
    { name: 'midfield', pos: [-30, 9, -30], look: [10, 0, 10], fov: 58 },
    { name: 'corgi_tower', pos: [-2.5, TOWER_DECK + 2.3, -65], look: [-12, 1.5, -40], fov: 62 },
  ];
  return { layout, bookmarks };
}
