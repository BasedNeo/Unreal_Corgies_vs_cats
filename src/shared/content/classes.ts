// Class kits (data). Theme content lives under src/shared/content so the engine stays theme-agnostic.
import type { ClassId, SpeciesId } from '../types';

export interface MoveStats {
  walkSpeed: number;
  runSpeed: number;
  sprintSpeed: number;
  groundAccel: number;
  airAccel: number;
  groundDecel: number;
  jumpVelocity: number;
  /** 0 = no double jump. */
  doubleJumpVelocity: number;
  fallGravityScale: number;
  coyoteTime: number;
  jumpBuffer: number;
  capsuleRadius: number;
  /** Half-height of the capsule's cylinder part. Total height = 2*(halfHeight+radius). */
  capsuleHalfHeight: number;
}

export interface ClassDef {
  id: ClassId;
  displayName: string;
  role: string;
  maxHp: number;
  primary: string;
  ability: string;
  move: Partial<MoveStats>;
}

export const BASE_MOVE: Record<SpeciesId, MoveStats> = {
  0: { // Corgi: low, fast sprinter ("zoomies"), modest jump + double jump
    walkSpeed: 3.6, runSpeed: 6.4, sprintSpeed: 9.6,
    groundAccel: 70, airAccel: 22, groundDecel: 50,
    jumpVelocity: 8.4, doubleJumpVelocity: 7.2, fallGravityScale: 1.55,
    coyoteTime: 0.12, jumpBuffer: 0.12,
    capsuleRadius: 0.36, capsuleHalfHeight: 0.24,
  },
  1: { // Cat: agile, higher jump, slightly slower sprint
    walkSpeed: 3.8, runSpeed: 6.6, sprintSpeed: 8.8,
    groundAccel: 75, airAccel: 26, groundDecel: 55,
    jumpVelocity: 9.4, doubleJumpVelocity: 7.8, fallGravityScale: 1.45,
    coyoteTime: 0.14, jumpBuffer: 0.12,
    capsuleRadius: 0.33, capsuleHalfHeight: 0.3,
  },
};

export const CLASSES: Record<ClassId, ClassDef> = {
  assault: { id: 'assault', displayName: 'Assault', role: 'Frontline run-and-gun', maxHp: 120, primary: 'squeaker_rifle', ability: 'bark_blast', move: {} },
  infiltrator: { id: 'infiltrator', displayName: 'Infiltrator', role: 'Stealth and flanking', maxHp: 90, primary: 'snap_pistol', ability: 'shadow_cloak', move: { sprintSpeed: 10.4 } },
  overwatch: { id: 'overwatch', displayName: 'Overwatch', role: 'Long-range sniper', maxHp: 90, primary: 'laser_longshot', ability: 'spotter_drone', move: {} },
  breacher: { id: 'breacher', displayName: 'Breacher', role: 'Explosives and heavy weapons', maxHp: 160, primary: 'tennis_mortar', ability: 'dig_charge', move: { runSpeed: 5.6, sprintSpeed: 8.2 } },
  warden: { id: 'warden', displayName: 'Warden', role: 'Area control and defense', maxHp: 140, primary: 'sprinkler_cannon', ability: 'squeak_barrier', move: {} },
  skyraider: { id: 'skyraider', displayName: 'Skyraider', role: 'Aerial mobility and vehicles', maxHp: 100, primary: 'frisbee_launcher', ability: 'ear_glide', move: { doubleJumpVelocity: 8.6 } },
};

export function moveStatsFor(species: SpeciesId, cls: ClassId): MoveStats {
  return { ...BASE_MOVE[species], ...CLASSES[cls].move };
}
