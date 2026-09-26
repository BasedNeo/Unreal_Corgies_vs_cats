// Weapons as data (theme content). The authoritative combat systems in src/sim/combat read these
// tables; clients read them for HUD names, ammo bars, recoil kick and projectile visuals.
// Units: meters, seconds, radians, hit points. `EntityState.weapon` is an index into WEAPON_IDS.
import { Species, type SpeciesId } from '../types';

export type WeaponKind = 'hitscan' | 'projectile';

export interface ProjectileDef {
  /** Launch speed (m/s) along the aim direction. */
  speed: number;
  /** Vertical acceleration (m/s², negative = down). */
  gravity: number;
  /** Collision radius (m) against characters. */
  radius: number;
  /** Seconds before the projectile expires (explodes if `fuse`). */
  lifetime: number;
  /** World bounces before it stops (0 = impact on first contact). */
  bounces: number;
  /** Speed kept per bounce (0..1). */
  restitution: number;
  /** Damage multiplier added per bounce ("bank shot" bonus), e.g. 0.2 = +20 % per bounce. */
  bounceBonus: number;
  /** Explosion radius (m); 0 = no explosion (direct damage only). */
  explodeRadius: number;
  /** Explosion damage at the center. */
  explodeDamage: number;
  /** Full explosion damage inside this radius. */
  explodeInner: number;
  /** Damage fraction at the explosion edge (linear falloff from inner to radius). */
  explodeEdgeFrac: number;
  /** Multiplier for explosion damage dealt to the shooter (friendly fire stays off for teammates). */
  selfDamageMult: number;
  /** Outward knockback speed (m/s) at the explosion center, scaled by falloff. */
  knockback: number;
  /** Explode when the lifetime ends. */
  fuse: boolean;
}

export interface RecoilDef {
  /** Camera pitch kick per shot (radians, presentation only — the client applies it to its view). */
  pitch: number;
  /** Max random yaw kick per shot (radians, ±). */
  yaw: number;
  /** Seconds for the camera kick to settle. */
  recover: number;
}

export interface WeaponDef {
  id: string;
  /** Corgi-side display name. */
  name: string;
  /** Cat-side display name (same kit, different flavor). */
  catName: string;
  kind: WeaponKind;
  /** Hold the trigger to keep firing. Semi-auto weapons fire on press (with a short input buffer). */
  auto: boolean;
  /** Damage per pellet (hitscan) or per direct projectile hit. */
  damage: number;
  /** Multiplier for hits in the head zone (top 20 % of the capsule). */
  headMult: number;
  /** Shots per second (cap). */
  fireRate: number;
  magSize: number;
  reloadTime: number;
  /** Rays per shot (spread weapons). */
  pellets: number;
  /** Cone half-angle (radians) from the hip and while aiming (Btn.Aim). */
  spreadHip: number;
  spreadAim: number;
  /** Extra spread factor at full run speed (1 = no penalty; scales linearly with speed). */
  moveSpreadMult: number;
  /** Spread factor while airborne. */
  airSpreadMult: number;
  /** Spread added per shot (radians), capped at bloomMax, recovering at bloomRecover rad/s. */
  bloomPerShot: number;
  bloomMax: number;
  bloomRecover: number;
  recoil: RecoilDef;
  /** Maximum hit distance (m). */
  range: number;
  /** Full damage up to falloffStart, linear down to falloffMin × damage at falloffEnd and beyond. */
  falloffStart: number;
  falloffEnd: number;
  falloffMin: number;
  /** Seconds to full charge while the trigger is held (0 = no charge). Charged weapons fire on release. */
  chargeTime: number;
  /** Damage fraction of an uncharged (tap) shot. */
  chargeMinFrac: number;
  projectile?: ProjectileDef;
  /** Bot engagement band (m): approach beyond max, back off inside min. */
  aiRange: [number, number];
  /** How far (m) other characters hear this weapon fire. */
  noise: number;
  /** Only non-player archetypes carry this weapon (never offered as a player kit). */
  npcOnly?: boolean;
}

const DEG = Math.PI / 180;

/** Stable weapon order: `EntityState.weapon` indexes this list. Append only (never reorder). */
export const WEAPON_IDS = ['squeaker_rifle', 'snap_pistol', 'laser_longshot', 'tennis_mortar', 'sprinkler_cannon', 'frisbee_launcher', 'claw_swipe'] as const;
export type WeaponId = (typeof WEAPON_IDS)[number];

