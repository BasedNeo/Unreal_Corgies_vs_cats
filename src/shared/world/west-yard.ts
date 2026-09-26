// West Yard — the hub map at pet scale (characters ~1.2 m, backyard ~x4 real size, 200 x 200 m).
// Theme content (prop catalog + placement) lives here as data; the sim builds colliders from it and
// the client builds styled meshes from the VisualPrims. Deterministic from the seed, no Math.random.
//
// Layout (x east, z south; the house is north):
//   N  house wall + raised deck & stairs (Corgi base) · doghouse · AC-unit parkour · patio + grill
//   W  The Garden (G1, garden.ts): veg plot + tomato cages + trellis bridge · tall-grass meadow with
//      pumpkins, bean teepee, compost, sprinklers · flower jungle + gnome watchtower ·
//      big climbable tree · sandbox · back mound + birdbath · neighbour strip
//   C  trampoline (jump pad) · lawn chairs · picnic table · hedge islands · wheelbarrow · hose
//   E  swing set + slide · pond (wading water) · gnome · neighbour strip
//   NE The Garage (D3, garage.ts): detached garage, close-quarters interior, 3 entrances · The Rooftops:
//      its flat roof + satellite crow's nest, reached by a crate stair + lean-to roof or an alley scaffold
//   S  red shed + cat-tree tower + plank bridge (Cats base) · kiddie pool · cardboard boxes
// Movement reference (classes.ts): corgi jump ~1.47 m, double ~2.55 m; cat ~1.84 / ~3.1 m;
// autostep 0.45 m; max walkable slope 52 deg.
import type { Bookmark, Destructible, FenceRun, JumpPad, ScatterZone, SpawnPoint, WaterZone, WorldData } from './world-types';
import { Kit, type Frame } from './kit';
import { bakeTerrainGrid, createYardField, gridHeight, inGrid, type SurfaceOp, type TerrainOp, type TerrainSpec } from './terrain';
import { createRng, hash2 } from './noise';
import { yawToward } from './queries';
import { buildGarden, gardenTerrain, GARDEN_FLANK_PATH } from './garden';
import { buildGarage, garageTerrain } from './garage';
import { crateStack } from './destructibles';

export const FENCE_H = 8;
const HALF = 100;
const TAU = Math.PI * 2;

export function buildWestYard(seed = 1): WorldData {
  const rng = createRng(`westyard:${seed}`);

  // ------------------------------------------------------------------ terrain
  const pathMain = [-53, -74, -44, -56, -26, -34, -10, -14, 4, 6, 16, 24, 28, 44, 40, 62, 46, 76];
  const pathPatio = [26, -74, 28, -64, 34, -50, 48, -42, 60, -36, 68, -34];
  const pathWest = GARDEN_FLANK_PATH;   // dig hole -> through the Garden -> big tree
  const garden = gardenTerrain();
  const garageT = garageTerrain();
  const pathEast = [98, 45, 86, 42, 74, 36, 72, 30];
  const ops: TerrainOp[] = [
    { op: 'raise', x: -38, z: 66, r: 9, falloff: 19, h: 4.2 },             // back mound (Cats-side high ground)
    { op: 'raise', x: 28, z: 18, r: 4, falloff: 14, h: 0.9 },              // low rise by the wheelbarrow
    { op: 'raise', x: -12, z: -52, r: 3, falloff: 12, h: -0.6 },           // gentle dip on the Corgi approach
    { op: 'flat', x: -44, z: -104, hx: 44, hz: 5, h: 0, falloff: 6 },     // house footing
    { op: 'flat', x: -53, z: -90, hx: 21, hz: 11, h: 0, falloff: 5 },     // deck + stairs
    { op: 'flat', x: -18, z: -86, hx: 6, hz: 7, h: 0, falloff: 4 },       // doghouse
    { op: 'flat', x: 29, z: -88, hx: 25, hz: 14, h: 0, falloff: 4 },      // patio
    { op: 'flat', x: 47, z: 88, hx: 16, hz: 11, h: 0, falloff: 5 },       // shed
    { op: 'flat', x: 22, z: 84, hx: 5, hz: 5, h: 0, falloff: 4 },         // cat tree
    { op: 'flat', x: 0, z: 0, hx: 8, hz: 8, h: 0, falloff: 5 },           // trampoline
    { op: 'flat', x: 66, z: -36, hx: 14, hz: 8, h: 0, falloff: 4 },       // swing set
    { op: 'flat', x: 28, z: -52, hx: 7, hz: 5, h: 0, falloff: 4 },        // picnic table
    { op: 'flat', x: -14, z: 52, hx: 9, hz: 9, h: 0, falloff: 4 },        // kiddie pool
    { op: 'flat', x: -72, z: 58, hx: 9, hz: 9, h: 0, falloff: 3 },        // sandbox
    { op: 'path', pts: pathMain, width: 5.5, depth: 0.12 },
    { op: 'path', pts: pathPatio, width: 4.5, depth: 0.1 },
    { op: 'path', pts: pathWest, width: 4, depth: 0.1 },
    { op: 'bowl', x: 58, z: 26, r: 14, depth: 1.5, flat: 0.45, bank: 0.3 }, // pond
    { op: 'pit', x: -72, z: 58, hx: 7.4, hz: 7.4, depth: 0.35, falloff: 0.6 }, // sandbox sand
    { op: 'hole', x: -100, z: -45, r: 2.8, depth: 0.9 },                    // dug holes under the west fence
    { op: 'hole', x: -100, z: 45, r: 2.8, depth: 0.9 },
    { op: 'hole', x: -30, z: -79, r: 1.6, depth: 0.45 },                    // corgi digging near the doghouse
    { op: 'hole', x: -9, z: -74, r: 1.2, depth: 0.35 },
    ...garden.ops,
    ...garageT.ops,
  ];
  const surfaces: SurfaceOp[] = [
    { kind: 'dirt', shape: 'path', pts: pathMain, width: 3.6, soft: 0.9 },
    { kind: 'dirt', shape: 'path', pts: pathPatio, width: 2.8, soft: 0.8 },
    { kind: 'dirt', shape: 'path', pts: pathWest, width: 2.6, soft: 0.8, amount: 0.85 },
    { kind: 'dirt', shape: 'path', pts: pathEast, width: 2.2, soft: 0.8, amount: 0.7 },
    { kind: 'dirt', shape: 'circle', x: 0, z: 0, r: 8.2, soft: 1.4, amount: 0.75 },     // worn ring under the trampoline
    { kind: 'dirt', shape: 'rect', x: 61, z: -36, hx: 6, hz: 2.2, soft: 1.2 },          // under the swings
    { kind: 'dirt', shape: 'circle', x: -18, z: -77, r: 4, soft: 1.5, amount: 0.9 },    // doghouse front
    { kind: 'dirt', shape: 'circle', x: -30, z: -79, r: 2.6, soft: 0.8 },
    { kind: 'dirt', shape: 'circle', x: -9, z: -74, r: 2, soft: 0.7 },
    { kind: 'dirt', shape: 'circle', x: -100, z: -45, r: 3.6, soft: 0.8 },
    { kind: 'dirt', shape: 'circle', x: -100, z: 45, r: 3.6, soft: 0.8 },
    { kind: 'dirt', shape: 'circle', x: 58, z: 26, r: 14.6, soft: 0.8, amount: 0.9 },   // pond bank
    { kind: 'sand', shape: 'rect', x: -72, z: 58, hx: 7.6, hz: 7.6, soft: 0.5 },
    { kind: 'sand', shape: 'circle', x: -63, z: 50, r: 3, soft: 1.2, amount: 0.7 },     // spilled sand
    { kind: 'mulch', shape: 'circle', x: -52, z: 22, r: 10.5, soft: 1.2 },               // tree ring
    { kind: 'mulch', shape: 'rect', x: -8, z: -97.5, hx: 5.5, hz: 2.6, soft: 0.6 },     // bed along the house
    { kind: 'mulch', shape: 'rect', x: -80, z: -97, hx: 5, hz: 3, soft: 0.6 },
    { kind: 'mulch', shape: 'circle', x: -38, z: 66, r: 3.5, soft: 0.8 },                // birdbath bed
    { kind: 'mulch', shape: 'rect', x: 47, z: 98.5, hx: 14, hz: 1.4, soft: 0.5 },       // behind the shed
    ...garden.surfaces,
    ...garageT.surfaces,
  ];
  const spec: TerrainSpec = {
    seed,
    undulation: { amp: 0.55, scale: 34, amp2: 0.16, scale2: 9 },
    yard: { minX: -HALF, maxX: HALF, minZ: -HALF, maxZ: HALF, edgeFade: 10 },
    wildBand: 7,
    ops, surfaces,
  };
  const field = createYardField(spec);
  const GRID_HALF = 120;
  const terrain = bakeTerrainGrid(field.raw, -GRID_HALF, -GRID_HALF, 1, GRID_HALF * 2 + 1);
  const height = (x: number, z: number) => (inGrid(terrain, x, z) ? gridHeight(terrain, x, z) : field.raw(x, z));

  const kit = new Kit();
  const at = (x: number, z: number, yaw = 0) => kit.frame(x, height(x, z), z, yaw);
  const flat = (x: number, z: number, yaw = 0) => kit.frame(x, 0, z, yaw);
  const jumpPads: JumpPad[] = [];
  const water: WaterZone[] = [];
  const fences: FenceRun[] = [];
  const zones: ScatterZone[] = [];

  // ------------------------------------------------------------------ fences
  // Main yard fence (boards face the yard) + neighbour strips (x in [-114,-100] and [100,114], z in [-70,70]).
  const gapsW = [
    { t0: 55 - 1.6, t1: 55 + 1.6, kind: 'dig' as const, bottom: 1.25 },
    { t0: 145 - 1.6, t1: 145 + 1.6, kind: 'dig' as const, bottom: 1.25 },
  ];
  const gapsE = [
    { t0: 55 - 2, t1: 55 + 2, kind: 'broken' as const, top: 1.55 },
    { t0: 145 - 1.3, t1: 145 + 1.3, kind: 'open' as const },
  ];
  fences.push(
    { x0: -HALF, z0: -HALF, x1: -HALF, z1: HALF, h: FENCE_H, face: -1, gaps: gapsW },   // west, runs +z, yard is to +x
    { x0: HALF, z0: -HALF, x1: HALF, z1: HALF, h: FENCE_H, face: 1, gaps: gapsE },       // east, yard to -x
    { x0: -HALF, z0: HALF, x1: HALF, z1: HALF, h: FENCE_H, face: -1 },                   // south, runs +x, yard to -z
    { x0: -HALF, z0: -HALF, x1: -86, z1: -HALF, h: FENCE_H, face: 1 },                  // north stubs beside the house
    { x0: -2, z0: -HALF, x1: HALF, z1: -HALF, h: FENCE_H, face: 1 },
    // neighbour strips (boards face into the strip)
    { x0: -114, z0: -70, x1: -114, z1: 70, h: FENCE_H, face: -1 },
    { x0: -114, z0: -70, x1: -HALF, z1: -70, h: FENCE_H, face: 1 },
    { x0: -114, z0: 70, x1: -HALF, z1: 70, h: FENCE_H, face: -1 },
    { x0: 114, z0: -70, x1: 114, z1: 70, h: FENCE_H, face: 1 },
    { x0: HALF, z0: -70, x1: 114, z1: -70, h: FENCE_H, face: 1 },
    { x0: HALF, z0: 70, x1: 114, z1: 70, h: FENCE_H, face: -1 },
  );
  for (const f of fences) fenceColliders(kit, f);
  // Invisible blockers above every fence so nobody launches out of the map.
  for (const f of fences) {
    const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0), yaw = Math.atan2(f.x1 - f.x0, f.z1 - f.z0);
    kit.colBox('boundary', (f.x0 + f.x1) / 2, FENCE_H + 30, (f.z0 + f.z1) / 2, 0.4, 30, len / 2 + 0.5, yaw);
  }
  // Fence corner/end posts (visual chunkiness at the corners)
  for (const [x, z] of [[-HALF, -HALF], [HALF, -HALF], [-HALF, HALF], [HALF, HALF], [-114, -70], [-114, 70], [114, -70], [114, 70]] as const) {
    flat(x, z).solid('fence', 0, (FENCE_H + 0.8) / 2, 0, 0.9, FENCE_H + 0.8, 0.9, 'fenceDark', { bev: 0.12 });
    flat(x, z).cone(0, FENCE_H + 1.1, 0, 0.62, 0.9, 'fenceDark', { seg: 4, yaw: Math.PI / 4 });
  }

  // ------------------------------------------------------------------ house (north wall)
  house(kit);
  // ------------------------------------------------------------------ deck + stairs (Corgi base)
  deck(kit);
  // ------------------------------------------------------------------ doghouse (Corgi base)
  doghouse(kit.frame(-18, 0, -87, 0));
  // AC unit + brick steps: parkour route onto the deck's west end
  acUnitAndBricks(kit);
  // Patio + grill + pots
  patio(kit);
  jumpPads.push(miniTrampoline(kit.frame(-38, 0, -78.5, 0.4), 'corgi_mini'));

  // ------------------------------------------------------------------ Cats base
  shed(kit.frame(47, 0, 88, 0));
  catTree(kit.frame(22, 0, 84, 0));
  // plank "cat walk" from the tower top (6.4 m) up onto the shed roof (~9 m), ~12 deg
  {
    const f = kit.frame(0, 0, 0);
    const x0 = 23.9, y0 = 6.5, x1 = 35.4, y1 = 9.0, z = 82.7, roll = Math.atan2(y1 - y0, x1 - x0);
    f.box((x0 + x1) / 2, (y0 + y1) / 2 - 0.12, z, Math.hypot(x1 - x0, y1 - y0) + 0.6, 0.3, 1.5, 'fenceWood', { roll, bev: 0.08 });
    f.ramp('plank', [x0 - 0.3, y0 + 0.05, z], [x1 + 0.4, y1 + 0.1, z], 1.5, 0.4);
    for (const t of [0.3, 0.7]) f.box(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t - 0.35, z, 0.25, 0.6, 1.8, 'fenceDark', { roll });
  }
  cardboardBoxes(kit, height);
  jumpPads.push(miniTrampoline(at(10, 76, -0.3), 'cats_mini'));

  // ------------------------------------------------------------------ center
  jumpPads.push(trampoline(kit.frame(0, 0, 0, 0.2), 'center'));
  lawnChair(kit.frame(-20, height(-20, 10), 10, 0.5), 'teal');
  lawnChair(kit.frame(21, height(21, -14), -14, 2.7), 'accent');
  picnicTable(kit.frame(28, 0, -52, 0.12));
  hedge(kit, rng, 8, -42, 18, Math.PI / 2 + 0.28, height);
  hedge(kit, rng, 5, 34, 16, Math.PI / 2 - 0.35, height);
  hedge(kit, rng, -32, -26, 12, 1.2, height);
  hedge(kit, rng, 40, 44, 12, 1.35, height);
  wheelbarrow(kit.frame(22, height(22, 20), 20, 2.2));
  beachBall(kit.frame(-34, height(-34, -6), -6, 0));
  hose(kit, height);

  // ------------------------------------------------------------------ west flank: The Garden (G1)
  const gardenRng = createRng(`garden:${seed}`);
  const gardenBuilt = buildGarden(kit, gardenRng, height);
  bigTree(kit, rng, -52, 22, height);
  sandbox(kit.frame(-72, 0, 58, 0));
  birdbath(kit.frame(-38, height(-38, 66), 66, 0.3));
  hedge(kit, rng, -80, 95.5, 34, Math.PI / 2, height);
  hedge(kit, rng, -94.5, 80, 18, 0, height);

  // ------------------------------------------------------------------ east flank
  swingSet(kit.frame(66, 0, -36, 0));
  // north-east flank: The Garage + The Rooftops (D3; no rng, so the yard's random stream is unchanged)
  const garageBuilt = buildGarage(kit, height);
  pond(kit, rng, height, water);
  gnome(kit.frame(76, height(76, 42), 42, -2.4));
  hedge(kit, rng, 88, 2, 26, 0, height);
  kiddiePool(kit.frame(-14, 0, 52, 0), water);

  // ------------------------------------------------------------------ neighbour strips
  strips(kit, rng);

  // ------------------------------------------------------------------ spawns
  const spawnList: [number, number, 0 | 1][] = [
    [-64, -70, 0], [-50, -68, 0], [-40, -71, 0], [-28, -70, 0], [-16, -72, 0], [-6, -79, 0],
    [24, 70, 1], [34, 72, 1], [46, 71, 1], [58, 71, 1], [68, 76, 1], [74, 64, 1],
  ];
  const spawns: SpawnPoint[] = spawnList.map(([x, z, team]) => {
    const [tx, tz] = team === 0 ? [0, -20] : [0, 20];
    return { x, y: height(x, z) + 0.05, z, yaw: yawToward(x, z, tx, tz), team };
  });

  // ------------------------------------------------------------------ scatter zones (visual)
  zones.push(
    { x: -52, z: 22, r: 5, density: 0 },         // trunk
    { x: 58, z: 26, r: 13.5, density: 0 },       // pond water
    { x: -14, z: 52, r: 7.6, density: 0 },       // kiddie pool
    { x: 0, z: 0, r: 7, density: 0 },            // trampoline shadow ring
    { x: -97, z: -60, r: 10, density: 1.8 },     // tall tufts along the fence corners
    { x: 95, z: 70, r: 12, density: 1.8 },
    { x: -38, z: 66, r: 16, density: 1.3 },      // mound meadow
    { x: 80, z: 20, r: 14, density: 1.5 },       // pond meadow
  );

  const bookmarks: Bookmark[] = [
    { name: 'overview', pos: [-124, 72, 140], look: [2, 2, -22], fov: 50 },
    { name: 'deck', pos: [-34, 2.2, -56], look: [-52, 6, -92], fov: 62 },
    { name: 'cats', pos: [12, 2.2, 52], look: [40, 5.5, 88], fov: 62 },
    { name: 'center', pos: [-15, 2.6, -23], look: [3, 2.2, 6], fov: 62 },
    { name: 'flank', pos: [-78, 2.2, -64], look: [-60, 4, 10], fov: 62 },
    { name: 'pond', pos: [36, 2.6, 6], look: [62, 1, 32], fov: 62 },
    { name: 'tree', pos: [-30, 3, 0], look: [-54, 8, 26], fov: 62 },
    { name: 'strip', pos: [-107, 2.2, -62], look: [-106, 2.5, 20], fov: 62 },
    ...gardenBuilt.bookmarks,
    ...garageBuilt.bookmarks,
  ];

  return {
    seed,
    name: 'West Yard',
    height,
    halfExtent: HALF,
    props: kit.props,
    spawns,
    killY: -20,
    cylinders: kit.cylinders,
    jumpPads,
    water,
    bookmarks,
    prims: kit.prims,
    fences,
    terrain,
    surface: field.surface,
    scatterZones: zones,
    bounds: { minX: -117, maxX: 117, minZ: -103, maxZ: 103 },
    timeOfDay: 0.68,
    concealZones: gardenBuilt.concealZones,
    sprinklers: gardenBuilt.sprinklers,
    districts: [gardenBuilt.district, ...garageBuilt.districts],
    lamps: garageBuilt.lamps,
    perches: garageBuilt.perches,
    destructibles: [...garageBuilt.destructibles, ...yardCrates(height)],
  };
}

