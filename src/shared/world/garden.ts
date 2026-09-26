// The Garden — district edge of the West Yard (G1). Infiltrator flavour: stealth and climbing.
// A vegetable plot + flower-bed jungle along the west fence at pet scale (characters ~1.2 m):
//
//   N  veg plot:   two raised beds (1.3 m walls) with towering tomato cages (leaf ledges 2.5/3.7/4.9 m,
//                  crown 6.1 m) joined by a trellis bridge (3.7 m) over the garden path; the dig hole
//                  under the west fence opens into tall weeds right beside them.
//   C  meadow:     tall-grass concealment meadow with giant pumpkins + zucchini as cover, a bean-pole
//                  teepee (leaf ledges every 1.2 m up to a 6 m perch, vine crown 7.2 m), the compost
//                  heap in its slatted bin, and the impact sprinkler that sweeps the meadow in bursts.
//   S  jungle:     sunflower forest + flower-bed jungle (tall grass + flower heads), and the garden
//                  gnome watchtower (4.9 m lookout reached by a stair of stacked flowerpots).
//
// Everything solid is emitted through the Kit (visual prim + matching collider). Leaves, flowers and
// grass are soft, walk-through foliage (visual only) — except the leaf LEDGES, which have colliders.
// Heights follow the movement kit: corgi single jump ~1.47 m, double ~2.55 m; cat 1.84 / 3.1 m.
// Pure data, deterministic from the seed's rng; no three, no Math.random.
import type { Bookmark, ConcealZone, District, Sprinkler } from './world-types';
import type { Kit, Frame } from './kit';
import type { SurfaceOp, TerrainOp } from './terrain';
import type { Rng } from './noise';

type HeightFn = (x: number, z: number) => number;
const TAU = Math.PI * 2;

export const GARDEN_DISTRICT: District = { id: 'garden', name: 'The Garden', minX: -100, maxX: -64, minZ: -64, maxZ: 46 };

// ---------------------------------------------------------------------------- layout (world coords)
const BED_A = { x: -91, z: -54 };
const BED_B = { x: -71, z: -54 };
const BED = { W: 9, D: 14, H: 1.3, T: 0.6 };
const TEEPEE = { x: -89, z: -20 };
const COMPOST = { x: -94, z: -33 };
const TOWER = { x: -80, z: 32 };
/** Garden path (N -> S) and the flank path from the dig hole toward the big tree. */
export const GARDEN_PATH = [-81, -67, -81.5, -56, -81, -45, -79.5, -36, -74.5, -28, -71.5, -18, -71.5, -6, -74, 4, -78.5, 10, -79, 22, -74, 27, -71.5, 34, -70, 46];
export const GARDEN_FLANK_PATH = [-97.5, -45, -91, -43.2, -84, -42.6, -80.3, -40.5];   // dig hole -> garden path

export const GARDEN_CONCEAL: ConcealZone[] = [
  // a continuous stealth corridor along the west fence: corn row (dig hole) -> north patch -> [open gap
  // at the compost bin] -> meadow -> hedge-row grass -> flower jungle -> fence weeds; plus edge clumps
  { id: 'corn', x: -97.6, z: -52, rx: 2.0, rz: 10.5, h: 4.5, style: 'weeds' },
  { id: 'north_patch', x: -91.5, z: -39.6, rx: 4.6, rz: 3.1, h: 2.2, style: 'grass' },
  { id: 'meadow', x: -86, z: -14, rx: 10, rz: 12.5, h: 2.4, style: 'grass' },
  { id: 'hedge_row', x: -93.2, z: 3.2, rx: 5, rz: 3.6, h: 2.3, style: 'grass' },
  { id: 'jungle', x: -89, z: 18, rx: 8.5, rz: 10.5, h: 2.5, style: 'flowers' },
  { id: 'fence_weeds', x: -97.4, z: 37.5, rx: 2.2, rz: 8, h: 2.2, style: 'weeds' },
  { id: 'tower_skirt', x: -79.5, z: 39, rx: 5, rz: 2.8, h: 2.2, style: 'flowers' },
  { id: 'lawn_edge', x: -67.5, z: -39, rx: 2.4, rz: 4, h: 2.2, style: 'grass' },
];

export const GARDEN_SPRINKLERS: Sprinkler[] = [
  // impact sprinkler in the meadow: ~300 deg sweep (not at the fence), bursts every ~2.3 min
  { id: 'meadow', x: -84, y: 1.3, z: -12, reach: 11, a0: -2.6, a1: 2.6, sweep: 7, burst: 24, period: 140, first: 75 },
  // oscillating head at the path junction, spraying the veg plot and the bridge (north)
  { id: 'veg', x: -84.5, y: 1.2, z: -45.5, reach: 10, a0: -2.9, a1: -0.25, sweep: 5, burst: 20, period: 170, first: 130 },
];

export const GARDEN_BOOKMARKS: Bookmark[] = [
  { name: 'garden', pos: [-67.5, 3.1, -6], look: [-88, 3.2, -42], fov: 62 },
  { name: 'garden_south', pos: [-69, 2.6, 8], look: [-86, 6, 32], fov: 62 },
  { name: 'garden_bridge', pos: [-81, 5.6, -53.2], look: [-82, 1.8, -12], fov: 64 },
  { name: 'garden_high', pos: [-44, 34, -44], look: [-84, 0, -12], fov: 55 },
];

