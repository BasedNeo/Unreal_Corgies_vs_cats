// The Lot — the second battleground (Wave 8 M2, docs/design/EXPANSION_VISION.md): the construction lot next to the
// neighbours' house, at pet scale (characters ~1.2 m, real size x 4), 320 x 320 m inside the fences. The corgis hold
// the foundation pit and its trenches (north-west), the cats the spoil heap and its scaffold (south-east); three
// lanes join them: Container Canyon (west), the open mud middle, the Pipeworks (east), all crossing the drainage
// ditch on dry causeways. Layout numbers: lot/layout.ts; terrain: lot/terrain.ts; props: lot/props.ts, lot/pipes.ts;
// fences and skyline: lot/scenery.ts. Deterministic from the seed (the seed moves the mud and the clutter jitter,
// never the layout). No three, no DOM, no Math.random.
import type { Bookmark, District, Lamp, SpawnPoint, WaterZone, WorldData } from './world-types';
import { Kit } from './kit';
import { bakeTerrainGrid, gridHeight, inGrid } from './terrain';
import { createRng } from './noise';
import { yawToward } from './queries';
import {
  CAT_SPAWN_XS, CAT_SPAWN_ZS, CONTAINER, CONTAINERS, CORGI_SPAWN_XS, CORGI_SPAWN_ZS, CRANE, DITCH, DITCH_SEGMENTS,
  FLOOD_TOWERS, GRID_HALF, LOT_BOUNDS, LOT_HALF, LOT_NAME, LOT_TIME_OF_DAY, PALLET_STAIR, PIPE, PIT, TOILET, TUNNELS,
} from './lot/layout';
import { createLotField } from './lot/terrain';
import { addPipe, type PipePlaced } from './lot/pipes';
import {
  ammoCrate, bagWall, bannerPole, cableDrum, container, floodTower, footing, gangway, groundMin, palletStack,
  portableToilet, rebarBundle, scaffold, skip, slab, trafficBarrel, trafficCone,
} from './lot/props';
import { perimeter, skyline, towerCrane } from './lot/scenery';

export { LOT_NAME } from './lot/layout';

/** Pipes placed by the last build of each world (tests: collider == visual on the lathe facets). */
export const LOT_PIPES = new WeakMap<WorldData, PipePlaced[]>();

