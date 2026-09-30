// Bot archetypes as data. PvE cat archetypes (grunt/sniper/brute/kitten, and the W9 K3 squads alley_raider and
// tabby_heavy) are spawned by the yard-skirmish waves; team-fill bots (both species) get a profile from their class kit.
// Theme names only appear in `label` (used for bot names); behaviour is keyed by `id`.
//
// K3 squads (docs/handoff/K3.md): two enemy families that read at a glance and ask for different answers, with no new
// player power.
//   alley_raider  light, fast, flanking scrappers with low hp: they circle in close and strafe hard, so a player who
//                 tunnels on the front line gets hit from the side (answer: turn, hold a corner, cover each other).
//   tabby_heavy   slow, tanky shield-bearers that plant and suppress: a frontal guard (a bin-lid shield) takes part of
//                 every hit from the front, and they turn slowly (answer: flank them, crossfire, explosives).
// Their kits are drawn by the client from `kit` (squadKitFor: class + max hp, both already in every snapshot, so no
// protocol field is needed); `guard` is read by one guarded line in combat/damage.ts (guardFactor).
import type { ClassId } from '../../shared/types';
import type { WeaponId } from '../../shared/content/weapons';

export type ArchetypeId =
  | 'grunt' | 'sniper' | 'brute' | 'kitten' | 'alley_raider' | 'tabby_heavy'
  | 'rifleman' | 'skirmisher' | 'marksman' | 'bomber' | 'guard' | 'raider';

/** K3: squad kits the client draws for PvE archetypes (presentation only: a kit variant on the shared rig). */
export type SquadKit = 'alley' | 'heavy';
export const SQUAD_KITS: readonly SquadKit[] = ['alley', 'heavy'];

export interface Archetype {
  id: ArchetypeId;
  /** Display prefix for bot names. */
  label: string;
  /** Class kit used when spawning (snapshot `cls`), and the weapon override (else the class primary). */
  cls: ClassId;
  weapon?: WeaponId;
  /** Max hp override (else the class value). */
  hp?: number;
  /** Multiplier on run/sprint speed. */
  speedMult: number;
  /** Seconds between first seeing a target and the first shot (uniform in range). */
  reaction: [number, number];
  /** Aim error (radians): starts at aimErr and settles toward aimErrMin with time constant aimSettle (s) while tracking. */
  aimErr: number;
  aimErrMin: number;
  aimSettle: number;
  /** Max turn rate (rad/s) and aim smoothing (1/s). */
  turnRate: number;
  aimLambda: number;
  /** Perception. */
  sightRange: number;
  fovHalf: number;
  /** Engagement band override (m); else the weapon's aiRange. */
  preferRange?: [number, number];
  /** Auto-fire bursts: shots per burst and pause between bursts (s). */
  burst: [number, number];
  burstPause: [number, number];
  /** 0..1: how much the bot strafes while engaging. */
  strafe: number;
  /** Random jumps per second while engaging. */
  jumpRate: number;
  /** Retreat to cover below this hp fraction (0 = never retreats). */
  retreatHp: number;
  /** Seconds the bot visibly aims (EFlag.Aiming → laser telegraph) before a charged shot. */
  telegraph: number;
  /** Chance per acquisition to go for the head. */
  headChance: number;
  /** Aim-down-sights beyond this distance (m); Infinity = never. */
  adsBeyond: number;
  /** 0..1 scale on the tactical rolls for the class ability (src/sim/ai/tactics.ts); PvE fodder uses less. */
  abilityUse: number;
  /** K3: the squad kit the client draws (presentation only; needs a unique `hp` for its class, see squadKitFor). */
  kit?: SquadKit;
  /**
   * K3 frontal guard (a shield): a hit from an attacker within `arc` (radians) of the facing deals `1 - reduce` of its
   * damage (guardFactor, read by combat/damage.ts for PvE bots only).
   */
  guard?: { reduce: number; arc: number };
}

const DEG = Math.PI / 180;

const BASE: Omit<Archetype, 'id' | 'label' | 'cls'> = {
  // Human-feeling aim: bots settle to ~1.6° (a near miss at 20 m), not laser accuracy (QA W1 difficulty).
  speedMult: 1, reaction: [0.35, 0.55], aimErr: 7.5 * DEG, aimErrMin: 1.6 * DEG, aimSettle: 0.9,
  turnRate: 5.5, aimLambda: 9, sightRange: 45, fovHalf: 55 * DEG, burst: [3, 7], burstPause: [0.2, 0.45],
  strafe: 0.8, jumpRate: 0.12, retreatHp: 0.3, telegraph: 0, headChance: 0.1, adsBeyond: 14, abilityUse: 1,
};

