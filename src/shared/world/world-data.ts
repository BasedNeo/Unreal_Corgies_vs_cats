// World description shared by the authority (colliders) and the client (visuals).
// OWNER: world lane. This walking-skeleton version is a flat yard with a few crates.
import type { TeamId, Vec3 } from '../types';

export interface PropBox {
  /** Content type used by the client to pick a visual (fence, crate, wall...). */
  type: string;
  x: number; y: number; z: number;
  /** Half extents in meters. */
  hx: number; hy: number; hz: number;
  rotY: number;
  color?: number;
}

export interface SpawnPoint extends Vec3 { yaw: number; team: TeamId }

export interface WorldData {
  seed: number;
  name: string;
  /** Terrain height at world XZ (meters). Must be deterministic and identical on every machine. */
  height(x: number, z: number): number;
  /** Half-size of the playable square, centered on the origin. */
  halfExtent: number;
  props: PropBox[];
  spawns: SpawnPoint[];
  /** Kill plane: anything below this Y respawns. */
  killY: number;
}

export function createWorldData(seed = 1): WorldData {
  const props: PropBox[] = [];
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    props.push({ type: 'crate', x: Math.cos(a) * 12, y: 1, z: Math.sin(a) * 12, hx: 1, hy: 1, hz: 1, rotY: a });
  }
  const spawns: SpawnPoint[] = [
    { x: 0, y: 1, z: 6, yaw: 0, team: 0 }, { x: 3, y: 1, z: 6, yaw: 0, team: 0 }, { x: -3, y: 1, z: 6, yaw: 0, team: 0 },
    { x: 0, y: 1, z: -20, yaw: Math.PI, team: 1 }, { x: 4, y: 1, z: -20, yaw: Math.PI, team: 1 }, { x: -4, y: 1, z: -20, yaw: Math.PI, team: 1 },
  ];
  return { seed, name: 'West Yard (skeleton)', height: () => 0, halfExtent: 60, props, spawns, killY: -30 };
}