// ====================================================================== X1: crate stacks (destructible)
/** Breakable crate stacks on open lawn (x, z, yaw): clear of spawns, pickups, routes, pads and the hold zone. */
export const YARD_CRATES: readonly (readonly [number, number, number])[] = [
  [50, -58, 0.3],      // west of the lean-to, on the patio's way to the garage
  [68, -24, -0.5],     // east lawn, between the swing set and the pond meadow
  [70, -78, 1.1],      // north-east corner lawn, by the pet door
];

function yardCrates(height: (x: number, z: number) => number): Destructible[] {
  return YARD_CRATES.map(([x, z, yaw], i) => crateStack(`crate_stack_${i + 1}`, x, height(x, z), z, yaw, 51 + i));
}

// ====================================================================== fences
function fenceColliders(kit: Kit, f: FenceRun): void {
  const len = Math.hypot(f.x1 - f.x0, f.z1 - f.z0);
  const dx = (f.x1 - f.x0) / len, dz = (f.z1 - f.z0) / len;
  const yaw = Math.atan2(dx, dz);
  const seg = (t0: number, t1: number, y0: number, y1: number) => {
    if (t1 - t0 < 0.05 || y1 - y0 < 0.05) return;
    const tm = (t0 + t1) / 2;
    kit.colBox('fence', f.x0 + dx * tm, (y0 + y1) / 2, f.z0 + dz * tm, 0.3, (y1 - y0) / 2, (t1 - t0) / 2, yaw);
  };
  const gaps = [...(f.gaps ?? [])].sort((a, b) => a.t0 - b.t0);
  let t = 0;
  for (const g of gaps) {
    seg(t, g.t0, -2, f.h);
    if (g.kind === 'dig') seg(g.t0, g.t1, g.bottom ?? 1.2, f.h);
    else if (g.kind === 'broken') seg(g.t0, g.t1, -2, g.top ?? 1.5);
    t = g.t1;
  }
  seg(t, len, -2, f.h);
}