/** Terrain stamps + ground surfaces for the Garden (merged into the West Yard terrain spec). */
export function gardenTerrain(): { ops: TerrainOp[]; surfaces: SurfaceOp[] } {
  const ops: TerrainOp[] = [
    { op: 'flat', x: BED_A.x, z: BED_A.z, hx: BED.W / 2 + 0.5, hz: BED.D / 2 + 0.5, h: 0, falloff: 3 },
    { op: 'flat', x: BED_B.x, z: BED_B.z, hx: BED.W / 2 + 0.5, hz: BED.D / 2 + 0.5, h: 0, falloff: 3 },
    { op: 'flat', x: -81, z: -54, hx: 5, hz: 2, h: 0, falloff: 2 },                     // bridge posts
    { op: 'flat', x: TEEPEE.x, z: TEEPEE.z, hx: 4.2, hz: 4.2, h: 0, falloff: 3 },
    { op: 'flat', x: TOWER.x + 2, z: TOWER.z + 3, hx: 5, hz: 6.5, h: 0, falloff: 3 },   // tower + pot stair
    { op: 'raise', x: COMPOST.x, z: COMPOST.z, r: 1.2, falloff: 3.4, h: 1.9 },           // compost heap
    { op: 'path', pts: GARDEN_PATH, width: 3.2, depth: 0.08 },
  ];
  const surfaces: SurfaceOp[] = [
    { kind: 'dirt', shape: 'path', pts: GARDEN_PATH, width: 2.3, soft: 0.8, amount: 0.9 },
    { kind: 'mulch', shape: 'circle', x: COMPOST.x, z: COMPOST.z, r: 4.6, soft: 1.2 },
    { kind: 'mulch', shape: 'circle', x: TEEPEE.x, z: TEEPEE.z, r: 3.6, soft: 0.8, amount: 0.9 },
    { kind: 'dirt', shape: 'rect', x: TOWER.x + 1.5, z: TOWER.z + 2, hx: 4, hz: 5, soft: 1.2, amount: 0.7 },
    { kind: 'dirt', shape: 'rect', x: -81, z: -54, hx: 4.5, hz: 8, soft: 1, amount: 0.6 },   // worn ground between beds
  ];
  // un-mowed (wild) ground under every tall-grass zone
  for (const zn of GARDEN_CONCEAL) {
    surfaces.push({ kind: 'wild', shape: 'rect', x: zn.x, z: zn.z, hx: zn.rx * 0.95, hz: zn.rz * 0.95, soft: 1.6 });
  }
  return { ops, surfaces };
}

export interface GardenBuild {
  concealZones: ConcealZone[];
  sprinklers: Sprinkler[];
  bookmarks: Bookmark[];
  district: District;
}

/** Builds the Garden's props (visual prims + colliders) into the kit. Call after the terrain exists. */
export function buildGarden(kit: Kit, rng: Rng, height: HeightFn): GardenBuild {
  // ---- north: veg plot
  const a = kit.frame(BED_A.x, 0, BED_A.z, 0);
  raisedBed(a);
  tomatoCage(a.sub(0, BED.H, -0.6), rng, -Math.PI / 2, 'east');          // L1 north, L2 east (bridge), L3 south
  cabbageRow(a, rng, [[-2.4, 4.6], [2.4, 4.8], [-2.6, -5.2]]);
  const b = kit.frame(BED_B.x, 0, BED_B.z, 0);
  raisedBed(b);
  tomatoCage(b.sub(0, BED.H, -0.6), rng, Math.PI / 2, 'west');          // L1 south, L2 west (bridge), L3 north
  lettuceRow(b, rng);
  trellisBridge(kit, rng);
  // ---- middle: meadow, teepee, pumpkins, compost, sprinklers
  beanTeepee(kit.frame(TEEPEE.x, 0, TEEPEE.z, 0), rng);
  compostBin(kit, rng, height);
  pumpkin(kit.frame(-79, height(-79, -23), -23, 0.4), 2.0, rng);
  pumpkin(kit.frame(-74.5, height(-74.5, -12), -12, 1.3), 1.6, rng);
  pumpkin(kit.frame(-91.5, height(-91.5, -5), -5, 2.2), 1.8, rng);
  pumpkin(kit.frame(-95.5, height(-95.5, 3.5), 3.5, 0.2), 1.2, rng);
  zucchini(kit.frame(-83, height(-83, -29), -29, 0.5));
  zucchini(kit.frame(-76.5, height(-76.5, -4.5), -4.5, -0.8));
  zucchini(kit.frame(-81.5, height(-81.5, -26.5), -26.5, 2.0), 0.8);
  vines(kit, height, rng);
  squashLeaves(kit, height, rng);
  cornRow(kit, height, rng);
  scarecrow(kit.frame(-77.2, height(-77.2, -33.5), -33.5, 0.5));
  for (const s of GARDEN_SPRINKLERS) sprinklerHead(kit.frame(s.x, height(s.x, s.z), s.z, 0), s.id === 'meadow');
  // ---- south: flower jungle + sunflowers + watchtower
  const sunflowers: [number, number, number, number][] = [[-95.2, 10, 12.5, 1.25], [-91, 22.5, 14, 1.75], [-96.2, 32, 11.5, 1.45], [-86.5, 12.5, 10.5, 1.95], [-84.5, 25.5, 12, 1.1]];
  for (const [x, z, h, yaw] of sunflowers) sunflower(kit.frame(x, height(x, z), z, yaw), h, rng);
  flowerJungle(kit, height, rng);
  watchtower(kit);
  // garden gate arch where the path leaves toward the corgi side (landmark entrance)
  gateArch(kit.frame(-81, height(-81, -63.5), -63.5, 0), rng);
  return { concealZones: GARDEN_CONCEAL.map((z) => ({ ...z })), sprinklers: GARDEN_SPRINKLERS.map((s) => ({ ...s, y: height(s.x, s.z) + s.y })), bookmarks: GARDEN_BOOKMARKS, district: GARDEN_DISTRICT };
}

// ============================================================================ pieces

