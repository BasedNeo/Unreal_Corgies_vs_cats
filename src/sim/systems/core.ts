// Small core systems: physics broadphase update and kill plane.
import type { SimSystem } from '../sim';

/** Steps Rapier so query structures reflect moved colliders before weapons run. */
export const physicsStepSystem: SimSystem = {
  name: 'physics-step',
  order: 300,
  update(sim) {
    sim.world.step();
  },
};

/** Anything that falls out of the world is returned to a spawn point. */
export const killPlaneSystem: SimSystem = {
  name: 'kill-plane',
  order: 650,
  update(sim) {
    for (const e of sim.entities.values()) {
      if (!e.char || e.pos.y > sim.worldData.killY) continue;
      const s = sim.pickSpawn(e.team);
      sim.placeCharacter(e, s.x, s.y, s.z);
    }
  },
};