// ====================================================================== house
function house(kit: Kit): void {
  const f = kit.frame(-44, 0, -100, 0);  // local origin on the wall face, x along the wall
  const W = 84, H = 28;
  f.colBox('house', 0, H / 2 - 2, -5, W, H + 4, 10);
  // foundation band
  f.box(0, 0.8, -0.45, W + 0.6, 1.8, 1.2, 'concrete', { bev: 0.15 });
  // lap siding: slightly tilted boards stacked (bottom edge kicked out) -> reads as siding at any distance
  for (let i = 0; i < 19; i++) {
    const y = 1.7 + i * 1.38 + 0.69;
    f.box(0, y, -0.3, W, 1.42, 0.5, i % 2 ? 'hullLight' : 'siding', { pitch: -0.07, bev: 0.08 });
  }
  // corner trim + frieze board + eave
  for (const x of [-W / 2, W / 2]) f.box(x, H / 2, -0.2, 1.4, H, 1.4, 'trim', { bev: 0.15 });
  f.box(0, H - 0.6, -0.2, W + 1.4, 1.4, 1.2, 'trim', { bev: 0.15 });
  f.box(0, H + 0.4, 1.2, W + 6, 1.0, 4.4, 'trim', { bev: 0.2 });           // soffit/eave
  f.box(0, H + 1.0, 3.2, W + 6, 0.9, 0.9, 'catGrey', { bev: 0.25 });        // gutter
  // house body behind the facade (visual) + gable roof rising AWAY from the yard, ridge along x
  const DEPTH = 44, RIDGE = H + 12, zF = 3.2, zB = -DEPTH - 3.2, zR = -DEPTH / 2;
  f.box(0, H / 2, -DEPTH / 2 - 0.6, W - 0.4, H, DEPTH - 1.2, 'siding', { bev: 0.3 });
  for (const [z0, z1] of [[zF, zR], [zB, zR]]) {
    const run = Math.abs(z1 - z0), len = Math.hypot(run, RIDGE - H - 0.6), pitch = Math.atan2(RIDGE - H - 0.6, run) * Math.sign(z0 - z1);
    f.box(0, (H + 0.6 + RIDGE) / 2 + 0.5, (z0 + z1) / 2, W + 6.5, 1.2, len + 0.6, 'roof', { pitch, bev: 0.3 });
  }
  f.box(0, RIDGE + 1.1, zR, W + 7, 1.0, 1.4, 'roof', { bev: 0.3 });
  for (const x of [-W / 2 + 0.2, W / 2 - 0.2]) for (let i = 0; i < 6; i++) {
    const y = H + 1 + i * 1.9, d = (DEPTH - 2) * (1 - (i + 0.7) / 6.3);
    f.box(x, y, zR, 1.0, 1.9, d, i % 2 ? 'siding' : 'hullLight', { bev: 0.15 });
  }
  f.solidCyl('chimney', 26, H + 14, -18, 3.2, 12, 3.2, 'brick', { seg: 4, yaw: Math.PI / 4 });
  // downspout
  f.cyl(W / 2 - 2.2, H / 2 + 0.4, 0.8, 0.4, H - 0.4, 0.4, 'catGrey', { seg: 10 });
  f.box(W / 2 - 2.2, 0.3, 1.8, 1.6, 0.35, 2.6, 'concrete', { bev: 0.1 });
  // sliding glass door onto the deck (deck top y = 3)
  const dx = -9;
  f.colBox('house', dx, 3 + 4.6, 0.35, 15.2, 9.6, 0.7);
  f.box(dx, 3 + 4.6, -0.2, 15.2, 9.6, 1.0, 'trim', { bev: 0.18 });
  f.box(dx - 3.5, 3 + 4.5, 0.25, 6.6, 8.6, 0.3, 'glass', { g: 'noink', bev: 0.05 });
  f.box(dx + 2.2, 3 + 4.5, 0.55, 6.6, 8.6, 0.3, 'glass', { g: 'noink', bev: 0.05 });
  for (const x of [dx - 7.1, dx - 0.2, dx + 5.6, dx - 1.2]) f.box(x, 3 + 4.5, x > dx ? 0.75 : 0.45, 0.55, 8.9, 0.5, 'trim', { bev: 0.1 });
  f.box(dx + 4.2, 3 + 4.4, 1.0, 0.35, 1.8, 0.35, 'metal', { bev: 0.08 });  // handle
  // windows: ground floor (left of door + kitchen right) and upper floor
  const win = (x: number, y: number, w: number, h: number) => {
    f.box(x, y, -0.1, w + 1.4, h + 1.4, 0.9, 'trim', { bev: 0.15 });
    f.box(x, y, 0.3, w, h, 0.3, 'glass', { g: 'noink', bev: 0.05 });
    f.box(x, y, 0.55, 0.35, h, 0.3, 'trim', { bev: 0.06 });
    f.box(x, y, 0.55, w, 0.35, 0.3, 'trim', { bev: 0.06 });
    f.box(x, y - h / 2 - 0.9, 0.9, w + 2.2, 0.5, 1.6, 'trim', { bev: 0.12 }); // sill
  };
  win(-30, 10.5, 8, 7); win(20, 9.5, 10, 6.5); win(34, 9.5, 6, 6.5);
  win(-30, 21.5, 8, 6); win(-9, 21.5, 7, 6); win(12, 21.5, 7, 6); win(32, 21.5, 7, 6);
  // shutters on the upper windows
  for (const x of [-30, -9, 12, 32]) for (const s of [-1, 1]) f.box(x + s * (x === -30 ? 5.4 : 4.9), 21.5, 0.35, 1.6, 7.2, 0.3, 'teamCorgis', { bev: 0.1 });
  // outdoor tap + mulch bed with flowers along the wall (east end)
  f.box(37, 2.2, 0.6, 0.5, 0.5, 1.0, 'metal', { bev: 0.1 });
  f.sphere(37, 2.8, 1.0, 0.45, 0.25, 0.45, 'danger', { seg: 8 });
  for (let i = 0; i < 5; i++) {
    const x = 32 + i * 2.2 - 0.3 * (i % 2);
    f.cyl(x, 0.9, 2.2 + (i % 2) * 0.8, 0.12, 1.8, 0.12, 'leafDark', { seg: 5, g: 'soft' });
    f.sphere(x, 1.9, 2.2 + (i % 2) * 0.8, 0.8, 0.55, 0.8, i % 2 ? 'pink' : 'flowerYellow', { g: 'soft', seg: 8 });
  }
}

// ====================================================================== deck (Corgi base)
function deck(kit: Kit): void {
  const cx = -53, z0 = -100, z1 = -84, x0 = -72, x1 = -34, top = 3;
  const f = kit.frame(0, 0, 0);
  f.colBox('deck', cx, (top - 1.5) / 2, (z0 + z1) / 2, x1 - x0, top + 1.5, z1 - z0);
  // boards run along x
  const n = 28, bw = (z1 - z0) / n;
  for (let i = 0; i < n; i++) {
    const z = z0 + bw * (i + 0.5);
    f.box(cx, top - 0.14, z, x1 - x0 + 0.4, 0.28, bw - 0.05, i % 3 === 1 ? 'fenceDark2' : 'fenceWood', { bev: 0.07 });
  }
  // rim joist + skirt
  f.box(cx, top - 0.55, z1 + 0.15, x1 - x0 + 0.6, 0.8, 0.45, 'fenceDark', { bev: 0.1 });
  for (const x of [x0 - 0.15, x1 + 0.15]) f.box(x, top - 0.55, (z0 + z1) / 2, 0.45, 0.8, z1 - z0, 'fenceDark', { bev: 0.1 });
  f.box(cx, (top - 0.9) / 2, z1 - 0.3, x1 - x0 - 0.4, top - 0.9, 0.4, 'underDeck', { bev: 0.05, g: 'noink' });
  for (const x of [x0 + 0.1, x1 - 0.1]) f.box(x, (top - 0.9) / 2, (z0 + z1) / 2, 0.4, top - 0.9, z1 - z0 - 0.4, 'underDeck', { bev: 0.05, g: 'noink' });
  for (let x = x0 + 1.2; x <= x1 - 1; x += 2.9) {
    if (Math.abs(x - cx) < 5.6) continue;
    f.box(x, (top - 0.9) / 2, z1 + 0.1, 0.5, top - 0.9, 0.3, 'fenceDark', { bev: 0.08 });
  }
  for (const x of [x0 + 0.4, cx - 5.6, cx + 5.6, x1 - 0.4]) f.box(x, top / 2, z1 + 0.2, 0.9, top + 0.2, 0.9, 'fenceWood', { bev: 0.15 });
  // east railing (balusters) — blocks the drop toward the doghouse
  f.colBox('rail', x1 - 0.2, top + 1.6, (z0 + z1) / 2 + 0.4, 0.5, 3.2, z1 - z0 - 0.8);
  f.box(x1 - 0.2, top + 3.1, (z0 + z1) / 2 + 0.4, 0.6, 0.35, z1 - z0 - 0.6, 'fenceWood', { bev: 0.1 });
  f.box(x1 - 0.2, top + 0.25, (z0 + z1) / 2 + 0.4, 0.45, 0.3, z1 - z0 - 0.6, 'fenceWood', { bev: 0.08 });
  for (let z = z0 + 1.2; z <= z1 - 0.3; z += 1.05) f.box(x1 - 0.2, top + 1.65, z, 0.3, 2.8, 0.3, 'fenceWood', { bev: 0.06 });
  for (const z of [z0 + 0.8, z1 - 0.4]) f.box(x1 - 0.2, top + 1.8, z, 0.8, 3.6, 0.8, 'fenceDark', { bev: 0.12 });
  // stairs: 10 steps of 0.3 m rise / 0.72 m run, centered on cx; ramp collider through the step midpoints
  const W = 10, rise = 0.3, run = 0.72;
  for (let k = 1; k <= 9; k++) {
    const y = top - rise * k, zc = z1 + run * (k - 0.5);
    f.box(cx, y - rise / 2 - 0.02, zc + 0.05, W, rise + 0.1, run + 0.12, k % 2 ? 'fenceWood' : 'fenceDark2', { bev: 0.06 });
  }
  const zb = z1 + run * 9.9;
  for (const s of [-1, 1]) {
    f.box(cx + s * (W / 2 + 0.25), top / 2 - 0.2, (z1 + zb) / 2, 0.5, 1.2, Math.hypot(zb - z1, top) + 0.4, 'fenceDark', { pitch: Math.atan2(top, zb - z1), bev: 0.1 });
  }
  f.ramp('stairs', [cx, top - rise / 2, z1], [cx, -rise / 2, z1 + (top / rise) * run], W, 1.2);
  // deck furniture: two chunky planters at the front corners (cover), a bench, flag
  for (const x of [x0 + 3.2, x1 - 3.2]) {
    f.solid('planter', x, top + 0.7, z1 - 2, 4.2, 1.4, 2.6, 'teamCorgis', { bev: 0.2 });
    f.box(x, top + 1.42, z1 - 2, 3.6, 0.2, 2.0, 'mulch', { bev: 0.05, g: 'noink' });
    for (let i = 0; i < 3; i++) f.sphere(x - 1.1 + i * 1.1, top + 2.1 + (i % 2) * 0.3, z1 - 2, 0.8, 0.7, 0.8, i === 1 ? 'teamCorgisTrim' : 'leaf', { g: 'soft', seg: 8 });
  }
  f.solid('bench', -64, top + 0.9, -97, 7, 0.45, 2.2, 'fenceWood', { bev: 0.12 });
  for (const x of [-67, -61]) f.box(x, top + 0.35, -97, 0.6, 0.7, 1.8, 'fenceDark', { bev: 0.1 });
  f.box(-64, top + 2.1, -98.1, 7, 2.0, 0.4, 'fenceWood', { pitch: 0.18, bev: 0.12 });
  // Corgi team banner on a pole at the deck's east corner
  f.cyl(x1 - 1.2, top + 6, z1 - 1.2, 0.18, 12, 0.22, 'metal', { seg: 8 });
  f.box(x1 - 1.2 - 2.4, top + 10.2, z1 - 1.2, 4.6, 3, 0.15, 'teamCorgis', { bev: 0.05, g: 'soft' });
  f.box(x1 - 1.2 - 2.4, top + 9.2, z1 - 1.2, 4.6, 0.6, 0.2, 'teamCorgisTrim', { bev: 0.05, g: 'soft' });
  f.sphere(x1 - 1.2, top + 12.2, z1 - 1.2, 0.45, 0.45, 0.45, 'teamCorgisTrim', { seg: 10 });
}