const NO_RECOIL: RecoilDef = { pitch: 0, yaw: 0, recover: 0.1 };

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  // Assault. The flagship: responsive 10 rps auto, readable 15 dmg ticks, 0.7 s body TTK vs 120 hp.
  squeaker_rifle: {
    id: 'squeaker_rifle', name: 'Squeaker Rifle', catName: 'Hairball Repeater', kind: 'hitscan', auto: true,
    damage: 15, headMult: 1.6, fireRate: 10, magSize: 30, reloadTime: 1.6, pellets: 1,
    spreadHip: 1.2 * DEG, spreadAim: 0.35 * DEG, moveSpreadMult: 1.5, airSpreadMult: 2.2,
    bloomPerShot: 0.16 * DEG, bloomMax: 1.6 * DEG, bloomRecover: 8 * DEG,
    recoil: { pitch: 0.55 * DEG, yaw: 0.35 * DEG, recover: 0.12 },
    range: 90, falloffStart: 24, falloffEnd: 48, falloffMin: 0.6, chargeTime: 0, chargeMinFrac: 1,
    aiRange: [7, 24], noise: 38,
  },
  // Infiltrator. Precise semi-auto sidearm that rewards headshots.
  snap_pistol: {
    id: 'snap_pistol', name: 'Snap Pistol', catName: 'Claw Snapper', kind: 'hitscan', auto: false,
    damage: 26, headMult: 2.0, fireRate: 5, magSize: 12, reloadTime: 1.2, pellets: 1,
    spreadHip: 0.9 * DEG, spreadAim: 0.25 * DEG, moveSpreadMult: 1.4, airSpreadMult: 2,
    bloomPerShot: 0.5 * DEG, bloomMax: 2 * DEG, bloomRecover: 6 * DEG,
    recoil: { pitch: 1.1 * DEG, yaw: 0.4 * DEG, recover: 0.16 },
    range: 70, falloffStart: 18, falloffEnd: 40, falloffMin: 0.6, chargeTime: 0, chargeMinFrac: 1,
    aiRange: [6, 20], noise: 26,
  },
  // Overwatch. Charge-and-release laser pointer sniper: hold Fire to charge (0.6 s), release to fire.
  laser_longshot: {
    id: 'laser_longshot', name: 'Laser Longshot', catName: 'Red Dot Lance', kind: 'hitscan', auto: false,
    damage: 85, headMult: 1.75, fireRate: 1.1, magSize: 5, reloadTime: 2.2, pellets: 1,
    spreadHip: 2.4 * DEG, spreadAim: 0.05 * DEG, moveSpreadMult: 2.5, airSpreadMult: 3,
    bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
    recoil: { pitch: 3 * DEG, yaw: 0.6 * DEG, recover: 0.35 },
    range: 160, falloffStart: 160, falloffEnd: 160, falloffMin: 1, chargeTime: 0.6, chargeMinFrac: 0.35,
    aiRange: [22, 55], noise: 45,
  },
  // Breacher. Arcing tennis-ball mortar that explodes on impact.
  tennis_mortar: {
    id: 'tennis_mortar', name: 'Tennis Mortar', catName: 'Yarnball Lobber', kind: 'projectile', auto: false,
    damage: 25, headMult: 1, fireRate: 1.4, magSize: 4, reloadTime: 2.4, pellets: 1,
    spreadHip: 1.2 * DEG, spreadAim: 0.4 * DEG, moveSpreadMult: 1.3, airSpreadMult: 1.6,
    bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
    recoil: { pitch: 2.5 * DEG, yaw: 0.5 * DEG, recover: 0.3 },
    range: 120, falloffStart: 120, falloffEnd: 120, falloffMin: 1, chargeTime: 0, chargeMinFrac: 1,
    projectile: {
      speed: 27, gravity: -18, radius: 0.16, lifetime: 4, bounces: 0, restitution: 0, bounceBonus: 0,
      explodeRadius: 4.2, explodeDamage: 85, explodeInner: 0.7, explodeEdgeFrac: 0.2, selfDamageMult: 0.35,
      knockback: 10, fuse: true,
    },
    aiRange: [10, 30], noise: 30,
  },
  // Warden. Short-range water-shot spread cannon.
  sprinkler_cannon: {
    id: 'sprinkler_cannon', name: 'Sprinkler Cannon', catName: 'Hiss Blaster', kind: 'hitscan', auto: false,
    damage: 11, headMult: 1.25, fireRate: 1.6, magSize: 6, reloadTime: 2.0, pellets: 9,
    spreadHip: 4.6 * DEG, spreadAim: 3.2 * DEG, moveSpreadMult: 1.15, airSpreadMult: 1.3,
    bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
    recoil: { pitch: 3.5 * DEG, yaw: 1 * DEG, recover: 0.25 },
    range: 28, falloffStart: 8, falloffEnd: 20, falloffMin: 0.4, chargeTime: 0, chargeMinFrac: 1,
    aiRange: [3, 11], noise: 30,
  },
  // Skyraider. Floaty frisbees that bank off walls (+20 % damage per bounce).
  frisbee_launcher: {
    id: 'frisbee_launcher', name: 'Frisbee Launcher', catName: 'Saucer Flinger', kind: 'projectile', auto: false,
    damage: 42, headMult: 1.3, fireRate: 2.5, magSize: 8, reloadTime: 1.8, pellets: 1,
    spreadHip: 1 * DEG, spreadAim: 0.3 * DEG, moveSpreadMult: 1.3, airSpreadMult: 1.3,
    bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
    recoil: { pitch: 1.2 * DEG, yaw: 0.4 * DEG, recover: 0.18 },
    range: 80, falloffStart: 80, falloffEnd: 80, falloffMin: 1, chargeTime: 0, chargeMinFrac: 1,
    projectile: {
      speed: 32, gravity: -3, radius: 0.28, lifetime: 2.4, bounces: 2, restitution: 0.85, bounceBonus: 0.2,
      explodeRadius: 0, explodeDamage: 0, explodeInner: 0, explodeEdgeFrac: 0, selfDamageMult: 0,
      knockback: 0, fuse: false,
    },
    aiRange: [7, 22], noise: 22,
  },
  // Swarm kittens only: a fast, short-reach swipe.
  claw_swipe: {
    id: 'claw_swipe', name: 'Claw Swipe', catName: 'Claw Swipe', kind: 'hitscan', auto: true,
    damage: 9, headMult: 1, fireRate: 3.5, magSize: 12, reloadTime: 0.8, pellets: 1,
    spreadHip: 4 * DEG, spreadAim: 4 * DEG, moveSpreadMult: 1, airSpreadMult: 1,
    bloomPerShot: 0, bloomMax: 0, bloomRecover: 1,
    recoil: NO_RECOIL,
    range: 2.4, falloffStart: 2.4, falloffEnd: 2.4, falloffMin: 1, chargeTime: 0, chargeMinFrac: 1,
    aiRange: [0, 1.4], noise: 8, npcOnly: true,
  },
};

