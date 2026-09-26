// Builds static colliders for the world. OWNER: world lane (replace the ground with a heightfield
// built from WorldData.height, keeping these signatures). Used by the authority AND by client-side
// prediction, so it must depend only on (Rapier, World, WorldData).
import type { World } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { Rapier } from '../rapier';
import { WORLD_GROUPS } from '../rapier';
import type { WorldData } from '../../shared/world/world-data';

export function buildStaticWorld(R: Rapier, world: World, data: WorldData): void {
  const h = data.halfExtent;
  world.createCollider(R.ColliderDesc.cuboid(h, 0.5, h).setTranslation(0, -0.5, 0).setCollisionGroups(WORLD_GROUPS));
  for (const p of data.props) {
    const q = { x: 0, y: Math.sin(p.rotY / 2), z: 0, w: Math.cos(p.rotY / 2) };
    world.createCollider(R.ColliderDesc.cuboid(p.hx, p.hy, p.hz).setTranslation(p.x, p.y, p.z).setRotation(q).setCollisionGroups(WORLD_GROUPS));
  }
}

export function buildSimWorld(sim: Sim): void {
  buildStaticWorld(sim.R, sim.world, sim.worldData);
}