function raisedBed(f: Frame): void {
  const { W, D, H, T } = BED;
  f.colBox('bed', 0, (H - 1) / 2, 0, W, H + 1, D);
  for (const s of [-1, 1]) {
    f.box(s * (W / 2 - T / 2), H / 2, 0, T, H, D, 'fenceWood', { bev: 0.12 });
    f.box(0, H / 2, s * (D / 2 - T / 2), W - 2 * T + 0.02, H, T, 'fenceWood', { bev: 0.12 });
    // board seams (two planks per wall)
    f.box(s * (W / 2 + 0.01), H * 0.5, 0, 0.04, 0.06, D - 0.4, 'fenceDark', { g: 'noink', bev: 0 });
    f.box(0, H * 0.5, s * (D / 2 + 0.01), W - 0.4, 0.06, 0.04, 'fenceDark', { g: 'noink', bev: 0 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * (W / 2 - 0.35), H / 2 + 0.12, sz * (D / 2 - 0.35), 0.8, H + 0.24, 0.8, 'fenceDark', { bev: 0.1 });
  f.box(0, H - 0.18, 0, W - 2 * T, 0.3, D - 2 * T, 'mulch', { g: 'noink', bev: 0.05 });
  // soil furrows
  for (let i = -2; i <= 2; i++) f.box(i * 1.5, H - 0.02, 0, 0.35, 0.06, D - 2 * T - 0.6, 'bark', { g: 'noink', bev: 0 });
}

/** A flat, walkable leaf ledge: collider box (top at `top`) + a squashed leaf blob with a midrib. */
function leafLedge(f: Frame, cx: number, cz: number, top: number, radialYaw: number, size: number, col: string): void {
  f.colBox('leaf', cx, top - 0.25, cz, size, 0.5, size, { yaw: radialYaw });
  f.sphere(cx, top - 0.25, cz, size * 0.54, 0.25, size * 0.56, col, { yaw: radialYaw, seg: 14, g: 'soft' });
  f.box(cx, top + 0.01, cz, 0.14, 0.05, size * 0.92, 'leafDark', { yaw: radialYaw, g: 'noink', bev: 0 });
  for (const s of [-1, 1]) f.box(cx, top + 0.01, cz, 0.08, 0.04, size * 0.5, 'leafDark', { yaw: radialYaw + s * 0.7, g: 'noink', bev: 0 });
}

/** Direction (cos, sin) in XZ for math angle `ang` in a frame (yaw 0 frames only here). */
const dirOf = (ang: number): [number, number] => [Math.cos(ang), Math.sin(ang)];
/** Kit yaw that points local +Z along math angle `ang`. */
const yawOf = (ang: number): number => Math.PI / 2 - ang;

/**
 * Tomato cage on a raised bed: square wire cage around a bushy plant (solid core r 1.25), three leaf
 * ledges spiralling up every 1.2 m (90 deg apart, never stacked) and the plant crown on top (walkable).
 * `start` = math angle of the first ledge; ledges advance +90 deg. Frame origin = bed top.
 */
function tomatoCage(f: Frame, rng: Rng, start: number, _bridgeSide: 'east' | 'west'): void {
  const CORE = 1.25, TOP = 4.8;                         // crown top = bed top (1.3) + 4.8 = 6.1
  f.colCyl('tomato', 0, TOP / 2, 0, CORE, TOP / 2);
  // bush: stacked lumpy blobs
  for (let i = 0; i < 5; i++) {
    const y = 0.5 + i * 0.95, r = CORE * (1.02 + 0.08 * Math.sin(i * 1.7));
    f.sphere(rng.range(-0.1, 0.1), y, rng.range(-0.1, 0.1), r, 0.75, r, i % 2 ? 'leaf' : 'leafDark', { seg: 12, g: 'soft', yaw: i });
  }
  f.sphere(0, TOP - 0.3, 0, CORE + 0.05, 0.32, CORE + 0.05, 'leafLight', { seg: 14, g: 'soft' });   // flat crown (walkable top)
  // tomatoes hanging off the bush
  for (let i = 0; i < 11; i++) {
    const ang = i * 2.39996 + rng.range(-0.2, 0.2), y = 0.6 + (i % 5) * 0.85 + rng.range(0, 0.3);
    const r = rng.range(0.28, 0.42);
    f.sphere(Math.cos(ang) * (CORE + 0.05), y, Math.sin(ang) * (CORE + 0.05), r, r * 0.92, r, i % 4 === 3 ? 'tomatoGreen' : 'tomato', { seg: 10 });
  }
  // wire cage (visual): 4 legs on the diagonals + conical rings hugging the bush
  for (let k = 0; k < 4; k++) {
    const ang = start + Math.PI / 4 + k * (Math.PI / 2);
    f.cyl(Math.cos(ang) * 1.42, (TOP + 0.9) / 2 - 0.4, Math.sin(ang) * 1.42, 0.06, TOP + 0.9, 0.06, 'wire', { seg: 5 });
  }
  for (const [y, r] of [[0.7, 1.36], [1.9, 1.4], [3.1, 1.44], [4.3, 1.48]]) f.torus(0, y, 0, r, 0.05, 'wire', { pitch: Math.PI / 2, seg: 18, g: 'noink' });
  // ledges: radius 2.35 (clear of the core), 2.3 m square, 1.2 m apart
  for (let k = 0; k < 3; k++) {
    const ang = start + k * (Math.PI / 2);
    const [c, s] = dirOf(ang);
    const top = 1.2 * (k + 1);
    leafLedge(f, c * 2.35, s * 2.35, top, yawOf(ang), 2.3, k % 2 ? 'leafLight' : 'leaf');
    // stem from the bush to the ledge
    f.cyl(c * 1.35, top - 0.35, s * 1.35, 0.13, 1.2, 0.18, 'leafDark', { yaw: yawOf(ang), pitch: Math.PI / 2 - 0.25, seg: 6, g: 'soft' });
  }
}

function cabbageRow(f: Frame, rng: Rng, spots: [number, number][]): void {
  for (const [x, z] of spots) {
    const r = 1.05 + rng.range(0, 0.25);
    f.sphere(x, BED.H + r * 0.5, z, r, r * 0.75, r, 'leafLight', { g: 'soft', seg: 10 });
    f.sphere(x, BED.H + r * 0.62, z, r * 0.62, r * 0.62, r * 0.62, 'cabbage', { g: 'soft', seg: 8 });
  }
}

function lettuceRow(f: Frame, rng: Rng): void {
  for (const [x, z] of [[-2.5, 4.5], [0, 5.2], [2.5, 4.4], [-2.4, -5.4], [2.4, -5.1]] as [number, number][]) {
    const r = 0.8 + rng.range(0, 0.2);
    for (let k = 0; k < 3; k++) {
      const a2 = k * 2.1;
      f.sphere(x + Math.cos(a2) * 0.35, BED.H + 0.35, z + Math.sin(a2) * 0.35, r * 0.75, 0.45, r * 0.6, k ? 'leafLight' : 'lettuce', { yaw: a2, g: 'soft', seg: 8 });
    }
  }
  // carrot tops: feathery tufts in a row
  for (let i = 0; i < 5; i++) {
    const x = -3 + i * 1.5;
    f.cone(x, BED.H + 0.45, 0.2, 0.35, 0.9, 'leaf', { seg: 5, g: 'soft' });
    f.cyl(x, BED.H + 0.02, 0.2, 0.28, 0.12, 0.3, 'corgiOrange', { seg: 8, g: 'noink' });
  }
}

/**
 * Trellis bridge between the two tomato cages' east/west ledges (top 3.7 m), passing over the garden
 * path: plank deck with low lattice rails (colliders), arbor posts on the ground and a lattice arch
 * below the deck, wrapped in climbing roses.
 */
function trellisBridge(kit: Kit, rng: Rng): void {
  const z = BED_A.z - 0.6, top = BED.H + 2.4;                  // = TA/TB L2 ledge height (3.7 m)
  const x0 = BED_A.x + 3.4, x1 = BED_B.x - 3.4;               // ledge outer edges
  const f = kit.frame((x0 + x1) / 2, 0, z, 0);
  const L = x1 - x0 + 0.5;
  f.solid('bridge', 0, top - 0.2, 0, L, 0.4, 2.4, 'fenceWood', { bev: 0.08 });
  for (let i = 0; i < 13; i++) f.box(-L / 2 + 0.5 + i * ((L - 1) / 12), top + 0.005, 0, 0.08, 0.04, 2.3, 'fenceDark', { g: 'noink', bev: 0 });
  // rails: low lattice walls on both sides (0.75 m, jumpable)
  for (const s of [-1, 1]) {
    f.solid('bridge', 0, top + 0.37, s * 1.1, L - 1.2, 0.75, 0.16, 'trim', { bev: 0.05 });
    for (let i = 0; i < 12; i++) f.box(-L / 2 + 1 + i * ((L - 2) / 11), top + 0.37, s * 1.2, 0.08, 0.8, 0.06, 'trimShade', { roll: i % 2 ? 0.6 : -0.6, g: 'noink', bev: 0 });
  }
  // arbor posts (on the ground, both sides of the path) + lattice arch under the deck
  const PX = L / 2 - 1.9;
  for (const px of [-PX, PX]) for (const s of [-1, 1]) {
    f.solid('bridge', px, (top - 0.4) / 2, s * 0.95, 0.36, top - 0.4, 0.36, 'trim', { bev: 0.06 });
  }
  const span = 2 * PX, R = PX, rise = 1.8;
  for (let i = 0; i < 10; i++) {
    const t0 = i / 10, t1 = (i + 1) / 10;
    const xa = -R + span * t0, xb = -R + span * t1;
    const ya = top - 0.4 - rise + rise * Math.sin(Math.PI * t0), yb = top - 0.4 - rise + rise * Math.sin(Math.PI * t1);
    for (const s of [-1, 1]) f.solid('bridge', (xa + xb) / 2, (ya + yb) / 2, s * 0.95, Math.hypot(xb - xa, yb - ya) + 0.05, 0.22, 0.22, 'trim', { roll: Math.atan2(yb - ya, xb - xa), bev: 0.04 });
  }
  // climbing roses on the posts and along the rails
  for (let i = 0; i < 16; i++) {
    const px = rng.range(-L / 2 + 1, L / 2 - 1), s = i % 2 ? 1 : -1;
    const y = i < 6 ? rng.range(0.8, top - 0.6) : top + rng.range(0.3, 0.8);
    const x = i < 6 ? (i % 3 === 0 ? -PX : PX) + rng.range(-0.2, 0.2) : px;
    f.sphere(x, y, s * 1.25, 0.55, 0.45, 0.35, 'leaf', { g: 'soft', seg: 8 });
    f.sphere(x + 0.15, y + 0.15, s * 1.4, 0.24, 0.24, 0.2, i % 3 === 0 ? 'catWhite' : 'pink', { seg: 8 });
  }
}

/** Bean-pole teepee: 4 leaning bamboo poles, vine bundle core (r 1.0), leaf ledges every 1.2 m. */
function beanTeepee(f: Frame, rng: Rng): void {
  const APEX = 10.5, BASE = 2.5, CORE = 0.95, CROWN = 7.2;
  // poles (visual + pitched box colliders)
  for (const [sx, sz] of [[1, 1], [-1, 1], [-1, -1], [1, -1]]) {
    const bx = sx * BASE, bz = sz * BASE;
    const hl = Math.hypot(bx, bz), len = Math.hypot(hl, APEX);
    const yaw = Math.atan2(-bx, -bz);                           // local +Z toward the apex (horizontal part)
    const pitch = -Math.atan2(APEX, hl) + Math.PI / 2;         // tilt the cylinder axis from +Y toward +Z
    f.cyl(bx / 2, APEX / 2, bz / 2, 0.16, len + 0.6, 0.22, 'bamboo', { yaw, pitch, seg: 8 });
    for (let k = 1; k < 5; k++) {
      const t = k / 5;
      f.cyl(bx * (1 - t), APEX * t, bz * (1 - t), 0.24, 0.12, 0.24, 'bambooDark', { yaw, pitch, seg: 8, g: 'noink' });
    }
    // collider on the lower part only: higher up the poles converge through the ledge spiral (thin
    // bamboo, visual only there), so climbers never snag on them between ledges
    const LOW = 3.2 / APEX;
    f.colBox('pole', bx * (1 - LOW / 2), 1.6, bz * (1 - LOW / 2), 0.36, len * LOW, 0.36, { yaw, pitch });
  }
  f.cyl(0, APEX - 0.6, 0, 0.5, 0.5, 0.5, 'twine', { seg: 10 });   // lashing at the apex
  // vine bundle core (solid) + crown
  f.colCyl('vine', 0, CROWN / 2, 0, CORE, CROWN / 2);
  for (let i = 0; i < 7; i++) {
    const y = 0.5 + i * 0.97;
    f.sphere(rng.range(-0.08, 0.08), y, rng.range(-0.08, 0.08), CORE + 0.05, 0.72, CORE + 0.05, i % 2 ? 'leafDark' : 'bean', { seg: 12, g: 'soft', yaw: i * 1.3 });
  }
  f.sphere(0, CROWN - 0.3, 0, CORE + 0.1, 0.32, CORE + 0.1, 'leafLight', { seg: 12, g: 'soft' });
  // vines spiralling up the poles (visual)
  for (let k = 0; k < 18; k++) {
    const t = k / 18, ang = t * TAU * 2.2;
    const r = BASE * 1.25 * (1 - t * 0.85);
    f.sphere(Math.cos(ang) * r, t * APEX * 0.95 + 0.3, Math.sin(ang) * r, 0.42, 0.3, 0.42, 'bean', { g: 'soft', seg: 7 });
  }
  // ledges between the poles (N, E, S, W, N...), radius 2.2, every 1.2 m up to the 6 m perch
  const start = -Math.PI / 2;
  for (let k = 0; k < 5; k++) {
    const ang = start + k * (Math.PI / 2);
    const [c, s] = dirOf(ang);
    const top = 1.2 * (k + 1);
    leafLedge(f, c * 2.2, s * 2.2, top, yawOf(ang), 2.3, k % 2 ? 'bean' : 'leaf');
    f.cyl(c * 1.05, top - 0.4, s * 1.05, 0.12, 1.1, 0.16, 'leafDark', { yaw: yawOf(ang), pitch: Math.PI / 2 - 0.3, seg: 6, g: 'soft' });
  }
  // dangling bean pods + purple flowers
  for (let i = 0; i < 12; i++) {
    const ang = i * 1.9 + 0.4, r = rng.range(1.1, 1.8), y = rng.range(1.5, 8.5);
    f.cyl(Math.cos(ang) * r, y - 0.7, Math.sin(ang) * r, 0.1, 1.5, 0.16, 'beanPod', { roll: rng.range(-0.25, 0.25), seg: 6, g: 'soft' });
    if (i % 3 === 0) f.sphere(Math.cos(ang) * (r + 0.2), y + 0.1, Math.sin(ang) * (r + 0.2), 0.22, 0.2, 0.22, 'purple', { seg: 7 });
  }
}

function compostBin(kit: Kit, rng: Rng, height: HeightFn): void {
  const { x, z } = COMPOST;
  const f = kit.frame(x, 0, z, 0);
  const S = 7.2, WH = 1.7;
  // three slatted walls (west, north, south); open to the east
  const walls: [number, number, number, number][] = [[-S / 2, 0, 0.4, S], [0, -S / 2, S, 0.4], [0, S / 2, S, 0.4]];
  for (const [wx, wz, w, d] of walls) {
    f.colBox('compost', wx, WH / 2 - 0.3, wz, w, WH + 0.6, d);
    for (let i = 0; i < 3; i++) f.box(wx, 0.3 + i * 0.55, wz, w + 0.02, 0.42, d + 0.02, i % 2 ? 'fenceDark' : 'fenceDark2', { bev: 0.06 });
  }
  for (const [sx, sz] of [[-1, -1], [-1, 1], [1, -1], [1, 1]]) f.solid('compost', sx * S / 2, WH / 2, sz * S / 2, 0.5, WH + 0.2, 0.5, 'fenceDark', { bev: 0.08 });
  // heap lumps on the terrain mound + kitchen scraps
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39996, d = i === 0 ? 0 : rng.range(0.9, 2.6);
    const lx = Math.cos(a) * d, lz = Math.sin(a) * d;
    const gy = height(x + lx, z + lz);
    const r = rng.range(0.7, 1.2);
    kit.frame(x + lx, gy - r * 0.55, z + lz, a).sphere(0, 0, 0, r, r * 0.7, r, i % 3 ? 'compost' : 'mulch', { g: 'soft', seg: 8 });
  }
  const scraps: [number, number, string][] = [[0.6, -0.8, 'eggshell'], [-0.9, 0.7, 'banana'], [1.4, 0.9, 'leafLight'], [-0.3, 1.6, 'tomato'], [1.1, -1.9, 'corgiOrange']];
  for (const [lx, lz, col] of scraps) {
    const gy = height(x + lx, z + lz);
    kit.frame(x + lx, gy + 0.08, z + lz, lx).box(0, 0, 0, col === 'banana' ? 1.2 : 0.5, 0.14, 0.4, col, { g: 'noink', bev: 0.05, roll: 0.3 });
  }
  // garden fork stuck in the heap
  const fk = kit.frame(x + 1.2, height(x + 1.2, z - 0.4) + 1.6, z - 0.4, 0.8);
  fk.cyl(0, 0.9, 0, 0.09, 3.2, 0.09, 'bark', { roll: 0.3, seg: 6 });
  fk.box(-0.35, -0.75, 0, 0.9, 0.12, 0.1, 'metal', { roll: 0.3, bev: 0.02 });
}

/** Giant pumpkin: ribbed lobes, stem, curly tendril. Collider: upright cylinder (top ~1.56 R). */
function pumpkin(f: Frame, R: number, rng: Rng): void {
  const ry = R * 0.8;
  f.colCyl('pumpkin', 0, ry * 0.95, 0, R * 0.92, ry * 0.95);
  f.sphere(0, ry, 0, R * 0.8, ry * 0.98, R * 0.8, 'pumpkinDark', { seg: 14, g: 'soft' });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    f.sphere(Math.cos(a) * R * 0.34, ry, Math.sin(a) * R * 0.34, R * 0.58, ry, R * 0.66, i % 2 ? 'pumpkin' : 'pumpkinLight', { yaw: Math.PI / 2 - a, seg: 12, g: 'soft' });
  }
  f.cyl(0.1, 2 * ry + 0.25, 0, 0.22, 0.7, 0.3, 'barkDark', { roll: 0.35, seg: 6 });
  f.torus(0.45, 2 * ry + 0.05, 0.2, 0.35, 0.05, 'leaf', { pitch: 1.2, seg: 10, g: 'noink' });
  // a couple of broad leaves at the base
  for (let i = 0; i < 2; i++) {
    const a = rng.range(0, TAU), d = R * 0.95 + 0.8;
    f.sphere(Math.cos(a) * d, 0.35, Math.sin(a) * d, 1.3, 0.14, 1.1, 'leaf', { yaw: a, seg: 10, g: 'soft' });
  }
}

