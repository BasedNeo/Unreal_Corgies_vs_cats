// Builds static colliders for the world. OWNER: world lane (L2).
// Used by the authority AND by client-side prediction, so it depends only on (Rapier, World, WorldData).
//  - Terrain: one Rapier heightfield over WorldData.terrain. Rapier splits every cell on the same
//    diagonal as gridHeight()/the rendered mesh, so collider == height() == visual triangles.
//  - Props: oriented cuboids (yaw/pitch/roll, 'YXZ') and upright cylinders.
//  - Worlds without a baked grid (flat test worlds) get a flat ground slab.
import type { World } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { Rapier } from '../rapier';
import { WORLD_GROUPS } from '../rapier';
import type { WorldData, TerrainGrid } from '../../shared/world/world-data';
import { quatYXZ } from '../../shared/world/queries';

/** Column-major height matrix for Rapier (rows along z, columns along x). */
export function heightfieldMatrix(g: TerrainGrid): Float32Array {
  const n = g.n, out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) out[i * n + j] = g.heights[j * n + i];
  return out;
}

export function buildStaticWorld(R: Rapier, world: World, data: WorldData): void {
  const g = data.terrain;
  if (g) {
    const res = g.n - 1, size = res * g.cell;
    const flags = (R as unknown as { HeightFieldFlags?: { FIX_INTERNAL_EDGES: number } }).HeightFieldFlags?.FIX_INTERNAL_EDGES;
    const desc = R.ColliderDesc.heightfield(res, res, heightfieldMatrix(g), { x: size, y: 1, z: size }, flags as never)
      .setTranslation(g.x0 + size / 2, 0, g.z0 + size / 2)
      .setCollisionGroups(WORLD_GROUPS);
    world.createCollider(desc);
  } else {
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
