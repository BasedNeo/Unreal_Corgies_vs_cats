// OWNER: world lane. World-driven sim systems: jump pads, water, hazards, pickups placed by the map
// (order 250 = after movement, before the physics step).
import type { SimSystem } from '../sim';

export function worldSystems(): SimSystem[] {
  return [];
}