/** Zucchini lying in the grass (collider box ~1.4 m tall): a step up toward the pumpkins. */
function zucchini(f: Frame, scale = 1): void {
  const L = 5 * scale, r = 0.75 * scale;
  f.colBox('zucchini', 0, r, 0, r * 1.8, r * 2, L);
  f.cyl(0, r, 0, r, L - 0.8 * scale, r * 0.92, 'zucchini', { pitch: Math.PI / 2, seg: 12 });
  f.sphere(0, r, L / 2 - 0.4 * scale, r, r, 0.6 * scale, 'zucchini', { seg: 10 });
  f.sphere(0, r * 0.95, -L / 2 + 0.4 * scale, r * 0.92, r * 0.92, 0.5 * scale, 'zucchini', { seg: 10 });
  for (const s of [-1, 1]) f.box(s * r * 0.5, r * 1.82, 0, 0.12 * scale, 0.06, L - 1.2 * scale, 'zucchiniLight', { g: 'noink', bev: 0, roll: s * 0.5 });
  f.cone(0, r, L / 2 + 0.35 * scale, 0.55 * scale, 0.9 * scale, 'flowerYellow', { pitch: Math.PI / 2, seg: 7 });
  f.cyl(0, r, -L / 2 - 0.15 * scale, 0.12 * scale, 0.5 * scale, 0.18 * scale, 'leafDark', { pitch: Math.PI / 2, seg: 6 });
}

