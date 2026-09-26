// Tuning for the ability entities (Spotter Drone, Dig Charge, Squeak Barrier) that AbilityDef has no field for
// yet. Pure data (shared types only): the authority (src/sim/combat/ability-*.ts) and the client views
// (src/client/abilities/) read the same numbers, so the drawn barrier is exactly the collider.
// The AbilityDef fields still rule what they cover: cooldown, duration, range (drone spot radius · charge blast
// radius · barrier width), damage, knockback and noise. Requested AbilityDef fields: docs/handoff/C2.md.
import { EntityKind } from '../../shared/types';

/**
 * Snapshot kind of the ability entities (cls = ABILITY_IDS index). They share EntityKind.Prop with the objective
 * beacon (cls = OBJECTIVE_CHAIN_IDS index 0) until a dedicated kind lands (requested: docs/handoff/C2.md) — change
 * it here and both the authority and the views follow.
 */
export const ABILITY_ENTITY_KIND: number = EntityKind.Ability; // its own kind: a Prop with a cls read as S1's mission beacon

/** Spotter Drone ("Bird Watcher"): a hovering scout; marks enemies it can see for its team. */
export const DRONE = {
  /** Hit points (hitscan, projectiles and blasts shoot it down). */
  hp: 60,
  /** Collider sphere radius (m). */
  radius: 0.42,
  /** Station, relative to the owner's feet: this far ahead along the aim yaw and this high up. */
  ahead: 5,
  up: 4.2,
  /** Minimum height above the ground under the station. */
  minAboveGround: 2.2,
  /** Seconds to fly from the owner's shoulder to the station (ease-out). */
  launch: 0.6,
  /** Hover bob amplitude (m) and rate (Hz); spin (rad/s). */
  bob: 0.12,
  bobHz: 0.8,
  spin: 0.9,
  /** Spotting runs every N ticks (10 Hz); a spotted enemy stays flagged this long after the last sighting (s). */
  spotEvery: 6,
  spotLinger: 0.4,
  /** Cloaked enemies are only spotted within this distance of the drone (m); tall-grass concealment is halved. */
  cloakReveal: 6,
} as const;

/** Dig Charge ("Litter Mine"): a buried proximity charge. */
export const CHARGE = {
  /** Seconds after planting before it can trigger. */
  armTime: 1.0,
  /** An enemy (with line of sight to the charge) within this distance (m) of it sets it off. */
  trigger: 3,
  /** Blast: full damage inside `inner` (m), linear down to `edgeFrac` at AbilityDef.range; the owner takes `selfMult`. */
  inner: 1.0,
  edgeFrac: 0.3,
  selfMult: 0.35,
  /** Blast center height above the planted point (m) — the point line of sight is traced from. */
  blastLift: 0.35,
  /** Live charges per owner: planting another removes the oldest. */
  maxPerOwner: 2,
  /** Plant on the ground under the crosshair when it is this close (m), else at the owner's feet. */
  plantReach: 4.5,
  /** Enemy shots passing this close (m) to a charge, or enemy blasts within 60 % of their radius, defuse it. */
  shotRadius: 0.35,
} as const;

/** Squeak Barrier ("Scratch Wall"): a squeaky-toy wall segment. Width = AbilityDef.range. */
export const BARRIER = {
  hp: 300,
  /** Height above the ground at its center (m); the collider also reaches `sink` below it to cover slopes. */
  height: 2.4,
  sink: 0.5,
  thickness: 0.4,
  /** Center distance in front of the owner (m); nearby spots are tried when that one is blocked. */
  dist: 2.0,
  /** Max ground height difference (m) between the wall's center and its ends. */
  maxSlope: 0.5,
} as const;