/** Index of a weapon id in WEAPON_IDS (the value carried in `EntityState.weapon`), -1 if unknown. */
export function weaponIndex(id: string): number {
  return (WEAPON_IDS as readonly string[]).indexOf(id);
}

/** Weapon definition for a snapshot index, or null for -1 / unknown. */
export function weaponByIndex(i: number): WeaponDef | null {
  const id = WEAPON_IDS[i];
  return id ? WEAPONS[id] : null;
}

/** Display name for a weapon as carried by a species (cats use the same kits with cat flavor). */
export function weaponDisplayName(id: string, species: SpeciesId): string {
  const w = (WEAPONS as Record<string, WeaponDef>)[id];
  if (!w) return id;
  return species === Species.Cat ? w.catName : w.name;
}

/** Game rules shared by combat, AI and presentation (data so they can be tuned without code). */
export const COMBAT_RULES = {
  friendlyFire: false,
  /** Seconds before a dead player / room bot respawns. */
  respawnDelay: 3,
  /** Seconds of spawn protection (ends early when the player fires). */
  spawnInvulnerable: 1.5,
  /** Seconds without taking damage before health regenerates. */
  regenDelay: 5,
  /** Fraction of max health regenerated per second. */
  regenPerSec: 0.06,
  /** Seconds a dead PvE wave enemy lingers before it is removed. */
  pveCorpseTime: 4,
  /** Lag compensation: history kept (ticks) and max rewind (seconds). */
  historyTicks: 64,
  maxRewind: 0.2,
  /** Hits above this fraction of capsule height count as headshots (crit). */
  headFraction: 0.8,
  /** Eye height as a fraction of capsule height (corgi ≈ 1.05 m). */
  eyeFraction: 0.875,
  /** Semi-auto trigger presses buffered this long (s) before the weapon is ready. */
  triggerBuffer: 0.1,
  /** Seconds EFlag.Firing stays on after a shot (so 30 Hz snapshots always carry it). */
  firingFlagHold: 0.15,
} as const;

/**
 * Third-person aim ray used for human players (the camera looks along viewDir from this point).
 * The authority finds what the crosshair is on with this ray, then fires from the eye toward it,
 * so over-the-shoulder aiming hits what the crosshair shows. The client camera must use the same
 * numbers (src/client/camera/third-person.ts: pivot +1.25 m, shoulder 0.55 hip / 0.75 aim).
 */
export const AIM_RAY = { pivotHeight: 1.25, shoulderHip: 0.55, shoulderAim: 0.75 } as const;