/** Pumpkin/zucchini vines crawling through the meadow (visual). */
function vines(kit: Kit, height: HeightFn, rng: Rng): void {
  const pts: [number, number][] = [[-79, -23], [-82, -18], [-80, -12], [-76, -9], [-74.5, -12]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const n = 3;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      const len = Math.hypot(x1 - x0, z1 - z0) / n + 0.3;
      kit.frame(x, height(x, z) + 0.15, z).cyl(0, 0, 0, 0.12, len, 0.12, 'leafDark', { yaw: Math.atan2(x1 - x0, z1 - z0), pitch: Math.PI / 2, seg: 6, g: 'soft' });
      if (k === 1) kit.frame(x + rng.range(-0.8, 0.8), height(x, z) + 0.5, z + rng.range(-0.8, 0.8), rng.range(0, TAU)).sphere(0, 0, 0, 1.1, 0.12, 0.95, 'leaf', { seg: 10, g: 'soft' });
    }
  }
}

/** Giant squash/rhubarb leaves on stalks around the pumpkin patch (visual jungle canopy). */
function squashLeaves(kit: Kit, height: HeightFn, rng: Rng): void {
  const spots: [number, number][] = [[-80.5, -19.5], [-77, -26.5], [-83.5, -24], [-76.5, -15.5], [-72.5, -9.5], [-89.5, -8.5], [-93.5, -2], [-78.5, -1.5], [-86.5, -3.5], [-92, -27], [-88, -30], [-73.5, -20.5], [-95.5, -17], [-83, -6]];
  for (const [x, z] of spots) {
    const n = 2 + (rng.next() < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      // low, drooping umbrella leaves (flat 7-sided cones) on short stalks: a knee-high canopy
      const a = rng.range(0, TAU), h = rng.range(0.55, 1.15), r = rng.range(1.3, 1.9);
      const lx = x + Math.cos(a) * 1.0, lz = z + Math.sin(a) * 1.0;
      const f = kit.frame(lx, height(lx, lz), lz, Math.PI / 2 - a);
      f.cyl(0, h / 2, -0.3, 0.07, h + 0.15, 0.1, 'leafDark', { pitch: -0.45, seg: 5, g: 'soft' });
      f.cone(0, h + 0.05, 0.3, r, 0.42, k % 2 ? 'leafLight' : 'leaf', { pitch: 0.22, seg: 7, g: 'soft' });
      f.box(0, h + 0.27, 0.3, 0.1, 0.05, r * 1.6, 'leafDark', { pitch: 0.22, g: 'noink', bev: 0 });
    }
  }
}