// ====================================================================== doghouse
function doghouse(f: Frame): void {
  // local: door faces +z (south). Walls 3.6 m, ridge 5.6 m.
  const W = 7.2, D = 8, H = 3.6, T = 0.5, RIDGE = 5.8;
  f.box(0, 0.25, 0, W + 0.8, 0.5, D + 0.8, 'fenceDark', { bev: 0.12 });               // base
  f.solid('doghouse', 0, H / 2, -D / 2 + T / 2, W, H, T, 'teamCorgis', { bev: 0.12 });  // back
  f.solid('doghouse', -W / 2 + T / 2, H / 2, 0, T, H, D, 'teamCorgis', { bev: 0.12 });
  f.solid('doghouse', W / 2 - T / 2, H / 2, 0, T, H, D, 'teamCorgis', { bev: 0.12 });
  const doorW = 2.6, side = (W - doorW) / 2;
  f.solid('doghouse', -W / 2 + side / 2, H / 2, D / 2 - T / 2, side, H, T, 'teamCorgis', { bev: 0.12 });
  f.solid('doghouse', W / 2 - side / 2, H / 2, D / 2 - T / 2, side, H, T, 'teamCorgis', { bev: 0.12 });
  f.solid('doghouse', 0, H - 0.4, D / 2 - T / 2, doorW, 0.8, T, 'teamCorgis', { bev: 0.12 });
  f.box(0, 1.6, D / 2 - 0.2, 0.2, 0.2, 0.2, 'teamCorgis');
  // door trim (gold arch) + name plate
  f.box(-doorW / 2 - 0.2, 1.5, D / 2 + 0.05, 0.4, 3.0, 0.2, 'teamCorgisTrim', { bev: 0.08 });
  f.box(doorW / 2 + 0.2, 1.5, D / 2 + 0.05, 0.4, 3.0, 0.2, 'teamCorgisTrim', { bev: 0.08 });
  f.torus(0, 2.95, D / 2 + 0.05, doorW / 2 + 0.2, 0.2, 'teamCorgisTrim', { arc: Math.PI, seg: 10 });
  f.box(0, H + 0.35, D / 2 + 0.1, 2.8, 0.7, 0.2, 'teamCorgisTrim', { bev: 0.1 });
  f.box(0, H / 2, 0, W - 2 * T, 0.2, D - 2 * T, 'mulch', { g: 'noink' });           // dark floor
  // gable roof: two sloped slabs (walkable, ~31 deg)
  const half = W / 2 + 0.7, rise = RIDGE - H;
  const pitch = Math.atan2(rise, half), len = Math.hypot(half, rise) + 0.3;
  for (const s of [-1, 1]) {
    f.solid('roof', s * half / 2, H + rise / 2 + 0.2, 0, len, 0.45, D + 1.4, 'roof', { roll: -s * pitch, bev: 0.15 });
  }
  f.box(0, RIDGE + 0.25, 0, 0.7, 0.5, D + 1.6, 'teamCorgisTrim', { bev: 0.2 });
  // gable triangles (front/back) as stacked boards
  for (const zs of [-1, 1]) for (let i = 0; i < 4; i++) {
    const y = H + 0.3 + i * 0.5, w = (W - 0.6) * (1 - (i + 0.5) / 4.6);
    f.box(0, y, zs * (D / 2 - T / 2), w, 0.5, T, 'teamCorgis', { bev: 0.08 });
  }
  // dog bowl, chew bone, kibble sack (step up onto the roof)
  f.solidCyl('bowl', 5.6, 0.45, 4.8, 1.5, 0.9, 1.1, 'metal', { seg: 16 });
  f.cyl(5.6, 0.86, 4.8, 1.25, 0.1, 1.25, 'dirt', { seg: 14, g: 'noink' });
  for (let i = 0; i < 5; i++) f.sphere(5.2 + (i % 3) * 0.4, 0.98, 4.5 + (i % 2) * 0.5, 0.26, 0.2, 0.26, 'corgiRed', { seg: 6, g: 'noink' });
  f.solid('sack', -5.2, 1.0, 3.2, 2.2, 2.0, 1.6, 'corgiOrange', { bev: 0.45, yaw: 0.3 });
  f.box(-5.2, 1.3, 4.05, 1.3, 0.8, 0.1, 'corgiCream', { yaw: 0.3, bev: 0.05 });
  f.cyl(-2.2, 0.35, 7.6, 0.28, 2.6, 0.28, 'catWhite', { roll: Math.PI / 2, yaw: 0.6, seg: 10 });
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const c = Math.cos(0.6), sn = Math.sin(0.6);
    f.sphere(-2.2 + s * 1.3 * c + t * 0.25 * sn, 0.4, 7.6 - s * 1.3 * sn + t * 0.25 * c, 0.42, 0.42, 0.42, 'catWhite', { seg: 10 });
  }
}

// ====================================================================== AC unit + bricks
function acUnitAndBricks(kit: Kit): void {
  const f = kit.frame(-78.5, 0, -97.8, 0);
  f.solid('ac', 0, 1.7, 0, 3.6, 3.4, 3.4, 'catWhite', { bev: 0.3 });
  f.cyl(0, 3.42, 0, 1.3, 0.1, 1.3, 'metal', { seg: 18, g: 'noink' });
  for (let i = 0; i < 5; i++) f.box(0, 1.7, 1.72, 3.1, 0.12, 0.08, 'metal', { g: 'noink', bev: 0.02 });
  f.box(0, 1.7 - 0.4 * 2, 1.72, 3.1, 0.12, 0.08, 'metal', { g: 'noink' });
  // brick steps rising north toward the AC unit: 7 layers of 0.3 m
  for (let k = 0; k < 7; k++) {
    const y = 0.15 + k * 0.3, depth = 7 - k * 0.9, zc = 1.7 + depth / 2;
    kit.colBox('bricks', -78.5, y, -97.8 + zc, 1.8, 0.15, depth / 2, 0);
    const cols = k % 2 ? 3 : 4;
    const bw = 3.6 / cols;
    const rows = Math.max(1, Math.round(depth / 0.9));
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      f.box(-1.8 + bw * (c + 0.5), y, 1.7 + (depth / rows) * (r + 0.5), bw - 0.06, 0.28, depth / rows - 0.06, (c + r + k) % 3 ? 'brick' : 'brickDark', { bev: 0.05 });
    }
  }
}

// ====================================================================== patio
function patio(kit: Kit): void {
  const f = kit.frame(29, 0, -88, 0);
  f.solid('patio', 0, 0.12, 0, 46, 0.34, 24, 'concrete', { bev: 0.1 });
  for (let i = -2; i <= 2; i++) f.box(i * 9.2, 0.3, 0, 0.12, 0.04, 23.6, 'stoneDark', { g: 'noink', bev: 0 });
  for (const z of [-6, 6]) f.box(0, 0.3, z, 45.6, 0.04, 0.12, 'stoneDark', { g: 'noink', bev: 0 });
  // kettle grill (east side)
  const g = f.sub(14, 0.3, -4, 0.4);
  g.sphere(0, 3.6, 0, 2.1, 1.5, 2.1, 'catBlack', { seg: 16 });
  g.sphere(0, 3.9, 0, 2.05, 1.5, 2.05, 'catBlack', { seg: 16 });
  g.box(0, 3.85, 0, 4.3, 0.12, 4.3, 'metal', { bev: 0.04 });
  g.cyl(0, 5.55, 0, 0.35, 0.4, 0.35, 'metal', { seg: 10 });
  g.cyl(0, 5.95, 0, 0.8, 0.3, 0.8, 'catBlack', { seg: 12 });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    g.cyl(Math.cos(a) * 1.2, 1.3, Math.sin(a) * 1.2, 0.14, 2.9, 0.14, 'metal', { pitch: Math.sin(a) * 0.3, roll: -Math.cos(a) * 0.3, seg: 6 });
  }
  g.torus(1.4, 0.45, 0, 0.45, 0.14, 'catBlack', { yaw: Math.PI / 2, seg: 10 });
  g.colCyl('grill', 0, 2.6, 0, 2.0, 2.6);
  // patio table with umbrella (the umbrella is a big visual landmark; collider = pole + table top)
  const t = f.sub(-6, 0.3, -2, 0);
  t.solidCyl('table', 0, 2.9, 0, 3.4, 0.3, 3.4, 'catWhite', { seg: 20 });
  t.cyl(0, 1.4, 0, 0.3, 2.8, 0.5, 'catWhite', { seg: 10 });
  t.colCyl('table', 0, 1.4, 0, 0.5, 1.4);
  t.cyl(0, 7, 0, 0.14, 8.6, 0.14, 'metal', { seg: 8 });
  t.cone(0, 10.9, 0, 6.4, 2.2, 'danger', { seg: 10 });
  t.cone(0, 10.95, 0, 6.2, 2.1, 'catWhite', { seg: 10, yaw: Math.PI / 10, g: 'noink' });
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + 0.4;
    const c = t.sub(Math.cos(a) * 5.3, 0, Math.sin(a) * 5.3, -a + Math.PI / 2);
    c.solid('chair', 0, 1.6, 0, 2.2, 0.3, 2.2, 'catWhite', { bev: 0.12 });
    c.box(0, 3.0, 1.0, 2.2, 2.6, 0.3, 'catWhite', { pitch: 0.12, bev: 0.12 });
    for (const sx of [-0.9, 0.9]) for (const sz of [-0.9, 0.9]) c.box(sx, 0.75, sz, 0.22, 1.5, 0.22, 'catWhite', { bev: 0.05 });
  }
  // terracotta pots on the patio edge (stepping stones up to the house bed)
  const pots: [number, number, number, number, string][] = [[21, -9, 2.6, 1.5, 'pink'], [18, -9.5, 1.6, 1.1, 'flowerYellow'], [21.2, -5.2, 1.1, 0.9, 'purple'], [-21, 9.5, 2.0, 1.3, 'flowerYellow']];
  for (const [x, z, h, r, flower] of pots) {
    const p = f.sub(x, 0.3, z);
    p.solidCyl('pot', 0, h / 2, 0, r, h, r * 0.72, 'terracotta', { seg: 14 });
    p.torus(0, h - 0.05, 0, r - 0.05, 0.14, 'terracotta', { pitch: Math.PI / 2, seg: 12 });
    p.cyl(0, h - 0.12, 0, r - 0.15, 0.1, r - 0.15, 'mulch', { seg: 12, g: 'noink' });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1;
      p.sphere(Math.cos(a) * r * 0.4, h + 0.55 + (i % 2) * 0.25, Math.sin(a) * r * 0.4, r * 0.45, r * 0.4, r * 0.45, i === 0 ? 'leaf' : flower, { g: 'soft', seg: 8 });
    }
  }
}

