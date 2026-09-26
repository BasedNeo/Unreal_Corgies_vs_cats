// The Garage + The Rooftops — D3 (Wave 3). Two stacked play spaces on the West Yard's north-east flank,
// between the patio and the swing set, close to the line of equal distance from both bases (corgi spawn
// centroid (-34,-72): 119 m, cat centroid (51,71): 134 m):
//
//   The Garage (Breacher, close quarters): a detached two-car garage (26 x 22 m, walls 6.6 m) with a flat
//     roof. Three entrances: the half-open roll-up door (12 m wide, south, facing the swing set), the side
//     door (2.8 m, west, toward the patio path) and a big pet door (2.6 m, north, from the NE-corner lawn).
//     Cover: a parked hatchback (hood 2.4 / cabin roof 3.9 m), workbench + pegboard, a wall of shelving,
//     a rolling tool chest, a paint-can pyramid, a chest freezer, cardboard boxes and a lawn mower. A
//     boarded-up, cracked wall section (east, facing the alley) is the future breach point (visual only).
//     Light: 4 hanging fluorescent tubes (WorldData.lamps -> glow tubes), two slatted skylights and the
//     roof hatch let sun stripes in, a pale interior paint keeps the shade readable.
//
//   The Rooftops (Overwatch, sniping): the flat roof (7.2 m) inside a 0.9 m parapet, an AC unit, a vent
//     stack, a propped-open roof hatch (a one-way drop onto the car) and the satellite-dish crow's nest
//     (9.6 m). Two exterior climb routes for the weakest jumper (corgi: single 1.47 m, double 2.55 m;
//     every step here is 1.2 m):
//       west  — stacked crates 1.2 / 2.4 / 3.6 -> the potting-shed lean-to roof (4.7 -> 6.0 m, 10 deg)
//               -> a parapet gap -> the roof;
//       east  — a painter's plank scaffold in the back alley 1.2 / 2.4 / 3.6 / 4.8 / 6.0 -> a parapet gap
//               -> the roof.
//     Perches (ROOF_PERCHES), each with its own field (share of the yard's open ground it can hit):
//     the south-west parapet corner (patio path, picnic table, centre, west: 58 %), the crow's nest (the
//     corgi half + centre; the swing-set beam hides the far south from it: 49 %), the south-east gutter
//     corner (slide-tower core, swing set, east lawn, pond: 32 %); 70 % together. A 0.6 m parapet covers a
//     sniper's chest but not its head; every perch is exposed to the other route's arrival; both species
//     reach every perch by both routes (tests/unit/world-districts.test.ts).
//
// Everything solid goes through the Kit (visual prim + a collider with the same box); thin dressing
// (tools, pipes, antenna, decals) is visual only. Pure data: no rng (so adding the district does not shift
// the West Yard's random stream), no three, no Math.random.
import type { Bookmark, District, Lamp, Perch } from './world-types';
import type { Kit, Frame, PrimOpts } from './kit';
import type { SurfaceOp, TerrainOp } from './terrain';

type HeightFn = (x: number, z: number) => number;

/** Building center = origin of the local frame (yaw 0: local +x = east, +z = south, toward the yard). */
export const GARAGE = { x: 81, z: -59 };
const HX = 13, HZ = 11;                  // outer half extents (26 x 22 m)
const T = 0.6;                           // wall thickness
export const GARAGE_FLOOR = 0.2;         // concrete slab top
export const GARAGE_WALL = 6.6;          // wall top = roof slab underside (clear height 6.4 m)
export const GARAGE_ROOF = 7.2;          // walking surface of the flat roof
// Parapet: 0.6 m hides a sniper's chest but not its head (a 0.9 m parapet hid the whole character from the
// ground at >= 30 m while its aim pivot, 1.25 m above the feet, still cleared it: an unassailable nest).
const PARA = 0.6, PT = 0.5;              // parapet height above the roof, thickness
const F0 = GARAGE_FLOOR, WALL = GARAGE_WALL, ROOF = GARAGE_ROOF;

/** Door openings in local coordinates: span [a, b] along the wall, opening top y. */
const ROLLUP = { a: -6, b: 6, top: 3.8 };      // south wall (x span): the half-open roll-up door
const SIDE = { a: 4.4, b: 7.2, top: 3.4 };     // west wall (z span)
const PET = { a: 7.4, b: 10.0, top: 2.4 };     // north wall (x span): a giant pet door
/** Parapet gaps where the climb routes arrive (local, along the wall). */
const GAP_W = { a: -7.4, b: -4.4 };            // west parapet (z span): from the lean-to roof
const GAP_E = { a: -2.4, b: 0.6 };             // east parapet (z span): from the scaffold
/** Roof openings (local rects x0, x1, z0, z1). */
const HATCH: Rect = [3.8, 6.6, -2.4, 0.4];     // open hatch above the car's cabin (drop in)
const SKY_A: Rect = [-7.0, -3.4, -6.2, -2.8];  // slatted skylights (walkable, sun stripes inside)
const SKY_B: Rect = [-1.8, 1.8, 3.4, 6.8];
/** The lean-to potting shed (local x0, x1, z0, z1) and its roof line: y 6.0 at the garage wall. */
const LEAN = { x0: -20, x1: -HX, z0: -11, z1: -1, wall: 4.3, hi: 6.0, lo: 4.8, over: 0.4 };
/** Scaffold planks (east alley): top 1.2 k, x [13.3, 15.3], centered at SCAF_Z[k-1], 2.4 m long. */
const SCAF_X0 = 13.3, SCAF_X1 = 15.3, SCAF_Z = [9.6, 7.05, 4.5, 1.95, -0.6];
/** Crate stair (west): columns of 1 / 2 / 3 crates (1.2 m each) rising north toward the lean-to eave. */
const CRATE_X = -21.8, CRATE_Z = [-2.2, -4.8, -7.4];
/** Crow's nest platform (local rect) and top. */
const NEST: Rect = [-12.0, -8.8, 0.0, 3.2];
const NEST_TOP = 9.6;
const AC: Rect = [-12.2, -8.6, -3.6, -0.8];
const AC_TOP = 8.4;
/** Ceiling joists (local x): clear of the hatch (x 3.8..6.6) and of the lamp tubes. */
const JOISTS = [-10.2, -4.2, 2.4, 8.0];

type Rect = [number, number, number, number];

const w = (lx: number, ly: number, lz: number): [number, number, number] => [GARAGE.x + lx, ly, GARAGE.z + lz];

export const GARAGE_DISTRICT: District = { id: 'garage', name: 'The Garage', minX: GARAGE.x - HX, maxX: GARAGE.x + HX, minZ: GARAGE.z - HZ, maxZ: GARAGE.z + HZ, maxY: WALL - 0.2 };
export const ROOFTOPS_DISTRICT: District = { id: 'rooftops', name: 'The Rooftops', minX: GARAGE.x - 24, maxX: GARAGE.x + 18.7, minZ: GARAGE.z - 13, maxZ: GARAGE.z + 13, minY: 3 };

/** Doorways (world): center of the opening at the outer wall face, outward normal, clear width/height. */
export const GARAGE_DOORS = [
  { id: 'rollup', x: GARAGE.x + (ROLLUP.a + ROLLUP.b) / 2, z: GARAGE.z + HZ, nx: 0, nz: 1, width: ROLLUP.b - ROLLUP.a, height: ROLLUP.top - F0 },
  { id: 'side', x: GARAGE.x - HX, z: GARAGE.z + (SIDE.a + SIDE.b) / 2, nx: -1, nz: 0, width: SIDE.b - SIDE.a, height: SIDE.top - F0 },
  { id: 'pet', x: GARAGE.x + (PET.a + PET.b) / 2, z: GARAGE.z - HZ, nx: 0, nz: -1, width: PET.b - PET.a, height: PET.top - F0 },
] as const;

/** Sniper perches (feet position, facing yaw 0 = -Z). */
export const ROOF_PERCHES: Perch[] = [
  { id: 'roof_parapet', name: 'West parapet nest', ...pos(w(-11.9, ROOF, 9.9)), yaw: yawTo(-11.9, 9.9, -40, 12), district: 'rooftops' },
  { id: 'roof_nest', name: "Satellite crow's nest", ...pos(w(-10.4, NEST_TOP, 1.5)), yaw: yawTo(-10.4, 1.5, -50, 30), district: 'rooftops' },
  { id: 'roof_gutter', name: 'South-east gutter corner', ...pos(w(11.9, ROOF, 9.9)), yaw: yawTo(11.9, 9.9, -2, 30), district: 'rooftops' },
];

function pos(p: [number, number, number]): { x: number; y: number; z: number } { return { x: p[0], y: p[1], z: p[2] }; }
function yawTo(x: number, z: number, tx: number, tz: number): number { return Math.atan2(-(tx - x), -(tz - z)); }