/**
 * Scarecrow by the path junction (landmark, visible from the lawn): dressed as a big grumpy cat to
 * scare the birds off the beds. Post + crossbar are solid (cover); the costume is visual.
 */
function scarecrow(f: Frame): void {
  f.solidCyl('scarecrow', 0, 2.6, 0, 0.2, 5.2, 0.24, 'bark', { seg: 8 });
  f.solid('scarecrow', 0, 3.6, 0, 4.4, 0.3, 0.3, 'bark', { bev: 0.06 });
  f.cyl(0, 3.1, 0, 0.95, 2.0, 1.15, 'danger', { seg: 12, g: 'soft' });                     // shirt
  for (const y of [2.5, 3.1, 3.7]) f.torus(0, y, 0, 1.02, 0.07, 'catBlack', { pitch: Math.PI / 2, seg: 14, g: 'noink' });   // flannel stripes
  for (const s of [-1, 1]) {
    f.cyl(s * 1.6, 3.6, 0, 0.32, 1.8, 0.4, 'danger', { roll: Math.PI / 2, seg: 8, g: 'soft' });   // sleeves
    for (let k = 0; k < 3; k++) f.cone(s * (2.55 + k * 0.08), 3.6 + (k - 1) * 0.16, 0, 0.1, 0.55, 'sand', { roll: -s * Math.PI / 2, seg: 4, g: 'noink' });  // straw hands
  }
  f.sphere(0, 4.75, 0, 0.8, 0.75, 0.75, 'catGrey', { seg: 12 });                            // cat-mask head
  for (const s of [-1, 1]) {
    f.cone(s * 0.45, 5.45, 0, 0.28, 0.6, 'catGrey', { roll: -s * 0.3, seg: 6 });            // ears
    f.sphere(s * 0.3, 4.85, -0.68, 0.14, 0.14, 0.06, 'accentHot', { seg: 8 });              // button eyes
  }
  f.box(0, 4.5, -0.72, 0.5, 0.06, 0.04, 'catBlack', { g: 'noink', bev: 0 });               // stitched frown
  f.cyl(0, 5.35, 0.05, 1.25, 0.1, 1.25, 'sand', { seg: 14 });                               // straw hat brim
  f.cyl(0, 5.6, 0.05, 0.55, 0.5, 0.65, 'sand', { seg: 12 });
  f.sphere(0.9, 3.75, -0.1, 0.3, 0.26, 0.4, 'catBlack', { seg: 8 });                        // a crow on the arm, unimpressed
  f.cone(0.9, 3.8, -0.5, 0.1, 0.3, 'accentHot', { pitch: -Math.PI / 2, seg: 4 });
}

/** Corn row along the fence above the dig hole: tall stalks with drooping leaves, cobs and tassels. */
function cornRow(kit: Kit, height: HeightFn, rng: Rng): void {
  for (let i = 0; i < 22; i++) {
    const z = -61.5 + i * 0.95 + rng.range(-0.2, 0.2);
    const x = (i % 2 ? -96.6 : -98.5) + rng.range(-0.25, 0.25);
    if (Math.hypot(x + 100, z + 45) < 3.4) continue;              // the dig hole stays clear
    const H = rng.range(5.2, 6.4);
    const f = kit.frame(x, height(x, z), z, rng.range(0, TAU));
    f.cyl(0, H / 2, 0, 0.1, H, 0.16, 'corn', { seg: 6, g: 'soft' });
    for (let k = 0; k < 4; k++) {
      const y = 1.4 + k * (H - 2.2) / 4, a = k * 2.4;
      f.sphere(Math.cos(a) * 0.8, y, Math.sin(a) * 0.8, 1.05, 0.08, 0.2, 'cornLeaf', { yaw: Math.PI / 2 - a, roll: -0.35, seg: 6, g: 'soft' });
    }
    if (i % 3 === 0) {
      f.cyl(0.22, H * 0.55, 0, 0.2, 0.9, 0.22, 'cornCob', { roll: 0.35, seg: 7 });
      f.cone(0.3, H * 0.55 + 0.35, 0, 0.26, 0.9, 'cornLeaf', { roll: 0.35, seg: 6, g: 'soft' });
    }
    f.cone(0, H + 0.35, 0, 0.3, 0.8, 'grassDry', { seg: 5, g: 'soft' });
  }
}