export function buildTheLot(seed = 1): WorldData {
  const rng = createRng(`thelot:${seed}`);
  const field = createLotField(seed);
  const terrain = bakeTerrainGrid(field.raw, -GRID_HALF, -GRID_HALF, 1, GRID_HALF * 2 + 1);
  const height = (x: number, z: number) => (inGrid(terrain, x, z) ? gridHeight(terrain, x, z) : field.raw(x, z));
  const kit = new Kit();
  const lamps: Lamp[] = [];
  const pipes: PipePlaced[] = [];
  const jit = (a: number) => rng.range(-a, a);
  /** A concrete wedge from the ground up to a pipe's floor facet at one mouth (end -1 / +1 along the axis). */
  const pipeWedge = (p: PipePlaced, end: -1 | 1) => {
    const ax = Math.cos(p.yaw), az = -Math.sin(p.yaw);
    const mx = p.x + ax * end * PIPE.len / 2, mz = p.z + az * end * PIPE.len / 2;
    const fx = mx + ax * end * 1.4, fz = mz + az * end * 1.4;
    slab(kit, 'pipe_wedge', [mx, p.floorY, mz], [fx, height(fx, fz) - 0.03, fz], 1.6, 0.35, 'concrete');
  };

  // ------------------------------------------------------------------ edges + skyline
  const fences = perimeter(kit);
  skyline(kit, rng);
  const crane = towerCrane(kit, [-10, 60]);
  portableToilet(kit, height, TOILET.x, TOILET.z, TOILET.yaw);

  // ------------------------------------------------------------------ The Foundation (corgi base)
  const pitY = PIT.floor;
  bannerPole(kit.frame(-36, pitY, -112, 0.35), 0);
  for (const [x, z, yaw] of [[-49, -122, 0.1], [-46.3, -121.6, -0.25], [-44, -99, 0.4], [-41.4, -98.4, 1.3]] as const) ammoCrate(kit, height, x, z, yaw + jit(0.08), 0);
  for (const x of [-28, -16]) for (const z of [-120, -110, -100]) footing(kit, height, x, z, jit(0.05));
  // cement-bag line on the pit's south rim (gaps: the foot ramp, the trench mouths), and at the ramp top
  bagWall(kit, height, -79, -92.2, -68, -92.2);
  bagWall(kit, height, -47, -92.2, -25, -92.2);
  bagWall(kit, height, -17, -92.2, -4, -92.2);
  bagWall(kit, height, 2.5, -101.4, 12.5, -101.4);
  bagWall(kit, height, -14.5, -41.4, -9.8, -41.4);            // T2's exit: cover either side
  bagWall(kit, height, -6.2, -41.4, -1.5, -41.4);
  bagWall(kit, height, -91, -51.5, -89.6, -47.2);              // T1's exit, the canyon's north mouth
  bagWall(kit, height, -82.4, -47.2, -81, -51.5);

  // ------------------------------------------------------------------ Container Canyon (west lane)
  for (const c of CONTAINERS) {
    const y0 = groundMin(height, c.x, c.z, CONTAINER.W / 2, CONTAINER.L / 2);
    container(kit, c.x, y0, c.z, c.col, c.stripe, c.door, lamps);
  }
  gangway(kit, CONTAINER.H);
  palletStack(kit, height, -97.3, -36.5, 0.05, 2);            // cover inside the containers (against the far walls)
  cableDrum(kit, height, -77, -27, 'hazardOchre', 1.8, 2.4);

  // ------------------------------------------------------------------ The Pipeworks (east lane)
  for (const t of TUNNELS) {
    for (let k = 0; k < 3; k++) {
      const zc = t.z0 + PIPE.len / 2 + k * (PIPE.len + PIPE.gap);
      pipes.push(addPipe(kit, PIPE, t.x, groundMin(height, t.x, zc, 2.2, PIPE.len / 2) - PIPE.sink, zc, -Math.PI / 2, 'concrete'));
      // a mud streak along the tunnel floor (decal on the floor facet)
      const p = pipes[pipes.length - 1];
      kit.prims.push({ s: 'box', x: t.x, y: p.floorY + 0.012, z: zc, a: 1.1, b: 0.024, c: PIPE.len - 0.6, col: 'mud', g: 'noink', bev: 0 });
    }
  }
  // concrete invert slabs bridging the gaps between segments (a level floor all the way through; the gaps stay
  // open to the sides as firing windows), and a wedge up to the floor at every tunnel mouth
  for (const t of TUNNELS) {
    const segs = pipes.filter((p) => p.x === t.x && p.yaw === -Math.PI / 2);
    for (let k = 0; k + 1 < segs.length; k++) {
      const z0 = segs[k].z + PIPE.len / 2, z1 = segs[k + 1].z - PIPE.len / 2, top = Math.min(segs[k].floorY, segs[k + 1].floorY);
      const gy = groundMin(height, t.x, (z0 + z1) / 2, 1.5, (z1 - z0) / 2) - 0.1;
      kit.frame(t.x, 0, (z0 + z1) / 2, 0).solid('pipe_invert', 0, (top + gy) / 2, 0, 3.0, top - gy, z1 - z0 + 0.02, 'concrete', { bev: 0.05 });
    }
    pipeWedge(segs[0], -1);
    pipeWedge(segs[segs.length - 1], 1);
  }
  PALLET_STAIR.xs.forEach(([x0, x1], i) => palletStack(kit, height, (x0 + x1) / 2, (PALLET_STAIR.z0 + PALLET_STAIR.z1) / 2, 0, 2 * (i + 1), x1 - x0, PALLET_STAIR.z1 - PALLET_STAIR.z0));
  // two loose pipes in the middle: walk-through cover (axes along x at cell centres)
  for (const [x, z] of [[-44, -29.5], [44, 29.5]] as const) {
    const p = addPipe(kit, PIPE, x, groundMin(height, x, z, PIPE.len / 2, 2.2) - PIPE.sink, z, 0, 'concrete');
    pipes.push(p);
    pipeWedge(p, -1);
    pipeWedge(p, 1);
  }

  // ------------------------------------------------------------------ The Mud (middle): cover, point-symmetric pairs
  for (const s of [-1, 1] as const) {
    cableDrum(kit, height, s * 20, s * 28, 'danger');
    cableDrum(kit, height, s * 36, s * -8.5, 'catBlack');
    palletStack(kit, height, s * 10, s * 18, 0.3 + jit(0.1), 2);
    palletStack(kit, height, s * 54, s * 16, 0.8 + jit(0.1), 2);
    palletStack(kit, height, s * 40, s * 52, -0.4 + jit(0.1), 4);
    palletStack(kit, height, s * 24, s * -36, 1.1 + jit(0.1), 2);
    rebarBundle(kit, height, s * 24, s * -12, 1.25 + jit(0.05));
    skip(kit, height, s * 48, s * -50, 0.4 + jit(0.05));
    for (const [x, z] of [[17, 9], [18.6, 7.1], [64, 9], [110, 9]] as const) trafficBarrel(kit, height, s * x + jit(0.3), s * z + jit(0.3));
    for (const [x, z] of [[-4, 12], [-6, 13.6], [70, 10], [85.5, 8.6]] as const) trafficCone(kit, height, s * x + jit(0.25), s * z + jit(0.25), rng.range(0, Math.PI));
  }

  // ------------------------------------------------------------------ The Scaffolds (cat base)
  const scaf = scaffold(kit);
  for (const [x, z, yaw, n] of [[7, 108, 0.2, 2], [22, 115, -0.3, 1], [30, 105.5, 0.1, 2], [4, 120, 0.6, 4]] as const) palletStack(kit, height, x, z, yaw + jit(0.06), n);
  for (const [x, z, yaw] of [[50, 122, -0.1], [50.2, 119.2, 0.2], [48.6, 106.4, 0.9]] as const) ammoCrate(kit, height, x, z, yaw + jit(0.08), 1);

  // ------------------------------------------------------------------ floodlight towers (lamps: sodium heads)
  for (const t of FLOOD_TOWERS) floodTower(kit, height, t.x, t.z, t.aim, lamps);

  // ------------------------------------------------------------------ water: the ditch between the causeways
  const water: WaterZone[] = DITCH_SEGMENTS.map(([x0, x1], i) => {
    const toSurface = (DITCH.surface - DITCH.floor) / (-DITCH.floor / DITCH.bank);     // bank run from floor to waterline
    return {
      id: `ditch_${i}`, shape: 'rect', x: (x0 + x1) / 2, z: DITCH.z,
      hx: (x1 - x0) / 2 - DITCH.bank + toSurface, hz: DITCH.floorHz + toSurface,
      surfaceY: DITCH.surface, bottomY: DITCH.floor, drag: 0.62,
    };
  });

  // ------------------------------------------------------------------ spawns (16 per team, 6 m apart)
  const spawns: SpawnPoint[] = [];
  for (const x of CORGI_SPAWN_XS) for (const z of CORGI_SPAWN_ZS) spawns.push({ x, y: height(x, z) + 0.05, z, yaw: yawToward(x, z, -20, 0), team: 0 });
  for (const x of CAT_SPAWN_XS) for (const z of CAT_SPAWN_ZS) spawns.push({ x, y: height(x, z) + 0.05, z, yaw: yawToward(x, z, 20, 0), team: 1 });

  // ------------------------------------------------------------------ districts + bookmarks
  const districts: District[] = [
    { id: 'lot_foundation', name: 'The Foundation', minX: -92, maxX: 16, minZ: -134, maxZ: -86 },
    { id: 'lot_trenches', name: 'The Trenches', minX: -92, maxX: 2, minZ: -86, maxZ: -50 },
    { id: 'lot_canyon', name: 'Container Canyon', minX: -108, maxX: -60, minZ: -50, maxZ: -14 },
    { id: 'lot_pipeworks', name: 'The Pipeworks', minX: 58, maxX: 108, minZ: 6, maxZ: 50 },
    { id: 'lot_scaffolds', name: 'The Scaffolds', minX: -16, maxX: 92, minZ: 82, maxZ: 134 },
    { id: 'lot_ditch', name: 'The Ditch', minX: -152, maxX: 152, minZ: -5, maxZ: 5 },
    { id: 'lot_mud', name: 'The Mud', minX: -60, maxX: 60, minZ: -60, maxZ: 60 },
  ];
  /** A point by the jib: d m out along it, dy over the mast top, side m to its right (off the lattice). */
  const jib = (d: number, dy: number, side = 0): [number, number, number] =>
    [CRANE.x + crane.dir[0] * d - crane.dir[1] * side, crane.top + dy, CRANE.z + crane.dir[1] * d + crane.dir[0] * side];
  const bookmarks: Bookmark[] = [
    { name: 'lot_corgi_base', pos: [13, 1.9, -104.5], look: [-50, -2.2, -113], fov: 64 },
    { name: 'lot_container_canyon', pos: [-85, 2.4, -58], look: [-78, 9, 60], fov: 64 },
    { name: 'lot_pipe_mouth', pos: [79.5, 1.75, 19.2], look: [73.5, 1.4, -20], fov: 66 },
    { name: 'lot_cat_scaffold', pos: [48.4, scaf.nestY + 3.3, 101.6], look: [16, 1.5, 34], fov: 64 },
    { name: 'lot_overview', pos: jib(62, 18, 24), look: [-26, -2, -46], fov: 62 },
    // extra views for the iteration loop
    { name: 'lot_mud', pos: [-3, 2.4, -34], look: [6, 1.6, 30], fov: 62 },
    { name: 'lot_trenches', pos: [-40, 0.2, -80], look: [-10, -0.4, -80], fov: 66 },
    { name: 'lot_heap_front', pos: [30, 2.4, 64], look: [38, 8, 100], fov: 62 },
    { name: 'lot_ditch', pos: [-44, 1.4, -9], look: [8, -0.6, 2], fov: 62 },
    { name: 'lot_hook', pos: [crane.hook[0] + 16, crane.hook[1] + 4, crane.hook[2] + 22], look: [crane.hook[0], crane.hook[1], crane.hook[2]], fov: 55 },
  ];

  const data: WorldData = {
    seed,
    name: LOT_NAME,
    height,
    halfExtent: LOT_HALF,
    props: kit.props,
    spawns,
    killY: -20,
    cylinders: kit.cylinders,
    jumpPads: [],
    water,
    bookmarks,
    prims: kit.prims,
    fences,
    terrain,
    surface: field.surface,
    scatterZones: [],
    bounds: { minX: -LOT_BOUNDS, maxX: LOT_BOUNDS, minZ: -LOT_BOUNDS, maxZ: LOT_BOUNDS },
    timeOfDay: LOT_TIME_OF_DAY,
    bedLevel: -3, // the pit, trenches and ditch floors are dry mud (the ditch water covers its own bed)
    districts,
    lamps,
    perches: [
      { id: 'lot_container_roof', name: 'Container roof', x: -71.4, y: CONTAINER.H, z: -30, yaw: Math.PI * 0.9, district: 'lot_canyon' },
      { id: 'lot_scaffold_deck', name: 'Scaffold deck', x: 26, y: scaf.deckY, z: 97.6, yaw: 0.12, district: 'lot_scaffolds' },
      { id: 'lot_scaffold_nest', name: "Scaffold crow's nest", x: 46, y: scaf.nestY, z: 97.8, yaw: -0.2, district: 'lot_scaffolds' },
      { id: 'lot_pipe_crown', name: 'Pipe crown', x: 79.5, y: pipes[1].crownY, z: 29, yaw: 0.35, district: 'lot_pipeworks' },
    ],
  };
  LOT_PIPES.set(data, pipes);
  return data;
}

/** S4 hook: the floodlight towers of a built Lot as { pos (lamp bar centre), target (aim ground point) }. */
export function lotFloodlights(data: WorldData): { id: string; pos: [number, number, number]; target: [number, number, number]; team: 0 | 1 }[] {
  const heads = (data.lamps ?? []).filter((l) => l.col === 'sodium');
  return FLOOD_TOWERS.map((t) => {
    const mine = heads.filter((l) => Math.hypot(l.x - t.x, l.z - t.z) < 6);
    const n = Math.max(1, mine.length);
    const pos: [number, number, number] = [mine.reduce((a, l) => a + l.x, 0) / n, mine.reduce((a, l) => a + l.y, 0) / n, mine.reduce((a, l) => a + l.z, 0) / n];
    return { id: t.id, pos, target: [t.aim[0], data.height(t.aim[0], t.aim[1]), t.aim[1]], team: t.team };
  });
}