/** Standing points (world) of both climb routes, ground -> roof; tests hop-search every leg. */
export const ROOF_ROUTES: Record<'west' | 'east', [number, number, number][]> = {
  west: [
    w(CRATE_X - 0.2, 0, 1.6), w(CRATE_X, 1.2, CRATE_Z[0]), w(CRATE_X, 2.4, CRATE_Z[1]), w(CRATE_X, 3.6, CRATE_Z[2]),
    w(-19.6, leanTop(-19.6), -7.4), w(-13.45, leanTop(-13.45), -5.9), w(-11.4, ROOF, -5.9),
  ],
  east: [
    w(16.8, 0, 12.8), ...SCAF_Z.map((z, k) => w(14.3, 1.2 * (k + 1), z)), w(11.6, ROOF, -0.9),
  ],
};

/** Top of the lean-to roof at local x (the slope rises toward the garage wall). */
function leanTop(lx: number): number {
  return LEAN.lo + (lx - LEAN.x0) * ((LEAN.hi - LEAN.lo) / (LEAN.x1 - LEAN.x0));
}

export const GARAGE_BOOKMARKS: Bookmark[] = [
  { name: 'garage', pos: w(-5.5, 2.6, 9.6), look: w(4, 1.2, -8), fov: 70 },
  { name: 'garage_door', pos: w(6, 3.0, 27), look: w(0, 2.2, 8), fov: 62 },
  { name: 'garage_side', pos: w(-27, 2.4, 12), look: w(-13, 2.0, 5.8), fov: 62 },
  { name: 'garage_pet', pos: w(3, 2.6, -24), look: w(8.7, 1.4, -11), fov: 62 },
  { name: 'garage_breach', pos: w(18.2, 2.3, 4.5), look: w(13, 2.8, -6.5), fov: 64 },
  { name: 'garage_bench', pos: w(9.5, 3.0, 7.5), look: w(-8, 1.6, -8.5), fov: 70 },
  { name: 'rooftops', pos: w(-40, 18, 20), look: w(-1, 4, -1), fov: 55 },
  { name: 'roof_west', pos: w(-34, 3.4, 8), look: w(-18, 4.2, -6), fov: 62 },
  { name: 'roof_alley', pos: w(17.6, 2.2, 24), look: w(14.3, 4.2, 2), fov: 62 },
  { name: 'roof_top', pos: w(8, 13.5, 14), look: w(-6, 7.2, -3), fov: 62 },
  // perch views: a third-person camera behind and ~2 m above the sniper's feet, looking down its lanes
  // (the crow's nest camera sits closer: the dish and the antenna mast are right behind that perch)
  ...ROOF_PERCHES.map((p): Bookmark => {
    const fx = -Math.sin(p.yaw), fz = -Math.cos(p.yaw), back = p.id === 'roof_nest' ? 0.7 : 2.6;
    return { name: p.id, pos: [p.x - fx * back, p.y + 2.0, p.z - fz * back], look: [p.x + fx * 40, p.y - 3, p.z + fz * 40], fov: 62 };
  }),
  // an enemy's eye on each perch from its lanes (cover vs exposure)
  { name: 'perch_parapet_seen', pos: [36, 2.2, -47], look: w(-11.9, ROOF + 0.8, 9.9), fov: 40 },
  { name: 'perch_nest_seen', pos: [42, 2.2, -70], look: w(-10.4, NEST_TOP + 0.6, 1.5), fov: 40 },
  { name: 'perch_gutter_seen', pos: [89, 2.2, -27], look: w(11.9, ROOF + 0.8, 9.9), fov: 45 },
];

/** Hanging fluorescent tubes inside the garage (the client draws them as glow tubes). */
export const GARAGE_LAMPS: Lamp[] = [
  [-7.2, -5.6], [-7.2, 4.6], [0.2, -1.0], [10.2, -3.6], [10.2, 6.2],
].map(([lx, lz]) => ({ x: GARAGE.x + lx, y: WALL - 0.55, z: GARAGE.z + lz, len: 3.0, yaw: 0, col: 'lampTube' }));

/** Terrain stamps + ground surfaces (merged into the West Yard spec). */
export function garageTerrain(): { ops: TerrainOp[]; surfaces: SurfaceOp[] } {
  const ops: TerrainOp[] = [
    { op: 'flat', x: GARAGE.x - 2.5, z: GARAGE.z - 1, hx: 21.5, hz: 13.5, h: 0, falloff: 5 },   // building, lean-to, crates, alley
  ];
  const surfaces: SurfaceOp[] = [
    { kind: 'dirt', shape: 'rect', x: GARAGE.x + 16.4, z: GARAGE.z + 1, hx: 2.2, hz: 12, soft: 1, amount: 0.75 },     // back alley
    { kind: 'dirt', shape: 'path', pts: [58, -38.5, 62, -46, 66.8, -53.2], width: 2.2, soft: 0.8, amount: 0.8 },      // patio path -> side door
    { kind: 'dirt', shape: 'rect', x: GARAGE.x + CRATE_X, z: GARAGE.z - 5, hx: 2.6, hz: 5, soft: 1, amount: 0.6 },  // worn by the crates
    { kind: 'dirt', shape: 'circle', x: GARAGE.x + 8.7, z: GARAGE.z - 14, r: 3.2, soft: 1.2, amount: 0.7 },         // pet-door flap wear
  ];
  return { ops, surfaces };
}

export interface GarageBuild {
  districts: District[];
  bookmarks: Bookmark[];
  lamps: Lamp[];
  perches: Perch[];
}

/** Builds the Garage + Rooftops props (visual prims + colliders) into the kit. */
export function buildGarage(kit: Kit, height: HeightFn): GarageBuild {
  const f = kit.frame(GARAGE.x, 0, GARAGE.z, 0);
  shell(f);
  roof(f);
  interior(f);
  leanTo(f);
  crates(f);
  scaffold(f);
  backLot(f, height);
  return {
    districts: [{ ...GARAGE_DISTRICT }, { ...ROOFTOPS_DISTRICT }],
    bookmarks: GARAGE_BOOKMARKS.map((b) => ({ ...b })),
    lamps: GARAGE_LAMPS.map((l) => ({ ...l })),
    perches: ROOF_PERCHES.map((p) => ({ ...p })),
  };
}

// ============================================================================ helpers