function sprinklerHead(f: Frame, impact: boolean): void {
  f.colCyl('sprinkler', 0, 0.55, 0, 0.35, 0.55);
  f.cyl(0, 0.55, 0, 0.12, 1.1, 0.2, 'metal', { seg: 8 });
  f.cyl(0, 1.15, 0, 0.26, 0.26, 0.3, 'brass', { seg: 10 });
  if (impact) {
    f.box(0.25, 1.35, 0, 0.7, 0.12, 0.14, 'brass', { roll: 0.35, bev: 0.03 });   // nozzle
    f.box(-0.1, 1.45, 0.1, 0.12, 0.12, 0.6, 'metal', { bev: 0.03 });            // deflector arm
  } else {
    f.cyl(0, 1.3, 0, 0.1, 0.35, 0.1, 'brass', { seg: 6 });
    f.torus(0, 1.42, 0, 0.3, 0.05, 'metal', { seg: 10 });
  }
  f.torus(0, 0.12, 0, 0.8, 0.12, 'hoseGreen', { pitch: Math.PI / 2, arc: 4.2, seg: 16 });
}

function sunflower(f: Frame, H: number, rng: Rng): void {
  f.colCyl('sunflower', 0, H / 2, 0, 0.45, H / 2);
  f.cyl(0, H / 2, 0, 0.3, H, 0.45, 'leafDark', { seg: 8 });
  // leaves up the stalk
  for (let i = 0; i < 4; i++) {
    const y = 1.8 + i * (H - 4) / 4, a = i * 2.3 + rng.range(-0.3, 0.3);
    f.sphere(Math.cos(a) * 1.2, y, Math.sin(a) * 1.2, 1.25, 0.14, 0.75, 'leaf', { yaw: Math.PI / 2 - a, roll: 0.25, seg: 10, g: 'soft' });
  }
  // head: disc tilted back 0.35 rad, facing local +Z (the frame yaw aims it), ring of round petals
  const hy = H + 0.5, p = Math.PI / 2 - 0.35;
  const vY = -Math.sin(p), vZ = Math.cos(p);           // disc-plane 'up' axis after the pitch
  const cz = 0.45;
  f.cyl(0, hy, cz, 1.55, 0.5, 1.4, 'sunflowerDark', { pitch: p, seg: 18 });
  f.cyl(0, hy, cz - 0.4, 0.9, 0.9, 0.35, 'leafDark', { pitch: p, seg: 10 });
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * TAU, R = 2.05;
    f.sphere(Math.cos(a) * R, hy + Math.sin(a) * R * vY, cz + Math.sin(a) * R * vZ - 0.05, 0.66, 0.1, 0.66, i % 2 ? 'sunflower' : 'flowerYellow', { pitch: p, seg: 8, g: 'soft' });
  }
}

/** Flower-bed jungle: tall stems with big heads between the sunflowers and around the tower (visual). */
function flowerJungle(kit: Kit, height: HeightFn, rng: Rng): void {
  const cols = ['zinnia', 'marigold', 'cosmos', 'catWhite', 'purple', 'pink'];
  const areas: [number, number, number, number, number][] = [[-89, 18, 8, 9.5, 40], [-79.5, 39, 4.5, 2.4, 14], [-95, -14, 3, 11, 12], [-93, 3, 4, 3, 8]];
  let n = 0;
  for (const [cx, cz, rx, rz, count] of areas) {
    for (let i = 0; i < count; i++) {
      const a = rng.range(0, TAU), d = Math.sqrt(rng.next());
      const x = cx + Math.cos(a) * rx * d, z = cz + Math.sin(a) * rz * d;
      const h = rng.range(2.6, 4.6);
      const f = kit.frame(x, height(x, z), z, rng.range(0, TAU));
      const col = cols[n++ % cols.length];
      f.cyl(0, h / 2, 0, 0.07, h, 0.1, 'leafDark', { seg: 5, g: 'soft', roll: rng.range(-0.08, 0.08) });
      f.sphere(0.35, h * 0.45, 0, 0.55, 0.1, 0.3, 'leaf', { roll: 0.4, seg: 7, g: 'soft' });
      if (col === 'cosmos' || col === 'catWhite') {
        for (let k = 0; k < 6; k++) f.sphere(Math.cos(k * 1.05) * 0.5, h + 0.05, Math.sin(k * 1.05) * 0.5, 0.36, 0.08, 0.2, col, { yaw: Math.PI / 2 - k * 1.05, seg: 6, g: 'soft' });
        f.sphere(0, h + 0.12, 0, 0.22, 0.14, 0.22, 'flowerYellow', { seg: 7 });
      } else {
        f.sphere(0, h + 0.1, 0, 0.78, 0.36, 0.78, col, { seg: 10, g: 'soft' });
        f.sphere(0, h + 0.36, 0, 0.3, 0.18, 0.3, col === 'marigold' ? 'corgiRed' : 'flowerYellow', { seg: 7 });
      }
    }
  }
}

/**
 * Garden gnome watchtower: a 4.6 m lookout deck at 4.9 m on four posts, a big gnome statue with
 * binoculars on its west half, low rails, and a stair of stacked terracotta pots (1.3 / 2.5 / 3.7 m)
 * on the east side. Deck spans x [-82.3, -77.7], z [29.7, 34.3].
 */
function watchtower(kit: Kit): void {
  const f = kit.frame(TOWER.x, 0, TOWER.z, 0);
  const S = 4.6, TOP = 4.9;
  f.solid('tower', 0, TOP - 0.2, 0, S, 0.4, S, 'fenceWood', { bev: 0.1 });
  for (let i = 0; i < 6; i++) f.box(-S / 2 + 0.4 + i * 0.76, TOP + 0.005, 0, 0.06, 0.04, S - 0.2, 'fenceDark', { g: 'noink', bev: 0 });
  for (const [sx, sz] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
    f.solid('tower', sx * (S / 2 - 0.3), (TOP - 0.4) / 2, sz * (S / 2 - 0.3), 0.5, TOP - 0.4, 0.5, 'fenceDark', { bev: 0.08 });
  }
  // X braces on the north and south faces (visual)
  for (const sz of [-1, 1]) for (const r of [-1, 1]) f.box(0, (TOP - 0.4) / 2, sz * (S / 2 - 0.3), S * 1.08, 0.22, 0.16, 'fenceDark', { roll: r * 0.78, bev: 0.04 });
  // rails: west full, north + south full, east only on the north half (entry from the pot stair)
  const RH = 0.8;
  f.solid('tower', -S / 2 + 0.1, TOP + RH / 2, 0, 0.2, RH, S, 'fenceWood', { bev: 0.05 });
  for (const sz of [-1, 1]) f.solid('tower', 0, TOP + RH / 2, sz * (S / 2 - 0.1), S, RH, 0.2, 'fenceWood', { bev: 0.05 });
  f.solid('tower', S / 2 - 0.1, TOP + RH / 2, -S / 4 - 0.1, 0.2, RH, S / 2 - 0.2, 'fenceWood', { bev: 0.05 });
  // pennant pole on the NE corner
  f.cyl(S / 2 - 0.3, TOP + 3.2, -S / 2 + 0.3, 0.07, 4.8, 0.08, 'metal', { seg: 6 });
  f.box(S / 2 - 0.3 + 1.0, TOP + 5.0, -S / 2 + 0.3, 2.0, 1.1, 0.08, 'teamCorgis', { g: 'soft', bev: 0.03 });
  // the gnome (west half of the deck): collider cylinder r 1.25 up to the hat tip
  const g = f.sub(-1.05, TOP, 0.1, -Math.PI / 2);            // gnome faces +x (east, toward the yard)
  gnomeStatue(g, 1.3);
  // ladder on the north face (visual)
  for (const s of [-1, 1]) f.box(s * 0.7, TOP / 2, -S / 2 - 0.35, 0.2, TOP + 0.6, 0.2, 'fenceDark', { bev: 0.04 });
  for (let k = 0; k < 7; k++) f.box(0, 0.5 + k * 0.7, -S / 2 - 0.35, 1.4, 0.14, 0.14, 'fenceWood', { bev: 0.03 });
  // pot stair (east side, rising north toward the deck's open corner)
  potStair(kit);
}

