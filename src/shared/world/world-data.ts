// World description shared by the authority (colliders) and the client (visuals).
// OWNER: world lane (L2). createWorldData(seed, map) builds a registered map (maps.ts; the West Yard hub by default).
// Contract types live in world-types.ts and are re-exported here so existing imports keep working.
import type { PropBox, SpawnPoint, WorldData } from './world-types';
import { MAPS, sanitizeMap } from './maps';

export type {
  PropBox, PropCylinder, SpawnPoint, WorldData, JumpPad, WaterZone, Bookmark, VisualPrim, PrimShape, PrimGroup,
  TerrainGrid, SurfaceSample, ScatterZone, FenceRun, ConcealZone, Sprinkler, District, Lamp, Perch, Destructible, DestructKind,
} from './world-types';

/** Cache: a map is a pure function of (map, seed), and building one (terrain bake + catalog) costs
 *  ~100 ms, so repeated calls with the same pair (sim + prediction + view) share one instance.
 *  WorldData is treated as immutable by every consumer. */
const cache = new Map<string, WorldData>();

/** Build (or reuse) a registered map. An unknown map id is the default map (the West Yard). */
export function createWorldData(seed = 1, map?: string): WorldData {
  const id = sanitizeMap(map);
  const key = `${id}:${seed}`;
  let w = cache.get(key);
  if (!w) {
    w = MAPS[id].build(seed);
    w.map = id;
    if (cache.size > 4) cache.clear();
    cache.set(key, w);
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