/** Long-range charge-shot behaviour: keeps distance, stands still and telegraphs with the laser. */
const SNIPER_TUNING: Partial<Archetype> = {
  reaction: [0.35, 0.5], aimErr: 3.5 * DEG, aimErrMin: 0.3 * DEG, aimSettle: 0.9, turnRate: 3.5, aimLambda: 6,
  sightRange: 75, fovHalf: 45 * DEG, preferRange: [20, 50], strafe: 0.15, jumpRate: 0, retreatHp: 0.45,
  telegraph: 0.9, headChance: 0.2, adsBeyond: 0,
};

export const ARCHETYPES: Record<ArchetypeId, Archetype> = {
  // --- PvE cats ---
  // PvE wave fodder: a touch slower and looser than team-fill bots so co-op squads feel strong
  grunt: {
    ...BASE, id: 'grunt', label: 'Tabby', cls: 'assault', weapon: 'squeaker_rifle',
    reaction: [0.45, 0.7], aimErr: 9 * DEG, aimErrMin: 2.2 * DEG, burstPause: [0.35, 0.7], retreatHp: 0.25, abilityUse: 0.5,
  },
  sniper: { ...BASE, ...SNIPER_TUNING, telegraph: 1.1, aimErrMin: 0.45 * DEG, abilityUse: 0.6, id: 'sniper', label: 'Siamese', cls: 'overwatch', weapon: 'laser_longshot' },
  brute: {
    ...BASE, id: 'brute', label: 'Chonk', cls: 'warden', weapon: 'sprinkler_cannon', hp: 320, speedMult: 0.85,
    reaction: [0.3, 0.45], aimErr: 5 * DEG, aimErrMin: 1.2 * DEG, aimSettle: 0.5, turnRate: 4, sightRange: 40,
    preferRange: [2.5, 8], strafe: 0.3, jumpRate: 0.04, retreatHp: 0, adsBeyond: Infinity, abilityUse: 0.7,
  },
  kitten: {
    ...BASE, id: 'kitten', label: 'Kitten', cls: 'infiltrator', weapon: 'claw_swipe', hp: 45, speedMult: 1.2,
    reaction: [0.25, 0.35], aimErr: 3 * DEG, aimErrMin: 1 * DEG, aimSettle: 0.3, turnRate: 8, aimLambda: 14,
    sightRange: 35, preferRange: [0, 1.2], burst: [3, 6], burstPause: [0.15, 0.3], strafe: 0.5, jumpRate: 0.6,
    retreatHp: 0, adsBeyond: Infinity, abilityUse: 0.35,
  },
  // K3 alley-cat raiders: fast, fragile flankers with a sidearm. They close to pistol range and circle (full strafe,
  // hops) rather than trade from the front; loose aim and short bursts with long pauses, so the threat is the angle,
  // not the damage (up close a pistol lands far more often than a kitten's claw: qa-difficulty tuned). No cloak.
  alley_raider: {
    ...BASE, id: 'alley_raider', label: 'Alley Cat', cls: 'infiltrator', weapon: 'snap_pistol', hp: 60, speedMult: 1.15,
    reaction: [0.45, 0.7], aimErr: 11 * DEG, aimErrMin: 3.4 * DEG, aimSettle: 1.3, turnRate: 7.5, aimLambda: 12,
    sightRange: 40, fovHalf: 65 * DEG, preferRange: [5, 12], burst: [1, 2], burstPause: [0.6, 1.0], strafe: 1, jumpRate: 0.4,
    retreatHp: 0, headChance: 0.03, adsBeyond: Infinity, abilityUse: 0, kit: 'alley',
  },
  // K3 tabby heavies: slow shield-bearers that plant and suppress with a repeater. The frontal guard takes 40 % of hits
  // from within 55° of where they face; they turn slowly, so a flank or a crossfire gets full damage in.
  tabby_heavy: {
    ...BASE, id: 'tabby_heavy', label: 'Heavy', cls: 'assault', weapon: 'squeaker_rifle', hp: 180, speedMult: 0.78,
    reaction: [0.5, 0.75], aimErr: 8 * DEG, aimErrMin: 2.4 * DEG, aimSettle: 1.2, turnRate: 3.2, aimLambda: 6,
    sightRange: 45, preferRange: [9, 20], burst: [4, 8], burstPause: [0.5, 0.9], strafe: 0.12, jumpRate: 0,
    retreatHp: 0, headChance: 0.05, adsBeyond: Infinity, abilityUse: 0.3, kit: 'heavy', guard: { reduce: 0.4, arc: 55 * DEG },
  },
  // --- team-fill profiles (per class kit, either species; weapon = class primary) ---
  rifleman: { ...BASE, id: 'rifleman', label: 'Rifle', cls: 'assault' },
  skirmisher: { ...BASE, id: 'skirmisher', label: 'Scout', cls: 'infiltrator', jumpRate: 0.25, headChance: 0.2 },
  marksman: { ...BASE, ...SNIPER_TUNING, aimErrMin: 0.35 * DEG, id: 'marksman', label: 'Marksman', cls: 'overwatch' },
  bomber: { ...BASE, id: 'bomber', label: 'Bomber', cls: 'breacher', strafe: 0.5, adsBeyond: Infinity },
  guard: { ...BASE, id: 'guard', label: 'Guard', cls: 'warden', strafe: 0.4, retreatHp: 0.2, adsBeyond: Infinity },
  raider: { ...BASE, id: 'raider', label: 'Raider', cls: 'skyraider', jumpRate: 0.45, adsBeyond: Infinity },
};