/** Big garden gnome (k = scale): collider cylinder up to the hat tip. Frame: feet at origin, faces -Z. */
function gnomeStatue(g: Frame, k: number): void {
  g.colCyl('gnome', 0, 2.9 * k, 0, 1.25 * k, 2.9 * k);
  g.cyl(0, 1.0 * k, 0, 1.0 * k, 2.0 * k, 1.3 * k, 'teamCorgis', { seg: 14 });
  g.torus(0, 1.2 * k, 0, 1.08 * k, 0.12 * k, 'catBlack', { pitch: Math.PI / 2, seg: 16 });
  g.box(0, 1.2 * k, -1.12 * k, 0.36 * k, 0.3 * k, 0.12 * k, 'accentHot', { bev: 0.04 });
  for (const s of [-1, 1]) g.sphere(s * 0.5 * k, 0.12 * k, -0.35 * k, 0.42 * k, 0.25 * k, 0.6 * k, 'catBlack', { seg: 8 });          // boots
  g.sphere(0, 2.55 * k, 0, 0.85 * k, 0.8 * k, 0.85 * k, 'corgiCream', { seg: 14 });                                              // head
  g.sphere(0, 2.1 * k, -0.55 * k, 0.85 * k, 1.0 * k, 0.55 * k, 'catWhite', { seg: 12, g: 'soft' });                             // beard
  g.sphere(0, 2.62 * k, -0.82 * k, 0.24 * k, 0.24 * k, 0.24 * k, 'corgiRed', { seg: 8 });                                        // nose
  g.cone(0, 4.15 * k, 0.12 * k, 1.02 * k, 2.8 * k, 'danger', { pitch: 0.12, seg: 14 });                                          // hat
  // arms up, binoculars at the eyes
  for (const s of [-1, 1]) g.cyl(s * 0.75 * k, 2.2 * k, -0.45 * k, 0.2 * k, 1.3 * k, 0.24 * k, 'teamCorgis', { pitch: -1.1, roll: s * 0.25, seg: 8 });
  for (const s of [-1, 1]) g.cyl(s * 0.28 * k, 2.75 * k, -1.0 * k, 0.2 * k, 0.55 * k, 0.2 * k, 'catBlack', { pitch: Math.PI / 2, seg: 10 });
  g.box(0, 2.75 * k, -0.95 * k, 0.4 * k, 0.14 * k, 0.2 * k, 'catBlack', { bev: 0.03 });
}

function potStair(kit: Kit): void {
  const pots: [number, number, number][] = [[4.2, 6.5, 1.3], [4.2, 4.0, 2.5], [4.2, 1.5, 3.7]];
  for (const [px, pz, top] of pots) {
    const R0 = 1.35, R1 = 1.05;
    const wx = TOWER.x + px, wz = TOWER.z + pz;
    const pf = kit.frame(wx, 0, wz, 0);
    pf.colCyl('pot', 0, top / 2, 0, R0, top / 2);
    const stacks = Math.round(top / 1.25);
    const seg = top / stacks;
    for (let k = 0; k < stacks; k++) {
      const y0 = k * seg;
      pf.cyl(0, y0 + seg / 2, 0, R0 - 0.06, seg - 0.02, R1 + (k ? 0.12 : 0), 'terracotta', { seg: 16 });
      pf.torus(0, y0 + seg - 0.12, 0, R0 - 0.05, 0.14, 'terracottaDark', { pitch: Math.PI / 2, seg: 18 });
    }
    pf.cyl(0, top - 0.06, 0, R0 - 0.2, 0.1, R0 - 0.2, 'mulch', { seg: 14, g: 'noink' });
    pf.cone(0.4, top + 0.3, -0.2, 0.25, 0.6, 'leaf', { seg: 5, g: 'soft' });
  }
}

/** Arched garden gate where the path enters from the corgi side (landmark; posts are colliders). */
function gateArch(f: Frame, rng: Rng): void {
  const W = 4.6, H = 5.2;
  for (const s of [-1, 1]) f.solid('gate', s * W / 2, H / 2 - 0.3, 0, 0.4, H + 0.6, 0.4, 'trim', { bev: 0.06 });
  for (let i = 0; i < 8; i++) {
    const t0 = i / 8, t1 = (i + 1) / 8;
    const xa = -W / 2 + W * t0, xb = -W / 2 + W * t1;
    const ya = H + 1.1 * Math.sin(Math.PI * t0), yb = H + 1.1 * Math.sin(Math.PI * t1);
    f.box((xa + xb) / 2, (ya + yb) / 2, 0, Math.hypot(xb - xa, yb - ya) + 0.05, 0.3, 0.4, 'trim', { roll: Math.atan2(yb - ya, xb - xa), bev: 0.05 });
  }
  for (let i = 0; i < 12; i++) {
    const s = i % 2 ? 1 : -1, y = rng.range(0.6, H + 0.8);
    const x = y > H ? rng.range(-W / 2, W / 2) : s * W / 2;
    f.sphere(x + rng.range(-0.2, 0.2), y, rng.range(-0.25, 0.25), 0.5, 0.42, 0.42, 'leaf', { g: 'soft', seg: 8 });
    if (i % 2 === 0) f.sphere(x, y + 0.2, 0.35, 0.22, 0.22, 0.2, 'pink', { seg: 7 });
  }
}