// ====================================================================== trampolines
function trampoline(f: Frame, id: string): JumpPad {
  const R = 6.6, TOP = 1.25;
  f.colCyl('trampoline', 0, (TOP - 0.6) / 2, 0, R + 0.4, (TOP + 0.6) / 2);
  f.cyl(0, TOP - 0.08, 0, R - 0.9, 0.12, R - 0.9, 'trampMat', { seg: 32, g: 'noink' });
  for (const rr of [0.3, 0.62]) f.torus(0, TOP - 0.01, 0, (R - 0.9) * rr, 0.07, 'trampRing', { pitch: Math.PI / 2, seg: 28, g: 'noink' });   // G1: target rings read "bouncy"
  f.torus(0, TOP - 0.02, 0, R - 0.3, 0.55, 'accentHot', { pitch: Math.PI / 2, seg: 28 });   // padded rim
  f.torus(0, TOP - 0.35, 0, R + 0.1, 0.14, 'metal', { pitch: Math.PI / 2, seg: 28 });        // frame ring
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * TAU;
    const x = Math.cos(a) * (R + 0.1), z = Math.sin(a) * (R + 0.1);
    f.cyl(x, (TOP - 0.3) / 2, z, 0.16, TOP - 0.3, 0.16, 'metal', { seg: 8 });
    f.torus(x, 0.1, z, 0.9, 0.14, 'metal', { yaw: -a, arc: Math.PI, seg: 10 });            // W-shaped leg feet
  }
  // springs: little dark ticks between the mat and the frame
  for (let i = 0; i < 18; i++) {
    const a = (i / 18) * TAU;
    f.box(Math.cos(a) * (R - 0.55), TOP - 0.05, Math.sin(a) * (R - 0.55), 0.9, 0.08, 0.12, 'metal', { yaw: -a, g: 'noink', bev: 0.02 });
  }
  const [x, y, z] = f.w(0, TOP, 0);
  return { id, x, y, z, r: R - 0.7, vy: 17.5 };
}

function miniTrampoline(f: Frame, id: string): JumpPad {
  const R = 2.4, TOP = 0.42;
  f.colCyl('trampoline', 0, (TOP - 0.6) / 2, 0, R + 0.2, (TOP + 0.6) / 2);
  f.cyl(0, TOP - 0.05, 0, R - 0.35, 0.1, R - 0.35, 'trampMat', { seg: 24, g: 'noink' });
  f.torus(0, TOP + 0.01, 0, (R - 0.35) * 0.5, 0.05, 'trampRing', { pitch: Math.PI / 2, seg: 20, g: 'noink' });
  f.torus(0, TOP, 0, R - 0.1, 0.28, id.startsWith('corgi') ? 'teamCorgis' : 'teamCats', { pitch: Math.PI / 2, seg: 22 });
  const [x, y, z] = f.w(0, TOP, 0);
  return { id, x, y, z, r: R - 0.3, vy: 15.5 };
}

