// World description shared by the authority (colliders) and the client (visuals).
// OWNER: world lane (L2). createWorldData(seed) builds the West Yard hub (see west-yard.ts).
// Contract types live in world-types.ts and are re-exported here so existing imports keep working.
import type { PropBox, SpawnPoint, WorldData } from './world-types';
import { buildWestYard } from './west-yard';

export type {
  PropBox, PropCylinder, SpawnPoint, WorldData, JumpPad, WaterZone, Bookmark, VisualPrim, PrimShape, PrimGroup,
  TerrainGrid, SurfaceSample, ScatterZone, FenceRun, ConcealZone, Sprinkler, District, Lamp, Perch,
} from './world-types';

/** Cache: the yard is a pure function of the seed, and building it (terrain bake + catalog) costs
 *  ~100 ms, so repeated calls with the same seed (sim + prediction + view) share one instance.
 *  WorldData is treated as immutable by every consumer. */
const cache = new Map<number, WorldData>();

export function createWorldData(seed = 1): WorldData {
  let w = cache.get(seed);
  if (!w) {
    w = buildWestYard(seed);
    if (cache.size > 4) cache.clear();
    cache.set(seed, w);
  }
  return w;
}

/**
 * The Wave 0 skeleton: flat ground at y = 0 with six crates on a 12 m ring. Kept for unit tests
 * of other systems that need a trivial, predictable world, e.g. `Sim.create({ world: createFlatWorldData() })`.
 */
export function createFlatWorldData(seed = 1): WorldData {
  const props: PropBox[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    props.push({ type: 'crate', x: Math.cos(a) * 12, y: 1, z: Math.sin(a) * 12, hx: 1, hy: 1, hz: 1, rotY: a });
  }
  const spawns: SpawnPoint[] = [
    { x: 0, y: 1, z: 6, yaw: 0, team: 0 }, { x: 3, y: 1, z: 6, yaw: 0, team: 0 }, { x: -3, y: 1, z: 6, yaw: 0, team: 0 },
    { x: 0, y: 1, z: -20, yaw: Math.PI, team: 1 }, { x: 4, y: 1, z: -20, yaw: Math.PI, team: 1 }, { x: -4, y: 1, z: -20, yaw: Math.PI, team: 1 },
  ];
  return { seed, name: 'Flat test yard', height: () => 0, halfExtent: 60, props, spawns, killY: -30 };
}
