// X1: marks the colliders the destruct system owns, so code that builds static data from "every World collider"
// (the nav grid) can tell them from the static world. No imports: safe to use from nav.ts without a cycle.
import type { Collider } from '@dimforge/rapier3d-compat';

/** Tag a destructible's collider with its entity id. */
export function markDestructibleCollider(c: Collider, entityId: number): void {
  (c as unknown as { __destructible: number }).__destructible = entityId;
}

/** Entity id of the destructible owning this collider, or -1 for anything else. */
export function destructibleOfCollider(c: Collider): number {
  const id = (c as unknown as { __destructible?: number }).__destructible;
  return id === undefined ? -1 : id;
}

export function isDestructibleCollider(c: Collider): boolean {
  return (c as unknown as { __destructible?: number }).__destructible !== undefined;
}
