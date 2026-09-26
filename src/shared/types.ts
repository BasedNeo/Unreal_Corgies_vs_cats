// Core shared enumerations. Plain `as const` objects (no TS enums) so the code stays erasable.

export type EntityId = number;

export const Team = { Corgis: 0, Cats: 1, Neutral: 2 } as const;
export type TeamId = (typeof Team)[keyof typeof Team];

/** Species decides the character body plan in the client and base stats in the sim. */
export const Species = { Corgi: 0, Cat: 1 } as const;
export type SpeciesId = (typeof Species)[keyof typeof Species];

/**
 * The six class jobs (locked names from the legacy roadmap, with the Conker-identical
 * "Demolisher" renamed to "Breacher"). Kits are data in src/shared/content.
 */
export const CLASS_IDS = ['assault', 'infiltrator', 'overwatch', 'breacher', 'warden', 'skyraider'] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/** Zone: a capturable area (core-rush Core Pads). Append only: the wire carries the number. */
export const EntityKind = { Player: 0, Bot: 1, Projectile: 2, Pickup: 3, Vehicle: 4, Prop: 5, Boss: 6, Terminal: 7, Zone: 8 } as const;
export type EntityKindId = (typeof EntityKind)[keyof typeof EntityKind];

/** Locomotion/presentation state the client animates from. Derived by the sim, never trusted from clients. */
export const Anim = { Idle: 0, Walk: 1, Run: 2, Sprint: 3, Jump: 4, Fall: 5, Land: 6, Dead: 7, Slide: 8, Swim: 9, Drive: 10 } as const;
export type AnimId = (typeof Anim)[keyof typeof Anim];

/** Entity flag bits in snapshots. */
export const EFlag = {
  Grounded: 1 << 0,
  Sprinting: 1 << 1,
  Firing: 1 << 2,
  Aiming: 1 << 3,
  Dead: 1 << 4,
  Crouching: 1 << 5,
  Reloading: 1 << 6,
  Invulnerable: 1 << 7,
  Stealthed: 1 << 8,
  Alerted: 1 << 9,
  /** Character is seated in a vehicle (the sim moves it with the vehicle; movement skips it). */
  Mounted: 1 << 10,
  /** Vehicle/terminal/pickup is in use or unavailable (cooldown). */
  Busy: 1 << 11,
  /** Revealed to the other team (Spotter Drone): drawn through walls for them while set. */
  Spotted: 1 << 12,
  /** Gliding (Ear Glide): fall speed capped, air control kept. */
  Gliding: 1 << 13,
  /** Upgrade Core buffs running on a character (one bit per core type; see CORE_FLAGS in content/pickups). */
  BuffOverclock: 1 << 14,
  BuffThickFur: 1 << 15,
  BuffZoomies: 1 << 16,
  BuffSqueaky: 1 << 17,
} as const;
export const BUFF_FLAGS = EFlag.BuffOverclock | EFlag.BuffThickFur | EFlag.BuffZoomies | EFlag.BuffSqueaky;

export interface Vec3 { x: number; y: number; z: number }