// ====================================================================== shed (Cats base)
function shed(f: Frame): void {
  const W = 26, D = 16, H = 7, RIDGE = 10.6;
  f.colBox('shed', 0, (H - 1) / 2, 0, W, H + 1, D);
  f.box(0, 0.35, 0, W + 0.8, 0.7, D + 0.8, 'concrete', { bev: 0.12 });
  // vertical board-and-batten walls
  f.box(0, H / 2 + 0.3, 0, W, H - 0.6, D, 'teamCats', { bev: 0.2 });
  for (let x = -W / 2 + 1.6; x < W / 2 - 1; x += 2.2) {
    f.box(x, H / 2 + 0.3, -D / 2 - 0.12, 0.3, H - 0.8, 0.25, 'teamCatsDark', { bev: 0.06 });
    f.box(x, H / 2 + 0.3, D / 2 + 0.12, 0.3, H - 0.8, 0.25, 'teamCatsDark', { bev: 0.06 });
  }
  for (const s of [-1, 1]) for (let z = -D / 2 + 1.6; z < D / 2 - 1; z += 2.2) f.box(s * (W / 2 + 0.12), H / 2 + 0.3, z, 0.25, H - 0.8, 0.3, 'teamCatsDark', { bev: 0.06 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.box(sx * W / 2, H / 2, sz * D / 2, 0.9, H, 0.9, 'catWhite', { bev: 0.12 });
  // double doors (facing north, -z) with white X braces
  for (const s of [-1, 1]) {
    f.box(s * 2.4, 3.2, -D / 2 - 0.3, 4.6, 6, 0.3, 'teamCats', { bev: 0.1 });
    f.box(s * 2.4, 3.2, -D / 2 - 0.5, 4.6, 0.4, 0.2, 'catWhite', { bev: 0.05 });
    f.box(s * 2.4, 3.2, -D / 2 - 0.5, 0.4, 6.8, 0.2, 'catWhite', { roll: s * 0.65, bev: 0.05 });
  }
  f.box(0, 6.4, -D / 2 - 0.45, 10, 0.5, 0.3, 'catWhite', { bev: 0.1 });
  f.box(0, 3.2, -D / 2 - 0.55, 0.3, 6, 0.2, 'catWhite', { bev: 0.05 });
  // window on the west gable wall
  f.box(-W / 2 - 0.2, 4.2, 0, 0.3, 3.2, 4.4, 'catWhite', { bev: 0.1 });
  f.box(-W / 2 - 0.35, 4.2, 0, 0.2, 2.4, 3.6, 'glass', { g: 'noink', bev: 0.04 });
  // roof: two walkable slabs (~24 deg), ridge along x, overhangs
  const half = D / 2 + 1.1, rise = RIDGE - H, pitch = Math.atan2(rise, half);
  for (const s of [-1, 1]) {
    f.solid('roof', 0, H + rise / 2 + 0.3, s * half / 2, W + 2.4, 0.5, Math.hypot(half, rise) + 0.3, 'catBlack', { pitch: s * pitch, bev: 0.15 });
  }
  f.box(0, RIDGE + 0.35, 0, W + 2.6, 0.6, 0.8, 'catGrey', { bev: 0.25 });
  // gable ends (stepped fill under the roof)
  for (const s of [-1, 1]) for (let i = 0; i < 4; i++) {
    const y = H + 0.4 + i * 0.85, d = (D - 0.2) * (1 - (i + 0.6) / 4.4);
    f.box(s * (W / 2 - 0.2), y, 0, 0.4, 0.85, d, 'teamCats', { bev: 0.08 });
  }
  // Cats banner: black + crimson flag on the roof ridge
  f.cyl(-W / 2 + 2, RIDGE + 5, 0, 0.18, 10, 0.22, 'metal', { seg: 8 });
  f.box(-W / 2 + 2 + 2.4, RIDGE + 8.6, 0, 4.6, 3, 0.15, 'teamCats', { bev: 0.05, g: 'soft' });
  f.box(-W / 2 + 2 + 2.4, RIDGE + 7.4, 0, 4.6, 0.6, 0.2, 'catBlack', { bev: 0.05, g: 'soft' });
  f.sphere(-W / 2 + 2, RIDGE + 10.2, 0, 0.45, 0.45, 0.45, 'catBlack', { seg: 10 });
  // rain barrel + watering can by the shed (cover)
  f.solidCyl('barrel', W / 2 + 2.4, 1.8, -D / 2 + 3, 1.7, 3.6, 1.7, 'leafDark', { seg: 16 });
  for (const y of [0.9, 2.7]) f.torus(W / 2 + 2.4, y, -D / 2 + 3, 1.72, 0.12, 'metal', { pitch: Math.PI / 2, seg: 16 });
  f.cyl(W / 2 + 2.4, 3.62, -D / 2 + 3, 1.5, 0.08, 1.5, 'water', { seg: 14, g: 'noink' });
}

// ====================================================================== cat tree tower
function catTree(f: Frame): void {
  f.solid('cattree', 0, 0.3, 0, 6.4, 0.6, 6.4, 'teamCats', { bev: 0.25 });
  // spiral platforms, 1.2 m apart (corgi single jump 1.47 m)
  const levels: [number, number, number, number][] = [
    [-2.4, 0, 1.6, 3.4], [0, -2.4, 2.8, 3.4], [2.4, 0, 4.0, 3.4], [0, 2.4, 5.2, 3.4], [0.2, 0.1, 6.4, 3.8],
  ];
  for (const [x, z, top, s] of levels) {
    f.solid('cattree', x, top - 0.25, z, s, 0.5, s, 'teamCats', { bev: 0.2 });
    f.box(x, top - 0.52, z, s - 0.3, 0.1, s - 0.3, 'catCream', { g: 'noink', bev: 0.02 });
  }
  const posts: [number, number, number][] = [[-2.4, 0, 1.35], [0, -2.4, 2.55], [2.4, 0, 3.75], [0, 2.4, 4.95], [-0.8, 1.2, 6.15], [1.3, -1, 6.15]];
  for (const [x, z, h] of posts) {
    f.solidCyl('sisal', x, 0.6 + (h - 0.6) / 2, z, 0.5, h - 0.6, 0.5, 'sisal', { seg: 12 });
    for (let y = 0.9; y < h - 0.2; y += 0.7) f.torus(x, y, z, 0.5, 0.07, 'sisalDark', { pitch: Math.PI / 2, seg: 10, g: 'noink' });
  }
  // cat condo cube on level 2 with a round door, top perch bowl rim, dangling toy
  f.torus(2.9, 4.2, 0.3, 1.0, 0.35, 'catCream', { pitch: Math.PI / 2, seg: 16 });   // cat bed on level 3
  f.torus(0.2, 6.55, 0.1, 1.7, 0.3, 'catCream', { pitch: Math.PI / 2, seg: 20 });
  f.cyl(2.4, 3.2, 1.2, 0.03, 1.3, 0.03, 'catBlack', { seg: 4, g: 'noink' });
  f.sphere(2.4, 2.4, 1.2, 0.3, 0.3, 0.3, 'accentHot', { seg: 8 });
}

// ====================================================================== cardboard boxes (cats' favourite cover)
function cardboardBoxes(kit: Kit, height: (x: number, z: number) => number): void {
  const list: [number, number, number, number, number, number][] = [
    [30, 58, 0.3, 3.0, 2.6, 3.0], [34.2, 59, -0.2, 2.4, 2.0, 2.4], [30, 58, 0.7, 2.2, 1.8, 2.2],
    [62, 58, 0.9, 3.4, 2.8, 2.8], [8, 64, -0.6, 2.6, 2.2, 2.6],
  ];
  list.forEach(([x, z, yaw, w, h, d], i) => {
    const stacked = i === 2;
    const y0 = height(x, z) + (stacked ? 2.6 : 0);
    const f = kit.frame(x, y0, z, yaw);
    f.solid('box', 0, h / 2, 0, w, h, d, 'cardboard', { bev: 0.1 });
    f.box(0, h + 0.02, 0, 0.35, 0.04, d + 0.04, 'cardboardDark', { g: 'noink', bev: 0 });       // tape
    // open flaps
    f.box(0, h + 0.3, d / 2 + 0.35, w - 0.1, 0.08, 0.8, 'cardboard', { pitch: -0.9, bev: 0.03 });
    f.box(w / 2 + 0.3, h + 0.25, 0, 0.7, 0.08, d - 0.1, 'cardboard', { roll: 0.8, bev: 0.03 });
  });
}

// ====================================================================== lawn chair
function lawnChair(f: Frame, col: string): void {
  const SEAT = 1.85;
  f.solid('chair', 0, SEAT - 0.15, 0, 3.4, 0.3, 3.2, col, { bev: 0.14 });
  for (let i = 0; i < 5; i++) f.box(-1.36 + i * 0.68, SEAT + 0.02, 0, 0.5, 0.08, 3.0, 'catWhite', { g: 'noink', bev: 0.02 });
  f.solid('chair', 0, SEAT + 2.0, 1.95, 3.4, 4.2, 0.35, col, { pitch: 0.28, bev: 0.14 });
  for (const s of [-1, 1]) {
    f.solid('chair', s * 1.95, SEAT + 0.85, 0.2, 0.5, 0.3, 3.8, col, { bev: 0.12 });
    f.box(s * 1.95, SEAT + 0.35, -1.4, 0.3, 0.9, 0.3, col, { bev: 0.08 });
    for (const z of [-1.3, 1.3]) {
      f.box(s * 1.55, (SEAT - 0.3) / 2, z, 0.34, SEAT - 0.3, 0.34, col, { bev: 0.08 });
      f.colBox('chair', s * 1.55, (SEAT - 0.3) / 2, z, 0.34, SEAT - 0.3, 0.34);
    }
  }
}

// ====================================================================== picnic table
function picnicTable(f: Frame): void {
  const TOP = 3.0, L = 10;
  for (let i = 0; i < 4; i++) f.box(0, TOP - 0.17, -1.35 + i * 0.9, L, 0.34, 0.84, i % 2 ? 'fenceDark2' : 'fenceWood', { bev: 0.08 });
  f.colBox('table', 0, TOP - 0.17, 0, L, 0.34, 3.6);
  for (const s of [-1, 1]) {
    f.solid('bench', 0, 1.7, s * 3.2, L, 0.32, 1.4, 'fenceWood', { bev: 0.1 });
    for (const x of [-3.6, 3.6]) {
      // A-frame legs crossing under top + benches
      f.solid('table', x, 1.45, s * 1.3, 0.45, 3.2, 0.5, 'fenceDark', { pitch: -s * 0.52, bev: 0.08 });
    }
  }
  for (const x of [-3.6, 3.6]) f.box(x, 1.45, 0, 0.4, 0.4, 7.2, 'fenceDark', { bev: 0.08 });
  f.box(0, 1.2, 0, L - 3, 0.3, 0.3, 'fenceDark', { bev: 0.06 });
  // a forgotten frisbee + cup on top
  f.cyl(2.2, TOP + 0.12, 0.4, 0.9, 0.18, 0.95, 'teamCorgisTrim', { seg: 18 });
  f.cyl(-2.5, TOP + 0.5, -0.6, 0.42, 1.0, 0.32, 'danger', { seg: 12 });
}

// ====================================================================== hedge
function hedge(kit: Kit, rng: ReturnType<typeof createRng>, x: number, z: number, len: number, yaw: number, height: (x: number, z: number) => number): void {
  // sit on the lowest ground under the hedge so no end floats on undulating lawn
  const c = Math.sin(yaw) * len / 2, s = Math.cos(yaw) * len / 2;
  const f = kit.frame(x, Math.min(height(x, z), height(x + c, z + s), height(x - c, z - s)), z, yaw);
  const H = 3.3, D = 2.8;
  f.colBox('hedge', 0, H / 2 - 0.4, 0, D, H + 0.8, len);
  f.box(0, H / 2 - 0.45, 0, D - 0.2, H - 0.1, len - 0.4, 'hedge', { bev: 0.9, g: 'soft' });
  const n = Math.max(3, Math.round(len / 2.4));
  for (let i = 0; i < n; i++) {
    const t = -len / 2 + 1 + (len - 2) * (i / (n - 1));
    const r = 1.35 + rng.range(-0.1, 0.35);
    f.sphere(rng.range(-0.3, 0.3), H - 0.5 + rng.range(-0.15, 0.25), t, r, r * 0.85, r * 1.05, i % 3 === 1 ? 'hedgeLight' : 'hedge', { g: 'soft', seg: 10 });
  }
}

// ====================================================================== wheelbarrow
function wheelbarrow(f: Frame): void {
  f.solid('barrow', 0, 1.9, 0, 3.6, 1.6, 5.4, 'teamCorgis', { pitch: -0.12, bev: 0.35 });
  f.box(0, 2.62, -0.1, 3.0, 0.1, 4.6, 'dirt', { pitch: -0.12, g: 'noink' });
  f.cyl(0, 1.0, -3.6, 1.0, 0.7, 1.0, 'catBlack', { roll: Math.PI / 2, seg: 16 });
  f.colBox('barrow', 0, 1.0, -3.6, 0.8, 2.0, 2.0);
  f.cyl(0, 1.0, -3.6, 0.35, 0.8, 0.35, 'metal', { roll: Math.PI / 2, seg: 8 });
  for (const s of [-1, 1]) {
    f.box(s * 1.3, 1.25, 1.2, 0.25, 0.25, 7.4, 'metal', { pitch: -0.1, bev: 0.08 });
    f.cyl(s * 1.3, 1.45, 5.0, 0.28, 1.2, 0.28, 'catBlack', { pitch: Math.PI / 2, seg: 10 });
    f.box(s * 1.1, 0.6, 1.8, 0.22, 1.3, 0.22, 'metal', { bev: 0.05 });
  }
}

function beachBall(f: Frame): void {
  const R = 1.25;
  f.colCyl('ball', 0, R, 0, R * 0.9, R);
  const cols = ['danger', 'catWhite', 'teamCorgis', 'catWhite', 'accentHot', 'catWhite'];
  // six wedge slices as squashed spheres of alternating colour, overlapping to one round ball
  for (let i = 0; i < 6; i++) f.sphere(0, R, 0, R * (i % 2 ? 0.996 : 1), R, R * (i % 2 ? 0.996 : 1), cols[i], { yaw: (i / 6) * Math.PI, seg: 14, g: i ? 'noink' : 'soft' });
  f.sphere(0, R * 2 - 0.04, 0, 0.3, 0.1, 0.3, 'catWhite', { seg: 8, g: 'noink' });
}

// ====================================================================== hose
function hose(kit: Kit, height: (x: number, z: number) => number): void {
  const reel = kit.frame(-6, 0, -95, 0);
  reel.cyl(0, 1.5, 0, 1.9, 0.5, 1.9, 'teamCorgisTrim', { roll: Math.PI / 2, seg: 18 });
  reel.colBox('hose', 0, 1.5, 0, 1.2, 3.8, 3.8);
  for (let i = 0; i < 4; i++) reel.torus(0, 1.5, 0, 1.25 - i * 0.12, 0.22, 'hoseGreen', { yaw: Math.PI / 2, seg: 14 });
  for (const s of [-1, 1]) reel.box(s * 0.5, 0.8, 0, 0.15, 1.6, 2.6, 'metal', { bev: 0.05 });
  // hose snaking across the lawn to a sprinkler (visual only, 0.4 m thick)
  const pts: [number, number][] = [[-6, -93.5], [-4, -88], [2, -80], [-2, -70], [4, -60], [10, -56], [14, -50]];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[i + 1];
    const segs = Math.ceil(Math.hypot(x1 - x0, z1 - z0) / 2.4);
    for (let k = 0; k < segs; k++) {
      const t0 = k / segs, t1 = (k + 1) / segs;
      const ax = x0 + (x1 - x0) * t0, az = z0 + (z1 - z0) * t0, bx = x0 + (x1 - x0) * t1, bz = z0 + (z1 - z0) * t1;
      const wig = Math.sin((i * 3 + k) * 1.7) * 0.6;
      const mx = (ax + bx) / 2 + wig * (bz - az) / 3, mz = (az + bz) / 2 - wig * (bx - ax) / 3;
      const len = Math.hypot(bx - ax, bz - az) + 0.3;
      kit.frame(mx, height(mx, mz) + 0.2, mz).cyl(0, 0, 0, 0.2, len, 0.2, 'hoseGreen', { yaw: Math.atan2(bx - ax, bz - az), pitch: Math.PI / 2, seg: 8, g: 'soft' });
    }
  }
  const sp = kit.frame(14, height(14, -50), -50);
  sp.cyl(0, 0.3, 0, 0.9, 0.6, 1.1, 'metal', { seg: 12 });
  sp.cyl(0, 0.9, 0, 0.2, 0.6, 0.2, 'teamCorgisTrim', { seg: 8 });
  sp.box(0, 1.25, 0, 2.2, 0.2, 0.3, 'teamCorgisTrim', { yaw: 0.5, bev: 0.05 });
}

// ====================================================================== big tree
function bigTree(kit: Kit, rng: ReturnType<typeof createRng>, tx: number, tz: number, height: (x: number, z: number) => number): void {
  const f = kit.frame(tx, height(tx, tz), tz, 0);
  const TR = 4.0;
  f.cyl(0, 10, 0, 2.7, 20, TR, 'bark', { seg: 16, g: 'soft' });
  f.cyl(0, 1.4, 0, TR, 2.8, 5.4, 'bark', { seg: 16, g: 'soft' });
  f.colCyl('tree', 0, 11, 0, TR, 12);
  f.colCyl('tree', 0, 1.2, 0, 4.8, 1.2);
  // roots radiating out: visual tapered logs + walkable ramp colliders
  const rootAngles = [0.2, 2.2, 3.1, 4.05, 5.1];
  rootAngles.forEach((a, i) => {
    const len = 7.5 + (i % 3) * 1.4, r0 = 4.0;
    const ca = Math.cos(a), sa = Math.sin(a);
    const topY = 2.7, x0 = ca * r0, z0 = sa * r0, x1 = ca * (r0 + len), z1 = sa * (r0 + len);
    const g1 = height(tx + x1, tz + z1) - f.oy;
    const pitchAng = Math.atan2(topY - g1, len);
    const mx = (x0 + x1) / 2, mz = (z0 + z1) / 2, my = (topY + g1) / 2 - 0.3;
    f.cyl(mx, my, mz, 0.7, Math.hypot(len, topY - g1) + 1.2, 1.6, 'bark', { yaw: Math.atan2(ca, sa), pitch: Math.PI / 2 + pitchAng, seg: 14, g: 'soft' });
    f.sphere(x1 + ca * 0.3, g1 + 0.1, z1 + sa * 0.3, 0.9, 0.5, 0.9, 'barkDark', { seg: 8, g: 'soft' });
    f.ramp('root', [x0 - ca * 0.2, topY + 0.35, z0 - sa * 0.2], [x1 + ca * 0.6, g1 - 0.1, z1 + sa * 0.6], 2.0, 1.4);
  });
  // branch ladder: stub (3.9) -> limb perch (5.0), both flat-topped, both single-jump steps from a root top
  const stubA = 1.7, limbA = 1.2;
  {
    const ca = Math.cos(stubA), sa = Math.sin(stubA);
    const cx = ca * 5.8, cz = sa * 5.8;
    f.cyl(cx, 3.5, cz, 0.9, 4.4, 1.4, 'bark', { yaw: Math.atan2(ca, sa), pitch: Math.PI / 2 - 0.08, seg: 14, g: 'soft' });
    f.colBox('branch', cx, 3.55, cz, 2.2, 0.7, 4.2, { yaw: Math.atan2(ca, sa) });
    f.box(cx, 3.93, cz, 2.0, 0.1, 4.0, 'barkDark', { yaw: Math.atan2(ca, sa), g: 'noink', bev: 0.03 });
  }
  {
    const ca = Math.cos(limbA), sa = Math.sin(limbA);
    const L = 13, cx = ca * (3.6 + L / 2), cz = sa * (3.6 + L / 2);
    f.cyl(cx, 4.3, cz, 1.0, L + 1, 1.8, 'bark', { yaw: Math.atan2(ca, sa), pitch: Math.PI / 2 - 0.04, seg: 14, g: 'soft' });
    f.colBox('branch', cx, 4.55, cz, 2.4, 0.9, L, { yaw: Math.atan2(ca, sa) });
    f.box(cx, 5.02, cz, 2.2, 0.1, L - 0.6, 'barkDark', { yaw: Math.atan2(ca, sa), g: 'noink', bev: 0.03 });
    // limb sweeps up into the canopy at its tip
    f.cyl(ca * (3.6 + L + 1.5), 8.5, sa * (3.6 + L + 1.5), 0.6, 9, 1.0, 'bark', { yaw: Math.atan2(ca, sa), pitch: 0.5, seg: 12, g: 'soft' });
  }
  // upper limbs into the canopy
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.6;
    f.cyl(Math.cos(a) * 4.5, 22, Math.sin(a) * 4.5, 0.7, 12, 1.5, 'bark', { yaw: Math.atan2(Math.cos(a), Math.sin(a)), pitch: 0.75, seg: 12, g: 'soft' });
  }
  // canopy: big soft blobs (cloud-like, inked)
  const blobs: [number, number, number, number][] = [[0, 30, 0, 11]];
  for (let i = 0; i < 13; i++) {
    const a = (i / 13) * TAU + rng.range(-0.2, 0.2);
    const d = i % 2 ? 12 + rng.range(0, 4) : 7 + rng.range(0, 3);
    blobs.push([Math.cos(a) * d, 24 + rng.range(0, 10) + (i % 2 ? 0 : 5), Math.sin(a) * d, 6.5 + rng.range(0, 3)]);
  }
  blobs.forEach(([x, y, z, r], i) => f.sphere(x, y, z, r, r * 0.82, r, i % 4 === 0 ? 'leafLight' : i % 3 === 0 ? 'leafDark' : 'leaf', { g: 'soft', seg: 12, yaw: i }));
  // tire swing hanging from the limb (visual landmark)
  const ca = Math.cos(limbA), sa = Math.sin(limbA), sx = ca * 14, sz = sa * 14;
  f.cyl(sx, 4.8 - 1.6, sz, 0.05, 3.0, 0.05, 'catBlack', { seg: 4, g: 'noink' });
}

