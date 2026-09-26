// Contract between entity views and the character system (src/client/procgen/characters).
import type * as THREE from 'three/webgpu';
import type { AnimId, ClassId, SpeciesId, TeamId } from '../../shared/types';

export interface AvatarOptions {
  species: SpeciesId;
  cls: ClassId;
  team: TeamId;
  seed: number;
  isLocal: boolean;
}

/** Everything an avatar needs each render frame to animate itself. */
export interface AvatarFrame {
  /** Horizontal speed m/s. */
  speed: number;
  /** Vertical velocity m/s. */
  vy: number;
  grounded: boolean;
  anim: AnimId;
  flags: number;
  /** View pitch (radians) for upper-body aim. */
  aimPitch: number;
  /** Aim yaw relative to body yaw (radians), for upper-body twist. */
  aimYawOffset: number;
  hpFrac: number;
  dead: boolean;
  firing: boolean;
  aiming: boolean;
  sprinting: boolean;
}

export interface Avatar {
  root: THREE.Object3D;
  /** Height of the head top in meters (for nameplates / camera). */
  height: number;
  update(frame: AvatarFrame, dt: number): void;
  /** One-shot reactions: 'hit', 'jump', 'land', 'fire', 'death', 'spawn', 'emote'. */
  trigger(action: string, strength?: number): void;
  /** World position of the weapon muzzle (for tracers/muzzle flash). */
  muzzleWorld(target: THREE.Vector3): THREE.Vector3;
  dispose(): void;
}