const BY_CLASS: Record<ClassId, ArchetypeId> = {
  assault: 'rifleman', infiltrator: 'skirmisher', overwatch: 'marksman', breacher: 'bomber', warden: 'guard', skyraider: 'raider',
};

/** Behaviour profile for a team-fill bot carrying a class kit. */
export function archetypeForClass(cls: ClassId | null): Archetype {
  return ARCHETYPES[BY_CLASS[cls ?? 'assault']];
}

/** PvE archetypes that carry a squad kit. */
const SQUADS: readonly Archetype[] = Object.values(ARCHETYPES).filter((a) => a.kit && a.hp);

/**
 * K3: the squad kit to draw for a bot, from what every snapshot already carries (its class and max hp): a squad
 * archetype's hp is unique for its class (no class, Upgrade Core or other archetype has it; tested), and PvE bots never
 * take pickups or swap kits, so the kit never changes during a life. Null for everything else. Presentation only.
 */
export function squadKitFor(cls: ClassId | null | undefined, maxHp: number): SquadKit | null {
  for (const a of SQUADS) if (a.cls === cls && a.hp === maxHp) return a.kit!;
  return null;
}

/** W11 F3: the archetypes a chapter spawns as cats (spawnChapterCat: the class kit + the archetype's hp). */
const PVE_IDS: readonly ArchetypeId[] = ['grunt', 'sniper', 'brute', 'kitten', 'alley_raider', 'tabby_heavy'];

/**
 * W11 F3 (P2-1): the archetype behind a cat bot's snapshot (its class and max hp), for presentation (the sentry's drawn
 * sight, client/adventure/views.ts): the PvE archetype of this class whose hp override is this max hp, else the PvE
 * archetype of this class without an hp override (grunt, sniper), else the class's team-fill profile. Each PvE hp is
 * unique for its class (the same premise as squadKitFor, tested there). Pure.
 */
export function archetypeForSnapshot(cls: ClassId | null | undefined, maxHp: number): Archetype {
  let plain: Archetype | null = null;
  for (const id of PVE_IDS) {
    const a = ARCHETYPES[id];
    if (a.cls !== cls) continue;
    if (a.hp === maxHp) return a;
    if (a.hp === undefined && !plain) plain = a;
  }
  return plain ?? archetypeForClass(cls ?? null);
}

/**
 * W11 F3 (P2-1): the range (m) at which archetype `a` spots a character in the open, in weather of sight multiplier
 * `weatherSight` (WeatherParams.sight: 1 clear … 0.6 storm). The brain's perception uses exactly this (brain.ts perceive),
 * and the sentry cone's far arc is drawn at exactly this, so what the player sees is what the cat sees.
 */
export function detectionRange(a: Pick<Archetype, 'sightRange'>, weatherSight: number): number {
  return a.sightRange * weatherSight;
}

/**
 * K3 frontal guard: the damage multiplier for a hit on a bot of archetype `arch` at (x, z) facing `yaw` (0 = -Z) from an
 * attacker at (ax, az): `1 - guard.reduce` when the attacker is within the guard arc of the facing, else 1 (and 1 for
 * archetypes without a guard, unknown ids, or an attacker on top of it). Pure.
 */
export function guardFactor(arch: string | undefined, yaw: number, x: number, z: number, ax: number, az: number): number {
  const g = arch && Object.prototype.hasOwnProperty.call(ARCHETYPES, arch) ? ARCHETYPES[arch as ArchetypeId].guard : undefined;
  if (!g) return 1;
  const dx = ax - x, dz = az - z, d = Math.hypot(dx, dz);
  if (d < 1e-3) return 1;
  return (-Math.sin(yaw) * dx - Math.cos(yaw) * dz) / d >= Math.cos(g.arc) ? 1 - g.reduce : 1;
}