// ====================================================================== sandbox
function sandbox(f: Frame): void {
  const S = 16, H = 1.0, T = 0.7;
  for (const s of [-1, 1]) {
    f.solid('sandbox', s * (S / 2 - T / 2), H / 2 - 0.2, 0, T, H + 0.4, S, 'fenceWood', { bev: 0.14 });
    f.solid('sandbox', 0, H / 2 - 0.2, s * (S / 2 - T / 2), S - 2 * T, H + 0.4, T, 'fenceWood', { bev: 0.14 });
  }
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.solid('sandbox', sx * (S / 2 - 1.3), H + 0.02, sz * (S / 2 - 1.3), 2.6, 0.25, 2.6, 'fenceDark', { yaw: Math.PI / 4, bev: 0.08 });
  // sandcastle (collider) + bucket + spade
  const c = f.sub(-1.5, -0.3, -1.5);
  c.solidCyl('castle', 0, 0.9, 0, 2.4, 1.8, 2.7, 'sand', { seg: 10 });
  c.cyl(0, 2.3, 0, 1.4, 1.0, 1.6, 'sand', { seg: 10 });
  c.cone(0, 3.4, 0, 1.2, 1.4, 'sand', { seg: 8 });
  for (let i = 0; i < 4; i++) c.cyl(Math.cos(i * 1.57) * 2.4, 2.1, Math.sin(i * 1.57) * 2.4, 0.55, 0.9, 0.6, 'sand', { seg: 8 });
  c.box(0, 3.4 + 1.1, 0.25, 0.8, 0.5, 0.05, 'danger', { g: 'soft' });
  c.cyl(0, 4.1, 0, 0.05, 1.2, 0.05, 'catBlack', { seg: 4, g: 'noink' });
  f.solidCyl('bucket', 3.4, 0.6, 3.2, 1.15, 1.8, 0.9, 'teamCorgisTrim', { seg: 14, roll: 0.12 });
  f.torus(3.52, 1.45, 3.2, 1.0, 0.06, 'teamCorgisTrim', { roll: 0.5, seg: 12, arc: Math.PI });
  f.box(-4.3, 0.35, 3.8, 0.35, 0.25, 3.2, 'teamCats', { yaw: 0.7, bev: 0.08 });
  f.box(-5.5, 0.2, 2.6, 1.3, 0.12, 1.4, 'teamCats', { yaw: 0.7, bev: 0.05 });
}

function birdbath(f: Frame): void {
  f.solidCyl('birdbath', 0, 1.8, 0, 0.55, 3.6, 0.8, 'stone', { seg: 12 });
  f.cyl(0, 0.3, 0, 1.3, 0.6, 1.5, 'stone', { seg: 12 });
  f.solidCyl('birdbath', 0, 4.0, 0, 2.6, 0.8, 1.4, 'stone', { seg: 18 });
  f.cyl(0, 4.36, 0, 2.2, 0.08, 2.2, 'water', { seg: 16, g: 'noink' });
  f.sphere(1.2, 4.7, 0.4, 0.4, 0.34, 0.5, 'catGrey', { seg: 8 });                 // a sparrow
  f.sphere(1.2, 5.05, 0.1, 0.24, 0.24, 0.24, 'catGrey', { seg: 8 });
}

// ====================================================================== swing set + slide
function swingSet(f: Frame): void {
  const BEAM = 9, HALFW = 10, LEG = 4.2;
  f.cyl(0, BEAM, 0, 0.45, HALFW * 2 + 1, 0.45, 'teamCorgisTrim', { roll: Math.PI / 2, seg: 12 });
  f.colBox('swing', 0, BEAM, 0, HALFW * 2 + 1, 0.9, 0.9);
  for (const s of [-1, 1]) for (const t of [-1, 1]) {
    const x = s * HALFW, z = t * LEG / 2;
    const len = Math.hypot(BEAM, LEG) + 0.4, pitch = -t * Math.atan2(LEG, BEAM);
    f.cyl(x, BEAM / 2, z, 0.35, len, 0.4, 'teamCats', { pitch, seg: 10 });
    f.colBox('swing', x, BEAM / 2, z, 0.8, len, 0.8, { pitch });
  }
  // swings: seats on chains
  for (const x of [-5.5, -1.5]) {
    f.solid('swing', x, 1.7, 0, 2.2, 0.3, 1.1, 'catBlack', { bev: 0.12 });
    for (const dx of [-0.9, 0.9]) f.cyl(x + dx, 1.85 + (BEAM - 1.85) / 2, 0, 0.06, BEAM - 1.85, 0.06, 'metal', { seg: 4, g: 'noink' });
  }
  f.cyl(3.5, 4.6, 0, 0.06, 8, 0.06, 'metal', { seg: 4, g: 'noink' });
  f.torus(3.5, 1.1, 0, 0.9, 0.3, 'catBlack', { seg: 12 });                        // tire swing ring
  // slide tower at the east end: deck at 5 m, chute sloping south to the ground
  const tx = HALFW + 3.4;
  f.solid('slide', tx, 4.8, 0, 3.4, 0.4, 3.4, 'fenceWood', { bev: 0.12 });
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) f.solid('slide', tx + sx * 1.5, 3.6, sz * 1.5, 0.45, 7.2, 0.45, 'fenceWood', { bev: 0.08 });
  f.box(tx + 1.5, 6.4, 0, 0.3, 0.3, 3.4, 'fenceWood', { bev: 0.06 });
  f.box(tx, 7.4, 0, 3.8, 1.2, 3.8, 'teamCorgis', { bev: 0.12 });                  // little roof
  f.cone(tx, 8.6, 0, 2.8, 1.8, 'teamCorgisTrim', { seg: 4, yaw: Math.PI / 4 });
  const cz0 = 1.7, cz1 = 12.5;
  const slope = Math.atan2(4.8, cz1 - cz0), len = Math.hypot(4.8, cz1 - cz0);
  f.box(tx, 2.6, (cz0 + cz1) / 2, 2.4, 0.25, len, 'accentHot', { pitch: slope, bev: 0.1 });
  for (const s of [-1, 1]) f.box(tx + s * 1.25, 2.95, (cz0 + cz1) / 2, 0.25, 0.8, len, 'accentHot', { pitch: slope, bev: 0.1 });
  f.ramp('slide', [tx, 5.0, cz0], [tx, 0.2, cz1 + 0.2], 2.4, 0.8);
  for (const s of [-1, 1]) f.colBox('slide', tx + s * 1.3, 2.95, (cz0 + cz1) / 2, 0.3, 0.8, len, { pitch: slope });
  // ladder rungs on the north side (visual)
  for (let k = 0; k < 6; k++) f.box(tx, 0.6 + k * 0.8, -2.2, 2.2, 0.18, 0.18, 'fenceDark', { bev: 0.05 });
  for (const s of [-1, 1]) f.box(tx + s * 1.1, 2.5, -2.2, 0.25, 5, 0.25, 'fenceDark', { bev: 0.05 });
}

