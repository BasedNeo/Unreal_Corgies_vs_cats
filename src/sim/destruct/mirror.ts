// X1: client prediction mirror for destructibles (the pattern of C2's mirrorBarriers). The predictor's private Sim
// has no systems, so it has no destructible colliders of its own: this adds the authority's exact boxes for every
// destructible a snapshot shows standing and removes them once it shows it broken (or gone), so the local player's
// predicted movement stops at a standing wall and walks through the hole the moment the break arrives.
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Sim } from '../sim';
import type { EntityState } from '../../shared/protocol';
import { EFlag, EntityKind } from '../../shared/types';
import { createBoxCollider } from './state';

const seen = new Set<number>();

/**
 * Mirror the destructibles of a snapshot into a prediction Sim (keyed by entity id in `cache`). Steps the prediction
 * world when something changed (its broad phase must see new colliders). Returns true when colliders changed.
 */
export function mirrorDestructibles(sim: Sim, states: Iterable<EntityState>, cache: Map<number, Collider[]>): boolean {
  const defs = sim.worldData.destructibles;
  let changed = false;
  seen.clear();
  if (defs?.length) {
    for (const s of states) {
      if (s.kind !== EntityKind.Destructible) continue;
      const def = defs[s.seed];
      if (!def) continue;
      seen.add(s.id);
      const standing = (s.flags & EFlag.Busy) === 0;
      const have = cache.get(s.id);
      if (standing && !have) {
        const cs: Collider[] = [];
        for (const b of def.boxes) cs.push(createBoxCollider(sim, b, s.id));
        cache.set(s.id, cs);
        changed = true;
      } else if (!standing && have) {
        for (const c of have) sim.world.removeCollider(c, false);
        cache.delete(s.id);
        changed = true;
      }
    }
  }
  for (const [id, cs] of cache) {
    if (seen.has(id)) continue;
    for (const c of cs) sim.world.removeCollider(c, false);
    cache.delete(id);
    changed = true;
  }
  if (changed) sim.world.step();
  return changed;
}
