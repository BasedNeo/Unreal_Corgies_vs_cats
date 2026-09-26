// Simulation entity: plain data plus optional components. Systems in other folders may add
// component fields through module augmentation, e.g.
//   declare module '../entity' { interface SimEntity { weaponState?: WeaponState } }
// Never store Three.js objects or DOM references here — src/sim must run headless in Node.
import type { Collider } from '@dimforge/rapier3d-compat';
import type { AnimId, ClassId, EntityId, EntityKindId, SpeciesId, TeamId, Vec3 } from '../shared/types';
import type { InputCmd } from '../shared/input';
import type { MoveStats } from '../shared/content/classes';

export interface CharacterState {
  move: MoveStats;
  grounded: boolean;
  /** Seconds since last grounded (for coyote time). */
  airTime: number;
  /** Seconds a jump press stays buffered. */
  jumpBuffer: number;
  jumpsUsed: number;
  jumpHeld: boolean;
  /** Downward speed at the last landing (m/s), for land FX/anim. */
  landImpact: number;
  sprinting: boolean;
  /** Seconds left in the current slide (0 = not sliding). */
  slideTime: number;
  /** Seconds until another slide is allowed. */
  slideCooldown: number;
  /** True while slamming down in a ground pound. */
  pounding: boolean;
  /** Seconds an in-air crouch press stays buffered for a ground pound. */
  crouchBuffer: number;
  /** Ear Glide: seconds of glide left (0 = not gliding) and seconds until the next glide. */
  glideTime: number;
  glideCooldown: number;
  /**
   * Collider position after the last full controller sweep that left the character resting (grounded, still).
   * While the collider is still exactly there and the character has no intent, the sweep is skipped; anything
   * that moves the collider (push, teleport, respawn, reconciliation) forces a full sweep. NaN = not resting.
   */
  restX: number; restY: number; restZ: number;
}

export interface HealthState {
  hp: number;
  max: number;
  lastDamageTick: number;
  lastAttacker: EntityId;
}

export interface SimEntity {
  id: EntityId;
  kind: EntityKindId;
  team: TeamId;
  species: SpeciesId;
  cls: ClassId | null;
  seed: number;
  name: string;
  /** Feet position (bottom of the capsule). */
  pos: Vec3;
  vel: Vec3;
  /** Aim/view yaw and pitch. */
  yaw: number;
  pitch: number;
  collider: Collider | null;
  /**
   * Set by the Room for a player whose inputs are late (starved tick): movement and map effects skip the entity
   * this tick, and the queued inputs replay in order when they arrive (host/room.ts freeze + catch-up).
   */
  moveFrozen?: boolean;
  input: InputCmd;
  /** Previous tick's buttons, for edge detection. */
  prevButtons: number;
  lastInputSeq: number;
  char: CharacterState | null;
  health: HealthState | null;
  anim: AnimId;
  flags: number;
  dead: boolean;
  /** Tick at which a dead entity respawns (0 = not scheduled). */
  respawnTick: number;
  weapon: number;
  ammo: number;
  /** Connection id of the controlling player, or null for bots/props. */
  ownerPid: string | null;
  removed: boolean;
  /** Per-system scratch space, namespaced by system name. Must be plain data. */
  data: Record<string, unknown>;
}

export function pressed(e: SimEntity, btn: number): boolean {
  return (e.input.buttons & btn) !== 0 && (e.prevButtons & btn) === 0;
}

export function held(e: SimEntity, btn: number): boolean {
  return (e.input.buttons & btn) !== 0;
}