/** Solid box from min/max corners (local). */
function solidRect(f: Frame, type: string, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: string, o: PrimOpts = {}): void {
  f.solid(type, (x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col, o);
}

/** Visual-only box from min/max corners (local). */
function boxRect(f: Frame, x0: number, x1: number, y0: number, y1: number, z0: number, z1: number, col: string, o: PrimOpts = {}): void {
  f.box((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2, x1 - x0, y1 - y0, z1 - z0, col, o);
}

/** Rectangle minus holes, as a few merged rects (row strips, then equal strips merged vertically). */
export function rectMinusHoles(outer: Rect, holes: Rect[]): Rect[] {
  const [x0, x1, z0, z1] = outer;
  const uniq = (v: number[]) => [...new Set(v.map((n) => Math.round(n * 1000) / 1000))].sort((a, b) => a - b);
  const xs = uniq([x0, x1, ...holes.flatMap((h) => [h[0], h[1]])].filter((v) => v >= x0 && v <= x1));
  const zs = uniq([z0, z1, ...holes.flatMap((h) => [h[2], h[3]])].filter((v) => v >= z0 && v <= z1));
  const inHole = (x: number, z: number) => holes.some((h) => x > h[0] && x < h[1] && z > h[2] && z < h[3]);
  const out: Rect[] = [];
  let prev: Rect[] = [];
  for (let j = 0; j + 1 < zs.length; j++) {
    const row: Rect[] = [];
    for (let i = 0; i + 1 < xs.length; i++) {
      if (inHole((xs[i] + xs[i + 1]) / 2, (zs[j] + zs[j + 1]) / 2)) continue;
      const last = row[row.length - 1];
      if (last && last[1] === xs[i]) last[1] = xs[i + 1];
      else row.push([xs[i], xs[i + 1], zs[j], zs[j + 1]]);
    }
    // extend strips of the previous row that have the same x extent
    const next: Rect[] = [];
    for (const r of row) {
      const p = prev.find((q) => q[0] === r[0] && q[1] === r[1] && q[3] === r[2]);
      if (p) { p[3] = r[3]; next.push(p); } else { out.push(r); next.push(r); }
    }
    prev = next;
  }
  return out;
}

/**
 * A wall piece: collider = the full T-thick box; visual = a pale interior core plus exterior lap-siding
 * boards whose outer faces sit exactly on the collider face. axis 'x': runs along local x at z = c
 * (exterior toward +z when out = 1); axis 'z': runs along z at x = c.
 */
function wallPiece(f: Frame, axis: 'x' | 'z', c: number, a: number, b: number, y0: number, y1: number, out: 1 | -1): void {
  const len = b - a, mid = (a + b) / 2, h = y1 - y0, ym = (y0 + y1) / 2;
  if (len < 0.05 || h < 0.05) return;
  const put = (along: number, across: number, y: number, l: number, d: number, hh: number, col: string, o: PrimOpts = {}) => {
    if (axis === 'x') f.box(along, y, across, l, hh, d, col, o);
    else f.box(across, y, along, d, hh, l, col, o);
  };
  if (axis === 'x') f.colBox('garage', mid, ym, c, len, h, T);
  else f.colBox('garage', c, ym, mid, T, h, len);
  put(mid, c - out * 0.06, ym, len, T - 0.12, h, 'garageInside', { bev: 0.04 });
  const n = Math.max(1, Math.round(h / 1.1));
  for (let i = 0; i < n; i++) {
    const by0 = y0 + (h * i) / n + 0.04, by1 = y0 + (h * (i + 1)) / n;       // seam gap below each board
    put(mid, c + out * (T / 2 - 0.07), (by0 + by1) / 2, len, 0.14, by1 - by0, i % 2 ? 'garageSiding2' : 'garageSiding', { bev: 0.05 });
  }
}

/** Wall along one side with door gaps: full-height pieces between gaps, lintels above them. */
function wallWithGaps(f: Frame, axis: 'x' | 'z', c: number, a: number, b: number, out: 1 | -1, gaps: { a: number; b: number; top: number }[]): void {
  let s = a;
  for (const g of gaps) {
    wallPiece(f, axis, c, s, g.a, 0, WALL, out);
    wallPiece(f, axis, c, g.a, g.b, g.top, WALL, out);
    s = g.b;
  }
  wallPiece(f, axis, c, s, b, 0, WALL, out);
}

// ============================================================================ shell: floor, walls, doors

function shell(f: Frame): void {
  // floor slab + apron (the terrain under both is flattened to 0)
  solidRect(f, 'garage_floor', -HX, HX, -0.3, F0, -HZ, HZ, 'concrete', { bev: 0.06 });
  solidRect(f, 'garage_floor', -6.8, 6.8, -0.3, F0, HZ, HZ + 5.2, 'concrete', { bev: 0.06 });
  // floor decals (<= 1 cm above the slab)
  boxRect(f, -12.2, 12.2, F0, F0 + 0.01, -0.04, 0.04, 'stoneDark', { g: 'noink', bev: 0 });               // slab joint
  boxRect(f, -0.04, 0.04, F0, F0 + 0.01, -10.2, 10.2, 'stoneDark', { g: 'noink', bev: 0 });
  for (const x of [1.9, 8.5]) boxRect(f, x, x + 0.22, F0, F0 + 0.01, -6.4, 7.8, 'accentHot', { g: 'noink', bev: 0 });   // parking lines
  f.cyl(4.4, F0 + 0.005, 8.2, 1.3, 0.01, 1.3, 'oilStain', { seg: 14, g: 'noink' });
  f.cyl(-3.2, F0 + 0.005, -3.4, 0.55, 0.01, 0.55, 'stoneDark', { seg: 10, g: 'noink' });                     // floor drain
  for (let i = -2; i <= 2; i++) boxRect(f, -3.6, -2.8, F0, F0 + 0.012, -3.4 + i * 0.16 - 0.03, -3.4 + i * 0.16 + 0.03, 'catBlack', { g: 'noink', bev: 0 });
  boxRect(f, -6.8, 6.8, F0, F0 + 0.01, HZ + 2.4, HZ + 2.46, 'stoneDark', { g: 'noink', bev: 0 });          // apron joint
  f.cyl(-2.4, F0 + 0.005, HZ + 3.6, 0.9, 0.01, 1.2, 'oilStain', { seg: 12, g: 'noink' });

  // walls: south (roll-up), north (pet door), west (side door), east (solid, breach section)
  wallWithGaps(f, 'x', HZ - T / 2, -HX + T, HX - T, 1, [ROLLUP]);
  wallWithGaps(f, 'x', -HZ + T / 2, -HX + T, HX - T, -1, [PET]);
  wallWithGaps(f, 'z', -HX + T / 2, -HZ, HZ, -1, [SIDE]);
  wallWithGaps(f, 'z', HX - T / 2, -HZ, HZ, 1, []);
  // corner trims (solid)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.solid('garage', sx * (HX - 0.3), WALL / 2, sz * (HZ - 0.3), 0.9, WALL, 0.9, 'trim', { bev: 0.1 });
  // foundation band (visual, flush with the siding)
  for (const s of [-1, 1]) {
    boxRect(f, -HX + 0.6, HX - 0.6, 0, 0.45, s * HZ - 0.02, s * HZ + 0.02, 'concrete', { g: 'noink', bev: 0 });
    boxRect(f, s * HX - 0.02, s * HX + 0.02, 0, 0.45, -HZ + 0.6, HZ - 0.6, 'concrete', { g: 'noink', bev: 0 });
  }

  // roll-up door stuck half open: sectional panels fill the opening above 3.8 m (collider = the panels)
  {
    const z = HZ - T / 2, y0 = ROLLUP.top, y1 = WALL;
    f.colBox('garage_door', 0, (y0 + y1) / 2, z + 0.05, ROLLUP.b - ROLLUP.a, y1 - y0, 0.5);
    const n = 4, ph = (y1 - y0) / n;
    for (let i = 0; i < n; i++) {
      f.box(0, y0 + ph * (i + 0.5) + 0.025, z + 0.05, ROLLUP.b - ROLLUP.a, ph - 0.05, 0.5, i % 2 ? 'trim' : 'trimShade', { bev: 0.06 });
      for (let k = -2; k <= 2; k++) f.box(k * 2.3, y0 + ph * (i + 0.5), z + 0.31, 1.9, ph - 0.36, 0.03, 'trimShade', { g: 'noink', bev: 0 });
    }
    boxRect(f, ROLLUP.a, ROLLUP.b, y0 - 0.12, y0, z + 0.2, z + 0.32, 'catBlack', { g: 'noink', bev: 0 });   // rubber seal
    f.box(1.8, y0 + 0.35, z + 0.34, 1.2, 0.18, 0.1, 'metal', { bev: 0.04 });                                 // handle
    for (const x of [ROLLUP.a - 0.12, ROLLUP.b + 0.12]) f.box(x, (F0 + WALL) / 2, z - 0.35, 0.18, WALL - F0, 0.18, 'metal', { bev: 0.04 });  // tracks
    f.box(0, WALL - 0.5, 0.5, 0.18, 0.12, 20, 'metal', { bev: 0.03 });                                     // opener rail
    f.box(0, WALL - 0.55, -9.2, 1.4, 0.6, 1.0, 'catWhite', { bev: 0.12 });                                  // opener motor
  }
  // side door: leaf swung open flat against the outer wall (thin solid), frame trim
  {
    const x = -HX;
    f.solid('garage_door', x - 0.08, (F0 + SIDE.top) / 2 + 0.05, SIDE.a - 1.4, 0.16, SIDE.top - F0 - 0.2, 2.6, 'garageDoor', { bev: 0.05 });
    f.box(x - 0.2, SIDE.top - 1.3, SIDE.a - 2.3, 0.12, 0.2, 0.2, 'brass', { bev: 0.03 });
    for (const z of [SIDE.a - 0.08, SIDE.b + 0.08]) f.box(x - 0.02, (F0 + SIDE.top) / 2, z, 0.08, SIDE.top - F0, 0.16, 'trim', { bev: 0.03, g: 'noink' });
    f.box(x - 0.02, SIDE.top + 0.08, (SIDE.a + SIDE.b) / 2, 0.08, 0.16, SIDE.b - SIDE.a + 0.32, 'trim', { bev: 0.03, g: 'noink' });
    f.box(x - 0.03, SIDE.top + 1.0, (SIDE.a + SIDE.b) / 2, 0.06, 0.9, 2.2, 'catBlack', { g: 'noink', bev: 0 });     // sign plate
    f.box(x - 0.07, SIDE.top + 1.0, (SIDE.a + SIDE.b) / 2, 0.04, 0.24, 1.6, 'accentHot', { g: 'noink', bev: 0 });   // "KEEP OUT" stripe
  }
  // pet door: a giant hinged flap swung up and out (visual), frame + paw sign
  {
    const z = -HZ, cx = (PET.a + PET.b) / 2, pw = PET.b - PET.a;
    f.box(cx, PET.top + 0.1, z - 0.1, pw + 0.5, 0.2, 0.2, 'catGrey', { bev: 0.05 });
    for (const x of [PET.a - 0.12, PET.b + 0.12]) f.box(x, (F0 + PET.top) / 2, z - 0.1, 0.24, PET.top - F0, 0.2, 'catGrey', { bev: 0.05 });
    f.box(cx, PET.top + 0.2, z - 1.05, pw - 0.1, 0.12, 2.0, 'plasticBlue', { pitch: 0.17, bev: 0.05 });
    f.sphere(cx, PET.top + 0.9, z - 0.05, 0.42, 0.36, 0.06, 'corgiOrange', { seg: 10, g: 'noink' });            // paw print
    for (let k = 0; k < 3; k++) f.sphere(cx - 0.36 + k * 0.36, PET.top + 1.4 + (k === 1 ? 0.1 : 0), z - 0.05, 0.14, 0.14, 0.05, 'corgiOrange', { seg: 8, g: 'noink' });
  }
  // windows: small open slots high on the east and west walls (too small to climb through; let light in)
  for (const [x, z0, z1] of [[HX, -6.8, -4.4], [HX, 3.2, 5.6], [-HX, -1.6, 0.8]] as const) {
    const sx = Math.sign(x);
    f.box(x + sx * 0.02, 4.9, (z0 + z1) / 2, 0.08, 1.2, z1 - z0 + 0.3, 'trim', { g: 'noink', bev: 0 });
    f.box(x + sx * 0.05, 4.9, (z0 + z1) / 2, 0.06, 0.9, z1 - z0, 'glass', { g: 'noink', bev: 0 });
  }
  // east wall: boarded-up, cracked section (the future breach point; visual only)
  breachSection(f);
  // downpipes at the south corners + a scupper
  for (const sx of [-1, 1]) {
    f.cyl(sx * (HX - 1.1), (WALL + 0.9) / 2, HZ + 0.25, 0.22, WALL - 0.9, 0.22, 'catGrey', { seg: 8 });
    f.cyl(sx * (HX - 1.1), 0.45, HZ + 0.55, 0.22, 0.7, 0.22, 'catGrey', { seg: 8, pitch: 0.9 });
    f.box(sx * (HX - 1.1), ROOF - 0.1, HZ + 0.25, 0.7, 0.35, 0.5, 'catGrey', { bev: 0.05 });
  }
}

function breachSection(f: Frame): void {
  const x = HX, z0 = -9.4, z1 = -3.6, zc = (z0 + z1) / 2;
  // outside: two plywood sheets nailed over a hole, hazard-tape X, a spray-painted target, cracks
  f.box(x + 0.05, 2.6, zc - 1.3, 0.08, 4.2, 2.9, 'plywood', { roll: 0, yaw: 0, bev: 0.03 });
  f.box(x + 0.09, 3.0, zc + 1.4, 0.08, 3.6, 2.7, 'plywoodDark', { bev: 0.03, pitch: 0.06 });
  for (const s of [-1, 1]) f.box(x + 0.14, 2.9, zc, 0.04, 0.34, 6.8, 'accentHot', { pitch: s * 0.62, g: 'noink', bev: 0 });
  f.torus(x + 0.16, 2.9, zc, 1.35, 0.1, 'danger', { yaw: Math.PI / 2, seg: 20, g: 'noink' });
  f.torus(x + 0.16, 2.9, zc, 0.5, 0.09, 'danger', { yaw: Math.PI / 2, seg: 14, g: 'noink' });
  const cracks: [number, number, number, number][] = [[4.6, zc - 2.6, 0.9, 1.4], [4.9, zc + 2.8, 1.2, -1.2], [0.9, zc - 2.5, 0.8, 0.5], [0.7, zc + 2.7, 1.0, -0.8], [5.4, zc + 0.3, 1.1, 0.3]];
  for (const [y, z, len, rot] of cracks) f.box(x + 0.03, y, z, 0.04, 0.08, len, 'underDeck', { pitch: rot, g: 'noink', bev: 0 });
  // inside: exposed studs where the plaster broke off + cracked drywall
  const xi = HX - T;
  boxRect(f, xi - 0.02, xi + 0.02, 1.2, 4.8, z0 + 0.6, z1 - 0.6, 'underDeck', { g: 'noink', bev: 0 });
  for (const z of [z0 + 1.0, zc, z1 - 1.0]) f.box(xi - 0.08, 3.0, z, 0.16, 3.6, 0.3, 'fenceWood', { bev: 0.03 });
  f.box(xi - 0.06, 1.2, zc, 0.12, 0.2, z1 - z0 - 1.0, 'fenceWood', { bev: 0.03 });
  for (const [y, z, len, rot] of [[5.3, zc - 2.2, 1.0, 0.8], [0.8, zc + 2.3, 0.9, -0.6], [5.1, zc + 2.4, 0.8, -1.1]] as const) f.box(xi - 0.03, y, z, 0.04, 0.07, len, 'underDeck', { pitch: rot, g: 'noink', bev: 0 });
  // rubble at the foot of the wall (visual, low)
  for (let i = 0; i < 4; i++) f.cyl(xi - 0.7 - (i % 2) * 0.4, F0 + 0.005, z0 + 1.2 + i * 1.1, 0.5, 0.01, 0.35, i % 2 ? 'garageInside' : 'stone', { seg: 9, g: 'noink' });
}

// ============================================================================ roof: slab, parapet, features

function roof(f: Frame): void {
  // slab (with the hatch hole and the two skylight cut-outs)
  for (const [x0, x1, z0, z1] of rectMinusHoles([-HX, HX, -HZ, HZ], [HATCH, SKY_A, SKY_B])) {
    f.colBox('roof_slab', (x0 + x1) / 2, (WALL + ROOF) / 2, (z0 + z1) / 2, x1 - x0, ROOF - WALL, z1 - z0);
    boxRect(f, x0, x1, WALL + 0.14, ROOF, z0, z1, 'roofTar', { bev: 0.04 });
    boxRect(f, x0 + 0.02, x1 - 0.02, WALL, WALL + 0.15, z0 + 0.02, z1 - 0.02, 'garageInside', { bev: 0.03 });   // pale ceiling
  }
  // exposed ceiling joists (north-south), clear of the hatch; they cross under skylight A (shadow bars)
  for (const x of JOISTS) solidRect(f, 'roof_slab', x - 0.15, x + 0.15, WALL - 0.3, WALL, -HZ + T, HZ - T, 'fenceWood', { bev: 0.05 });
  // parapet with gaps where the climb routes arrive (siding-colored, trim cap)
  const par = (x0: number, x1: number, z0: number, z1: number) => {
    solidRect(f, 'parapet', x0, x1, ROOF, ROOF + PARA - 0.12, z0, z1, 'garageSiding', { bev: 0.06 });
    solidRect(f, 'parapet', x0 - 0.04, x1 + 0.04, ROOF + PARA - 0.12, ROOF + PARA, z0 - 0.04, z1 + 0.04, 'trim', { bev: 0.04 });
  };
  par(-HX, HX, HZ - PT, HZ);                                    // south
  par(-HX, HX, -HZ, -HZ + PT);                                  // north
  par(-HX, -HX + PT, -HZ + PT, GAP_W.a); par(-HX, -HX + PT, GAP_W.b, HZ - PT);   // west (gap)
  par(HX - PT, HX, -HZ + PT, GAP_E.a); par(HX - PT, HX, GAP_E.b, HZ - PT);       // east (gap)
  // hazard stripes on the roof edge at the parapet gaps (readable arrival points)
  for (const [x, z0, z1] of [[-HX + 0.25, GAP_W.a, GAP_W.b], [HX - 0.25, GAP_E.a, GAP_E.b]] as const) {
    for (let k = 0; k < 4; k++) {
      const za = z0 + ((z1 - z0) * k) / 4;
      f.box(x, ROOF + 0.005, za + (z1 - z0) / 8, 0.5, 0.01, (z1 - z0) / 8, 'accentHot', { g: 'noink', bev: 0 });
    }
  }

  // hatch: curb around the hole + the lid propped open (standing up, leaning north): cover on the roof
  {
    const [x0, x1, z0, z1] = HATCH, c = 0.3, h = 0.3;
    solidRect(f, 'hatch', x0 - c, x1 + c, ROOF, ROOF + h, z0 - c, z0, 'metal', { bev: 0.05 });
    solidRect(f, 'hatch', x0 - c, x1 + c, ROOF, ROOF + h, z1, z1 + c, 'metal', { bev: 0.05 });
    solidRect(f, 'hatch', x0 - c, x0, ROOF, ROOF + h, z0, z1, 'metal', { bev: 0.05 });
    solidRect(f, 'hatch', x1, x1 + c, ROOF, ROOF + h, z0, z1, 'metal', { bev: 0.05 });
    const lidH = 2.6, tilt = 0.28;                               // leans back 16 deg from vertical
    f.solid('hatch', (x0 + x1) / 2, ROOF + h + (lidH / 2) * Math.cos(tilt), z0 - c - 0.1 - (lidH / 2) * Math.sin(tilt), x1 - x0 + 0.4, lidH, 0.18, 'metal', { pitch: tilt, bev: 0.05 });
    f.box((x0 + x1) / 2, ROOF + h + 1.3, z0 - c - 0.1 - 0.37 + 0.1, 1.6, 0.9, 0.04, 'accentHot', { pitch: tilt, g: 'noink', bev: 0 });
  }
  // slatted skylights: frame + slats (0.35 wide, 0.35 gaps) — walkable, stripes of sun inside
  for (const [x0, x1, z0, z1] of [SKY_A, SKY_B]) {
    const fr = 0.3;
    solidRect(f, 'skylight', x0, x1, WALL, ROOF + 0.1, z0, z0 + fr, 'metal', { bev: 0.04 });
    solidRect(f, 'skylight', x0, x1, WALL, ROOF + 0.1, z1 - fr, z1, 'metal', { bev: 0.04 });
    solidRect(f, 'skylight', x0, x0 + fr, WALL, ROOF + 0.1, z0 + fr, z1 - fr, 'metal', { bev: 0.04 });
    solidRect(f, 'skylight', x1 - fr, x1, WALL, ROOF + 0.1, z0 + fr, z1 - fr, 'metal', { bev: 0.04 });
    const inner = z1 - z0 - 2 * fr, n = Math.floor((inner + 0.35) / 0.7);
    const start = z0 + fr + (inner - (n * 0.7 - 0.35)) / 2;
    for (let i = 0; i < n; i++) solidRect(f, 'skylight', x0 + fr, x1 - fr, ROOF - 0.25, ROOF, start + i * 0.7, start + i * 0.7 + 0.35, 'catGrey', { bev: 0.03 });
  }
  // AC unit (step to the crow's nest) with a fan grille on top
  {
    const [x0, x1, z0, z1] = AC, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    solidRect(f, 'roof_ac', x0, x1, ROOF, AC_TOP, z0, z1, 'catWhite', { bev: 0.18 });
    f.cyl(cx, AC_TOP + 0.01, cz, 1.05, 0.02, 1.05, 'metal', { seg: 18, g: 'noink' });
    f.torus(cx, AC_TOP + 0.03, cz, 1.05, 0.06, 'catGrey', { pitch: Math.PI / 2, seg: 18, g: 'noink' });
    for (const s of [-1, 1]) f.box(cx, AC_TOP + 0.03, cz, 1.9, 0.02, 0.12, 'catGrey', { yaw: s * 0.7, g: 'noink', bev: 0 });
    for (let k = 0; k < 4; k++) f.box(x1 + 0.01, ROOF + 0.25 + k * 0.24, cz, 0.03, 0.06, z1 - z0 - 0.5, 'metal', { g: 'noink', bev: 0 });
    f.cyl(x0 + 0.3, ROOF + 0.25, z0 - 0.4, 0.12, 0.2, 0.12, 'metal', { seg: 6 });                                 // pipes
    f.box(x0 + 0.3, ROOF + 0.12, (z0 - 0.4 + z0) / 2 - 1.2, 0.2, 0.18, 2.8, 'metal', { bev: 0.04, g: 'noink' });
  }
  // crow's nest: steel platform on legs (walk-under), a satellite dish on its east edge (partial cover),
  // a TV antenna mast (silhouette)
  {
    const [x0, x1, z0, z1] = NEST;
    solidRect(f, 'roof_nest', x0, x1, NEST_TOP - 0.3, NEST_TOP, z0, z1, 'metal', { bev: 0.06 });
    for (const [x, z] of [[x0 + 0.25, z0 + 0.25], [x1 - 0.25, z0 + 0.25], [x0 + 0.25, z1 - 0.25], [x1 - 0.25, z1 - 0.25]]) {
      solidRect(f, 'roof_nest', x - 0.14, x + 0.14, ROOF, NEST_TOP - 0.3, z - 0.14, z + 0.14, 'catGrey', { bev: 0.04 });
    }
    for (const s of [-1, 1]) f.box((x0 + x1) / 2, (ROOF + NEST_TOP) / 2 - 0.2, s > 0 ? z1 - 0.25 : z0 + 0.25, x1 - x0 - 0.6, 0.08, 0.08, 'catGrey', { roll: s * 0.55, g: 'noink', bev: 0 });
    for (let k = 1; k < 5; k++) f.box(x0 + (k * (x1 - x0)) / 5, NEST_TOP + 0.005, (z0 + z1) / 2, 0.05, 0.01, z1 - z0 - 0.2, 'catGrey', { g: 'noink', bev: 0 });
    // dish on the platform's east edge, facing east-south-east and tilted up 35 deg: cover from the roof's
    // east half (scaffold arrival) and the alley; the yard side (W, SW, S) stays open. Collider = the dish's
    // backing plate box (same transform).
    const d = f.sub(x1 - 0.55, NEST_TOP, (z0 + z1) / 2 + 0.35, 1.22), tilt = -0.6, dy = 1.25;
    d.cyl(0, 0.45, -0.35, 0.12, 0.9, 0.16, 'catGrey', { seg: 8 });
    d.solid('roof_dish', 0, dy, 0, 2.3, 2.3, 0.3, 'catWhite', { pitch: tilt, bev: 0.14 });
    d.sphere(0, dy + 0.1 * Math.sin(-tilt), 0.1 * Math.cos(-tilt), 1.08, 1.08, 0.3, 'catWhite', { pitch: tilt, seg: 16 });
    d.cyl(0, dy + 0.6, 0.75, 0.05, 1.5, 0.05, 'catGrey', { pitch: 0.9, seg: 5 });
    d.box(0, dy + 1.0, 1.25, 0.26, 0.26, 0.32, 'catGrey', { bev: 0.05 });
    d.box(0.7, dy - 0.3, 0.16, 0.5, 0.36, 0.05, 'danger', { pitch: tilt, g: 'noink', bev: 0 });                 // logo sticker
    // antenna mast on the north-east corner
    const ax = x1 - 0.35, az = z0 + 0.35;
    f.cyl(ax, NEST_TOP + 1.9, az, 0.07, 3.8, 0.09, 'metal', { seg: 6 });
    for (const [y, l] of [[NEST_TOP + 2.6, 2.4], [NEST_TOP + 3.2, 1.9], [NEST_TOP + 3.7, 1.4]] as const) f.box(ax, y, az, l, 0.07, 0.07, 'metal', { yaw: 0.5, bev: 0 });
    f.box(ax, NEST_TOP + 3.0, az, 0.07, 0.07, 1.6, 'metal', { yaw: 0.5, bev: 0 });
    // a forgotten cushion + binoculars (the sniper's nest)
    f.solid('roof_nest', x0 + 0.9, NEST_TOP + 0.08, (z0 + z1) / 2 - 0.5, 1.1, 0.16, 1.1, 'teamCorgisTrim', { g: 'soft', bev: 0.07 });
  }
  // vent stack (south-east corner cover) with a rain cap
  f.solidCyl('roof_vent', 10.4, ROOF + 1.0, 7.8, 0.55, 2.0, 0.55, 'metal', { seg: 12 });
  f.solidCyl('roof_vent', 10.4, ROOF + 2.25, 7.8, 0.9, 0.2, 0.9, 'catGrey', { seg: 12 });
  for (let k = 0; k < 3; k++) f.box(10.4 + Math.cos(k * 2.1) * 0.45, ROOF + 2.07, 7.8 + Math.sin(k * 2.1) * 0.45, 0.08, 0.15, 0.08, 'catGrey', { bev: 0 });
  // roofing shingle bundles at the west parapet nest (low cover) + a tarp roll
  solidRect(f, 'roof_bundle', -12.4, -10.8, ROOF, ROOF + 0.6, 6.2, 8.6, 'roof', { bev: 0.08 });
  f.box(-11.6, ROOF + 0.61, 7.4, 1.62, 0.02, 0.3, 'catWhite', { g: 'noink', bev: 0 });
  f.solid('roof_bundle', -6.5, ROOF + 0.15, 9.4, 2.6, 0.3, 1.4, 'teamCorgis', { yaw: 0.12, bev: 0.1 });       // folded tarp
  // a roof drain + gravel patches (decals)
  f.cyl(0, ROOF + 0.01, -8, 0.4, 0.02, 0.4, 'catBlack', { seg: 10, g: 'noink' });
  for (const [x, z, r] of [[-3, -8.5, 1.4], [8, 3.5, 1.1], [-8.8, 8.2, 0.9], [4.5, 8.8, 1.2]] as const) f.cyl(x, ROOF + 0.005, z, r, 0.01, r * 0.8, 'roofGravel', { seg: 10, g: 'noink' });
}

// ============================================================================ interior

function interior(f: Frame): void {
  car(f, 5.2, 0.4);
  // workbench along the north wall: wooden top on a drawer cabinet, pegboard + tools above
  {
    const x0 = -11.8, x1 = -3.6, z0 = -HZ + T, z1 = z0 + 2.4, top = 1.9;
    f.colBox('bench', (x0 + x1) / 2, (F0 + top) / 2, (z0 + z1) / 2, x1 - x0, top - F0, z1 - z0);
    boxRect(f, x0, x1, F0, top - 0.16, z0, z1 - 0.02, 'fenceDark2', { bev: 0.08 });
    boxRect(f, x0, x1, top - 0.16, top, z0, z1, 'fenceWood', { bev: 0.06 });
    for (let i = 0; i < 4; i++) {
      const xa = x0 + 0.3 + i * 2.0;
      for (let r = 0; r < 2; r++) {
        boxRect(f, xa, xa + 1.7, 0.45 + r * 0.65, 1.0 + r * 0.65, z1 - 0.02, z1 + 0.02, 'fenceWood', { g: 'noink', bev: 0 });
        f.box(xa + 0.85, 0.72 + r * 0.65, z1 + 0.05, 0.5, 0.08, 0.06, 'metal', { g: 'noink', bev: 0 });
      }
    }
    f.solid('bench', x0 + 1.6, top + 0.4, z0 + 1.0, 1.8, 0.8, 0.9, 'toolRed', { bev: 0.1 });                  // toolbox
    f.box(x0 + 1.6, top + 0.9, z0 + 1.0, 1.0, 0.12, 0.12, 'catBlack', { bev: 0.03 });
    f.solid('bench', x1 - 1.0, top + 0.3, z1 - 0.4, 0.6, 0.6, 0.8, 'metal', { bev: 0.06 });                   // vise
    f.box(x1 - 1.0, top + 0.45, z1 + 0.15, 0.08, 0.08, 0.9, 'metal', { roll: Math.PI / 2, bev: 0 });
    // pegboard + tool silhouettes (hammer, wrench, saw, pliers, spirit level)
    solidRect(f, 'bench', x0 + 0.2, x1 - 0.2, 2.3, 5.0, z0, z0 + 0.1, 'pegboard', { bev: 0.03 });
    const zt = z0 + 0.16;
    f.box(x0 + 1.2, 3.6, zt, 0.16, 1.5, 0.06, 'fenceWood', { bev: 0.02 });
    f.box(x0 + 1.2, 4.35, zt, 0.7, 0.28, 0.1, 'metal', { bev: 0.04 });
    f.box(x0 + 2.6, 3.7, zt, 0.2, 1.6, 0.06, 'metal', { roll: 0.3, bev: 0.02 });
    f.torus(x0 + 2.85, 4.45, zt, 0.22, 0.07, 'metal', { seg: 10, arc: Math.PI * 1.5 });
    f.box(x0 + 4.4, 3.6, zt, 2.0, 0.6, 0.04, 'metal', { roll: -0.15, bev: 0.02 });
    f.box(x0 + 3.5, 3.72, zt, 0.5, 0.45, 0.1, 'toolRed', { roll: -0.15, bev: 0.06 });
    f.box(x0 + 6.3, 3.5, zt, 0.14, 1.1, 0.06, 'metal', { roll: 0.25, bev: 0.02 });
    f.box(x0 + 6.6, 3.5, zt, 0.14, 1.1, 0.06, 'metal', { roll: -0.25, bev: 0.02 });
    f.box(x0 + 4.4, 2.75, zt, 3.0, 0.22, 0.1, 'accentHot', { bev: 0.04 });
    f.box(x0 + 4.4, 2.75, zt + 0.06, 0.4, 0.12, 0.02, 'tennisBall', { g: 'noink', bev: 0 });
  }
  // wall of shelving (west wall): two tall units full of boxes, cans and bins (solid block)
  {
    const x0 = -HX + T, x1 = x0 + 2.2, z0 = -7.6, z1 = 3.0, top = 5.2;
    f.colBox('shelf', (x0 + x1) / 2, (F0 + top) / 2, (z0 + z1) / 2, x1 - x0, top - F0, z1 - z0);
    boxRect(f, x0, x0 + 0.12, F0, top, z0, z1, 'underDeck', { g: 'noink', bev: 0 });                       // back panel
    const levels = [F0 + 0.3, 1.5, 2.7, 3.9, top];
    for (const y of levels) boxRect(f, x0, x1, y - 0.1, y, z0, z1, 'metal', { bev: 0.03 });
    for (const z of [z0 + 0.08, (z0 + z1) / 2, z1 - 0.08]) for (const x of [x0 + 0.08, x1 - 0.08]) f.box(x, (F0 + top) / 2, z, 0.14, top - F0, 0.14, 'catGrey', { bev: 0.03 });
    const items = ['cardboard', 'plasticBlue', 'cardboardDark', 'teamCorgisTrim', 'cardboard', 'hoseGreen', 'catWhite'];
    let k = 0;
    for (let l = 0; l < 4; l++) {
      const y0 = levels[l];
      let z = z0 + 0.35;
      while (z < z1 - 1.0) {
        const wdt = 1.1 + ((k * 7) % 5) * 0.18, hgt = 0.7 + ((k * 3) % 4) * 0.08, col = items[k % items.length];
        if (k % 4 === 2) { for (let c = 0; c < 2; c++) f.cyl(x1 - 0.55, y0 + 0.4, z + 0.3 + c * 0.62, 0.3, 0.8, 0.3, c ? 'danger' : 'teamCorgis', { seg: 10 }); }
        else f.box(x1 - 0.2 - 0.85, y0 + hgt / 2, z + wdt / 2, 1.6, hgt, wdt - 0.1, col, { bev: 0.06 });
        z += wdt + 0.15; k++;
      }
    }
  }
  // rolling tool chest (mid-room cover), casters, drawer lines
  {
    const x0 = -7.0, x1 = -4.0, z0 = 1.2, z1 = 3.2, y0 = 0.45, top = 2.2;
    solidRect(f, 'toolchest', x0, x1, y0, top, z0, z1, 'toolRed', { bev: 0.12 });
    for (let r = 0; r < 4; r++) f.box((x0 + x1) / 2, y0 + 0.25 + r * 0.38, z1 + 0.02, x1 - x0 - 0.4, 0.05, 0.03, 'catBlack', { g: 'noink', bev: 0 });
    for (let r = 0; r < 4; r++) f.box((x0 + x1) / 2, y0 + 0.4 + r * 0.38, z1 + 0.05, 1.2, 0.07, 0.06, 'metal', { g: 'noink', bev: 0 });
    for (const x of [x0 + 0.3, x1 - 0.3]) for (const z of [z0 + 0.3, z1 - 0.3]) f.cyl(x, (F0 + y0) / 2, z, 0.14, y0 - F0, 0.14, 'catBlack', { roll: Math.PI / 2, seg: 8 });
    f.box((x0 + x1) / 2, top + 0.2, z0 + 0.3, x1 - x0 - 0.3, 0.4, 0.1, 'metal', { bev: 0.03 });
  }
  // paint-can pyramid inside the roll-up door (west jamb)
  const can = (x: number, y: number, z: number, col: string) => {
    f.solidCyl('paint', x, y + 0.5, z, 0.6, 1.0, 0.6, 'metal', { seg: 14 });
    f.cyl(x, y + 0.45, z, 0.62, 0.5, 0.62, col, { seg: 14 });
    f.cyl(x, y + 1.005, z, 0.5, 0.01, 0.5, col, { seg: 12, g: 'noink' });
  };
  can(-9.6, F0, 8.0, 'teamCorgis'); can(-8.4, F0, 8.0, 'accentHot'); can(-9.0, F0, 9.04, 'danger');
  can(-9.0, F0 + 1.0, 8.35, 'tealLight');
  f.sphere(-8.4, F0 + 0.03, 8.9, 0.8, 0.03, 0.55, 'accentHot', { seg: 10, g: 'noink' });                      // spill
  // chest freezer (east wall) + a bike hung above it
  {
    const x0 = HX - T - 2.0, x1 = HX - T, z0 = 1.8, z1 = 6.4, top = 2.0;
    solidRect(f, 'freezer', x0, x1, F0, top, z0, z1, 'catWhite', { bev: 0.16 });
    f.box((x0 + x1) / 2, top - 0.25, (z0 + z1) / 2, x1 - x0 + 0.02, 0.05, z1 - z0 + 0.02, 'catGrey', { g: 'noink', bev: 0 });
    f.box(x0 - 0.04, top - 0.45, (z0 + z1) / 2, 0.08, 0.14, 1.2, 'metal', { bev: 0.03 });
    const bx = HX - T - 0.12;
    for (const z of [z0 + 0.8, z1 - 0.8]) f.torus(bx, 4.2, z, 0.95, 0.09, 'catBlack', { yaw: Math.PI / 2, seg: 18 });
    f.box(bx, 4.5, (z0 + z1) / 2, 0.1, 0.12, 2.4, 'teamCats', { roll: 0, pitch: 0.25, bev: 0.03 });
    f.box(bx, 4.2, (z0 + z1) / 2 + 0.3, 0.1, 0.12, 1.8, 'teamCats', { pitch: -0.5, bev: 0.03 });
    f.box(bx - 0.1, 5.2, (z0 + z1) / 2 - 0.2, 0.2, 0.12, 0.7, 'catBlack', { bev: 0.04 });
  }
  // cardboard boxes by the pet door (screen it from the roll-up door)
  const carton = (x: number, z: number, sx: number, h: number, sz: number, yaw: number, y0 = F0) => {
    f.solid('box', x, y0 + h / 2, z, sx, h, sz, 'cardboard', { yaw, bev: 0.08 });
    f.box(x, y0 + h + 0.01, z, 0.3, 0.02, sz + 0.02, 'cardboardDark', { yaw, g: 'noink', bev: 0 });
  };
  carton(6.3, -8.7, 2.6, 2.4, 2.4, 0.08);
  carton(3.4, -9.1, 2.0, 1.7, 2.0, -0.12);
  carton(6.2, -8.8, 1.8, 1.4, 1.8, 0.35, F0 + 2.4);
  // push lawn mower (deck + grass bag solid; handle visual)
  {
    const cx = -1.0, cz = -7.8;
    solidRect(f, 'mower', cx - 1.1, cx + 1.1, F0, F0 + 1.2, cz - 1.3, cz + 1.3, 'hoseGreen', { bev: 0.25 });
    solidRect(f, 'mower', cx - 0.9, cx + 0.9, F0, F0 + 1.5, cz + 1.3, cz + 2.7, 'catGrey', { bev: 0.3 });
    for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.cyl(cx + sx * 1.15, F0 + 0.4, cz + sz * 0.9, 0.4, 0.2, 0.4, 'catBlack', { roll: Math.PI / 2, seg: 10 });
    for (const sx of [-1, 1]) f.cyl(cx + sx * 0.8, F0 + 2.0, cz + 2.6, 0.07, 2.6, 0.07, 'metal', { pitch: 0.55, seg: 6 });
    f.box(cx, F0 + 3.05, cz + 3.35, 1.8, 0.14, 0.14, 'catBlack', { bev: 0.04 });
    f.cyl(cx, F0 + 1.25, cz - 0.2, 0.35, 0.12, 0.35, 'catBlack', { seg: 10 });
  }
  // tennis ball on a string over the hood: the classic parking aid (visual)
  f.cyl(5.2, (WALL + 3.4) / 2, 5.0, 0.03, WALL - 3.4, 0.03, 'catWhite', { seg: 4, g: 'noink' });
  f.sphere(5.2, 3.2, 5.0, 0.36, 0.36, 0.36, 'tennisBall', { seg: 12 });
  // hanging fluorescent tube fixtures (the tubes themselves glow: WorldData.lamps, client lamps view)
  for (const l of GARAGE_LAMPS) {
    const lx = l.x - GARAGE.x, lz = l.z - GARAGE.z;
    f.cyl(lx, F0 + 0.004, lz, 1.9, 0.008, 1.9, 'lampPool', { seg: 18, g: 'noink', yaw: 0 });
    f.box(lx, l.y + 0.2, lz, 0.5, 0.14, l.len + 0.3, 'catWhite', { bev: 0.04 });
    for (const s of [-1, 1]) f.cyl(lx, (l.y + 0.27 + WALL) / 2, lz + s * (l.len / 2 - 0.2), 0.025, WALL - l.y - 0.27, 0.025, 'metal', { seg: 4, g: 'noink' });
  }
}

/** Parked hatchback, nose toward the roll-up door (local center cx, cz). Colliders = the body boxes. */
function car(f: Frame, cx: number, cz: number): void {
  const bx0 = cx - 2.7, bx1 = cx + 2.7, bz0 = cz - 5.4, bz1 = cz + 5.4, belt = 2.4, sill = 0.95;
  // wheel block (underbody + wheels), body, cabin (a tall hatchback cabin running almost to the tail)
  solidRect(f, 'car', cx - 2.35, cx + 2.35, F0, sill, bz0 + 0.6, bz1 - 0.6, 'carDark', { bev: 0.1 });
  solidRect(f, 'car', bx0, bx1, sill, belt, bz0, bz1, 'carBody', { bev: 0.55 });
  const cz0 = bz0 + 0.4, cz1 = cz + 1.4, top = 4.1;
  solidRect(f, 'car', cx - 2.35, cx + 2.35, belt, top, cz0, cz1, 'carBody', { bev: 0.7 });
  // bumpers (solid), wheels with hubcaps, round headlights, taillights
  for (const [z0, z1] of [[bz1, bz1 + 0.35], [bz0 - 0.35, bz0]]) solidRect(f, 'car', bx0 + 0.15, bx1 - 0.15, 0.75, 1.35, z0, z1, 'catWhite', { bev: 0.14 });
  for (const sx of [-1, 1]) for (const wz of [bz0 + 1.9, bz1 - 1.9]) {
    f.cyl(cx + sx * 2.0, F0 + 0.75, wz, 0.75, 0.7, 0.75, 'catBlack', { roll: Math.PI / 2, seg: 16 });
    f.cyl(cx + sx * 2.37, F0 + 0.75, wz, 0.38, 0.06, 0.38, 'catWhite', { roll: Math.PI / 2, seg: 12 });
  }
  for (const sx of [-1, 1]) {
    f.cyl(cx + sx * 1.75, 1.8, bz1 + 0.02, 0.5, 0.08, 0.5, 'catWhite', { pitch: Math.PI / 2, seg: 14 });           // headlights
    f.cyl(cx + sx * 1.75, 1.8, bz1 + 0.07, 0.3, 0.04, 0.3, 'accentHot', { pitch: Math.PI / 2, seg: 12, g: 'noink' });
    f.box(cx + sx * 1.9, 1.85, bz0 - 0.02, 0.9, 0.5, 0.06, 'danger', { g: 'noink', bev: 0 });                       // taillights
    // side windows: front door + rear, split by a B-pillar
    const wy = (belt + top) / 2 + 0.1;
    f.box(cx + sx * 2.37, wy, cz1 - 1.55, 0.06, 1.05, 2.3, 'glass', { g: 'noink', bev: 0 });
    f.box(cx + sx * 2.37, wy, cz0 + 1.9, 0.06, 1.05, 2.4, 'glass', { g: 'noink', bev: 0 });
    f.box(cx + sx * 2.38, 1.7, (bz0 + bz1) / 2, 0.05, 0.08, bz1 - bz0 - 1.2, 'catWhite', { g: 'noink', bev: 0 });   // pinstripe
  }
  f.box(cx, (belt + top) / 2 + 0.1, cz1 + 0.02, 3.9, 1.15, 0.06, 'glass', { g: 'noink', bev: 0 });                // windshield
  f.box(cx, (belt + top) / 2 + 0.15, cz0 - 0.02, 3.6, 1.0, 0.06, 'glass', { g: 'noink', bev: 0 });                 // hatch glass
  f.box(cx, 1.1, bz1 + 0.37, 1.4, 0.45, 0.04, 'trim', { g: 'noink', bev: 0 });                                     // plate
  f.box(cx, 1.1, bz1 + 0.39, 1.0, 0.12, 0.02, 'catBlack', { g: 'noink', bev: 0 });
  f.box(cx, 1.8, bz1 + 0.01, 1.6, 0.35, 0.04, 'carDark', { g: 'noink', bev: 0 });                                  // grille
  // roof rails (solid, low) + a dangling toy mouse on the mirror (visual)
  for (const sx of [-1, 1]) f.solid('car', cx + sx * 1.8, top + 0.08, (cz0 + cz1) / 2, 0.14, 0.16, cz1 - cz0 - 1.4, 'metal', { bev: 0.04 });
  f.sphere(cx + 0.5, 3.3, cz1 - 0.5, 0.18, 0.14, 0.28, 'catGrey', { seg: 8 });
}

// ============================================================================ lean-to potting shed (west)

function leanTo(f: Frame): void {
  const { x0, x1, z0, z1, wall, over } = LEAN;
  // closed shed body (collider = the block) + gable board fill under the sloped roof
  solidRect(f, 'leanto', x0, x1, 0, wall, z0, z1, 'shedSage', { bev: 0.1 });
  for (const z of [z0, z1]) {
    for (let i = 0; i < 3; i++) {
      const y = wall + 0.2 + i * 0.4, xs = x0 + ((y + 0.35 - LEAN.lo) / (LEAN.hi - LEAN.lo)) * (x1 - x0);
      if (xs < x1 - 0.3) f.box((Math.max(xs, x0) + x1) / 2, y, z + (z === z0 ? 0.2 : -0.2), x1 - Math.max(xs, x0), 0.4, 0.4, 'shedSageDark', { bev: 0.05 });
    }
  }
  // battens + corner trim
  for (let x = x0 + 1.2; x < x1 - 0.5; x += 1.5) for (const z of [z0, z1]) f.box(x, wall / 2, z, 0.2, wall - 0.3, 0.06, 'shedSageDark', { g: 'noink', bev: 0 });
  for (const z of [z0, z1]) f.box(x0, wall / 2, z, 0.3, wall, 0.3, 'trim', { bev: 0.05 });
  // sloped corrugated roof: visual slab 0.35, collider 1.6 thick (fills the gable wedge below)
  const xa = x0 - over, xb = x1, ya = leanTop(xa), yb = leanTop(xb);
  slopedSlab(f, 'leanto_roof', xa, ya, xb, yb, z0 - over, z1 + over, 0.35, 1.6, 'metal');
  const roll = Math.atan2(yb - ya, xb - xa);
  for (let z = z0 - over + 0.45; z < z1 + over - 0.2; z += 0.6) {
    f.box((xa + xb) / 2, (ya + yb) / 2 + 0.01, z, Math.hypot(xb - xa, yb - ya), 0.02, 0.12, 'catGrey', { roll, g: 'noink', bev: 0 });
  }
  // door (south face, toward the apron) + window with a flower box (north face)
  f.box(-16.5, 1.7, z1 + 0.04, 2.2, 3.2, 0.08, 'shedSageDark', { bev: 0.04 });
  f.box(-15.7, 1.7, z1 + 0.1, 0.12, 0.3, 0.1, 'brass', { bev: 0.02 });
  f.box(-16.5, 2.2, z0 - 0.04, 2.4, 1.4, 0.08, 'glass', { g: 'noink', bev: 0 });
  f.box(-16.5, 2.2, z0 - 0.07, 2.6, 0.12, 0.06, 'trim', { g: 'noink', bev: 0 });
  f.solid('leanto', -16.5, 1.35, z0 - 0.35, 2.6, 0.45, 0.6, 'terracotta', { bev: 0.06 });
  for (let i = 0; i < 4; i++) f.sphere(-17.4 + i * 0.6, 1.7, z0 - 0.35, 0.34, 0.3, 0.3, i % 2 ? 'marigold' : 'leaf', { g: 'soft', seg: 8 });
  // a rain barrel at the front corner (cover by the side door path)
  f.solidCyl('barrel', -18.6, 1.3, z1 + 1.5, 1.1, 2.6, 1.1, 'leafDark', { seg: 14 });
  for (const y of [0.6, 2.0]) f.torus(-18.6, y, z1 + 1.5, 1.12, 0.08, 'metal', { pitch: Math.PI / 2, seg: 14 });
}

/** Box whose TOP face runs from (xa, ya) to (xb, yb) along local x, spanning [z0, z1]. The visual slab is
 *  `vis` thick; the collider shares the top face but is `col` thick (fills whatever is below). */
function slopedSlab(f: Frame, type: string, xa: number, ya: number, xb: number, yb: number, z0: number, z1: number, vis: number, col: number, color: string): void {
  const roll = Math.atan2(yb - ya, xb - xa), len = Math.hypot(xb - xa, yb - ya);
  const nx = -Math.sin(roll), ny = Math.cos(roll);                 // top-face normal (local frame, yaw 0)
  const mx = (xa + xb) / 2, my = (ya + yb) / 2, mz = (z0 + z1) / 2;
  f.box(mx - nx * vis / 2, my - ny * vis / 2, mz, len, vis, z1 - z0, color, { roll, bev: 0.06 });
  f.colBox(type, mx - nx * col / 2, my - ny * col / 2, mz, len, col, z1 - z0, { roll });
}

// ============================================================================ climb routes

/** West: columns of 1 / 2 / 3 stacked crates against the lean-to (1.2 m steps). */
function crates(f: Frame): void {
  CRATE_Z.forEach((z, k) => {
    const n = k + 1, x0 = CRATE_X - 1.2;
    f.colBox('crate', CRATE_X, (n * 1.2) / 2, z, 2.4, n * 1.2, 2.4);
    for (let i = 0; i < n; i++) {
      const y0 = i * 1.2, jog = ((i + k) % 2 ? 0.04 : -0.04);
      f.box(CRATE_X + jog, y0 + 0.6, z, 2.4 - Math.abs(jog) * 2, 1.2, 2.4, i % 2 ? 'fenceDark2' : 'fenceWood', { bev: 0.08 });
      for (const s of [-1, 1]) f.box(CRATE_X, y0 + 0.6 + s * 0.28, z + 1.21, 2.2, 0.1, 0.03, 'fenceDark', { g: 'noink', bev: 0 });
      for (const s of [-1, 1]) f.box(x0 - 0.01, y0 + 0.6 + s * 0.28, z, 0.03, 0.1, 2.2, 'fenceDark', { g: 'noink', bev: 0 });
      f.box(CRATE_X, y0 + 0.6, z + 1.21, 0.1, 1.0, 0.03, 'fenceDark', { g: 'noink', bev: 0 });
    }
    // stencilled step number on the front face (readable "1 2 3")
    for (let d = 0; d < n; d++) f.box(x0 - 0.02, n * 1.2 - 0.6, z - 0.3 * (n - 1) / 2 + d * 0.3, 0.02, 0.5, 0.12, 'catBlack', { g: 'noink', bev: 0 });
  });
}

/** East: a painter's plank scaffold in the back alley — five planks, 1.2 m apart, staggered (never stacked). */
function scaffold(f: Frame): void {
  SCAF_Z.forEach((zc, k) => {
    const top = 1.2 * (k + 1), z0 = zc - 1.2, z1 = zc + 1.2;
    solidRect(f, 'scaffold', SCAF_X0, SCAF_X1, top - 0.25, top, z0, z1, k % 2 ? 'plywood' : 'plywoodDark', { bev: 0.06 });
    boxRect(f, SCAF_X0 + 0.1, SCAF_X1 - 0.1, top + 0.005, top + 0.015, z0 + 0.25, z0 + 0.4, 'accentHot', { g: 'noink', bev: 0 });   // step nosing
    // tubes: two uprights on the outer edge, a wall bracket, a diagonal brace (visual, thin)
    for (const z of [z0 + 0.2, z1 - 0.2]) f.cyl(SCAF_X1 - 0.12, (top - 0.25) / 2, z, 0.07, top - 0.25, 0.07, 'metal', { seg: 6 });
    f.box((SCAF_X0 + SCAF_X1) / 2 - 0.1, top - 0.35, zc, SCAF_X1 - SCAF_X0 + 0.2, 0.12, 0.12, 'metal', { bev: 0 });
    if (top > 1.3) f.cyl(SCAF_X1 - 0.12, (top - 0.25) / 2, zc, 0.05, Math.hypot(top - 0.25, 2.0), 0.05, 'metal', { pitch: Math.atan2(2.0, top - 0.25), seg: 5 });
  });
  // paint cans + a roller tray at the foot of the scaffold (the first step reads as "painters were here")
  f.solidCyl('paint', 17.9, 0.5, 6.6, 0.6, 1.0, 0.6, 'metal', { seg: 14 });
  f.cyl(17.9, 0.45, 6.6, 0.62, 0.5, 0.62, 'teamCorgis', { seg: 14 });
  f.box(17.8, 0.08, 4.8, 1.2, 0.16, 0.9, 'catGrey', { yaw: 0.3, bev: 0.04 });
  f.cyl(17.9, 0.3, 4.7, 0.18, 0.9, 0.18, 'catWhite', { roll: Math.PI / 2, yaw: 0.3, seg: 8 });
  // SE downpipe runs past the scaffold top: visual cue "climb here"
  f.cyl(HX + 0.22, (ROOF + 0.3) / 2, -2.6, 0.2, ROOF - 0.3, 0.2, 'catGrey', { seg: 8 });
}

// ============================================================================ the lot around the garage

function backLot(f: Frame, height: HeightFn): void {
  // two wheelie bins by the pet door (cover on the NE-corner lawn)
  for (const [lx, lz, col] of [[-2.2, -14.6, 'hoseGreen'], [0.9, -15.2, 'catGrey']] as const) {
    const gy = height(GARAGE.x + lx, GARAGE.z + lz);
    const b = f.sub(lx, gy, lz, lx * 0.05);
    b.solid('bin', 0, 1.3, 0, 2.2, 2.6, 2.4, col, { bev: 0.25 });
    b.solid('bin', 0, 2.72, 0.08, 2.4, 0.24, 2.6, col, { bev: 0.1 });
    b.box(0, 2.9, -1.2, 1.2, 0.16, 0.2, 'catBlack', { bev: 0.05 });
    for (const s of [-1, 1]) b.cyl(s * 0.9, 0.35, -1.25, 0.35, 0.2, 0.35, 'catBlack', { roll: Math.PI / 2, seg: 10 });
  }
}
