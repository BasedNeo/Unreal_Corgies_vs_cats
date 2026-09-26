// Single Rapier initialization shared by the authority (worker/Node) and client-side prediction.
import RAPIER from '@dimforge/rapier3d-compat';

export type Rapier = typeof RAPIER;
let ready: Promise<Rapier> | null = null;

export function loadRapier(): Promise<Rapier> {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

/** Collision layers (Rapier interaction groups: upper 16 bits = membership, lower 16 = filter). */
export const Layer = {
  World: 0x0001,
  Character: 0x0002,
  Projectile: 0x0004,
  Trigger: 0x0008,
  Vehicle: 0x0010,
  Pickup: 0x0020,
} as const;

export function groups(membership: number, filter: number): number {
  return ((membership & 0xffff) << 16) | (filter & 0xffff);
}

/** What a character's movement collides with. */
export const CHARACTER_MOVE_FILTER = groups(Layer.Character, Layer.World | Layer.Vehicle);
/** Membership of a character collider (hit by projectiles/raycasts, not by other characters). */
export const CHARACTER_GROUPS = groups(Layer.Character, Layer.World | Layer.Projectile | Layer.Vehicle);
export const WORLD_GROUPS = groups(Layer.World, 0xffff);
/** Hitscan ray: hits world and characters. */
export const HITSCAN_FILTER = groups(Layer.Projectile, Layer.World | Layer.Character | Layer.Vehicle);