// ====================================================================== pond
function pond(kit: Kit, rng: ReturnType<typeof createRng>, height: (x: number, z: number) => number, water: WaterZone[]): void {
  const px = 58, pz = 26, R = 14;
  water.push({ id: 'pond', shape: 'circle', x: px, z: pz, r: R - 0.8, surfaceY: -0.3, bottomY: -1.5, drag: 0.62 });
  // rocks around the rim (colliders are low cylinders)
  const n = 11;
  for (let i = 0; i < n; i++) {
    if (i === 3 || i === 8) continue;                               // walk-in gaps
    const a = (i / n) * TAU + rng.range(-0.12, 0.12);
    const d = R + 0.8 + rng.range(-0.3, 0.6);
    const x = px + Math.cos(a) * d, z = pz + Math.sin(a) * d;
    const r = 1.3 + rng.range(0, 1.0), h = 0.9 + rng.range(0, 0.9);
    const f = kit.frame(x, height(x, z), z, rng.range(0, TAU));
    f.sphere(0, h * 0.35, 0, r, h, r * 0.85, i % 2 ? 'stone' : 'stoneDark', { seg: 9 });
    f.colCyl('rock', 0, h * 0.35, 0, r * 0.8, h * 0.9);
  }
  // lily pads + flower, cattails
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, TAU), d = rng.range(3, 10);
    const f = kit.frame(px + Math.cos(a) * d, -0.26, pz + Math.sin(a) * d, rng.range(0, TAU));
    const r = rng.range(0.9, 1.6);
    f.cyl(0, 0, 0, r, 0.08, r, 'leaf', { seg: 12, g: 'noink' });
    if (i % 3 === 0) f.sphere(0.2, 0.3, 0.1, 0.4, 0.3, 0.4, 'pink', { seg: 8, g: 'soft' });
  }
  for (let i = 0; i < 9; i++) {
    const a = 3.6 + i * 0.12, d = R - 1.2 + (i % 2) * 0.8;
    const f = kit.frame(px + Math.cos(a) * d, -0.4, pz + Math.sin(a) * d);
    const h = 3 + (i % 3) * 0.7;
    f.cyl(0, h / 2, 0, 0.07, h, 0.1, 'leafDark', { seg: 5, g: 'soft', roll: (i % 3 - 1) * 0.08 });
    f.cyl(0, h - 0.6, 0, 0.26, 1.1, 0.26, 'barkDark', { seg: 8, roll: (i % 3 - 1) * 0.08 });
  }
  // rubber-duck-sized frog on a lily pad? keep it a stone frog statue on the bank
  const fr = kit.frame(px - 12.5, height(px - 12.5, pz - 7), pz - 7, 1.2);
  fr.sphere(0, 0.8, 0, 1.1, 0.8, 1.2, 'leafLight', { seg: 10 });
  for (const s of [-1, 1]) fr.sphere(s * 0.5, 1.5, -0.6, 0.35, 0.35, 0.35, 'leafLight', { seg: 8 });
  fr.colCyl('frog', 0, 0.8, 0, 1.0, 0.8);
}

function gnome(f: Frame): void {
  f.colCyl('gnome', 0, 1.3, 0, 0.9, 1.3);
  f.cyl(0, 0.9, 0, 0.7, 1.6, 0.95, 'teamCorgis', { seg: 12 });
  f.sphere(0, 2.05, 0, 0.6, 0.55, 0.6, 'corgiCream', { seg: 12 });
  f.sphere(0, 1.75, -0.35, 0.5, 0.65, 0.35, 'catWhite', { seg: 10 });            // beard
  f.sphere(0, 2.1, -0.55, 0.16, 0.16, 0.16, 'corgiRed', { seg: 8 });             // nose
  f.cone(0, 3.05, 0.1, 0.62, 1.7, 'danger', { seg: 12, pitch: 0.15 });
  f.box(0, 0.15, 0, 1.8, 0.3, 1.8, 'stone', { bev: 0.1 });
}

// ====================================================================== kiddie pool
function kiddiePool(f: Frame, water: WaterZone[]): void {
  const R = 7.4, H = 1.1;
  const n = 18;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    f.colBox('pool', Math.cos(a) * R, H / 2 - 0.3, Math.sin(a) * R, 0.5, H + 0.6, (TAU * R) / n + 0.3, { yaw: -a });
  }
  f.ring(0, H / 2, 0, R + 0.25, H, 0.5, 'plasticBlue', { seg: 40 });
  f.cyl(0, 0.06, 0, R - 0.2, 0.12, R - 0.2, 'plasticBlue', { seg: 32, g: 'noink' });
  f.torus(0, H, 0, R - 0.05, 0.4, 'catWhite', { pitch: Math.PI / 2, seg: 32 });
  f.torus(0, H * 0.45, 0, R + 0.15, 0.12, 'accentHot', { pitch: Math.PI / 2, seg: 32, g: 'noink' });
  const [x, , z] = f.w(0, 0, 0);
  water.push({ id: 'kiddie_pool', shape: 'circle', x, z, r: R - 0.5, surfaceY: 0.85, bottomY: 0.05, drag: 0.6 });
  // floating rubber duck (visual)
  const d = f.sub(2.2, 0.85, -1.5, 0.8);
  d.sphere(0, 0.45, 0, 0.9, 0.62, 1.15, 'duck', { seg: 12 });
  d.sphere(0, 1.25, -0.55, 0.55, 0.55, 0.55, 'duck', { seg: 12 });
  d.sphere(0, 1.2, -1.1, 0.3, 0.14, 0.3, 'corgiOrange', { seg: 8 });
  for (const s of [-1, 1]) d.sphere(s * 0.26, 1.45, -0.9, 0.09, 0.09, 0.09, 'catBlack', { seg: 6, g: 'noink' });
}

// ====================================================================== neighbour strips + outer world
function strips(kit: Kit, rng: ReturnType<typeof createRng>): void {
  // West strip: compost bin, old tire, firewood stack
  const c = kit.frame(-107, 0, -18, 0.1);
  c.solid('compost', 0, 2.2, 0, 5, 4.4, 5, 'leafDark', { bev: 0.4 });
  c.box(0, 4.5, 0, 5.4, 0.4, 5.4, 'catBlack', { bev: 0.18 });
  for (let i = 0; i < 3; i++) c.box(-2.52, 1.2 + i * 1.2, 0, 0.1, 0.2, 4.2, 'leaf', { g: 'noink' });
  const t = kit.frame(-107.5, 0, 22, 0);
  t.torus(0, 0.75, 0, 1.6, 0.75, 'catBlack', { pitch: Math.PI / 2, seg: 16 });
  t.colCyl('tire', 0, 0.75, 0, 2.3, 0.75);
  const w = kit.frame(-108, 0, 52, Math.PI / 2);
  for (let r = 0; r < 3; r++) for (let k = 0; k < 5 - r; k++) {
    w.cyl(-2.4 + k * 1.2 + r * 0.6, 0.6 + r * 1.0, 0, 0.55, 5.5, 0.55, k % 2 ? 'bark' : 'barkDark', { pitch: Math.PI / 2, seg: 8 });
  }
  w.colBox('wood', 0, 1.5, 0, 6.4, 3, 5.5);
  // East strip: a ladder on the ground, buckets, a rolled tarp
  const l = kit.frame(107, 0, -22, 0);
  for (const s of [-1, 1]) l.box(s * 1.4, 0.2, 0, 0.35, 0.35, 16, 'metal', { bev: 0.08 });
  for (let k = 0; k < 11; k++) l.box(0, 0.2, -7.5 + k * 1.5, 2.8, 0.2, 0.2, 'metal', { bev: 0.05, g: 'noink' });
  const b = kit.frame(107.5, 0, 16, 0);
  b.solidCyl('bucket', 0, 1.3, 0, 1.5, 2.6, 1.2, 'teamCats', { seg: 14 });
  b.solidCyl('bucket', 2.6, 1.0, 1.4, 1.2, 2.0, 1.0, 'hoseGreen', { seg: 14 });
  const tp = kit.frame(106.5, 0, 48, 0);
  tp.cyl(0, 1.1, 0, 1.1, 7, 1.1, 'teamCorgis', { pitch: Math.PI / 2, seg: 12 });
  tp.colBox('tarp', 0, 1.1, 0, 2.2, 2.2, 7);
  // Outer world (visual only): neighbour houses and round trees behind the fences
  const housesAt: [number, number, number, string][] = [
    [-178, -40, 70, 'hullLight'], [-182, 62, 60, 'siding2'],
    [178, -30, 64, 'siding2'], [182, 70, 56, 'hullLight'],
    [-40, 182, 80, 'siding2'], [72, 178, 60, 'hullLight'],
  ];
  for (const [x, z, w, col] of housesAt) {
    // local -z (windows) faces the yard
    const yaw = Math.abs(x) > Math.abs(z) ? (x > 0 ? Math.PI / 2 : -Math.PI / 2) : (z > 0 ? 0 : Math.PI);
    const h = kit.frame(x, 0, z, yaw);
    h.box(0, 13, 0, w, 26, 34, col, { bev: 0.5 });
    h.box(0, 27, 0, w + 4, 1.2, 36, 'trim', { bev: 0.3 });
    h.box(0, 34.5, -9, w + 5, 1.4, 21, 'roof', { pitch: -0.62, bev: 0.3 });
    h.box(0, 34.5, 9, w + 5, 1.4, 21, 'roof', { pitch: 0.62, bev: 0.3 });
    for (let i = 0; i < 4; i++) h.box(-w / 2 + w * (i + 0.5) / 4, 16, -17.2, 6, 7, 0.6, 'glass', { g: 'noink', bev: 0.1 });
  }
  const trees: [number, number][] = [[-150, -95], [-140, 10], [-150, 120], [140, -110], [150, 20], [145, 120], [-100, 150], [20, 150], [110, 160], [-60, -150], [60, -150]];
  for (let i = 0; i < 22; i++) {
    const a = (i / 22) * TAU + 0.13, d = 215 + (i % 3) * 30;
    trees.push([Math.cos(a) * d, Math.sin(a) * d]);
  }
  // second ring of rooftops far out (silhouettes in the haze)
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * TAU + 0.4, d = 300 + (i % 2) * 40;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    const h2 = kit.frame(x, 0, z, Math.atan2(x, z));
    h2.box(0, 12, 0, 52, 24, 30, i % 2 ? 'hullLight' : 'siding2', { bev: 0.4 });
    h2.box(0, 30.5, -8, 56, 1.4, 19, 'roof', { pitch: -0.62, bev: 0.3 });
    h2.box(0, 30.5, 8, 56, 1.4, 19, 'roof', { pitch: 0.62, bev: 0.3 });
  }
  for (const [x, z] of trees) {
    const t2 = kit.frame(x + rng.range(-8, 8), 0, z + rng.range(-8, 8), 0);
    const s = rng.range(0.8, 1.3);
    t2.cyl(0, 9 * s, 0, 1.6 * s, 18 * s, 2.4 * s, 'bark', { seg: 8 });
    for (let k = 0; k < 4; k++) {
      const a = k * 1.9, r = rng.range(7, 10) * s;
      t2.sphere(Math.cos(a) * 5 * s, (22 + (k % 2) * 6) * s, Math.sin(a) * 5 * s, r, r * 0.85, r, k % 2 ? 'leafDark' : 'leaf', { g: 'soft', seg: 9 });
    }
  }
  void hash2;
}
