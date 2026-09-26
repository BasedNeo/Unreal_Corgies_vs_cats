// Builds static colliders for the world. OWNER: world lane (L2).
// Used by the authority AND by client-side prediction, so it depends only on (Rapier, World, WorldData).
//  - Terrain: the baked grid's exact triangles (every cell split on the b–c diagonal, the same
//    triangles gridHeight() interpolates and the client renders), as a Rapier TRIMESH by default.
//    tools/world-physics-bench.mjs measured on the West Yard (Rapier 0.21): a heightfield of the same
//    grid misses 24.5 % of straight-down rays on a 0.5 m lattice (edge-aligned rays slip through) and
//    costs ~3x more character-controller time (8 runners: 2.4 ms/tick vs 0.77 ms); the trimesh
//    misses 0 % on the lattice (0.005 % random) with identical geometry. Set TERRAIN_COLLIDER to
//    'heightfield' to compare.
//  - Props: oriented cuboids (yaw/pitch/roll, 'YXZ') and upright cylinders.
//  - Worlds without a baked grid (flat test worlds) get a flat ground slab.
import type { Collider, World } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { Rapier } from '../rapier';
import { WORLD_GROUPS } from '../rapier';
import type { WorldData, TerrainGrid } from '../../shared/world/world-data';
import { quatYXZ } from '../../shared/world/queries';

export const TERRAIN_COLLIDER: 'trimesh' | 'heightfield' = 'trimesh';

/** Column-major height matrix for a Rapier heightfield (rows along z, columns along x). */
export function heightfieldMatrix(g: TerrainGrid): Float32Array {
  const n = g.n, out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[i * n + j] = g.heights[j * n + i];
  return out;
}

const meshCache = new WeakMap<TerrainGrid, { vertices: Float32Array; indices: Uint32Array }>();
/** World-space vertices + indices of the grid triangles (a,c,b)(b,c,d) — identical to the render mesh. */
export function terrainTriangles(g: TerrainGrid): { vertices: Float32Array; indices: Uint32Array } {
  let m = meshCache.get(g);
  if (m) return m;
  const n = g.n, res = n - 1;
  const vertices = new Float32Array(n * n * 3), indices = new Uint32Array(res * res * 6);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const k = j * n + i;
    vertices[k * 3] = g.x0 + i * g.cell; vertices[k * 3 + 1] = g.heights[k]; vertices[k * 3 + 2] = g.z0 + j * g.cell;
  }
  let o = 0;
  for (let j = 0; j < res; j++) for (let i = 0; i < res; i++) {
    const a = j * n + i, b = a + 1, c = a + n, d = c + 1;
    indices[o++] = a; indices[o++] = c; indices[o++] = b;
    indices[o++] = b; indices[o++] = c; indices[o++] = d;
  }
  m = { vertices, indices };
  meshCache.set(g, m);
  return m;
}

/** True for the terrain collider built by buildStaticWorld (trimesh or heightfield). Use this instead
 *  of testing the shape type (nav grids, projectile backstops). */
export function isTerrainCollider(c: Collider): boolean {
  return (c as unknown as { __terrain?: boolean }).__terrain === true;
}

export function buildStaticWorld(R: Rapier, world: World, data: WorldData): void {
  const g = data.terrain;
  let terrain: Collider | null = null;
  if (g && TERRAIN_COLLIDER === 'trimesh') {
    const { vertices, indices } = terrainTriangles(g);
    const flags = (R as unknown as { TriMeshFlags?: { FIX_INTERNAL_EDGES: number } }).TriMeshFlags?.FIX_INTERNAL_EDGES;
    terrain = world.createCollider(R.ColliderDesc.trimesh(vertices, indices, flags as never).setCollisionGroups(WORLD_GROUPS));
  } else if (g) {
    const res = g.n - 1, size = res * g.cell;
    terrain = world.createCollider(R.ColliderDesc.heightfield(res, res, heightfieldMatrix(g), { x: size, y: 1, z: size })
      .setTranslation(g.x0 + size / 2, 0, g.z0 + size / 2)
      .setCollisionGroups(WORLD_GROUPS));
  }
  if (terrain) (terrain as unknown as { __terrain: boolean }).__terrain = true;
  else {
    const h = data.halfExtent;
    world.createCollider(R.ColliderDesc.cuboid(h, 0.5, h).setTranslation(0, -0.5, 0).setCollisionGroups(WORLD_GROUPS));
  }
  for (const p of data.props) {
    const q = quatYXZ(p.pitch ?? 0, p.rotY, p.roll ?? 0);
    world.createCollider(R.ColliderDesc.cuboid(p.hx, p.hy, p.hz).setTranslation(p.x, p.y, p.z).setRotation(q).setCollisionGroups(WORLD_GROUPS));
  }
  for (const c of data.cylinders ?? []) {
    world.createCollider(R.ColliderDesc.cylinder(c.hh, c.r).setTranslation(c.x, c.y, c.z).setCollisionGroups(WORLD_GROUPS));
  }
}

export function buildSimWorld(sim: Sim): void {
  buildStaticWorld(sim.R, sim.world, sim.worldData);
}
